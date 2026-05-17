'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Channel {
  id: string; slug: string; name: string;
  youtubeChannelId: string | null;
  driveFolderId: string | null;
  publishedFolderId: string | null;
  rawArchiveFolderId: string | null;
  defaultSheetId: string | null;
  connected: boolean;
}

export default function ChannelsClient({ initial }: {
  initial: { channels: Channel[]; driveSheets: { email: string } | null };
}) {
  const router = useRouter();
  const [channels, setChannels] = useState(initial.channels);
  const [driveSheets] = useState(initial.driveSheets);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // For creating a new channel row
  const [newSlug, setNewSlug] = useState<'OAP' | 'OAG' | 'NUR'>('OAP');
  const [newName, setNewName] = useState('');

  async function patch(id: string, body: Partial<Pick<Channel, 'name' | 'driveFolderId' | 'publishedFolderId' | 'rawArchiveFolderId' | 'defaultSheetId'>>) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/proxy/channels/${id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      setChannels((cs) => cs.map((c) => c.id === id ? { ...c, ...out.channel } : c));
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function createChannel() {
    if (!newName.trim()) { setErr('Name required'); return; }
    setBusy('new'); setErr(null);
    try {
      const res = await fetch('/api/proxy/channels', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: newSlug, name: newName }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
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
        <h3>Drive + Sheets connection</h3>
        <p>{driveSheets ? <>Connected as <code>{driveSheets.email}</code></> : <span className="muted">Not connected</span>}</p>
        <button className="btn" onClick={startDriveSheetsOAuth}>
          {driveSheets ? 'Reconnect' : 'Connect Google (Drive + Sheets)'}
        </button>
      </div>

      <h3>Channels</h3>
      {channels.map((c) => (
        <div key={c.id} className="card">
          <h4>{c.name} <span className="muted">({c.slug})</span></h4>
          <p>
            YouTube channel: {c.youtubeChannelId
              ? <a href={`https://www.youtube.com/channel/${c.youtubeChannelId}`} target="_blank" rel="noreferrer">{c.youtubeChannelId}</a>
              : <span className="muted">not connected</span>}
          </p>
          <button className="btn" onClick={() => startYouTubeOAuth(c.id)} disabled={busy === c.id}>
            {c.connected ? 'Reconnect YouTube' : 'Connect YouTube'}
          </button>
          <div style={{ marginTop: 12 }} className="row">
            <div>
              <label>Drive folder ID (monthly root)</label>
              <input type="text" defaultValue={c.driveFolderId ?? ''}
                     onBlur={(e) => patch(c.id, { driveFolderId: e.target.value || null })}
                     placeholder="paste Drive folder id" />
            </div>
            <div>
              <label>Published folder ID <span className="muted">(optional)</span></label>
              <input type="text" defaultValue={c.publishedFolderId ?? ''}
                     onBlur={(e) => patch(c.id, { publishedFolderId: e.target.value || null })}
                     placeholder="finals moved here after publish" />
            </div>
            <div>
              <label>Raw archive folder ID <span className="muted">(optional)</span></label>
              <input type="text" defaultValue={c.rawArchiveFolderId ?? ''}
                     onBlur={(e) => patch(c.id, { rawArchiveFolderId: e.target.value || null })}
                     placeholder="raw videos moved here after editor submits" />
            </div>
            <div>
              <label>Default sheet ID</label>
              <input type="text" defaultValue={c.defaultSheetId ?? ''}
                     onBlur={(e) => patch(c.id, { defaultSheetId: e.target.value || null })}
                     placeholder="paste Google Sheet id" />
            </div>
          </div>
        </div>
      ))}

      <h3>Add channel</h3>
      <div className="card">
        <div className="row">
          <div>
            <label>Slug</label>
            <select value={newSlug} onChange={(e) => setNewSlug(e.target.value as 'OAP' | 'OAG' | 'NUR')}>
              <option value="OAP">OAP</option>
              <option value="OAG">OAG</option>
              <option value="NUR">NUR (Nursing)</option>
            </select>
          </div>
          <div>
            <label>Display name</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button className="btn" onClick={createChannel} disabled={busy === 'new'}>
              {busy === 'new' ? 'Creating…' : 'Create / update'}
            </button>
          </div>
        </div>
      </div>

      {err && <div className="card" style={{ background: '#fef2f2' }}>{err}</div>}
    </>
  );
}
