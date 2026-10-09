import { NextResponse } from 'next/server';
import { BigQuery } from '@google-cloud/bigquery';
import pool from '@/lib/db';
import { getMapeamentos, converterIdsParaNomes as convertIds } from '@/lib/cache-mapeamentos';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Timeout de 120s para Vercel (queries VIP pesadas)

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
  conexao: string | null;
}

interface SmarticoPreferencias {
  external_id: string;
  nome: string | null;
  jogo: string | null;
  provedor: string | null;
  produto_favorito: string | null;
  tipo_jogo: string | null;
  data_aniversario: string | null;
}

// Cache em memória com TTL de 2 horas (por data)
// Cache agressivo já que dados VIP mudam lentamente
// IMPORTANTE: Limpar cache após mudanças na query
let cacheData: Map<string, { data: VipPlayer[]; timestamp: number }> = new Map();
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 horas

// Cache de queries parciais para acelerar recalculos
let partialCache: Map<string, any> = new Map();

/**
 * Formata nome para padrão Digisac: PRIMEIRO L.
 * Exemplos:
 * - "ANDRE LUIZ SILVA" -> "ANDRE L."
 * - "MARIA" -> "MARIA"
 * - "JOÃO PEDRO SANTOS" -> "JOÃO P."
 */
function formatarNomeDigisac(nomeCompleto: string | null): string | null {
  if (!nomeCompleto) return null;
  
  const partes = nomeCompleto.trim().toUpperCase().split(/\s+/);
  
  if (partes.length === 1) {
    // Apenas um nome: retorna como está
    return partes[0];
  }
  
  // Primeiro nome + primeira letra do segundo nome + ponto
  const primeiroNome = partes[0];
  const segundaLetra = partes[1][0];
  
  return `${primeiroNome} ${segundaLetra}.`;
}

function getBigQueryClient() {
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const projectId = process.env.GOOGLE_PROJECT_ID;
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  
  if (!privateKey || !projectId || !clientEmail) {
    throw new Error('Credenciais do BigQuery não configuradas');
  }
  
  return new BigQuery({
    projectId,
    credentials: {
      client_email: clientEmail,
      private_key: privateKey
    }
  });
}

function normalizarCampoPreferencia(value: unknown): string | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    // Retorna os IDs como string por enquanto
    return value.slice(0, 3).map(v => String(v)).join(', ');
  }
  return String(value);
}

/**
 * ⚠️ DEPRECATED - Use getMapeamentos() do cache-mapeamentos.ts
 * 
 * Esta função fazia queries diretas ao BigQuery (~50 GB/mês)
 * Nova função usa cache (PostgreSQL + Memória) = ~0 GB/mês
 */

/**
 * ⚠️ DEPRECATED - Use converterIdsParaNomes() do cache-mapeamentos.ts
 */
function converterIdsParaNomes(idsString: string | null, mapping: Map<number, string>): string | null {
  if (!idsString) return null;
  
  try {
    const ids = idsString.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    const nomes = ids
      .map(id => mapping.get(id) || `ID:${id}`)
      .filter(nome => nome !== null);
    
    return nomes.length > 0 ? nomes.join(', ') : null;
  } catch (error) {
    console.error(`[CONVERSAO] Erro ao converter IDs '${idsString}':`, error);
    return idsString; // Retorna original em caso de erro
  }
}

function formatarDataSmartico(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'object' && value && 'value' in (value as any)) {
    return String((value as any).value);
  }
  return String(value);
}

/**
 * ⚠️ DEPRECATED - Esta função faz query ao BigQuery j_user (~5-10 GB/mês)
 * 
 * NÃO DEVE SER USADA no endpoint do dashboard!
 * Preferências já são sincronizadas pelo CRON DAILY.
 * 
 * Esta função é mantida apenas para o CRON DAILY.
 */
