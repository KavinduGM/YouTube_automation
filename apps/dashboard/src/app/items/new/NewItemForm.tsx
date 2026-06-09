'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Channel { id: string; slug: string; name: string }

function nyInputToIso(local: string): string {
  const [datePart, timePart] = local.split('T');
  if (!datePart || !timePart) return new Date(local).toISOString();
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  const utcGuess = Date.UTC(y, (m ?? 1) - 1, d, hh, mm);
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

export default function NewItemForm({ channels }: { channels: Channel[] }) {
  const router = useRouter();
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '');
  const [type, setType] = useState<'long' | 'short' | 'post'>('short');
  const [datePart, setDatePart] = useState(''); // YYYY-MM-DD or YYYY-MM-Wn
  const [slot, setSlot] = useState('1');
  const [examTag, setExamTag] = useState('');
  const [ext, setExt] = useState('mp4');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const channelSlug = useMemo(
    () => channels.find((c) => c.id === channelId)?.slug ?? '',
    [channelId, channels],
  );

  const expectedFilename = useMemo(() => {
    if (!channelSlug || !datePart || !type || !slot) return '';
    const tag = examTag ? `_${examTag}` : '';
    return `${channelSlug}_${datePart}_${type}_${slot}${tag}.${ext}`;
  }, [channelSlug, datePart, type, slot, examTag, ext]);

  // YouTube counts tags as comma-joined string with quotes around any tag
  // containing a space — over 500 chars → "invalid video keywords" error.
  const tagsLen = useMemo(() => {
    const list = tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (list.length === 0) return 0;
    const sum = list.reduce((acc, t) => acc + t.length + (t.includes(' ') ? 2 : 0), 0);
    return sum + (list.length - 1);
  }, [tags]);
  const tagsOver = tagsLen > 500;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (title.length > 100) { setErr(`Title is ${title.length}/100 — trim ${title.length - 100}.`); return; }
    if (description.length > 5000) { setErr(`Description is ${description.length}/5000 — trim ${description.length - 5000}.`); return; }
    if (tagsOver) { setErr(`Tags use ${tagsLen}/500 characters. Remove ${tagsLen - 500} chars — drop a tag or two.`); return; }
    setBusy(true); setErr(null);
    try {
      const body = {
        channelId, type,
        expectedFilename,
        examTag: examTag || undefined,
        title, description,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        scheduledPublishAt: nyInputToIso(scheduledLocal),
      };
      const res = await fetch('/api/proxy/items', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      router.push(`/items/${out.item.id}`);
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="row">
        <div>
          <label>Channel</label>
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)} required>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.slug})</option>)}
          </select>
        </div>
        <div>
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as 'long' | 'short' | 'post')}>
            <option value="long">long</option>
            <option value="short">short</option>
            <option value="post">post</option>
          </select>
        </div>
      </div>

      <h3 style={{ marginTop: 16 }}>Filename</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        The editor must save the Drive upload with this exact name (case-sensitive).
      </p>
      <div className="row">
        <div>
          <label>Date or week (e.g. 2026-05-16 or 2026-05-W3)</label>
          <input type="text" value={datePart} onChange={(e) => setDatePart(e.target.value)}
                 placeholder="2026-05-16" required />
        </div>
        <div>
          <label>Slot (1, 2, or exam code)</label>
          <input type="text" value={slot} onChange={(e) => setSlot(e.target.value)} required />
        </div>
        <div>
          <label>Exam tag (optional)</label>
          <input type="text" value={examTag} onChange={(e) => setExamTag(e.target.value)}
                 placeholder="D330" />
        </div>
        <div>
          <label>Extension</label>
          <select value={ext} onChange={(e) => setExt(e.target.value)}>
            <option value="mp4">mp4</option>
            <option value="mov">mov</option>
            <option value="m4v">m4v</option>
            <option value="webm">webm</option>
          </select>
        </div>
      </div>
      <p><strong>Expected filename:</strong> <code>{expectedFilename || '—'}</code></p>

      <h3 style={{ marginTop: 16 }}>Metadata</h3>
      <label>
        Title <span className={title.length > 100 ? '' : 'muted'} style={{ color: title.length > 100 ? 'var(--danger)' : undefined }}>
          ({title.length}/100)
        </span>
      </label>
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required />
      <label>
        Description (paste full long-form copy){' '}
        <span className={description.length > 5000 ? '' : 'muted'} style={{ color: description.length > 5000 ? 'var(--danger)' : undefined }}>
          ({description.length}/5000){description.length > 5000 ? ` — trim ${description.length - 5000}` : ''}
        </span>
      </label>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                style={{ minHeight: 240, borderColor: description.length > 5000 ? 'var(--danger)' : undefined }} required />
      <label>
        Tags (comma-separated){' '}
        <span className={tagsOver ? '' : 'muted'} style={{ color: tagsOver ? 'var(--danger)' : undefined }}>
          ({tagsLen}/500){tagsOver ? ` — drop ${tagsLen - 500} chars` : ''}
        </span>
      </label>
      <input type="text" value={tags} onChange={(e) => setTags(e.target.value)}
             style={{ borderColor: tagsOver ? 'var(--danger)' : undefined }} />

      <h3 style={{ marginTop: 16 }}>Schedule</h3>
      <label>Publish at (America/New_York)</label>
      <input type="datetime-local" value={scheduledLocal}
             onChange={(e) => setScheduledLocal(e.target.value)} required />

      {/* Sheet write-back removed: status now tracked in the in-app Content Planner. */}

      {err && <p style={{ color: 'var(--danger)', marginTop: 12 }}>{err}</p>}
      <div style={{ marginTop: 16 }}>
        <button className="btn" type="submit" disabled={busy || !expectedFilename}>
          {busy ? 'Creating…' : 'Create item'}
        </button>
      </div>
    </form>
  );
}
