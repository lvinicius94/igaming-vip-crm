import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  listInboxes,
  searchContactByIdentifier,
  createConversation,
  sendMessage,
} from "@/lib/chatwoot";
import { fetchOnlineNonVipInstances } from "@/lib/evolution";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Cron WHATS_SEM_FTD
// ─────────────────
// 1. Lista instâncias Evolution: online + sem "VIP" no nome
// 2. Mapeia para inbox Chatwoot (nome "WhatsApp - {instance}")
// 3. Conta msgs enviadas hoje por chip (fila_whatsapp_semftd) → cap 2/dia
// 4. Slots disponíveis = (2 - sent_today) por chip. Run pega 1 por chip disponível.
// 5. Query elegíveis: aba Plataforma, sem depósito, sem msg prévia. Ordem por cadastro ASC.
// 6. Para cada (user, chip):
//    - INSERT fila_whatsapp_semftd (registro)
//    - Busca contato Chatwoot por identifier=external_id
//    - Cria conversa + envia mensagem
//    - UPDATE fila enviado=true ou erro=...
//    - INSERT bonus_dado_atendimento_vip (mantém regra 1× na vida)
//    - Dispara action Smartico (rastreio)
//
// Query params: dry_run=1 (não envia, só simula)
// Auth: Bearer ${CRON_SECRET}

const SMARTICO_API_URL = "https://apis3.smartico.ai/api/external/events/v2";
const SMARTICO_BRAND_ID = process.env.SMARTICO_BRAND_ID || "sua-marca";
const MAX_PER_CHIP_PER_DAY = 2;

// Templates rotacionam para reduzir chance do WhatsApp marcar como spam (variações simples
// em saudação/emojis/texto introdutório; promoção é idêntica). Os 5 primeiros já estavam
// em uso na fila_whatsapp_semftd antes; os 2 últimos são variações novas.
const MESSAGE_TEMPLATES: Array<(name: string) => string> = [
  (n) => `Olá, ${n}! Preparamos algo especial pra você! 🌟
Deposite e receba rodadas grátis na hora:
✨ Depósito de R$20 → 10 rodadas grátis
✨ Depósito de R$30 → 15 rodadas grátis
✨ Depósito de R$50 → 20 rodadas grátis
📲 Só responde SIM e a gente ativa o bônus direto na sua conta!
Promoção válida para maiores de 18 anos. Jogue com responsabilidade. Apostas envolvem risco de perda financeira.`,
  (n) => `Oi ${n}! Sua oferta especial está reservada! ⏰
Deposite hoje e ganhe rodadas grátis na hora:
💰 Depósito de R$20 → 10 rodadas grátis
💰 Depósito de R$30 → 15 rodadas grátis
💰 Depósito de R$50 → 20 rodadas grátis
⚡ Válido só hoje. Responde SIM que eu ativo o bônus direto na sua conta.
Promoção válida para maiores de 18 anos. Jogue com responsabilidade. Apostas envolvem risco de perda financeira.`,
  (n) => `Fala, ${n}! Sua chance de ganhar rodadas grátis chegou! 🚀
Veja as ofertas exclusivas de hoje:
🎯 Deposite R$20 → ganhe 10 rodadas grátis
🎯 Deposite R$30 → ganhe 15 rodadas grátis
🎯 Deposite R$50 → ganhe 20 rodadas grátis
⏳ Oferta válida só hoje. Responde SIM pra ativar o bônus na sua conta!
Promoção válida para maiores de 18 anos. Jogue com responsabilidade. Apostas envolvem risco de perda financeira.`,
  (n) => `E aí, ${n}! Temos uma surpresa pra você! 🎁
Faça um depósito e ganhe rodadas grátis agora:
🎰 R$20 de depósito → 10 rodadas grátis
🎰 R$30 de depósito → 15 rodadas grátis
🎰 R$50 de depósito → 20 rodadas grátis
🔥 Promoção por tempo limitado! Manda SIM que a gente libera o bônus na sua conta.
Promoção válida para maiores de 18 anos. Jogue com responsabilidade. Apostas envolvem risco de perda financeira.`,
  (n) => `Hey ${n}! Você tem rodadas grátis esperando por você! 🎰
Deposite agora e receba na hora:
💎 R$20 → 10 rodadas grátis
💎 R$30 → 15 rodadas grátis
💎 R$50 → 20 rodadas grátis
👉 Manda SIM aqui que eu ativo o bônus direto na sua conta.
Promoção válida para maiores de 18 anos. Jogue com responsabilidade. Apostas envolvem risco de perda financeira.`,
  (n) => `Bora, ${n}! Tem oferta nova esperando por você! 🎲
Deposite hoje e leve rodadas grátis na hora:
🎁 R$20 depositado → 10 rodadas grátis
🎁 R$30 depositado → 15 rodadas grátis
🎁 R$50 depositado → 20 rodadas grátis
⏱️ Promoção válida só hoje. Manda SIM aqui pra eu liberar o bônus na sua conta!
Promoção válida para maiores de 18 anos. Jogue com responsabilidade. Apostas envolvem risco de perda financeira.`,
  (n) => `Eai ${n}! Bônus liberado especialmente pra você! 🤑
Aproveita e ganha rodadas grátis na hora do depósito:
🎯 R$20 → 10 rodadas grátis
🎯 R$30 → 15 rodadas grátis
🎯 R$50 → 20 rodadas grátis
🚨 Só hoje! Responde SIM aqui que eu já ativo o bônus na sua conta.
Promoção válida para maiores de 18 anos. Jogue com responsabilidade. Apostas envolvem risco de perda financeira.`,
];

