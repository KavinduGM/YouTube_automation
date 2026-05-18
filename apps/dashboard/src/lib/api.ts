// Server-side helper for calling the API from RSC and route handlers.
// Forwards cookies so the API can identify the session.

import { cookies } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL ?? 'http://localhost:4000';

async function fetchAPI(path: string, init: RequestInit = {}): Promise<Response> {
  const cookieHeader = cookies().getAll().map((c) => `${c.name}=${c.value}`).join('; ');
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      'content-type': 'application/json',
      cookie: cookieHeader,
    },
    cache: 'no-store',
  });
  return res;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetchAPI(path);
  if (!res.ok) throw new Error(`API ${path} ${res.status}`);
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchAPI(path, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`API ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchAPI(path, { method: 'PATCH', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`API ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetchAPI(path, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function getMe(): Promise<{
  user?: { id: string; username: string; email: string | null; name: string | null; role: 'admin' | 'editor' };
} | null> {
  const res = await fetchAPI('/auth/me');
  if (res.status === 401) return null;
  if (!res.ok) return null;
  return res.json();
}

export const APIBaseURL = API_URL;
