'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface PolishChecks {
  aiUse?: boolean;
  captionCert?: boolean;
  shortsRemix?: boolean;
  eduLevel?: boolean;
  endScreen?: boolean;
  cards?: boolean;
}

interface Item {
  id: string;
  title: string;
  description: string;
  tags: string[];
  scheduledPublishAt: string;
  status: string;
  driveFileId: string | null;
  expectedFilename: string;
  youtubeVideoId: string | null;
  recordingCountry: string;
  playlistIds: string[];
  polishChecks: PolishChecks | null;
  channel: { id: string };
  editorTask?: { id: string; status: string } | null;
}

interface YouTubePlaylist {
  id: string;
  title: string;
  itemCount: number;
  privacyStatus: string;
}

// Each entry is one row in the post-upload "Polish" checklist. Order matters —
// it's what the approver sees in the UI. Keys must match the PolishChecks type.
const POLISH_ROWS: Array<{ key: keyof PolishChecks; label: string; hint: string }> = [
  { key: 'aiUse',       label: 'AI use → "No"',                       hint: 'Required if any AI-generated likeness/footage; safe to skip otherwise.' },
  { key: 'captionCert', label: 'Caption certification → "Never aired on US TV"', hint: 'Only required for content originally aired on US television.' },
  { key: 'shortsRemix', label: 'Shorts remixing → "Don\'t allow remixing"', hint: 'Defaults to Allow; switch to Don\'t allow in Studio.' },
  { key: 'eduLevel',    label: 'Educational level → "Graduate school"', hint: 'Part of YouTube\'s Courses feature; in Studio under "Show more".' },
  { key: 'endScreen',   label: 'End screen added',                    hint: 'Add subscribe + last video. Final 20s of the video.' },
  { key: 'cards',       label: 'Cards added',                         hint: 'Add 1–2 cards at relevant timestamps.' },
];

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
  const [videoLocation, setVideoLocation] = useState(item.recordingCountry || 'United States');
  const [selectedPlaylists, setSelectedPlaylists] = useState<string[]>(item.playlistIds ?? []);
  const [polish, setPolish] = useState<PolishChecks>(item.polishChecks ?? {});
  const [availablePlaylists, setAvailablePlaylists] = useState<YouTubePlaylist[] | null>(null);
  const [playlistsErr, setPlaylistsErr] = useState<string | null>(null);
  const [newPlaylistTitle, setNewPlaylistTitle] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Load this channel's YouTube playlists once on mount. Best-effort —
  // a YouTube auth issue shouldn't block editing the rest of the item.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/proxy/playlists?channelId=${item.channel.id}`, { credentials: 'include' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled) setAvailablePlaylists(data.playlists ?? []);
      } catch (e) {
        if (!cancelled) setPlaylistsErr((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [item.channel.id]);

  const editable = !['scheduled', 'scheduling', 'published'].includes(item.status);

  // YouTube Data API hard limits — don't raise these without checking docs.
  const TITLE_MAX = 100;
  const DESC_MAX = 5000;
  const TAGS_MAX = 500;
  const titleOver = title.length > TITLE_MAX;
  const descOver = description.length > DESC_MAX;

  // YouTube counts tags as: comma-joined string, with quotes added around
  // any tag containing a space. So `["foo bar", "baz"]` is measured as
  // `"foo bar",baz` (length 13), not `foo bar,baz` (length 11). Over 500
  // characters and the API rejects with "invalid video keywords".
  function ytEffectiveTagsLength(raw: string): number {
    const tags = raw.split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length === 0) return 0;
    const sum = tags.reduce((acc, t) => acc + t.length + (t.includes(' ') ? 2 : 0), 0);
    return sum + (tags.length - 1); // commas
  }
  const tagsLen = ytEffectiveTagsLength(tags);
  const tagsOver = tagsLen > TAGS_MAX;

  // Turn raw Fastify / Zod validation JSON into a human-readable sentence.
  function prettyError(raw: string): string {
    try {
      const top = JSON.parse(raw);
      const msg = typeof top.message === 'string' ? top.message : raw;
      try {
        const zod = JSON.parse(msg);
        if (Array.isArray(zod)) {
          return zod.map((z: { code?: string; path?: (string | number)[]; maximum?: number; minimum?: number; message?: string }) => {
            const field = (z.path ?? []).join('.') || 'field';
            if (z.code === 'too_big')   return `${field} too long (max ${z.maximum} characters)`;
            if (z.code === 'too_small') return `${field} too short (min ${z.minimum} characters)`;
            return `${field}: ${z.message ?? 'invalid'}`;
          }).join(' · ');
        }
      } catch { /* msg wasn't nested JSON — fall through */ }
      return msg;
    } catch {
      return raw;
    }
  }

  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`/api/proxy${path}`, {
      method, credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(prettyError(await res.text()));
    return res;
  }

  async function save() {
    if (titleOver) { setErr(`Title is ${title.length}/${TITLE_MAX} characters. Trim ${title.length - TITLE_MAX} to save.`); return; }
    if (descOver)  { setErr(`Description is ${description.length}/${DESC_MAX} characters. Trim ${description.length - DESC_MAX} to save. (YouTube's hard limit is ${DESC_MAX}.)`); return; }
    if (tagsOver)  { setErr(`Tags use ${tagsLen}/${TAGS_MAX} characters (YouTube counts quotes around multi-word tags). Remove ${tagsLen - TAGS_MAX} chars worth — drop a tag or two.`); return; }
    setBusy('save'); setErr(null);
    try {
      await call('PATCH', `/items/${item.id}`, {
        title, description,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        scheduledPublishAt: nyInputToIso(scheduled),
        recordingCountry: videoLocation,
        playlistIds: selectedPlaylists,
        polishChecks: polish,
      });
      router.refresh();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  // Save just the polish checklist — doesn't touch metadata or trigger the
  // save-button limits. Useful for the post-upload "tick as you go" flow.
  async function savePolish(next: PolishChecks) {
    setPolish(next);
    try {
      await call('PATCH', `/items/${item.id}`, { polishChecks: next });
    } catch (e: unknown) { setErr((e as Error).message); }
  }

  async function createPlaylist() {
    if (!newPlaylistTitle.trim()) return;
    setBusy('newPlaylist'); setErr(null);
    try {
      const res = await fetch(`/api/proxy/playlists?channelId=${item.channel.id}`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: newPlaylistTitle.trim(), privacyStatus: 'public' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setAvailablePlaylists((cur) => [...(cur ?? []), data.playlist]);
      setSelectedPlaylists((cur) => [...cur, data.playlist.id]);
      setNewPlaylistTitle('');
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  function togglePlaylist(id: string) {
    setSelectedPlaylists((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
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

  async function del(force: boolean) {
    const onYouTube = Boolean(item.youtubeVideoId);
    const msg = onYouTube
      ? `Delete this item AND remove the video from YouTube?\n\nFilename: ${item.expectedFilename}\nYouTube ID: ${item.youtubeVideoId}\n\nThis cannot be undone.`
      : `Delete this item?\n\nFilename: ${item.expectedFilename}\n\nThis frees the filename so you can create a new item with the same name.`;
    if (!confirm(msg)) return;
    setBusy('delete'); setErr(null);
    try {
      const res = await fetch(`/api/proxy/items/${item.id}${force ? '?force=1' : ''}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // If YouTube delete failed, offer force-delete
        if (res.status === 502 && body?.error === 'youtube_delete_failed') {
          if (confirm(`${body.message}\n\nProceed with FORCE delete (orphans the YouTube video)?`)) {
            return del(true);
          }
        }
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      // Redirect to items list after successful delete
      router.push('/items');
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  void API;

  return (
    <div className="card">
      <h3>Metadata</h3>
      <label>
        Title <span className={titleOver ? '' : 'muted'} style={{ color: titleOver ? 'var(--danger)' : undefined }}>
          ({title.length}/{TITLE_MAX})
        </span>
      </label>
      <input type="text" value={title} maxLength={TITLE_MAX} disabled={!editable}
             onChange={(e) => setTitle(e.target.value)} />
      <label>
        Description <span className={descOver ? '' : 'muted'} style={{ color: descOver ? 'var(--danger)' : undefined }}>
          ({description.length}/{DESC_MAX}){descOver ? ` — trim ${description.length - DESC_MAX}` : ''}
        </span>
      </label>
      <textarea value={description} disabled={!editable}
                onChange={(e) => setDescription(e.target.value)}
                style={{ minHeight: 240, borderColor: descOver ? 'var(--danger)' : undefined }} />
      <label>
        Tags <span className="muted">(comma-separated)</span>{' '}
        <span className={tagsOver ? '' : 'muted'} style={{ color: tagsOver ? 'var(--danger)' : undefined }}>
          ({tagsLen}/{TAGS_MAX}){tagsOver ? ` — drop ${tagsLen - TAGS_MAX} chars` : ''}
        </span>
      </label>
      <input type="text" value={tags} disabled={!editable}
             onChange={(e) => setTags(e.target.value)}
             style={{ borderColor: tagsOver ? 'var(--danger)' : undefined }} />
      <label>Scheduled publish (America/New_York)</label>
      <input type="datetime-local" value={scheduled} disabled={!editable}
             onChange={(e) => setScheduled(e.target.value)} />

      <label style={{ marginTop: 14 }}>
        Video location <span className="muted">(free text — shown as recording location on YouTube)</span>
      </label>
      <input type="text" value={videoLocation} disabled={!editable}
             onChange={(e) => setVideoLocation(e.target.value)}
             placeholder="United States" />

      <h3 style={{ marginTop: 24 }}>Playlists</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Video will be added to each selected playlist immediately after upload. Multi-select.
      </p>
      {playlistsErr && (
        <div className="alert error">
          Couldn't load playlists: {playlistsErr}
          <br /><span className="muted">Make sure YouTube is connected on this channel.</span>
        </div>
      )}
      {!playlistsErr && availablePlaylists === null && <p className="muted">Loading playlists…</p>}
      {availablePlaylists && availablePlaylists.length === 0 && (
        <p className="muted">No playlists yet on this channel. Create one below.</p>
      )}
      {availablePlaylists && availablePlaylists.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {availablePlaylists.map((p) => (
            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <input type="checkbox" disabled={!editable}
                     checked={selectedPlaylists.includes(p.id)}
                     onChange={() => togglePlaylist(p.id)} />
              <span>{p.title}</span>
              <span className="muted" style={{ fontSize: 12 }}>· {p.itemCount} videos · {p.privacyStatus}</span>
            </label>
          ))}
        </div>
      )}
      {editable && availablePlaylists !== null && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label>New playlist title</label>
            <input type="text" value={newPlaylistTitle}
                   onChange={(e) => setNewPlaylistTitle(e.target.value)}
                   placeholder="e.g. ATI Pharmacology" />
          </div>
          <button className="btn secondary" onClick={createPlaylist}
                  disabled={!newPlaylistTitle.trim() || busy === 'newPlaylist'}>
            {busy === 'newPlaylist' ? 'Creating…' : '+ Create playlist'}
          </button>
        </div>
      )}

      {item.youtubeVideoId && (
        <>
          <h3 style={{ marginTop: 24 }}>
            Polish checklist{' '}
            <span className="muted" style={{ fontSize: 14, fontWeight: 'normal' }}>
              ({POLISH_ROWS.filter((r) => polish[r.key]).length}/{POLISH_ROWS.length} done)
            </span>
          </h3>
          <p className="muted" style={{ marginTop: 0 }}>
            These YouTube settings aren't exposed by the Data API and must be set in Studio.
            Tick them off as you go.{' '}
            <a href={`https://studio.youtube.com/video/${item.youtubeVideoId}/edit`} target="_blank" rel="noreferrer">
              → Open this video in Studio
            </a>
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {POLISH_ROWS.map((r) => (
              <label key={r.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: 0 }}>
                <input type="checkbox" checked={!!polish[r.key]}
                       onChange={(e) => savePolish({ ...polish, [r.key]: e.target.checked })} />
                <div>
                  <div>{r.label}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{r.hint}</div>
                </div>
              </label>
            ))}
          </div>
        </>
      )}

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

        {/* Delete is always available — confirms via the browser, removes the YouTube video too. */}
        <span style={{ flex: 1 }} />
        <button className="btn danger" onClick={() => del(false)} disabled={!!busy}>
          {busy === 'delete' ? 'Deleting…' : 'Delete item'}
        </button>
      </div>
    </div>
  );
}
