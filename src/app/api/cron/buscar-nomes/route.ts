import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import crypto from 'crypto';

/**
 * 🕐 CRON JOB - Busca e atualiza nomes de usuários da API Smartico
 * 
 * Execução: A cada 1 hora
 * 
 * Funcionalidade:
 * 1. Busca usuários SEM NOME em nomes_usuarios + lista_vip
 * 2. Consulta API Smartico para obter nomes
 * 3. Atualiza TODAS as tabelas (nomes_usuarios + lista_vip + status_cliente)
 * 4. Insere novos contatos em status_cliente com status 'ACTIVE'
 * 5. Processa até 500 usuários por execução
 * 6. Usa retry com backoff exponencial
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutos

const SMARTICO_API_URL = 'https://apis3.smartico.ai/api/external/user_state/v2';
const SMARTICO_API_TOKEN = process.env.SMARTICO_API_TOKEN || '';
const MAX_USERS_PER_RUN = 500;
const MAX_RETRIES = 5;
const BASE_DELAY = 3000; // 3 segundos
const REQUEST_DELAY = 300; // 0.3s entre requisições

/**
 * Formata nome para estilo abreviado (GABRIELA LEITE → GABRIELA L.)
 */
function formatNameAbbreviated(fullName: string): string {
  if (!fullName || fullName.trim().length === 0) {
    return '';
  }
  
  const partes = fullName.trim().split(/\s+/);
  
  if (partes.length === 1) {
    return partes[0].toUpperCase();
  }
  
  const primeiroNome = partes[0].toUpperCase();
  const ultimaParte = partes[partes.length - 1];
  const primeiraLetra = ultimaParte.charAt(0).toUpperCase();
  
  return `${primeiroNome} ${primeiraLetra}.`;
}

/**
 * Adiciona jitter aleatório ao delay
 */
function getJitterDelay(baseMs: number): number {
  const jitter = Math.random() * 3000 + 2000; // 2-5 segundos
  return baseMs + jitter;
}

/**
 * Delay com Promise
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Busca informações do usuário na API Smartico com retry
 * ✅ CORRIGIDO: Usa formato correto da API (Header Authorization + payload users array)
 */
