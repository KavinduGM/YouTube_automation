'use client';
import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSent(true);
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '60px auto' }}>
      <h1>Sign in</h1>
      {sent ? (
        <div className="card">
          <p>Check your inbox at <b>{email}</b> for a sign-in link.</p>
          <p className="muted">If you don't see it within a minute, check spam, or confirm your email is in <code>ALLOWED_APPROVER_EMAILS</code>.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="card">
          <label>Email</label>
          <input
            type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
          <div style={{ marginTop: 12 }}>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send sign-in link'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
