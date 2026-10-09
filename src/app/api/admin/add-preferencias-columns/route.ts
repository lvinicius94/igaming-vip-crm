import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/add-preferencias-columns
 * Adiciona colunas de preferências na tabela nomes_usuarios
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[ADMIN] Adicionando colunas de preferências...');

    // Adicionar as 3 colunas
    await pool.query(`
      ALTER TABLE nomes_usuarios
      ADD COLUMN IF NOT EXISTS jogo TEXT,
      ADD COLUMN IF NOT EXISTS provedor TEXT,
      ADD COLUMN IF NOT EXISTS time TEXT
    `);

    console.log('[ADMIN] Colunas adicionadas com sucesso!');

    // Verificar estrutura da tabela
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'nomes_usuarios'
      ORDER BY ordinal_position
    `);

    return NextResponse.json({
      success: true,
      message: 'Colunas adicionadas com sucesso',
      columns: result.rows
    });

  } catch (error) {
    console.error('[ADMIN] Erro ao adicionar colunas:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Erro ao adicionar colunas',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  }
}
