'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtDateTime } from '@/lib/format';

interface Task {
  id: string;
  channelId: string;
  channel: { id: string; name: string; slug: string };
  rawFilename: string;
  rawTag: string;
  detectedType: 'long' | 'short' | null;
  detectedFormat: 'question' | 'animation' | null;
  durationMillis: number | null;
  status: string;
  contentItem: { id: string; expectedFilename: string; scheduledPublishAt: string; status: string; type: string; format: string | null } | null;
  assignedEditor: { id: string; username: string; name: string | null } | null;
  createdAt: string;
  submittedAt: string | null;
}

const STATUSES = ['pending', 'ongoing', 'submitted', 'revision_requested', 'completed', 'canceled'];
const LABELS: Record<string, string> = {
  pending: 'Pending', ongoing: 'Ongoing', submitted: 'In Review',
  revision_requested: 'Needs revision', completed: 'Completed', canceled: 'Canceled',
};
const BADGES: Record<string, string> = {
  pending: 'gray', ongoing: 'yellow', submitted: 'blue',
  revision_requested: 'red', completed: 'green', canceled: 'gray',
};

export default function TasksClient({ initialTasks, initialStatus }: { initialTasks: Task[]; initialStatus: string }) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function nav(s: string) {
    const p = new URLSearchParams();
    if (s) p.set('status', s);
    router.push(`/tasks?${p.toString()}`);
  }

  async function reqRev(t: Task) {
    const notes = prompt('Revision notes for the editor:');
    if (!notes) return;
    setBusy(t.id); setErr(null);
    try {
      const res = await fetch(`/api/proxy/tasks/${t.id}/request-revision`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function del(t: Task) {
    if (!confirm(`Delete this task and its placeholder content item?\n\nFile: ${t.rawFilename}\nFinal: ${t.contentItem?.expectedFilename ?? '—'}\n\nThe slot it was holding will become available again.`)) return;
    setBusy(t.id); setErr(null);
    try {
      const res = await fetch(`/api/proxy/tasks/${t.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      setTasks(tasks.filter((x) => x.id !== t.id));
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <>
      <div className="card">
        <div className="row">
          <div>
            <label>Status</label>
            <select value={status} onChange={(e) => { setStatus(e.target.value); nav(e.target.value); }}>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}
            </select>
          </div>
        </div>
      </div>

      <table>
        <thead>
          <tr><th>Channel</th><th>Raw</th><th>Type / Format</th><th>Final filename</th><th>Publish</th><th>Status</th><th>Editor</th><th></th></tr>
        </thead>
        <tbody>
          {tasks.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 20 }}>No tasks.</td></tr>}
          {tasks.map((t) => (
            <tr key={t.id}>
              <td>{t.channel.slug}</td>
              <td><code>{t.rawFilename}</code></td>
              <td>
                {t.detectedType ?? '—'}
                {t.durationMillis && <small className="muted"> ({Math.round(t.durationMillis / 60000)}m)</small>}
                {t.detectedFormat && <> · <span className="badge purple">{t.detectedFormat}</span></>}
              </td>
              <td>{t.contentItem ? <code>{t.contentItem.expectedFilename}</code> : '—'}</td>
              <td>{t.contentItem ? fmtDateTime(t.contentItem.scheduledPublishAt) : '—'}</td>
              <td><span className={`badge ${BADGES[t.status]}`}>{LABELS[t.status] ?? t.status}</span></td>
              <td>{t.assignedEditor?.username ?? '—'}</td>
              <td>
                {t.status === 'submitted' && (
                  <button className="btn small warn" onClick={() => reqRev(t)} disabled={!!busy}>Request revision</button>
                )}
                {' '}
                <button className="btn small danger" onClick={() => del(t)} disabled={!!busy}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {err && <div className="alert error">{err}</div>}
    </>
  );
}
