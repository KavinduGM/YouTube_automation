'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Task {
  id: string;
  status: 'pending' | 'ongoing' | 'submitted' | 'revision_requested' | 'completed' | 'canceled';
}

const editorChoices: Array<{ value: 'pending' | 'ongoing' | 'submitted'; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'submitted', label: 'Video Submitted' },
];

export default function EditorTaskClient({ task }: { task: Task }) {
  const router = useRouter();
  const [status, setStatus] = useState<'pending' | 'ongoing' | 'submitted'>(
    task.status === 'completed' || task.status === 'canceled' ? 'submitted'
      : task.status === 'revision_requested' ? 'ongoing'
      : (task.status as 'pending' | 'ongoing' | 'submitted')
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const readOnly = task.status === 'completed' || task.status === 'canceled';

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch(`/api/proxy/tasks/${task.id}/status`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg('Status updated.');
      router.refresh();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h3>Update status</h3>
      {readOnly ? (
        <p className="muted">This task is {task.status}. No further action needed.</p>
      ) : (
        <>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as 'pending' | 'ongoing' | 'submitted')} disabled={busy}>
            {editorChoices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            When you pick <b>Video Submitted</b>, this task automatically shows as <b>In Review</b> until the admin approves it.
          </p>
          <div style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save status'}
            </button>
          </div>
          {err && <div className="alert error" style={{ marginTop: 12 }}>{err}</div>}
          {msg && <div className="alert ok" style={{ marginTop: 12 }}>{msg}</div>}
        </>
      )}
    </div>
  );
}
