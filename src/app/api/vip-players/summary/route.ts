import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Cache em memória com TTL de 2 horas
let summaryCache: Map<string, { data: any; timestamp: number }> = new Map();
const CACHE_TTL = 2 * 60 * 60 * 1000;

/**
 * Rota otimizada que retorna apenas resumo/estatísticas
 * Muito mais rápida que carregar todos os dados
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const endDate = searchParams.get('endDate') || new Date().toISOString().split('T')[0];
    const now = Date.now();
    
    // Verifica cache
    const cached = summaryCache.get(endDate);
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      console.log(`[SUMMARY CACHE] Retornando resumo do cache (${Math.floor((now - cached.timestamp) / 1000)}s)`);
      return NextResponse.json({
        success: true,
        ...cached.data,
        cached: true
      });
    }
    
    const startDate = '2025-04-01';
    console.log(`[VIP SUMMARY] Calculando resumo para ${endDate}...`);
    const perfStart = Date.now();
    
    // Query SUPER RÁPIDA - apenas agregações, sem dados individuais
    const query = `
      WITH depositos_vip AS (
        SELECT 
          external_id::text as external_id,
          COUNT(*) as qtd_depositos,
          SUM(valor) as deposito_total,
          SUM(valor) / COUNT(*) as ticket_medio
        FROM depositos_totais
        WHERE data_e_hora >= $1 AND data_e_hora <= $2
        GROUP BY external_id
        HAVING SUM(valor) / COUNT(*) >= 1000
      ),
      ggr_data AS (
        SELECT 
          g.external_id::text as external_id,
          SUM(g.valor) as ggr_total
        FROM ggr_total g
        WHERE g.external_id::text IN (SELECT external_id FROM depositos_vip)
          AND g.data_e_hora >= $1 
          AND g.data_e_hora <= $2
        GROUP BY g.external_id::text
      ),
      vip_active AS (
        SELECT COUNT(*) as total_vip
        FROM depositos_vip dv
        INNER JOIN ggr_data gd ON dv.external_id = gd.external_id
        INNER JOIN status_cliente sc ON dv.external_id::uuid = sc.external_id
        WHERE sc.status = 'ACTIVE'
      ),
      totals AS (
        SELECT 
          AVG(dv.ticket_medio) as ticket_medio_geral,
          AVG(gd.ggr_total) as ggr_medio_geral,
          SUM(gd.ggr_total) as ggr_total_carteira,
          SUM(dv.deposito_total) as deposito_total_carteira
        FROM depositos_vip dv
        INNER JOIN ggr_data gd ON dv.external_id = gd.external_id
        INNER JOIN status_cliente sc ON dv.external_id::uuid = sc.external_id
        WHERE sc.status = 'ACTIVE'
      )
      SELECT 
        (SELECT total_vip FROM vip_active) as total_jogadores,
        ticket_medio_geral,
        ggr_medio_geral,
        ggr_total_carteira,
        deposito_total_carteira
      FROM totals
    `;
    
    const result = await pool.query(query, [startDate, endDate]);
    const perfTime = ((Date.now() - perfStart) / 1000).toFixed(3);
    
    const summary = {
      total_jogadores: parseInt(result.rows[0]?.total_jogadores) || 0,
      ticket_medio_geral: parseFloat(result.rows[0]?.ticket_medio_geral) || 0,
      ggr_medio_geral: parseFloat(result.rows[0]?.ggr_medio_geral) || 0,
      ggr_total_carteira: parseFloat(result.rows[0]?.ggr_total_carteira) || 0,
      deposito_total_carteira: parseFloat(result.rows[0]?.deposito_total_carteira) || 0,
      periodo: { inicio: startDate, fim: endDate },
      performance: `${perfTime}s`
    };
    
    // Atualiza cache
    summaryCache.set(endDate, {
      data: summary,
      timestamp: Date.now()
    });
    
    console.log(`[VIP SUMMARY] Resumo calculado em ${perfTime}s: ${summary.total_jogadores} jogadores VIP`);
    
    return NextResponse.json({
      success: true,
      ...summary,
      cached: false
    });
    
  } catch (error) {
    console.error('[VIP SUMMARY] Erro:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Erro ao buscar resumo',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  }
}
