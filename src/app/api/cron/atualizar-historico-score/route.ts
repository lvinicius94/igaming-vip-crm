import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Funções de cálculo de scores (IDÊNTICAS ao dashboard page.tsx)
function calcularScoreGGR(ggrAtual: number, ggrMaximo: number, ticketMedio: number): number {
  // Se GGR for 0 ou negativo, a meta é 22% do ticket médio
  const ggrIdeal = ggrAtual <= 0 
    ? ticketMedio * 0.22 
    : ggrMaximo * 1.1;
  
  // Evita divisão por zero
  if (ggrIdeal === 0) return 0;
  
  const score = (ggrAtual / ggrIdeal) * 100;
  return Math.min(Math.max(Math.round(score), 0), 100);
}

function calcularScoreTicket(ticketAtual: number, ticketMaximo: number): number {
  if (ticketMaximo === 0) return 0;
  const ticketIdeal = ticketMaximo * 1.1;
  const score = (ticketAtual / ticketIdeal) * 100;
  return Math.min(Math.round(score), 100);
}

function calcularScoreAtividade(diasInativo: number): number {
  const maxDias = 28; // Últimos 28 dias
  if (diasInativo >= maxDias) return 0;
  const score = 100 - (diasInativo / maxDias) * 100;
  return Math.max(Math.round(score), 0);
}

/**
 * 🕐 CRON JOB - Atualiza histórico de scores (roda a cada 6 horas)
 * 
 * Calcula médias diárias de scores dos VIP players e armazena em historico_score
 * para exibição rápida nos gráficos do dashboard (evita 60 requests por load)
 */
