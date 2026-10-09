import { NextRequest, NextResponse } from "next/server";
import { listInboxes, listConversations } from "@/lib/chatwoot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Conta conversas por inbox (= chip Evolution) criadas no periodo.
// Auth: Bearer ${CRON_SECRET}
// Query params:
//   - days: janela em dias (default 7)
//   - status: open|resolved|all (default all)
//   - max_pages_per_inbox: limite defensivo de paginas por inbox (default 50)
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const days = Math.max(1, Number(url.searchParams.get("days") ?? "7"));
  const status = (url.searchParams.get("status") ?? "all") as "open" | "resolved" | "all";
  const maxPages = Math.max(1, Number(url.searchParams.get("max_pages_per_inbox") ?? "50"));
  const cutoffSec = Math.floor(Date.now() / 1000) - days * 86400;

  try {
    const inboxes = await listInboxes();
    const perInbox: Array<{ id: number; name: string; channel?: string; count: number }> = [];

    for (const inbox of inboxes) {
      let count = 0;
      let pagesScanned = 0;
      let stop = false;

      for (let page = 1; page <= maxPages && !stop; page++) {
        const { data } = await listConversations(inbox.id, page, status);
        const convs = data?.payload ?? [];
        pagesScanned++;

        if (convs.length === 0) break;

        for (const conv of convs) {
          const createdAt = (conv as { created_at?: number }).created_at;
          if (typeof createdAt === "number" && createdAt >= cutoffSec) {
            count++;
          } else if (typeof createdAt === "number" && createdAt < cutoffSec) {
            // Chatwoot retorna em ordem decrescente de last_activity_at, nao de created_at.
            // Entao nao podemos quebrar cedo so porque achamos uma antiga — seguimos paginando.
          }
        }

        // Heuristica: se a pagina ja so tem conversas com last_activity_at muito antigas
        // (mais antigas que o cutoff em 30 dias), provavelmente nao tem mais nada novo.
        const allWayOld = convs.every((c) => {
          const last = (c as { last_activity_at?: number; created_at?: number }).last_activity_at ??
            (c as { created_at?: number }).created_at ?? 0;
          return last < cutoffSec - 30 * 86400;
        });
        if (allWayOld) stop = true;
      }

      perInbox.push({
        id: inbox.id,
        name: inbox.name,
        channel: inbox.channel_type,
        count,
      });
    }

    perInbox.sort((a, b) => b.count - a.count);
    const counts = perInbox.map((p) => p.count);
    const total = counts.reduce((a, b) => a + b, 0);
    const nonZero = counts.filter((c) => c > 0);
    const average_all = inboxes.length > 0 ? total / inboxes.length : 0;
    const average_active = nonZero.length > 0 ? total / nonZero.length : 0;

    return NextResponse.json({
      status: "ok",
      params: { days, status, max_pages_per_inbox: maxPages, cutoff_iso: new Date(cutoffSec * 1000).toISOString() },
      summary: {
        total_inboxes: inboxes.length,
        active_inboxes: nonZero.length,
        total_conversations: total,
        average_per_inbox_all: Number(average_all.toFixed(2)),
        average_per_inbox_active: Number(average_active.toFixed(2)),
        max: counts[0] ?? 0,
        min_active: nonZero.length > 0 ? Math.min(...nonZero) : 0,
      },
      per_inbox: perInbox,
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", detail: String(err).slice(0, 400) },
      { status: 500 },
    );
  }
}
