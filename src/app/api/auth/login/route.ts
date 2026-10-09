import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';

// Função para gerar hash SHA256
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Definir usuários do sistema a partir de variáveis de ambiente
const USERS = [
  {
    username: process.env.AUTH_USER1 || 'admin',
    passwordHash: process.env.AUTH_PASS1_HASH || '7676aaafb027c825bd9abab78b234070e702752f625b752e55e55b48e607e358',
    role: 'admin'
  },
  {
    username: process.env.AUTH_USER2 || 'atendimento',
    passwordHash: process.env.AUTH_PASS2_HASH || '2a2dc9d8b550b544cc645603751a66b089f35fee08d548b168ce440fc7c21a1d',
    role: 'atendimento'
  }
];

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();
    
    // Hash da senha fornecida
    const passwordHash = hashPassword(password);
    
    // Verificar credenciais comparando hashes
    const user = USERS.find(u => u.username === username && u.passwordHash === passwordHash);
    
    if (user) {
      const cookieStore = await cookies();
      // Armazenar username e role no cookie (separados por pipe)
      const sessionData = `${user.username}|${user.role}`;
      cookieStore.set('vip_session', sessionData, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 // 24 horas
      });
      
      return NextResponse.json({ 
        success: true, 
        username: user.username,
        role: user.role 
      });
    }
    
    return NextResponse.json({ success: false, error: 'Credenciais inválidas' }, { status: 401 });
  } catch (error) {
    console.error('[LOGIN] Erro:', error);
    return NextResponse.json({ success: false, error: 'Erro no servidor' }, { status: 500 });
  }
}
