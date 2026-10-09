import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { external_ids } = await req.json();
    
    if (!Array.isArray(external_ids) || external_ids.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'external_ids deve ser um array não vazio' 
      });
    }
    
    console.log(`[SAVE DIGISAC] Rota desabilitada para preservar conexao='google' (${external_ids.length} IDs recebidos)`);
    
    return NextResponse.json({ 
      success: true,
      updated: 0,
      message: 'Rota desabilitada: não grava mais em nomes_usuarios'
    });
    
  } catch (error: any) {
    console.error('[SAVE DIGISAC] Erro:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
