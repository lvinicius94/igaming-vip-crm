import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

interface VipPlayer {
  external_id: string;
  ggr_total: number;
  ggr_maximo: number;
  ticket_medio: number;
  ticket_maximo: number;
  ultima_atividade: string;
  dias_inativo: number;
  meses_ativos: number;
}

export async function GET(request: Request) {
  try {
    const startDate = '2025-10-01';
    const endDate = new Date().toISOString().split('T')[0];
    
    console.log(`[VIP PLAYERS API OPTIMIZED] Buscando dados de ${startDate} até ${endDate}`);
    
    // Query otimizada - uma única passada, menos subqueries
    const query = `
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
    
    const players: VipPlayer[] = result.rows.map(row => ({
      external_id: row.external_id,
      ggr_total: parseFloat(row.ggr_medio_mensal),
      ggr_maximo: parseFloat(row.ggr_maximo_mensal),
      ticket_medio: parseFloat(row.ticket_medio),
      ticket_maximo: parseFloat(row.ticket_maximo),
      ultima_atividade: row.ultima_atividade,
      dias_inativo: parseInt(row.dias_inativo) || 0,
      meses_ativos: parseInt(row.meses_ativos) || 0
    }));
    
    console.log(`[VIP PLAYERS API OPTIMIZED] Encontrados ${players.length} jogadores VIP`);
    
    return NextResponse.json({
      success: true,
      data: players,
      total: players.length,
      periodo: { inicio: startDate, fim: endDate, descricao: `Out/2025 até ${endDate}` }
    });
    
  } catch (error) {
    console.error('[VIP PLAYERS API] Erro:', error);
    console.error('[VIP PLAYERS API] Stack:', error instanceof Error ? error.stack : 'N/A');
    return NextResponse.json(
      { 
        success: false, 
        error: 'Erro ao buscar dados dos jogadores VIP',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
        stack: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
