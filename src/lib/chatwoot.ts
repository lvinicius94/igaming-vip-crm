// Helpers para a API REST do Chatwoot (self-hosted; URL via env var).
// Auth via header api_access_token. Account id e API URL vem das env vars.

const BASE = process.env.CHATWOOT_API_URL;
const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID;
const TOKEN = process.env.CHATWOOT_API_TOKEN;

function assertEnv() {
  if (!BASE || !ACCOUNT_ID || !TOKEN) {
    throw new Error(
      "Chatwoot env vars ausentes: CHATWOOT_API_URL, CHATWOOT_ACCOUNT_ID, CHATWOOT_API_TOKEN",
    );
  }
}

function headers() {
  return {
    api_access_token: TOKEN!,
    "Content-Type": "application/json",
  };
}

export interface ChatwootConversation {
  id: number;
  status: string;
  inbox_id: number;
  messages_count?: number;
  meta?: { sender?: { phone_number?: string; name?: string } };
}

export interface ChatwootInbox {
  id: number;
  name: string;
  channel_type?: string;
}

// Lista inboxes do Chatwoot. Cada inbox = 1 chip Evolution.
export async function listInboxes(): Promise<ChatwootInbox[]> {
  assertEnv();
  const res = await fetch(`${BASE}/api/v1/accounts/${ACCOUNT_ID}/inboxes`, {
    headers: headers(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Chatwoot listInboxes failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return (json.payload || json) as ChatwootInbox[];
}

// Lista conversas com status configuravel.
export async function listConversations(
  inboxId: number | null,
  page: number,
  status: "open" | "resolved" | "pending" | "snoozed" | "all" = "all",
): Promise<{ data: { meta: { all_count: number }; payload: Array<ChatwootConversation & { created_at?: number }> } }> {
  assertEnv();
  const params = new URLSearchParams({ status, page: String(page) });
  if (inboxId != null) params.set("inbox_id", String(inboxId));
  const res = await fetch(
    `${BASE}/api/v1/accounts/${ACCOUNT_ID}/conversations?${params.toString()}`,
    { headers: headers(), signal: AbortSignal.timeout(15000) },
  );
  if (!res.ok) throw new Error(`Chatwoot listConversations failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export interface ChatwootContact {
  id: number;
  name: string | null;
  phone_number: string | null;
  identifier: string | null;
  contact_inboxes?: Array<{ source_id: string; inbox: { id: number; channel_type?: string } }>;
}

// Busca contato pelo identifier (= external_id do usuario na Smartico).
// Chatwoot API: GET /accounts/{id}/contacts/search?q=<identifier>&include=contact_inboxes
export async function searchContactByIdentifier(identifier: string): Promise<ChatwootContact | null> {
  assertEnv();
  const params = new URLSearchParams({ q: identifier, include: "contact_inboxes" });
  const res = await fetch(
    `${BASE}/api/v1/accounts/${ACCOUNT_ID}/contacts/search?${params.toString()}`,
    { headers: headers(), signal: AbortSignal.timeout(15000) },
  );
  if (!res.ok) throw new Error(`Chatwoot searchContact failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const payload = (json.payload || json) as ChatwootContact[];
  // Confirma match exato no identifier (search faz busca fuzzy em varios campos).
  return payload.find((c) => c.identifier === identifier) ?? null;
}

export interface CreateConversationOptions {
  inboxId: number;
  contactId: number;
  sourceId: string;
}

// Cria conversa em uma inbox especifica. Retorna conversation id.
export async function createConversation(opts: CreateConversationOptions): Promise<number> {
  assertEnv();
  const res = await fetch(
    `${BASE}/api/v1/accounts/${ACCOUNT_ID}/conversations`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        source_id: opts.sourceId,
        inbox_id: opts.inboxId,
        contact_id: opts.contactId,
        status: "open",
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) throw new Error(`Chatwoot createConversation failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return Number(json.id);
}

// Envia mensagem outgoing em uma conversa.
export async function sendMessage(conversationId: number, content: string): Promise<unknown> {
  assertEnv();
  const res = await fetch(
    `${BASE}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        content,
        message_type: "outgoing",
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) throw new Error(`Chatwoot sendMessage failed: ${res.status} ${await res.text()}`);
  return res.json();
}
