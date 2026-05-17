import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

interface Task {
  id: string;
  rawFilename: string;
  rawTag: string;
  status: string;
  detectedType: 'long' | 'short' | null;
  channel: { name: string; slug: string };
  contentItem: { expectedFilename: string; scheduledPublishAt: string; type: string } | null;
  docs: Array<{ id: string; filename: string; kind: string | null }>;
}

export default async function EditorTasksPage() {
  const me = await getMe();
  if (!me?.user) redirect('/login');
  if (me.user.role !== 'editor' && me.user.role !== 'admin') redirect('/');

  const data = await apiGet<{ tasks: Task[] }>('/tasks/mine');
  const grouped = {
    pending: data.tasks.filter((t) => t.status === 'pending'),
    in_progress: data.tasks.filter((t) => t.status === 'in_progress'),
    revision: data.tasks.filter((t) => t.status === 'revision_requested'),
  };

  function Section({ title, tasks, badge }: { title: string; tasks: Task[]; badge: string }) {
    return (
      <>
        <h2>{title} <span className={`badge ${badge}`}>{tasks.length}</span></h2>
        {tasks.length === 0 ? (
          <div className="card"><p className="muted">Nothing here.</p></div>
        ) : (
          <table style={{ marginBottom: 20 }}>
            <thead>
              <tr><th>Channel</th><th>Raw</th><th>Type</th><th>Save as</th><th>Publish</th><th>Docs</th><th></th></tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.channel.name}</td>
                  <td><code>{t.rawFilename}</code></td>
                  <td>{t.detectedType ?? '—'}</td>
                  <td><code>{t.contentItem?.expectedFilename ?? '—'}</code></td>
                  <td>{t.contentItem ? fmtDateTime(t.contentItem.scheduledPublishAt) : '—'}</td>
                  <td>{t.docs.length}</td>
                  <td><Link className="btn small" href={`/editor/tasks/${t.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </>
    );
  }

  return (
    <>
      <h1>My tasks</h1>
      <p className="muted">Download the raw video, edit, then upload the final video + thumbnail with the exact filename shown.</p>
      <Section title="Pending" tasks={grouped.pending} badge="blue" />
      <Section title="In progress" tasks={grouped.in_progress} badge="yellow" />
      <Section title="Needs revision" tasks={grouped.revision} badge="red" />
    </>
  );
}
