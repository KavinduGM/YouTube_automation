'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function VerifyPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const token = sp.get('token');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setErr('Missing token'); return; }
    (async () => {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) { setErr('Invalid or expired link'); return; }
      router.replace('/inbox');
    })();
  }, [token, router]);

  return (
    <div style={{ maxWidth: 420, margin: '60px auto' }}>
      <div className="card">
        {err ? <p style={{ color: 'var(--danger)' }}>{err}</p> : <p>Signing you in…</p>}
      </div>
    </div>
  );
}
