import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API = process.env.API_URL ?? 'http://localhost:4000';

async function proxy(req: NextRequest, ctx: { params: { path: string[] } }) {
  const cookieHeader = cookies().getAll().map((c) => `${c.name}=${c.value}`).join('; ');
  const search = req.nextUrl.search ?? '';
  const path = '/' + (ctx.params.path ?? []).join('/');
  const upstream = await fetch(`${API}${path}${search}`, {
    method: req.method,
    headers: {
      cookie: cookieHeader,
      'content-type': req.headers.get('content-type') ?? 'application/json',
    },
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.text(),
    redirect: 'manual',
  });
  const res = new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
  const setCookie = upstream.headers.get('set-cookie');
  if (setCookie) res.headers.set('set-cookie', setCookie);
  const location = upstream.headers.get('location');
  if (location) res.headers.set('location', location);
  return res;
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
