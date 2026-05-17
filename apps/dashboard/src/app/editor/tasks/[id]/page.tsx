import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import EditorTaskClient from './EditorTaskClient';

interface Task {
  id: string;
  rawFilename: string;
  rawDriveFileId: string;
  rawTag: string;
  status: string;
  detectedType: 'long' | 'short' | null;
  durationMillis: number | null;
  revisionNotes: string | null;
  channel: { id: string; name: string; slug: string; driveFolderId: string | null };
  contentItem: { id: string; expectedFilename: string; scheduledPublishAt: string; type: string; title: string } | null;
  docs: Array<{ id: string; filename: string; kind: string | null; mimeType: string | null; sizeBytes: number | null }>;
}

export default async function EditorTaskDetail({ params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me?.user) redirect('/login');

  const { task } = await apiGet<{ task: Task }>(`/tasks/${params.id}`);

  return (
    <>
      <p><a href="/editor/tasks">← My tasks</a></p>
      <h1>{task.contentItem?.expectedFilename ?? task.rawFilename}</h1>
      <p>
        <span className={`badge ${task.status === 'pending' ? 'blue' : task.status === 'in_progress' ? 'yellow' : task.status === 'revision_requested' ? 'red' : 'green'}`}>{task.status}</span>{' '}
        <span className="muted">{task.channel.name} · {task.detectedType ?? 'unknown type'}</span>
      </p>

      <div className="card">
        <dl className="kv">
          <dt>Raw filename</dt><dd><code>{task.rawFilename}</code></dd>
          <dt>Duration</dt><dd>{task.durationMillis ? `${Math.round(task.durationMillis / 60000)} min` : '—'}</dd>
          <dt>Save edited as</dt><dd><code>{task.contentItem?.expectedFilename ?? '(no content item)'}</code></dd>
          <dt>Scheduled publish</dt><dd>{task.contentItem ? fmtDateTime(task.contentItem.scheduledPublishAt) : '—'} <small className="muted">(America/New_York)</small></dd>
        </dl>
        {task.revisionNotes && (
          <div style={{ background: '#fef2f2', padding: 10, borderRadius: 6, marginTop: 10 }}>
            <b>Revision requested:</b>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{task.revisionNotes}</pre>
          </div>
        )}
      </div>

      <EditorTaskClient task={task} />
    </>
  );
}
