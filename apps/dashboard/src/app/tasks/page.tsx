import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

interface Task {
  id: string;
  channelId: string;
  channel: { name: string; slug: string };
  rawFilename: string;
  rawTag: string;
  detectedType: 'long' | 'short' | null;
  durationMillis: number | null;
  status: string;
  contentItem: { expectedFilename: string; scheduledPublishAt: string; status: string } | null;
  assignedEditor: { email: string; name: string | null } | null;
  createdAt: string;
  submittedAt: string | null;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: { status?: string; channelId?: string };
}) {
  const me = await getMe();
  if (!me?.user) redirect('/login');
  if (me.user.role !== 'admin') redirect('/');
  const qs = new URLSearchParams();
  if (searchParams.status) qs.set('status', searchParams.status);
  if (searchParams.channelId) qs.set('channelId', searchParams.channelId);
  const data = await apiGet<{ tasks: Task[] }>(`/tasks?${qs.toString()}`);

  return (
    <>
      <h1>Editor tasks</h1>
      <p className="muted">All raw uploads and their editing status.</p>
      <div className="card">
        <form method="get" className="row">
          <div>
            <label>Status</label>
            <select name="status" defaultValue={searchParams.status ?? ''}>
              <option value="">All</option>
              {['pending', 'in_progress', 'submitted', 'revision_requested', 'done', 'canceled'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button className="btn">Filter</button>
          </div>
        </form>
      </div>

      <table>
        <thead>
          <tr><th>Channel</th><th>Raw</th><th>Type</th><th>Final filename</th><th>Scheduled</th><th>Status</th><th>Editor</th><th>Created</th></tr>
        </thead>
        <tbody>
          {data.tasks.map((t) => (
            <tr key={t.id}>
              <td>{t.channel.slug}</td>
              <td><code>{t.rawFilename}</code></td>
              <td>{t.detectedType ?? '—'} {t.durationMillis ? <small className="muted">({Math.round(t.durationMillis / 60000)} min)</small> : null}</td>
              <td>{t.contentItem ? <Link href={`/items/${t.contentItem ? '' : ''}`}><code>{t.contentItem.expectedFilename}</code></Link> : '—'}</td>
              <td>{t.contentItem ? fmtDateTime(t.contentItem.scheduledPublishAt) : '—'}</td>
              <td><span className={`badge ${t.status === 'submitted' ? 'green' : t.status === 'revision_requested' ? 'yellow' : t.status === 'pending' ? 'blue' : 'gray'}`}>{t.status}</span></td>
              <td>{t.assignedEditor?.email ?? '—'}</td>
              <td>{fmtDateTime(t.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
