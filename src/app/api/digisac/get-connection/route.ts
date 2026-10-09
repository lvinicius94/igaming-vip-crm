import { NextRequest, NextResponse } from 'next/server';

interface DigisacConnection {
  id: string;
  name: string;
  data: {
    status: {
      isConnected: boolean;
      myNumber: string;
    };
  };
}

interface DigisacApiResponse {
  data: DigisacConnection[];
  total: number;
}

/**
 * Busca conexões ativas no Digisac
 */
async function getActiveConnections(): Promise<DigisacConnection[]> {
  try {
    const url = process.env.DIGISAC_API_URL;
    const token = process.env.DIGISAC_API_TOKEN;

    if (!url || !token) {
      throw new Error('Credenciais Digisac não configuradas');
    }

    // Query para buscar apenas conexões ativas (não arquivadas)
    const query = {
      where: {
        archivedAt: { $eq: null }
      },
      order: [['name', 'asc']],
      page: 1,
      perPage: 50
    };

    const queryString = encodeURIComponent(JSON.stringify(query));
    const apiUrl = `${url}/services?query=${queryString}`;

    console.log('[DIGISAC] Buscando conexões ativas...');

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Digisac API error: ${response.status} ${response.statusText}`);
    }

    const data: DigisacApiResponse = await response.json();

    // Filtrar apenas conexões com status conectado
    const activeConnections = data.data.filter(conn => 
      conn.data?.status?.isConnected === true
    );

    console.log(`[DIGISAC] ✓ ${activeConnections.length}/${data.data.length} conexões ativas encontradas`);

    return activeConnections;
  } catch (error) {
    console.error('[DIGISAC] Erro ao buscar conexões:', error);
    return [];
  }
}

/**
 * Gera hash consistente para um external_id
 */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Seleciona conexão para um jogador usando hash consistente
 */
function selectConnectionForPlayer(
  externalId: string, 
  activeConnections: DigisacConnection[]
): DigisacConnection {
  const hash = hashCode(externalId);
  const index = hash % activeConnections.length;
  return activeConnections[index];
}

/**
 * GET /api/digisac/get-connection
 * 
 * Retorna a conexão Digisac atribuída a um jogador
 * 
 * Query params:
 * - external_id: UUID do jogador
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const externalId = searchParams.get('external_id');

    if (!externalId) {
      return NextResponse.json(
        { success: false, error: 'external_id é obrigatório' },
        { status: 400 }
      );
    }

    console.log(`[DIGISAC CONNECTION] Buscando conexão para ${externalId}`);

    // 1. Buscar conexões ativas no Digisac
    const activeConnections = await getActiveConnections();

    if (activeConnections.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Nenhuma conexão ativa disponível',
        allOffline: true
      }, { status: 503 });
    }

    // 2. Atribuir conexão de forma determinística via hash (sem persistir no banco)
    const assignedConnection = selectConnectionForPlayer(externalId, activeConnections);
    console.log(`[DIGISAC] ✓ Conexão atribuída por hash: ${assignedConnection.name}`);

    return NextResponse.json({
      success: true,
      connection: {
        id: assignedConnection.id,
        name: assignedConnection.name,
        phone: assignedConnection.data.status.myNumber
      },
      totalActiveConnections: activeConnections.length
    });

  } catch (error) {
    console.error('[DIGISAC CONNECTION] Erro:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erro desconhecido' 
      },
      { status: 500 }
    );
  }
}
