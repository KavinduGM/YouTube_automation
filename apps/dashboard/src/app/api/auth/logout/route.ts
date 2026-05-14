import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const API = process.env.API_URL ?? 'http://localhost:4000';

export async function POST() {
  const cookieHeader = cookies().getAll().map((c) => `${c.name}=${c.value}`).join('; ');
  const upstream = await fetch(`${API}/auth/logout`, {
    method: 'POST',
    headers: { cookie: cookieHeader },
  });
  const res = NextResponse.redirect(new URL('/login', process.env.DASHBOARD_URL ?? 'http://localhost:3000'));
  const setCookie = upstream.headers.get('set-cookie');
  if (setCookie) res.headers.set('set-cookie', setCookie);
  return res;
}
