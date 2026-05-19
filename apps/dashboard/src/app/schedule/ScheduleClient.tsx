'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Channel {
  id: string; slug: string; name: string; filenamePrefix: string | null;
  hasQuestionVideos: boolean; hasAnimationVideos: boolean; hasShortVideos: boolean;
}
interface Slot {
  id: string; channelId: string;
  type: 'long' | 'short' | 'post';
  format: 'question' | 'animation' | null;
  name: string | null;
  scheduledAt: string;
  status: 'available' | 'assigned' | 'used' | 'skipped';
  assignedItemId: string | null;
  assignedItem: { id: string; expectedFilename: string; status: string; title: string } | null;
}

function nyDateAndTimeToIso(dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
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

const TZ = 'America/New_York';
function fmt(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}

function badgeForStatus(s: string): string {
  if (s === 'available') return 'green';
  if (s === 'assigned') return 'blue';
  if (s === 'used') return 'gray';
  return 'yellow';
}

export default function ScheduleClient({
  channels, initialSlots, channelId: initialChannelId, month: initialMonth,
}: {
  channels: Channel[];
  initialSlots: Slot[];
  channelId?: string;
  month: string;
}) {
  const router = useRouter();
  const [slots, setSlots] = useState(initialSlots);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const currentChannel = channels.find((c) => c.id === initialChannelId);

  // Bulk-add
  const [bulkType, setBulkType] = useState<'long' | 'short'>('long');
  const [bulkFormat, setBulkFormat] = useState<'question' | 'animation' | ''>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]);
  const [times, setTimes] = useState('11:00, 15:00');
  const [slotName, setSlotName] = useState('');

  function nav(opts: { month?: string; channelId?: string }) {
    const params = new URLSearchParams();
    if (opts.channelId ?? initialChannelId) params.set('channelId', opts.channelId ?? initialChannelId ?? '');
    if (opts.month ?? initialMonth) params.set('month', opts.month ?? initialMonth);
    router.push(`/schedule?${params.toString()}`);
  }

  const grouped = useMemo(() => {
    const byDay = new Map<string, Slot[]>();
    for (const s of slots) {
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s.scheduledAt));
      const list = byDay.get(day) ?? [];
      list.push(s);
      byDay.set(day, list);
    }
    return Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [slots]);

  async function bulkAdd() {
    if (!initialChannelId || !startDate || !endDate || !times.trim()) { setErr('fill all fields'); return; }
    if (bulkType === 'long' && !bulkFormat) { setErr('pick a long format (question or animation)'); return; }
    setBusy('bulk'); setErr(null);
    try {
      const start = new Date(startDate + 'T00:00:00');
      const end = new Date(endDate + 'T00:00:00');
      const timeList = times.split(',').map((t) => t.trim()).filter(Boolean);
      const toAdd: { channelId: string; type: 'long' | 'short'; format: 'question' | 'animation' | null; name: string | null; scheduledAt: string }[] = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (!weekdays.includes(d.getDay())) continue;
        const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        for (const t of timeList) {
          toAdd.push({
            channelId: initialChannelId,
            type: bulkType,
            format: bulkType === 'long' ? (bulkFormat as 'question' | 'animation') : null,
            name: slotName || null,
            scheduledAt: nyDateAndTimeToIso(ymd, t),
          });
        }
      }
      if (toAdd.length === 0) { setErr('no dates matched'); setBusy(null); return; }
      const res = await fetch('/api/proxy/slots/bulk', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slots: toAdd }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function duplicateMonth(targetMonth: string) {
    if (!initialChannelId) return;
    setBusy('dup'); setErr(null);
    try {
      const res = await fetch('/api/proxy/slots/duplicate', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channelId: initialChannelId, sourceMonth: initialMonth, targetMonth }),
      });
      if (!res.ok) throw new Error(await res.text());
      nav({ month: targetMonth });
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function delSlot(id: string) {
    if (!confirm('Delete this slot?')) return;
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/proxy/slots/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? body.error ?? 'failed');
      }
      setSlots(slots.filter((s) => s.id !== id));
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function patchSlot(s: Slot, body: Partial<{ format: 'question' | 'animation' | null; name: string | null; type: 'long' | 'short' }>) {
    setBusy(s.id); setErr(null);
    try {
      const res = await fetch(`/api/proxy/slots/${s.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      setSlots(slots.map((x) => x.id === s.id ? { ...x, ...out.slot } : x));
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  function toggleWeekday(d: number) {
    setWeekdays(weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d]);
  }

  const nextMonth = (() => {
    const [y, m] = initialMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();

  return (
    <>
      <div className="card">
        <div className="row">
          <div>
            <label>Channel</label>
            <select value={initialChannelId} onChange={(e) => nav({ channelId: e.target.value })}>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label>Month</label>
            <input type="month" value={initialMonth} onChange={(e) => nav({ month: e.target.value })} />
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button className="btn secondary" onClick={() => duplicateMonth(nextMonth)} disabled={busy === 'dup'}>
              {busy === 'dup' ? 'Copying…' : `Duplicate to ${nextMonth}`}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Bulk add slots</h3>
        <div className="row">
          <div>
            <label>Type</label>
            <select value={bulkType} onChange={(e) => { setBulkType(e.target.value as 'long' | 'short'); if (e.target.value === 'short') setBulkFormat(''); }}>
              {(currentChannel?.hasQuestionVideos || currentChannel?.hasAnimationVideos) && <option value="long">long</option>}
              <option value="short">short</option>
            </select>
          </div>
          {bulkType === 'long' && (
            <div>
              <label>Long format</label>
              <select value={bulkFormat} onChange={(e) => setBulkFormat(e.target.value as 'question' | 'animation' | '')}>
                <option value="">— pick —</option>
                {currentChannel?.hasQuestionVideos && <option value="question">question</option>}
                {currentChannel?.hasAnimationVideos && <option value="animation">animation</option>}
              </select>
            </div>
          )}
          <div>
            <label>Slot name (optional)</label>
            <input type="text" value={slotName} onChange={(e) => setSlotName(e.target.value)} placeholder="Morning long" />
          </div>
        </div>
        <div className="row">
          <div>
            <label>Start date (NY)</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label>End date (NY)</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div>
            <label>Times (NY, 24h, comma-sep)</label>
            <input type="text" value={times} onChange={(e) => setTimes(e.target.value)} placeholder="11:00, 15:00" />
          </div>
        </div>
        <label style={{ marginTop: 12 }}>Weekdays</label>
        <div>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
            <label key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 14 }}>
              <input type="checkbox" checked={weekdays.includes(i)} onChange={() => toggleWeekday(i)} />
              <span>{d}</span>
            </label>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={bulkAdd} disabled={busy === 'bulk'}>
            {busy === 'bulk' ? 'Adding…' : 'Add slots'}
          </button>
        </div>
        {err && <div className="alert error">{err}</div>}
      </div>

      <h2>Slots in {initialMonth} <span className="muted">({slots.length})</span></h2>
      {grouped.length === 0
        ? <div className="card"><p className="muted">No slots yet.</p></div>
        : grouped.map(([day, ds]) => (
          <div key={day} className="card">
            <b>{day}</b>
            <table style={{ marginTop: 10, marginBottom: 0 }}>
              <thead>
                <tr><th>Time</th><th>Type</th><th>Format</th><th>Name</th><th>Status</th><th>Assigned to</th><th></th></tr>
              </thead>
              <tbody>
                {ds.map((s) => (
                  <tr key={s.id}>
                    <td>{fmt(s.scheduledAt)}</td>
                    <td>{s.type}</td>
                    <td>
                      {s.type === 'long' ? (
                        <select value={s.format ?? ''} disabled={!!s.assignedItemId || !!busy}
                                onChange={(e) => patchSlot(s, { format: (e.target.value || null) as 'question' | 'animation' | null })}>
                          <option value="">—</option>
                          <option value="question">question</option>
                          <option value="animation">animation</option>
                        </select>
                      ) : '—'}
                    </td>
                    <td>
                      <input type="text" defaultValue={s.name ?? ''} disabled={!!busy}
                             onBlur={(e) => e.target.value !== (s.name ?? '') && patchSlot(s, { name: e.target.value || null })} />
                    </td>
                    <td><span className={`badge ${badgeForStatus(s.status)}`}>{s.status}</span></td>
                    <td>{s.assignedItem ? <code>{s.assignedItem.expectedFilename}</code> : '—'}</td>
                    <td>
                      {!s.assignedItemId && (
                        <button className="btn small danger" onClick={() => delSlot(s.id)} disabled={!!busy}>Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      }
    </>
  );
}
