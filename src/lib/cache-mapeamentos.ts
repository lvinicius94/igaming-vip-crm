/**
 * 🚀 CACHE DE MAPEAMENTOS SMARTICO
 * ================================
 * 
 * Funções compartilhadas para cache de mapeamentos BigQuery
 * 
 * ANTES: ~4.650 queries BigQuery/mês
 * DEPOIS: ~31 queries BigQuery/mês
 * ECONOMIA: ~50 GB/mês
 */

import { BigQuery } from '@google-cloud/bigquery';
import pool from '@/lib/db';

// ================================================================
// TIPOS
// ================================================================

export interface Mapeamentos {
  gamesMap: Map<number, string>;
  providersMap: Map<number, string>;
  typesMap: Map<number, string>;
}

interface CacheEntry {
  data: Mapeamentos;
  timestamp: number;
}

// ================================================================
// CACHE EM MEMÓRIA (Vercel)
// ================================================================

let memoryCache: CacheEntry | null = null;
const MEMORY_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Converte resultado do PostgreSQL para Map
 */
function arrayToMap(rows: Array<{id: number, name: string}>): Map<number, string> {
  const map = new Map<number, string>();
  for (const row of rows) {
    map.set(row.id, row.name);
  }
  return map;
}

/**
 * Garante que as tabelas de cache existem no PostgreSQL
 */
