'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Item {
  id: string;
  title: string;
  description: string;
  tags: string[];
  scheduledPublishAt: string;
  status: string;
  driveFileId: string | null;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

// Convert a UTC ISO string to "yyyy-MM-ddTHH:mm" in America/New_York for the input.
function isoToNyInput(iso: string): string {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

// Convert "yyyy-MM-ddTHH:mm" entered as NY local back to a UTC ISO.
function nyInputToIso(local: string): string {
  // Construct a date assuming the input is NY local. The trick: format that wall time
  // in NY to compute the UTC offset at that instant.
  const [datePart, timePart] = local.split('T');
  if (!datePart || !timePart) return new Date(local).toISOString();
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  // Start with a UTC date matching the wall clock
  const utcGuess = Date.UTC(y, (m ?? 1) - 1, d, hh, mm);
  // Find what NY thinks that UTC instant is
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(utcGuess));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const nyMs = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  const offsetMin = (utcGuess - nyMs) / 60000;
  return new Date(utcGuess + offsetMin * 60000).toISOString();
}

export default function ItemEditor({ item }: { item: Item }) {
  const router = useRouter();
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [tags, setTags] = useState(item.tags.join(', '));
  const [scheduled, setScheduled] = useState(isoToNyInput(item.scheduledPublishAt));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const editable = !['scheduled', 'scheduling', 'published'].includes(item.status);

  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`/api/proxy${path}`, {
      method, credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(await res.text());
    return res;
  }

  async function save() {
    setBusy('save'); setErr(null);
    try {
      await call('PATCH', `/items/${item.id}`, {
        title, description,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        scheduledPublishAt: nyInputToIso(scheduled),
      });
      router.refresh();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function approve() {
    setBusy('approve'); setErr(null);
    try {
      await save(); // save edits first
      await call('POST', `/items/${item.id}/approve`);
      router.refresh();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function reject() {
    if (!rejectReason.trim()) { setErr('reason required'); return; }
    setBusy('reject'); setErr(null);
    try {
      await call('POST', `/items/${item.id}/reject`, { reason: rejectReason });
      router.refresh();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function retry() {
    setBusy('retry'); setErr(null);
    try {
      await call('POST', `/items/${item.id}/retry`);
      router.refresh();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  void API;

  return (
    <div className="card">
      <h3>Metadata</h3>
      <label>Title <span className="muted">(max 100)</span></label>
      <input type="text" value={title} maxLength={100} disabled={!editable}
             onChange={(e) => setTitle(e.target.value)} />
      <label>Description</label>
      <textarea value={description} disabled={!editable}
                onChange={(e) => setDescription(e.target.value)}
                style={{ minHeight: 240 }} />
      <label>Tags <span className="muted">(comma-separated)</span></label>
      <input type="text" value={tags} disabled={!editable}
             onChange={(e) => setTags(e.target.value)} />
      <label>Scheduled publish (America/New_York)</label>
      <input type="datetime-local" value={scheduled} disabled={!editable}
             onChange={(e) => setScheduled(e.target.value)} />

      {err && <p style={{ color: 'var(--danger)', marginTop: 12 }}>{err}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        {editable && (
          <button className="btn secondary" onClick={save} disabled={!!busy}>
            {busy === 'save' ? 'Saving…' : 'Save edits'}
          </button>
        )}
        {item.status === 'pending_approval' && (
          <>
            <button className="btn ok" onClick={approve} disabled={!!busy || !item.driveFileId}>
              {busy === 'approve' ? 'Approving…' : 'Approve & schedule'}
            </button>
            <details>
              <summary className="btn danger small" style={{ cursor: 'pointer' }}>Reject</summary>
              <div style={{ marginTop: 8 }}>
                <input type="text" placeholder="Reason"
                       value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                <button className="btn danger small" style={{ marginTop: 4 }}
                        onClick={reject} disabled={!!busy}>
                  Confirm reject
                </button>
              </div>
            </details>
          </>
        )}
        {item.status === 'failed' && (
          <button className="btn" onClick={retry} disabled={!!busy}>
            {busy === 'retry' ? 'Retrying…' : 'Retry'}
          </button>
        )}
        {!item.driveFileId && item.status === 'pending_approval' && (
          <span className="muted">No video file in Drive yet — cannot approve.</span>
        )}
      </div>
    </div>
  );
}
