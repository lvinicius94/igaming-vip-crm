import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get('vip_session');
  
  if (session) {
    // Separar username e role do cookie (formato: "username|role")
    const [username, role] = session.value.split('|');
    return NextResponse.json({ 
      authenticated: true, 
      username,
      role: role || 'admin' // Fallback para sessões antigas
    });
  }
  
  return NextResponse.json({ authenticated: false }, { status: 401 });
}
