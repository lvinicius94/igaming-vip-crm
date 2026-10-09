import { NextRequest, NextResponse } from 'next/server';
import { BigQuery } from '@google-cloud/bigquery';
import { getMapeamentos } from '@/lib/cache-mapeamentos';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * 🕐 CRON JOB - Atualizar Cache de Mapeamentos
 * 
 * Execução: Diário às 2 AM UTC
 * 
 * Funcionalidade:
 * 1. Busca mapeamentos do BigQuery
 * 2. Atualiza cache PostgreSQL
 * 3. Atualiza cache em memória
 * 
 * Uso BigQuery: 3 queries/dia = ~15-60 MB/dia
 * Economia: 4.650 queries → 31 queries/mês
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  // ✅ SEGURANÇA: Verificar token
  const authHeader = request.headers.get('authorization');
  const expectedToken = `Bearer ${process.env.CRON_SECRET}`;
  
  if (authHeader !== expectedToken) {
    console.error('[CRON CACHE] ❌ Acesso não autorizado');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  console.log('[CRON CACHE] 🚀 Atualizando cache de mapeamentos...');
  
  try {
    // Inicializar cliente BigQuery
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const projectId = process.env.GOOGLE_PROJECT_ID;
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const labelId = process.env.SMARTICO_LABEL_ID;
    
    if (!privateKey || !projectId || !clientEmail || !labelId) {
      throw new Error('Credenciais não configuradas');
    }
    
    const client = new BigQuery({
      projectId,
      credentials: {
        client_email: clientEmail,
        private_key: privateKey
      }
    });
    
    // Atualizar cache (força refresh do BigQuery)
    const mapeamentos = await getMapeamentos(client, labelId, true);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('[CRON CACHE] ✅ Cache atualizado com sucesso');
    
    return NextResponse.json({
      success: true,
      message: 'Cache atualizado',
      stats: {
        jogos: mapeamentos.gamesMap.size,
        provedores: mapeamentos.providersMap.size,
        tipos: mapeamentos.typesMap.size,
        duration_seconds: parseFloat(duration)
      }
    });
    
  } catch (error: any) {
    console.error('[CRON CACHE] ❌ Erro:', error);
    
    return NextResponse.json({
      success: false,
      error: error.message,
      duration_seconds: ((Date.now() - startTime) / 1000).toFixed(2)
    }, { status: 500 });
  }
}
