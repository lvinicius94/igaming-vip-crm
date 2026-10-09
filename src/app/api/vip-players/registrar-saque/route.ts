import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * API para registrar saque na planilha Google Sheets
 */
export async function POST(request: Request) {
  try {
    const { external_id, ggr_medio, ggr_total, ticket_medio, deposito_total, nome } = await request.json();
    
    if (!external_id) {
      return NextResponse.json(
        { success: false, error: 'external_id é obrigatório' },
        { status: 400 }
      );
    }
    
    console.log(`[SAQUE VIP] Registrando saque para: ${external_id}`);
    console.log(`[SAQUE VIP] GOOGLE_CREDENTIALS presente:`, !!process.env.GOOGLE_CREDENTIALS);
    
    // 1. Configurar autenticação Google Sheets
    let credentials;
    
    // Tenta usar variável de ambiente primeiro (produção)
    if (process.env.GOOGLE_CREDENTIALS) {
      console.log('[SAQUE VIP] Usando credenciais da variável de ambiente');
      credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    } else {
      // Fallback para arquivo local (desenvolvimento)
      console.log('[SAQUE VIP] Usando credenciais do arquivo local');
      const credentialsPath = path.join(process.cwd(), 'google-credentials.json');
      
      if (!fs.existsSync(credentialsPath)) {
        throw new Error('Credenciais do Google não encontradas. Configure GOOGLE_CREDENTIALS no ambiente.');
      }
      
      credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    }
    
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    
    // 2. ID da planilha
    const spreadsheetId = '17WLHKCq0jq6Emv4FL8w1uKK_MMLq23aRAjP4NE96mO0';
    const range = 'solicitacao!A2:G';
    
    // 3. Preparar dados
    const dataAtual = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const valores = [
      [
        dataAtual,
        external_id,
        nome || '',
        ggr_medio || 0,
        ggr_total || 0,
        ticket_medio || 0,
        deposito_total || 0
      ]
    ];
    
    console.log('[SAQUE VIP] Enviando para Google Sheets:', valores);
    
    // 4. Adicionar linha na planilha
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: valores,
      },
    });
    
    // 5. Registrar na tabela solicitacoes_saque
    const insertQuery = `
      INSERT INTO solicitacoes_saque (external_id, data_solicitacao)
      VALUES ($1, NOW() - INTERVAL '3 hours')
    `;
    await pool.query(insertQuery, [external_id]);
    
    console.log(`[SAQUE VIP] ✅ Registrado com sucesso. Linhas adicionadas: ${response.data.updates?.updatedRows}`);
    
    return NextResponse.json({
      success: true,
      message: 'Saque registrado na planilha com sucesso',
      external_id,
      spreadsheet_url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
      updated_rows: response.data.updates?.updatedRows || 0
    });
    
  } catch (error) {
    console.error('[SAQUE VIP] Erro completo:', error);
    
    // Captura detalhes específicos do erro
    let errorMessage = 'Erro desconhecido';
    let errorDetails = '';
    
    if (error instanceof Error) {
      errorMessage = error.message;
      errorDetails = error.stack || '';
      console.error('[SAQUE VIP] Message:', error.message);
      console.error('[SAQUE VIP] Stack:', error.stack);
    }
    
    // Verifica se é erro de credenciais
    if (errorMessage.includes('GOOGLE_CREDENTIALS') || errorMessage.includes('credentials')) {
      errorMessage = 'Credenciais do Google não configuradas. Configure GOOGLE_CREDENTIALS nas variáveis de ambiente.';
    }
    
    return NextResponse.json(
      { 
        success: false, 
        error: errorMessage,
        details: errorDetails,
        hint: 'Verifique os logs do servidor para mais detalhes'
      },
      { status: 500 }
    );
  }
}
