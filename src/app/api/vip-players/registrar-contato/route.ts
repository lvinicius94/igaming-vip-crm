import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * API para registrar contato WhatsApp
 * Envia action para Smartico e registra na tabela bonus_dado_atendimento_vip
 * Actions por lista:
 * - CONTATO_WHATS_ATIVOS
 * - CONTATO_WHATS_INATIVOS
 * - CONTATO_WHATS_NOVOSVIPS
 * - CONTATO_WHATS_GOOGLE
 */
export async function POST(request: Request) {
  try {
    const { external_id, valor_disponivel, action } = await request.json();

    if (!external_id || !action) {
      return NextResponse.json(
        { success: false, error: 'external_id e action são obrigatórios' },
        { status: 400 }
      );
    }

    console.log(`[CONTATO WHATS] Registrando para usuário: ${external_id}`);
    console.log(`[CONTATO WHATS] Action: ${action}, Valor disponível: R$ ${valor_disponivel || 0}`);

    // 2. WHATS_SEM_FTD: 1x na vida — qualquer registro previo bloqueia.
    //    Outras actions: cooldown de 7 dias.
    const isSemFtd = action === 'WHATS_SEM_FTD';

    if (isSemFtd) {
      const previo = await pool.query(
        `SELECT data_e_hora
         FROM bonus_dado_atendimento_vip
         WHERE external_id = $1 AND action = 'WHATS_SEM_FTD'
         LIMIT 1`,
        [external_id]
      );
      if (previo.rows.length > 0) {
        const dataAnterior = new Date(previo.rows[0].data_e_hora).toLocaleDateString('pt-BR');
        return NextResponse.json(
          {
            success: false,
            error: `Usuário já recebeu WHATS_SEM_FTD em ${dataAnterior}. Essa mensagem é enviada apenas uma vez por usuário.`
          },
          { status: 400 }
        );
      }
    } else {
      const checkResult = await pool.query(
        `SELECT data_e_hora
         FROM bonus_dado_atendimento_vip
         WHERE external_id = $1
           AND COALESCE(valor_bonus, 0) = 0
           AND COALESCE(valor_experiencia, 0) = 0
           AND (action IS NULL OR action != 'WHATS_SEM_FTD')
         ORDER BY data_e_hora DESC
         LIMIT 1`,
        [external_id]
      );

      if (checkResult.rows.length > 0) {
        const ultimoRegistro = new Date(checkResult.rows[0].data_e_hora);
        const proximoPermitido = new Date(ultimoRegistro);
        proximoPermitido.setDate(proximoPermitido.getDate() + 7);
        const agora = new Date();
        if (agora < proximoPermitido) {
          const diasRestantes = Math.ceil((proximoPermitido.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24));
          return NextResponse.json(
            {
              success: false,
              error: `Contato já registrado. Disponível novamente em ${diasRestantes} dia(s)`
            },
            { status: 400 }
          );
        }
      }
    }

    // 3. Envia action para Smartico
    const eventTimestamp = Date.now();
    const smarticoBody = {
      eid: `${external_id}_whatscontact_${eventTimestamp}`,
      event_date: eventTimestamp,
      ext_brand_id: process.env.SMARTICO_BRAND_ID || 'sua-marca',
      user_ext_id: external_id,
      event_type: 'client_action',
      payload: {
        client_action: action
      }
    };

    console.log('[CONTATO WHATS] Enviando para Smartico:', JSON.stringify(smarticoBody, null, 2));

    const smarticoResponse = await fetch('https://apis3.smartico.ai/api/external/events/v2', {
      method: 'POST',
      headers: {
        Authorization: '19d4651b-1e9b-400b-8b0c-56fe6e37efa1',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(smarticoBody)
    });

    const smarticoText = await smarticoResponse.text();
    console.log('[CONTATO WHATS] Resposta Smartico:', smarticoResponse.status, smarticoText);

    if (!smarticoResponse.ok) {
      throw new Error(`Erro ao enviar para Smartico: ${smarticoResponse.status} - ${smarticoText}`);
    }

    // 4. Salvar registro no banco (horário de Brasília UTC-3) - valor 0 para contatos WhatsApp
    const insertQuery = `
      INSERT INTO bonus_dado_atendimento_vip (external_id, valor_bonus, valor_experiencia, data_e_hora, action)
      VALUES ($1, 0, 0, NOW() - INTERVAL '3 hours', $2)
      RETURNING data_e_hora
    `;
    const insertResult = await pool.query(insertQuery, [external_id, action]);
    const dataRegistro = insertResult.rows[0]?.data_e_hora || null;

    console.log(`[CONTATO WHATS] ✅ Registrado com sucesso para ${external_id} - Action: ${action}`);

    return NextResponse.json({
      success: true,
      message: 'Contato WhatsApp registrado com sucesso',
      external_id,
      action,
      timestamp: eventTimestamp,
      data_registro: dataRegistro
    });
  } catch (error) {
    console.error('[CONTATO WHATS] Erro:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao registrar contato WhatsApp',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  }
}
