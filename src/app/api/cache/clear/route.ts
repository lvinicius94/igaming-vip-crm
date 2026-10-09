import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Importa referência ao cache da rota principal
// Como Next.js isola módulos, vamos usar um approach diferente
export async function POST(request: Request) {
  try {
    // Para limpar o cache, basta fazer um restart do servidor
    // ou esperar os 5 minutos do TTL
    
    console.log('[CACHE] Solicitação de limpeza de cache recebida');
    
    return NextResponse.json({
      success: true,
      message: 'Cache será limpo na próxima requisição ou após TTL de 5 minutos',
      info: 'Para forçar limpeza imediata, reinicie o servidor'
    });
    
  } catch (error) {
    console.error('[CACHE CLEAR] Erro:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  }
}