function extractFirstName(fullName: string | null | undefined): string {
  if (!fullName) return "amigo(a)";
  const first = fullName.trim().split(/\s+/)[0];
  if (!first || first === "DESCONHECIDO") return "amigo(a)";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

async function fireSmarticoAction(externalId: string): Promise<{ ok: boolean; detail?: string }> {
  const token = process.env.SMARTICO_AUTH_TOKEN;
  if (!token) return { ok: false, detail: "SMARTICO_AUTH_TOKEN ausente" };
  const ts = Date.now();
  try {
    const res = await fetch(SMARTICO_API_URL, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        eid: `${externalId}_whatscontact_${ts}`,
        event_date: ts,
        ext_brand_id: SMARTICO_BRAND_ID,
        user_ext_id: externalId,
        event_type: "client_action",
        payload: { client_action: "WHATS_SEM_FTD" },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, detail: `Smartico ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: String(e).slice(0, 200) };
  }
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";

  const stats = {
    online_instances: 0,
    available_chips: 0,
    total_slots: 0,
    eligible_users: 0,
    queued: 0,
    sent: 0,
    skipped_no_contact: 0,
    skipped_no_inbox_for_contact: 0,
    chatwoot_errors: 0,
    smartico_errors: 0,
    db_errors: 0,
  };
  const errors: Array<{ external_id?: string; stage: string; detail: string }> = [];

  try {
    // ─── 1. Instâncias Evolution online e sem "VIP" ───
    const onlineInstances = await fetchOnlineNonVipInstances();
    stats.online_instances = onlineInstances.length;
    if (onlineInstances.length === 0) {
      return NextResponse.json({ status: "ok", message: "Nenhuma instância online não-VIP", stats });
    }

    // ─── 2. Mapeia para inbox Chatwoot via nome "WhatsApp - {instance}" ───
    const allInboxes = await listInboxes();
    const inboxByName = new Map(allInboxes.map((ib) => [ib.name, ib]));
    const chips: Array<{ instance: string; inboxId: number; inboxName: string }> = [];
    for (const name of onlineInstances) {
      const inboxName = `WhatsApp - ${name}`;
      const inbox = inboxByName.get(inboxName);
      if (inbox) chips.push({ instance: name, inboxId: inbox.id, inboxName });
    }
    if (chips.length === 0) {
      return NextResponse.json(
        { status: "ok", message: "Nenhuma inbox Chatwoot bateu com instâncias online", stats, debug: { onlineInstances } },
        { status: 200 },
      );
    }

    // ─── 3. Slots por chip (cap 2/dia) ───
    const chipInboxIds = chips.map((c) => c.inboxId);
    const enviadosHojeResult = await pool.query(
      `SELECT inbox_id, COUNT(*) AS qtd
       FROM fila_whatsapp_semftd
       WHERE inbox_id = ANY($1::int[])
         AND enviado = true
         AND enviado_em >= (NOW() - INTERVAL '3 hours')::date
       GROUP BY inbox_id`,
      [chipInboxIds],
    );
    const sentToday = new Map<number, number>();
    for (const r of enviadosHojeResult.rows) sentToday.set(Number(r.inbox_id), Number(r.qtd));

    type Slot = { instance: string; inboxId: number; inboxName: string };
    const slotsQueue: Slot[] = [];
    for (const chip of chips) {
      const usedToday = sentToday.get(chip.inboxId) ?? 0;
      const free = Math.max(0, MAX_PER_CHIP_PER_DAY - usedToday);
      // Distribui slots intercalado entre chips (round-robin) — não 2 seguidos no mesmo chip
      for (let i = 0; i < free; i++) slotsQueue.push(chip);
    }
    // Reorganiza: pega 1 por chip por vez (intercalado)
    const slots: Slot[] = [];
    const perChipRemaining = new Map<number, number>();
    for (const s of slotsQueue) perChipRemaining.set(s.inboxId, (perChipRemaining.get(s.inboxId) ?? 0) + 1);
    while (slots.length < slotsQueue.length) {
      for (const chip of chips) {
        const remaining = perChipRemaining.get(chip.inboxId) ?? 0;
        if (remaining > 0) {
          slots.push(chip);
          perChipRemaining.set(chip.inboxId, remaining - 1);
        }
      }
    }
    stats.available_chips = chips.filter((c) => (sentToday.get(c.inboxId) ?? 0) < MAX_PER_CHIP_PER_DAY).length;
    stats.total_slots = slots.length;

    if (slots.length === 0) {
      return NextResponse.json({ status: "ok", message: "Todos os chips já atingiram cap de 2/dia", stats });
    }

    // ─── 4. Elegíveis: aba Plataforma, sem depósito, sem msg prévia, ordem por cadastro ASC ───
    // - lista_vip origem='plataforma'
    // - NOT EXISTS depositos_totais (sem FTD)
    // - NOT EXISTS bonus_dado_atendimento_vip action='WHATS_SEM_FTD' (não recebeu via fluxo manual/registrar-contato)
    // - NOT EXISTS fila_whatsapp_semftd (não foi enfileirado antes — qualquer status, enviado ou não)
    const elegiveisResult = await pool.query(
      `SELECT lv.external_id::text AS external_id, lv.nome, cs.registration_date
       FROM lista_vip lv
       LEFT JOIN cadastros_smartico cs ON cs.external_id::text = lv.external_id::text
       WHERE lv.origem = 'plataforma'
         AND NOT EXISTS (
           SELECT 1 FROM depositos_totais d
           WHERE d.external_id::text = lv.external_id::text
         )
         AND NOT EXISTS (
           SELECT 1 FROM bonus_dado_atendimento_vip b
           WHERE b.external_id::text = lv.external_id::text
             AND b.action = 'WHATS_SEM_FTD'
         )
         AND NOT EXISTS (
           SELECT 1 FROM fila_whatsapp_semftd f
           WHERE f.external_id::text = lv.external_id::text
         )
       ORDER BY cs.registration_date ASC NULLS LAST, lv.data_e_hora ASC
       LIMIT $1`,
      [slots.length],
    );
    const elegiveis = elegiveisResult.rows as Array<{ external_id: string; nome: string | null; registration_date: Date | null }>;
    stats.eligible_users = elegiveis.length;

    if (elegiveis.length === 0) {
      return NextResponse.json({ status: "ok", message: "Nenhum elegível", stats });
    }

    // ─── 5. Processa pares (user, chip) ───
    for (let i = 0; i < Math.min(elegiveis.length, slots.length); i++) {
      const user = elegiveis[i];
      const chip = slots[i];
      const firstName = extractFirstName(user.nome);
      const template = MESSAGE_TEMPLATES[i % MESSAGE_TEMPLATES.length];
      const message = template(firstName);

      // (a) Inserir na fila (sempre — registro de tentativa)
      let filaId: number | null = null;
      try {
        const insertResult = await pool.query(
          `INSERT INTO fila_whatsapp_semftd
             (external_id, nome, inbox_id, inbox_name, mensagem, enviar_em, enviado, criado_em)
           VALUES ($1, $2, $3, $4, $5, NOW() - INTERVAL '3 hours', false, NOW() - INTERVAL '3 hours')
           RETURNING id`,
          [user.external_id, user.nome, chip.inboxId, chip.inboxName, message],
        );
        filaId = Number(insertResult.rows[0].id);
        stats.queued++;
      } catch (e) {
        stats.db_errors++;
        errors.push({ external_id: user.external_id, stage: "db_insert_fila", detail: String(e).slice(0, 200) });
        continue;
      }

      if (dryRun) continue;

      // (b) Busca contato Chatwoot + cria conversa + envia mensagem
      try {
        const contact = await searchContactByIdentifier(user.external_id);
        if (!contact) {
          stats.skipped_no_contact++;
          await pool.query(
            `UPDATE fila_whatsapp_semftd SET erro = $1, tentativas = COALESCE(tentativas,0)+1 WHERE id = $2`,
            ["Contato não encontrado no Chatwoot", filaId],
          );
          continue;
        }

        const ci = (contact.contact_inboxes ?? []).find((c) => c.inbox?.id === chip.inboxId);
        if (!ci || !ci.source_id) {
          stats.skipped_no_inbox_for_contact++;
          await pool.query(
            `UPDATE fila_whatsapp_semftd SET erro = $1, tentativas = COALESCE(tentativas,0)+1 WHERE id = $2`,
            [`Contato sem contact_inbox para inbox ${chip.inboxId}`, filaId],
          );
          continue;
        }

        const conversationId = await createConversation({
          inboxId: chip.inboxId,
          contactId: contact.id,
          sourceId: ci.source_id,
        });
        await sendMessage(conversationId, message);

        // (c) Marcar enviado + registrar para 1×-na-vida + Smartico
        await pool.query(
          `UPDATE fila_whatsapp_semftd SET enviado = true, enviado_em = NOW() - INTERVAL '3 hours' WHERE id = $1`,
          [filaId],
        );
        await pool.query(
          `INSERT INTO bonus_dado_atendimento_vip (external_id, valor_bonus, valor_experiencia, data_e_hora, action)
           VALUES ($1, 0, 0, NOW() - INTERVAL '3 hours', 'WHATS_SEM_FTD')
           ON CONFLICT DO NOTHING`,
          [user.external_id],
        );
        const sm = await fireSmarticoAction(user.external_id);
        if (!sm.ok) {
          stats.smartico_errors++;
          errors.push({ external_id: user.external_id, stage: "smartico", detail: sm.detail ?? "?" });
        }
        stats.sent++;
      } catch (e) {
        stats.chatwoot_errors++;
        const detail = String(e).slice(0, 200);
        errors.push({ external_id: user.external_id, stage: "chatwoot", detail });
        await pool.query(
          `UPDATE fila_whatsapp_semftd SET erro = $1, tentativas = COALESCE(tentativas,0)+1 WHERE id = $2`,
          [detail, filaId],
        );
      }

      // Cadência leve entre envios
      await new Promise((r) => setTimeout(r, 200));
    }

    return NextResponse.json({
      status: dryRun ? "dry_run" : "ok",
      stats,
      chips: chips.map((c) => ({ ...c, sent_today: sentToday.get(c.inboxId) ?? 0 })),
      errors: errors.slice(0, 30),
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", detail: String(err).slice(0, 400), stats, errors: errors.slice(0, 30) },
      { status: 500 },
    );
  }
}
