import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

interface UserInfo {
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  favorite_games: string[];
  favorite_providers: string[];
  favorite_team: string | null;
  favorite_product: string | null;
  favorite_game_types: string[];
}

/**
 * GET /api/smartico/user-info?external_id=xxx
 * 
 * ✅ OTIMIZADO: Busca dados do PostgreSQL (nomes_usuarios)
 * Preferências já são sincronizadas pelo CRON DAILY do BigQuery
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const external_id = searchParams.get('external_id');

    if (!external_id) {
      return NextResponse.json(
        { success: false, error: 'external_id é obrigatório' },
        { status: 400 }
      );
    }

    console.log(`[SMARTICO USER INFO] Buscando dados de ${external_id}`);

    // Buscar dados da tabela nomes_usuarios (PostgreSQL)
    let favoriteGames: string[] = [];
    let favoriteProviders: string[] = [];
    let favoriteTeam: string | null = null;
    let birthDate: string | null = null;
    let favoriteProduct: string | null = null;
    let favoriteGameTypes: string[] = [];

    try {
      const prefQuery = await pool.query(
        'SELECT jogo, provedor, time, data_aniversario, produto_favorito, tipo_jogo FROM nomes_usuarios WHERE external_id = $1',
        [external_id]
      );

      if (prefQuery.rows.length > 0) {
        const { jogo, provedor, time, data_aniversario, produto_favorito, tipo_jogo } = prefQuery.rows[0];
        
        // Parse das colunas TEXT (formato: "item1, item2, item3")
        if (jogo) {
          favoriteGames = jogo.split(',').map((j: string) => j.trim()).filter(Boolean);
        }
        if (provedor) {
          favoriteProviders = provedor.split(',').map((p: string) => p.trim()).filter(Boolean);
        }
        if (time) {
          favoriteTeam = time.trim();
        }
        if (produto_favorito) {
          favoriteProduct = produto_favorito.trim();
        }
        if (tipo_jogo) {
          favoriteGameTypes = tipo_jogo.split(',').map((t: string) => t.trim()).filter(Boolean);
        }
        
        // Data de aniversário
        if (data_aniversario) {
          birthDate = data_aniversario instanceof Date 
            ? data_aniversario.toISOString().split('T')[0]
            : data_aniversario;
        }

        console.log(`[SMARTICO USER INFO] Dados encontrados no PostgreSQL:`, {
          jogos: favoriteGames,
          provedores: favoriteProviders,
          time: favoriteTeam,
          aniversario: birthDate,
          produto: favoriteProduct,
          tipos_jogo: favoriteGameTypes
        });
      } else {
        console.log(`[SMARTICO USER INFO] Nenhum dado encontrado no PostgreSQL`);
      }
    } catch (error) {
      console.warn('[SMARTICO USER INFO] Erro ao buscar dados do PostgreSQL:', error);
      // Continua mesmo se falhar
    }

    // ✅ Todos os dados vêm do PostgreSQL (sincronizados pelo CRON DAILY)
    // Não é necessário consultar BigQuery aqui
    
    const userInfo: UserInfo = {
      birth_date: birthDate,
      email: null,
      phone: null,
      favorite_games: favoriteGames,
      favorite_providers: favoriteProviders,
      favorite_team: favoriteTeam,
      favorite_product: favoriteProduct,
      favorite_game_types: favoriteGameTypes
    };

    console.log(`[SMARTICO USER INFO] Dados encontrados:`, userInfo);

    return NextResponse.json({
      success: true,
      data: userInfo
    });

  } catch (error) {
    console.error('[SMARTICO USER INFO] Erro:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Erro ao buscar informações do usuário',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  }
}
