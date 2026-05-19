import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import AutoRefresh from '@/components/AutoRefresh';

interface Task {
  id: string;
  rawFilename: string;
  rawTag: string;
  status: 'pending' | 'ongoing' | 'submitted' | 'revision_requested' | 'completed' | 'canceled';
  detectedType: 'long' | 'short' | null;
  detectedFormat: 'question' | 'animation' | null;
  channel: { name: string; slug: string };
  contentItem: { expectedFilename: string; scheduledPublishAt: string; type: string; format: string | null } | null;
}

const labels: Record<string, string> = {
  pending: 'Pending',
  ongoing: 'Ongoing',
  submitted: 'In Review',
  revision_requested: 'Needs revision',
  completed: 'Completed',
  canceled: 'Canceled',
};

const badges: Record<string, string> = {
  pending: 'gray',
  ongoing: 'yellow',
  submitted: 'blue',
  revision_requested: 'red',
  completed: 'green',
  canceled: 'gray',
};

export default async function EditorTasksPage() {
  const me = await getMe();
  if (!me?.user) redirect('/login');
  if (me.user.role !== 'editor' && me.user.role !== 'admin') redirect('/');

  const data = await apiGet<{ tasks: Task[] }>('/tasks/mine');

  const grouped = {
    pending: data.tasks.filter((t) => t.status === 'pending'),
    ongoing: data.tasks.filter((t) => t.status === 'ongoing'),
    review: data.tasks.filter((t) => t.status === 'submitted'),
    revision: data.tasks.filter((t) => t.status === 'revision_requested'),
  };

  function Section({ title, badge, tasks }: { title: string; badge: string; tasks: Task[] }) {
    return (
      <>
        <h2>{title} <span className={`badge ${badge}`}>{tasks.length}</span></h2>
        {tasks.length === 0 ? (
          <div className="card"><p className="muted">Nothing here.</p></div>
        ) : (
          <table>
            <thead>
              <tr><th>Channel</th><th>Raw file</th><th>Type</th><th>Final filename to upload</th><th>Publish at</th><th></th></tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.channel.name}</td>
                  <td><code>{t.rawFilename}</code></td>
                  <td>
                    {t.contentItem?.type ?? t.detectedType}
                    {(t.contentItem?.format ?? t.detectedFormat) && (
                      <> · <span className="badge purple">{t.contentItem?.format ?? t.detectedFormat}</span></>
                    )}
                  </td>
                  <td><code>{t.contentItem?.expectedFilename ?? '—'}</code></td>
                  <td>{t.contentItem ? fmtDateTime(t.contentItem.scheduledPublishAt) : '—'}</td>
                  <td><Link className="btn small primary" href={`/editor/tasks/${t.id}`}>Open</Link></td>
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
      <AutoRefresh intervalSeconds={30} />
      <h1>My tasks</h1>
      <p className="muted">Edit the raw video in Drive and save the final with the filename shown. The thumbnail must share the same base name (e.g. <code>FINALNAME.jpg</code>).</p>
      <Section title="Pending" badge={badges.pending} tasks={grouped.pending} />
      <Section title="Ongoing" badge={badges.ongoing} tasks={grouped.ongoing} />
      <Section title="In Review" badge={badges.submitted} tasks={grouped.review} />
      <Section title="Needs revision" badge={badges.revision_requested} tasks={grouped.revision} />
      {void labels}
    </>
  );
}
