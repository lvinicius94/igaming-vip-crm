import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || 'f4b96963-279b-43b8-9a90-e77a59a40e52';
    
    const startDate = '2025-10-01';
    const endDate = '2025-12-31';
    
    // Buscar TODOS os registros do usuário no período
    const query = `
      SELECT 
        external_id,
        valor,
        data_e_hora,
        DATE_TRUNC('month', data_e_hora) as mes,
        TO_CHAR(data_e_hora, 'YYYY-MM-DD HH24:MI:SS') as data_formatada
      FROM ggr_total
      WHERE external_id = $1
        AND data_e_hora >= $2
        AND data_e_hora <= $3
      ORDER BY data_e_hora
    `;
    
    const result = await pool.query(query, [userId, startDate, endDate]);
    
    // Agrupar por mês
    const porMes: Record<string, { valores: number[], total: number }> = {};
    
    result.rows.forEach(row => {
      const mes = row.mes.toISOString().slice(0, 7);
      if (!porMes[mes]) {
        porMes[mes] = { valores: [], total: 0 };
      }
      porMes[mes].valores.push(parseFloat(row.valor));
      porMes[mes].total += parseFloat(row.valor);
    });
    
    const mesesAtivos = Object.keys(porMes).length;
    const totalPeriodo = Object.values(porMes).reduce((sum, mes) => sum + mes.total, 0);
    const mediaMensal = mesesAtivos > 0 ? totalPeriodo / mesesAtivos : 0;
    
    return NextResponse.json({
      success: true,
      userId,
      periodo: { inicio: startDate, fim: endDate },
      totalRegistros: result.rows.length,
      registros: result.rows,
      resumoPorMes: porMes,
      estatisticas: {
        mesesAtivos,
        totalPeriodo,
        mediaMensal
      }
    });
    
  } catch (error) {
    console.error('[DEBUG USER API] Erro:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Erro ao buscar dados do usuário',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  }
}
