'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  role: 'admin' | 'manager' | 'editor';
  active: boolean;
  createdAt: string;
}

export default function UsersClient({ initialUsers, myId }: { initialUsers: User[]; myId: string }) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'manager' | 'editor'>('editor');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function create() {
    setBusy('create'); setErr(null); setMsg(null);
    try {
      const res = await fetch('/api/proxy/users', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username, password,
          email: email || undefined,
          name: name || undefined,
          role,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? body.error ?? 'failed');
      }
      const out = await res.json();
      setUsers([...users, out.user]);
      setUsername(''); setPassword(''); setEmail(''); setName('');
      setMsg(`Created ${out.user.username}. Share the username + password with them.`);
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function setNewPassword(id: string, username: string) {
    const np = prompt(`Set new password for ${username}:`);
    if (!np) return;
    if (np.length < 8) { alert('Min 8 characters.'); return; }
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/proxy/users/${id}/set-password`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPassword: np }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg(`Password updated for ${username}.`);
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

  async function setRoleFor(u: User, newRole: 'admin' | 'manager' | 'editor') {
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

  async function del(u: User) {
    if (!confirm(`Delete user ${u.username}? Their tasks will be unassigned.`)) return;
    setBusy(u.id); setErr(null);
    try {
      const res = await fetch(`/api/proxy/users/${u.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      setUsers(users.filter((x) => x.id !== u.id));
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <>
      <div className="card">
        <h3>Create user</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Admin sets the username + password. Share both with the editor — they don't need to reset it.
        </p>
        <div className="row">
          <div>
            <label>Username</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="EDITOR2026" autoComplete="off" />
          </div>
          <div>
            <label>Password</label>
            <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 8 chars" autoComplete="off" />
          </div>
          <div>
            <label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'manager' | 'editor')}>
              <option value="editor">editor</option>
              <option value="manager">manager</option>
              <option value="admin">admin</option>
            </select>
          </div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <div>
            <label>Email (optional, for notifications)</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label>Display name (optional)</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button className="btn" onClick={create} disabled={busy === 'create' || !username || password.length < 8}>
              {busy === 'create' ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </div>
        {err && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{err}</p>}
        {msg && <p style={{ color: 'var(--ok)', marginTop: 8 }}>{msg}</p>}
      </div>

      <table>
        <thead>
          <tr><th>Username</th><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td><b>{u.username}</b> {u.id === myId && <small className="muted">(you)</small>}</td>
              <td>{u.email ?? '—'}</td>
              <td>{u.name ?? '—'}</td>
              <td>
                <select value={u.role} disabled={u.id === myId || !!busy} onChange={(e) => setRoleFor(u, e.target.value as 'admin' | 'manager' | 'editor')}>
                  <option value="admin">admin</option>
                  <option value="manager">manager</option>
                  <option value="editor">editor</option>
                </select>
              </td>
              <td>
                <span className={u.active ? 'badge green' : 'badge gray'}>{u.active ? 'active' : 'disabled'}</span>
              </td>
              <td>
                <button className="btn small secondary" onClick={() => setNewPassword(u.id, u.username)} disabled={!!busy}>Reset password</button>{' '}
                {u.id !== myId && (
                  <>
                    <button className="btn small" onClick={() => toggleActive(u)} disabled={!!busy}>
                      {u.active ? 'Disable' : 'Enable'}
                    </button>{' '}
                    <button className="btn small danger" onClick={() => del(u)} disabled={!!busy}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