async function buscarPreferenciasSmartico(externalIds: string[]): Promise<SmarticoPreferencias[]> {
  if (externalIds.length === 0) return [];
  
  const labelId = process.env.SMARTICO_LABEL_ID;
  if (!labelId) {
    console.warn('[SMARTICO PREFS] SMARTICO_LABEL_ID não configurado');
    return [];
  }
  
  const client = getBigQueryClient();
  const dataset = `dwh_ext_${labelId}`;
  
  // ✅ Carregar mapeamentos do CACHE (PostgreSQL + Memória)
  const mappings = await getMapeamentos(client, labelId);
  console.log('[SMARTICO PREFS] ✅ Mapeamentos carregados do cache');
  
  const batchSize = 200;
  const resultados: SmarticoPreferencias[] = [];
  
  for (let i = 0; i < externalIds.length; i += batchSize) {
    const batch = externalIds.slice(i, i + batchSize);
    
    const query = `
      SELECT 
        user_ext_id,
        user_birthdate,
        core_fav_product_type,
        core_fav_game_top3,
        core_fav_game_type_top3,
        core_fav_game_provider_top3
      FROM \`smartico-bq3.${dataset}.j_user\`
      WHERE user_ext_id IN UNNEST(@external_ids)
    `;
    
    const [rows] = await client.query({
      query,
      params: { external_ids: batch }
    });
    
    for (const row of rows as any[]) {
      // Normalizar para strings de IDs primeiro
      const jogosIds = normalizarCampoPreferencia(row.core_fav_game_top3);
      const provedoresIds = normalizarCampoPreferencia(row.core_fav_game_provider_top3);
      const tiposIds = normalizarCampoPreferencia(row.core_fav_game_type_top3);
      
      // ✅ Converter IDs em nomes usando cache
      const jogo = convertIds(jogosIds, mappings.gamesMap);
      const provedor = convertIds(provedoresIds, mappings.providersMap);
      const tipoJogo = convertIds(tiposIds, mappings.typesMap);
      
      resultados.push({
        external_id: row.user_ext_id,
        nome: null,
        jogo,
        provedor,
        produto_favorito: normalizarCampoPreferencia(row.core_fav_product_type),
        tipo_jogo: tipoJogo,
        data_aniversario: formatarDataSmartico(row.user_birthdate)
      });
    }
  }
  
  return resultados;
}

async function sincronizarPreferenciasVip(novosVips: VipPlayer[]): Promise<void> {
  try {
    if (novosVips.length === 0) return;
    
    console.log('[SMARTICO PREFS] Buscando preferencias dos novos VIPs...');
    const externalIds = novosVips.map(v => v.external_id);
    
    const preferencias = await buscarPreferenciasSmartico(externalIds);
    if (preferencias.length === 0) {
      console.log('[SMARTICO PREFS] Nenhuma preferencia encontrada');
      return;
    }
    
    console.log(`[SMARTICO PREFS] ${preferencias.length} registros encontrados`);
    
    // Buscar nomes dos jogadores (em uma única query para todos os VIPs sem nome)
    console.log('[SMARTICO PREFS] Buscando nomes dos jogadores...');
    const nomesMap = new Map<string, string>();
    const vipsSemNome = novosVips.filter(v => !v.nome).map(v => v.external_id);
    
    // Adicionar VIPs que já têm nome ao mapa
    for (const vip of novosVips) {
      if (vip.nome) {
        nomesMap.set(vip.external_id, vip.nome);
      }
    }
    
    // Buscar nomes faltantes em uma única query
    if (vipsSemNome.length > 0) {
      try {
        const nomesResult = await pool.query(
          `SELECT external_id, nome FROM preferencias_jogadores WHERE external_id = ANY($1::text[])`,
          [vipsSemNome]
        );
        
        for (const row of nomesResult.rows) {
          if (row.nome) {
            nomesMap.set(row.external_id, row.nome);
          }
        }
      } catch (err) {
        console.error('[SMARTICO PREFS] Erro ao buscar nomes:', err);
      }
    }
    
    console.log(`[SMARTICO PREFS] ${nomesMap.size} nomes encontrados`);
    
    const batchSize = 200;
    for (let i = 0; i < preferencias.length; i += batchSize) {
      const batch = preferencias.slice(i, i + batchSize);
      const values = batch.map((_, idx) => {
        const offset = idx * 7;
        return `($${offset + 1}::uuid, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}::date, CURRENT_TIMESTAMP)`;
      }).join(', ');
      
      const params = batch.flatMap(p => [
        p.external_id,
        nomesMap.get(p.external_id) || 'DESCONHECIDO',
        p.jogo,
        p.provedor,
        p.produto_favorito,
        p.tipo_jogo,
        p.data_aniversario
      ]);
      
      await pool.query(`
        INSERT INTO nomes_usuarios (external_id, nome, jogo, provedor, produto_favorito, tipo_jogo, data_aniversario, atualizado_em)
        VALUES ${values}
        ON CONFLICT (external_id) DO UPDATE SET
          nome = COALESCE(EXCLUDED.nome, nomes_usuarios.nome),
          jogo = EXCLUDED.jogo,
          provedor = EXCLUDED.provedor,
          produto_favorito = EXCLUDED.produto_favorito,
          tipo_jogo = EXCLUDED.tipo_jogo,
          data_aniversario = EXCLUDED.data_aniversario,
          atualizado_em = CURRENT_TIMESTAMP
      `, params);
    }
    
    console.log('[SMARTICO PREFS] ✅ Tabela nomes_usuarios sincronizada (INSERT/UPDATE)');
  } catch (error) {
    console.error('[SMARTICO PREFS] ❌ Erro ao sincronizar:', error);
  }
}

/**
 * Sincroniza preferências de VIPs existentes que ainda não têm dados
 * Executa em lote de 100 por vez para evitar timeout
 * Apenas UPDATE, não INSERT (registros já devem existir em nomes_usuarios)
 */
