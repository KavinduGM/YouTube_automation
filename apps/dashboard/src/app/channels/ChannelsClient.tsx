'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Channel {
  id: string; slug: string; name: string;
  filenamePrefix: string;
  hasQuestionVideos: boolean;
  hasAnimationVideos: boolean;
  hasShortVideos: boolean;
  youtubeChannelId: string | null;
  driveFolderId: string | null;
  publishedFolderId: string | null;
  rawArchiveFolderId: string | null;
  defaultSheetId: string | null;
  connected: boolean;
}

function suggestPrefix(name: string): string {
  const words = name.trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 6) {
    return words.map((w) => w[0]!.toUpperCase()).join('').slice(0, 6);
  }
  return name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8);
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default function ChannelsClient({
  initial,
}: { initial: { channels: Channel[]; driveSheets: { email: string } | null } }) {
  const router = useRouter();
  const [channels, setChannels] = useState(initial.channels);
  const driveSheets = initial.driveSheets;

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [prefix, setPrefix] = useState('');
  const [hasQ, setHasQ] = useState(false);
  const [hasA, setHasA] = useState(false);
  const [hasS, setHasS] = useState(true);

  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Auto-fill slug + prefix from name unless user edited them
  const suggestedSlug = useMemo(() => slugify(name), [name]);
  const suggestedPrefix = useMemo(() => suggestPrefix(name), [name]);

  async function create() {
    setBusy('create'); setErr(null);
    try {
      const res = await fetch('/api/proxy/channels', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          slug: slug || suggestedSlug,
          filenamePrefix: prefix || suggestedPrefix,
          hasQuestionVideos: hasQ,
          hasAnimationVideos: hasA,
          hasShortVideos: hasS,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? body.error ?? 'failed');
      }
      const out = await res.json();
      setChannels([...channels, out.channel]);
      setName(''); setSlug(''); setPrefix('');
      setHasQ(false); setHasA(false); setHasS(true);
      setShowAdd(false);
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function patch(id: string, body: Partial<Pick<Channel, 'name' | 'filenamePrefix' | 'hasQuestionVideos' | 'hasAnimationVideos' | 'hasShortVideos'>>) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/proxy/channels/${id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      setChannels(channels.map((c) => c.id === id ? { ...c, ...out.channel } : c));
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function del(c: Channel) {
    if (!confirm(`Delete channel "${c.name}"?\n\nThis removes all unpublished items, slots, and editor tasks for it.\nYouTube videos already live stay on YouTube.`)) return;
    setBusy(c.id); setErr(null);
    try {
      const res = await fetch(`/api/proxy/channels/${c.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 409 && body.error === 'has_live_items') {
          if (confirm(`${body.message}\n\nForce delete anyway?`)) {
            const r2 = await fetch(`/api/proxy/channels/${c.id}?force=1`, { method: 'DELETE', credentials: 'include' });
            if (!r2.ok) throw new Error(await r2.text());
          } else return;
        } else throw new Error(body.message ?? body.error ?? 'failed');
      }
      setChannels(channels.filter((x) => x.id !== c.id));
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  function startYouTubeOAuth(channelId: string) {
    window.location.href = `/api/proxy/oauth/google/start?kind=youtube&channelId=${channelId}`;
  }
  function startDriveSheetsOAuth() {
    window.location.href = `/api/proxy/oauth/google/start?kind=drive_sheets`;
  }

  return (
    <>
      <div className="card">
        <div className="card-row">
          <div>
            <h3 style={{ marginBottom: 4 }}>Google Drive + Sheets</h3>
            <p className="muted" style={{ margin: 0 }}>
              {driveSheets ? <>Connected as <code>{driveSheets.email}</code></> : 'Not connected — required for Drive and Sheet access'}
            </p>
          </div>
          <button className="btn" onClick={startDriveSheetsOAuth}>
            {driveSheets ? 'Reconnect' : 'Connect'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-row">
          <h3 style={{ margin: 0 }}>Channels ({channels.length})</h3>
          <button className="btn primary" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? 'Cancel' : '+ Add channel'}
          </button>
        </div>
        {showAdd && (
          <div style={{ marginTop: 16 }}>
            <div className="row">
              <div>
                <label>Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="AB Test" />
              </div>
              <div>
                <label>Slug</label>
                <input type="text" value={slug || suggestedSlug} onChange={(e) => setSlug(e.target.value)} placeholder="ab-test" />
              </div>
              <div>
                <label>Filename prefix</label>
                <input type="text" value={prefix || suggestedPrefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} placeholder="ABT" />
              </div>
            </div>
            <label style={{ marginTop: 12 }}>This channel publishes</label>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0 }}>
                <input type="checkbox" checked={hasQ} onChange={(e) => setHasQ(e.target.checked)} />
                <span>Long question videos</span>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0 }}>
                <input type="checkbox" checked={hasA} onChange={(e) => setHasA(e.target.checked)} />
                <span>Long animation videos</span>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0 }}>
                <input type="checkbox" checked={hasS} onChange={(e) => setHasS(e.target.checked)} />
                <span>Short videos</span>
              </label>
            </div>
            <div style={{ marginTop: 16 }}>
              <button className="btn primary" onClick={create} disabled={busy === 'create' || !name}>
                {busy === 'create' ? 'Creating…' : 'Create channel'}
              </button>
            </div>
          </div>
        )}
        {err && <div className="alert error">{err}</div>}
      </div>

      {channels.length === 0 ? (
        <div className="card"><p className="muted">No channels yet — add one above.</p></div>
      ) : (
        channels.map((c) => (
          <div key={c.id} className="card">
            <div className="card-row">
              <div>
                <h3 style={{ margin: 0 }}>
                  {c.name} <span className="badge gray">{c.slug}</span> <span className="badge purple">{c.filenamePrefix}</span>
                </h3>
                <p className="muted" style={{ marginTop: 4 }}>
                  YouTube: {c.youtubeChannelId
                    ? <a href={`https://www.youtube.com/channel/${c.youtubeChannelId}`} target="_blank" rel="noreferrer">{c.youtubeChannelId}</a>
                    : <span>not connected</span>}
                </p>
              </div>
              <div className="hgap-2">
                <button className="btn secondary" onClick={() => startYouTubeOAuth(c.id)} disabled={!!busy}>
                  {c.connected ? 'Reconnect YouTube' : 'Connect YouTube'}
                </button>
                <button className="btn small danger" onClick={() => del(c)} disabled={!!busy}>Delete</button>
              </div>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <div>
                <label>Name</label>
                <input type="text" defaultValue={c.name}
                       onBlur={(e) => e.target.value !== c.name && patch(c.id, { name: e.target.value })} />
              </div>
              <div>
                <label>Filename prefix</label>
                <input type="text" defaultValue={c.filenamePrefix}
                       onBlur={(e) => e.target.value.toUpperCase() !== c.filenamePrefix && patch(c.id, { filenamePrefix: e.target.value.toUpperCase() })} />
              </div>
            </div>

            <label style={{ marginTop: 12 }}>Publishes</label>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0 }}>
                <input type="checkbox" checked={c.hasQuestionVideos}
                       onChange={(e) => patch(c.id, { hasQuestionVideos: e.target.checked })} />
                <span>Long question</span>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0 }}>
                <input type="checkbox" checked={c.hasAnimationVideos}
                       onChange={(e) => patch(c.id, { hasAnimationVideos: e.target.checked })} />
                <span>Long animation</span>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0 }}>
                <input type="checkbox" checked={c.hasShortVideos}
                       onChange={(e) => patch(c.id, { hasShortVideos: e.target.checked })} />
                <span>Shorts</span>
              </label>
            </div>
          </div>
        ))
      )}
      <p className="muted" style={{ marginTop: 8 }}>Drive folders are managed per month on <a href="/channel-months">Monthly folders</a>.</p>
    </>
  );
}
