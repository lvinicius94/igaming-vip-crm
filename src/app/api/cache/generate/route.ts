import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import fs from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

// Query otimizada para dados históricos (até D-2)
export async function POST() {
  try {
    const today = new Date();
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    
    const startDate = '2025-10-01';
    const endDate = twoDaysAgo.toISOString().split('T')[0];
    
    console.log(`[CACHE] Gerando cache de ${startDate} até ${endDate}`);
    
    const query = `
      WITH monthly_ggr AS (
        SELECT 
          external_id::text as external_id,
          DATE_TRUNC('month', data_e_hora) as mes,
          SUM(valor) as ggr_mes
        FROM ggr_total
        WHERE data_e_hora >= $1 
          AND data_e_hora <= $2
        GROUP BY external_id::text, DATE_TRUNC('month', data_e_hora)
        HAVING SUM(valor) > 0
      ),
      user_stats AS (
        SELECT 
          external_id,
          AVG(ggr_mes) as ggr_medio_mensal,
          MAX(ggr_mes) as ggr_maximo_mensal,
          COUNT(DISTINCT mes) as meses_ativos,
          SUM(ggr_mes) as ggr_total_periodo
        FROM monthly_ggr
        GROUP BY external_id
        HAVING AVG(ggr_mes) >= 500
      ),
      depositos_stats AS (
        SELECT 
          external_id::text as external_id,
          COUNT(*) as qtd_depositos,
          SUM(valor) / NULLIF(COUNT(*), 0) as ticket_medio_deposito,
          MAX(valor) as maior_deposito_individual
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
        COALESCE(ds.maior_deposito_individual, 0) as ticket_maximo
      FROM user_stats us
      LEFT JOIN depositos_stats ds ON us.external_id = ds.external_id
      ORDER BY us.ggr_medio_mensal DESC
    `;
    
    const result = await pool.query(query, [startDate, endDate]);
    
    const cacheData = {
      generatedAt: new Date().toISOString(),
      startDate,
      endDate,
      users: result.rows
    };
    
    // Salvar em arquivo JSON
    const cacheDir = path.join(process.cwd(), '.cache');
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      path.join(cacheDir, 'vip-players-cache.json'),
      JSON.stringify(cacheData, null, 2)
    );
    
    console.log(`[CACHE] Cache gerado com ${result.rows.length} usuários`);
    
    return NextResponse.json({
      success: true,
      message: 'Cache gerado com sucesso',
      users: result.rows.length,
      period: { start: startDate, end: endDate }
    });
    
  } catch (error) {
    console.error('[CACHE] Erro:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 }
    );
  }
}