async function getUserStateByExternalId(externalId: string, attempt: number = 1): Promise<string | null> {
  try {
    // ✅ Formato correto da API Smartico v2
    const payload = {
      eid: crypto.randomUUID(),
      properties: ['user_first_name', 'user_last_name'],
      show_enum_values: true,
      users: [{
        user_ext_id: externalId,
        ext_brand_id: process.env.SMARTICO_BRAND_ID || 'sua-marca'
      }]
    };
    
    const response = await fetch(SMARTICO_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': SMARTICO_API_TOKEN, // ✅ Token no header (não no body)
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data: any = await response.json();
    
    // ✅ Formato de resposta correto: results[0].users[0].properties
    if (data.results && data.results[0]?.users && data.results[0].users.length > 0) {
      const user = data.results[0].users[0];
      const props = user.properties || {};
      const firstName = props.user_first_name || '';
      const lastName = props.user_last_name || '';
      
      if (firstName || lastName) {
        // Formatar como "PRIMEIRO L."
        const nomeCompleto = `${firstName} ${lastName}`.trim();
        const nomeFormatado = formatNameAbbreviated(nomeCompleto);
        return nomeFormatado;
      }
    }
    
    return null;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    if (attempt < MAX_RETRIES) {
      const delayMs = getJitterDelay(BASE_DELAY * Math.pow(2, attempt - 1));
      console.log(`[RETRY] Tentativa ${attempt}/${MAX_RETRIES} falhou para ${externalId.substring(0, 8)}... Aguardando ${(delayMs / 1000).toFixed(1)}s`);
      await sleep(delayMs);
      return getUserStateByExternalId(externalId, attempt + 1);
    }
    
    console.error(`[ERRO] Falha final após ${MAX_RETRIES} tentativas para ${externalId.substring(0, 8)}...: ${errorMsg}`);
    return null;
  }
}

/**
 * Busca usuários sem nome do banco de dados (nomes_usuarios E lista_vip)
 */
async function getUsersWithoutNames(): Promise<string[]> {
  const result = await pool.query(`
    SELECT DISTINCT external_id
    FROM (
      -- Usuários sem nome em nomes_usuarios
      SELECT external_id::text as external_id
      FROM nomes_usuarios
      WHERE nome IS NULL 
         OR TRIM(nome) = '' 
         OR UPPER(TRIM(nome)) = 'DESCONHECIDO'
      
      UNION
      
      -- Usuários sem nome em lista_vip
      SELECT external_id::text as external_id
      FROM lista_vip
      WHERE nome IS NULL 
         OR TRIM(nome) = '' 
         OR UPPER(TRIM(nome)) = 'DESCONHECIDO'
    ) combined
    ORDER BY external_id
    LIMIT $1
  `, [MAX_USERS_PER_RUN]);
  
  return result.rows.map(row => row.external_id);
}

/**
 * Salva nomes no banco em batch (nomes_usuarios, lista_vip E status_cliente)
 */
async function saveNamesBatch(namesMap: Map<string, string>): Promise<number> {
  if (namesMap.size === 0) return 0;
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const values: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    
    for (const [externalId, nome] of namesMap.entries()) {
      values.push(`($${paramIndex}, $${paramIndex + 1}, NOW())`);
      params.push(externalId, nome);
      paramIndex += 2;
    }
    
    // 1. Atualizar nomes_usuarios
    const queryNomesUsuarios = `
      INSERT INTO nomes_usuarios (external_id, nome, atualizado_em)
      VALUES ${values.join(', ')}
      ON CONFLICT (external_id) 
      DO UPDATE SET 
        nome = EXCLUDED.nome,
        atualizado_em = EXCLUDED.atualizado_em
    `;
    
    await client.query(queryNomesUsuarios, params);
    
    // 2. Atualizar lista_vip (apenas registros existentes)
    const valuesListaVip: string[] = [];
    const paramsListaVip: any[] = [];
    let paramIndexListaVip = 1;
    
    for (const [externalId, nome] of namesMap.entries()) {
      valuesListaVip.push(`($${paramIndexListaVip}::uuid, $${paramIndexListaVip + 1})`);
      paramsListaVip.push(externalId, nome);
      paramIndexListaVip += 2;
    }
    
    const queryListaVip = `
      INSERT INTO lista_vip (external_id, nome)
      VALUES ${valuesListaVip.join(', ')}
      ON CONFLICT (external_id) 
      DO UPDATE SET nome = EXCLUDED.nome
    `;
    
    await client.query(queryListaVip, paramsListaVip);
    
    // 3. Inserir em status_cliente como ACTIVE (apenas se não existir)
    const valuesStatusCliente: string[] = [];
    const paramsStatusCliente: any[] = [];
    let paramIndexStatusCliente = 1;
    
    for (const [externalId] of namesMap.entries()) {
      valuesStatusCliente.push(`($${paramIndexStatusCliente}::uuid, 'ACTIVE', NOW())`);
      paramsStatusCliente.push(externalId);
      paramIndexStatusCliente += 1;
    }
    
    const queryStatusCliente = `
      INSERT INTO status_cliente (external_id, status, atualizado_em)
      VALUES ${valuesStatusCliente.join(', ')}
      ON CONFLICT (external_id) 
      DO NOTHING
    `;
    
    await client.query(queryStatusCliente, paramsStatusCliente);
    
    await client.query('COMMIT');
    
    console.log(`[CRON NOMES] 📝 Atualizados ${namesMap.size} nomes em nomes_usuarios, lista_vip E status_cliente`);
    
    return namesMap.size;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[CRON NOMES] ❌ Erro ao salvar batch:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 🕐 CRON JOB - Busca nomes de usuários da API Smartico
 * Executa a cada 1 hora
 * Atualiza: nomes_usuarios + lista_vip + status_cliente (ACTIVE)
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  // Verificar autenticação
  const authHeader = request.headers.get('authorization');
  const expectedToken = `Bearer ${process.env.CRON_SECRET}`;
  
  if (authHeader !== expectedToken) {
    console.error('[CRON NOMES] ❌ Acesso não autorizado');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  console.log('[CRON NOMES] 🚀 Iniciando busca de nomes...');
  console.log('[CRON NOMES] 📋 Buscando em: nomes_usuarios + lista_vip + status_cliente');
  
  try {
    // 1. Buscar usuários sem nome (de ambas as tabelas)
    const userIds = await getUsersWithoutNames();
    
    if (userIds.length === 0) {
      console.log('[CRON NOMES] ✅ Nenhum usuário pendente');
      return NextResponse.json({
        success: true,
        processed: 0,
        successful: 0,
        failed: 0,
        duration_seconds: (Date.now() - startTime) / 1000
      });
    }
    
    console.log(`[CRON NOMES] 📋 ${userIds.length} usuários sem nome encontrados`);
    
    // 2. Processar usuários com retry
    let successful = 0;
    let failed = 0;
    const namesMap = new Map<string, string>();
    const BATCH_SIZE = 100;
    
    for (let i = 0; i < userIds.length; i++) {
      const externalId = userIds[i];
      
      // Buscar nome com retry
      const nome = await getUserStateByExternalId(externalId);
      
      if (nome) {
        namesMap.set(externalId, nome);
        successful++;
        
        // Salvar em batch de 100
        if (namesMap.size >= BATCH_SIZE) {
          const saved = await saveNamesBatch(namesMap);
          console.log(`[CRON NOMES] 💾 Batch salvo: ${saved} usuários`);
          namesMap.clear();
        }
      } else {
        failed++;
      }
      
      // Rate limiting
      if (i < userIds.length - 1) {
        await sleep(REQUEST_DELAY);
      }
      
      // Log de progresso a cada 50 usuários
      if ((i + 1) % 50 === 0) {
        console.log(`[CRON NOMES] 📊 Progresso: ${i + 1}/${userIds.length} (${successful} OK, ${failed} falhas)`);
      }
    }
    
    // 3. Salvar último batch
    if (namesMap.size > 0) {
      const saved = await saveNamesBatch(namesMap);
      console.log(`[CRON NOMES] 💾 Último batch salvo: ${saved} usuários`);
    }
    
    const duration = (Date.now() - startTime) / 1000;
    const successRate = ((successful / userIds.length) * 100).toFixed(1);
    
    console.log('[CRON NOMES] ✅ Concluído!');
    console.log(`[CRON NOMES] 📊 Processados: ${userIds.length}`);
    console.log(`[CRON NOMES] ✓ Sucesso: ${successful} (${successRate}%)`);
    console.log(`[CRON NOMES] ✗ Falhas: ${failed}`);
    console.log(`[CRON NOMES] 💾 Tabelas atualizadas: nomes_usuarios + lista_vip + status_cliente`);
    console.log(`[CRON NOMES] ⏱️ Duração: ${duration.toFixed(1)}s`);
    
    return NextResponse.json({
      success: true,
      processed: userIds.length,
      successful,
      failed,
      success_rate: `${successRate}%`,
      duration_seconds: duration,
      tables_updated: ['nomes_usuarios', 'lista_vip', 'status_cliente']
    });
    
  } catch (error) {
    console.error('[CRON NOMES] ❌ Erro:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Erro ao processar nomes',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  }
}
