// Helper para a Evolution API (instâncias WhatsApp na VPS Hetzner).
// Auth via header apikey. Env: EVOLUTION_API_URL, EVOLUTION_API_KEY.

const BASE = process.env.EVOLUTION_API_URL;
const KEY = process.env.EVOLUTION_API_KEY;

function assertEnv() {
  if (!BASE || !KEY) {
    throw new Error("Evolution env ausentes: EVOLUTION_API_URL, EVOLUTION_API_KEY");
  }
}

export interface EvolutionInstance {
  name: string;
  connectionStatus?: string;
  state?: string;
  status?: string;
}

// Lista todas as instâncias. Evolution API retorna formatos diferentes por versão;
// normalizamos para extrair nome e status.
export async function fetchInstances(): Promise<EvolutionInstance[]> {
  assertEnv();
  const res = await fetch(`${BASE}/instance/fetchInstances`, {
    headers: { apikey: KEY!, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Evolution fetchInstances ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as unknown;

  // Formato comum v2.x: array de { instance: { instanceName, state }, ... }
  // ou array de { name, connectionStatus, ... } direto
  const arr = Array.isArray(data) ? data : [];
  return arr.map((item: Record<string, unknown>) => {
    const inst = (item.instance as Record<string, unknown> | undefined) ?? item;
    return {
      name: String(inst.instanceName ?? inst.name ?? ""),
      connectionStatus: inst.connectionStatus as string | undefined,
      state: inst.state as string | undefined,
      status: inst.status as string | undefined,
    };
  }).filter((i) => i.name);
}

// Retorna instâncias online (state='open' ou connectionStatus='open') e SEM "VIP" no nome.
export async function fetchOnlineNonVipInstances(): Promise<string[]> {
  const instances = await fetchInstances();
  const isOnline = (i: EvolutionInstance) =>
    i.state === "open" || i.connectionStatus === "open" || i.status === "open";
  return instances
    .filter(isOnline)
    .map((i) => i.name)
    .filter((name) => !name.toUpperCase().includes("VIP"));
}
