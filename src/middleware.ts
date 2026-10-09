import { NextRequest, NextResponse } from 'next/server';
import {
  demoVipPlayers, demoGooglePlayers, demoPlataformaPlayers,
  demoDepositosMensais, demoGgrMensal, demoPerfil,
} from '@/lib/demoData';

/**
 * DEMO MODE middleware.
 * Com DEMO_MODE=true, intercepta /api/* e devolve VIPs fictícios,
 * abrindo o CRM populado e sem login. No-op em produção.
 */
const DEMO = process.env.DEMO_MODE === 'true';

function demoBody(req: NextRequest): unknown {
  const p = req.nextUrl.pathname;
  const q = req.nextUrl.searchParams;

  // auth: auto-login
  if (p === '/api/auth/session') return { authenticated: true, username: 'admin', role: 'admin' };
  if (p === '/api/auth/logout' || p === '/api/auth/login') return { success: true };

  // listas
  if (p === '/api/google-signups-no-deposit') return demoGooglePlayers();
  if (p === '/api/plataforma-players') return demoPlataformaPlayers();
  if (p === '/api/vip-players/depositos-mensais') return demoDepositosMensais();
  if (p === '/api/vip-players/ggr-mensal') return demoGgrMensal();
  if (p === '/api/vip-players/perfil') return demoPerfil(q.get('external_id') || 'demo-0001');
  if (p === '/api/vip-players/historico-scores') return { success: true, data: demoPerfil(q.get('external_id') || 'x').scores };
  if (p === '/api/vip-players/resumo-atendimento') return { success: true, resumo: 'Resumo de atendimento (demo): cliente contatado, sem pendências.', mensagens: [] };
  // base da lista VIP (e variantes optimized/paginated)
  if (p.startsWith('/api/vip-players')) {
    // ações (POST) → sucesso
    if (/\/(ativar-|registrar-|save-)/.test(p)) return { success: true, message: 'Ação registrada (demo)' };
    return demoVipPlayers();
  }

  // integrações (benignas, evitam erro)
  if (p.startsWith('/api/digisac')) return { success: true, status: 'sem_atendimento', connection: null, tickets: [] };
  if (p === '/api/smartico/user-info') return { success: true, data: { birthday: '1990-05-15' } };
  if (p.startsWith('/api/cache') || p.startsWith('/api/vip-cache') || p.startsWith('/api/admin')) return { success: true };
  if (p === '/api/health') return { status: 'ok', demo: true };

  // fallback seguro
  return { success: true, data: [] };
}

export function middleware(req: NextRequest) {
  if (!DEMO) return NextResponse.next();
  if (!req.nextUrl.pathname.startsWith('/api/')) return NextResponse.next();
  return NextResponse.json(demoBody(req), { status: 200 });
}

export const config = { matcher: '/api/:path*' };
