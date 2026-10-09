import { NextRequest, NextResponse } from 'next/server';
import { BigQuery } from '@google-cloud/bigquery';
import pool from '@/lib/db';
import crypto from 'crypto';
import { getMapeamentos, converterIdsParaNomes as convertIds } from '@/lib/cache-mapeamentos';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutos - otimizado para ~2500 VIPs (máx 500 novas buscas API/execução)

/**
 * 🕐 CRON JOB DIÁRIO - Roda à meia-noite (0 0 * * *)
 * 
 * Executa:
 * 1. Busca VIPs históricos + usuários que atendem critérios VIP (~1500-2000)
 * 2. Insere novos qualificados em status_cliente (status = NULL, aguarda processo externo)
 * 3. Atualiza nomes_usuarios com dados Smartico (máximo 500 buscas API novas/execução)
 *    - Reutiliza nomes existentes do banco para evitar timeout
 *    - Busca via API apenas usuários sem nome (limite: 500)
 *    - Demais usuários são processados pelo CRON NOMES (horário)
 * 4. Atualiza lista_vip e jogadores_vip_historico
 * 5. Sincroniza cadastros Google sem depósito (desde 01/03/2026) em nomes_usuarios e lista_vip
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  // ✅ SEGURANÇA: Verificar se é chamada do Vercel Cron
  const authHeader = request.headers.get('authorization');
  const expectedToken = `Bearer ${process.env.CRON_SECRET}`;
  
  console.log('[CRON DEBUG] authHeader:', authHeader);
  console.log('[CRON DEBUG] CRON_SECRET exists:', !!process.env.CRON_SECRET);
  console.log('[CRON DEBUG] expected:', expectedToken);
  
  if (authHeader !== expectedToken) {
    console.error('[CRON DAILY] ❌ Acesso não autorizado');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  console.log('[CRON DAILY] 🚀 Iniciando sincronização diária...');
  
  try {
    // ===============================================
    // 1️⃣ BUSCAR APENAS VIPs (HISTÓRICO + QUALIFICADOS)
    // ===============================================
    console.log('[CRON DAILY] 📊 Buscando VIPs históricos e qualificados...');
    
    const usuariosResult = await pool.query(`
      WITH usuarios_ggr_mensal AS (
        -- GGR mensal para cálculo de média
        SELECT 
          external_id::text as external_id,
          DATE_TRUNC('month', data_e_hora) as mes,
          SUM(valor) as ggr_mes
        FROM ggr_total
        WHERE data_e_hora >= '2025-04-01'
        GROUP BY external_id, DATE_TRUNC('month', data_e_hora)
        HAVING SUM(valor) > 0
      ),
      usuarios_qualificados AS (
        -- Usuários que ATENDEM aos critérios VIP
        SELECT DISTINCT g.external_id
        FROM usuarios_ggr_mensal g
        INNER JOIN (
          SELECT 
            external_id::text as external_id,
            SUM(valor) as deposito_total
          FROM depositos_totais
          WHERE data_e_hora >= '2025-04-01'
          GROUP BY external_id
          HAVING SUM(valor) >= 5000
        ) d ON g.external_id = d.external_id
        GROUP BY g.external_id
        HAVING AVG(g.ggr_mes) >= 1000
      ),
      vips_historicos AS (
        -- VIPs que já foram cadastrados alguma vez
        SELECT external_id::text as external_id
        FROM jogadores_vip_historico
      ),
      todos_vips AS (
        -- União: VIPs históricos + Qualificados
        SELECT external_id FROM vips_historicos
        UNION
        SELECT external_id FROM usuarios_qualificados
      )
      SELECT 
        external_id,
        COUNT(*) OVER() as total_usuarios,
        (SELECT COUNT(*) FROM usuarios_qualificados) as total_qualificados,
        (SELECT COUNT(*) FROM vips_historicos) as total_historicos
      FROM todos_vips
      ORDER BY external_id
    `);
    
    const todosUsuarios = usuariosResult.rows.map(r => r.external_id);
    const totalUsuarios = usuariosResult.rows[0]?.total_usuarios || 0;
    const totalQualificados = usuariosResult.rows[0]?.total_qualificados || 0;
    const totalHistoricos = usuariosResult.rows[0]?.total_historicos || 0;
    
    console.log(`[CRON DAILY] ✅ ${totalUsuarios} VIPs para processar`);
    console.log(`[CRON DAILY]    ├─ ${totalQualificados} atendem critérios (GGR médio >= 1000 + Depósito >= 5000)`);
    console.log(`[CRON DAILY]    ├─ ${totalHistoricos} já estão em jogadores_vip_historico`);
    console.log(`[CRON DAILY]    └─ ${totalUsuarios} únicos (históricos + qualificados)`);
    
    if (totalUsuarios === 0) {
      return NextResponse.json({ 
        success: true, 
        message: 'Nenhum VIP para processar',
        duration_ms: Date.now() - startTime
      });
    }
    
    // ===============================================
    // 2️⃣ INSERIR NOVOS EM status_cliente
    // ===============================================
    console.log('[CRON DAILY] 💾 Verificando status_cliente...');
    
    // Primeiro, contar quantos já existem
    const statusExistentes = await pool.query(`
      SELECT COUNT(*) as total
      FROM status_cliente
      WHERE external_id = ANY($1::uuid[])
    `, [todosUsuarios]);
    
    const jaExistem = parseInt(statusExistentes.rows[0].total);
    console.log(`[CRON DAILY]    ├─ ${jaExistem} já estão em status_cliente`);
    console.log(`[CRON DAILY]    └─ ${totalUsuarios - jaExistem} serão inseridos como PENDING`);
    
    const insertStatusResult = await pool.query(`
      INSERT INTO status_cliente (external_id, status, atualizado_em)
      SELECT 
        external_id::uuid,
        'PENDING' as status,
        NOW()
      FROM unnest($1::text[]) as external_id
      WHERE NOT EXISTS (
        SELECT 1 FROM status_cliente sc 
        WHERE sc.external_id = external_id::uuid
      )
      ON CONFLICT (external_id) DO NOTHING
      RETURNING external_id
    `, [todosUsuarios]);
    
    const novosInseridos = insertStatusResult.rows.length;
    console.log(`[CRON DAILY] ✅ ${novosInseridos} novos inseridos em status_cliente (status: PENDING)`);
    
    // ===============================================
    // 3️⃣ BUSCAR PREFERÊNCIAS DA SMARTICO (APENAS USUÁRIOS DO DASHBOARD)
    // Restringe ao que aparece nas abas: lista_vip + Google
    // Evita processar 2500+ VIPs históricos que não estão visíveis
    // ===============================================
    const smarticoStart = Date.now();
    console.log('[CRON DAILY] 🔍 Buscando usuários visíveis no dashboard...');

    const usuariosDashboardResult = await pool.query(`
      SELECT external_id::text AS external_id FROM lista_vip
      UNION
      SELECT external_id::text AS external_id FROM nomes_usuarios WHERE conexao IN ('google', 'plataforma')
    `);
    const usuariosDashboard = usuariosDashboardResult.rows.map((r: { external_id: string }) => r.external_id);
    console.log(`[CRON DAILY] 📊 ${usuariosDashboard.length} usuários visíveis no dashboard (lista_vip + Google + Plataforma)`);

    console.log('[CRON DAILY] 🔍 Buscando preferências Smartico...');
    let preferencias: any[] = [];
    try {
      preferencias = await buscarPreferenciasSmarticoCompleto(usuariosDashboard);
      const smarticoTime = ((Date.now() - smarticoStart) / 1000).toFixed(2);
      console.log(`[CRON DAILY] ✅ ${preferencias.length} preferências encontradas no BigQuery em ${smarticoTime}s`);
    } catch (bqError) {
      console.warn(`[CRON DAILY] ⚠️ BigQuery indisponível, continuando sem preferências: ${bqError instanceof Error ? bqError.message : bqError}`);
    }

    // ===============================================
    // 4️⃣ ATUALIZAR nomes_usuarios (VIPs)
    // ===============================================
    if (preferencias.length > 0) {
      console.log('[CRON DAILY] 📝 Atualizando nomes_usuarios (VIPs)...');
      await atualizarNomesUsuarios(preferencias);
      console.log(`[CRON DAILY] ✅ Nomes dos VIPs atualizados`);
    } else {
      console.log('[CRON DAILY] ⏭️ Pulando atualização de nomes (sem dados BigQuery)');
    }
    
    // ===============================================
    // 4.5️⃣ ATUALIZAR NOMES DE TODOS OS USUÁRIOS
    // ❌ DESABILITADO: Causa timeout ao processar 2300+ usuários via API
    // VIPs já têm nomes atualizados pela função buscarPreferenciasSmarticoCompleto()
    // Demais usuários serão atualizados gradualmente pelo CRON NOMES (500 por vez)
    // ===============================================
    // console.log('[CRON DAILY] 📝 Atualizando nomes de TODOS os usuários em nomes_usuarios...');
    // const nomesAtualizados = await atualizarNomesDeUsuariosSemNome();
    // console.log(`[CRON DAILY] ✅ ${nomesAtualizados} nomes atualizados`);
    
    console.log('[CRON DAILY] 📝 Nomes dos VIPs já atualizados via API na etapa anterior');
    console.log('[CRON DAILY] ℹ️ Demais usuários serão atualizados pelo CRON NOMES (horário)');
    
    // ===============================================
    // 5️⃣ PROCESSAR VIPs (jogadores_vip_historico)
    // ===============================================
    console.log('[CRON DAILY] 🎯 Processando jogadores_vip_historico...');
    
    // Primeiro, verificar quantos ACTIVE qualificados existem
    const activeQualificados = await pool.query(`
      WITH usuarios_ggr AS (
        SELECT 
          external_id::text as external_id,
          DATE_TRUNC('month', data_e_hora) as mes,
          SUM(valor) as ggr_mes
        FROM ggr_total
        WHERE data_e_hora >= '2025-04-01'
        GROUP BY external_id, DATE_TRUNC('month', data_e_hora)
        HAVING SUM(valor) > 0
      ),
      ggr_medio AS (
        SELECT 
          external_id,
          AVG(ggr_mes) as ggr_medio
        FROM usuarios_ggr
        GROUP BY external_id
        HAVING AVG(ggr_mes) >= 1000
      ),
      depositos AS (
        SELECT 
          external_id::text as external_id,
          SUM(valor) as deposito_total
        FROM depositos_totais
        WHERE data_e_hora >= '2025-04-01'
        GROUP BY external_id
        HAVING SUM(valor) >= 5000
      )
      SELECT COUNT(DISTINCT g.external_id) as total_active_qualificados,
             COUNT(DISTINCT vh.external_id) as ja_no_historico
      FROM ggr_medio g
      INNER JOIN depositos d ON g.external_id = d.external_id
      INNER JOIN status_cliente sc ON g.external_id::uuid = sc.external_id
      LEFT JOIN jogadores_vip_historico vh ON g.external_id::uuid = vh.external_id
      WHERE sc.status = 'ACTIVE'
    `);
    
    const totalActiveQualificados = parseInt(activeQualificados.rows[0].total_active_qualificados);
    const jaNoHistorico = parseInt(activeQualificados.rows[0].ja_no_historico);
    const faltamInserir = totalActiveQualificados - jaNoHistorico;
    
    console.log(`[CRON DAILY]    ├─ ${totalActiveQualificados} usuários ACTIVE atendem critérios VIP`);
    console.log(`[CRON DAILY]    ├─ ${jaNoHistorico} já estão em jogadores_vip_historico`);
    console.log(`[CRON DAILY]    └─ ${faltamInserir} serão inseridos agora`);
    
    const vipsResult = await pool.query(`
      WITH usuarios_ggr AS (
        SELECT 
          external_id::text as external_id,
          DATE_TRUNC('month', data_e_hora) as mes,
          SUM(valor) as ggr_mes
        FROM ggr_total
        WHERE data_e_hora >= '2025-04-01'
        GROUP BY external_id, DATE_TRUNC('month', data_e_hora)
        HAVING SUM(valor) > 0
      ),
      ggr_medio AS (
        SELECT 
          external_id,
          AVG(ggr_mes) as ggr_medio
        FROM usuarios_ggr
        GROUP BY external_id
        HAVING AVG(ggr_mes) >= 1000
      ),
      depositos AS (
        SELECT 
          external_id::text as external_id,
          SUM(valor) as deposito_total,
          SUM(valor) / NULLIF(COUNT(*), 0) as ticket_medio
        FROM depositos_totais
        WHERE data_e_hora >= '2025-04-01'
        GROUP BY external_id
        HAVING SUM(valor) >= 5000
      ),
      insert_status_qualificados AS (
        -- Garante que VIPs qualificados estejam em status_cliente
        INSERT INTO status_cliente (external_id, status, atualizado_em)
        SELECT DISTINCT
          g.external_id::uuid,
          'PENDING' as status,
          NOW()
        FROM ggr_medio g
        INNER JOIN depositos d ON g.external_id = d.external_id
        LEFT JOIN status_cliente sc ON g.external_id::uuid = sc.external_id
        WHERE sc.external_id IS NULL
        ON CONFLICT (external_id) DO NOTHING
        RETURNING external_id
      ),
      novos_vips AS (
        -- TODOS os VIPs com status ACTIVE que não estão no histórico
        SELECT DISTINCT g.external_id
        FROM ggr_medio g
        INNER JOIN depositos d ON g.external_id = d.external_id
        INNER JOIN status_cliente sc ON g.external_id::uuid = sc.external_id
        LEFT JOIN jogadores_vip_historico vh ON g.external_id::uuid = vh.external_id
        WHERE sc.status = 'ACTIVE'
          AND vh.external_id IS NULL
      )
      INSERT INTO jogadores_vip_historico (
        external_id,
        ggr_medio_entrada,
        ticket_medio_entrada,
        deposito_total_entrada,
        observacao
      )
      SELECT 
        nv.external_id::uuid,
        gm.ggr_medio,
        d.ticket_medio,
        d.deposito_total,
        'Auto-cadastrado pelo CRON diário'
      FROM novos_vips nv
      INNER JOIN ggr_medio gm ON nv.external_id = gm.external_id
      INNER JOIN depositos d ON nv.external_id = d.external_id
      ON CONFLICT (external_id) DO NOTHING
      RETURNING external_id
    `);
    
    const novosVips = vipsResult.rows.length;
    console.log(`[CRON DAILY] ✅ ${novosVips} novos VIPs inseridos em jogadores_vip_historico`);
    
    if (novosVips !== faltamInserir) {
      console.log(`[CRON DAILY] ⚠️  ATENÇÃO: Esperava inserir ${faltamInserir} mas inseriu ${novosVips}`);
      console.log(`[CRON DAILY]    Possível conflito ou erro nos dados`);
    }
    
    // ===============================================
    // 6️⃣ SINCRONIZAR lista_vip (COM NOMES)
    // ===============================================
    console.log('[CRON DAILY] 📋 Sincronizando lista_vip com nomes...');
    
    const listaVipResult = await pool.query(`
      INSERT INTO lista_vip (external_id, nome, data_e_hora)
      SELECT 
        h.external_id,
        COALESCE(n.nome, 'DESCONHECIDO') as nome,
        CURRENT_TIMESTAMP
      FROM jogadores_vip_historico h
      LEFT JOIN nomes_usuarios n ON h.external_id = n.external_id
      ON CONFLICT (external_id) DO UPDATE SET
        nome = EXCLUDED.nome
      RETURNING external_id
    `);
    
    console.log(`[CRON DAILY] ✅ ${listaVipResult.rows.length} registros sincronizados em lista_vip`);

    // ===============================================
    // 6.5️⃣ SINCRONIZAR CADASTROS GOOGLE SEM DEPÓSITO
    // ===============================================
    console.log('[CRON DAILY] 🟦 Sincronizando cadastros Google sem depósito...');
    const googleSyncStats = await sincronizarGoogleSemDeposito();
    console.log(
      `[CRON DAILY] ✅ Google sync: ${googleSyncStats.total_google_sem_deposito} candidatos | ` +
      `${googleSyncStats.nomes_upsert} upserts em nomes_usuarios | ` +
      `${googleSyncStats.lista_vip_upsert} upserts em lista_vip`
    );
    
    // ===============================================
    // 6.6️⃣ SINCRONIZAR CADASTROS PLATAFORMA SEM DEPÓSITO
    // ===============================================
    console.log('[CRON DAILY] 🟪 Sincronizando cadastros Plataforma sem depósito...');
    const plataformaSyncStats = await sincronizarPlataforma();
    console.log(
      `[CRON DAILY] ✅ Plataforma sync: ${plataformaSyncStats.total_plataforma_sem_deposito} candidatos | ` +
      `${plataformaSyncStats.nomes_upsert} upserts em nomes_usuarios | ` +
      `${plataformaSyncStats.lista_vip_upsert} upserts em lista_vip`
    );

    // ===============================================
    // 7️⃣ ESTATÍSTICAS FINAIS
    // ===============================================
    console.log('[CRON DAILY] 📊 Coletando estatísticas finais...');
    
    // Contar distribuição de status
    const statusDistribuicao = await pool.query(`
      WITH usuarios_qualificados AS (
        SELECT DISTINCT g.external_id
        FROM (
          SELECT 
            external_id::text as external_id,
            DATE_TRUNC('month', data_e_hora) as mes,
            SUM(valor) as ggr_mes
          FROM ggr_total
          WHERE data_e_hora >= '2025-04-01'
          GROUP BY external_id, DATE_TRUNC('month', data_e_hora)
          HAVING SUM(valor) > 0
        ) g
        INNER JOIN (
          SELECT 
            external_id::text as external_id
          FROM depositos_totais
          WHERE data_e_hora >= '2025-04-01'
          GROUP BY external_id
          HAVING SUM(valor) >= 5000
        ) d ON g.external_id = d.external_id
        GROUP BY g.external_id
        HAVING AVG(g.ggr_mes) >= 1000
      )
      SELECT 
        COALESCE(sc.status, 'SEM_STATUS') as status,
        COUNT(*) as quantidade
      FROM usuarios_qualificados uq
      LEFT JOIN status_cliente sc ON uq.external_id::uuid = sc.external_id
      GROUP BY sc.status
      ORDER BY quantidade DESC
    `);
    
    console.log('[CRON DAILY] 📈 Distribuição de status (usuários qualificados):');
    for (const row of statusDistribuicao.rows) {
      console.log(`[CRON DAILY]    ├─ ${row.status}: ${row.quantidade}`);
    }
    
    // ===============================================
    // ✅ FINALIZAÇÃO
    // ===============================================
    const duration = Date.now() - startTime;
    
    console.log('[CRON DAILY] 🎉 Sincronização concluída!');
    console.log(`[CRON DAILY] ⏱️  Duração total: ${(duration / 1000).toFixed(2)}s`);
    console.log('[CRON DAILY] ═══════════════════════════════════════════════════════════');
    console.log('[CRON DAILY] 📊 RESUMO EXECUTIVO:');
    console.log(`[CRON DAILY]    Total de VIPs processados:         ${totalUsuarios}`);
    console.log(`[CRON DAILY]    ├─ Qualificados (critérios):       ${totalQualificados}`);
    console.log(`[CRON DAILY]    ├─ Históricos mantidos:            ${totalHistoricos}`);
    console.log(`[CRON DAILY]    └─ Novos em status_cliente:        ${novosInseridos}`);
    console.log('[CRON DAILY]');
    console.log(`[CRON DAILY]    Preferências atualizadas:          ${preferencias.length}`);
    console.log(`[CRON DAILY]    Nomes VIPs atualizados (API):      ${preferencias.length}`);
    console.log(`[CRON DAILY]    Novos em jogadores_vip_historico:  ${novosVips}`);
    console.log(`[CRON DAILY]    Lista VIP sincronizada:            ${listaVipResult.rows.length}`);
    console.log(`[CRON DAILY]    Google sem depósito (cadastros):   ${googleSyncStats.total_google_sem_deposito}`);
    console.log(`[CRON DAILY]    Google upsert em nomes_usuarios:   ${googleSyncStats.nomes_upsert}`);
    console.log(`[CRON DAILY]    Google upsert em lista_vip:        ${googleSyncStats.lista_vip_upsert}`);
    console.log(`[CRON DAILY]    Plataforma sem depósito:           ${plataformaSyncStats.total_plataforma_sem_deposito}`);
    console.log(`[CRON DAILY]    Plataforma upsert nomes_usuarios:  ${plataformaSyncStats.nomes_upsert}`);
    console.log(`[CRON DAILY]    Plataforma upsert lista_vip:       ${plataformaSyncStats.lista_vip_upsert}`);
    console.log('[CRON DAILY] ═══════════════════════════════════════════════════════════');
    
    return NextResponse.json({
      success: true,
      stats: {
        vips_processados: totalUsuarios,
        qualificados: totalQualificados,
        historicos: totalHistoricos,
        novos_status_cliente: novosInseridos,
        preferencias_atualizadas: preferencias.length,
        nomes_vips_atualizados: preferencias.length,
        novos_vips_historico: novosVips,
        lista_vip_sincronizada: listaVipResult.rows.length,
        google_sem_deposito: googleSyncStats.total_google_sem_deposito,
        google_nomes_usuarios_upsert: googleSyncStats.nomes_upsert,
        google_lista_vip_upsert: googleSyncStats.lista_vip_upsert,
        plataforma_sem_deposito: plataformaSyncStats.total_plataforma_sem_deposito,
        plataforma_nomes_usuarios_upsert: plataformaSyncStats.nomes_upsert,
        plataforma_lista_vip_upsert: plataformaSyncStats.lista_vip_upsert,
        distribuicao_status: statusDistribuicao.rows.reduce((acc: any, row: any) => {
          acc[row.status] = parseInt(row.quantidade);
          return acc;
        }, {})
      },
      duration_ms: duration
    });
    
  } catch (error) {
    console.error('[CRON DAILY] ❌ Erro:', error);
    return NextResponse.json({ 
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
      duration_ms: Date.now() - startTime
    }, { status: 500 });
  }
}

// ===============================================
// 🛠️ FUNÇÕES AUXILIARES
// ===============================================

interface SmarticoPreferencias {
  external_id: string;
  nome: string | null;
  jogo: string | null;
  provedor: string | null;
  produto_favorito: string | null;
  tipo_jogo: string | null;
  data_aniversario: string | null;
}

interface GoogleSyncStats {
  total_google_sem_deposito: number;
  nomes_upsert: number;
  lista_vip_upsert: number;
}

async function sincronizarGoogleSemDeposito(): Promise<GoogleSyncStats> {
  // REGRA DE ENTRADA: Google + sem depósito NO MÊS DE CADASTRO, desde 01/03/2026
  // PERMANÊNCIA: conexao = 'google' em nomes_usuarios — nunca é apagado
  // Sem tabela extra: usa a coluna conexao já existente em nomes_usuarios
  // Dinâmico: verifica cada usuário vs. depósitos do SEU mês de cadastro (funciona em qualquer mês)

  // 1️⃣ Encontra novos elegíveis: Google + sem depósito no próprio mês de cadastro + ainda não marcados
  const novosElegiveisResult = await pool.query(`
    WITH google_cadastros AS (
      SELECT DISTINCT
        c.external_id::text AS external_id,
        DATE_TRUNC('month', c.registration_date)                    AS mes_cadastro,
        DATE_TRUNC('month', c.registration_date) + INTERVAL '1 month' AS mes_seguinte
      FROM cadastros_smartico c
      WHERE c.registration_date >= '2026-03-01'
        AND EXISTS (
          SELECT 1 FROM acessos_diarios a
          WHERE a.external_id::text = c.external_id::text
            AND a.clickid ILIKE '%gads%'
        )
    ),
    depositos_no_mes AS (
      SELECT d.external_id::text AS external_id, SUM(d.valor) AS total
      FROM depositos_totais d
      JOIN google_cadastros gc ON gc.external_id = d.external_id::text
      WHERE d.data_e_hora >= gc.mes_cadastro
        AND d.data_e_hora <  gc.mes_seguinte
      GROUP BY d.external_id::text
    )
    SELECT gc.external_id
    FROM google_cadastros gc
    LEFT JOIN depositos_no_mes dm ON gc.external_id = dm.external_id
    WHERE COALESCE(dm.total, 0) = 0
      AND NOT EXISTS (
        SELECT 1 FROM nomes_usuarios nu
        WHERE nu.external_id::text = gc.external_id
          AND nu.conexao = 'google'
      )
  `);

  const novosIds = novosElegiveisResult.rows.map((r: { external_id: string }) => r.external_id);

  // 2️⃣ Upsert em nomes_usuarios com conexao = 'google' (nunca sobrescreve 'digisac')
  let nomesUpsert = 0;
  if (novosIds.length > 0) {
    const nomesResult = await pool.query(`
      INSERT INTO nomes_usuarios (external_id, nome, conexao, atualizado_em)
      SELECT
        a.external_id::uuid,
        COALESCE(nu.nome, 'DESCONHECIDO'),
        'google',
        CURRENT_TIMESTAMP
      FROM unnest($1::text[]) AS a(external_id)
      LEFT JOIN nomes_usuarios nu ON nu.external_id::text = a.external_id
      ON CONFLICT (external_id) DO UPDATE SET
        conexao = 'google',  -- sempre marca como google se elegível
        nome = CASE
          WHEN nomes_usuarios.nome IS NULL OR nomes_usuarios.nome = '' OR nomes_usuarios.nome = 'DESCONHECIDO'
            THEN EXCLUDED.nome
          ELSE nomes_usuarios.nome
        END,
        atualizado_em = CURRENT_TIMESTAMP
      RETURNING external_id
    `, [novosIds]);
    nomesUpsert = nomesResult.rows.length;
    console.log(`[GOOGLE SYNC] ✅ ${nomesUpsert} novos marcados com conexao='google' em nomes_usuarios`);
  }

  // 3️⃣ Popula lista_vip para TODOS com conexao='google'
  const todosGoogleResult = await pool.query(`
    SELECT external_id::text AS external_id, nome FROM nomes_usuarios WHERE conexao = 'google'
  `);
  const todosIds = todosGoogleResult.rows.map((r: { external_id: string }) => r.external_id);

  let listaVipUpsert = 0;
  if (todosIds.length > 0) {
    const listaVipResult = await pool.query(`
      INSERT INTO lista_vip (external_id, nome, origem, data_e_hora)
      SELECT
        a.external_id,
        COALESCE(nu.nome, 'DESCONHECIDO'),
        'google',
        CURRENT_TIMESTAMP
      FROM unnest($1::text[]) AS a(external_id)
      LEFT JOIN nomes_usuarios nu ON nu.external_id::text = a.external_id
      ON CONFLICT (external_id) DO UPDATE SET
        nome = CASE
          WHEN lista_vip.nome IS NULL OR lista_vip.nome = '' OR lista_vip.nome = 'DESCONHECIDO'
            THEN EXCLUDED.nome
          ELSE lista_vip.nome
        END,
        origem = 'google',
        data_e_hora = CURRENT_TIMESTAMP
      RETURNING external_id
    `, [todosIds]);
    listaVipUpsert = listaVipResult.rows.length;
  }

  // 4️⃣ Inserir em status_cliente como ACTIVE (apenas novos, não sobrescreve existentes)
  if (todosIds.length > 0) {
    await pool.query(`
      INSERT INTO status_cliente (external_id, status, atualizado_em)
      SELECT
        a.external_id::uuid,
        'ACTIVE',
        CURRENT_TIMESTAMP
      FROM unnest($1::text[]) AS a(external_id)
      ON CONFLICT (external_id) DO NOTHING
    `, [todosIds]);
  }

  return {
    total_google_sem_deposito: todosIds.length,
    nomes_upsert: nomesUpsert,
    lista_vip_upsert: listaVipUpsert
  };
}

interface PlataformaSyncStats {
  total_plataforma_sem_deposito: number;
  nomes_upsert: number;
  lista_vip_upsert: number;
}

async function sincronizarPlataforma(): Promise<PlataformaSyncStats> {
  // REGRA DE ENTRADA: Cadastrado na plataforma desde 01/04/2026 + NUNCA fez depósito
  // PERMANÊNCIA: conexao = 'plataforma' em nomes_usuarios — nunca é removido
  // Não sobrescreve conexao 'google' ou 'digisac' se já existir
  // Roda 1x/dia no cron, pegando dados acumulados desde a data de início

  // 1️⃣ Encontra novos elegíveis: cadastrados desde 01/04/2026 sem nenhum depósito
  //    + NÃO existem em lista_vip (qualquer origem) nem em nomes_usuarios com conexao preenchida
  const novosElegiveisResult = await pool.query(`
    SELECT DISTINCT c.external_id::text AS external_id
    FROM cadastros_smartico c
    WHERE c.registration_date >= '2026-04-01'
      AND NOT EXISTS (
        SELECT 1 FROM depositos_totais d
        WHERE d.external_id::text = c.external_id::text
      )
      AND NOT EXISTS (
        SELECT 1 FROM lista_vip lv
        WHERE lv.external_id::text = c.external_id::text
      )
      AND NOT EXISTS (
        SELECT 1 FROM nomes_usuarios nu
        WHERE nu.external_id::text = c.external_id::text
          AND nu.conexao IS NOT NULL
      )
  `);

  const novosIds = novosElegiveisResult.rows.map((r: { external_id: string }) => r.external_id);
  console.log(`[PLATAFORMA SYNC] 📋 ${novosIds.length} novos elegíveis encontrados`);

  // 2️⃣ Upsert em nomes_usuarios com conexao = 'plataforma' (nunca sobrescreve 'google' ou 'digisac')
  let nomesUpsert = 0;
  if (novosIds.length > 0) {
    const nomesResult = await pool.query(`
      INSERT INTO nomes_usuarios (external_id, nome, conexao, atualizado_em)
      SELECT
        a.external_id::uuid,
        'DESCONHECIDO',
        'plataforma',
        CURRENT_TIMESTAMP
      FROM unnest($1::text[]) AS a(external_id)
      ON CONFLICT (external_id) DO NOTHING
      RETURNING external_id
    `, [novosIds]);
    nomesUpsert = nomesResult.rows.length;
    console.log(`[PLATAFORMA SYNC] ✅ ${nomesUpsert} novos marcados com conexao='plataforma' em nomes_usuarios`);
  }

  // 3️⃣ Popula lista_vip apenas com os NOVOS (que acabamos de inserir em nomes_usuarios)
  let listaVipUpsert = 0;
  if (novosIds.length > 0) {
    const listaVipResult = await pool.query(`
      INSERT INTO lista_vip (external_id, nome, origem, data_e_hora)
      SELECT
        a.external_id,
        COALESCE(nu.nome, 'DESCONHECIDO'),
        'plataforma',
        CURRENT_TIMESTAMP
      FROM unnest($1::text[]) AS a(external_id)
      LEFT JOIN nomes_usuarios nu ON nu.external_id::text = a.external_id
      ON CONFLICT (external_id) DO NOTHING
      RETURNING external_id
    `, [novosIds]);
    listaVipUpsert = listaVipResult.rows.length;
  }

  // 4️⃣ Inserir em status_cliente como ACTIVE (apenas novos, não sobrescreve existentes)
  let statusClienteUpsert = 0;
  if (novosIds.length > 0) {
    const statusResult = await pool.query(`
      INSERT INTO status_cliente (external_id, status, atualizado_em)
      SELECT
        a.external_id::uuid,
        'ACTIVE',
        CURRENT_TIMESTAMP
      FROM unnest($1::text[]) AS a(external_id)
      ON CONFLICT (external_id) DO NOTHING
      RETURNING external_id
    `, [novosIds]);
    statusClienteUpsert = statusResult.rows.length;
    console.log(`[PLATAFORMA SYNC] ✅ ${statusClienteUpsert} novos inseridos em status_cliente como ACTIVE`);
  }

  // Contar total de plataforma existentes para log
  const totalPlataformaResult = await pool.query(`
    SELECT COUNT(*) AS total FROM lista_vip WHERE origem = 'plataforma'
  `);
  const totalPlataforma = parseInt(totalPlataformaResult.rows[0].total);

  console.log(`[PLATAFORMA SYNC] ✅ ${totalPlataforma} total plataforma | ${listaVipUpsert} novos em lista_vip | ${statusClienteUpsert} novos em status_cliente`);

  return {
    total_plataforma_sem_deposito: totalPlataforma,
    nomes_upsert: nomesUpsert,
    lista_vip_upsert: listaVipUpsert
  };
}

function getBigQueryClient() {
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.trim().replace(/\\n/g, '\n');
  const projectId = process.env.GOOGLE_PROJECT_ID?.trim();
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL?.trim();
  
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
    return value.slice(0, 3).map(v => String(v)).join(', ');
  }
  return String(value);
}

/**
 * ⚠️ DEPRECATED - Use getMapeamentos() do cache-mapeamentos.ts
 * 
 * Esta função fazia queries diretas ao BigQuery (~5 GB/mês pelo cron)
 * Nova função usa cache (PostgreSQL + Memória) = ~0 GB/mês
 */
