import { NextResponse } from 'next/server';

/**
 * GET /api/digisac/tickets-info
 * 
 * Retorna informações detalhadas dos tickets abertos para debug
 */
export async function GET() {
  try {
    const url = process.env.DIGISAC_API_URL;
    const token = process.env.DIGISAC_API_TOKEN;

    if (!url || !token) {
      return NextResponse.json({
        success: false,
        error: 'Credenciais não configuradas'
      }, { status: 500 });
    }

    // Buscar departamentos
    const deptResponse = await fetch(`${url}/departments`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!deptResponse.ok) {
      return NextResponse.json({
        success: false,
        error: 'Erro ao buscar departamentos'
      }, { status: 500 });
    }

    const deptData = await deptResponse.json();
    const departments = deptData.data || [];
    
    const vipDept = departments.find((d: any) => 
      d.name.toLowerCase() === 'atendimento vip'
    ) || departments.find((d: any) => 
      d.name.toLowerCase().includes('grupos upvip') ||
      d.name.toLowerCase().includes('vip')
    );

    if (!vipDept) {
      return NextResponse.json({
        success: false,
        error: 'Departamento VIP não encontrado'
      });
    }

    // Buscar tickets abertos
    const query = {
      where: {
        isOpen: true,
        departmentId: vipDept.id
      },
      order: [["updatedAt", "DESC"]],
      page: 1,
      perPage: 100
    };

    const queryString = encodeURIComponent(JSON.stringify(query));
    const ticketsUrl = `${url}/tickets?query=${queryString}`;

    const ticketsResponse = await fetch(ticketsUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!ticketsResponse.ok) {
      return NextResponse.json({
        success: false,
        error: 'Erro ao buscar tickets'
      }, { status: 500 });
    }

    const ticketsData = await ticketsResponse.json();
    const tickets = ticketsData.data || [];

    // Buscar informações de cada contato
    const ticketsInfo = [];

    for (const ticket of tickets) {
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

          ticketsInfo.push({
            ticketId: ticket.id,
            protocol: ticket.protocol,
            contactId: ticket.contactId,
            contactName: contact?.name || null,
            contactNumber: contact?.number || null,
            contactId_digisac: contact?.id || null,
            updatedAt: ticket.updatedAt
          });
        }
      } catch (err) {
        console.error('Erro ao buscar contato:', err);
      }
    }

    return NextResponse.json({
      success: true,
      department: vipDept.name,
      totalTickets: tickets.length,
      tickets: ticketsInfo
    });

  } catch (error) {
    console.error('[TICKETS INFO] Erro:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    }, { status: 500 });
  }
}