export async function GET(request: NextRequest) {
  // ✅ SEGURANÇA: Verificar se é chamada do Vercel Cron
  const authHeader = request.headers.get('authorization');
  const expectedToken = `Bearer ${process.env.CRON_SECRET}`;
  
  if (authHeader !== expectedToken) {
    console.error('[CRON HISTORICO] ❌ Acesso não autorizado');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let client;
  try {
    console.log('[CRON HISTORICO] 🚀 Iniciando atualização do histórico de scores...');
    
    const today = new Date().toISOString().split('T')[0];
    console.log(`[CRON HISTORICO] 📡 Calculando scores de ${today}...`);
    
    client = await pool.connect();
    
    // ✅ Buscar VIPs ativos com dados calculados diretamente do banco
    // Mesma lógica que /api/vip-players mas simplificada
    const query = `
      WITH ggr_mensal AS (
        SELECT 
          g.external_id::text as external_id,
          DATE_TRUNC('month', g.data_e_hora) as mes,
          SUM(g.valor) as ggr_mes,
          MAX(g.data_e_hora) as ultima_ggr
        FROM ggr_total g
        INNER JOIN jogadores_vip_historico vh ON g.external_id::text = vh.external_id::text
        WHERE g.data_e_hora >= '2025-04-01' AND g.data_e_hora <= $1::date
        GROUP BY g.external_id::text, DATE_TRUNC('month', g.data_e_hora)
        HAVING SUM(g.valor) > 0
      ),
      ggr_agg AS (
        SELECT 
          external_id,
          AVG(ggr_mes) as ggr_medio,
          SUM(ggr_mes) as ggr_total,
          MAX(ggr_mes) as ggr_maximo,
          MAX(ultima_ggr) as ultima_ggr
        FROM ggr_mensal
        GROUP BY external_id
      ),
      depositos_agg AS (
        SELECT 
          d.external_id::text as external_id,
          SUM(d.valor) /NULLIF(COUNT(*), 0) as ticket_medio,
          MAX(d.valor) as ticket_maximo,
          MAX(d.data_e_hora) as ultima_dep
        FROM depositos_totais d
        INNER JOIN jogadores_vip_historico vh ON d.external_id::text = vh.external_id::text
        WHERE d.data_e_hora >= '2025-04-01' AND d.data_e_hora <= $1::date
        GROUP BY d.external_id
      )
      SELECT 
        ga.external_id,
        COALESCE(ga.ggr_total, 0) as ggr_total,
        COALESCE(ga.ggr_maximo, 0) as ggr_maximo,
        COALESCE(da.ticket_medio, 0) as ticket_medio,
        COALESCE(da.ticket_maximo, 0) as ticket_maximo,
        EXTRACT(DAY FROM ($1::date - GREATEST(ga.ultima_ggr, da.ultima_dep)))::integer as dias_inativo
      FROM ggr_agg ga
      INNER JOIN depositos_agg da ON ga.external_id = da.external_id
      INNER JOIN status_cliente sc ON ga.external_id::uuid = sc.external_id
      WHERE sc.status = 'ACTIVE'
        AND EXTRACT(DAY FROM ($1::date - GREATEST(ga.ultima_ggr, da.ultima_dep))) <= 60
    `;
    
    const result = await client.query(query, [today]);
    const vips = result.rows;
    
    if (!vips || vips.length === 0) {
      console.log('[CRON HISTORICO] ⚠️ Nenhum jogador VIP encontrado');
      client.release();
      return NextResponse.json({
        success: false,
        message: 'Nenhum jogador VIP encontrado'
      });
    }

    console.log(`[CRON HISTORICO] 📊 Processando ${vips.length} jogadores VIP`);

    // Calcular scores de hoje
    const scoresGGR = vips.map((v: any) => calcularScoreGGR(v.ggr_total, v.ggr_maximo, v.ticket_medio));
    const scoresTicket = vips.map((v: any) => calcularScoreTicket(v.ticket_medio, v.ticket_maximo));
    const scoresAtividade = vips.map((v: any) => calcularScoreAtividade(v.dias_inativo));
    
    const avgGGRScore = scoresGGR.reduce((a: number, b: number) => a + b, 0) / vips.length;
    const avgTicketScore = scoresTicket.reduce((a: number, b: number) => a + b, 0) / vips.length;
    const avgActivityScore = scoresAtividade.reduce((a: number, b: number) => a + b, 0) / vips.length;
    const avgTotalScore = (avgGGRScore + avgTicketScore + avgActivityScore) / 3;
    const avgGGRValue = vips.reduce((sum: number, v: any) => sum + parseFloat(v.ggr_total), 0) / vips.length;
    const avgTicketValue = vips.reduce((sum: number, v: any) => sum + parseFloat(v.ticket_medio), 0) / vips.length;

    console.log(`[CRON HISTORICO] Scores de hoje (${today}):`);
    console.log(`  GGR: ${avgGGRScore.toFixed(2)} | Ticket: ${avgTicketScore.toFixed(2)} | Atividade: ${avgActivityScore.toFixed(2)} | Total: ${avgTotalScore.toFixed(2)}`);

    // Inserir ou atualizar registro de hoje
    const queryInsert = `
      INSERT INTO historico_score 
      (data_dia, avg_ggr_score, avg_ticket_score, avg_activity_score, avg_total_score, avg_ggr_value, avg_ticket_value, qtd_jogadores_considerados)
      VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (data_dia) DO UPDATE SET
      avg_ggr_score = EXCLUDED.avg_ggr_score,
      avg_ticket_score = EXCLUDED.avg_ticket_score,
      avg_activity_score = EXCLUDED.avg_activity_score,
      avg_total_score = EXCLUDED.avg_total_score,
      avg_ggr_value = EXCLUDED.avg_ggr_value,
      avg_ticket_value = EXCLUDED.avg_ticket_value,
      qtd_jogadores_considerados = EXCLUDED.qtd_jogadores_considerados,
      updated_at = CURRENT_TIMESTAMP
    `;

    await client.query(queryInsert, [
      avgGGRScore.toFixed(2),
      avgTicketScore.toFixed(2),
      avgActivityScore.toFixed(2),
      avgTotalScore.toFixed(2),
      avgGGRValue.toFixed(2),
      avgTicketValue.toFixed(2),
      vips.length
    ]);

    console.log('[CRON HISTORICO] ✅ Histórico atualizado com sucesso!');

    return NextResponse.json({
      success: true,
      message: 'Histórico atualizado com sucesso',
      data: {
        data: new Date().toISOString().split('T')[0],
        jogadores: vips.length,
        scores: {
          ggr: avgGGRScore.toFixed(2),
          ticket: avgTicketScore.toFixed(2),
          atividade: avgActivityScore.toFixed(2),
          total: avgTotalScore.toFixed(2)
        }
      }
    });

  } catch (error) {
    console.error('[CRON HISTORICO] ❌ Erro:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Erro ao atualizar histórico',
        message: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  } finally {
    if (client) client.release();
  }
}
