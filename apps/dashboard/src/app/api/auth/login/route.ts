import { NextRequest, NextResponse } from 'next/server';

const API = process.env.API_URL ?? 'http://localhost:4000';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const upstream = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  const res = new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  });
  // Forward the session Set-Cookie back to the browser — without this,
  // the cookie never gets stored and the user is bounced back to /login.
  const setCookie = upstream.headers.get('set-cookie');
  if (setCookie) res.headers.set('set-cookie', setCookie);
  return res;
}
