import { NextRequest, NextResponse } from 'next/server';

const API = process.env.API_URL ?? 'http://localhost:4000';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const upstream = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  });
}
