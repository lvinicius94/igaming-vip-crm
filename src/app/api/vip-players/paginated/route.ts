import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Cache por página
let pageCache: Map<string, { data: any[]; timestamp: number }> = new Map();
const CACHE_TTL = 2 * 60 * 60 * 1000;

/**
 * Rota PAGINADA - Carrega dados em lotes pequenos
 * Muito mais rápida que carregar 1128 registros de uma vez
 * 
 * Parâmetros:
 * - page: número da página (default: 1)
 * - pageSize: itens por página (default: 50)
 * - endDate: data final do período
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const endDate = searchParams.get('endDate') || new Date().toISOString().split('T')[0];
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');
    
    const cacheKey = `${endDate}-p${page}-s${pageSize}`;
    const now = Date.now();
    
    // Verifica cache
    const cached = pageCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      console.log(`[PAGE CACHE] Retornando página ${page} do cache`);
      return NextResponse.json({
        success: true,
        data: cached.data,
        page,
        pageSize,
        cached: true
      });
    }
    
    const startDate = '2025-04-01';
    const offset = (page - 1) * pageSize;
    
    console.log(`[VIP PAGINATED] Buscando página ${page} (${pageSize} items, offset ${offset})...`);
    const perfStart = Date.now();
    
    // Query paginada - MUITO mais rápida
    const query = `
      WITH depositos_vip AS (
        SELECT 
          external_id::text as external_id,
          COUNT(*) as qtd_depositos,
          SUM(valor) as deposito_total,
          SUM(valor) / COUNT(*) as ticket_medio,
          MAX(valor) as ticket_maximo,
          MAX(data_e_hora) as ultima_atividade_dep
        FROM depositos_totais
        WHERE data_e_hora >= $1 AND data_e_hora <= $2
        GROUP BY external_id
        HAVING SUM(valor) / COUNT(*) >= 1000
      ),
      ggr_data AS (
        SELECT 
          g.external_id::text as external_id,
          DATE_TRUNC('month', g.data_e_hora) as mes,
          SUM(g.valor) as ggr_mes,
          MAX(g.data_e_hora) as ultima_atividade_ggr
        FROM ggr_total g
        WHERE g.external_id::text IN (SELECT external_id FROM depositos_vip)
          AND g.data_e_hora >= $1 
          AND g.data_e_hora <= $2
        GROUP BY g.external_id::text, DATE_TRUNC('month', g.data_e_hora)
      ),
      ggr_agg AS (
        SELECT 
          external_id,
          AVG(ggr_mes) as ggr_medio,
          SUM(ggr_mes) as ggr_total_periodo,
          MAX(ggr_mes) as ggr_maximo,
          COUNT(DISTINCT mes) as meses_ativos,
          MAX(ultima_atividade_ggr) as ultima_ggr
        FROM ggr_data
        GROUP BY external_id
      )
      SELECT 
        dv.external_id as external_id,
        n.nome,
        ga.ggr_medio as ggr_medio_mensal,
        ga.ggr_total_periodo,
        ga.ggr_maximo as ggr_maximo_mensal,
        ga.meses_ativos,
        dv.qtd_depositos,
        dv.deposito_total as deposito_total_periodo,
        dv.ticket_medio,
        dv.ticket_maximo,
        GREATEST(ga.ultima_ggr, dv.ultima_atividade_dep) as ultima_atividade,
        EXTRACT(DAY FROM (CURRENT_TIMESTAMP - GREATEST(ga.ultima_ggr, dv.ultima_atividade_dep)))::integer as dias_inativo,
        CASE 
          WHEN cs.cadastro IS NOT NULL THEN 
            TO_TIMESTAMP(cs.cadastro, 'DD/MM/YYYY HH24:MI:SS')
          ELSE NULL
        END as data_cadastro,
        COALESCE((
          SELECT SUM(COALESCE(valor_bonus, 0) + COALESCE(valor_freespins, 0) + COALESCE(valor_smartico, 0))
          FROM recompensas_totais r 
          WHERE r.external_id::text = dv.external_id
        ), 0) as recompensas_usadas
      FROM depositos_vip dv
      INNER JOIN ggr_agg ga ON dv.external_id = ga.external_id
      INNER JOIN status_cliente sc ON dv.external_id::uuid = sc.external_id
      LEFT JOIN nomes_usuarios n ON dv.external_id::uuid = n.external_id
      LEFT JOIN cadastros_smartico cs ON dv.external_id = cs.external_id::text
      WHERE sc.status = 'ACTIVE'
      ORDER BY ga.ggr_medio DESC
      LIMIT $3 OFFSET $4
    `;
    
    const result = await pool.query(query, [startDate, endDate, pageSize, offset]);
    const perfTime = ((Date.now() - perfStart) / 1000).toFixed(3);
    
    const players = result.rows.map(row => ({
      external_id: row.external_id,
      nome: row.nome || null,
      ggr_total: parseFloat(row.ggr_medio_mensal),
      ggr_total_periodo: parseFloat(row.ggr_total_periodo),
      ggr_maximo: parseFloat(row.ggr_maximo_mensal),
      ticket_medio: parseFloat(row.ticket_medio),
      deposito_total_periodo: parseFloat(row.deposito_total_periodo),
      ticket_maximo: parseFloat(row.ticket_maximo),
      ultima_atividade: row.ultima_atividade,
      dias_inativo: parseInt(row.dias_inativo) || 0,
      data_cadastro: row.data_cadastro || null,
      meses_ativos: parseInt(row.meses_ativos) || 0,
      recompensas_usadas: parseFloat(row.recompensas_usadas) || 0
    }));
    
    // Atualiza cache
    pageCache.set(cacheKey, {
      data: players,
      timestamp: Date.now()
    });
    
    console.log(`[VIP PAGINATED] Página ${page} em ${perfTime}s: ${players.length} jogadores`);
    
    return NextResponse.json({
      success: true,
      data: players,
      page,
      pageSize,
      count: players.length,
      cached: false,
      performance: `${perfTime}s`
    });
    
  } catch (error) {
    console.error('[VIP PAGINATED] Erro:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Erro ao buscar dados paginados',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  }
}
