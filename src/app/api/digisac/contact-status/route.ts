import { NextRequest, NextResponse } from 'next/server';

interface DigisacContact {
  id: string;
  number: string;
  name: string;
}

interface DigisacTicket {
  id: string;
  isOpen: boolean;
  protocol: string;
  startedAt: string;
  endedAt: string | null;
  updatedAt: string;
}

/**
 * Busca status de contato no Digisac
 * - "Sem contato": sem chamado nos últimos 7 dias
 * - "Em chamado": chamado aberto atualmente (isOpen = true)
 * - "Respondido": resposta nos últimos 7 dias
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const external_id = searchParams.get('external_id');

    if (!external_id) {
      return NextResponse.json(
        { success: false, error: 'external_id não fornecido' },
        { status: 400 }
      );
    }

    const url = process.env.DIGISAC_API_URL;
    const token = process.env.DIGISAC_API_TOKEN;

    if (!url || !token) {
      return NextResponse.json(
        { success: false, error: 'Credenciais Digisac não configuradas' },
        { status: 500 }
      );
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    console.log(`[DIGISAC STATUS] Buscando contato para external_id: ${external_id}...`);

    // 1. Buscar contato pelo external_id (pode ser número de telefone ou campo customizado)
    // Primeiro tentamos buscar como se fosse um número de telefone
    const contactQuery = {
      where: {
        number: external_id
      },
      page: 1,
      perPage: 1
    };

    let contactId: string | null = null;

    const contactResponse = await fetch(`${url}/contacts?query=${encodeURIComponent(JSON.stringify(contactQuery))}`, {
      headers,
      next: { revalidate: 300 } // Cache de 5 minutos
    });

    if (contactResponse.ok) {
      const contactData = await contactResponse.json();
      const contacts: DigisacContact[] = contactData.data || [];

      if (contacts.length > 0) {
        contactId = contacts[0].id;
        console.log(`[DIGISAC STATUS] ✓ Contato encontrado: ${contactId}`);
      } else {
        console.log(`[DIGISAC STATUS] ✗ Contato não encontrado para ${external_id}`);
      }
    } else {
      console.error(`[DIGISAC STATUS] Erro ao buscar contato: ${contactResponse.status}`);
    }

    // Se não encontrou contato, retornar "Sem contato"
    if (!contactId) {
      return NextResponse.json({
        success: true,
        status: 'sem_contato',
        label: 'Sem contato',
        color: '#64748b' // Cinza
      });
    }

    // 2. Buscar tickets do contato
    const ticketsQuery = {
      where: {
        contactId: contactId
      },
      attributes: ['id', 'isOpen', 'protocol', 'startedAt', 'endedAt', 'updatedAt'],
      order: [['startedAt', 'desc']],
      perPage: 20
    };

    console.log(`[DIGISAC STATUS] Buscando tickets para contactId: ${contactId}...`);

    const ticketsResponse = await fetch(`${url}/tickets?query=${encodeURIComponent(JSON.stringify(ticketsQuery))}`, {
      headers,
      next: { revalidate: 60 } // Cache de 1 minuto
    });

    if (!ticketsResponse.ok) {
      console.error(`[DIGISAC STATUS] Erro ao buscar tickets: ${ticketsResponse.status}`);
      return NextResponse.json(
        { success: false, error: 'Erro ao buscar tickets no Digisac' },
        { status: ticketsResponse.status }
      );
    }

    const ticketsData = await ticketsResponse.json();
    const tickets: DigisacTicket[] = ticketsData.data || [];

    console.log(`[DIGISAC STATUS] Encontrados ${tickets.length} tickets`);

    if (tickets.length === 0) {
      return NextResponse.json({
        success: true,
        status: 'sem_contato',
        label: 'Sem contato',
        color: '#64748b'
      });
    }

    // 3. Verificar se há ticket aberto
    const openTicket = tickets.find(t => t.isOpen);

    if (openTicket) {
      console.log(`[DIGISAC STATUS] ✓ Ticket aberto encontrado (ID: ${openTicket.id})`);
      return NextResponse.json({
        success: true,
        status: 'em_chamado',
        label: 'Em chamado',
        color: '#fbbf24', // Amarelo
        ticket: {
          id: openTicket.id,
          protocol: openTicket.protocol,
          startedAt: openTicket.startedAt
        }
      });
    }

    // 4. Se não tem ticket aberto, verificar tickets recentes (últimos 7 dias)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentTickets = tickets.filter(t => {
      const ticketDate = new Date(t.updatedAt || t.startedAt);
      return ticketDate >= sevenDaysAgo;
    });

    if (recentTickets.length > 0) {
      console.log(`[DIGISAC STATUS] ✓ ${recentTickets.length} tickets recentes encontrados`);
      return NextResponse.json({
        success: true,
        status: 'respondido',
        label: 'Respondido',
        color: '#78ffa3', // Verde
        lastTicket: recentTickets[0].updatedAt || recentTickets[0].startedAt
      });
    }

    // 5. Sem contato recente
    console.log(`[DIGISAC STATUS] ✗ Sem tickets nos últimos 7 dias`);
    return NextResponse.json({
      success: true,
      status: 'sem_contato',
      label: 'Sem contato',
      color: '#64748b'
    });

  } catch (error) {
    console.error('[DIGISAC STATUS] Erro:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar status de contato' },
      { status: 500 }
    );
  }
}
