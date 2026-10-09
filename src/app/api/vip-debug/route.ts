import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    
    if (action === 'count-by-date') {
      // Verifica quantos jogadores VIP ativos existem pela nova regra
      const query = `
        WITH ggr_mensal AS (
          SELECT 
            external_id::text as external_id,
            DATE_TRUNC('month', data_e_hora) as mes,
            SUM(valor) as ggr_mes
          FROM ggr_total
          WHERE data_e_hora >= '2025-04-01' AND data_e_hora <= CURRENT_DATE
          GROUP BY external_id::text, DATE_TRUNC('month', data_e_hora)
          HAVING SUM(valor) > 0
        ),
        vips_ggr AS (
          SELECT 
            external_id,
            AVG(ggr_mes) as ggr_medio_mensal,
            COUNT(DISTINCT mes) as meses_ativos
          FROM ggr_mensal
          GROUP BY external_id
          HAVING AVG(ggr_mes) >= 1000
        )
        SELECT 
          COUNT(DISTINCT vg.external_id) as total_vips,
          COUNT(DISTINCT CASE WHEN sc.status = 'ACTIVE' THEN vg.external_id END) as vips_ativos,
          COUNT(DISTINCT CASE WHEN sc.status != 'ACTIVE' THEN vg.external_id END) as vips_inativos,
          ROUND(AVG(vg.ggr_medio_mensal), 2) as ggr_medio_geral,
          ROUND(AVG(vg.meses_ativos), 1) as media_meses_ativos
        FROM vips_ggr vg
        LEFT JOIN status_cliente sc ON vg.external_id::uuid = sc.external_id
      `;
      
      const result = await pool.query(query);
      
      return NextResponse.json({
        success: true,
        data: result.rows[0],
        message: 'Total de VIPs (GGR médio mensal >= 1000 desde Abril/2025)',
        detalhes: {
          total_vips: 'Jogadores com GGR médio mensal >= 1000',
          vips_ativos: 'VIPs com status ACTIVE',
          vips_inativos: 'VIPs com status diferente de ACTIVE',
          ggr_medio_geral: 'Média do GGR médio mensal de todos os VIPs',
          media_meses_ativos: 'Média de meses com atividade'
        }
      });
    }
    
    if (action === 'check-missing') {
      // Verifica quais jogadores VIP não aparecem na lista (status != ACTIVE)
      const query = `
        WITH ggr_mensal AS (
          SELECT 
            external_id::text as external_id,
            DATE_TRUNC('month', data_e_hora) as mes,
            SUM(valor) as ggr_mes
          FROM ggr_total
          WHERE data_e_hora >= '2025-04-01' AND data_e_hora <= CURRENT_DATE
          GROUP BY external_id::text, DATE_TRUNC('month', data_e_hora)
          HAVING SUM(valor) > 0
        ),
        vips_ggr AS (
          SELECT 
            external_id,
            AVG(ggr_mes) as ggr_medio_mensal,
            COUNT(DISTINCT mes) as meses_ativos
          FROM ggr_mensal
          GROUP BY external_id
          HAVING AVG(ggr_mes) >= 1000
        ),
        vips_com_status AS (
          SELECT 
            vg.external_id,
            vg.ggr_medio_mensal,
            vg.meses_ativos,
            sc.status,
            n.nome
          FROM vips_ggr vg
          LEFT JOIN status_cliente sc ON vg.external_id::uuid = sc.external_id
          LEFT JOIN nomes_usuarios n ON vg.external_id::uuid = n.external_id
        )
        SELECT 
          external_id,
          nome,
          ROUND(ggr_medio_mensal, 2) as ggr_medio_mensal,
          meses_ativos,
          status,
          CASE 
            WHEN status = 'ACTIVE' THEN 'Ativo - deveria aparecer'
            ELSE 'Inativo - removido da lista VIP'
          END as motivo
        FROM vips_com_status
        WHERE status != 'ACTIVE' OR status IS NULL
        ORDER BY ggr_medio_mensal DESC
        LIMIT 20
      `;
      
      const result = await pool.query(query);
      
      return NextResponse.json({
        success: true,
        data: result.rows,
        total: result.rows.length,
        message: 'Jogadores VIP que não aparecem na lista (status != ACTIVE)'
      });
    }
    
    return NextResponse.json({
      success: false,
      error: 'Ação inválida. Use: ?action=count-by-date ou ?action=check-missing'
    });
    
  } catch (error) {
    console.error('[VIP DEBUG API] Erro:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Erro ao executar debug',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  }
}
