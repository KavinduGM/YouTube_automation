'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Task {
  id: string;
  rawFilename: string;
  status: string;
  contentItem: { id: string; expectedFilename: string } | null;
  docs: Array<{ id: string; filename: string; kind: string | null; mimeType: string | null; sizeBytes: number | null }>;
}

export default function EditorTaskClient({ task }: { task: Task }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);

  async function start() {
    setBusy('start'); setErr(null);
    try {
      const res = await fetch(`/api/proxy/tasks/${task.id}/start`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function uploadFinal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const video = data.get('video') as File | null;
    if (!video || video.size === 0) { setErr('Select a video file'); return; }
    setBusy('upload'); setErr(null); setProgress(0);
    try {
      // Use XMLHttpRequest for upload progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/proxy/tasks/${task.id}/upload-final`);
        xhr.withCredentials = true;
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error('network error'));
        xhr.send(data);
      });
      router.push('/editor/tasks');
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const filename = task.contentItem?.expectedFilename ?? '';
  const thumbName = filename.replace(/\.[^.]+$/, '.jpg');

  return (
    <>
      <div className="card">
        <h3>Downloads</h3>
        <p><a className="btn" href={`/api/proxy/tasks/${task.id}/raw`}>⬇ Download raw video ({task.rawFilename})</a></p>
        {task.docs.length === 0 && <p className="muted">No theory/question docs attached.</p>}
        {task.docs.map((d) => (
          <p key={d.id}>
            <a className="btn small secondary" href={`/api/proxy/tasks/${task.id}/doc/${d.id}`}>
              ⬇ {d.filename}{d.kind ? ` (${d.kind})` : ''}
            </a>
          </p>
        ))}
      </div>

      {task.status === 'pending' && (
        <div className="card">
          <button className="btn" onClick={start} disabled={!!busy}>
            {busy === 'start' ? 'Starting…' : 'Start editing'}
          </button>
        </div>
      )}

      {(task.status === 'in_progress' || task.status === 'revision_requested' || task.status === 'pending') && (
        <div className="card">
          <h3>Upload edited video</h3>
          {filename && (
            <p className="muted">
              The file will be saved to Drive as: <code>{filename}</code>
              {' '}and the thumbnail as <code>{thumbName}</code>
            </p>
          )}
          <form onSubmit={uploadFinal}>
            <label>Edited video</label>
            <input type="file" name="video" accept="video/*" required />
            <label>Thumbnail (optional, .jpg or .png)</label>
            <input type="file" name="thumbnail" accept="image/jpeg,image/png" />
            <div style={{ marginTop: 12 }}>
              <button className="btn" type="submit" disabled={!!busy || !filename}>
                {busy === 'upload' ? `Uploading… ${progress}%` : 'Upload'}
              </button>
            </div>
            {busy === 'upload' && (
              <div style={{ background: '#eee', height: 8, borderRadius: 4, marginTop: 10 }}>
                <div style={{ background: 'var(--ok)', height: '100%', width: `${progress}%`, borderRadius: 4 }} />
              </div>
            )}
          </form>
        </div>
      )}

      {err && <div className="card" style={{ background: '#fef2f2' }}>{err}</div>}
    </>
  );
}