async function sincronizarPreferenciasVipsExistentes(): Promise<void> {
  try {
    console.log('[SMARTICO PREFS BACKFILL] Buscando VIPs sem preferências...');
    
    // Buscar até 100 VIPs que JÁ EXISTEM em nomes_usuarios mas não têm preferências
    const vipsSemPrefs = await pool.query(`
      SELECT DISTINCT nu.external_id::text as external_id
      FROM nomes_usuarios nu
      INNER JOIN lista_vip lv ON nu.external_id::text = lv.external_id
      WHERE nu.jogo IS NULL 
         OR nu.provedor IS NULL 
         OR nu.produto_favorito IS NULL
      LIMIT 100
    `);
    
    if (vipsSemPrefs.rows.length === 0) {
      console.log('[SMARTICO PREFS BACKFILL] ✅ Todos os VIPs já têm preferências sincronizadas');
      return;
    }
    
    console.log(`[SMARTICO PREFS BACKFILL] 🔄 ${vipsSemPrefs.rows.length} VIPs sem preferências encontrados`);
    
    const externalIds = vipsSemPrefs.rows.map(r => r.external_id);
    const preferencias = await buscarPreferenciasSmartico(externalIds);
    
    if (preferencias.length === 0) {
      console.log('[SMARTICO PREFS BACKFILL] ⚠️ Nenhuma preferência encontrada no Smartico');
      return;
    }
    
    console.log(`[SMARTICO PREFS BACKFILL] 📊 ${preferencias.length} preferências obtidas do Smartico`);
    
    // Buscar nomes dos jogadores que ainda não têm (em uma única query)
    console.log('[SMARTICO PREFS BACKFILL] Buscando nomes faltantes...');
    const nomesMap = new Map<string, string>();
    const idsParaBuscarNome = vipsSemPrefs.rows.map(r => r.external_id);
    
    try {
      const nomesResult = await pool.query(
        `SELECT external_id, nome FROM nomes_usuarios WHERE external_id = ANY($1::uuid[])`,
        [idsParaBuscarNome]
      );
      
      for (const row of nomesResult.rows) {
        if (row.nome) {
          nomesMap.set(row.external_id, row.nome);
        }
      }
    } catch (err) {
      console.error('[SMARTICO PREFS BACKFILL] ⚠️ Erro ao buscar nomes:', err);
    }
    
    console.log(`[SMARTICO PREFS BACKFILL] ${nomesMap.size} nomes encontrados`);
    
    // Atualizar em lote (mais rápido e eficiente)
    if (preferencias.length > 0) {
      const batchSize = 50;
      let totalAtualizados = 0;
      
      for (let i = 0; i < preferencias.length; i += batchSize) {
        const batch = preferencias.slice(i, i + batchSize);
        const values = batch.map((_, idx) => {
          const offset = idx * 7;
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
        }).join(', ');
        
        const params = batch.flatMap(p => [
          p.external_id,
          nomesMap.get(p.external_id) || null, // NULL para preservar nome existente
          p.jogo,
          p.provedor,
          p.produto_favorito,
          p.tipo_jogo,
          p.data_aniversario
        ]);
        
        try {
          const result = await pool.query(`
            UPDATE nomes_usuarios
            SET 
              nome = COALESCE(data.nome, nomes_usuarios.nome),
              jogo = data.jogo,
              provedor = data.provedor,
              produto_favorito = data.produto_favorito,
              tipo_jogo = data.tipo_jogo,
              data_aniversario = data.data_aniversario::date,
              atualizado_em = CURRENT_TIMESTAMP
            FROM (VALUES ${values}) AS data(external_id, nome, jogo, provedor, produto_favorito, tipo_jogo, data_aniversario)
            WHERE nomes_usuarios.external_id::text = data.external_id
          `, params);
          
          totalAtualizados += result.rowCount || 0;
        } catch (err) {
          console.error(`[SMARTICO PREFS BACKFILL] ⚠️ Erro no lote ${i}:`, err);
        }
      }
      
      console.log(`[SMARTICO PREFS BACKFILL] ✅ ${totalAtualizados}/${preferencias.length} registros atualizados`);
    }
  } catch (error) {
    console.error('[SMARTICO PREFS BACKFILL] ❌ Erro:', error);
  }
}

/**
 * Sincroniza jogadores VIP com a tabela lista_vip
 * Insere apenas novos VIPs (não atualiza os existentes)
 */
