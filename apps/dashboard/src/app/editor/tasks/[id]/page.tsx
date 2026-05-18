import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import EditorTaskClient from './EditorTaskClient';

interface Task {
  id: string;
  rawFilename: string;
  rawDriveFileId: string;
  rawTag: string;
  status: 'pending' | 'ongoing' | 'submitted' | 'revision_requested' | 'completed' | 'canceled';
  detectedType: 'long' | 'short' | null;
  detectedFormat: 'question' | 'animation' | null;
  durationMillis: number | null;
  revisionNotes: string | null;
  channel: { id: string; name: string; slug: string };
  contentItem: { id: string; expectedFilename: string; scheduledPublishAt: string; type: string; format: string | null } | null;
  docs: Array<{ id: string; filename: string; kind: string | null; mimeType: string | null; sizeBytes: number | null }>;
}

const statusLabel: Record<string, string> = {
  pending: 'Pending',
  ongoing: 'Ongoing',
  submitted: 'In Review',
  revision_requested: 'Needs revision',
  completed: 'Completed',
  canceled: 'Canceled',
};

const statusBadge: Record<string, string> = {
  pending: 'gray',
  ongoing: 'yellow',
  submitted: 'blue',
  revision_requested: 'red',
  completed: 'green',
  canceled: 'gray',
};

export default async function EditorTaskDetail({ params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me?.user) redirect('/login');

  const { task } = await apiGet<{ task: Task }>(`/tasks/${params.id}`);
  const expectedFilename = task.contentItem?.expectedFilename ?? '—';
  const thumbName = expectedFilename !== '—' ? expectedFilename.replace(/\.[^.]+$/, '.jpg') : '—';

  return (
    <>
      <p><a href="/editor/tasks">← My tasks</a></p>
      <h1>{task.contentItem?.expectedFilename ?? task.rawFilename}</h1>
      <p>
        <span className={`badge ${statusBadge[task.status]}`}>{statusLabel[task.status]}</span>{' '}
        <span className="muted">{task.channel.name}</span>
      </p>

      <div className="card">
        <h3>What to do</h3>
        <ol>
          <li>Open the raw video in Drive (you have access via your Google account): <code>{task.rawFilename}</code></li>
          <li>Edit the video (add intro / outro / popups).</li>
          <li>Export and save the final into the same Drive folder, renamed to:
            <div style={{ marginTop: 6 }}><code>{expectedFilename}</code></div>
          </li>
          <li>Save the thumbnail next to it as:
            <div style={{ marginTop: 6 }}><code>{thumbName}</code></div>
          </li>
          <li>Set your task status below to <b>Video Submitted</b> when done.</li>
        </ol>
      </div>

      <div className="card">
        <dl className="kv">
          <dt>Raw file</dt><dd><code>{task.rawFilename}</code></dd>
          <dt>Duration</dt><dd>{task.durationMillis ? `${Math.round(task.durationMillis / 60000)} min` : '—'}</dd>
          <dt>Type</dt><dd>{task.contentItem?.type ?? task.detectedType ?? '—'}{(task.contentItem?.format ?? task.detectedFormat) ? ` · ${task.contentItem?.format ?? task.detectedFormat}` : ''}</dd>
          <dt>Publish at</dt><dd>{task.contentItem ? fmtDateTime(task.contentItem.scheduledPublishAt) : '—'} <span className="muted">(America/New_York)</span></dd>
        </dl>
        {task.revisionNotes && (
          <div className="alert error" style={{ marginTop: 12 }}>
            <b>Revision requested:</b>
            <pre style={{ whiteSpace: 'pre-wrap', background: 'transparent', border: 'none', padding: 0 }}>{task.revisionNotes}</pre>
          </div>
        )}
      </div>

      <EditorTaskClient task={task} />
    </>
  );
}
