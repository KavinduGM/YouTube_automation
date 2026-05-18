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
    <div className="auth-container">
      <div className="auth-card">
        <h1 style={{ textAlign: 'center', marginBottom: 8 }}>YT Automation</h1>
        <p className="muted" style={{ textAlign: 'center', marginBottom: 20 }}>Sign in to continue</p>
        <form onSubmit={submit} className="card">
          <label>Username</label>
          <input type="text" required value={username}
                 onChange={(e) => setUsername(e.target.value)}
                 autoFocus autoComplete="username" />
          <label>Password</label>
          <input type="password" required value={password}
                 onChange={(e) => setPassword(e.target.value)}
                 autoComplete="current-password" />
          {err && <div className="alert error" style={{ marginTop: 12 }}>{err}</div>}
          <div style={{ marginTop: 16 }}>
            <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
