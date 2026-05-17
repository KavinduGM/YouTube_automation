'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'editor';
  active: boolean;
  createdAt: string;
}

export default function UsersClient({ initialUsers, myId }: { initialUsers: User[]; myId: string }) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'editor'>('editor');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function invite() {
    setBusy('invite'); setErr(null); setMsg(null);
    try {
      const res = await fetch('/api/proxy/users', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name: name || undefined, role }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? body.error ?? 'failed');
      }
      const out = await res.json();
      setUsers([...users, out.user]);
      setEmail(''); setName('');
      setMsg(`Invitation sent to ${out.user.email}.`);
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function resend(id: string) {
    setBusy(id); setErr(null); setMsg(null);
    try {
      const res = await fetch(`/api/proxy/users/${id}/resend-invite`, {
        method: 'POST', credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg('Invite resent.');
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function toggleActive(u: User) {
    setBusy(u.id); setErr(null);
    try {
      const res = await fetch(`/api/proxy/users/${u.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: !u.active }),
      });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      setUsers(users.map((x) => x.id === u.id ? { ...x, ...out.user } : x));
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function setRoleFor(u: User, newRole: 'admin' | 'editor') {
    setBusy(u.id); setErr(null);
    try {
      const res = await fetch(`/api/proxy/users/${u.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      setUsers(users.map((x) => x.id === u.id ? { ...x, ...out.user } : x));
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
    router.refresh();
  }

  return (
    <>
      <div className="card">
        <h3>Invite a user</h3>
        <div className="row">
          <div>
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="editor@example.com" />
          </div>
          <div>
            <label>Name (optional)</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'editor')}>
              <option value="editor">editor</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button className="btn" onClick={invite} disabled={busy === 'invite' || !email}>
              {busy === 'invite' ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        </div>
        {err && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{err}</p>}
        {msg && <p style={{ color: 'var(--ok)', marginTop: 8 }}>{msg}</p>}
      </div>

      <table>
        <thead>
          <tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email} {u.id === myId && <small className="muted">(you)</small>}</td>
              <td>{u.name ?? '—'}</td>
              <td>
                <select value={u.role} disabled={u.id === myId || !!busy} onChange={(e) => setRoleFor(u, e.target.value as 'admin' | 'editor')}>
                  <option value="admin">admin</option>
                  <option value="editor">editor</option>
                </select>
              </td>
              <td>
                <span className={u.active ? 'badge green' : 'badge gray'}>{u.active ? 'active' : 'disabled'}</span>
              </td>
              <td>
                <button className="btn small secondary" onClick={() => resend(u.id)} disabled={!!busy}>Resend invite</button>{' '}
                {u.id !== myId && (
                  <button className="btn small" onClick={() => toggleActive(u)} disabled={!!busy}>
                    {u.active ? 'Disable' : 'Enable'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
