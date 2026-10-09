import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Migração única: marca usuários Google elegíveis em nomes_usuarios com conexao = 'google'
 * Chamar UMA VEZ: GET /api/admin/criar-tabela-google
 */
export async function GET() {
  try {
    // Upsert em nomes_usuarios com conexao = 'google' para elegíveis de março
    // Não sobrescreve conexao = 'digisac' se já existir
    const insertResult = await pool.query(`
      WITH google_cadastros AS (
        SELECT DISTINCT c.external_id::text AS external_id
        FROM cadastros_smartico c
        WHERE c.registration_date >= '2026-03-01'
          AND c.registration_date < '2026-04-01'
          AND EXISTS (
            SELECT 1 FROM acessos_diarios a
            WHERE a.external_id::text = c.external_id::text
              AND a.clickid ILIKE '%gads%'
          )
      ),
      depositos_marco AS (
        SELECT d.external_id::text AS external_id, SUM(d.valor) AS total
        FROM depositos_totais d
        WHERE d.data_e_hora >= '2026-03-01' AND d.data_e_hora < '2026-04-01'
        GROUP BY d.external_id::text
      ),
      elegíveis AS (
        SELECT gc.external_id
        FROM google_cadastros gc
        LEFT JOIN depositos_marco dm ON gc.external_id = dm.external_id
        WHERE COALESCE(dm.total, 0) = 0
      )
      INSERT INTO nomes_usuarios (external_id, nome, conexao, atualizado_em)
      SELECT
        e.external_id::uuid,
        COALESCE(nu.nome, 'DESCONHECIDO'),
        'google',
        CURRENT_TIMESTAMP
      FROM elegíveis e
      LEFT JOIN nomes_usuarios nu ON nu.external_id::text = e.external_id
      ON CONFLICT (external_id) DO UPDATE SET
        conexao = CASE
          WHEN nomes_usuarios.conexao IS NULL OR nomes_usuarios.conexao = ''
            THEN 'google'
          ELSE nomes_usuarios.conexao
        END,
        nome = CASE
          WHEN nomes_usuarios.nome IS NULL OR nomes_usuarios.nome = '' OR nomes_usuarios.nome = 'DESCONHECIDO'
            THEN EXCLUDED.nome
          ELSE nomes_usuarios.nome
        END,
        atualizado_em = CURRENT_TIMESTAMP
      RETURNING external_id
    `);

    return NextResponse.json({
      success: true,
      message: `${insertResult.rows.length} usuários Google marcados em nomes_usuarios (conexao=\'google\')`,
      inseridos: insertResult.rows.length
    });
  } catch (error) {
    console.error('[GOOGLE MIGRATION] Erro:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 }
    );
  }
}
