"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import styles from './styles/vip.module.css';
import { MonthlyDepositsChart } from './components/MonthlyDepositsChart';
import { MonthlyGgrChart } from './components/MonthlyGgrChart';

interface VipPlayer {
  external_id: string;
  nome: string | null;
  origem: string | null;
  ggr_total: number; 
  ggr_total_periodo: number;
  ggr_maximo: number; 
  ticket_medio: number;
  deposito_total_periodo: number;
  ticket_maximo: number;
  ultima_atividade: string;
  dias_inativo: number;
  meses_ativos: number;
  data_cadastro: string | null;
  data_primeiro_deposito: string | null;
  data_aniversario: string | null;
  recompensas_usadas: number;
  cashback_vip_ativado: boolean;
  data_ativacao: string | null; 
  bonus_vip_ativado: boolean;
  bonus_vip_data: string | null;
  experiencia_vip_ativado: boolean;
  experiencia_vip_data: string | null;
  saque_vip_ativado: boolean;
  saque_vip_data: string | null;
  sem_ftd_ativado: boolean;
  sem_ftd_data: string | null;
  conexao: string | null;
} 
  
interface ApiResponse {
  success: boolean;
  data?: VipPlayer[];
  total?: number;
  periodo?: { inicio: string; fim: string };
  error?: string;
  cached?: boolean;
  cache_age_seconds?: number;
}

interface HistoricoAcao {
  tipo: 'bonus' | 'experiencia' | 'saque' | 'cashback' | 'resumo';
  data: string;
  valor?: number;
  detalhes?: string;
  usuario?: string;
}

interface HistoricoScore {
  data: string;
  score_ggr: number;
  score_ticket: number;
  score_atividade: number;
  score_geral: number;
}

interface PerfilUsuario {
  player: VipPlayer;
  acoes: HistoricoAcao[];
  scores: HistoricoScore[];
  preferencias?: {
    jogos_favoritos: string[];
    provedores_favoritos: string[];
    time_favorito: string | null;
    produto_favorito: string | null;
    tipos_jogo: string[];
  };
}