async function garantirTabelasCache(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cache_jogos (
      smr_game_id   INTEGER PRIMARY KEY,
      game_name     TEXT NOT NULL,
      atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cache_provedores (
      smr_provider_id INTEGER PRIMARY KEY,
      provider_name   TEXT NOT NULL,
      atualizado_em   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cache_tipos_jogo (
      smr_game_type_id INTEGER PRIMARY KEY,
      game_type        TEXT NOT NULL,
      atualizado_em    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

/**
 * Busca mapeamentos do cache PostgreSQL
 */
async function buscarCachePostgreSQL(): Promise<Mapeamentos | null> {
  try {
    console.log('[CACHE] Buscando do PostgreSQL...');
    await garantirTabelasCache();
    
    const [jogosResult, provedoresResult, tiposResult] = await Promise.all([
      pool.query('SELECT smr_game_id as id, game_name as name FROM cache_jogos'),
      pool.query('SELECT smr_provider_id as id, provider_name as name FROM cache_provedores'),
      pool.query('SELECT smr_game_type_id as id, game_type as name FROM cache_tipos_jogo')
    ]);
    
    // Verificar se cache está vazio
    if (jogosResult.rows.length === 0 || 
        provedoresResult.rows.length === 0 || 
        tiposResult.rows.length === 0) {
      console.log('[CACHE] Cache PostgreSQL vazio ou incompleto');
      return null;
    }
    
    const mapeamentos: Mapeamentos = {
      gamesMap: arrayToMap(jogosResult.rows as any),
      providersMap: arrayToMap(provedoresResult.rows as any),
      typesMap: arrayToMap(tiposResult.rows as any)
    };
    
    console.log('[CACHE] ✅ Carregado do PostgreSQL:');
    console.log(`  - ${mapeamentos.gamesMap.size} jogos`);
    console.log(`  - ${mapeamentos.providersMap.size} provedores`);
    console.log(`  - ${mapeamentos.typesMap.size} tipos`);
    
    return mapeamentos;
    
  } catch (error) {
    console.error('[CACHE] Erro ao buscar do PostgreSQL:', error);
    return null;
  }
}

/**
 * Atualiza cache PostgreSQL do BigQuery
 */
async function atualizarCachePostgreSQL(client: BigQuery, labelId: string): Promise<Mapeamentos> {
  console.log('[CACHE] Atualizando do BigQuery...');
  await garantirTabelasCache();
  const dataset = `dwh_ext_${labelId}`;
  
  // 1. Buscar do BigQuery
  const [gamesRows] = await client.query({
    query: `SELECT smr_game_id, game_name FROM \`smartico-bq3.${dataset}.dm_casino_game_name\``
  });
  
  const [providersRows] = await client.query({
    query: `SELECT smr_provider_id, provider_name FROM \`smartico-bq3.${dataset}.dm_casino_provider_name\``
  });
  
  const [typesRows] = await client.query({
    query: `SELECT smr_game_type_id, game_type FROM \`smartico-bq3.${dataset}.dm_casino_game_type\``
  });
  
  console.log('[CACHE] ✅ Dados carregados do BigQuery');
  console.log(`  - ${(gamesRows as any[]).length} jogos`);
  console.log(`  - ${(providersRows as any[]).length} provedores`);
  console.log(`  - ${(typesRows as any[]).length} tipos`);
  
  // 2. Limpar e reinserir com bulk INSERT usando unnest (1 query por tabela)
  const gameIds   = (gamesRows     as any[]).map(r => r.smr_game_id);
  const gameNames = (gamesRows     as any[]).map(r => r.game_name);
  const provIds   = (providersRows as any[]).map(r => r.smr_provider_id);
  const provNames = (providersRows as any[]).map(r => r.provider_name);
  const typeIds   = (typesRows     as any[]).map(r => r.smr_game_type_id);
  const typeNames = (typesRows     as any[]).map(r => r.game_type);

  await pool.query('TRUNCATE cache_jogos, cache_provedores, cache_tipos_jogo');

  await Promise.all([
    pool.query(`
      INSERT INTO cache_jogos (smr_game_id, game_name)
      SELECT * FROM unnest($1::int[], $2::text[])
      ON CONFLICT (smr_game_id) DO UPDATE SET game_name = EXCLUDED.game_name, atualizado_em = NOW()
    `, [gameIds, gameNames]),

    pool.query(`
      INSERT INTO cache_provedores (smr_provider_id, provider_name)
      SELECT * FROM unnest($1::int[], $2::text[])
      ON CONFLICT (smr_provider_id) DO UPDATE SET provider_name = EXCLUDED.provider_name, atualizado_em = NOW()
    `, [provIds, provNames]),

    pool.query(`
      INSERT INTO cache_tipos_jogo (smr_game_type_id, game_type)
      SELECT * FROM unnest($1::int[], $2::text[])
      ON CONFLICT (smr_game_type_id) DO UPDATE SET game_type = EXCLUDED.game_type, atualizado_em = NOW()
    `, [typeIds, typeNames]),
  ]);

  console.log('[CACHE] ✅ Cache PostgreSQL atualizado (bulk insert)');
  
  // 4. Retornar mapeamentos
  const mapeamentos: Mapeamentos = {
    gamesMap: new Map((gamesRows as any[]).map(r => [r.smr_game_id, r.game_name])),
    providersMap: new Map((providersRows as any[]).map(r => [r.smr_provider_id, r.provider_name])),
    typesMap: new Map((typesRows as any[]).map(r => [r.smr_game_type_id, r.game_type]))
  };
  
  return mapeamentos;
}

/**
 * 🎯 FUNÇÃO PRINCIPAL: Obter mapeamentos (3 camadas de cache)
 * 
 * Estratégia:
 * 1. Cache em memória (Vercel - 24h TTL)
 * 2. Cache PostgreSQL (permanente)
 * 3. BigQuery (fallback)
 */
export async function getMapeamentos(
  client: BigQuery, 
  labelId: string,
  forceRefresh: boolean = false
): Promise<Mapeamentos> {
  
  const agora = Date.now();
  
  // 1. Cache em memória (mais rápido)
  if (!forceRefresh && memoryCache && (agora - memoryCache.timestamp) < MEMORY_CACHE_TTL) {
    console.log('[CACHE] ✅ Usando cache em memória');
    return memoryCache.data;
  }
  
  // 2. Cache PostgreSQL
  if (!forceRefresh) {
    const cachedData = await buscarCachePostgreSQL();
    if (cachedData) {
      // Atualizar memória
      memoryCache = {
        data: cachedData,
        timestamp: agora
      };
      return cachedData;
    }
  }
  
  // 3. Buscar do BigQuery e atualizar todos os caches
  console.log('[CACHE] ⚠️  Cache vazio, buscando do BigQuery...');
  const mapeamentos = await atualizarCachePostgreSQL(client, labelId);
  
  // Atualizar cache em memória
  memoryCache = {
    data: mapeamentos,
    timestamp: agora
  };
  
  return mapeamentos;
}

/**
 * Converte IDs para nomes usando mapeamento
 */
export function converterIdsParaNomes(
  idsString: string | null,
  mapping: Map<number, string>
): string | null {
  if (!idsString) return null;
  
  try {
    const ids = idsString.split(',')
      .map(id => parseInt(id.trim()))
      .filter(id => !isNaN(id));
    
    const nomes = ids
      .map(id => mapping.get(id) || null)
      .filter(nome => nome !== null);
    
    return nomes.length > 0 ? nomes.join(', ') : null;
  } catch {
    return idsString;
  }
}

/**
 * Limpar cache em memória (útil para testes)
 */
export function limparCacheMemoria() {
  memoryCache = null;
  console.log('[CACHE] Cache em memória limpo');
}
