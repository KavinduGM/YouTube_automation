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

  const shown = useMemo(() => {
    if (!filterMonth) return rows;
    return rows.filter((r) => r.month === filterMonth);
  }, [rows, filterMonth]);

  const months = useMemo(() => {
    const s = new Set(rows.map((r) => r.month));
    return Array.from(s).sort().reverse();
  }, [rows]);

  async function patch(row: ChannelMonth, field: keyof ChannelMonth, value: string | null) {
    setBusy(row.id); setErr(null);
    try {
      const res = await fetch(`/api/proxy/channel-months/${row.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      setRows(rows.map((r) => r.id === row.id ? { ...r, ...out.month } : r));
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
        shown.map((row) => (
          <div key={row.id} className="card">
            <h3>
              <span className="badge blue">{row.channel.slug}</span>{' '}
              {row.month}{' '}
              <button className="btn small danger" style={{ float: 'right' }} onClick={() => delRow(row)} disabled={!!busy}>Delete</button>
            </h3>
            <div className="row" style={{ marginTop: 10 }}>
              <div>
                <label>Drive folder ID (working folder for this month)</label>
                <input type="text" defaultValue={row.driveFolderId ?? ''}
                       onBlur={(e) => patch(row, 'driveFolderId', e.target.value || null)}
                       placeholder="paste folder id" />
              </div>
              <div>
                <label>Published folder ID</label>
                <input type="text" defaultValue={row.publishedFolderId ?? ''}
                       onBlur={(e) => patch(row, 'publishedFolderId', e.target.value || null)}
                       placeholder="optional" />
              </div>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <div>
                <label>Raw archive folder ID</label>
                <input type="text" defaultValue={row.rawArchiveFolderId ?? ''}
                       onBlur={(e) => patch(row, 'rawArchiveFolderId', e.target.value || null)}
                       placeholder="optional" />
              </div>
              <div>
                <label>Default sheet ID</label>
                <input type="text" defaultValue={row.defaultSheetId ?? ''}
                       onBlur={(e) => patch(row, 'defaultSheetId', e.target.value || null)}
                       placeholder="optional" />
              </div>
            </div>
          </div>
        ))
      )}
    </>
  );
}
