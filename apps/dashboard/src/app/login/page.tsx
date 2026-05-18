'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error('Wrong username or password.');
        throw new Error(await res.text());
      }
      router.push('/');
      router.refresh();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '60px auto' }}>
      <h1>Sign in</h1>
      <form onSubmit={submit} className="card">
        <label>Username</label>
        <input
          type="text" required value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus autoComplete="username"
        />
        <label>Password</label>
        <input
          type="password" required value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {err && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{err}</p>}
        <div style={{ marginTop: 12 }}>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
        <p className="muted" style={{ marginTop: 16, fontSize: 12 }}>
          Sessions last 1 year — you only need to do this once per device.
        </p>
      </form>
    </div>
  );
}
