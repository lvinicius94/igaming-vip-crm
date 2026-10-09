import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    // Validação de autenticação
    const cookieStore = await cookies();
    const session = cookieStore.get('vip_session');
    
    if (!session) {
      return NextResponse.json({ 
        success: false, 
        error: 'Não autorizado' 
      }, { status: 401 });
    }

    const { external_id, player_name } = await request.json();
    
    if (!external_id) {
      return NextResponse.json({ 
        success: false, 
        error: 'external_id é obrigatório' 
      }, { status: 400 });
    }

    console.log(`[DIGISAC] Preparando atendimento: ${player_name || external_id}`);
    
    return NextResponse.json({ 
      success: true,
      chat_url: 'https://app.digisac.example',
      player_name: player_name,
      external_id: external_id
    });

  } catch (error) {
    console.error('[DIGISAC] Erro:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Erro desconhecido' 
    }, { status: 500 });
  }
}