export default function VipPlayersPage() {
  const [players, setPlayers] = useState<VipPlayer[]>([]);
  const [googlePlayers, setGooglePlayers] = useState<VipPlayer[]>([]);
  const [plataformaPlayers, setPlataformaPlayers] = useState<VipPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [userRole, setUserRole] = useState<'admin' | 'atendimento'>('admin');
  const [activeTab, setActiveTab] = useState<'ativos' | 'inativos' | 'novos' | 'google' | 'plataforma'>('ativos');
  // Snapshots fixos com data de 25/02/2026 - carregados uma única vez da data fixa
  const [snapshotAtivos, setSnapshotAtivos] = useState<VipPlayer[] | null>(null);
  const [snapshotInativos, setSnapshotInativos] = useState<VipPlayer[] | null>(null);
  const snapshotDate = '2026-02-25'; // Data fixa
  const [sortBy, setSortBy] = useState<'ggr' | 'ticket' | 'atividade' | 'score' | 'bonus' | 'experiencia' | 'cadastro' | null>('ggr');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [cached, setCached] = useState(false);
  const [cacheAge, setCacheAge] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [tempDate, setTempDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [monthlyDepositsData, setMonthlyDepositsData] = useState<{ mes: string; valor_total: number; qtd_depositos: number }[]>([]);
  const [monthlyDepositsLoading, setMonthlyDepositsLoading] = useState(false);
  const [monthlyGgrData, setMonthlyGgrData] = useState<{ mes: string; ggr_total: number; qtd_usuarios_ativos: number }[]>([]);
  const [monthlyGgrLoading, setMonthlyGgrLoading] = useState(false);
  const [loadingCashback, setLoadingCashback] = useState<string | null>(null);
  const [loadingWhatsapp, setLoadingWhatsapp] = useState<string | null>(null);
  const [platformMenu, setPlatformMenu] = useState<{ id: string; name: string | null } | null>(null);
  const [loadingBonus, setLoadingBonus] = useState<string | null>(null);
  const [loadingExperiencia, setLoadingExperiencia] = useState<string | null>(null);
  const [loadingSaque, setLoadingSaque] = useState<string | null>(null);
  const [loadingSemFtd, setLoadingSemFtd] = useState<string | null>(null);
  const [perfilAberto, setPerfilAberto] = useState<PerfilUsuario | null>(null);
  const [loadingPerfil, setLoadingPerfil] = useState(false);
  const resumoTextRef = useRef<HTMLTextAreaElement>(null);
  const [loadingResumo, setLoadingResumo] = useState(false);
  const [contactStatus, setContactStatus] = useState<Record<string, { status: string; label: string; color: string }>>({});
  const [loadingContactStatus, setLoadingContactStatus] = useState(true);
  const router = useRouter();

  // Monitorar quando o estado 'players' muda
  useEffect(() => {
    if (players.length > 0) {
      const totalGGR = players.reduce((sum, p) => sum + p.ggr_total, 0);
      const firstPlayerGGR = players[0]?.ggr_total || 0;
      console.log(`[STATE] 🔄 Estado 'players' mudou: ${players.length} jogadores | GGR Total: R$ ${totalGGR.toFixed(2)} | Primeiro GGR: R$ ${firstPlayerGGR.toFixed(2)}`);
    }
  }, [players]);

  useEffect(() => {
    if (!platformMenu) return;
    const close = () => setPlatformMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [platformMenu]);

  useEffect(() => {
    async function checkSession() {
      try {
        const res = await fetch('/api/auth/session');
        if (res.ok) {
          const data = await res.json();
          setAuthenticated(true);
          setUserRole(data.role || 'admin');
        } else {
          router.replace('/login');
        }
      } catch (error) {
        console.error('[SESSION] Erro ao verificar sessão:', error);
        router.replace('/login');
      } finally {
        setSessionChecked(true);
      }
    }
    checkSession();
  }, [router]);

  const fetchVipPlayers = useCallback(async (forceRefresh = false) => {
    if (!authenticated || !sessionChecked) return;
    
    setLoading(true);
    try {
      const url = `/api/vip-players?endDate=${selectedDate}${forceRefresh ? '&forceRefresh=true' : ''}`;
      console.log(`[VIP FETCH] 📅 Buscando dados para data: ${selectedDate}${forceRefresh ? ' (FORÇANDO ATUALIZAÇÃO)' : ''}`);
      const res = await fetch(url);
      const data: ApiResponse = await res.json();
      
      if (data.success && data.data) {
        // Ordena por GGR (padrão) antes de setar
        const sortedData = [...data.data].sort((a, b) => {
          return b.ggr_total - a.ggr_total; // desc: maior primeiro
        });
        
        // Log para debug dos scores
        const totalGGRDebug = sortedData.reduce((sum, p) => sum + p.ggr_total, 0);
        const avgGGRDebug = totalGGRDebug / sortedData.length;
        console.log(`[VIP FETCH] 📊 Dados recebidos:`);
        console.log(`  - Total jogadores: ${sortedData.length}`);
        console.log(`  - GGR Total: R$ ${totalGGRDebug.toFixed(2)}`);
        console.log(`  - GGR Médio: R$ ${avgGGRDebug.toFixed(2)}`);
        console.log(`  - Cached: ${data.cached ? 'SIM ⚠️' : 'NÃO ✓'}`);
        if (data.cached) {
          console.log(`  - Cache Age: ${data.cache_age_seconds}s`);
        }
        
        setPlayers(sortedData);
        setCached(data.cached || false);
        setCacheAge(data.cache_age_seconds || 0);
        
        console.log(`[VIP FETCH] ✅ Estado 'players' atualizado com ${sortedData.length} jogadores`);
      } else {
        console.error('[VIP] Erro:', data.error);
        alert(data.error || 'Erro ao carregar dados');
      }
    } catch (error) {
      console.error('[VIP] Erro ao buscar dados:', error);
      alert('Erro ao carregar dados dos jogadores VIP');
    } finally {
      setLoading(false);
    }
  }, [authenticated, sessionChecked, selectedDate]);

  const fetchGooglePlayers = useCallback(async () => {
    if (!authenticated || !sessionChecked) return;

    try {
      const res = await fetch('/api/google-signups-no-deposit');
      const data: ApiResponse = await res.json();

      if (data.success && data.data) {
        const sortedData = [...data.data].sort((a, b) => b.ggr_total - a.ggr_total);
        setGooglePlayers(sortedData);
        console.log(`[GOOGLE FETCH] ✅ ${sortedData.length} cadastros Google sem depósito carregados`);
      } else {
        console.error('[GOOGLE FETCH] Erro:', data.error);
      }
    } catch (error) {
      console.error('[GOOGLE FETCH] Erro ao buscar dados Google:', error);
    }
  }, [authenticated, sessionChecked]);

  const fetchPlataformaPlayers = useCallback(async () => {
    if (!authenticated || !sessionChecked) return;

    try {
      const res = await fetch('/api/plataforma-players');
      const data: ApiResponse = await res.json();

      if (data.success && data.data) {
        const sortedData = [...data.data].sort((a, b) => b.ggr_total - a.ggr_total);
        setPlataformaPlayers(sortedData);
        console.log(`[PLATAFORMA FETCH] ✅ ${sortedData.length} cadastros Plataforma carregados`);
      } else {
        console.error('[PLATAFORMA FETCH] Erro:', data.error);
      }
    } catch (error) {
      console.error('[PLATAFORMA FETCH] Erro ao buscar dados Plataforma:', error);
    }
  }, [authenticated, sessionChecked]);

  useEffect(() => {
    if (authenticated && sessionChecked) {
      fetchVipPlayers();
      fetchGooglePlayers();
      fetchPlataformaPlayers();
    }
  }, [authenticated, sessionChecked, selectedDate, fetchVipPlayers, fetchGooglePlayers, fetchPlataformaPlayers]);

  // Carrega snapshots FIXOS da data 25/02/2026
  useEffect(() => {
    if (!authenticated || !sessionChecked) return;
    if (snapshotAtivos && snapshotInativos) return;

    let isCancelled = false;

    const fetchFixedSnapshots = async () => {
      try {
        console.log(`[📸 SNAPSHOT FIXO] Buscando listas fixas da data ${snapshotDate}...`);

        const res = await fetch(`/api/vip-players?endDate=${snapshotDate}&forceRefresh=true`);
        const data: ApiResponse = await res.json();

        if (!data.success || !data.data) {
          console.error('[📸 SNAPSHOT FIXO] Erro ao buscar snapshot:', data.error);
          return;
        }

        const base = data.data;

        const top100Ativos = [...base]
          .filter(p => p.dias_inativo <= 60)
          .sort((a, b) => b.ggr_total - a.ggr_total)
          .slice(0, 100);

        const top100Inativos = [...base]
          .filter(p => p.dias_inativo > 60)
          .sort((a, b) => b.ggr_total - a.ggr_total)
          .slice(0, 100);

        if (!isCancelled) {
          setSnapshotAtivos(top100Ativos);
          setSnapshotInativos(top100Inativos);
        }

        console.log(`[📸 SNAPSHOT FIXO] ✅ Listas fixas carregadas da data ${snapshotDate}`);
        console.log(`[📸 SNAPSHOT FIXO] Ativos: ${top100Ativos.length} | Inativos: ${top100Inativos.length}`);
      } catch (error) {
        console.error('[📸 SNAPSHOT FIXO] Erro ao carregar listas fixas:', error);
      }
    };

    fetchFixedSnapshots();

    return () => {
      isCancelled = true;
    };
  }, [authenticated, sessionChecked, userRole, snapshotAtivos, snapshotInativos]);

  // Log quando a data selecionada muda
  useEffect(() => {
    if (selectedDate) {
      console.log(`\n[DATE CHANGE] 📅 ===== DATA SELECIONADA MUDOU: ${selectedDate} =====\n`);
    }
  }, [selectedDate]);

  // Auto-refresh dos dados VIP a cada 10 minutos
  useEffect(() => {
    if (authenticated && sessionChecked) {
      // Polling a cada 10 minutos (600000ms) para atualizar dados VIP
      const vipInterval = setInterval(() => {
        console.log('[AUTO-REFRESH] Atualizando dados VIP...');
        fetchVipPlayers();
        fetchGooglePlayers();
        fetchPlataformaPlayers();
      }, 600000);

      return () => clearInterval(vipInterval);
    }
  }, [authenticated, sessionChecked, fetchVipPlayers, fetchGooglePlayers, fetchPlataformaPlayers]);



  // Buscar status de contato do Digisac para cada jogador
  // Temporariamente desabilitado para focar no visual
  /*
  useEffect(() => {
    if (players.length > 0) {
      setLoadingContactStatus(true);
      
      const fetchContactStatuses = async () => {
        const statuses: Record<string, { status: string; label: string; color: string }> = {};
        
        for (const player of players.slice(0, 20)) { // Limitar a 20 primeiros para não sobrecarregar
          try {
            const res = await fetch(`/api/digisac/contact-status?external_id=${encodeURIComponent(player.external_id)}`);
            
            if (res.ok) {
              const data = await res.json();
              if (data.success) {
                statuses[player.external_id] = {
                  status: data.status,
                  label: data.label,
                  color: data.color
                };
              }
            }
          } catch (error) {
            console.error(`[STATUS] Erro ao buscar status de ${player.external_id}:`, error);
          }
        }
        
        setContactStatus(statuses);
        setLoadingContactStatus(false);
      };
      
      fetchContactStatuses();
    }
  }, [players]);
  */

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setAuthenticated(false);
      router.replace('/login');
    } catch (error) {
      console.error('[LOGOUT] Erro:', error);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  const formatCurrencyRounded = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(Math.round(value));
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Data inválida';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  const formatDateOnly = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Data inválida';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date);
  };

  const getFavoriteProductName = (code: string | null): string => {
    if (!code) return 'Não disponível';
    
    const productMap: { [key: string]: string } = {
      '1': '🎰 Casino Only',
      '2': '⚽ Sport Only',
      '3': '🎫 Lottery Only',
      '4': '🎰⚽ More Casino, Less Sport',
      '5': '🎰⚽ Casino and Sport',
      '6': '⚽🎰 More Sport, Less Casino',
      '7': '🎯 Mixed Preferences'
    };
    
    return productMap[code] || code;
  };

  const getActivityClass = (diasInativo: number) => {
    if (diasInativo <= 3) return styles.activityRecent;
    if (diasInativo <= 7) return styles.activityModerate;
    return styles.activityInactive;
  };

  const getActivityLabel = (diasInativo: number) => {
    if (diasInativo === 0) return 'Hoje';
    if (diasInativo === 1) return 'Ontem';
    if (diasInativo <= 7) return `${diasInativo} Dias`;
    return `${diasInativo} Dias`;
  };

  const calculateGGRScore = (ggrAtual: number, ggrMaximo: number, ticketMedio: number): number => {
    // Se GGR for 0 ou negativo, a meta é 22% do ticket médio
    const ggrIdeal = ggrAtual <= 0 
      ? ticketMedio * 0.22 
      : ggrMaximo * 1.1;
    
    // Evita divisão por zero
    if (ggrIdeal === 0) return 0;
    
    const score = (ggrAtual / ggrIdeal) * 100;
    return Math.min(Math.max(Math.round(score), 0), 100);
  };

  const calculateTicketScore = (ticketAtual: number, ticketMaximo: number): number => {
    if (ticketMaximo === 0) return 0;
    const ticketIdeal = ticketMaximo * 1.1;
    const score = (ticketAtual / ticketIdeal) * 100;
    return Math.min(Math.round(score), 100);
  };

  const calculateActivityScore = (diasInativo: number): number => {
    const maxDias = 28; // Últimos 28 dias
    if (diasInativo >= maxDias) return 0;
    const score = 100 - (diasInativo / maxDias) * 100;
    return Math.max(Math.round(score), 0);
  };

  const getScoreColor = (score: number): string => {
    if (score >= 75) return '#78ffa3'; // Verde - Excelente
    if (score >= 50) return '#22d3ee'; // Ciano - Bom
    if (score >= 25) return '#fbbf24'; // Amarelo - Regular
    return '#ef4444'; // Vermelho - Ruim
  };

  const formatScore = (score: number): string => {
    if (score === 100) return '100';
    return String(score).padStart(2, '0');
  };

  const downloadIdsCSV = () => {
    // Para atendimento: baixar apenas os 100 da lista (displayedPlayers)
    // Para admin: baixar todos (displayedPlayers também retorna todos)
    // Separador ';' + vírgula decimal = padrão Excel pt-BR (abre em colunas).
    const sep = ';';
    const fmtBR = (value: number) => (Number(value) || 0).toFixed(2).replace('.', ',');
    const header = ['external_id', 'GGR', 'Ticket médio', 'Disponível', 'Usado', 'Atividade'].join(sep);
    const rows = displayedPlayers.map(p => {
      // Disponível = 5% do GGR do período MENOS o já usado (mesma regra dos cards/tooltip e da coluna na tela); Usado = recompensas já utilizadas.
      const valorBonus = p.ggr_total_periodo > 0 ? p.ggr_total_periodo * 0.05 : 0;
      const disponivel = Math.max(0, valorBonus - p.recompensas_usadas);
      return [
        String(p.external_id).trim(),
        fmtBR(p.ggr_total),
        fmtBR(p.ticket_medio),
        fmtBR(disponivel),
        fmtBR(p.recompensas_usadas),
        formatDate(p.ultima_atividade),
      ].join(sep);
    });
    const csvContent = [header, ...rows].join('\r\n');
    // BOM UTF-8 para Excel interpretar corretamente
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `vip-players-ids-${activeTab}-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log(`[DOWNLOAD] Exportados ${rows.length} IDs de usuários (aba: ${activeTab}) para CSV`);
  };

  const handleAtivarExperiencia = async (external_id: string, valorDisponivel: number) => {
    if (loadingExperiencia) return;
    
    const valorExperiencia = Math.min(1000, Math.max(500, Math.floor(valorDisponivel * 0.5 * 100) / 100));
    
    const mensagemConfirmacao = userRole === 'atendimento'
      ? `Confirma ativação de EXPERIÊNCIA VIP para o usuário ${external_id}?\n\n` +
        `📊 Regra: 50% do valor disponível\n\n` +
        `⚠️ Após ativação, só poderá ativar novamente no próximo mês.`
      : `Confirma ativação de EXPERIÊNCIA VIP para o usuário ${external_id}?\n\n` +
        `💰 Valor disponível: R$ ${valorDisponivel.toFixed(2)}\n` +
        `✅ Valor da experiência (50%): R$ ${valorExperiencia.toFixed(2)}\n` +
        `📊 Mínimo: R$ 500,00 | Máximo: R$ 1.000,00\n\n` +
        `⚠️ Após ativação, só poderá ativar novamente no próximo mês.`;
    
    if (!confirm(mensagemConfirmacao)) {
      return;
    }
    
    setLoadingExperiencia(external_id);
    
    try {
      const res = await fetch('/api/vip-players/ativar-experiencia', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          external_id,
          valor_disponivel: valorDisponivel
        })
      });
      
      const data = await res.json();
      
      if (data.success) {
        const mensagemSucesso = userRole === 'atendimento'
          ? `✅ Experiência VIP ativada com sucesso!\n🎯 Action enviada para Smartico`
          : `✅ Experiência VIP ativada com sucesso!\n\n💰 Valor: R$ ${data.valor_experiencia.toFixed(2)}\n🎯 Action enviada para Smartico`;
        alert(mensagemSucesso);
        
        // Atualiza estado local
        setPlayers(prevPlayers =>
          prevPlayers.map(p =>
            p.external_id === external_id
              ? { ...p, experiencia_vip_ativado: true, experiencia_vip_data: new Date().toISOString() }
              : p
          )
        );
      } else {
        alert(`❌ Erro ao ativar experiência: ${data.error}`);
      }
    } catch (error) {
      console.error('[EXPERIENCIA VIP] Erro:', error);
      alert('❌ Erro ao ativar experiência. Verifique o console.');
    } finally {
      setLoadingExperiencia(null);
    }
  };

  const handleAtivarBonus = async (external_id: string, valorDisponivel: number) => {
    if (loadingBonus) return;
    
    // Determinar action baseada na aba ativa
    let action = '';
    let descricaoAba = '';
    
    switch (activeTab) {
      case 'ativos':
        action = 'CONTATO_WHATS_ATIVOS';
        descricaoAba = 'Ativos';
        break;
      case 'inativos':
        action = 'CONTATO_WHATS_INATIVOS';
        descricaoAba = 'Inativos';
        break;
      case 'novos':
        action = 'CONTATO_WHATS_NOVOSVIPS';
        descricaoAba = 'Novos VIPs';
        break;
      case 'google':
        action = 'CONTATO_WHATS_GOOGLE';
        descricaoAba = 'Google';
        break;
      case 'plataforma':
        action = 'CONTATO_WHATS_PLATAFORMA';
        descricaoAba = 'Plataforma';
        break;
      default:
        action = 'CONTATO_WHATS_ATIVOS';
        descricaoAba = 'Ativos';
    }
    
    const mensagemConfirmacao = userRole === 'atendimento'
      ? `Confirma registro de CONTATO WHATSAPP para o usuário ${external_id}?\n\n` +
        `📱 Lista: ${descricaoAba}\n` +
        `🔖 Action: ${action}\n\n` +
        `⚠️ Após registro, só poderá registrar novamente em 7 dias.`
      : `Confirma registro de CONTATO WHATSAPP para o usuário ${external_id}?\n\n` +
        `💰 Valor disponível: R$ ${valorDisponivel.toFixed(2)}\n` +
        `📱 Lista: ${descricaoAba}\n` +
        `🔖 Action: ${action}\n\n` +
        `⚠️ Após registro, só poderá registrar novamente em 7 dias.`;
    
    if (!confirm(mensagemConfirmacao)) {
      return;
    }
    
    setLoadingBonus(external_id);
    
    try {
      const res = await fetch('/api/vip-players/registrar-contato', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          external_id,
          valor_disponivel: valorDisponivel,
          action: action
        })
      });
      
      const data = await res.json();
      
      if (data.success) {
        const mensagemSucesso = userRole === 'atendimento'
          ? `✅ Contato WhatsApp registrado com sucesso!\n🎯 Action ${action} enviada para Smartico`
          : `✅ Contato WhatsApp registrado com sucesso!\n\n📱 Lista: ${descricaoAba}\n🎯 Action ${action} enviada para Smartico`;
        alert(mensagemSucesso);

        const dataRegistro = data.data_registro ? new Date(data.data_registro).toISOString() : new Date().toISOString();
        
        // Atualiza estado local
        setPlayers(prevPlayers =>
          prevPlayers.map(p =>
            p.external_id === external_id
              ? { ...p, bonus_vip_ativado: true, bonus_vip_data: dataRegistro }
              : p
          )
        );

        setGooglePlayers(prevPlayers =>
          prevPlayers.map(p =>
            p.external_id === external_id
              ? { ...p, bonus_vip_ativado: true, bonus_vip_data: dataRegistro }
              : p
          )
        );

        setSnapshotAtivos(prevSnapshot => {
          if (!prevSnapshot) return prevSnapshot;
          return prevSnapshot.map(p =>
            p.external_id === external_id
              ? { ...p, bonus_vip_ativado: true, bonus_vip_data: dataRegistro }
              : p
          );
        });

        setSnapshotInativos(prevSnapshot => {
          if (!prevSnapshot) return prevSnapshot;
          return prevSnapshot.map(p =>
            p.external_id === external_id
              ? { ...p, bonus_vip_ativado: true, bonus_vip_data: dataRegistro }
              : p
          );
        });
      } else {
        alert(`❌ Erro ao registrar contato: ${data.error}`);
      }
    } catch (error) {
      console.error('[CONTATO WHATS] Erro:', error);
      alert('❌ Erro ao registrar contato. Verifique o console.');
    } finally {
      setLoadingBonus(null);
    }
  };

  const handleEnviarSemFtd = async (external_id: string) => {
    if (loadingSemFtd) return;

    const action = 'WHATS_SEM_FTD';

    if (!confirm(`Confirma envio da action WHATS_SEM_FTD para o usuário ${external_id}?\n\n⚠️ Após envio, cooldown de 7 dias.`)) {
      return;
    }

    setLoadingSemFtd(external_id);

    try {
      const res = await fetch('/api/vip-players/registrar-contato', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          external_id,
          valor_disponivel: 0,
          action
        })
      });

      const data = await res.json();

      if (data.success) {
        alert(`✅ Action WHATS_SEM_FTD enviada com sucesso para Smartico!`);

        const dataRegistro = data.data_registro ? new Date(data.data_registro).toISOString() : new Date().toISOString();

        setPlataformaPlayers(prev =>
          prev.map(p =>
            p.external_id === external_id
              ? { ...p, sem_ftd_ativado: true, sem_ftd_data: dataRegistro }
              : p
          )
        );
      } else {
        alert(`❌ Erro: ${data.error}`);
      }
    } catch (error) {
      console.error('[SEM FTD] Erro:', error);
      alert('❌ Erro ao enviar action. Verifique o console.');
    } finally {
      setLoadingSemFtd(null);
    }
  };

  const handleRegistrarSaque = async (player: VipPlayer) => {
    if (loadingSaque || player.saque_vip_ativado) return;
    
    const mensagemConfirmacao = userRole === 'atendimento'
      ? `Confirma registro de SAQUE VIP na planilha?\n\n` +
        `👤 Jogador: ${player.nome || player.external_id}\n\n` +
        `⚠️ ATENÇÃO: Esta ação pode ser feita apenas UMA VEZ!\n` +
        `Os dados serão enviados para a planilha do Google Sheets.`
      : `Confirma registro de SAQUE VIP na planilha?\n\n` +
        `👤 Jogador: ${player.nome || player.external_id}\n` +
        `📊 GGR Médio: R$ ${player.ggr_total.toFixed(2)}\n` +
        `💰 Total Depositado: R$ ${player.deposito_total_periodo.toFixed(2)}\n\n` +
        `⚠️ ATENÇÃO: Esta ação pode ser feita apenas UMA VEZ!\n` +
        `Os dados serão enviados para a planilha do Google Sheets.`;
    
    if (!confirm(mensagemConfirmacao)) {
      return;
    }
    
    setLoadingSaque(player.external_id);
    
    try {
      const res = await fetch('/api/vip-players/registrar-saque', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          external_id: player.external_id,
          nome: player.nome,
          ggr_medio: player.ggr_total,
          ggr_total: player.ggr_total_periodo,
          ticket_medio: player.ticket_medio,
          deposito_total: player.deposito_total_periodo
        })
      });
      
      const data = await res.json();
      
      if (data.success) {
        alert(
          `✅ Saque registrado com sucesso!\n\n` +
          `📊 Linhas adicionadas: ${data.updated_rows}\n` +
          `📋 Ver planilha: ${data.spreadsheet_url}`
        );
        
        // Atualiza apenas o jogador específico no estado local
        setPlayers(prev => prev.map(p => 
          p.external_id === player.external_id 
            ? { ...p, saque_vip_ativado: true, saque_vip_data: new Date().toISOString() }
            : p
        ));
      } else {
        alert(`❌ Erro ao registrar saque: ${data.error}`);
      }
    } catch (error) {
      console.error('[SAQUE VIP] Erro:', error);
      alert('❌ Erro ao registrar saque. Verifique o console.');
    } finally {
      setLoadingSaque(null);
    }
  };

  const handleAtivarCashback = async (external_id: string) => {
    if (loadingCashback) return; // Previne cliques múltiplos
    
    const confirmar = window.confirm(
      `Confirma ativação de CASHBACK VIP para o usuário ${external_id}?\n\n` +
      `⚠️ Esta ação só pode ser executada UMA VEZ por jogador e é irreversível!`
    );
    
    if (!confirmar) return;
    
    setLoadingCashback(external_id);
    
    try {
      const res = await fetch('/api/vip-players/ativar-cashback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ external_id })
      });
      
      const data = await res.json();
      
      if (data.success) {
        alert(`✅ Cashback VIP ativado com sucesso para ${external_id}!`);
        
        // Atualiza o estado local para refletir a mudança
        setPlayers(prevPlayers => 
          prevPlayers.map(p => 
            p.external_id === external_id 
              ? { ...p, cashback_vip_ativado: true, data_ativacao: new Date().toISOString() }
              : p
          )
        );
      } else {
        alert(`❌ Erro ao ativar cashback: ${data.error}`);
      }
    } catch (error) {
      console.error('[CASHBACK] Erro:', error);
      alert('❌ Erro ao ativar cashback. Verifique o console.');
    } finally {
      setLoadingCashback(null);
    }
  };

  const handleAbrirPerfil = async (player: VipPlayer) => {
    setLoadingPerfil(true);
    try {
      // Buscar perfil e dados da Smartico em paralelo
      const [perfilRes, smarticoRes] = await Promise.all([
        fetch(`/api/vip-players/perfil?external_id=${player.external_id}&endDate=${selectedDate}`),
        fetch(`/api/smartico/user-info?external_id=${player.external_id}`)
      ]);
      
      const perfilData = await perfilRes.json();
      const smarticoData = await smarticoRes.json();
      
      if (perfilData.success) {
        // Atualizar player com data de aniversário da Smartico se disponível
        let updatedPlayer = { ...player };
        let preferencias = undefined;
        
        if (smarticoData.success && smarticoData.data) {
          if (smarticoData.data.birth_date) {
            updatedPlayer.data_aniversario = smarticoData.data.birth_date;
          }
          
          // Adicionar preferências
          preferencias = {
            jogos_favoritos: smarticoData.data.favorite_games || [],
            provedores_favoritos: smarticoData.data.favorite_providers || [],
            time_favorito: smarticoData.data.favorite_team || null,
            produto_favorito: smarticoData.data.favorite_product || null,
            tipos_jogo: smarticoData.data.favorite_game_types || []
          };
        }
        
        setPerfilAberto({
          player: updatedPlayer,
          acoes: perfilData.acoes || [],
          scores: perfilData.scores || [],
          preferencias
        });
      } else {
        alert(`❌ Erro ao carregar perfil: ${perfilData.error}`);
      }
    } catch (error) {
      console.error('[PERFIL] Erro:', error);
      alert('❌ Erro ao carregar perfil do usuário');
    } finally {
      setLoadingPerfil(false);
    }
  };

  const handleAdicionarResumo = async () => {
    if (!perfilAberto || loadingResumo || !resumoTextRef.current) return;
    
    const textoTrimmed = resumoTextRef.current.value.trim();
    
    // Validar
    if (!textoTrimmed) {
      alert('❌ Por favor, escreva um resumo do atendimento');
      return;
    }
    
    if (textoTrimmed.length > 500) {
      alert('❌ Resumo muito longo. Máximo de 500 caracteres.');
      return;
    }
    
    // Confirmação
    const confirmar = window.confirm(
      'Tem certeza que deseja enviar esse resumo?\n\n' +
      'Uma vez enviado, não poderá ser editado/removido ou desfeito.'
    );
    
    if (!confirmar) return;
    
    setLoadingResumo(true);
    
    try {
      const res = await fetch('/api/vip-players/resumo-atendimento', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          external_id: perfilAberto.player.external_id,
          descricao: textoTrimmed,
          usuario: userRole
        })
      });
      
      const data = await res.json();
      
      if (data.success) {
        alert('✅ Resumo adicionado com sucesso!');
        
        // Adicionar à timeline localmente
        const novaAcao: HistoricoAcao = {
          tipo: 'resumo',
          data: data.data.created_at,
          detalhes: data.data.descricao,
          usuario: data.data.usuario
        };
        
        setPerfilAberto(prev => {
          if (!prev) return prev;
          
          const acoesAtualizadas = [novaAcao, ...prev.acoes];
          acoesAtualizadas.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
          
          return {
            ...prev,
            acoes: acoesAtualizadas
          };
        });
        
        // Limpar campo
        if (resumoTextRef.current) {
          resumoTextRef.current.value = '';
        }
      } else {
        alert(`❌ Erro ao adicionar resumo: ${data.error}`);
      }
    } catch (error) {
      console.error('[RESUMO] Erro:', error);
      alert('❌ Erro ao adicionar resumo. Verifique o console.');
    } finally {
      setLoadingResumo(false);
    }
  };

  const handleWhatsappClick = (external_id: string, player_name: string | null) => {
    if (loadingWhatsapp) return;
    setPlatformMenu(platformMenu?.id === external_id ? null : { id: external_id, name: player_name });
  };

  const showNotification = (html: string, bgColor = 'rgba(34, 211, 238, 0.95)') => {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: ${bgColor};
      color: white;
      padding: 16px 24px;
      border-radius: 10px;
      font-weight: 600;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    notification.innerHTML = html;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 5000);
  };

  const handleAbrirDigisac = async (external_id: string, player_name: string | null) => {
    if (loadingWhatsapp) return;
    setPlatformMenu(null);
    setLoadingWhatsapp(external_id);

    try {
      console.log('[DIGISAC] Verificando conexoes...');
      const connectionRes = await fetch(`/api/digisac/get-connection?external_id=${external_id}`);
      const connectionData = await connectionRes.json();

      if (!connectionData.success) {
        if (connectionData.allOffline) {
          alert(
            '⚠️ ATENÇÃO: Todas as conexões do Digisac estão offline!\n\n' +
            '🔌 É necessário ativar as conexões no painel do Digisac antes de continuar.\n\n' +
            '📍 Acesse: https://app.digisac.example'
          );
          return;
        }
        alert(`❌ Erro ao verificar conexões: ${connectionData.error}`);
        return;
      }

      const idCopiar = player_name ? `${external_id}_${player_name}` : external_id;
      try {
        await navigator.clipboard.writeText(idCopiar);
      } catch (err) {
        console.warn('[DIGISAC] Nao foi possivel copiar automaticamente');
      }

      const digisacWindow = window.open('https://app.digisac.example', 'digisac-vip');
      if (digisacWindow) digisacWindow.focus();

      showNotification(`
        <div style="font-size: 1rem;">✅ Digisac Aberto!</div>
        <div style="font-size: 0.9rem; margin-top: 6px; opacity: 0.95;">
          ID copiado: <strong>${idCopiar}</strong>
        </div>
        <div style="font-size: 0.85rem; margin-top: 4px; opacity: 0.9;">
          📱 Conexão: <strong>${connectionData.connection.name}</strong>
        </div>
        <div style="font-size: 0.85rem; margin-top: 2px; opacity: 0.9;">
          Cole (Ctrl+V) ao abrir chamado
        </div>
      `);
    } catch (error) {
      console.error('[DIGISAC] Erro:', error);
      alert('❌ Erro ao processar. Verifique o console.');
    } finally {
      setLoadingWhatsapp(null);
    }
  };

  const handleAbrirChatwoot = async (external_id: string, player_name: string | null) => {
    if (loadingWhatsapp) return;
    setPlatformMenu(null);
    setLoadingWhatsapp(external_id);

    try {
      const idCopiar = player_name ? `${external_id}_${player_name}` : external_id;
      try {
        await navigator.clipboard.writeText(idCopiar);
      } catch (err) {
        console.warn('[CHATWOOT] Nao foi possivel copiar automaticamente');
      }

      const chatwootWindow = window.open('https://chatwoot.example', 'chatwoot-vip');
      if (chatwootWindow) chatwootWindow.focus();

      showNotification(`
        <div style="font-size: 1rem;">✅ Chatwoot Aberto!</div>
        <div style="font-size: 0.9rem; margin-top: 6px; opacity: 0.95;">
          ID copiado: <strong>${idCopiar}</strong>
        </div>
        <div style="font-size: 0.85rem; margin-top: 2px; opacity: 0.9;">
          Cole (Ctrl+V) ao buscar contato
        </div>
      `, 'rgba(16, 185, 129, 0.95)');
    } catch (error) {
      console.error('[CHATWOOT] Erro:', error);
      alert('❌ Erro ao processar. Verifique o console.');
    } finally {
      setLoadingWhatsapp(null);
    }
  };

  const handleSort = (column: 'ggr' | 'ticket' | 'atividade' | 'score' | 'bonus' | 'experiencia' | 'cadastro') => {
    // Se clicar na mesma coluna, inverte a direção
    let newDirection: 'asc' | 'desc' = 'desc';
    if (sortBy === column) {
      newDirection = sortDirection === 'desc' ? 'asc' : 'desc';
    }
    
    setSortBy(column);
    setSortDirection(newDirection);
  };

  // Usa snapshot fixo (quando disponível) para manter listas congeladas por aba
  const displayedPlayers = useMemo(() => {
    let filtered = players;

    // IDs das listas fixas (Ativos/Inativos) para garantir exclusividade com a aba Novos VIPs
    const idsAtivosFixos = snapshotAtivos
      ? snapshotAtivos.map(p => p.external_id)
      : [...players]
          .filter(p => p.dias_inativo <= 60)
          .sort((a, b) => b.ggr_total - a.ggr_total)
          .slice(0, 100)
          .map(p => p.external_id);

    const idsInativosFixos = snapshotInativos
      ? snapshotInativos.map(p => p.external_id)
      : [...players]
          .filter(p => p.dias_inativo > 60)
          .sort((a, b) => b.ggr_total - a.ggr_total)
          .slice(0, 100)
          .map(p => p.external_id);

    const idsListasFixas = new Set([...idsAtivosFixos, ...idsInativosFixos]);

    // Aba PLATAFORMA: cadastros Plataforma
    if (activeTab === 'plataforma') {
      filtered = [...plataformaPlayers].sort((a, b) => b.ggr_total - a.ggr_total);

      console.log(`[🟪 PLATAFORMA] 👥 Cadastros Plataforma: ${filtered.length}`);
    }
    // Aba GOOGLE: novos cadastros Google sem depósito desde 01/03/2026
    else if (activeTab === 'google') {
      filtered = [...googlePlayers].sort((a, b) => b.ggr_total - a.ggr_total);

      console.log(`[🟦 GOOGLE] 👥 Cadastros Google sem depósito: ${filtered.length}`);
    }
    // Aba Novos VIPs: Todos com GGR > 5k e atividade < 60 dias (sem limite)
    else if (activeTab === 'novos') {
      filtered = players.filter(p => 
        p.ggr_total > 5000 && 
        p.dias_inativo < 60 && 
        !idsListasFixas.has(p.external_id)
      ).sort((a, b) => b.ggr_total - a.ggr_total);

      console.log(`[🆕 NOVOS VIPS] 👥 Total players: ${players.length} | Novos VIPs (GGR > 5k, atividade < 60 dias, fora das listas fixas): ${filtered.length}`);
    }
    
    // SE HOUVER SNAPSHOT: usar dados congelados
    else if (activeTab === 'ativos' && snapshotAtivos) {
      // Atualizar dados dos jogadores do snapshot com dados atuais do banco
      filtered = snapshotAtivos.map(snapPlayer => {
        const currentData = players.find(p => p.external_id === snapPlayer.external_id);
        return currentData || snapPlayer; // Usa dados atuais se existir, senão mantém snapshot
      });
      
      console.log(`[📸 SNAPSHOT - ATIVOS] Usando snapshot fixo com ${filtered.length} jogadores`);
    } else if (activeTab === 'inativos' && snapshotInativos) {
      // Atualizar dados dos jogadores do snapshot com dados atuais do banco
      filtered = snapshotInativos.map(snapPlayer => {
        const currentData = players.find(p => p.external_id === snapPlayer.external_id);
        return currentData || snapPlayer; // Usa dados atuais se existir, senão mantém snapshot
      });
      
      console.log(`[📸 SNAPSHOT - INATIVOS] Usando snapshot fixo com ${filtered.length} jogadores`);
    } 
    // SE NÃO HOUVER SNAPSHOT: filtrar dinamicamente (fallback)
    else if (activeTab === 'ativos') {
      // Aba Ativos: Filtrar por atividade <= 60 dias
      const playersAtivos = players.filter(p => p.dias_inativo <= 60);
      
      // Ordenar por GGR Total (descendente) e pegar top 100
      filtered = [...playersAtivos]
        .sort((a, b) => b.ggr_total - a.ggr_total)
        .slice(0, 100);
      
      console.log(`[🔴 AO VIVO - ATIVOS] 👥 Total players: ${players.length} | Ativos (≤60 dias): ${playersAtivos.length} | Top 100: ${filtered.length}`);
    } else if (activeTab === 'inativos') {
      // Aba Inativos: Filtrar por atividade > 60 dias
      const playersInativos = players.filter(p => p.dias_inativo > 60);
      
      // Ordenar por GGR Total (descendente) e pegar top 100
      filtered = [...playersInativos]
        .sort((a, b) => b.ggr_total - a.ggr_total)
        .slice(0, 100);
      
      console.log(`[🔴 AO VIVO - INATIVOS] 👥 Total players: ${players.length} | Inativos (>60 dias): ${playersInativos.length} | Top 100: ${filtered.length}`);
    }
    
    // Aplicar ordenação selecionada pelo usuário
    if (!sortBy) return filtered;
    
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      
      if (sortBy === 'ggr') {
        comparison = b.ggr_total - a.ggr_total;
      } else if (sortBy === 'ticket') {
        comparison = b.ticket_medio - a.ticket_medio;
      } else if (sortBy === 'atividade') {
        // atividade - menor dias_inativo = mais recente
        comparison = a.dias_inativo - b.dias_inativo;
      } else if (sortBy === 'score') {
        // score - média dos 3 scores
        const scoreA = (calculateGGRScore(a.ggr_total, a.ggr_maximo, a.ticket_medio) + 
                       calculateActivityScore(a.dias_inativo) + 
                       calculateTicketScore(a.ticket_medio, a.ticket_maximo)) / 3;
        const scoreB = (calculateGGRScore(b.ggr_total, b.ggr_maximo, b.ticket_medio) + 
                       calculateActivityScore(b.dias_inativo) + 
                       calculateTicketScore(b.ticket_medio, b.ticket_maximo)) / 3;
        comparison = scoreB - scoreA;
      } else if (sortBy === 'bonus') {
        // bonus - valor disponível
        const valorBonusA = a.ggr_total_periodo > 0 ? Math.max(0, (a.ggr_total_periodo * 0.05) - a.recompensas_usadas) : 0;
        const valorBonusB = b.ggr_total_periodo > 0 ? Math.max(0, (b.ggr_total_periodo * 0.05) - b.recompensas_usadas) : 0;
        comparison = valorBonusB - valorBonusA;
      } else if (sortBy === 'experiencia') {
        // experiencia - valor disponível
        const valorExpA = a.ggr_total_periodo > 0 ? Math.max(0, (a.ggr_total_periodo * 0.05) - a.recompensas_usadas) : 0;
        const valorExpB = b.ggr_total_periodo > 0 ? Math.max(0, (b.ggr_total_periodo * 0.05) - b.recompensas_usadas) : 0;
        comparison = valorExpB - valorExpA;
      } else if (sortBy === 'cadastro') {
        // cadastro - mais recente primeiro (desc)
        const dateA = a.data_cadastro ? new Date(a.data_cadastro).getTime() : 0;
        const dateB = b.data_cadastro ? new Date(b.data_cadastro).getTime() : 0;
        comparison = dateB - dateA; // Mais recente (maior timestamp) primeiro
      }
      
      return sortDirection === 'desc' ? comparison : -comparison;
    });
    
    return sorted;
  }, [players, googlePlayers, userRole, activeTab, snapshotAtivos, snapshotInativos, sortBy, sortDirection]);

  // Criar uma chave baseada no conteúdo do array E da data para forçar recálculo
  const playersSignature = useMemo(() => {
    if (displayedPlayers.length === 0) return `0-${selectedDate}`;
    // Usa length + soma de todos os GGRs + data selecionada para detectar mudanças
    const totalGGRSum = displayedPlayers.reduce((sum, p) => sum + (Number(p.ggr_total) || 0), 0);
    const signature = `${displayedPlayers.length}-${Number(totalGGRSum).toFixed(2)}-${selectedDate}-${userRole}`;
    console.log(`[SIGNATURE] 🔑 Players signature: ${signature}`);
    return signature;
  }, [displayedPlayers, selectedDate, userRole]);

  // Usar useMemo para forçar recálculo quando players OU data mudar
  const totalGGR = useMemo(() => {
    const total = displayedPlayers.reduce((sum, p) => sum + (Number(p.ggr_total) || 0), 0);
    console.log(`[CALC] 💰 Total GGR recalculado: R$ ${total.toFixed(2)} (${displayedPlayers.length} jogadores) [Data: ${selectedDate}] [Sig: ${playersSignature}]`);
    return total;
  }, [displayedPlayers, playersSignature, selectedDate]);
  
  const ticketMedioGeral = useMemo(() => {
    const avg = displayedPlayers.length > 0 
      ? displayedPlayers.reduce((sum, p) => sum + (Number(p.ticket_medio) || 0), 0) / displayedPlayers.length 
      : 0;
    console.log(`[CALC] 🎫 Ticket Médio Geral recalculado: R$ ${avg.toFixed(2)} [Data: ${selectedDate}] [Sig: ${playersSignature}]`);
    return avg;
  }, [displayedPlayers, playersSignature, selectedDate]);
  
  // Scores médios da carteira - SEMPRE recalcular quando players OU data mudar
  const ggrScoreMedio = useMemo(() => {
    const score = displayedPlayers.length > 0
      ? displayedPlayers.reduce((sum, p) => sum + calculateGGRScore(Number(p.ggr_total) || 0, Number(p.ggr_maximo) || 0, Number(p.ticket_medio) || 0), 0) / displayedPlayers.length
      : 0;
    console.log(`[CALC] 📊 GGR Score Médio recalculado: ${score.toFixed(1)} [Data: ${selectedDate}] [Sig: ${playersSignature}]`);
    return score;
  }, [displayedPlayers, playersSignature, selectedDate]);
  
  const ticketScoreMedio = useMemo(() => {
    const score = displayedPlayers.length > 0
      ? displayedPlayers.reduce((sum, p) => sum + calculateTicketScore(Number(p.ticket_medio) || 0, Number(p.ticket_maximo) || 0), 0) / displayedPlayers.length
      : 0;
    console.log(`[CALC] 🎯 Ticket Score Médio recalculado: ${score.toFixed(1)} [Data: ${selectedDate}] [Sig: ${playersSignature}]`);
    return score;
  }, [displayedPlayers, playersSignature, selectedDate]);
  
  const atividadeMediaGeral = useMemo(() => {
    const score = displayedPlayers.length > 0
      ? displayedPlayers.reduce((sum, p) => sum + calculateActivityScore(Number(p.dias_inativo) || 0), 0) / displayedPlayers.length
      : 0;
    console.log(`[CALC] ⚡ Atividade Média recalculada: ${score.toFixed(1)} [Data: ${selectedDate}] [Sig: ${playersSignature}]`);
    return score;
  }, [displayedPlayers, playersSignature, selectedDate]);
  
  const scoreTotalMedio = useMemo(() => {
    const score = displayedPlayers.length > 0
      ? Math.round((ggrScoreMedio + ticketScoreMedio + atividadeMediaGeral) / 3)
      : 0;
    console.log(`[CALC] 🎖️ Score Total Médio recalculado: ${score} [Data: ${selectedDate}] [Sig: ${playersSignature}]`);
    return score;
  }, [displayedPlayers, ggrScoreMedio, ticketScoreMedio, atividadeMediaGeral, playersSignature, selectedDate]);

  // Log consolidado dos scores calculados para debug
  useEffect(() => {
    if (displayedPlayers.length > 0) {
      console.log(`\n[SCORES] 📈 ============ RESUMO DOS SCORES (Data: ${selectedDate}) ============`);
      console.log(`[SCORES] 👥 Total de Jogadores: ${displayedPlayers.length}`);
      console.log(`[SCORES] 💰 GGR Score Médio: ${ggrScoreMedio.toFixed(1)}`);
      console.log(`[SCORES] 🎯 Ticket Score Médio: ${ticketScoreMedio.toFixed(1)}`);
      console.log(`[SCORES] ⚡ Atividade Média: ${atividadeMediaGeral.toFixed(1)}`);
      console.log(`[SCORES] 🎖️ Score Total: ${scoreTotalMedio}`);
      console.log(`[SCORES] 💸 GGR Total: R$ ${totalGGR.toFixed(2)}`);
      console.log(`[SCORES] 🎫 Ticket Médio Geral: R$ ${ticketMedioGeral.toFixed(2)}`);
      console.log(`[SCORES] ============================================================\n`);
    }
  }, [displayedPlayers, selectedDate, ggrScoreMedio, ticketScoreMedio, atividadeMediaGeral, scoreTotalMedio, totalGGR, ticketMedioGeral]);

  // Cálculos de recompensas totais - também com useMemo
  const totalDisponivel = useMemo(() => {
    return displayedPlayers.reduce((sum, p) => {
      const valorBonus = p.ggr_total_periodo > 0 ? p.ggr_total_periodo * 0.05 : 0;
      return sum + valorBonus;
    }, 0);
  }, [displayedPlayers, playersSignature, selectedDate, snapshotAtivos, snapshotInativos]);
  
  const totalUsado = useMemo(() => {
    return displayedPlayers.reduce((sum, p) => sum + p.recompensas_usadas, 0);
  }, [displayedPlayers, playersSignature, selectedDate, snapshotAtivos, snapshotInativos]);
  
  const saldoRestante = useMemo(() => {
    return totalDisponivel - totalUsado;
  }, [totalDisponivel, totalUsado]);

  // Fetch depositos mensais para o grafico (admin only)
  useEffect(() => {
    if (userRole !== 'admin') return;
    if (displayedPlayers.length === 0) {
      setMonthlyDepositsData([]);
      return;
    }

    const ids = displayedPlayers.map(p => p.external_id);
    setMonthlyDepositsLoading(true);

    fetch('/api/vip-players/depositos-mensais', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalIds: ids, endDate: selectedDate }),
    })
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setMonthlyDepositsData(json.data);
        }
      })
      .catch(err => console.error('[DEPOSITOS-MENSAIS] Erro:', err))
      .finally(() => setMonthlyDepositsLoading(false));
  }, [playersSignature, userRole, selectedDate]);

  // Fetch GGR mensal para o grafico (admin only)
  useEffect(() => {
    if (userRole !== 'admin') return;
    if (displayedPlayers.length === 0) {
      setMonthlyGgrData([]);
      return;
    }

    const ids = displayedPlayers.map(p => p.external_id);
    setMonthlyGgrLoading(true);

    fetch('/api/vip-players/ggr-mensal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalIds: ids, endDate: selectedDate }),
    })
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setMonthlyGgrData(json.data);
        }
      })
      .catch(err => console.error('[GGR-MENSAL] Erro:', err))
      .finally(() => setMonthlyGgrLoading(false));
  }, [playersSignature, userRole, selectedDate]);

  if (!sessionChecked || !authenticated) {
    return null;
  }

  return (
    <>
      {/* Loading do Perfil */}
      {loadingPerfil && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            flexDirection: 'column',
            gap: '20px'
          }}
        >
          <div style={{
            width: '60px',
            height: '60px',
            border: '4px solid rgba(34, 211, 238, 0.3)',
            borderTop: '4px solid #22d3ee',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <div style={{ color: '#22d3ee', fontSize: '1.2rem', fontWeight: '600' }}>
            Carregando perfil...
          </div>
        </div>
      )}

      {/* Modal de Perfil do Usuário */}
      {perfilAberto && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px'
          }}
          onClick={() => {
            setPerfilAberto(null);
            if (resumoTextRef.current) {
              resumoTextRef.current.value = '';
            }
          }}
        >
          <div 
            style={{
              backgroundColor: '#0a0e1a',
              border: '1px solid rgba(34, 211, 238, 0.3)',
              borderRadius: '16px',
              width: '60%',
              height: '80%',
              maxWidth: '1200px',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header do Modal */}
            <div style={{
              padding: '24px',
              borderBottom: '1px solid rgba(34, 211, 238, 0.2)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'linear-gradient(to bottom, rgba(34, 211, 238, 0.1), transparent)'
            }}>
              <div>
                <h2 style={{ margin: 0, color: '#22d3ee', fontSize: '1.5rem' }}>
                  👤 Perfil do Jogador
                </h2>
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    {perfilAberto.player.nome && (
                      <span style={{ fontSize: '1.1rem', fontWeight: '600', color: '#fff' }}>
                        {perfilAberto.player.nome}
                      </span>
                    )}
                    <span style={{ fontSize: '0.95rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                      ID: {perfilAberto.player.external_id}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '24px', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)' }}>
                    {perfilAberto.player.data_cadastro && (
                      <span>
                        📅 Cadastro: {new Date(perfilAberto.player.data_cadastro).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                      </span>
                    )}
                    {perfilAberto.player.data_primeiro_deposito && (
                      <span>
                        💰 FTD: {new Date(perfilAberto.player.data_primeiro_deposito).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                      </span>
                    )}
                    {perfilAberto.player.data_aniversario && (
                      <span>
                        🎂 Aniversário: {new Date(perfilAberto.player.data_aniversario).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setPerfilAberto(null);
                  if (resumoTextRef.current) {
                    resumoTextRef.current.value = '';
                  }
                }}
                style={{
                  background: 'rgba(239, 68, 68, 0.2)',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  borderRadius: '8px',
                  color: '#ef4444',
                  fontSize: '1.2rem',
                  width: '40px',
                  height: '40px',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  fontWeight: 'bold'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.3)';
                  e.currentTarget.style.borderColor = '#ef4444';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                  e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)';
                }}
              >
                ✕
              </button>
            </div>

            {/* Conteúdo do Modal */}
            <div 
              className={styles.modalContent}
              style={{
                flex: 1,
                overflow: 'auto',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '24px'
              }}
            >
              {/* Seção de Preferências - PRIMEIRA SEÇÃO */}
              {perfilAberto.preferencias && (
                <div style={{
                  background: 'rgba(236, 72, 153, 0.05)',
                  border: '1px solid rgba(236, 72, 153, 0.2)',
                  borderRadius: '12px',
                  padding: '20px'
                }}>
                  <h3 style={{ margin: '0 0 20px 0', color: '#ec4899', fontSize: '1.2rem' }}>
                    🎮 Preferências
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                    {/* Jogos Favoritos */}
                    <div style={{
                      background: 'rgba(236, 72, 153, 0.1)',
                      border: '1px solid rgba(236, 72, 153, 0.3)',
                      borderRadius: '8px',
                      padding: '16px'
                    }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#ec4899', marginBottom: '12px' }}>
                        🎰 Jogos Favoritos
                      </div>
                      {perfilAberto.preferencias.jogos_favoritos.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: '20px', color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.85rem', lineHeight: '1.8' }}>
                          {perfilAberto.preferencias.jogos_favoritos.map((jogo, idx) => (
                            <li key={idx}>{jogo}</li>
                          ))}
                        </ul>
                      ) : (
                        <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.85rem' }}>
                          Sem dados disponíveis
                        </div>
                      )}
                    </div>

                    {/* Provedores Favoritos */}
                    <div style={{
                      background: 'rgba(168, 85, 247, 0.1)',
                      border: '1px solid rgba(168, 85, 247, 0.3)',
                      borderRadius: '8px',
                      padding: '16px'
                    }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#a855f7', marginBottom: '12px' }}>
                        🏢 Provedores Favoritos
                      </div>
                      {perfilAberto.preferencias.provedores_favoritos.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: '20px', color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.85rem', lineHeight: '1.8' }}>
                          {perfilAberto.preferencias.provedores_favoritos.map((provedor, idx) => (
                            <li key={idx}>{provedor}</li>
                          ))}
                        </ul>
                      ) : (
                        <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.85rem' }}>
                          Sem dados disponíveis
                        </div>
                      )}
                    </div>

                    {/* Tipos de Jogo */}
                    <div style={{
                      background: 'rgba(251, 191, 36, 0.1)',
                      border: '1px solid rgba(251, 191, 36, 0.3)',
                      borderRadius: '8px',
                      padding: '16px'
                    }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#fbbf24', marginBottom: '12px' }}>
                        🎯 Tipos de Jogo
                      </div>
                      {perfilAberto.preferencias.tipos_jogo.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: '20px', color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.85rem', lineHeight: '1.8' }}>
                          {perfilAberto.preferencias.tipos_jogo.map((tipo, idx) => (
                            <li key={idx}>{tipo}</li>
                          ))}
                        </ul>
                      ) : (
                        <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.85rem' }}>
                          Sem dados disponíveis
                        </div>
                      )}
                    </div>

                    {/* Time Favorito */}
                    {perfilAberto.preferencias.time_favorito && (
                      <div style={{
                        background: 'rgba(34, 211, 238, 0.1)',
                        border: '1px solid rgba(34, 211, 238, 0.3)',
                        borderRadius: '8px',
                        padding: '16px'
                      }}>
                        <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#22d3ee', marginBottom: '12px' }}>
                          ⚽ Time Favorito
                        </div>
                        <div style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.9rem', fontWeight: '500' }}>
                          {perfilAberto.preferencias.time_favorito}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Informações Rápidas */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '16px'
              }}>
                <div style={{
                  background: 'rgba(34, 211, 238, 0.1)',
                  border: '1px solid rgba(34, 211, 238, 0.3)',
                  borderRadius: '12px',
                  padding: '16px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '8px' }}>GGR Médio</div>
                  {userRole === 'admin' && (
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#22d3ee', marginBottom: '10px' }}>
                      {formatCurrencyRounded(perfilAberto.player.ggr_total)}
                    </div>
                  )}
                  <div className={styles.scoreCircle} style={{
                    '--score': calculateGGRScore(perfilAberto.player.ggr_total, perfilAberto.player.ggr_maximo, perfilAberto.player.ticket_medio),
                    '--color': getScoreColor(calculateGGRScore(perfilAberto.player.ggr_total, perfilAberto.player.ggr_maximo, perfilAberto.player.ticket_medio)),
                    margin: '0 auto',
                    width: userRole === 'atendimento' ? '65px' : '50px',
                    height: userRole === 'atendimento' ? '65px' : '50px',
                    fontSize: userRole === 'atendimento' ? '1.25rem' : '0.95rem'
                  } as React.CSSProperties}>
                    {formatScore(calculateGGRScore(perfilAberto.player.ggr_total, perfilAberto.player.ggr_maximo, perfilAberto.player.ticket_medio))}
                  </div>
                </div>
                <div style={{
                  background: 'rgba(168, 85, 247, 0.1)',
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                  borderRadius: '12px',
                  padding: '16px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '8px' }}>Atividade</div>
                  {userRole === 'admin' && (
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#a855f7', marginBottom: '10px' }}>
                      {perfilAberto.player.dias_inativo}
                    </div>
                  )}
                  <div className={styles.scoreCircle} style={{
                    '--score': calculateActivityScore(perfilAberto.player.dias_inativo),
                    '--color': getScoreColor(calculateActivityScore(perfilAberto.player.dias_inativo)),
                    margin: '0 auto',
                    width: userRole === 'atendimento' ? '65px' : '50px',
                    height: userRole === 'atendimento' ? '65px' : '50px',
                    fontSize: userRole === 'atendimento' ? '1.25rem' : '0.95rem'
                  } as React.CSSProperties}>
                    {formatScore(calculateActivityScore(perfilAberto.player.dias_inativo))}
                  </div>
                </div>
                <div style={{
                  background: 'rgba(120, 255, 163, 0.1)',
                  border: '1px solid rgba(120, 255, 163, 0.3)',
                  borderRadius: '12px',
                  padding: '16px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '8px' }}>{userRole === 'atendimento' ? 'Ticket' : 'Ticket Médio'}</div>
                  {userRole === 'admin' && (
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#78ffa3', marginBottom: '10px' }}>
                      {formatCurrencyRounded(perfilAberto.player.ticket_medio)}
                    </div>
                  )}
                  <div className={styles.scoreCircle} style={{
                    '--score': calculateTicketScore(perfilAberto.player.ticket_medio, perfilAberto.player.ticket_maximo),
                    '--color': getScoreColor(calculateTicketScore(perfilAberto.player.ticket_medio, perfilAberto.player.ticket_maximo)),
                    margin: '0 auto',
                    width: userRole === 'atendimento' ? '65px' : '50px',
                    height: userRole === 'atendimento' ? '65px' : '50px',
                    fontSize: userRole === 'atendimento' ? '1.25rem' : '0.95rem'
                  } as React.CSSProperties}>
                    {formatScore(calculateTicketScore(perfilAberto.player.ticket_medio, perfilAberto.player.ticket_maximo))}
                  </div>
                </div>
                <div style={{
                  background: 'rgba(236, 72, 153, 0.1)',
                  border: '1px solid rgba(236, 72, 153, 0.3)',
                  borderRadius: '12px',
                  padding: '16px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '8px' }}>Score Geral</div>
                  <div className={styles.scoreCircleLarge} style={{
                    '--score': Math.floor((calculateGGRScore(perfilAberto.player.ggr_total, perfilAberto.player.ggr_maximo, perfilAberto.player.ticket_medio) + calculateTicketScore(perfilAberto.player.ticket_medio, perfilAberto.player.ticket_maximo) + calculateActivityScore(perfilAberto.player.dias_inativo)) / 3),
                    '--color': getScoreColor(Math.floor((calculateGGRScore(perfilAberto.player.ggr_total, perfilAberto.player.ggr_maximo, perfilAberto.player.ticket_medio) + calculateTicketScore(perfilAberto.player.ticket_medio, perfilAberto.player.ticket_maximo) + calculateActivityScore(perfilAberto.player.dias_inativo)) / 3)),
                    margin: '10px auto',
                    width: '80px',
                    height: '80px'
                  } as React.CSSProperties}>
                    <span className={styles.scoreValue}>
                      {formatScore(Math.floor((calculateGGRScore(perfilAberto.player.ggr_total, perfilAberto.player.ggr_maximo, perfilAberto.player.ticket_medio) + calculateTicketScore(perfilAberto.player.ticket_medio, perfilAberto.player.ticket_maximo) + calculateActivityScore(perfilAberto.player.dias_inativo)) / 3))}
                    </span>
                  </div>
                </div>
              </div>

              {/* Gráfico de Score dos Últimos 30 Dias */}
              <div style={{
                background: 'rgba(34, 211, 238, 0.05)',
                border: '1px solid rgba(34, 211, 238, 0.2)',
                borderRadius: '12px',
                padding: '20px'
              }}>
                <h3 style={{ margin: '0 0 20px 0', color: '#22d3ee', fontSize: '1.2rem' }}>
                  📊 Histórico de Score (Últimos 30 Dias)
                </h3>
                {perfilAberto.scores.length > 0 ? (
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'flex-end',
                    justifyContent: 'space-between',
                    gap: '2px', 
                    height: '260px',
                    padding: '10px 0',
                    overflow: 'visible'
                  }}>
                    {perfilAberto.scores.sort((a, b) => new Date(a.data + 'T12:00:00').getTime() - new Date(b.data + 'T12:00:00').getTime()).slice(-30).map((score, idx) => {
                      const color = getScoreColor(score.score_geral);
                      const heightPercent = score.score_geral; // 0-100
                      const [ano, mes, dia] = score.data.split('-');
                      const dataFormatada = `${dia}/${mes}`;
                      
                      return (
                        <div
                          key={idx}
                          style={{
                            flex: '1',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            height: '100%',
                            minWidth: '0',
                            justifyContent: 'flex-end'
                          }}
                          title={`${dia}/${mes}/${ano}\nScore: ${score.score_geral}\nGGR: ${score.score_ggr} | Ticket: ${score.score_ticket} | Atividade: ${score.score_atividade}`}
                        >
                          {/* Valor do score acima da barra */}
                          <div style={{
                            fontSize: '0.7rem',
                            fontWeight: '700',
                            color: color,
                            marginBottom: '4px',
                            minHeight: '14px'
                          }}>
                            {score.score_geral}
                          </div>
                          {/* Área da barra - cresce para cima */}
                          <div style={{
                            width: '40%',
                            height: `${heightPercent}%`,
                            background: color,
                            borderRadius: '3px 3px 0 0',
                            transition: 'all 0.3s ease',
                            cursor: 'pointer',
                            minHeight: heightPercent > 0 ? '3px' : '0',
                            position: 'relative',
                            marginBottom: '4px'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'scaleY(1.05)';
                            e.currentTarget.style.filter = 'brightness(1.3)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'scaleY(1)';
                            e.currentTarget.style.filter = 'brightness(1)';
                          }}
                          />
                          {/* Data - sempre na mesma linha base */}
                          <div style={{
                            fontSize: '0.6rem',
                            color: 'rgba(255, 255, 255, 0.5)',
                            whiteSpace: 'nowrap',
                            writingMode: 'vertical-rl',
                            transform: 'rotate(180deg)',
                            height: 'auto',
                            lineHeight: '1',
                            marginTop: '2px'
                          }}>
                            {dataFormatada}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ 
                    textAlign: 'center', 
                    padding: '40px', 
                    color: 'rgba(255, 255, 255, 0.5)' 
                  }}>
                    📭 Nenhum histórico de score disponível
                  </div>
                )}
              </div>

              {/* Timeline de Ações */}
              <div style={{
                background: 'rgba(120, 255, 163, 0.05)',
                border: '1px solid rgba(120, 255, 163, 0.2)',
                borderRadius: '12px',
                padding: '20px'
              }}>
                <h3 style={{ margin: '0 0 20px 0', color: '#78ffa3', fontSize: '1.2rem' }}>
                  📋 Timeline de Ações
                </h3>
                
                {/* Campo para adicionar resumo */}
                <div style={{
                  marginBottom: '24px',
                  padding: '16px',
                  background: 'rgba(34, 211, 238, 0.1)',
                  border: '1px solid rgba(34, 211, 238, 0.3)',
                  borderRadius: '8px'
                }}>
                  <div style={{ marginBottom: '12px', color: '#22d3ee', fontWeight: '600' }}>
                    ✍️ Adicionar Resumo de Atendimento
                  </div>
                  <textarea
                    ref={resumoTextRef}
                    placeholder="Descreva brevemente o que foi falado no atendimento, pontos importantes como lembrete da conversa para o futuro. Utilize, no máximo, 3 linhas."
                    disabled={loadingResumo}
                    style={{
                      width: '100%',
                      minHeight: '80px',
                      padding: '12px',
                      background: 'rgba(0, 0, 0, 0.3)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '0.95rem',
                      resize: 'vertical',
                      fontFamily: 'inherit'
                    }}
                    maxLength={500}
                  />
                  <div style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    marginTop: '8px'
                  }}>
                    <button
                      onClick={handleAdicionarResumo}
                      disabled={loadingResumo}
                      style={{
                        padding: '10px 20px',
                        background: loadingResumo 
                          ? 'rgba(120, 120, 120, 0.3)' 
                          : 'rgba(34, 211, 238, 0.2)',
                        border: loadingResumo 
                          ? '1px solid rgba(120, 120, 120, 0.5)' 
                          : '1px solid #22d3ee',
                        borderRadius: '6px',
                        color: loadingResumo ? 'rgba(255, 255, 255, 0.3)' : '#22d3ee',
                        fontWeight: '600',
                        cursor: loadingResumo ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      {loadingResumo ? '⏳ Enviando...' : '📤 Enviar Resumo'}
                    </button>
                  </div>
                </div>
                
                {perfilAberto.acoes.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {perfilAberto.acoes.map((acao, idx) => {
                      const icons = {
                        bonus: '🎯',
                        experiencia: '🌟',
                        saque: '📤',
                        cashback: '💰',
                        resumo: '📝'
                      };
                      const colors = {
                        bonus: '#22d3ee',
                        experiencia: '#a855f7',
                        saque: '#fbbf24',
                        cashback: '#78ffa3',
                        resumo: '#60a5fa'
                      };
                      
                      return (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '16px',
                            padding: '12px 16px',
                            background: `rgba(${
                              colors[acao.tipo] === '#22d3ee' ? '34, 211, 238' : 
                              colors[acao.tipo] === '#a855f7' ? '168, 85, 247' : 
                              colors[acao.tipo] === '#fbbf24' ? '251, 191, 36' : 
                              colors[acao.tipo] === '#78ffa3' ? '120, 255, 163' :
                              '96, 165, 250'
                            }, 0.1)`,
                            border: `1px solid rgba(${
                              colors[acao.tipo] === '#22d3ee' ? '34, 211, 238' : 
                              colors[acao.tipo] === '#a855f7' ? '168, 85, 247' : 
                              colors[acao.tipo] === '#fbbf24' ? '251, 191, 36' : 
                              colors[acao.tipo] === '#78ffa3' ? '120, 255, 163' :
                              '96, 165, 250'
                            }, 0.3)`,
                            borderRadius: '8px'
                          }}
                        >
                          <div style={{ fontSize: '1.5rem', marginTop: '2px' }}>{icons[acao.tipo]}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: '600', color: colors[acao.tipo], textTransform: 'capitalize' }}>
                              {acao.tipo === 'experiencia' ? 'Experiência VIP' : 
                               acao.tipo === 'bonus' ? 'Bônus VIP' : 
                               acao.tipo === 'saque' ? 'Saque Registrado' : 
                               acao.tipo === 'cashback' ? 'Cashback VIP' :
                               'Resumo de Atendimento'}
                            </div>
                            {acao.valor && userRole === 'admin' && (
                              <div style={{ fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.8)' }}>
                                Valor: {formatCurrency(acao.valor)}
                              </div>
                            )}
                            {acao.detalhes && (
                              <div style={{ 
                                fontSize: '0.9rem', 
                                color: 'rgba(255, 255, 255, 0.9)', 
                                marginTop: '6px',
                                lineHeight: '1.5',
                                whiteSpace: 'pre-wrap'
                              }}>
                                {acao.detalhes}
                              </div>
                            )}
                            {acao.usuario && (
                              <div style={{ 
                                fontSize: '0.8rem', 
                                color: 'rgba(255, 255, 255, 0.5)', 
                                marginTop: '6px',
                                fontStyle: 'italic'
                              }}>
                                Por: {acao.usuario === 'admin' ? 'Administrador' : 'Atendimento'}
                              </div>
                            )}
                          </div>
                          <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', whiteSpace: 'nowrap' }}>
                            {new Date(acao.data).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ 
                    textAlign: 'center', 
                    padding: '40px', 
                    color: 'rgba(255, 255, 255, 0.5)' 
                  }}>
                    📭 Nenhuma ação registrada para este jogador
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={styles.vipContainer}>
        <div className={styles.vipHeader}>
          <h1>{`🏆 Jogadores VIP - ${activeTab === 'ativos' ? 'Ativos' : activeTab === 'inativos' ? 'Inativos' : activeTab === 'novos' ? 'Novos VIPs' : activeTab === 'google' ? 'Google' : 'Plataforma'}`}</h1>
        <div className={styles.vipControls}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginRight: '20px' }}>
            {/* Botões de Abas */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setActiveTab('ativos')}
                style={{
                  padding: '10px 24px',
                  borderRadius: '8px',
                  border: activeTab === 'ativos' ? '2px solid #78ffa3' : '1px solid rgba(255, 255, 255, 0.2)',
                  background: activeTab === 'ativos' ? 'rgba(120, 255, 163, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                  color: activeTab === 'ativos' ? '#78ffa3' : '#fff',
                  fontSize: '0.95rem',
                  fontWeight: activeTab === 'ativos' ? '600' : '500',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
              >
                Ativos
              </button>
              <button
                onClick={() => setActiveTab('inativos')}
                style={{
                  padding: '10px 24px',
                  borderRadius: '8px',
                  border: activeTab === 'inativos' ? '2px solid #fbbf24' : '1px solid rgba(255, 255, 255, 0.2)',
                  background: activeTab === 'inativos' ? 'rgba(251, 191, 36, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                  color: activeTab === 'inativos' ? '#fbbf24' : '#fff',
                  fontSize: '0.95rem',
                  fontWeight: activeTab === 'inativos' ? '600' : '500',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
              >
                Inativos
              </button>
              <button
                onClick={() => setActiveTab('novos')}
                style={{
                  padding: '10px 24px',
                  borderRadius: '8px',
                  border: activeTab === 'novos' ? '2px solid #22d3ee' : '1px solid rgba(255, 255, 255, 0.2)',
                  background: activeTab === 'novos' ? 'rgba(34, 211, 238, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                  color: activeTab === 'novos' ? '#22d3ee' : '#fff',
                  fontSize: '0.95rem',
                  fontWeight: activeTab === 'novos' ? '600' : '500',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
              >
                Novos VIPs
              </button>
              <button
                onClick={() => setActiveTab('google')}
                style={{
                  padding: '10px 24px',
                  borderRadius: '8px',
                  border: activeTab === 'google' ? '2px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.2)',
                  background: activeTab === 'google' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                  color: activeTab === 'google' ? '#3b82f6' : '#fff',
                  fontSize: '0.95rem',
                  fontWeight: activeTab === 'google' ? '600' : '500',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
              >
                Google
              </button>
              <button
                onClick={() => setActiveTab('plataforma')}
                style={{
                  padding: '10px 24px',
                  borderRadius: '8px',
                  border: activeTab === 'plataforma' ? '2px solid #a855f7' : '1px solid rgba(255, 255, 255, 0.2)',
                  background: activeTab === 'plataforma' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                  color: activeTab === 'plataforma' ? '#a855f7' : '#fff',
                  fontSize: '0.95rem',
                  fontWeight: activeTab === 'plataforma' ? '600' : '500',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
              >
                Plataforma
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.9rem' }}>
              Acumulado até:
            </label>
            <input
              type="date"
              value={tempDate}
              onChange={(e) => setTempDate(e.target.value)}
              min="2025-04-01"
              max={new Date().toISOString().split('T')[0]}
              style={{
                padding: '12px 24px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                background: 'rgba(255, 255, 255, 0.1)',
                color: '#fff',
                fontSize: '1rem',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
            />
            <button 
              onClick={() => setSelectedDate(tempDate)}
              disabled={loading || tempDate === selectedDate}
              style={{
                padding: '12px 24px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                background: tempDate !== selectedDate ? 'rgba(34, 211, 238, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                color: '#fff',
                fontSize: '1rem',
                fontWeight: '500',
                cursor: tempDate !== selectedDate ? 'pointer' : 'not-allowed',
                opacity: tempDate !== selectedDate ? 1 : 0.5,
                transition: 'all 0.3s ease'
              }}
            >
              Aplicar
            </button>
          </div>
          <button className={styles.logoutBtn} onClick={handleLogout}>
            Sair
          </button>
        </div>
      </div>

      {/* Indicador de Cache ou Dados Frescos */}
      {players.length > 0 && (
        cached && cacheAge > 0 ? (
          <div style={{
            background: 'rgba(251, 191, 36, 0.1)',
            border: '1px solid rgba(251, 191, 36, 0.3)',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: '#fbbf24'
          }}>
            <span style={{ fontSize: '1.2rem' }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <strong>Dados em Cache</strong> - Os dados foram carregados do cache há {Math.floor(cacheAge / 60)} minutos e {cacheAge % 60} segundos.
              <br />
              <span style={{ fontSize: '0.85rem', opacity: 0.9 }}>
                ⚠️ <strong>ATENÇÃO:</strong> O cache pode conter jogadores cadastrados após {selectedDate}. Clique em "Atualizar Agora" para aplicar o filtro temporal correto.
              </span>
            </div>
            <button
              onClick={() => fetchVipPlayers(true)}
              disabled={loading}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid rgba(251, 191, 36, 0.5)',
                background: 'rgba(251, 191, 36, 0.2)',
                color: '#fbbf24',
                fontSize: '0.9rem',
                fontWeight: '600',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1,
                transition: 'all 0.3s ease',
                whiteSpace: 'nowrap'
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = 'rgba(251, 191, 36, 0.3)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(251, 191, 36, 0.2)';
              }}
            >
              🔄 Atualizar Agora
            </button>
          </div>
        ) : (
          <div style={{
            background: 'rgba(120, 255, 163, 0.1)',
            border: '1px solid rgba(120, 255, 163, 0.3)',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: '#78ffa3'
          }}>
            <span style={{ fontSize: '1.2rem' }}>✅</span>
            <div style={{ flex: 1 }}>
              <strong>Dados Atualizados</strong> - Dados carregados diretamente do banco de dados (sem cache) para a data: {selectedDate}
              {userRole === 'admin' && (
                <span style={{ marginLeft: '12px', opacity: 0.6, fontSize: '0.85rem' }}>
                  [Debug: {playersSignature}]
                </span>
              )}
            </div>
          </div>
        )
      )}

      {/* Sumário e Documentação */}
      {userRole === 'admin' && (
        <div style={{
          background: 'rgba(34, 211, 238, 0.05)',
          border: '1px solid rgba(34, 211, 238, 0.2)',
          borderRadius: '12px',
        padding: '20px 25px',
        marginBottom: '30px',
        backdropFilter: 'blur(10px)'
      }}>
        <h2 style={{ 
          color: '#22d3ee', 
          fontSize: '1.3rem', 
          marginTop: 0, 
          marginBottom: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          📊 Guia do Dashboard
        </h2>
        
        <div style={{
          background: 'rgba(120, 255, 163, 0.1)',
          border: '1px solid rgba(120, 255, 163, 0.3)',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '20px',
          color: '#78ffa3',
          fontSize: '0.9rem',
          fontWeight: '500'
        }}>
          ℹ️ <strong>Filtros Aplicados:</strong>
          <br />• Todos os dados (GGR, Depósitos, Ticket, Atividade) são do período de <strong>01/04/2025 até {selectedDate}</strong>
          <br />• Apenas jogadores <strong>cadastrados até {selectedDate}</strong> aparecem na lista
          <br />• Jogadores cadastrados após {selectedDate} não são exibidos (ainda não existiam naquela data)
        </div>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
          gap: '20px',
          color: 'rgba(255, 255, 255, 0.85)',
          fontSize: '0.9rem',
          lineHeight: '1.6'
        }}>
          <div>
            <h3 style={{ color: '#78ffa3', fontSize: '1rem', marginTop: 0, marginBottom: '8px' }}>📌 Abas e Listas</h3>
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              <li><strong>Ativos / Inativos:</strong> usam listas fixas (top 100) geradas na data <strong>25/02/2026</strong>, com atualização dos dados atuais de cada jogador.</li>
              <li><strong>Ativos:</strong> jogadores com atividade ≤ 60 dias.</li>
              <li><strong>Inativos:</strong> jogadores com atividade &gt; 60 dias.</li>
              <li><strong>Novos VIPs:</strong> GGR &gt; 5.000, atividade &lt; 60 dias e fora das listas fixas de Ativos/Inativos.</li>
              <li><strong>Google:</strong> cadastros Google sem depósito (fonte dedicada dessa aba).</li>
            </ul>
          </div>

          <div>
            <h3 style={{ color: '#78ffa3', fontSize: '1rem', marginTop: 0, marginBottom: '8px' }}>📈 Métricas e Scores</h3>
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              <li><strong>GGR Médio:</strong> média do GGR dos jogadores exibidos na aba.</li>
              <li><strong>Ticket Médio:</strong> média do ticket dos jogadores exibidos.</li>
              <li><strong>Score GGR:</strong> compara GGR atual com meta (baseada em GGR máximo; para GGR ≤ 0 usa 22% do ticket).</li>
              <li><strong>Score Ticket:</strong> (ticket atual ÷ (ticket máximo × 1,1)) × 100.</li>
              <li><strong>Score Atividade:</strong> 100 - (dias inativos ÷ 28 × 100).</li>
              <li><strong>Score Total:</strong> média dos scores de GGR, Ticket e Atividade.</li>
            </ul>
          </div>

          <div>
            <h3 style={{ color: '#78ffa3', fontSize: '1rem', marginTop: 0, marginBottom: '8px' }}>🎁 Recompensas e Ações</h3>
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              <li><strong>Disponível:</strong> 5% do GGR total do período por jogador.</li>
              <li><strong>Usado:</strong> soma de recompensas já utilizadas.</li>
              <li><strong>Contato:</strong> disponível para todos; registra contato WhatsApp com cooldown de 7 dias.</li>
              <li><strong>Experiência:</strong> libera com saldo truncado ≥ R$ 1.000; envia 50% (mín. R$ 500, máx. R$ 1.000), 1x por mês.</li>
              <li><strong>Saque:</strong> registro único por jogador com envio para Google Sheets.</li>
              <li><strong>Cashback:</strong> ativação única por jogador.</li>
            </ul>
          </div>

          <div>
            <h3 style={{ color: '#78ffa3', fontSize: '1rem', marginTop: 0, marginBottom: '8px' }}>↕️ Ordenação e Exportação</h3>
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              <li><strong>Ordenação disponível:</strong> Cadastro, GGR, Atividade, Ticket, Score e Contato.</li>
              <li><strong>Coluna #:</strong> apenas índice da linha (sem ordenação).</li>
              <li><strong>CSV de IDs:</strong> botão na coluna Usuário exporta os IDs da lista exibida na aba atual.</li>
            </ul>
          </div>

          <div>
            <h3 style={{ color: '#78ffa3', fontSize: '1rem', marginTop: 0, marginBottom: '8px' }}>🎯 Cores dos Scores</h3>
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              <li><span style={{ color: '#78ffa3' }}>■</span> <strong>75-100:</strong> Excelente</li>
              <li><span style={{ color: '#22d3ee' }}>■</span> <strong>50-74:</strong> Bom</li>
              <li><span style={{ color: '#fbbf24' }}>■</span> <strong>25-49:</strong> Regular</li>
              <li><span style={{ color: '#ef4444' }}>■</span> <strong>0-24:</strong> Ruim</li>
            </ul>
          </div>
        </div>
      </div>
      )}

      <div className={styles.vipStats}>
        <div className={styles.statCard} style={{ position: 'relative' }}>
          {userRole === 'admin' && (
            <span 
              title="Jogadores com Ticket Médio ≥ R$ 1.000 e status ATIVO no período selecionado"
              style={{ 
                cursor: 'help', 
                fontSize: '0.75rem', 
                color: 'rgba(255, 255, 255, 0.5)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                borderRadius: '50%',
                width: '18px',
                height: '18px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'absolute',
                top: '12px',
                right: '12px'
              }}
            >
              i
            </span>
          )}
          <h3>Total de Jogadores VIP</h3>
          <p>{displayedPlayers.length}</p>
          <small style={{ 
            fontSize: '0.75rem', 
            opacity: 0.7, 
            display: 'block', 
            marginTop: '4px',
            color: activeTab === 'ativos' ? '#78ffa3' : activeTab === 'inativos' ? '#fbbf24' : '#22d3ee'
          }}>
            {activeTab === 'ativos' ? '✅ Ativos (≤60 dias)' : activeTab === 'inativos' ? '⚠️ Inativos (>60 dias)' : '🆕 Novos VIPs'}
          </small>
        </div>
        <div className={styles.statCard} style={{ position: 'relative' }}>
          {userRole === 'admin' && (
            <span 
              title="Média do GGR mensal de todos os jogadores VIP no período. Score baseado em GGR médio vs GGR máximo."
              style={{ 
                cursor: 'help', 
              fontSize: '0.75rem', 
              color: 'rgba(255, 255, 255, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '50%',
              width: '18px',
              height: '18px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'absolute',
              top: '12px',
              right: '12px'
            }}
          >
            i
          </span>
          )}
          <h3>GGR Médio</h3>
          <div className={styles.scoreCircleLarge} style={{
            '--score': ggrScoreMedio,
            '--color': getScoreColor(ggrScoreMedio)
          } as React.CSSProperties}>
            <span className={styles.scoreValue}>{formatScore(Math.round(ggrScoreMedio))}</span>
          </div>
          {userRole === 'admin' && (
            <p style={{ marginTop: '8px', fontSize: '0.9rem' }}>
              {formatCurrency(totalGGR / displayedPlayers.length)}
            </p>
          )}
        </div>
        <div className={styles.statCard} style={{ position: 'relative' }}>
          {userRole === 'admin' && (
            <span 
              title="Score médio de atividade. Calculado como: 100 - (dias inativos ÷ 28 × 100). Quanto menor a inatividade, maior o score."
              style={{ 
                cursor: 'help', 
              fontSize: '0.75rem', 
              color: 'rgba(255, 255, 255, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '50%',
              width: '18px',
              height: '18px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'absolute',
              top: '12px',
              right: '12px'
            }}
          >
            i
          </span>
          )}
          <h3>Atividade Geral</h3>
          <div className={styles.scoreCircleLarge} style={{
            '--score': atividadeMediaGeral,
            '--color': getScoreColor(atividadeMediaGeral)
          } as React.CSSProperties}>
            <span className={styles.scoreValue}>{formatScore(Math.round(atividadeMediaGeral))}</span>
          </div>
        </div>
        <div className={styles.statCard} style={{ position: 'relative' }}>
          {userRole === 'admin' && (
            <span 
              title="Média do ticket médio de depósito de todos os jogadores. Score: (Ticket ÷ Ticket máximo × 1.1) × 100."
              style={{ 
                cursor: 'help', 
              fontSize: '0.75rem', 
              color: 'rgba(255, 255, 255, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '50%',
              width: '18px',
              height: '18px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'absolute',
              top: '12px',
              right: '12px'
            }}
          >
            i
          </span>
          )}
          <h3>{userRole === 'atendimento' ? 'Ticket' : 'Ticket Médio'}</h3>
          <div className={styles.scoreCircleLarge} style={{
            '--score': ticketScoreMedio,
            '--color': getScoreColor(ticketScoreMedio)
          } as React.CSSProperties}>
            <span className={styles.scoreValue}>{formatScore(Math.round(ticketScoreMedio))}</span>
          </div>
          {userRole === 'admin' && (
            <p style={{ marginTop: '8px', fontSize: '0.9rem' }}>
              {formatCurrency(ticketMedioGeral)}
            </p>
          )}
        </div>
        <div className={styles.statCard} style={{ position: 'relative' }}>
          {userRole === 'admin' && (
            <span 
              title="Média aritmética dos 3 scores: (Score GGR + Score Atividade + Score Ticket) ÷ 3. Representa desempenho geral."
              style={{ 
                cursor: 'help', 
              fontSize: '0.75rem', 
              color: 'rgba(255, 255, 255, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '50%',
              width: '18px',
              height: '18px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'absolute',
              top: '12px',
              right: '12px'
            }}
          >
            i
          </span>
          )}
          <h3>Score Total</h3>
          <div className={styles.scoreCircleLarge} style={{
            '--score': scoreTotalMedio,
            '--color': getScoreColor(scoreTotalMedio)
          } as React.CSSProperties}>
            <span className={styles.scoreValue}>{formatScore(scoreTotalMedio)}</span>
          </div>
        </div>
        {userRole === 'admin' && (
          <div className={styles.statCard} style={{ position: 'relative' }}>
            <span 
              title="Disponível: 5% do GGR total do período menos valor já usado. Usado: Soma de bônus, freespins e smartico utilizados."
              style={{ 
                cursor: 'help', 
                fontSize: '0.75rem', 
                color: 'rgba(255, 255, 255, 0.5)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                borderRadius: '50%',
                width: '18px',
                height: '18px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'absolute',
                top: '12px',
                right: '12px'
              }}
            >
              i
            </span>
            <h3>💰 Recompensas</h3>
            <div style={{ marginTop: '10px' }}>
              <div style={{ marginBottom: '14px' }}>
                <span style={{ color: '#78ffa3', fontSize: '0.9rem', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Disponível</span>
                <p style={{ fontSize: '1.3rem', fontWeight: '700', color: '#78ffa3', margin: '0' }}>
                  {formatCurrencyRounded(saldoRestante)}
                </p>
              </div>
              <div>
                <span style={{ color: '#ef4444', fontSize: '0.9rem', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Usado</span>
                <p style={{ fontSize: '1.3rem', fontWeight: '700', color: '#ef4444', margin: '0' }}>
                  {formatCurrencyRounded(totalUsado)}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className={styles.loading}>Carregando dados...</div>
      ) : (
        <div className={styles.vipTableContainer} style={{
          maxHeight: '730px',
          overflowY: 'auto'
        }}>
          <table className={`${styles.vipTable}${activeTab === 'plataforma' && userRole === 'admin' ? ` ${styles.vipTable9cols}` : ''}`}>
            <thead>
              <tr>
                <th style={{ color: '#22d3ee' }}>
                  #
                </th>
                <th
                  onClick={() => handleSort('cadastro')}
                  style={{ cursor: 'pointer', userSelect: 'none', color: sortBy === 'cadastro' ? '#78ffa3' : '#22d3ee' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-start' }}>
                    <span>Usuário <span style={{ color: sortBy === 'cadastro' ? '#78ffa3' : 'rgba(255,255,255,0.4)' }}>⇅</span></span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation(); // Evita trigger do sort
                        downloadIdsCSV();
                      }}
                      title="Baixar lista de IDs (CSV)"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'rgba(34, 211, 238, 0.7)',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        padding: '2px 4px',
                        transition: 'all 0.2s',
                        lineHeight: 1
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = '#22d3ee'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(34, 211, 238, 0.7)'}
                    >
                      ↓
                    </button>
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('ggr')} 
                  style={{ cursor: 'pointer', userSelect: 'none', color: sortBy === 'ggr' ? '#78ffa3' : '#22d3ee' }}
                >
                  GGR <span style={{ color: sortBy === 'ggr' ? '#78ffa3' : 'rgba(255,255,255,0.4)' }}>⇅</span>
                </th>
                <th 
                  onClick={() => handleSort('atividade')} 
                  style={{ cursor: 'pointer', userSelect: 'none', color: sortBy === 'atividade' ? '#78ffa3' : '#22d3ee' }}
                >
                  Atividade <span style={{ color: sortBy === 'atividade' ? '#78ffa3' : 'rgba(255,255,255,0.4)' }}>⇅</span>
                </th>
                <th 
                  onClick={() => handleSort('ticket')} 
                  style={{ cursor: 'pointer', userSelect: 'none', color: sortBy === 'ticket' ? '#78ffa3' : '#22d3ee' }}
                >
                  {userRole === 'atendimento' ? 'Ticket' : 'Ticket Médio'} <span style={{ color: sortBy === 'ticket' ? '#78ffa3' : 'rgba(255,255,255,0.4)' }}>⇅</span>
                </th>
                <th 
                  onClick={() => handleSort('score')} 
                  style={{ cursor: 'pointer', userSelect: 'none', color: sortBy === 'score' ? '#78ffa3' : '#22d3ee' }}
                >
                  Score <span style={{ color: sortBy === 'score' ? '#78ffa3' : 'rgba(255,255,255,0.4)' }}>⇅</span>
                </th>
                <th
                  onClick={() => handleSort('bonus')}
                  style={{ cursor: 'pointer', userSelect: 'none', color: sortBy === 'bonus' ? '#78ffa3' : '#22d3ee' }}
                >
                  Contato <span style={{ color: sortBy === 'bonus' ? '#78ffa3' : 'rgba(255,255,255,0.4)' }}>⇅</span>
                </th>
                {activeTab === 'plataforma' && userRole === 'admin' && <th>Sem FTD</th>}
                <th>Saque</th>
              </tr>
            </thead>
            <tbody>
              {displayedPlayers.length === 0 ? (
                <tr>
                  <td colSpan={activeTab === 'plataforma' && userRole === 'admin' ? 9 : 8} style={{ textAlign: 'center', padding: '40px' }}>
                    Nenhum jogador VIP encontrado neste período
                  </td>
                </tr>
              ) : (
                displayedPlayers.map((player, index) => {
                  const ggrScore = calculateGGRScore(player.ggr_total, player.ggr_maximo, player.ticket_medio);
                  const ticketScore = calculateTicketScore(player.ticket_medio, player.ticket_maximo);
                  const activityScore = calculateActivityScore(player.dias_inativo);
                  const scoreGeral = Math.round((ggrScore + activityScore + ticketScore) / 3);
                  
                  // Calcula 5% do GGR total do período para bônus e exp (ambos recebem o valor completo)
                  // Se GGR <= 0, não há valor disponível
                  const valorBonus = player.ggr_total_periodo > 0 ? player.ggr_total_periodo * 0.05 : 0;
                  const valorExp = player.ggr_total_periodo > 0 ? player.ggr_total_periodo * 0.05 : 0;
                  const bonusDisponivel = Math.max(0, valorBonus - player.recompensas_usadas);
                  const expDisponivel = Math.max(0, valorExp - player.recompensas_usadas);
                  
                  // Truncar centavos (não arredondar): 9.99 vira 9
                  const bonusDisponivel_truncado = Math.floor(bonusDisponivel);
                  const expDisponivel_truncado = Math.floor(expDisponivel);
                  
                  const emCooldownBonus = isEmCooldownSeteDias(player);
                  // Verificar se pode ativar (apenas cooldown de 7 dias - disponível para todos)
                  const podeAtivarBonus = !emCooldownBonus;
                  
                  // Verificar se pode ativar experiência (>= R$ 1.000 E não ativado este mês)
                  const podeAtivarExperiencia = expDisponivel_truncado >= 1000 && !isPodeAtivarExperienciaEsteMes(player);
                  
                  function isEmCooldownSeteDias(p: VipPlayer): boolean {
                    if (!p.bonus_vip_data) return false;
                    
                    const dataAtivacao = new Date(p.bonus_vip_data);
                    if (isNaN(dataAtivacao.getTime())) return false;
                    const agora = new Date();
                    
                    // Calcular 7 dias após a ativação
                    const proximoPermitido = new Date(dataAtivacao);
                    proximoPermitido.setDate(proximoPermitido.getDate() + 7);
                    
                    return agora < proximoPermitido;
                  }
                  
                  function getDiasFaltamCooldown(p: VipPlayer): number {
                    if (!p.bonus_vip_data) return 0;
                    
                    const dataAtivacao = new Date(p.bonus_vip_data);
                    if (isNaN(dataAtivacao.getTime())) return 0;
                    const agora = new Date();
                    const proximoPermitido = new Date(dataAtivacao);
                    proximoPermitido.setDate(proximoPermitido.getDate() + 7);
                    
                    const diasFaltam = Math.ceil((proximoPermitido.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24));
                    return Math.max(0, diasFaltam);
                  }

                  function getDataDisponivelBonus(p: VipPlayer): string | null {
                    if (!p.bonus_vip_data) return null;

                    const dataAtivacao = new Date(p.bonus_vip_data);
                    if (isNaN(dataAtivacao.getTime())) return null;

                    const proximoPermitido = new Date(dataAtivacao);
                    proximoPermitido.setDate(proximoPermitido.getDate() + 7);

                    return formatDate(proximoPermitido.toISOString());
                  }
                  
                  const diasFaltamBonus = getDiasFaltamCooldown(player);
                  const dataDisponivelBonus = getDataDisponivelBonus(player);
                  const tooltipBonus = !podeAtivarBonus && diasFaltamBonus > 0
                    ? `Aguarde ${diasFaltamBonus} dia(s). Disponível em: ${dataDisponivelBonus || '7 dias após ativação'}`
                    : 'Clique para registrar contato WhatsApp';
                  
                  function isPodeAtivarExperienciaEsteMes(p: VipPlayer): boolean {
                    if (!p.experiencia_vip_ativado || !p.experiencia_vip_data) return false;
                    
                    const dataAtivacao = new Date(p.experiencia_vip_data);
                    const agora = new Date();
                    
                    // Verificar se ativou no mesmo mês/ano
                    return dataAtivacao.getMonth() === agora.getMonth() && 
                           dataAtivacao.getFullYear() === agora.getFullYear();
                  }
                  
                  return (
                  <tr key={index}>
                    <td style={{ color: 'rgba(34, 211, 238, 0.8)', fontWeight: '600' }}>
                      {index + 1}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div 
                          style={{ flex: 1, cursor: 'pointer' }}
                          onClick={() => handleAbrirPerfil(player)}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = '0.7';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = '1';
                          }}
                        >
                          {player.nome && (
                            <>
                              <strong style={{ fontSize: '0.95rem' }}>{player.nome}</strong>
                              <br />
                            </>
                          )}
                          <span style={{ 
                            fontSize: player.nome ? '0.85rem' : '1rem', 
                            opacity: player.nome ? 0.7 : 1,
                            color: player.origem === 'google' ? '#3b82f6' : 'inherit'
                          }}>
                            {player.external_id}
                          </span>
                          <br />
                          <small style={{ opacity: 0.7, fontSize: '0.85rem' }}>
                            Cadastro: {formatDateOnly(player.data_cadastro)}
                          </small>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', position: 'relative' }}>
                          <button
                            style={{
                              background: 'transparent',
                              border: 'none',
                              cursor: loadingWhatsapp === player.external_id ? 'wait' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.3s ease',
                              flexShrink: 0,
                              padding: '4px',
                              opacity: loadingWhatsapp === player.external_id ? 0.5 : 1
                            }}
                            onMouseOver={(e) => {
                              if (loadingWhatsapp !== player.external_id) {
                                e.currentTarget.style.transform = 'scale(1.15)';
                                e.currentTarget.style.opacity = '0.8';
                              }
                            }}
                            onMouseOut={(e) => {
                              if (loadingWhatsapp !== player.external_id) {
                                e.currentTarget.style.transform = 'scale(1)';
                                e.currentTarget.style.opacity = '1';
                              }
                            }}
                            onClick={(e) => { e.stopPropagation(); handleWhatsappClick(player.external_id, player.nome); }}
                            disabled={loadingWhatsapp === player.external_id}
                            title={loadingWhatsapp === player.external_id ? 'Abrindo chat...' : 'Escolher plataforma'}
                          >
                            {loadingWhatsapp === player.external_id ? (
                              <div style={{
                                width: '24px',
                                height: '24px',
                                border: '3px solid rgba(34, 211, 238, 0.3)',
                                borderTop: '3px solid #22d3ee',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite'
                              }} />
                            ) : (
                              <img
                                src="/icons/whatsapp.webp"
                                alt="WhatsApp"
                                style={{ width: '24px', height: '24px', objectFit: 'contain' }}
                              />
                            )}
                          </button>
                          {platformMenu?.id === player.external_id && (
                            <div style={{
                              position: 'absolute',
                              top: '100%',
                              right: 0,
                              marginTop: '4px',
                              background: '#1e1e2e',
                              border: '1px solid rgba(255,255,255,0.15)',
                              borderRadius: '8px',
                              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                              zIndex: 100,
                              minWidth: '150px',
                              overflow: 'hidden',
                            }}>
                              <button
                                onClick={() => handleAbrirDigisac(player.external_id, player.nome)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  width: '100%',
                                  padding: '10px 14px',
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#e2e8f0',
                                  fontSize: '0.85rem',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                                onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(34, 211, 238, 0.15)'; }}
                                onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
                              >
                                <span style={{ fontSize: '1.1rem' }}>💬</span>
                                Digisac
                              </button>
                              <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)' }} />
                              <button
                                onClick={() => handleAbrirChatwoot(player.external_id, player.nome)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  width: '100%',
                                  padding: '10px 14px',
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#e2e8f0',
                                  fontSize: '0.85rem',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                                onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.15)'; }}
                                onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
                              >
                                <span style={{ fontSize: '1.1rem' }}>🟢</span>
                                Chatwoot
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={styles.ggrCell} style={userRole === 'atendimento' ? { textAlign: 'center' } : undefined}>
                      {userRole === 'admin' && (
                        <>{formatCurrencyRounded(player.ggr_total)} - </>
                      )}
                      <span className={styles.scoreCircle} style={{ 
                        '--score': ggrScore, 
                        '--color': getScoreColor(ggrScore) 
                      } as React.CSSProperties}>
                        {formatScore(ggrScore)}
                      </span>
                      {userRole === 'admin' ? (
                        <>
                          <br />
                          <small style={{ 
                            opacity: 0.8, 
                            fontSize: '0.85rem',
                            color: player.ggr_total_periodo < 0 ? '#ef4444' : '#22d3ee'
                          }}>
                            Total: {formatCurrencyRounded(player.ggr_total_periodo)}
                          </small>
                        </>
                      ) : (
                        <>
                          <br />
                          <small style={{ 
                            opacity: 0.7, 
                            fontSize: '0.75rem',
                            color: 'rgba(255, 255, 255, 0.6)'
                          }}>
                            Rendimento
                          </small>
                        </>
                      )}
                    </td>
                    <td className={getActivityClass(player.dias_inativo)}>
                      {getActivityLabel(player.dias_inativo)} - 
                      <span className={styles.scoreCircle} style={{ 
                        '--score': activityScore, 
                        '--color': getScoreColor(activityScore) 
                      } as React.CSSProperties}>
                        {formatScore(activityScore)}
                      </span>
                      <br />
                      <small style={{ opacity: 0.7 }}>{formatDate(player.ultima_atividade)}</small>
                    </td>
                    <td style={userRole === 'atendimento' ? { textAlign: 'center' } : undefined}>
                      {userRole === 'admin' && (
                        <>{formatCurrencyRounded(player.ticket_medio)} - </>
                      )}
                      <span className={styles.scoreCircle} style={{ 
                        '--score': ticketScore, 
                        '--color': getScoreColor(ticketScore) 
                      } as React.CSSProperties}>
                        {formatScore(ticketScore)}
                      </span>
                      {userRole === 'admin' ? (
                        <>
                          <br />
                          <small style={{ 
                            color: player.deposito_total_periodo >= 0 ? 'rgba(34, 211, 238, 0.7)' : 'rgba(239, 68, 68, 0.7)',
                            fontSize: '0.85rem',
                            fontWeight: '500'
                          }}>
                            Total: {formatCurrencyRounded(player.deposito_total_periodo)}
                          </small>
                        </>
                      ) : (
                        <>
                          <br />
                          <small style={{ 
                            opacity: 0.7, 
                            fontSize: '0.75rem',
                            color: 'rgba(255, 255, 255, 0.6)',
                            fontWeight: '700'
                          }}>
                            Depósitos
                          </small>
                        </>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={styles.scoreCircle} style={{ 
                        '--score': scoreGeral, 
                        '--color': getScoreColor(scoreGeral) 
                      } as React.CSSProperties}>
                        {formatScore(scoreGeral)}
                      </span>
                      <br />
                      <small style={{ 
                        opacity: 0.7, 
                        fontSize: '0.75rem',
                        color: 'rgba(255, 255, 255, 0.6)',
                        display: 'block',
                        marginTop: '4px',
                        fontWeight: userRole === 'atendimento' ? '700' : 'normal'
                      }}>
                        Média Geral
                      </small>
                    </td>
                    <td style={{ 
                      fontWeight: '600',
                      textAlign: 'center',
                      verticalAlign: 'middle'
                    }}>
                      {userRole === 'admin' && (
                        <div style={{ fontSize: '0.9rem', color: '#78ffa3', lineHeight: '1.4' }}>
                          {formatCurrencyRounded(bonusDisponivel)}
                        </div>
                      )}
                      <div style={{ fontSize: '0.9rem', lineHeight: '1.4', height: '1.4em', visibility: 'hidden' }}>
                        &nbsp;
                      </div>
                      <button
                        title={tooltipBonus}
                        disabled={!podeAtivarBonus || loadingBonus === player.external_id}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          border: emCooldownBonus
                            ? '1px solid rgba(120, 255, 163, 0.5)'
                            : loadingBonus === player.external_id
                            ? '1px solid rgba(251, 191, 36, 0.5)'
                            : '1px solid rgba(34, 211, 238, 0.5)',
                          background: emCooldownBonus
                            ? 'rgba(120, 255, 163, 0.1)'
                            : loadingBonus === player.external_id
                            ? 'rgba(251, 191, 36, 0.1)'
                            : 'rgba(34, 211, 238, 0.1)',
                          color: emCooldownBonus
                            ? '#78ffa3'
                            : loadingBonus === player.external_id
                            ? '#fbbf24'
                            : '#22d3ee',
                          fontSize: '0.85rem',
                          fontWeight: '600',
                          cursor: podeAtivarBonus ? 'pointer' : 'not-allowed',
                          transition: 'all 0.3s ease',
                          margin: '4px 0',
                          opacity: emCooldownBonus ? 0.7 : 1,
                          width: '85px'
                        }}
                        onMouseOver={(e) => {
                          if (!emCooldownBonus && loadingBonus !== player.external_id && podeAtivarBonus) {
                            e.currentTarget.style.background = 'rgba(34, 211, 238, 0.2)';
                            e.currentTarget.style.borderColor = '#22d3ee';
                          }
                        }}
                        onMouseOut={(e) => {
                          if (!emCooldownBonus && loadingBonus !== player.external_id && podeAtivarBonus) {
                            e.currentTarget.style.background = 'rgba(34, 211, 238, 0.1)';
                            e.currentTarget.style.borderColor = 'rgba(34, 211, 238, 0.5)';
                          }
                        }}
                        onClick={() => podeAtivarBonus && handleAtivarBonus(player.external_id, bonusDisponivel)}
                      >
                        {emCooldownBonus
                          ? 'Ativado'
                          : loadingBonus === player.external_id
                          ? 'Ativando...'
                          : 'Ativar'}
                      </button>
                      <div style={{
                        fontSize: '0.9rem',
                        color: '#78ffa3',
                        lineHeight: '1.4',
                        height: '1.4em',
                        opacity: 0.8
                      }}>
                        {player.bonus_vip_data ? (
                          new Date(player.bonus_vip_data).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric'
                          })
                        ) : '\u00A0'}
                      </div>
                      {userRole === 'admin' && (
                        <div style={{ 
                          fontSize: '0.9rem',
                          color: '#ef4444',
                          fontWeight: '600',
                          lineHeight: '1.4'
                        }}>
                          {formatCurrencyRounded(player.recompensas_usadas)}
                        </div>
                      )}
                    </td>
                    {activeTab === 'plataforma' && userRole === 'admin' && (() => {
                      const semFtdEnviado = player.sem_ftd_ativado;
                      return (
                      <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                        <div style={{ fontSize: '0.9rem', lineHeight: '1.4', height: '1.4em', visibility: 'hidden' }}>&nbsp;</div>
                        <button
                          disabled={semFtdEnviado || loadingSemFtd === player.external_id}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            border: semFtdEnviado
                              ? '1px solid rgba(120, 255, 163, 0.5)'
                              : loadingSemFtd === player.external_id
                              ? '1px solid rgba(251, 191, 36, 0.5)'
                              : '1px solid rgba(34, 211, 238, 0.5)',
                            background: semFtdEnviado
                              ? 'rgba(120, 255, 163, 0.1)'
                              : loadingSemFtd === player.external_id
                              ? 'rgba(251, 191, 36, 0.1)'
                              : 'rgba(34, 211, 238, 0.1)',
                            color: semFtdEnviado
                              ? '#78ffa3'
                              : loadingSemFtd === player.external_id
                              ? '#fbbf24'
                              : '#22d3ee',
                            fontSize: '0.85rem',
                            fontWeight: '600',
                            cursor: semFtdEnviado ? 'not-allowed' : 'pointer',
                            transition: 'all 0.3s ease',
                            margin: '4px 0',
                            opacity: semFtdEnviado ? 0.7 : 1,
                            width: '85px'
                          }}
                          onMouseOver={(e) => {
                            if (!semFtdEnviado && loadingSemFtd !== player.external_id) {
                              e.currentTarget.style.background = 'rgba(34, 211, 238, 0.2)';
                              e.currentTarget.style.borderColor = '#22d3ee';
                            }
                          }}
                          onMouseOut={(e) => {
                            if (!semFtdEnviado && loadingSemFtd !== player.external_id) {
                              e.currentTarget.style.background = 'rgba(34, 211, 238, 0.1)';
                              e.currentTarget.style.borderColor = 'rgba(34, 211, 238, 0.5)';
                            }
                          }}
                          onClick={() => !semFtdEnviado && handleEnviarSemFtd(player.external_id)}
                        >
                          {semFtdEnviado
                            ? 'Enviado'
                            : loadingSemFtd === player.external_id
                            ? 'Enviando...'
                            : 'Enviar'}
                        </button>
                        <div style={{
                          fontSize: '0.9rem',
                          color: '#78ffa3',
                          lineHeight: '1.4',
                          height: '1.4em',
                          opacity: 0.8
                        }}>
                          {player.sem_ftd_data ? (
                            new Date(player.sem_ftd_data).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric'
                            })
                          ) : '\u00A0'}
                        </div>
                      </td>
                      );
                    })()}
                    <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                      <div style={{ fontSize: '0.9rem', lineHeight: '1.4', height: '1.4em', visibility: 'hidden' }}>
                        &nbsp;
                      </div>
                      <button
                        disabled={player.saque_vip_ativado || loadingSaque === player.external_id}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          border: player.saque_vip_ativado 
                            ? '1px solid rgba(120, 255, 163, 0.5)' 
                            : '1px solid rgba(34, 211, 238, 0.5)',
                          background: player.saque_vip_ativado
                            ? 'rgba(120, 255, 163, 0.1)'
                            : loadingSaque === player.external_id
                            ? 'rgba(251, 191, 36, 0.1)'
                            : 'rgba(34, 211, 238, 0.1)',
                          color: player.saque_vip_ativado
                            ? '#78ffa3'
                            : loadingSaque === player.external_id
                            ? '#fbbf24'
                            : '#22d3ee',
                          fontSize: '0.85rem',
                          fontWeight: '600',
                          cursor: player.saque_vip_ativado || loadingSaque ? 'not-allowed' : 'pointer',
                          transition: 'all 0.3s ease',
                          opacity: player.saque_vip_ativado ? 0.7 : 1,
                          margin: '4px 0',
                          width: '85px'
                        }}
                        onMouseOver={(e) => {
                          if (!player.saque_vip_ativado && !loadingSaque) {
                            e.currentTarget.style.background = 'rgba(34, 211, 238, 0.2)';
                            e.currentTarget.style.borderColor = '#22d3ee';
                          }
                        }}
                        onMouseOut={(e) => {
                          if (!player.saque_vip_ativado && !loadingSaque) {
                            e.currentTarget.style.background = 'rgba(34, 211, 238, 0.1)';
                            e.currentTarget.style.borderColor = 'rgba(34, 211, 238, 0.5)';
                          }
                        }}
                        onClick={() => !player.saque_vip_ativado && handleRegistrarSaque(player)}
                      >
                        {player.saque_vip_ativado 
                          ? 'Ativado' 
                          : loadingSaque === player.external_id
                          ? 'Ativando...'
                          : 'Ativar'}
                      </button>
                      <div style={{
                        fontSize: '0.9rem',
                        color: '#78ffa3',
                        lineHeight: '1.4',
                        height: '1.4em',
                        opacity: 0.8
                      }}>
                        {player.saque_vip_ativado && player.saque_vip_data ? (
                          new Date(player.saque_vip_data).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric'
                          })
                        ) : '\u00A0'}
                      </div>
                    </td>
                    <td style={{ 
                      fontWeight: '600',
                      textAlign: 'center',
                      verticalAlign: 'middle'
                    }}>
                      <div style={{ fontSize: '0.9rem', lineHeight: '1.4', height: '1.4em', visibility: 'hidden' }}>
                        &nbsp;
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Graficos - Admin Only */}
      {userRole === 'admin' && (
        <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <MonthlyDepositsChart
            data={monthlyDepositsData}
            loading={monthlyDepositsLoading}
            tabColor="#78ffa3"
          />
          <MonthlyGgrChart
            data={monthlyGgrData}
            loading={monthlyGgrLoading}
            tabColor="#78ffa3"
          />
        </div>
      )}

      </div>
    </>
  );
}
