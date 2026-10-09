import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const startDate = '2025-10-01';
    const endDate = new Date().toISOString().split('T')[0];
    
    // Query com EXPLAIN ANALYZE para diagnóstico
    const query = `
      EXPLAIN ANALYZE
      WITH monthly_ggr AS (
        SELECT 
          external_id::text as external_id,
          DATE_TRUNC('month', data_e_hora) as mes,
          SUM(valor) as ggr_mes,
          MAX(data_e_hora) as max_data_ggr
        FROM ggr_total
        WHERE data_e_hora >= $1 AND data_e_hora <= $2
        GROUP BY external_id::text, DATE_TRUNC('month', data_e_hora)
        HAVING SUM(valor) > 0
      ),
      user_ggr_stats AS (
        SELECT 
          external_id,
          AVG(ggr_mes) as ggr_medio_mensal,
          MAX(ggr_mes) as ggr_maximo_mensal,
          COUNT(DISTINCT mes) as meses_ativos,
          MAX(max_data_ggr) as ultima_atividade_ggr
        FROM monthly_ggr
        GROUP BY external_id
        HAVING AVG(ggr_mes) >= 500
      ),
      depositos_stats AS (
        SELECT 
          external_id::text as external_id,
          COUNT(*) as qtd_depositos,
          SUM(valor) / NULLIF(COUNT(*), 0) as ticket_medio_deposito,
          MAX(valor) as maior_deposito_individual,
          MAX(data_e_hora) as ultima_atividade_deposito
        FROM depositos_totais
        WHERE data_e_hora >= $1 AND data_e_hora <= $2
        GROUP BY external_id::text
      )
      SELECT 
        us.external_id,
        us.ggr_medio_mensal,
        us.ggr_maximo_mensal,
        us.meses_ativos,
        COALESCE(ds.qtd_depositos, 0) as qtd_depositos,
        COALESCE(ds.ticket_medio_deposito, 0) as ticket_medio,
        COALESCE(ds.maior_deposito_individual, 0) as ticket_maximo,
        GREATEST(us.ultima_atividade_ggr, COALESCE(ds.ultima_atividade_deposito, us.ultima_atividade_ggr)) as ultima_atividade,
        EXTRACT(DAY FROM (NOW() - GREATEST(us.ultima_atividade_ggr, COALESCE(ds.ultima_atividade_deposito, us.ultima_atividade_ggr)))) as dias_inativo
      FROM user_ggr_stats us
      LEFT JOIN depositos_stats ds ON us.external_id = ds.external_id
      ORDER BY us.ggr_medio_mensal DESC
    `;
    
    const result = await pool.query(query, [startDate, endDate]);
    
    return NextResponse.json({
      success: true,
      explain: result.rows
    });
    
  } catch (error) {
    console.error('[EXPLAIN API] Erro:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  }
}
