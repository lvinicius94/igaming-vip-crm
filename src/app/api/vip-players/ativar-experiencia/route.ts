import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * API para ativar experiência VIP
 * Envia action para Smartico e registra na tabela bonus_dado_atendimento_vip
 */
export async function POST(request: Request) {
  try {
    const { external_id, valor_disponivel } = await request.json();
    
    if (!external_id || valor_disponivel === undefined) {
      return NextResponse.json(
        { success: false, error: 'external_id e valor_disponivel são obrigatórios' },
        { status: 400 }
      );
    }
    
    console.log(`[EXPERIENCIA VIP] Ativando para usuário: ${external_id}, valor disponível: R$ ${valor_disponivel}`);
    
    // 1. Calcular valor da experiência: 50% do disponível (mínimo R$ 500, máximo R$ 1.000)
    const valorExperiencia = Math.min(1000, Math.max(500, Math.floor(valor_disponivel * 0.5 * 100) / 100));
    
    console.log(`[EXPERIENCIA VIP] Valor calculado (50%, mín R$ 500, máx R$ 1.000): R$ ${valorExperiencia}`);
    
    // Validar valor mínimo truncado (precisa ter >= 1000 disponível para 50% = 500)
    const disponivelTruncado = Math.floor(valor_disponivel);
    if (disponivelTruncado < 1000) {
      return NextResponse.json(
        { success: false, error: 'Valor disponível deve ser no mínimo R$ 1.000,00 (truncado) para gerar R$ 500,00 de experiência' },
        { status: 400 }
      );
    }
    
    // 2. Verificar se já ativou este mês
    const checkQuery = `
      SELECT data_e_hora 
      FROM bonus_dado_atendimento_vip 
      WHERE external_id = $1
        AND valor_experiencia > 0
        AND EXTRACT(YEAR FROM data_e_hora) = EXTRACT(YEAR FROM CURRENT_DATE)
        AND EXTRACT(MONTH FROM data_e_hora) = EXTRACT(MONTH FROM CURRENT_DATE)
      ORDER BY data_e_hora DESC
      LIMIT 1
    `;
    const checkResult = await pool.query(checkQuery, [external_id]);
    
    if (checkResult.rows.length > 0) {
      const ultimaAtivacao = new Date(checkResult.rows[0].data_e_hora);
      const mesAtivacao = ultimaAtivacao.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      
      return NextResponse.json(
        { 
          success: false, 
          error: `Experiência já ativada em ${mesAtivacao}. Disponível novamente no próximo mês.` 
        },
        { status: 400 }
      );
    }
    
    // 3. Envia action para Smartico
    const eventTimestamp = Date.now();
    const smarticoBody = {
      eid: `${external_id}_experiencia_${eventTimestamp}`,
      event_date: eventTimestamp,
      ext_brand_id: process.env.SMARTICO_BRAND_ID || "sua-marca",
      user_ext_id: external_id,
      event_type: "client_action",
      payload: {
        client_action: "EXPERIENCIA_VIP",
        core_custom_prop_num1: valorExperiencia
      }
    };
    
    console.log('[EXPERIENCIA VIP] Enviando para Smartico:', JSON.stringify(smarticoBody, null, 2));
    
    const smarticoResponse = await fetch('https://apis3.smartico.ai/api/external/events/v2', {
      method: 'POST',
      headers: {
        'Authorization': '19d4651b-1e9b-400b-8b0c-56fe6e37efa1',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(smarticoBody)
    });
    
    const smarticoText = await smarticoResponse.text();
    console.log('[EXPERIENCIA VIP] Resposta Smartico:', smarticoResponse.status, smarticoText);
    
    if (!smarticoResponse.ok) {
      throw new Error(`Erro ao enviar para Smartico: ${smarticoResponse.status} - ${smarticoText}`);
    }
    
    // 4. Salvar registro no banco (horário de Brasília UTC-3)
    const insertQuery = `
      INSERT INTO bonus_dado_atendimento_vip (external_id, valor_bonus, valor_experiencia, data_e_hora)
      VALUES ($1, 0, $2, NOW() - INTERVAL '3 hours')
    `;
    await pool.query(insertQuery, [external_id, valorExperiencia]);
    
    console.log(`[EXPERIENCIA VIP] ✅ Ativado com sucesso para ${external_id} - R$ ${valorExperiencia}`);
    
    return NextResponse.json({
      success: true,
      message: 'Experiência VIP ativada com sucesso',
      external_id,
      valor_experiencia: valorExperiencia,
      timestamp: eventTimestamp
    });
    
  } catch (error) {
    console.error('[EXPERIENCIA VIP] Erro:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Erro ao ativar experiência VIP',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  }
}
