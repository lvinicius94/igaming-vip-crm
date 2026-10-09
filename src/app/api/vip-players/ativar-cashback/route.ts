import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * API para ativar cashback VIP
 * Envia action para Smartico e atualiza banco de dados
 */
export async function POST(request: Request) {
  try {
    const { external_id } = await request.json();
    
    if (!external_id) {
      return NextResponse.json(
        { success: false, error: 'external_id é obrigatório' },
        { status: 400 }
      );
    }
    
    console.log(`[CASHBACK VIP] Ativando para usuário: ${external_id}`);
    
    // 1. Verifica se já foi ativado na tabela solicitacoes_cashback
    const checkSolicitacaoQuery = `
      SELECT 1 FROM solicitacoes_cashback WHERE external_id = $1
    `;
    const existingSolicitacao = await pool.query(checkSolicitacaoQuery, [external_id]);
    
    if (existingSolicitacao.rows.length > 0) {
      return NextResponse.json(
        { success: false, error: 'Cashback VIP já foi ativado anteriormente' },
        { status: 400 }
      );
    }
    
    // 2. Envia action para Smartico
    const eventTimestamp = Date.now();
    const smarticoBody = {
      eid: `${external_id}_${eventTimestamp}`,
      event_date: eventTimestamp,
      ext_brand_id: process.env.SMARTICO_BRAND_ID || "sua-marca",
      user_ext_id: external_id,
      event_type: "client_action",
      payload: {
        client_action: "CASHBACK_VIP"
      }
    };
    
    console.log('[CASHBACK VIP] Enviando para Smartico:', JSON.stringify(smarticoBody, null, 2));
    
    const smarticoResponse = await fetch('https://apis3.smartico.ai/api/external/events/v2', {
      method: 'POST',
      headers: {
        'Authorization': '19d4651b-1e9b-400b-8b0c-56fe6e37efa1',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(smarticoBody)
    });
    
    const smarticoText = await smarticoResponse.text();
    console.log('[CASHBACK VIP] Resposta Smartico:', smarticoResponse.status, smarticoText);
    
    if (!smarticoResponse.ok) {
      throw new Error(`Erro ao enviar para Smartico: ${smarticoResponse.status} - ${smarticoText}`);
    }
    
    // 3. Registra solicitação na tabela solicitacoes_cashback
    const insertSolicitacaoQuery = `
      INSERT INTO solicitacoes_cashback (external_id, data_solicitacao)
      VALUES ($1, NOW() - INTERVAL '3 hours')
    `;
    await pool.query(insertSolicitacaoQuery, [external_id]);
    
    console.log(`[CASHBACK VIP] ✅ Ativado com sucesso para ${external_id}`);
    
    return NextResponse.json({
      success: true,
      message: 'Cashback VIP ativado com sucesso',
      external_id,
      timestamp: eventTimestamp
    });
    
  } catch (error) {
    console.error('[CASHBACK VIP] Erro:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Erro ao ativar cashback VIP',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  }
}
