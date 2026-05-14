import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import { fmtDateTime, statusBadge } from '@/lib/format';
import ItemEditor from './ItemEditor';

interface ItemDetail {
  id: string;
  title: string;
  description: string;
  tags: string[];
  type: 'long' | 'short' | 'post';
  status: string;
  expectedFilename: string;
  examTag: string | null;
  categoryId: string;
  defaultLanguage: string;
  madeForKids: boolean;
  scheduledPublishAt: string;
  driveFileId: string | null;
  driveThumbId: string | null;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  uploadedAt: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  lastError: string | null;
  attempts: number;
  channel: { id: string; name: string; slug: string };
  approvedBy: { email: string } | null;
  events: Array<{ id: string; type: string; message: string | null; actorEmail: string | null; createdAt: string }>;
}

export default async function ItemDetailPage({ params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me?.user) redirect('/login');

  const data = await apiGet<{ item: ItemDetail }>(`/items/${params.id}`);
  const it = data.item;

  return (
    <>
      <p><a href="/inbox">← Inbox</a></p>
      <h1>{it.title}</h1>
      <p>
        <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 12 }} className={statusBadge(it.status)}>{it.status}</span>
        {' '}<span className="muted">{it.channel.name} · {it.type}</span>
      </p>

      <div className="card">
        <dl className="kv">
          <dt>Filename</dt><dd><code>{it.expectedFilename}</code></dd>
          <dt>Scheduled</dt><dd>{fmtDateTime(it.scheduledPublishAt)} <span className="muted">(America/New_York)</span></dd>
          <dt>Drive video</dt><dd>{it.driveFileId
              ? <a href={`https://drive.google.com/file/d/${it.driveFileId}/view`} target="_blank" rel="noreferrer">open in Drive</a>
              : <span className="muted">not uploaded yet</span>}</dd>
          <dt>Drive thumb</dt><dd>{it.driveThumbId
              ? <a href={`https://drive.google.com/file/d/${it.driveThumbId}/view`} target="_blank" rel="noreferrer">open</a>
              : <span className="muted">none</span>}</dd>
          <dt>YouTube</dt><dd>{it.youtubeUrl
              ? <a href={it.youtubeUrl} target="_blank" rel="noreferrer">{it.youtubeUrl}</a>
              : '—'}</dd>
          <dt>Uploaded at</dt><dd>{it.uploadedAt ? fmtDateTime(it.uploadedAt) : '—'}</dd>
          <dt>Approved by</dt><dd>{it.approvedBy?.email ?? '—'} {it.approvedAt ? `at ${fmtDateTime(it.approvedAt)}` : ''}</dd>
          {it.rejectedReason && <><dt>Rejected</dt><dd>{it.rejectedReason}</dd></>}
          {it.lastError && <><dt>Last error</dt><dd style={{ color: 'var(--danger)' }}>{it.lastError} <span className="muted">(attempts: {it.attempts})</span></dd></>}
        </dl>
      </div>

      <ItemEditor item={it} />

      <h3>Activity</h3>
      <div className="card">
        {it.events.length === 0
          ? <p className="muted">No events yet.</p>
          : <table>
              <thead><tr><th>When</th><th>Type</th><th>Actor</th><th>Message</th></tr></thead>
              <tbody>
                {it.events.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtDateTime(e.createdAt)}</td>
                    <td>{e.type}</td>
                    <td>{e.actorEmail ?? '—'}</td>
                    <td>{e.message ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </div>
    </>
  );
}
