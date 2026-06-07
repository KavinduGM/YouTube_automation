'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Channel { id: string; slug: string; name: string }
interface ChannelMonth {
  id: string;
  channelId: string;
  month: string;
  driveFolderId: string | null;
  publishedFolderId: string | null;
  rawArchiveFolderId: string | null;
  defaultSheetId: string | null;
  channel: { id: string; slug: string; name: string };
}

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function MonthsClient({
  channels, initialMonths,
}: { channels: Channel[]; initialMonths: ChannelMonth[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialMonths);
  const [filterMonth, setFilterMonth] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMonth, setNewMonth] = useState(thisMonth());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  type Draft = {
    driveFolderId: string;
    publishedFolderId: string;
    rawArchiveFolderId: string;
    defaultSheetId: string;
  };
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  function draftFor(row: ChannelMonth): Draft {
    return drafts[row.id] ?? {
      driveFolderId: row.driveFolderId ?? '',
      publishedFolderId: row.publishedFolderId ?? '',
      rawArchiveFolderId: row.rawArchiveFolderId ?? '',
      defaultSheetId: row.defaultSheetId ?? '',
    };
  }

  function setDraftField(row: ChannelMonth, field: keyof Draft, value: string) {
    setDrafts((cur) => ({ ...cur, [row.id]: { ...draftFor(row), [field]: value } }));
  }

  function isDirty(row: ChannelMonth): boolean {
    const d = drafts[row.id];
    if (!d) return false;
    return d.driveFolderId !== (row.driveFolderId ?? '')
      || d.publishedFolderId !== (row.publishedFolderId ?? '')
      || d.rawArchiveFolderId !== (row.rawArchiveFolderId ?? '')
      || d.defaultSheetId !== (row.defaultSheetId ?? '');
  }

  function resetDraft(rowId: string) {
    setDrafts((cur) => { const n = { ...cur }; delete n[rowId]; return n; });
  }

  const shown = useMemo(() => {
    if (!filterMonth) return rows;
    return rows.filter((r) => r.month === filterMonth);
  }, [rows, filterMonth]);

  const months = useMemo(() => {
    const s = new Set(rows.map((r) => r.month));
    return Array.from(s).sort().reverse();
  }, [rows]);

  async function saveRow(row: ChannelMonth) {
    const d = draftFor(row);
    setBusy(row.id); setErr(null);
    try {
      const res = await fetch(`/api/proxy/channel-months/${row.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          driveFolderId: d.driveFolderId.trim() || null,
          publishedFolderId: d.publishedFolderId.trim() || null,
          rawArchiveFolderId: d.rawArchiveFolderId.trim() || null,
          defaultSheetId: d.defaultSheetId.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      setRows((cur) => cur.map((r) => r.id === row.id ? { ...r, ...out.month } : r));
      resetDraft(row.id);
      setSavedFlash(row.id);
      setTimeout(() => setSavedFlash((cur) => (cur === row.id ? null : cur)), 2000);
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function addBlankForMonth() {
    setBusy('add'); setErr(null);
    try {
      // Upsert blank rows for every channel × this month
      for (const c of channels) {
        const res = await fetch('/api/proxy/channel-months', {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ channelId: c.id, month: newMonth }),
        });
        if (!res.ok) throw new Error(await res.text());
      }
      router.refresh();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); setShowAddForm(false); }
  }

  async function delRow(row: ChannelMonth) {
    if (!confirm(`Delete folder config for ${row.channel.slug} ${row.month}?`)) return;
    setBusy(row.id); setErr(null);
    try {
      const res = await fetch(`/api/proxy/channel-months/${row.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      setRows(rows.filter((r) => r.id !== row.id));
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <>
      <div className="card">
        <div className="row">
          <div>
            <label>Filter by month</label>
            <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}>
              <option value="">All months</option>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button className="btn secondary" onClick={() => setShowAddForm(!showAddForm)}>
              {showAddForm ? 'Cancel' : '+ Add month for all channels'}
            </button>
          </div>
        </div>
        {showAddForm && (
          <div className="row" style={{ marginTop: 10 }}>
            <div>
              <label>Month</label>
              <input type="month" value={newMonth} onChange={(e) => setNewMonth(e.target.value)} />
            </div>
            <div style={{ alignSelf: 'end' }}>
              <button className="btn" onClick={addBlankForMonth} disabled={busy === 'add'}>
                {busy === 'add' ? 'Adding…' : `Add ${newMonth} for all ${channels.length} channels`}
              </button>
            </div>
          </div>
        )}
        {err && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{err}</p>}
      </div>

      {shown.length === 0 ? (
        <div className="card"><p className="muted">No monthly folder configs yet. Click "Add month" above.</p></div>
      ) : (
        shown.map((row) => {
          const d = draftFor(row);
          const dirty = isDirty(row);
          const rowBusy = busy === row.id;
          return (
            <div key={row.id} className="card">
              <h3>
                <span className="badge blue">{row.channel.slug}</span>{' '}
                {row.month}{' '}
                <button className="btn small danger" style={{ float: 'right' }} onClick={() => delRow(row)} disabled={!!busy}>Delete</button>
              </h3>
              <div className="row" style={{ marginTop: 10 }}>
                <div>
                  <label>Drive folder ID (working folder for this month)</label>
                  <input type="text" value={d.driveFolderId}
                         onChange={(e) => setDraftField(row, 'driveFolderId', e.target.value)}
                         placeholder="paste folder id" />
                </div>
                <div>
                  <label>Published folder ID</label>
                  <input type="text" value={d.publishedFolderId}
                         onChange={(e) => setDraftField(row, 'publishedFolderId', e.target.value)}
                         placeholder="optional" />
                </div>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <div>
                  <label>Raw archive folder ID</label>
                  <input type="text" value={d.rawArchiveFolderId}
                         onChange={(e) => setDraftField(row, 'rawArchiveFolderId', e.target.value)}
                         placeholder="optional" />
                </div>
                <div>
                  <label>Default sheet ID</label>
                  <input type="text" value={d.defaultSheetId}
                         onChange={(e) => setDraftField(row, 'defaultSheetId', e.target.value)}
                         placeholder="optional" />
                </div>
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn primary" onClick={() => saveRow(row)} disabled={!dirty || rowBusy}>
                  {rowBusy ? 'Saving…' : 'Save'}
                </button>
                <button className="btn secondary" onClick={() => resetDraft(row.id)} disabled={!dirty || rowBusy}>
                  Reset
                </button>
                {dirty && <span className="muted" style={{ fontSize: 13 }}>Unsaved changes</span>}
                {savedFlash === row.id && !dirty && <span style={{ color: 'var(--success, #16a34a)', fontSize: 13 }}>Saved ✓</span>}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
