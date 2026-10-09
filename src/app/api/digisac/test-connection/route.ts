import { NextResponse } from 'next/server';

/**
 * GET /api/digisac/test-connection
 * 
 * Endpoint de teste para verificar resposta da API Digisac
 */
export async function GET() {
  try {
    const url = process.env.DIGISAC_API_URL;
    const token = process.env.DIGISAC_API_TOKEN;

    console.log('[TEST] URL:', url);
    console.log('[TEST] Token:', token ? `${token.substring(0, 10)}...` : 'NOT SET');

    if (!url || !token) {
      return NextResponse.json({
        success: false,
        error: 'Credenciais não configuradas',
        env: {
          url: !!url,
          token: !!token
        }
      }, { status: 500 });
    }

    // Query para buscar conexões ativas
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

    console.log('[TEST] Chamando API:', apiUrl);

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('[TEST] Status:', response.status);
    console.log('[TEST] Status Text:', response.statusText);

    const responseText = await response.text();
    console.log('[TEST] Response (raw):', responseText.substring(0, 500));

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      return NextResponse.json({
        success: false,
        error: 'Resposta não é JSON válido',
        rawResponse: responseText.substring(0, 1000)
      }, { status: 500 });
    }

    console.log('[TEST] Response (parsed keys):', Object.keys(data));
    console.log('[TEST] Response (full):', JSON.stringify(data, null, 2));

    return NextResponse.json({
      success: true,
      responseStatus: response.status,
      responseKeys: Object.keys(data),
      fullResponse: data,
      connectionCount: data.items ? data.items.length : 'items property not found'
    });

  } catch (error) {
    console.error('[TEST] Erro:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}
