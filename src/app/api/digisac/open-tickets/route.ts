import { NextRequest, NextResponse } from 'next/server';

interface DigisacContact {
  id: string;
  number: string;
  name: string;
  internalName?: string;
  contactId_digisac?: string;
}

interface DigisacTicket {
  id: string;
  isOpen: boolean;
  protocol: string;
  contactId: string;
  departmentId: string;
  updatedAt: string;
  contact?: DigisacContact;
}

interface DigisacDepartment {
  id: string;
  name: string;
}

interface DigisacMessage {
  id: string;
  contactId: string;
  departmentId?: string;
  text?: string;
  sendAt: string;
  contact?: DigisacContact;
}

let cachedDepartmentId: string | null = null;
let cachedAllTickets: Map<string, DigisacTicket> | null = null;
let cachedAllContacts: Map<string, any> | null = null;
let lastCacheTime: number = 0;
const CACHE_DURATION = 60000; // 1 minuto

/**
 * Busca o ID do departamento "Atendimento VIP"
 */
async function getVIPDepartmentId(url: string, token: string): Promise<string | null> {
  if (cachedDepartmentId) {
    return cachedDepartmentId;
  }

  try {
    console.log('[DIGISAC TICKETS] Buscando departamento Atendimento VIP...');
    
    const response = await fetch(`${url}/departments`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`[DIGISAC TICKETS] Erro ao buscar departamentos: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const departments: DigisacDepartment[] = data.data || [];
    
    // Priorizar busca exata por 'Atendimento VIP', depois alternativas
    const vipDept = departments.find(d => 
      d.name.toLowerCase() === 'atendimento vip'
    ) || departments.find(d => 
      d.name.toLowerCase().includes('grupos upvip') ||
      d.name.toLowerCase().includes('vip')
    );

    if (vipDept) {
      cachedDepartmentId = vipDept.id;
      console.log(`[DIGISAC TICKETS] ✓ Departamento VIP encontrado: ${vipDept.id} (${vipDept.name})`);
      return vipDept.id;
    }

    console.log('[DIGISAC TICKETS] ⚠ Departamento VIP não encontrado');
    return null;
  } catch (error) {
    console.error('[DIGISAC TICKETS] Erro ao buscar departamento:', error);
    return null;
  }
}

/**
 * Busca TODOS os tickets (abertos e fechados) do departamento VIP
 */
async function getAllTickets(url: string, token: string, departmentId: string): Promise<Map<string, DigisacTicket>> {
  try {
    console.log('[DIGISAC TICKETS] Buscando tickets recentes (últimos 90 dias)...');
    console.log('[DIGISAC TICKETS] Department ID:', departmentId);
    
    // Filtrar apenas tickets dos últimos 90 dias
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const dateFilter = ninetyDaysAgo.toISOString();
    
    const simpleQuery = {
      where: {
        departmentId: departmentId,
        updatedAt: {
          $gte: dateFilter // Apenas últimos 90 dias
        }
      },
      order: [["updatedAt", "DESC"]],
      page: 1,
      perPage: 300
    };

    const queryString = encodeURIComponent(JSON.stringify(simpleQuery));
    const fullUrl = `${url}/tickets?query=${queryString}`;
    
    console.log('[DIGISAC TICKETS] URL:', fullUrl);
    
    const response = await fetch(fullUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[DIGISAC TICKETS] Erro ao buscar tickets: ${response.status}`);
      console.error(`[DIGISAC TICKETS] Erro detalhes:`, errorText);
      return new Map();
    }

    const data = await response.json();
    const tickets: DigisacTicket[] = data.data || [];
    
    console.log(`[DIGISAC TICKETS] ✓ ${tickets.length} tickets encontrados (últimos 90 dias)`);

    // Buscar detalhes dos contatos para cada ticket
    const ticketsMap = new Map<string, DigisacTicket>();
    let firstContactLogged = false;
    
    for (const ticket of tickets) {
      // Verificar se o contato já veio com o ticket
      if (ticket.contact) {
        const contactName = ticket.contact.name;
        const contactNumber = ticket.contact.number;
        const internalName = ticket.contact.internalName;
        
        // Extrair external_id do internalName OU do contactName (formato: "uuid_NOME")
        let externalId = null;
        
        // Tentar extrair do internalName primeiro
        if (internalName && internalName.includes('_')) {
          externalId = internalName.split('_')[0];
        }
        
        // Se não encontrou no internalName, tentar extrair do contactName
        if (!externalId && contactName && contactName.includes('_')) {
          const possibleUuid = contactName.split('_')[0];
          // Validar se parece um UUID (8-4-4-4-12 caracteres)
          if (possibleUuid.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
            externalId = possibleUuid;
            console.log(`[DIGISAC TICKETS] ✓ External ID extraído do NAME: "${externalId}" de "${contactName}"`);
          }
        }
        
        const displayName = contactName || contactNumber || 'Sem identificação';
        
        if (!firstContactLogged) {
          console.log('[DIGISAC TICKETS] Estrutura do contato:', JSON.stringify(ticket.contact, null, 2));
          firstContactLogged = true;
        }
        
        // Log do external_id extraído
        if (externalId) {
          // Log removido para performance
        }
        
        // Adicionar múltiplas formas de identificação
        if (contactName) {
          ticketsMap.set(contactName, ticket);
          ticketsMap.set(contactName.toLowerCase(), ticket);
        }
        if (contactNumber) {
          ticketsMap.set(contactNumber, ticket);
          const cleanNumber = contactNumber.replace(/\D/g, '');
          ticketsMap.set(cleanNumber, ticket);
        }
        if (externalId) {
          ticketsMap.set(externalId, ticket);
        }
        const contactId = ticket.contact.id || ticket.contact.contactId_digisac;
        if (contactId) {
          ticketsMap.set(contactId, ticket);
        }
        // Log removido para performance
        continue;
      }
      
      // Se não veio, buscar separadamente
      try {
        const contactResponse = await fetch(`${url}/contacts/${ticket.contactId}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (contactResponse.ok) {
          const contactData = await contactResponse.json();
          
          // A estrutura é: contactData tem campos diretos + contactData.data com campos aninhados
          const contactNumber = contactData.data?.number;
          const contactName = contactData.name;
          const internalName = contactData.internalName;
            
          // Extrair external_id do internalName OU do contactName (formato: "uuid_NOME")
          let externalId = null;
          
          // Tentar extrair do internalName primeiro
          if (internalName && internalName.includes('_')) {
            externalId = internalName.split('_')[0];
          }
          
          // Se não encontrou no internalName, tentar extrair do contactName
          if (!externalId && contactName && contactName.includes('_')) {
            const possibleUuid = contactName.split('_')[0];
            // Validar se parece um UUID (8-4-4-4-12 caracteres)
            if (possibleUuid.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
              externalId = possibleUuid;
            }
          }
          
          // Log removido para segurança (contém dados sensíveis)
          
          ticket.contact = contactData;
          
          const displayName = contactName || contactNumber;
          
          // Adicionar múltiplas formas de identificação
          if (contactName) {
            ticketsMap.set(contactName, ticket);
            ticketsMap.set(contactName.toLowerCase(), ticket);
          }
          if (contactNumber) {
            ticketsMap.set(contactNumber, ticket);
            const cleanNumber = contactNumber.replace(/\D/g, '');
            ticketsMap.set(cleanNumber, ticket);
          }
          if (externalId) {
            ticketsMap.set(externalId, ticket);
          }
          const contactId = contactData.id;
          if (contactId) {
            ticketsMap.set(contactId, ticket);
          }
          // Log removido para performance
        } else {
          console.error(`[DIGISAC TICKETS] Erro ao buscar contato ${ticket.contactId}: Status ${contactResponse.status}`);
        }
      } catch (err) {
        console.error(`[DIGISAC TICKETS] Erro ao buscar contato ${ticket.contactId}:`, err);
      }
    }

    return ticketsMap;
  } catch (error) {
    console.error('[DIGISAC TICKETS] Erro ao buscar tickets:', error);
    return new Map();
  }
}

/**
 * Busca mensagens recentes e extrai contatos únicos (otimizado)
 * Basta 1 mensagem por contato para sinalizar que houve interação
 */
async function getContactsFromMessages(url: string, token: string, departmentId: string): Promise<Set<string>> {
  try {
    console.log('[DIGISAC MESSAGES] Buscando contatos únicos com mensagens...');
    
    const contactIds = new Set<string>();
    let page = 1;
    const perPage = 500;
    let totalMessages = 0;
    const maxPages = 30; // 30 páginas (~15000 mensagens) - aumento de 3x para cobrir mais histórico
    let pagesWithoutNewContacts = 0;
    const maxPagesWithoutNew = 3; // Para após 3 páginas sem contatos novos para economizar tempo
    
    while (page <= maxPages) {
      const previousSize = contactIds.size;
      const fullUrl = `${url}/messages?page=${page}&perPage=${perPage}`;
      
      const response = await fetch(fullUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[DIGISAC MESSAGES] Erro ${response.status} na página ${page}:`, errorText.substring(0, 200));
        break;
      }

      const data = await response.json();
      const messages: DigisacMessage[] = data.data || [];
      
      if (messages.length === 0) {
        console.log(`[DIGISAC MESSAGES] Página ${page} vazia, finalizando...`);
        break;
      }
      
      totalMessages += messages.length;
      
      // Extrair contactIds únicos desta página
      messages.forEach(msg => {
        if (msg.contactId) {
          contactIds.add(msg.contactId);
        }
      });
      
      const newContactsFound = contactIds.size - previousSize;
      console.log(`[DIGISAC MESSAGES] Página ${page}: ${messages.length} mensagens, +${newContactsFound} contatos novos (total: ${contactIds.size})`);
      
      // Se não encontrou nenhum contato novo, incrementar contador
      if (newContactsFound === 0) {
        pagesWithoutNewContacts++;
        console.log(`[DIGISAC MESSAGES] ⚠️ Nenhum contato novo nesta página (${pagesWithoutNewContacts}/${maxPagesWithoutNew})`);
        
        // Se já passaram N páginas sem contatos novos, parar
        if (pagesWithoutNewContacts >= maxPagesWithoutNew) {
          console.log(`[DIGISAC MESSAGES] 🛑 Parando: ${maxPagesWithoutNew} páginas consecutivas sem contatos novos`);
          break;
        }
      } else {
        // Reset do contador se encontrou novos contatos
        pagesWithoutNewContacts = 0;
      }
      
      // Se retornou menos que perPage, não há mais páginas
      if (messages.length < perPage) {
        console.log(`[DIGISAC MESSAGES] Última página alcançada (${messages.length} < ${perPage})`);
        break;
      }
      
      page++;
    }
    
    console.log(`[DIGISAC MESSAGES] ✓ Total: ${totalMessages} mensagens em ${page} página(s)`);
    console.log(`[DIGISAC MESSAGES] ✓ ${contactIds.size} contatos únicos encontrados`);
    
    return contactIds;
  } catch (error) {
    console.error('[DIGISAC MESSAGES] Erro ao buscar mensagens:', error);
    return new Set();
  }
}

