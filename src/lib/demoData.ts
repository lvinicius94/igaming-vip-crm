/**
 * Demo Mode — dados FICTÍCIOS para amostragem de portfólio.
 *
 * Com DEMO_MODE=true, o middleware intercepta /api/* e devolve estes dados,
 * permitindo abrir o CRM de VIPs totalmente populado e sem login, sem banco.
 * Nenhum jogador/dado real — nomes e números são gerados (sem PII).
 */

const HOJE = '2026-06-20';
const HOJE_MS = Date.parse(HOJE + 'T12:00:00Z');
const dISO = (offsetDias: number) => new Date(HOJE_MS - offsetDias * 86400000).toISOString().slice(0, 10);

function rng(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6d2b79f5; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ri = (r: () => number, a: number, b: number) => Math.floor(a + r() * (b - a + 1));
const rm = (r: () => number, a: number, b: number) => Math.round((a + r() * (b - a)) * 100) / 100;
const pick = <T,>(r: () => number, arr: T[]) => arr[Math.floor(r() * arr.length)];

const NOMES = ['João Silva','Maria Santos','Pedro Oliveira','Ana Costa','Lucas Souza','Julia Lima','Carlos Pereira','Mariana Alves','Rafael Rodrigues','Beatriz Gomes','Felipe Martins','Camila Ribeiro','Bruno Carvalho','Larissa Ferreira','Gustavo Barbosa','Amanda Rocha','Thiago Almeida','Patrícia Dias','Rodrigo Nunes','Fernanda Castro','Marcelo Pinto','Vanessa Moreira','Diego Cardoso','Aline Teixeira','Vinícius Mendes','Tatiane Freitas','Leonardo Araújo','Priscila Ramos','Eduardo Correia','Natália Cavalcanti'];
const ORIGENS = ['GOOGLE','META','ORGANICO','PLATAFORMA','TIKTOK'];
const CONEXOES = [null, 'VIP-01', 'VIP-02', 'ATENDIMENTO-03'];

export interface DemoPlayer { [k: string]: unknown }

function makePlayer(prefix: string, i: number, diasInativo: number): DemoPlayer {
  const r = rng(`${prefix}|${i}`);
  const ggrMax = rm(r, 8000, 240000);
  const ggrTotal = Math.round(ggrMax * (0.5 + r() * 0.5));
  const ticketMax = rm(r, 200, 9000);
  const ticketMedio = Math.round(ticketMax * (0.3 + r() * 0.5) * 100) / 100;
  const cadastroDias = ri(r, diasInativo + 20, diasInativo + 700);
  const flag = (p: number) => r() < p;
  const cashback = flag(0.45), bonus = flag(0.35), exp = flag(0.25), saque = flag(0.3), semFtd = flag(0.15);
  return {
    external_id: `${prefix}-${String(i).padStart(4, '0')}`,
    nome: NOMES[i % NOMES.length],
    origem: pick(r, ORIGENS),
    ggr_total: ggrTotal,
    ggr_total_periodo: Math.round(ggrTotal * (0.2 + r() * 0.4)),
    ggr_maximo: ggrMax,
    ticket_medio: ticketMedio,
    deposito_total_periodo: rm(r, 3000, 120000),
    ticket_maximo: ticketMax,
    ultima_atividade: dISO(diasInativo),
    dias_inativo: diasInativo,
    meses_ativos: ri(r, 1, 18),
    data_cadastro: dISO(cadastroDias),
    data_primeiro_deposito: dISO(cadastroDias - ri(r, 0, 5)),
    data_aniversario: `1990-${String(ri(r, 1, 12)).padStart(2, '0')}-${String(ri(r, 1, 28)).padStart(2, '0')}`,
    recompensas_usadas: ri(r, 0, 12),
    cashback_vip_ativado: cashback,
    data_ativacao: cashback ? dISO(ri(r, 1, 40)) : null,
    bonus_vip_ativado: bonus,
    bonus_vip_data: bonus ? dISO(ri(r, 1, 40)) : null,
    experiencia_vip_ativado: exp,
    experiencia_vip_data: exp ? dISO(ri(r, 1, 40)) : null,
    saque_vip_ativado: saque,
    saque_vip_data: saque ? dISO(ri(r, 1, 40)) : null,
    sem_ftd_ativado: semFtd,
    sem_ftd_data: semFtd ? dISO(ri(r, 1, 40)) : null,
    conexao: pick(r, CONEXOES),
  };
}

// Lista principal: mix de ativos (<=60), inativos (>60) e novos (cadastro recente)
function buildMainList(): DemoPlayer[] {
  const out: DemoPlayer[] = [];
  for (let i = 0; i < 30; i++) out.push(makePlayer('vip', i, ri(rng(`act|${i}`), 0, 55)));   // ativos
  for (let i = 30; i < 47; i++) out.push(makePlayer('vip', i, ri(rng(`ina|${i}`), 65, 220))); // inativos
  // alguns "novos": ativos com cadastro recente
  for (let i = 47; i < 53; i++) { const p = makePlayer('vip', i, ri(rng(`new|${i}`), 2, 40)); p.data_cadastro = dISO(ri(rng(`nc|${i}`), 5, 50)); out.push(p); }
  return out;
}

const periodo = { inicio: dISO(30), fim: HOJE };

export function demoVipPlayers() { return { success: true, data: buildMainList(), total: 53, periodo, cached: false, cache_age_seconds: 0 }; }
export function demoGooglePlayers() { return { success: true, data: Array.from({ length: 15 }, (_, i) => makePlayer('gsd', i, ri(rng(`g|${i}`), 0, 90))), total: 15 }; }
export function demoPlataformaPlayers() { return { success: true, data: Array.from({ length: 22 }, (_, i) => makePlayer('plt', i, ri(rng(`p|${i}`), 0, 120))), total: 22 }; }

// Meses no formato YYYY-MM (os charts fazem mes.split('-') e pad p/ 20 meses).
// Preenchemos 15 meses terminando em Jun/2026; o chart completa a janela de 20
// com os ~5 meses seguintes vazios (Jul–Nov/2026) => mês atual não fica por último.
function ymList(endY: number, endM: number, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(endY, endM - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
const MESES = ymList(2026, 6, 15);
export function demoDepositosMensais() {
  return { success: true, data: MESES.map((mes, i) => { const r = rng(`dep|${i}`); return { mes, valor_total: rm(r, 600000, 1800000), qtd_depositos: ri(r, 1200, 4200) }; }) };
}
export function demoGgrMensal() {
  return { success: true, data: MESES.map((mes, i) => { const r = rng(`ggr|${i}`); return { mes, ggr_total: rm(r, 250000, 950000), qtd_usuarios_ativos: ri(r, 320, 900) }; }) };
}

export function demoPerfil(externalId: string) {
  const r = rng(`perfil|${externalId}`);
  const player = makePlayer('vip', Math.abs(externalId.length * 7) % 53, ri(r, 0, 80));
  player.external_id = externalId;
  const acaoTipos = ['bonus','experiencia','saque','cashback','resumo'] as const;
  const acoes = Array.from({ length: ri(r, 2, 6) }, (_, i) => ({ tipo: pick(r, acaoTipos as unknown as string[]), data: dISO(ri(r, 1, 90)), valor: rm(r, 50, 5000), detalhes: 'Ação registrada (demo)', usuario: pick(r, ['admin','atendimento']) }));
  const scores = Array.from({ length: 6 }, (_, i) => ({ data: dISO((6 - i) * 15), score_ggr: ri(r, 40, 100), score_ticket: ri(r, 40, 100), score_atividade: ri(r, 30, 100), score_geral: ri(r, 40, 100) }));
  const preferencias = { jogos_favoritos: ['Aviator','Fortune Tiger','Sweet Bonanza'], provedores_favoritos: ['Pragmatic','Spribe','PG Soft'], time_favorito: pick(r, ['Flamengo','Corinthians','Palmeiras','São Paulo']), produto_favorito: pick(r, ['Cassino','Esportes']), tipos_jogo: ['Slots','Crash','Ao Vivo'] };
  return { success: true, player, acoes, scores, preferencias };
}
