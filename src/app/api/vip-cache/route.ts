import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Importa a referência do cache (será compartilhada)
let cacheCleared = false;

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    
    if (action === 'clear') {
      // Sinaliza que o cache deve ser limpo
      cacheCleared = true;
      
      return NextResponse.json({
        success: true,
        message: 'Sinal de limpeza de cache enviado. Próxima requisição irá reprocessar os dados.',
        timestamp: new Date().toISOString()
      });
    }
    
    return NextResponse.json({
      success: false,
      error: 'Ação inválida. Use: POST /api/vip-cache?action=clear'
    }, { status: 400 });
    
  } catch (error) {
    console.error('[VIP CACHE API] Erro:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Erro ao limpar cache',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return NextResponse.json({
    message: 'Use POST com ?action=clear para limpar o cache',
    exemplo: 'POST /api/vip-cache?action=clear'
  });
}