async function carregarMapeamentos(client: any, labelId: string) {
  const dataset = `dwh_ext_${labelId}`;
  
  console.log('[MAPEAMENTOS] Carregando dicionários de nomes do BigQuery...');
  
  try {
    const [gamesRows] = await client.query({
      query: `SELECT smr_game_id, game_name FROM \`smartico-bq3.${dataset}.dm_casino_game_name\``
    });
    const gamesMap = new Map<number, string>();
    for (const row of gamesRows as any[]) {
      gamesMap.set(row.smr_game_id, row.game_name);
    }
    console.log(`[MAPEAMENTOS] ✓ ${gamesMap.size} jogos carregados`);
    
    const [providersRows] = await client.query({
      query: `SELECT smr_provider_id, provider_name FROM \`smartico-bq3.${dataset}.dm_casino_provider_name\``
    });
    const providersMap = new Map<number, string>();
    for (const row of providersRows as any[]) {
      providersMap.set(row.smr_provider_id, row.provider_name);
    }
    console.log(`[MAPEAMENTOS] ✓ ${providersMap.size} provedores carregados`);
    
    const [typesRows] = await client.query({
      query: `SELECT smr_game_type_id, game_type FROM \`smartico-bq3.${dataset}.dm_casino_game_type\``
    });
    const typesMap = new Map<number, string>();
    for (const row of typesRows as any[]) {
      typesMap.set(row.smr_game_type_id, row.game_type);
    }
    console.log(`[MAPEAMENTOS] ✓ ${typesMap.size} tipos de jogo carregados`);
    
    return { gamesMap, providersMap, typesMap };
  } catch (error) {
    console.error('[MAPEAMENTOS] ❌ Erro ao carregar:', error);
    return null;
  }
}

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
    return idsString;
  }
}

