import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

// Pool de conexões do banco de dados
const pool = new Pool({
  host: process.env.PGHOST!,
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE!,
  user: process.env.PGUSER!,
  password: process.env.PGPASSWORD!,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export async function GET(request: NextRequest) {
  let client;
  try {
    // Parâmetros opcionais
    const searchParams = request.nextUrl.searchParams;
    const dias = searchParams.get('dias') ? parseInt(searchParams.get('dias')!) : 60;
    
    console.log(`[HISTORICO SCORES API] Buscando últimos ${dias} dias...`);

    client = await pool.connect();
    
    // Query para buscar o histórico dos últimos N dias
    const query = `
      SELECT 
        data_dia,
        avg_ggr_score,
        avg_ticket_score,
        avg_activity_score,
        avg_total_score,
        avg_ggr_value,
        avg_ticket_value,
        qtd_jogadores_considerados
      FROM historico_score
      WHERE data_dia >= CURRENT_DATE - INTERVAL '${dias} days'
      ORDER BY data_dia ASC
    `;
    
    const result = await client.query(query);
    const rows = result.rows;
    
    // Formatar datas para o formato esperado pelo gráfico (DD/MM)
    const dadosFormatados = rows.map((row: any) => ({
      date: new Date(row.data_dia).toLocaleDateString('pt-BR', { 
        day: '2-digit', 
        month: '2-digit' 
      }),
      'GGR Médio': Math.round(parseFloat(row.avg_ggr_score) || 0),
      'Ticket': Math.round(parseFloat(row.avg_ticket_score) || 0),
      'Atividade': Math.round(parseFloat(row.avg_activity_score) || 0),
      'Score Total': Math.round(parseFloat(row.avg_total_score) || 0),
      'GGR Valor': Math.round(parseFloat(row.avg_ggr_value) || 0),
      'Ticket Valor': Math.round(parseFloat(row.avg_ticket_value) || 0),
      qtd_jogadores: row.qtd_jogadores_considerados
    }));
    
    console.log(`[HISTORICO SCORES API] ✅ Encontrados ${dadosFormatados.length} dias com dados`);
    
    return NextResponse.json({
      success: true,
      data: dadosFormatados,
      total: dadosFormatados.length,
      periodo: `${dias} dias`
    });
      
  } catch (error) {
    console.error('[HISTORICO SCORES API] ❌ Erro:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Erro ao buscar dados históricos',
        message: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    );
  } finally {
    if (client) client.release();
  }
}