async function sincronizarListaVip(players: VipPlayer[]): Promise<void> {
  try {
    console.log('[LISTA VIP] Iniciando sincronização...');
    
    // 1. Buscar VIPs que já existem na lista_vip
    const idsExistentes = await pool.query(`
      SELECT external_id FROM lista_vip
      WHERE external_id = ANY($1::text[])
    `, [players.map(p => p.external_id)]);
    
    const idsExistentesSet = new Set(idsExistentes.rows.map(r => r.external_id));
    
    // 2. Filtrar apenas novos VIPs
    const novosVips = players.filter(p => !idsExistentesSet.has(p.external_id));
    
    if (novosVips.length === 0) {
      console.log('[LISTA VIP] ✓ Nenhum VIP novo para adicionar');
      return;
    }
    
    console.log(`[LISTA VIP] 🆕 ${novosVips.length} novos VIPs detectados`);
    
    // 3. Buscar nomes faltantes em uma única query
    const vipsSemNome = novosVips.filter(v => !v.nome);
    const nomesMap = new Map<string, string>();
    
    if (vipsSemNome.length > 0) {
      try {
        const nomesResult = await pool.query(
          `SELECT external_id, nome FROM preferencias_jogadores WHERE external_id = ANY($1::text[])`,
          [vipsSemNome.map(v => v.external_id)]
        );
        
        for (const row of nomesResult.rows) {
          if (row.nome) {
            nomesMap.set(row.external_id, row.nome);
          }
        }
      } catch (err) {
        console.error('[LISTA VIP] Erro ao buscar nomes:', err);
      }
    }
    
    // 4. Preparar dados com nomes formatados
    const novosVipsComNome = novosVips.map(vip => {
      const nomeCompleto = vip.nome || nomesMap.get(vip.external_id) || null;
      const nomeFormatado = formatarNomeDigisac(nomeCompleto);
      
      return {
        external_id: vip.external_id,
        nome: nomeFormatado
      };
    });
    
    // 5. Inserir em lote na lista_vip
    const values = novosVipsComNome.map((v, i) => {
      const offset = i * 2;
      return `($${offset + 1}, $${offset + 2}, CURRENT_TIMESTAMP)`;
    }).join(', ');
    
    const params = novosVipsComNome.flatMap(v => [v.external_id, v.nome]);
    
    await pool.query(`
      INSERT INTO lista_vip (external_id, nome, data_e_hora)
      VALUES ${values}
      ON CONFLICT (external_id) DO NOTHING
    `, params);

    // 6. Sincronizar preferencias Smartico em nomes_usuarios
    await sincronizarPreferenciasVip(novosVips);
    
    console.log(`[LISTA VIP] ✅ ${novosVipsComNome.length} novos VIPs adicionados à lista_vip`);
    
    // Log de alguns exemplos
    const exemplos = novosVipsComNome.slice(0, 5);
    if (exemplos.length > 0) {
      console.log('[LISTA VIP] 📋 Exemplos adicionados:');
      exemplos.forEach(v => {
        console.log(`  - ${v.external_id}: ${v.nome || 'SEM NOME'}`);
      });
    }
    
  } catch (error) {
    console.error('[LISTA VIP] ❌ Erro ao sincronizar:', error);
    // Não interrompe o fluxo principal, apenas loga o erro
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const endDate = searchParams.get('endDate') || new Date().toISOString().split('T')[0];
    const forceRefresh = searchParams.get('forceRefresh') === 'true';
    const now = Date.now();
    
    // Limpa cache se forceRefresh=true
    if (forceRefresh) {
      console.log(`[CACHE] Limpeza forçada do cache solicitada`);
      cacheData.clear();
    }
    
    // Verifica se tem cache válido para esta data
    const cached = cacheData.get(endDate);
    if (cached && (now - cached.timestamp) < CACHE_TTL && !forceRefresh) {
      console.log(`[CACHE] Retornando dados do cache para ${endDate} (${Math.floor((now - cached.timestamp) / 1000)}s atrás)`);
      return NextResponse.json({
        success: true,
        data: cached.data,
        total: cached.data.length,
        cached: true,
        cache_age_seconds: Math.floor((now - cached.timestamp) / 1000)
      });
    }
    
    const startDate = '2025-04-01';
    console.log(`[VIP PLAYERS API] Cache expirado/inexistente para ${endDate}. Calculando dados...`);
    console.log(`[VIP FILTRO] 📅 Calculando dados de ${startDate} até ${endDate}`);
    console.log(`[VIP FILTRO] 🚫 Jogadores com cadastro posterior a ${endDate} serão EXCLUÍDOS`);
    console.log(`[VIP OTIMIZAÇÃO] Aplicando regra: UMA VEZ VIP, SEMPRE VIP!`);
    const perfStart = Date.now();
    
    // Query OTIMIZADA com HISTÓRICO VIP
    // REGRA: Uma vez VIP, sempre VIP! A lista só cresce, nunca diminui
    // Jogadores que já foram VIP continuam na lista mesmo que não atendam mais aos critérios
    const query = `
      WITH ggr_totais_pre_filtro AS (
        -- PRÉ-FILTRO: Apenas jogadores com GGR total >= 1000 (otimização)
        -- Isso reduz drasticamente o dataset antes de calcular médias mensais
        SELECT 
          external_id::text as external_id,
          SUM(valor) as ggr_total
        FROM ggr_total
        WHERE data_e_hora >= '2025-04-01' AND data_e_hora <= $1::date
        GROUP BY external_id::text
        HAVING SUM(valor) >= 1000  -- Mínimo para ser VIP
      ),
      ggr_vip AS (
        -- Calcula GGR mensal APENAS para jogadores pré-filtrados
        SELECT 
          g.external_id::text as external_id,
          DATE_TRUNC('month', g.data_e_hora) as mes,
          SUM(g.valor) as ggr_mes,
          MAX(g.data_e_hora) as ultima_atividade_ggr
        FROM ggr_total g
        WHERE g.external_id::text IN (SELECT external_id FROM ggr_totais_pre_filtro)
          AND g.data_e_hora >= '2025-04-01' 
          AND g.data_e_hora <= $1::date
        GROUP BY g.external_id::text, DATE_TRUNC('month', g.data_e_hora)
        HAVING SUM(g.valor) > 0
      ),
      ggr_agg_vip AS (
        -- Agrega dados de GGR e aplica filtro VIP
        SELECT 
          external_id,
          AVG(ggr_mes) as ggr_medio,
          SUM(ggr_mes) as ggr_total_periodo,
          MAX(ggr_mes) as ggr_maximo,
          COUNT(DISTINCT mes) as meses_ativos,
          MAX(ultima_atividade_ggr) as ultima_ggr
        FROM ggr_vip
        GROUP BY external_id
        -- Critério VIP: GGR médio mensal >= 1000
        HAVING AVG(ggr_mes) >= 1000
      ),
      depositos_data AS (
        -- Busca dados de depósitos apenas para os VIPs identificados
        -- FILTRO ADICIONAL: Total depositado >= 5000
        SELECT 
          external_id::text as external_id,
          COUNT(*) as qtd_depositos,
          SUM(valor) as deposito_total,
          SUM(valor) / NULLIF(COUNT(*), 0) as ticket_medio,
          MAX(valor) as ticket_maximo,
          MAX(data_e_hora) as ultima_atividade_dep
        FROM depositos_totais
        WHERE external_id::text IN (SELECT external_id FROM ggr_agg_vip)
          AND data_e_hora >= '2025-04-01'
          AND data_e_hora <= $1::date
        GROUP BY external_id
        HAVING SUM(valor) >= 5000  -- Critério adicional VIP: depósitos >= R$ 5.000
      ),
      insert_status_cliente AS (
        -- Insere automaticamente em status_cliente usuários que atendem aos critérios
        -- Garante que todos os qualificados estejam na tabela aguardando atualização de status
        INSERT INTO status_cliente (external_id, status, atualizado_em)
        SELECT DISTINCT
          ga.external_id::uuid,
          'PENDING' as status,  -- Status temporário até processo externo atualizar
          NOW() as atualizado_em
        FROM ggr_agg_vip ga
        INNER JOIN depositos_data dd ON ga.external_id = dd.external_id
        LEFT JOIN status_cliente sc ON ga.external_id::uuid = sc.external_id
        WHERE sc.external_id IS NULL  -- Apenas quem NÃO está na tabela ainda
        ON CONFLICT (external_id) DO NOTHING  -- Ignora se já existir
        RETURNING external_id
      ),
      novos_vips AS (
        -- Identifica VIPs que atendem aos critérios mas ainda não estão no histórico
        -- REGRA DE STATUS: Aceita APENAS 'ACTIVE'
        SELECT DISTINCT ga.external_id
        FROM ggr_agg_vip ga
        INNER JOIN depositos_data dd ON ga.external_id = dd.external_id
        INNER JOIN status_cliente sc ON ga.external_id::uuid = sc.external_id
        LEFT JOIN jogadores_vip_historico vh ON ga.external_id::uuid = vh.external_id
        WHERE sc.status = 'ACTIVE'
          AND vh.external_id IS NULL
      ),
      insert_novos_vips AS (
        -- Insere novos VIPs no histórico (executado automaticamente)
        INSERT INTO jogadores_vip_historico (
          external_id,
          ggr_medio_entrada,
          ticket_medio_entrada,
          deposito_total_entrada,
          observacao
        )
        SELECT 
          nv.external_id::uuid,
          ga.ggr_medio,
          dd.ticket_medio,
          dd.deposito_total,
          'Auto-cadastrado pela API'
        FROM novos_vips nv
        INNER JOIN ggr_agg_vip ga ON nv.external_id = ga.external_id
        INNER JOIN depositos_data dd ON nv.external_id = dd.external_id
        ON CONFLICT (external_id) DO NOTHING
        RETURNING external_id
      ),
      todos_vips_historico AS (
        -- TODOS os jogadores que já foram VIP alguma vez (lista só cresce!)
        SELECT external_id::text as external_id
        FROM jogadores_vip_historico
      ),
      ggr_todos_vips AS (
        -- Calcula GGR MENSAL para TODOS os VIPs históricos
        -- IMPORTANTE: Apenas meses com GGR > 0 (meses ativos)
        SELECT 
          g.external_id::text as external_id,
          DATE_TRUNC('month', g.data_e_hora) as mes,
          SUM(g.valor) as ggr_mes,
          MAX(g.data_e_hora) as ultima_atividade_ggr
        FROM ggr_total g
        WHERE g.external_id::text IN (SELECT external_id FROM todos_vips_historico)
          AND g.data_e_hora >= '2025-04-01' 
          AND g.data_e_hora <= $1::date
        GROUP BY g.external_id::text, DATE_TRUNC('month', g.data_e_hora)
        HAVING SUM(g.valor) > 0  -- Apenas meses ativos (GGR > 0)
      ),
      ggr_agg_todos AS (
        -- Agrega GGR de todos os VIPs históricos
        -- MÉDIA calculada APENAS sobre meses ativos (WHERE ggr_mes > 0)
        SELECT 
          tvh.external_id,
          COALESCE(AVG(gtv.ggr_mes), 0) as ggr_medio,
          COALESCE(SUM(gtv.ggr_mes), 0) as ggr_total_periodo,
          COALESCE(MAX(gtv.ggr_mes), 0) as ggr_maximo,
          COUNT(DISTINCT gtv.mes) as meses_ativos,
          MAX(gtv.ultima_atividade_ggr) as ultima_ggr
        FROM todos_vips_historico tvh
        LEFT JOIN ggr_todos_vips gtv ON tvh.external_id = gtv.external_id
        GROUP BY tvh.external_id
      ),
      depositos_todos AS (
        -- Busca depósitos de todos os VIPs históricos
        SELECT 
          tvh.external_id,
          COUNT(dt.valor) as qtd_depositos,
          COALESCE(SUM(dt.valor), 0) as deposito_total,
          COALESCE(SUM(dt.valor) / NULLIF(COUNT(dt.valor), 0), 0) as ticket_medio,
          COALESCE(MAX(dt.valor), 0) as ticket_maximo,
          MAX(dt.data_e_hora) as ultima_atividade_dep
        FROM todos_vips_historico tvh
        LEFT JOIN depositos_totais dt ON tvh.external_id = dt.external_id::text
          AND dt.data_e_hora >= '2025-04-01'
          AND dt.data_e_hora <= $1::date
        GROUP BY tvh.external_id
      )
      SELECT 
        gat.external_id as external_id,
        n.nome,
        n.origem,
        gat.ggr_medio as ggr_medio_mensal,
        gat.ggr_total_periodo,
        gat.ggr_maximo as ggr_maximo_mensal,
        gat.meses_ativos,
        dt.qtd_depositos as qtd_depositos,
        dt.deposito_total as deposito_total_periodo,
        dt.ticket_medio as ticket_medio,
        dt.ticket_maximo as ticket_maximo,
        GREATEST(
          COALESCE(gat.ultima_ggr, '2025-04-01'::timestamp), 
          COALESCE(dt.ultima_atividade_dep, '2025-04-01'::timestamp)
        ) as ultima_atividade,
        EXTRACT(DAY FROM (
          $1::date - GREATEST(
            COALESCE(gat.ultima_ggr, '2025-04-01'::timestamp), 
            COALESCE(dt.ultima_atividade_dep, '2025-04-01'::timestamp)
          )
        ))::integer as dias_inativo,
        CASE 
          WHEN cs.cadastro IS NOT NULL THEN 
            TO_TIMESTAMP(cs.cadastro, 'DD/MM/YYYY HH24:MI:SS')
          ELSE NULL
        END as data_cadastro,
        (
          SELECT MIN(data_e_hora)
          FROM depositos_totais dep
          WHERE dep.external_id::text = gat.external_id
        ) as data_primeiro_deposito,
        NULL as data_aniversario,
        COALESCE((
          SELECT SUM(COALESCE(valor_bonus, 0) + COALESCE(valor_freespins, 0) + COALESCE(valor_smartico, 0))
          FROM recompensas_totais r 
          WHERE r.external_id::text = gat.external_id
        ), 0) as recompensas_usadas,
        EXISTS(
          SELECT 1 FROM solicitacoes_cashback sc_cash
          WHERE sc_cash.external_id = gat.external_id
        ) as cashback_vip_ativado,
        (
          SELECT MAX(data_solicitacao) FROM solicitacoes_cashback sc_cash
          WHERE sc_cash.external_id = gat.external_id
        ) as data_ativacao,
        EXISTS(
          SELECT 1 FROM bonus_dado_atendimento_vip b
          WHERE b.external_id = gat.external_id
          AND COALESCE(b.valor_bonus, 0) = 0
          AND COALESCE(b.valor_experiencia, 0) = 0
          AND b.data_e_hora >= ($1::date - INTERVAL '7 days')
        ) as bonus_vip_ativado,
        (
          SELECT MAX(data_e_hora) FROM bonus_dado_atendimento_vip b
          WHERE b.external_id = gat.external_id
          AND COALESCE(b.valor_bonus, 0) = 0
          AND COALESCE(b.valor_experiencia, 0) = 0
        ) as bonus_vip_data,
        EXISTS(
          SELECT 1 FROM bonus_dado_atendimento_vip b
          WHERE b.external_id = gat.external_id
          AND b.valor_experiencia > 0
          AND EXTRACT(YEAR FROM b.data_e_hora) = EXTRACT(YEAR FROM $1::date)
          AND EXTRACT(MONTH FROM b.data_e_hora) = EXTRACT(MONTH FROM $1::date)
        ) as experiencia_vip_ativado,
        (
          SELECT MAX(data_e_hora) FROM bonus_dado_atendimento_vip b
          WHERE b.external_id = gat.external_id
          AND b.valor_experiencia > 0
        ) as experiencia_vip_data,
        EXISTS(
          SELECT 1 FROM solicitacoes_saque s
          WHERE s.external_id = gat.external_id
        ) as saque_vip_ativado,
        (
          SELECT MAX(data_solicitacao) FROM solicitacoes_saque s
          WHERE s.external_id = gat.external_id
        ) as saque_vip_data,
        vh.data_entrada_vip,
        n.conexao,
        CASE 
          WHEN sc.status = 'ACTIVE' AND gat.ggr_medio >= 1000 AND dt.deposito_total >= 5000 THEN 'ATIVO'
          WHEN sc.status = 'ACTIVE' THEN 'HISTORICO_ATIVO'
          ELSE 'HISTORICO_INATIVO'
        END as status_vip
      FROM ggr_agg_todos gat
      INNER JOIN depositos_todos dt ON gat.external_id = dt.external_id
      INNER JOIN jogadores_vip_historico vh ON gat.external_id::uuid = vh.external_id
      INNER JOIN status_cliente sc ON gat.external_id::uuid = sc.external_id
      LEFT JOIN nomes_usuarios n ON gat.external_id::uuid = n.external_id
      LEFT JOIN cadastros_smartico cs ON gat.external_id = cs.external_id::text
      WHERE sc.status = 'ACTIVE'  -- Apenas jogadores com status ACTIVE
        -- FILTRO TEMPORAL: Apenas jogadores cadastrados ATÉ a data selecionada
        AND (
          cs.cadastro IS NULL  -- Sem data de cadastro conhecida (manter por segurança)
          OR TO_TIMESTAMP(cs.cadastro, 'DD/MM/YYYY HH24:MI:SS') <= $1::date
        )
      ORDER BY 
        CASE 
          WHEN gat.ggr_medio >= 1000 AND dt.deposito_total >= 5000 THEN 1
          ELSE 2
        END,
        gat.ggr_medio DESC
      LIMIT 2000  -- Limite de segurança
    `;
    
    const result = await pool.query(query, [endDate]);
    
    const perfEnd = Date.now();
    const perfTime = ((perfEnd - perfStart) / 1000).toFixed(3);
    
    // Log de amostra dos dados para debug do filtro de data
    if (result.rows.length > 0) {
      const primeiroVip = result.rows[0];
      console.log(`[VIP DEBUG] 📊 Amostra do primeiro VIP (endDate=${endDate}):`);
      console.log(`  - External ID: ${primeiroVip.external_id}`);
      console.log(`  - Data Cadastro: ${primeiroVip.data_cadastro ? new Date(primeiroVip.data_cadastro).toISOString().split('T')[0] : 'N/A'}`);
      console.log(`  - GGR Médio: R$ ${parseFloat(primeiroVip.ggr_medio_mensal).toFixed(2)}`);
      console.log(`  - GGR Total Período: R$ ${parseFloat(primeiroVip.ggr_total_periodo).toFixed(2)}`);
      console.log(`  - Ticket Médio: R$ ${parseFloat(primeiroVip.ticket_medio).toFixed(2)}`);
      console.log(`  - Meses Ativos: ${primeiroVip.meses_ativos}`);
      console.log(`  - Dias Inativo: ${primeiroVip.dias_inativo}`);
      
      // Verifica quantos têm data de cadastro após o filtro (não deveria ter nenhum)
      const cadastrosPosteriores = result.rows.filter((r: any) => {
        if (!r.data_cadastro) return false;
        const dataCadastro = new Date(r.data_cadastro);
        const dataFiltro = new Date(endDate);
        return dataCadastro > dataFiltro;
      }).length;
      
      if (cadastrosPosteriores > 0) {
        console.warn(`[VIP WARNING] ⚠️ ${cadastrosPosteriores} jogadores com cadastro POSTERIOR a ${endDate} (BUG!)`);
      } else {
        console.log(`[VIP FILTRO] ✅ Nenhum jogador com cadastro posterior a ${endDate} (filtro funcionando)`);
      }
    }
    
    // Conta novos VIPs adicionados nesta execução
    const novosVipsCount = result.rows.filter((r: any) => 
      new Date(r.data_entrada_vip).getTime() > (now - 60000) // Últimos 60 segundos
    ).length;
    
    console.log(`[PERF] Query total: ${perfTime}s (${result.rows.length} jogadores)`);
    console.log(`[VIP STATS] Data selecionada: ${endDate}, Total VIPs: ${result.rows.length}`);
    console.log(`[VIP STATS] Novos VIPs adicionados: ${novosVipsCount}`);
    console.log(`[VIP STATS] VIPs ativos (ainda atendem critérios): ${result.rows.filter((r: any) => r.status_vip === 'ATIVO').length}`);
    console.log(`[VIP STATS] VIPs históricos mantidos: ${result.rows.filter((r: any) => r.status_vip !== 'ATIVO').length}`);
    console.log(`[VIP REGRA] 🎯 UMA VEZ VIP, SEMPRE VIP - Lista só cresce!`);
    console.log(`[VIP AUTO] ✅ Inserção automática em status_cliente ativada (usuários qualificados aguardam ativação)`);
    
    const players: VipPlayer[] = result.rows.map(row => ({
      external_id: row.external_id,
      nome: row.nome || null,
      origem: row.origem || null,
      ggr_total: parseFloat(row.ggr_medio_mensal),
      ggr_total_periodo: parseFloat(row.ggr_total_periodo),
      ggr_maximo: parseFloat(row.ggr_maximo_mensal),
      ticket_medio: parseFloat(row.ticket_medio),
      deposito_total_periodo: parseFloat(row.deposito_total_periodo),
      ticket_maximo: parseFloat(row.ticket_maximo),
      ultima_atividade: row.ultima_atividade,
      dias_inativo: parseInt(row.dias_inativo) || 0,
      data_cadastro: row.data_cadastro || null,
      data_primeiro_deposito: row.data_primeiro_deposito || null,
      data_aniversario: row.data_aniversario || null,
      meses_ativos: parseInt(row.meses_ativos) || 0,
      recompensas_usadas: parseFloat(row.recompensas_usadas) || 0,
      cashback_vip_ativado: row.cashback_vip_ativado || false,
      data_ativacao: row.data_ativacao || null,
      bonus_vip_ativado: row.bonus_vip_ativado || false,
      bonus_vip_data: row.bonus_vip_data || null,
      experiencia_vip_ativado: row.experiencia_vip_ativado || false,
      experiencia_vip_data: row.experiencia_vip_data || null,
      saque_vip_ativado: row.saque_vip_ativado || false,
      saque_vip_data: row.saque_vip_data || null,
      conexao: row.conexao || null
    }));
    
    // Sincronizar com lista_vip (inserir apenas novos VIPs)
    await sincronizarListaVip(players);
    
    // ✅ OTIMIZAÇÃO: Preferências são sincronizadas pelo CRON DAILY, não aqui!
    // Remover sincronização automática para evitar queries BigQuery desnecessárias
    // await sincronizarPreferenciasVipsExistentes(); // ❌ Comentado - economiza ~5-10 GB/mês
    
    // Atualiza cache para esta data
    cacheData.set(endDate, {
      data: players,
      timestamp: Date.now()
    });
    
    console.log(`[VIP PLAYERS API] Encontrados ${players.length} jogadores VIP até ${endDate} (cache atualizado)`);
    console.log(`[VIP REGRA] 🎯 UMA VEZ VIP, SEMPRE VIP - A lista só cresce, nunca diminui!`);
    console.log(`[VIP REGRA] ✅ Status permitido: APENAS 'ACTIVE'`);
    console.log(`[VIP REGRA] 📅 Filtro temporal: Apenas jogadores cadastrados ATÉ ${endDate}`);
    
    return NextResponse.json({
      success: true,
      data: players,
      total: players.length,
      cached: false,
      periodo: { inicio: startDate, fim: endDate, descricao: `Abr/2025 até ${endDate}` },
      criterio_vip: `🎯 UMA VEZ VIP, SEMPRE VIP! (GGR médio >= R$ 1k + Depósitos >= R$ 5k + Status ACTIVE + Cadastro até ${endDate})`
    });
    
  } catch (error) {
    console.error('[VIP PLAYERS API] Erro:', error);
    console.error('[VIP PLAYERS API] Stack:', error instanceof Error ? error.stack : 'N/A');
    return NextResponse.json(
      { 
        success: false, 
        error: 'Erro ao buscar dados dos jogadores VIP',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
        stack: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
