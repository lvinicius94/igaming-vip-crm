import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // ============================================================
    // Lê de lista_vip WHERE origem = 'plataforma'
    // Entrada: Definida pelo cron sync-daily (sincronizarPlataforma)
    // Permanência: NUNCA sai da lista
    // ============================================================
    const result = await pool.query(`
      WITH plataforma_users AS (
        SELECT external_id::text AS external_id, nome
        FROM lista_vip
        WHERE origem = 'plataforma'
      ),
      ggr_todos AS (
        SELECT
          g.external_id::text AS external_id,
          SUM(g.valor)        AS total_ggr,
          MAX(g.valor)        AS ggr_maximo,
          COUNT(DISTINCT DATE_TRUNC('month', g.data_e_hora)) AS meses_ativos,
          MAX(g.data_e_hora)  AS ultima_atividade_ggr
        FROM ggr_total g
        WHERE g.external_id::text IN (SELECT external_id FROM plataforma_users)
        GROUP BY g.external_id::text
      ),
      depositos_todos AS (
        SELECT
          d.external_id::text AS external_id,
          SUM(d.valor)        AS deposito_total,
          COALESCE(SUM(d.valor) / NULLIF(COUNT(*), 0), 0) AS ticket_medio,
          COALESCE(MAX(d.valor), 0) AS ticket_maximo,
          MAX(d.data_e_hora)  AS ultima_atividade_dep
        FROM depositos_totais d
        WHERE d.external_id::text IN (SELECT external_id FROM plataforma_users)
        GROUP BY d.external_id::text
      ),
      data_cadastro_info AS (
        SELECT
          c.external_id::text AS external_id,
          MIN(c.registration_date) AS data_cadastro
        FROM cadastros_smartico c
        WHERE c.external_id::text IN (SELECT external_id FROM plataforma_users)
        GROUP BY c.external_id::text
      ),
      sem_ftd_info AS (
        SELECT DISTINCT ON (b.external_id)
          b.external_id::text AS external_id,
          b.data_e_hora AS sem_ftd_data
        FROM bonus_dado_atendimento_vip b
        WHERE b.external_id::text IN (SELECT external_id FROM plataforma_users)
          AND b.action = 'WHATS_SEM_FTD'
        ORDER BY b.external_id, b.data_e_hora DESC
      ),
      contato_info AS (
        SELECT DISTINCT ON (b.external_id)
          b.external_id::text AS external_id,
          b.data_e_hora AS bonus_vip_data
        FROM bonus_dado_atendimento_vip b
        WHERE b.external_id::text IN (SELECT external_id FROM plataforma_users)
          AND COALESCE(b.valor_bonus, 0) = 0
          AND COALESCE(b.valor_experiencia, 0) = 0
          AND (b.action IS NULL OR b.action != 'WHATS_SEM_FTD')
        ORDER BY b.external_id, b.data_e_hora DESC
      )
      SELECT
        pu.external_id,
        COALESCE(pu.nome, 'DESCONHECIDO') AS nome,
        'plataforma'::text AS origem,
        COALESCE(gt.total_ggr, 0)      AS ggr_total,
        COALESCE(gt.total_ggr, 0)      AS ggr_total_periodo,
        COALESCE(gt.ggr_maximo, 0)     AS ggr_maximo,
        COALESCE(dt.ticket_medio, 0)   AS ticket_medio,
        COALESCE(dt.deposito_total, 0) AS deposito_total_periodo,
        COALESCE(dt.ticket_maximo, 0)  AS ticket_maximo,
        COALESCE(
          gt.ultima_atividade_ggr,
          dt.ultima_atividade_dep,
          ci.data_cadastro::timestamp,
          NOW()
        ) AS ultima_atividade,
        EXTRACT(DAY FROM (
          NOW() - COALESCE(
            gt.ultima_atividade_ggr,
            dt.ultima_atividade_dep,
            ci.data_cadastro::timestamp,
            NOW()
          )
        ))::integer AS dias_inativo,
        COALESCE(gt.meses_ativos, 0)::integer AS meses_ativos,
        ci.data_cadastro,
        dt.ultima_atividade_dep AS data_primeiro_deposito,
        NULL::date   AS data_aniversario,
        0::numeric   AS recompensas_usadas,
        false        AS cashback_vip_ativado,
        NULL::timestamp AS data_ativacao,
        CASE WHEN ct.bonus_vip_data IS NOT NULL AND ct.bonus_vip_data > NOW() - INTERVAL '7 days' THEN true ELSE false END AS bonus_vip_ativado,
        ct.bonus_vip_data,
        false        AS experiencia_vip_ativado,
        NULL::timestamp AS experiencia_vip_data,
        false        AS saque_vip_ativado,
        NULL::timestamp AS saque_vip_data,
        CASE WHEN sf.sem_ftd_data IS NOT NULL AND sf.sem_ftd_data > NOW() - INTERVAL '7 days' THEN true ELSE false END AS sem_ftd_ativado,
        sf.sem_ftd_data,
        'plataforma'::text AS conexao
      FROM plataforma_users pu
      LEFT JOIN ggr_todos gt         ON pu.external_id = gt.external_id
      LEFT JOIN depositos_todos dt   ON pu.external_id = dt.external_id
      LEFT JOIN data_cadastro_info ci ON pu.external_id = ci.external_id
      LEFT JOIN sem_ftd_info sf      ON pu.external_id = sf.external_id
      LEFT JOIN contato_info ct      ON pu.external_id = ct.external_id
      ORDER BY COALESCE(gt.total_ggr, 0) DESC, ci.data_cadastro DESC
    `);

    return NextResponse.json({
      success: true,
      data: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('[PLATAFORMA TAB] Erro ao buscar cadastros Plataforma:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro ao buscar dados Plataforma' },
      { status: 500 }
    );
  }
}
