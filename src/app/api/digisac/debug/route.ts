import { NextResponse } from 'next/server';

/**
 * GET /api/digisac/debug
 * 
 * Endpoint de debug para testar a conexão Digisac e listar tickets abertos
 */
export async function GET() {
  const logs: string[] = [];
  
  try {
    const url = process.env.DIGISAC_API_URL;
    const token = process.env.DIGISAC_API_TOKEN;

    logs.push('🔧 DIAGNÓSTICO DIGISAC API');
    logs.push('');
    logs.push(`URL: ${url || '❌ NÃO CONFIGURADA'}`);
    logs.push(`Token: ${token ? `${token.substring(0, 20)}... ✅` : '❌ NÃO CONFIGURADO'}`);
    logs.push('');

    if (!url || !token) {
      return NextResponse.json({
        success: false,
        error: 'Credenciais não configuradas',
        logs
      }, { status: 500 });
    }

    // 1. Buscar departamentos
    logs.push('1️⃣ Buscando departamentos...');
    const deptResponse = await fetch(`${url}/departments`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    logs.push(`Status: ${deptResponse.status}`);

    if (!deptResponse.ok) {
      const errorText = await deptResponse.text();
      logs.push(`❌ Erro: ${errorText}`);
      return NextResponse.json({ success: false, logs }, { status: 500 });
    }

    const deptData = await deptResponse.json();
    const departments = deptData.data || [];
    logs.push(`✅ ${departments.length} departamentos encontrados`);
    logs.push('');

    // Listar departamentos
    logs.push('📋 Departamentos:');
    departments.forEach((dept: any) => {
      logs.push(`   - ${dept.name} (ID: ${dept.id})`);
    });
    logs.push('');

    // 2. Buscar departamento VIP
    logs.push('2️⃣ Buscando departamento VIP...');
    const vipDept = departments.find((d: any) => 
      d.name.toLowerCase() === 'atendimento vip'
    ) || departments.find((d: any) => 
      d.name.toLowerCase().includes('grupos upvip') ||
      d.name.toLowerCase().includes('vip')
    );

    if (!vipDept) {
      logs.push('⚠️  Departamento VIP não encontrado');
      return NextResponse.json({ success: false, logs });
    }

    logs.push(`✅ Departamento VIP: ${vipDept.name} (ID: ${vipDept.id})`);
    logs.push('');

    // 3. Buscar tickets abertos
    logs.push('3️⃣ Buscando tickets abertos...');
    
    const query = {
      where: {
        isOpen: true,
        departmentId: vipDept.id
      },
      order: [["updatedAt", "DESC"]],
      page: 1,
      perPage: 50
    };

    const queryString = encodeURIComponent(JSON.stringify(query));
    const ticketsUrl = `${url}/tickets?query=${queryString}`;

    logs.push(`URL: ${ticketsUrl}`);

    const ticketsResponse = await fetch(ticketsUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    logs.push(`Status: ${ticketsResponse.status}`);

    if (!ticketsResponse.ok) {
      const errorText = await ticketsResponse.text();
      logs.push(`❌ Erro ao buscar tickets: ${errorText}`);
      return NextResponse.json({ success: false, logs }, { status: 500 });
    }

    const ticketsData = await ticketsResponse.json();
    const tickets = ticketsData.data || [];
    
    logs.push(`✅ ${tickets.length} tickets abertos encontrados`);
    logs.push('');

    if (tickets.length > 0) {
      logs.push('🎫 Tickets abertos:');
      logs.push('');
      
      for (const ticket of tickets.slice(0, 10)) {
        logs.push(`   📌 Ticket #${ticket.protocol || ticket.id}`);
        logs.push(`      ContactId: ${ticket.contactId}`);
        
        // Verificar se o contato já veio no ticket
        if (ticket.contact) {
          logs.push(`      ✅ Contato já incluído no ticket`);
          logs.push(`      Nome: ${ticket.contact.name || 'Sem nome'}`);
          logs.push(`      Número: ${ticket.contact.number || 'N/A'}`);
          logs.push(`      ID: ${ticket.contact.id || 'N/A'}`);
          logs.push(`      Atualizado: ${new Date(ticket.updatedAt).toLocaleString('pt-BR')}`);
          logs.push('');
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
            const contact = contactData.data;
            
            logs.push(`      Nome: ${contact?.name || 'Sem nome'}`);
            logs.push(`      Número: ${contact?.number || 'N/A'}`);
            logs.push(`      ID Contato: ${contact?.id || 'N/A'}`);
            logs.push(`      Atualizado: ${new Date(ticket.updatedAt).toLocaleString('pt-BR')}`);
            logs.push('');
          } else {
            const errorText = await contactResponse.text();
            logs.push(`      ⚠️  Erro ao buscar: Status ${contactResponse.status}`);
            logs.push(`      Detalhes: ${errorText.substring(0, 100)}`);
            logs.push('');
          }
        } catch (err) {
          logs.push(`      ⚠️  Erro na requisição`);
          logs.push(`      Erro: ${err instanceof Error ? err.message : String(err)}`);
          logs.push('');
        }
      }

      if (tickets.length > 10) {
        logs.push(`   ... e mais ${tickets.length - 10} tickets`);
      }
    }

    logs.push('');
    logs.push('✅ DIAGNÓSTICO CONCLUÍDO COM SUCESSO!');

    return NextResponse.json({
      success: true,
      logs,
      summary: {
        totalDepartments: departments.length,
        vipDepartmentFound: !!vipDept,
        totalOpenTickets: tickets.length,
        tickets: tickets.slice(0, 10).map((t: any) => ({
          id: t.id,
          protocol: t.protocol,
          contactId: t.contactId,
          updatedAt: t.updatedAt
        }))
      }
    });

  } catch (error) {
    logs.push('');
    logs.push('❌ ERRO NO DIAGNÓSTICO:');
    logs.push(error instanceof Error ? error.message : String(error));
    
    return NextResponse.json({
      success: false,
      logs,
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    }, { status: 500 });
  }
}