/**
 * Busca nomes reais (first_name, last_name) via API REST do Smartico
 */
async function buscarNomesSmarticoAPI(externalIds: string[]): Promise<Map<string, {firstName: string, lastName: string}>> {
  const SMARTICO_API_BASE = "https://apis3.smartico.ai";
  const SMARTICO_AUTH_TOKEN = process.env.SMARTICO_AUTH_TOKEN || "19d4651b-1e9b-400b-8b0c-56fe6e37efa1";
  
  const nomes = new Map<string, {firstName: string, lastName: string}>();
  
  if (externalIds.length === 0) return nomes;
  
  console.log(`[SMARTICO API] Buscando nomes de ${externalIds.length} usuários...`);
  
  // Processar em batches de 10 (limite da API)
  const batchSize = 10;
  
  for (let i = 0; i < externalIds.length; i += batchSize) {
    const batch = externalIds.slice(i, i + batchSize);
    
    try {
      const users = batch.map(extId => ({
        user_ext_id: extId,
        ext_brand_id: process.env.SMARTICO_BRAND_ID || "sua-marca"
      }));
      
      const payload = {
        eid: crypto.randomUUID(),
        properties: ["user_first_name", "user_last_name"],
        show_enum_values: true,
        users
      };
      
      const response = await fetch(`${SMARTICO_API_BASE}/api/external/user_state/v2`, {
        method: 'POST',
        headers: {
          'Authorization': SMARTICO_AUTH_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.results && data.results[0]?.users) {
          for (const user of data.results[0].users) {
            const extId = user.user_ext_id;
            const props = user.properties || {};
            const firstName = props.user_first_name || '';
            const lastName = props.user_last_name || '';
            
            if (firstName || lastName) {
              nomes.set(extId, { firstName, lastName });
            }
          }
        }
      }
      
      // Rate limiting - 30 req/min
      if (i + batchSize < externalIds.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error(`[SMARTICO API] Erro no batch ${Math.floor(i / batchSize) + 1}:`, error);
    }
  }
  
  console.log(`[SMARTICO API] ${nomes.size} nomes encontrados via API`);
  return nomes;
}

/**
 * Formata nome completo para "PRIMEIRO N" em MAIÚSCULO
 * Prioriza firstName/lastName da API, fallback para username
 */
function formatarNomeCompleto(firstName: string | null, lastName: string | null, username: string | null): string {
  // Tentar usar nome e sobrenome reais primeiro (da API)
  if (firstName && firstName.trim() !== '') {
    const primeiroNome = firstName.trim().toUpperCase();
    
    if (lastName && lastName.trim() !== '') {
      const inicialSegundo = lastName.trim().charAt(0).toUpperCase();
      return `${primeiroNome} ${inicialSegundo}`;
    }
    
    return primeiroNome;
  }
  
  // Fallback: extrair do username se nome real não existir
  if (!username || username.trim() === '') return 'DESCONHECIDO';
  
  const limpo = username
    .toLowerCase()
    .replace(/[0-9]/g, '')
    .replace(/[_\-\.]/g, ' ')
    .trim();
  
  if (!limpo) return 'DESCONHECIDO';
  
  const palavras = limpo.split(/\s+/).filter(p => p.length > 0);
  
  if (palavras.length === 0) return 'DESCONHECIDO';
  
  const primeiroNome = palavras[0].toUpperCase();
  
  if (palavras.length === 1) {
    return primeiroNome;
  }
  
  const inicialSegundo = palavras[1].charAt(0).toUpperCase();
  return `${primeiroNome} ${inicialSegundo}`;
}

function formatarDataSmartico(value: unknown): string | null {
  if (!value) return null;
  
  try {
    const dateStr = String(value);
    
    if (/^\d{8}$/.test(dateStr)) {
      const ano = dateStr.substring(0, 4);
      const mes = dateStr.substring(4, 6);
      const dia = dateStr.substring(6, 8);
      return `${ano}-${mes}-${dia}`;
    }
    
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr;
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Busca preferências de TODOS os usuários (pode ser > 5k)
 * Processa em lotes de 500 para não estourar limites do BigQuery
 * ✅ NOMES: Busca via API Smartico APENAS para usuários sem nome (limite: 500/execução)
 * ✅ OTIMIZAÇÃO: Usar nomes existentes do banco para evitar timeout
 */
async function buscarPreferenciasSmarticoCompleto(externalIds: string[]): Promise<SmarticoPreferencias[]> {
  if (externalIds.length === 0) return [];
  
  const client = getBigQueryClient();
  const labelId = process.env.SMARTICO_LABEL_ID?.trim();
  
  if (!labelId) {
    throw new Error('SMARTICO_LABEL_ID não configurado');
  }
  
  const dataset = `dwh_ext_${labelId}`;
  
  // ✅ Carregar mapeamentos do CACHE (PostgreSQL + Memória)
  const mappings = await getMapeamentos(client, labelId);
  console.log('[SMARTICO] ✅ Mapeamentos carregados do cache');
  
  // ✅ OTIMIZAÇÃO: Filtrar usuários já atualizados nas últimas 20h
  // Cron roda 1x/dia — quem já foi atualizado hoje não precisa ir ao BigQuery
  const jaAtualizadosResult = await pool.query(`
    SELECT external_id::text
    FROM nomes_usuarios
    WHERE external_id = ANY($1::uuid[])
      AND atualizado_em >= NOW() - INTERVAL '20 hours'
      AND jogo IS NOT NULL
  `, [externalIds]);
  const jaAtualizadosSet = new Set(jaAtualizadosResult.rows.map((r: { external_id: string }) => r.external_id));
  const externalIdsFiltrados = externalIds.filter(id => !jaAtualizadosSet.has(id));
  console.log(`[SMARTICO] ⚡ ${jaAtualizadosSet.size} usuários já atualizados hoje (pulando BigQuery)`);
  console.log(`[SMARTICO] 📋 ${externalIdsFiltrados.length} usuários a processar no BigQuery`);

  if (externalIdsFiltrados.length === 0) {
    console.log('[SMARTICO] ✅ Todos os usuários já atualizados hoje, nada a fazer');
    return [];
  }

  // ✅ OTIMIZAÇÃO: Buscar nomes existentes no banco primeiro
  console.log('[SMARTICO] 🔍 Verificando nomes existentes no banco...');
  const nomesExistentesResult = await pool.query(`
    SELECT external_id::text, nome
    FROM nomes_usuarios
    WHERE external_id = ANY($1::uuid[])
      AND nome IS NOT NULL
      AND nome != ''
      AND nome != 'DESCONHECIDO'
  `, [externalIdsFiltrados]);
  
  const nomesExistentes = new Map<string, string>();
  for (const row of nomesExistentesResult.rows) {
    nomesExistentes.set(row.external_id, row.nome);
  }
  
  console.log(`[SMARTICO] ✅ ${nomesExistentes.size} nomes já existem no banco`);
  
  // ✅ Identificar usuários SEM nome (precisam buscar via API)
  const usuariosSemNome = externalIdsFiltrados.filter(id => !nomesExistentes.has(id));
  const MAX_API_REQUESTS = 500; // Limitar para evitar timeout
  const usuariosParaBuscar = usuariosSemNome.slice(0, MAX_API_REQUESTS);
  
  console.log(`[SMARTICO] 📊 ${usuariosSemNome.length} VIPs sem nome`);
  if (usuariosSemNome.length > MAX_API_REQUESTS) {
    console.log(`[SMARTICO] ⚠️  Limitando a ${MAX_API_REQUESTS} requisições API (${usuariosSemNome.length - MAX_API_REQUESTS} serão processados pelo CRON NOMES)`);
  }
  
  // ✅ Buscar nomes via API Smartico APENAS para usuários sem nome
  const SMARTICO_API_BASE = "https://apis3.smartico.ai";
  const SMARTICO_AUTH_TOKEN = process.env.SMARTICO_AUTH_TOKEN || "19d4651b-1e9b-400b-8b0c-56fe6e37efa1";
  
  const nomesMap = new Map<string, {firstName: string, lastName: string}>();
  
  if (usuariosParaBuscar.length > 0) {
    console.log(`[SMARTICO] Buscando ${usuariosParaBuscar.length} nomes via API Smartico...`);
    
    const apiStartTime = Date.now();
    
    // Processar em lotes de 10 usuários (limite da API)
    const apiBatchSize = 10;
    let processados = 0;
    
    for (let i = 0; i < usuariosParaBuscar.length; i += apiBatchSize) {
      const batch = usuariosParaBuscar.slice(i, i + apiBatchSize);
      
      try {
        const users = batch.map(extId => ({
          user_ext_id: extId,
          ext_brand_id: process.env.SMARTICO_BRAND_ID || "sua-marca"
        }));
        
        const payload = {
          eid: crypto.randomUUID(),
          properties: ["user_first_name", "user_last_name"],
          show_enum_values: true,
          users
        };
        
        const response = await fetch(`${SMARTICO_API_BASE}/api/external/user_state/v2`, {
          method: 'POST',
          headers: {
            'Authorization': SMARTICO_AUTH_TOKEN,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.results && data.results[0]?.users) {
            for (const user of data.results[0].users) {
              const extId = user.user_ext_id;
              const props = user.properties || {};
              const firstName = props.user_first_name || '';
              const lastName = props.user_last_name || '';
              
              if (firstName || lastName) {
                nomesMap.set(extId, { firstName, lastName });
              }
            }
          }
        }
        
        processados += batch.length;
        
        // Log de progresso a cada 100 usuários
        if (processados % 100 === 0 || processados === usuariosParaBuscar.length) {
          console.log(`[SMARTICO API] Processados ${processados}/${usuariosParaBuscar.length} nomes`);
        }
        
        // Rate limiting - 30 req/min (2s entre requests)
        if (i + apiBatchSize < usuariosParaBuscar.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error(`[SMARTICO API] Erro no batch ${Math.floor(i / apiBatchSize) + 1}:`, error);
      }
    }
    
    const apiDuration = ((Date.now() - apiStartTime) / 1000).toFixed(1);
    console.log(`[SMARTICO API] ✅ ${nomesMap.size} nomes novos encontrados via API em ${apiDuration}s`);
  } else {
    console.log('[SMARTICO API] ✅ Todos os VIPs já possuem nome no banco, pulando API');
  }
  
  const resultados: SmarticoPreferencias[] = [];
  const batchSize = 500;
  const maxBatches = 50; // Máximo 25.000 usuários por execução (50 * 500)
  const startTime = Date.now();
  
  console.log(`[SMARTICO] Processando ${externalIdsFiltrados.length} preferências em lotes de ${batchSize}...`);
  console.log(`[SMARTICO] Limite máximo: ${maxBatches} lotes para evitar timeout`);
  
  // Processar em lotes de 500
  for (let i = 0; i < externalIdsFiltrados.length && i < (maxBatches * batchSize); i += batchSize) {
    const batch = externalIdsFiltrados.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(externalIdsFiltrados.length / batchSize);
    
    console.log(`[SMARTICO] Processando lote ${batchNum}/${totalBatches} (${batch.length} usuários)...`);
    
    try {
      const tableName = `smartico-bq3.${dataset}.j_user`;
      const query = `
        SELECT
          user_ext_id,
          core_username,
          user_birthdate,
          core_fav_product_type,
          core_fav_game_top3,
          core_fav_game_type_top3,
          core_fav_game_provider_top3
        FROM \`${tableName}\`
        WHERE user_ext_id IN UNNEST(@external_ids)
      `;

      if (batchNum === 1) {
        console.log(`[SMARTICO] 🔍 BigQuery table: ${tableName}`);
        console.log(`[SMARTICO] 🔍 Query sample IDs: ${batch.slice(0, 3).join(', ')}`);
      }
      
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
        
        // ✅ Determinar nome: usar existente do banco OU buscar via API
        let nomeFormatado: string;
        
        const nomeExistente = nomesExistentes.get(row.user_ext_id);
        if (nomeExistente) {
          // ✅ Usar nome que já existe no banco
          nomeFormatado = nomeExistente;
        } else {
          // ✅ Usar nome da API (se foi buscado)
          const nomesApi = nomesMap.get(row.user_ext_id);
          const firstName = nomesApi?.firstName || null;
          const lastName = nomesApi?.lastName || null;
          nomeFormatado = formatarNomeCompleto(firstName, lastName, row.core_username);
        }
        
        resultados.push({
          external_id: row.user_ext_id,
          nome: nomeFormatado,
          jogo,
          provedor,
          produto_favorito: normalizarCampoPreferencia(row.core_fav_product_type),
          tipo_jogo: tipoJogo,
          data_aniversario: formatarDataSmartico(row.user_birthdate)
        });
      }
      
      console.log(`[SMARTICO] Lote ${batchNum}/${totalBatches} concluído (${rows.length} registros) - ${resultados.length} total`);
      
      // Delay de 100ms entre lotes para evitar rate limiting
      if (i + batchSize < externalIds.length && batchNum < maxBatches) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
    } catch (error) {
      console.error(`[SMARTICO] Erro no lote ${batchNum}:`, error);
      // Continua mesmo com erro em um lote
      await new Promise(resolve => setTimeout(resolve, 500)); // Delay maior em caso de erro
    }
  }
  
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  const batchesProcessed = Math.min(Math.ceil(externalIds.length / batchSize), maxBatches);
  const avgTimePerBatch = (parseFloat(totalTime) / batchesProcessed).toFixed(2);
  
  console.log(`[SMARTICO] ✅ Total processado: ${resultados.length} preferências em ${totalTime}s (média ${avgTimePerBatch}s/lote)`);
  
  if (externalIds.length > maxBatches * batchSize) {
    console.log(`[SMARTICO] ⚠️ AVISO: Limite de ${maxBatches} lotes atingido. ${externalIds.length - (maxBatches * batchSize)} usuários restantes serão processados na próxima execução.`);
  }
  
  return resultados;
}

/**
 * Atualiza tabela nomes_usuarios com preferências da Smartico
 * Insere novos ou atualiza existentes
 */
async function atualizarNomesUsuarios(preferencias: SmarticoPreferencias[]): Promise<void> {
  if (preferencias.length === 0) return;
  
  console.log('[NOMES_USUARIOS] Atualizando nomes dos jogadores (formato: Primeiro N)...');
  
  const batchSize = 200;
  let totalAtualizados = 0;
  
  for (let i = 0; i < preferencias.length; i += batchSize) {
    const batch = preferencias.slice(i, i + batchSize);
    
    const values = batch.map((_, idx) => {
      const offset = idx * 7;
      return `($${offset + 1}::uuid, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}::date, CURRENT_TIMESTAMP)`;
    }).join(', ');
    
    const params = batch.flatMap(p => [
      p.external_id,
      p.nome || null, // NULL para preservar nome existente
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
        nome = COALESCE(EXCLUDED.nome, nomes_usuarios.nome), -- Preserva nome existente se novo for NULL
        jogo = EXCLUDED.jogo,
        provedor = EXCLUDED.provedor,
        produto_favorito = EXCLUDED.produto_favorito,
        tipo_jogo = EXCLUDED.tipo_jogo,
        data_aniversario = EXCLUDED.data_aniversario,
        atualizado_em = CURRENT_TIMESTAMP
    `, params);
    
    totalAtualizados += batch.length;
    console.log(`[NOMES_USUARIOS] Processados ${totalAtualizados}/${preferencias.length} usuários`);
  }
}

/**
 * ❌ FUNÇÃO DESABILITADA - Causava timeout ao processar 2300+ usuários via API
 * 
 * Atualiza nomes de TODOS os usuários da tabela nomes_usuarios
 * ✅ Usa API Smartico (mesmo método do CRON NOMES)
 * Nota: VIPs já têm nomes reais da API via buscarPreferenciasSmarticoCompleto()
 * 
 * SOLUÇÃO: CRON NOMES processa gradualmente (500 por vez, a cada hora)
 */
/*
async function atualizarNomesDeUsuariosSemNome(): Promise<number> {
  console.log('[NOMES_COMPLETOS] Buscando TODOS os usuários para atualizar nomes...');
  
  // Buscar TODOS os external_ids da tabela nomes_usuarios
  const usuariosResult = await pool.query(`
    SELECT external_id::text
    FROM nomes_usuarios
  `);
  
  const externalIds = usuariosResult.rows.map(r => r.external_id);
  
  if (externalIds.length === 0) {
    console.log('[NOMES_COMPLETOS] Nenhum usuário encontrado');
    return 0;
  }
  
  console.log(`[NOMES_COMPLETOS] ${externalIds.length} usuários para atualizar`);
  console.log('[NOMES_COMPLETOS] Usando API Smartico (mesmo método do CRON NOMES)');
  
  // ✅ Buscar nomes via API Smartico (mesmo método do CRON NOMES)
  const SMARTICO_API_BASE = "https://apis3.smartico.ai";
  const SMARTICO_AUTH_TOKEN = process.env.SMARTICO_AUTH_TOKEN || "19d4651b-1e9b-400b-8b0c-56fe6e37efa1";
  
  let totalAtualizados = 0;
  const apiBatchSize = 10; // API aceita até 10 por vez
  
  // Processar em lotes de 10
  for (let i = 0; i < externalIds.length; i += apiBatchSize) {
    const batch = externalIds.slice(i, i + apiBatchSize);
    
    try {
      const users = batch.map(extId => ({
        user_ext_id: extId,
        ext_brand_id: process.env.SMARTICO_BRAND_ID || "sua-marca"
      }));
      
      const payload = {
        eid: crypto.randomUUID(),
        properties: ["user_first_name", "user_last_name"],
        show_enum_values: true,
        users
      };
      
      const response = await fetch(`${SMARTICO_API_BASE}/api/external/user_state/v2`, {
        method: 'POST',
        headers: {
          'Authorization': SMARTICO_AUTH_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.results && data.results[0]?.users) {
          // ✅ OTIMIZAÇÃO: Batch update em vez de queries individuais
          const updateCases: string[] = [];
          const updateParams: any[] = [];
          const userIds: string[] = [];
          let paramIndex = 1;
          
          for (const user of data.results[0].users) {
            const extId = user.user_ext_id;
            const props = user.properties || {};
            const firstName = props.user_first_name || '';
            const lastName = props.user_last_name || '';
            
            // Formatar nome (mesmo método do CRON NOMES)
            const nomeCompleto = `${firstName} ${lastName}`.trim();
            let nomeFormatado = '';
            
            if (nomeCompleto) {
              const partes = nomeCompleto.split(/\\s+/);
              if (partes.length === 1) {
                nomeFormatado = partes[0].toUpperCase();
              } else {
                const primeiroNome = partes[0].toUpperCase();
                const ultimaParte = partes[partes.length - 1];
                const primeiraLetra = ultimaParte.charAt(0).toUpperCase();
                nomeFormatado = `${primeiroNome} ${primeiraLetra}.`;
              }
            }
            
            if (nomeFormatado) {
              updateCases.push(
                `WHEN external_id = $${paramIndex}::uuid THEN ` +
                `CASE WHEN $${paramIndex + 1} = 'DESCONHECIDO' AND nome IS NOT NULL AND TRIM(nome) != '' AND UPPER(TRIM(nome)) != 'DESCONHECIDO' ` +
                `THEN nome ELSE $${paramIndex + 1} END`
              );
              
              updateParams.push(extId, nomeFormatado);
              userIds.push(`$${paramIndex}::uuid`);
              paramIndex += 2;
            }
          }
          
          // Uma única query para atualizar todo o lote
          if (updateCases.length > 0) {
            const updateQuery = `
              UPDATE nomes_usuarios
              SET nome = CASE 
                ${updateCases.join('\\n            ')}
                ELSE nome
              END,
              atualizado_em = CURRENT_TIMESTAMP
              WHERE external_id IN (${userIds.join(', ')})
            `;
            
            await pool.query(updateQuery, updateParams);
            totalAtualizados += updateCases.length;
          }
        }
      }
      
      console.log(`[NOMES_COMPLETOS] Processados ${Math.min(i + apiBatchSize, externalIds.length)}/${externalIds.length}`);
      
      // Rate limiting - 30 req/min (2s entre requests)
      if (i + apiBatchSize < externalIds.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error(`[NOMES_COMPLETOS] Erro no lote ${Math.floor(i / apiBatchSize) + 1}:`, error);
    }
  }
  
  return totalAtualizados;
}
*/
