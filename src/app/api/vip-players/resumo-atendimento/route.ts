import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.PGHOST!,
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE!,
  user: process.env.PGUSER!,
  password: process.env.PGPASSWORD!,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export async function POST(request: NextRequest) {
  let client;
  
  try {
    const { external_id, descricao, usuario } = await request.json();
    
    // Validações
    if (!external_id || typeof external_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'external_id é obrigatório' },
        { status: 400 }
      );
    }
    
    if (!descricao || typeof descricao !== 'string' || descricao.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Descrição é obrigatória' },
        { status: 400 }
      );
    }
    
    if (descricao.length > 500) {
      return NextResponse.json(
        { success: false, error: 'Descrição muito longa (máximo 500 caracteres)' },
        { status: 400 }
      );
    }
    
    if (!usuario || typeof usuario !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Usuário é obrigatório' },
        { status: 400 }
      );
    }
    
    console.log(`[RESUMO ATENDIMENTO] Salvando resumo para ${external_id} por ${usuario}`);
    
    // Conectar ao banco
    client = await pool.connect();
    
    // Inserir resumo
    const query = `
      INSERT INTO resumo_atendimento_vip (external_id, descricao, usuario, created_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING id, created_at
    `;
    
    const result = await client.query(query, [external_id, descricao.trim(), usuario]);
    const inserted = result.rows[0];
    
    console.log(`[RESUMO ATENDIMENTO] ✅ Resumo salvo: ID ${inserted.id}`);
    
    return NextResponse.json({
      success: true,
      data: {
        id: inserted.id,
        created_at: inserted.created_at,
        external_id,
        descricao: descricao.trim(),
        usuario
      }
    });
    
  } catch (error) {
    console.error('[RESUMO ATENDIMENTO] Erro:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erro ao salvar resumo' 
      },
      { status: 500 }
    );
    
  } finally {
    if (client) {
      client.release();
    }
  }
}