/**
 * Busca detalhes dos contatos e adiciona ao mapa (otimizado)
 * Processa apenas contatos únicos com limite para performance
 */
async function addContactsToMap(
  url: string, 
  token: string, 
  contactIds: Set<string>, 
  contactsMap: Map<string, any>
): Promise<void> {
  const uniqueContacts = Array.from(contactIds);
  const maxContacts = 2000; // Aumentado de 630 para 2000 - processar mais contatos para melhor cobertura
  const contactsToProcess = uniqueContacts.slice(0, maxContacts);
  
  let processed = 0;
  let successful = 0;
  let withExternalId = 0;
  let fromInternalName = 0;
  let fromContactName = 0;
  const total = contactsToProcess.length;
  const externalIdsSample: string[] = [];
  
  console.log(`[DIGISAC MESSAGES] Processando até ${total} contatos únicos...`);
  
  for (const contactId of contactsToProcess) {
    processed++;
    
    try {
      const contactResponse = await fetch(`${url}/contacts/${contactId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (contactResponse.ok) {
        const contactData = await contactResponse.json();
        
        const contactNumber = contactData.data?.number;
        const contactName = contactData.name;
        const internalName = contactData.internalName;
        
        // Extrair external_id do internalName OU do contactName (formato: "uuid_NOME")
        let externalId = null;
        
        // Tentar extrair do internalName primeiro
        if (internalName && internalName.includes('_')) {
          externalId = internalName.split('_')[0];
          fromInternalName++;
        }
        
        // Se não encontrou no internalName, tentar extrair do contactName
        if (!externalId && contactName && contactName.includes('_')) {
          const possibleUuid = contactName.split('_')[0];
          // Validar se parece um UUID (8-4-4-4-12 caracteres)
          if (possibleUuid.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
            externalId = possibleUuid;
            fromContactName++;
          }
        }
        
        if (externalId) {
          withExternalId++;
          
          // Coletar amostra dos primeiros 5 external_ids
          if (externalIdsSample.length < 5) {
            externalIdsSample.push(externalId);
          }
        }
        
        // Adicionar múltiplas formas de identificação ao mapa
        if (contactName) {
          contactsMap.set(contactName, contactData);
          contactsMap.set(contactName.toLowerCase(), contactData);
        }
        if (contactNumber) {
          contactsMap.set(contactNumber, contactData);
          const cleanNumber = contactNumber.replace(/\D/g, '');
          contactsMap.set(cleanNumber, contactData);
        }
        if (externalId) {
          contactsMap.set(externalId, contactData);
        }
        if (contactId) {
          contactsMap.set(contactId, contactData);
        }
        
        successful++;
        
        // Log de progresso a cada 100 contatos ou no final
        if (processed % 100 === 0 || processed === total) {
          console.log(`[DIGISAC MESSAGES] ✓ ${processed}/${total} contatos processados (${successful} com sucesso, ${withExternalId} com external_id)`);
        }
      }
    } catch (err) {
      // Silenciar erros individuais para não poluir logs
    }
  }
  
  if (externalIdsSample.length > 0) {
    console.log(`[DIGISAC MESSAGES] 📋 Exemplos de external_ids extraídos (primeiros 5):`, externalIdsSample.join(', '));
    console.log(`[DIGISAC MESSAGES] 📊 Resumo: ${withExternalId}/${successful} contatos têm external_id (${fromInternalName} do internalName, ${fromContactName} do name)`);
  } else {
    console.log(`[DIGISAC MESSAGES] ⚠️ Nenhum external_id extraído dos contatos`);
  }
  
  if (uniqueContacts.length > maxContacts) {
    console.log(`[DIGISAC MESSAGES] ⚠️ ${uniqueContacts.length - maxContacts} contatos não processados (limite: ${maxContacts})`);
  }
}

/**
 * GET /api/digisac/open-tickets
 * 
 * Retorna mapa de usuários com tickets OU mensagens no histórico
 */
export async function GET(request: NextRequest) {
  try {
    const url = process.env.DIGISAC_API_URL;
    const token = process.env.DIGISAC_API_TOKEN;

    if (!url || !token) {
      return NextResponse.json(
        { success: false, error: 'Credenciais Digisac não configuradas' },
        { status: 500 }
      );
    }

    // Verificar cache
    const now = Date.now();
    if (cachedAllContacts && (now - lastCacheTime) < CACHE_DURATION) {
      console.log('[DIGISAC] Usando cache');
      return NextResponse.json({
        success: true,
        openTickets: Object.fromEntries(cachedAllContacts),
        cached: true,
        cacheAge: Math.floor((now - lastCacheTime) / 1000)
      });
    }

    // Buscar ID do departamento VIP
    const departmentId = await getVIPDepartmentId(url, token);
    
    if (!departmentId) {
      return NextResponse.json({
        success: false,
        error: 'Departamento VIP não encontrado'
      }, { status: 404 });
    }

    // 1. Buscar TODOS os tickets (abertos e fechados)
    const allTickets = await getAllTickets(url, token, departmentId);
    console.log(`[DIGISAC] ✓ ${allTickets.size} identificações via tickets`);

    // 2. Buscar contatos das mensagens recentes
    const contactIdsFromMessages = await getContactsFromMessages(url, token, departmentId);
    
    // 3. Combinar tudo em um mapa único
    const combinedMap = new Map(allTickets);
    const ticketsMapSize = allTickets.size;
    
    // Buscar detalhes dos contatos das mensagens e adicionar ao mapa
    if (contactIdsFromMessages.size > 0) {
      console.log(`[DIGISAC] Buscando detalhes de ${contactIdsFromMessages.size} contatos das mensagens...`);
      await addContactsToMap(url, token, contactIdsFromMessages, combinedMap);
      
      const newContactsAdded = combinedMap.size - ticketsMapSize;
      console.log(`[DIGISAC] ✓ ${newContactsAdded} novas identificações adicionadas via mensagens`);
    }

    console.log(`[DIGISAC] ✓ Total de ${combinedMap.size} identificações únicas (${ticketsMapSize} tickets + ${combinedMap.size - ticketsMapSize} mensagens)`);
    
    // Mostrar amostra de chaves UUID no mapa (para debug de correspondência)
    const allKeys = Array.from(combinedMap.keys());
    const uuidKeys = allKeys.filter(key => 
      typeof key === 'string' && 
      key.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    );
    console.log(`[DIGISAC] 🔑 ${uuidKeys.length} chaves formato UUID no mapa`);
    if (uuidKeys.length > 0) {
      console.log(`[DIGISAC] 📋 Exemplos de UUIDs no mapa (primeiros 10):`, uuidKeys.slice(0, 10).join(', '));
    }
    
    // Mostrar estatísticas dos tipos de chaves
    const nameKeys = allKeys.filter(k => typeof k === 'string' && !k.match(/^[0-9a-f-]+$/i) && k.length > 3);
    const phoneKeys = allKeys.filter(k => typeof k === 'string' && k.match(/^\+?[0-9\s()-]+$/));
    console.log(`[DIGISAC] 📊 Tipos de chaves: ${uuidKeys.length} UUIDs, ${nameKeys.length} nomes, ${phoneKeys.length} telefones`);

    // Atualizar cache
    cachedAllContacts = combinedMap;
    lastCacheTime = now;

    return NextResponse.json({
      success: true,
      openTickets: Object.fromEntries(combinedMap),
      cached: false,
      total: combinedMap.size,
      ticketsCount: allTickets.size,
      messagesContactsCount: contactIdsFromMessages.size,
      newFromMessages: combinedMap.size - ticketsMapSize
    });

  } catch (error) {
    console.error('[DIGISAC] Erro:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erro desconhecido' 
      },
      { status: 500 }
    );
  }
}
