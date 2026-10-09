import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { externalIds, endDate } = await req.json();

    if (!externalIds || !Array.isArray(externalIds) || externalIds.length === 0) {
      return NextResponse.json({ error: "externalIds é obrigatório" }, { status: 400 });
    }

    const safeEndDate = endDate || new Date().toISOString().slice(0, 10);

    const placeholders = externalIds.map((_: string, i: number) => `$${i + 2}`).join(", ");

    const query = `
      SELECT
        TO_CHAR(DATE_TRUNC('month', g.data_e_hora), 'YYYY-MM') as mes,
        COALESCE(SUM(g.valor), 0)::numeric as ggr_total,
        COUNT(DISTINCT g.external_id)::integer as qtd_usuarios_ativos
      FROM ggr_total g
      WHERE g.external_id::text IN (${placeholders})
        AND g.data_e_hora >= '2025-04-01'
        AND g.data_e_hora <= $1::date
      GROUP BY DATE_TRUNC('month', g.data_e_hora)
      ORDER BY DATE_TRUNC('month', g.data_e_hora)
    `;

    const result = await pool.query(query, [safeEndDate, ...externalIds]);

    const data = result.rows.map((row: { mes: string; ggr_total: string; qtd_usuarios_ativos: number }) => ({
      mes: row.mes,
      ggr_total: parseFloat(row.ggr_total),
      qtd_usuarios_ativos: row.qtd_usuarios_ativos,
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[GGR-MENSAL] Erro:", error);
    return NextResponse.json(
      { error: "Erro ao buscar GGR mensal" },
      { status: 500 }
    );
  }
}
