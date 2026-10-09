import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutos

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
 * 🛠️ ENDPOINT MANUAL - Popular histórico de scores (01/01/2026 até hoje)
 * 
 * Uso: Chamar 1 vez após setup inicial para popular dados históricos
 * Depois disso, o cron automático mantém atualizado
 */
export async function GET(request: NextRequest) {
  // ✅ SEGURANÇA: Verificar se é chamada autorizada
  const authHeader = request.headers.get('authorization');
  const expectedToken = `Bearer ${process.env.CRON_SECRET}`;
  
  if (authHeader !== expectedToken) {
    console.error('[POPULAR HISTORICO] ❌ Acesso não autorizado');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  console.log('[POPULAR HISTORICO] 🚀 Iniciando população de dados históricos...');
  
  const client = await pool.connect();
  const startDate = new Date('2026-01-01');
  const endDate = new Date();
  const diasProcessados: string[] = [];
  const erros: string[] = [];
  
  try {
    let currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      
      try {
        console.log(`[POPULAR HISTORICO] 📅 Processando ${dateStr}...`);
        
        // Query para buscar VIPs até essa data
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
              SUM(d.valor) / NULLIF(COUNT(*), 0) as ticket_medio,
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
        
        const result = await client.query(query, [dateStr]);
        const vips = result.rows;
        
        if (vips.length === 0) {
          console.log(`[POPULAR HISTORICO]   ⚠️ Nenhum VIP em ${dateStr}`);
          currentDate.setDate(currentDate.getDate() + 1);
          continue;
        }
        
        // Calcular scores
        const scoresGGR = vips.map((v: any) => calcularScoreGGR(parseFloat(v.ggr_total), parseFloat(v.ggr_maximo), parseFloat(v.ticket_medio)));
        const scoresTicket = vips.map((v: any) => calcularScoreTicket(parseFloat(v.ticket_medio), parseFloat(v.ticket_maximo)));
        const scoresAtividade = vips.map((v: any) => calcularScoreAtividade(parseInt(v.dias_inativo)));
        
        const avgGGRScore = scoresGGR.reduce((a: number, b: number) => a + b, 0) / vips.length;
        const avgTicketScore = scoresTicket.reduce((a: number, b: number) => a + b, 0) / vips.length;
        const avgActivityScore = scoresAtividade.reduce((a: number, b: number) => a + b, 0) / vips.length;
        const avgTotalScore = (avgGGRScore + avgTicketScore + avgActivityScore) / 3;
        const avgGGRValue = vips.reduce((sum: number, v: any) => sum + parseFloat(v.ggr_total), 0) / vips.length;
        const avgTicketValue = vips.reduce((sum: number, v: any) => sum + parseFloat(v.ticket_medio), 0) / vips.length;
        
        // Inserir no banco
        const queryInsert = `
          INSERT INTO historico_score 
          (data_dia, avg_ggr_score, avg_ticket_score, avg_activity_score, avg_total_score, avg_ggr_value, avg_ticket_value, qtd_jogadores_considerados)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
          dateStr,
          avgGGRScore.toFixed(2),
          avgTicketScore.toFixed(2),
          avgActivityScore.toFixed(2),
          avgTotalScore.toFixed(2),
          avgGGRValue.toFixed(2),
          avgTicketValue.toFixed(2),
          vips.length
        ]);
        
        console.log(`[POPULAR HISTORICO]   ✅ ${dateStr}: ${vips.length} VIPs, Score: ${avgTotalScore.toFixed(2)}`);
        diasProcessados.push(dateStr);
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
        console.error(`[POPULAR HISTORICO]   ❌ Erro em ${dateStr}:`, errorMsg);
        erros.push(`${dateStr}: ${errorMsg}`);
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    console.log('[POPULAR HISTORICO] ✅ População concluída!');
    console.log(`[POPULAR HISTORICO]   Dias processados: ${diasProcessados.length}`);
    console.log(`[POPULAR HISTORICO]   Erros: ${erros.length}`);
    
    return NextResponse.json({
      success: true,
      message: 'Histórico populado com sucesso',
      dias_processados: diasProcessados.length,
      dias: diasProcessados,
      erros: erros.length > 0 ? erros : undefined
    });
    
  } catch (error) {
    console.error('[POPULAR HISTORICO] ❌ Erro geral:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Erro ao popular histórico',
        message: error instanceof Error ? error.message : 'Erro desconhecido',
        dias_processados: diasProcessados.length,
        erros
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
