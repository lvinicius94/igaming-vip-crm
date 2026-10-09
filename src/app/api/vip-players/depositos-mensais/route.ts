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

    // Gera placeholders $2, $3, $4...
    const placeholders = externalIds.map((_: string, i: number) => `$${i + 2}`).join(", ");

    const query = `
      SELECT
        TO_CHAR(DATE_TRUNC('month', dt.data_e_hora), 'YYYY-MM') as mes,
        COALESCE(SUM(dt.valor), 0)::numeric as valor_total,
        COUNT(dt.valor)::integer as qtd_depositos
      FROM depositos_totais dt
      WHERE dt.external_id::text IN (${placeholders})
        AND dt.data_e_hora >= '2025-04-01'
        AND dt.data_e_hora <= $1::date
      GROUP BY DATE_TRUNC('month', dt.data_e_hora)
      ORDER BY DATE_TRUNC('month', dt.data_e_hora)
    `;

    const result = await pool.query(query, [safeEndDate, ...externalIds]);

    const data = result.rows.map((row: { mes: string; valor_total: string; qtd_depositos: number }) => ({
      mes: row.mes,
      valor_total: parseFloat(row.valor_total),
      qtd_depositos: row.qtd_depositos,
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[DEPOSITOS-MENSAIS] Erro:", error);
    return NextResponse.json(
      { error: "Erro ao buscar depósitos mensais" },
      { status: 500 }
    );
  }
}
