import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('user_id');
    
    if (!userId) {
      return NextResponse.json({ 
        success: false, 
        error: 'user_id é obrigatório' 
      }, { status: 400 });
    }
    
    console.log('🔍 Verificando usuário:', userId);
    
    // 1. Verificar na tabela nomes_usuarios
    const userResult = await pool.query(`
      SELECT external_id, nome, conexao, atualizado_em
      FROM nomes_usuarios
      WHERE external_id = $1
    `, [userId]);
    
    // 2. Verificar na tabela lista_vip
    const vipResult = await pool.query(`
      SELECT external_id, nome, ggr_total, nivel
      FROM lista_vip
      WHERE external_id = $1
    `, [userId]);
    
    // 3. Verificar no cadastros_smartico
    const smarticoResult = await pool.query(`
      SELECT external_id, nome, cadastro, status_vip
      FROM cadastros_smartico
      WHERE external_id = $1
    `, [userId]);
    
    return NextResponse.json({
      success: true,
      user_id: userId,
      nomes_usuarios: userResult.rows[0] || null,
      lista_vip: vipResult.rows[0] || null,
      cadastros_smartico: smarticoResult.rows[0] || null
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao verificar usuário:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
