'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Channel { id: string; slug: string; name: string }
interface Slot {
  id: string; channelId: string;
  type: 'long' | 'short' | 'post';
  scheduledAt: string;
  status: 'available' | 'assigned' | 'used' | 'skipped';
  assignedItemId: string | null;
  assignedItem: { id: string; expectedFilename: string; status: string; title: string } | null;
}

// Convert wall-clock NY time to UTC ISO (mirrors helper used elsewhere).
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
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, dateStyle: 'medium', timeStyle: 'short', hour12: true,
  }).format(new Date(iso));
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

  // Bulk-add form state
  const [bulkType, setBulkType] = useState<'long' | 'short' | 'post'>('short');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]); // 0=Sun
  const [times, setTimes] = useState('11:00, 15:00');

  const channelId = initialChannelId;

  function nav(opts: { month?: string; channelId?: string }) {
    const params = new URLSearchParams();
    if (opts.channelId ?? channelId) params.set('channelId', opts.channelId ?? channelId ?? '');
    if (opts.month ?? initialMonth) params.set('month', opts.month ?? initialMonth);
    router.push(`/schedule?${params.toString()}`);
  }

  const grouped = useMemo(() => {
    const byDay = new Map<string, Slot[]>();
    for (const s of slots) {
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(s.scheduledAt));
      const list = byDay.get(day) ?? [];
      list.push(s);
      byDay.set(day, list);
    }
    return Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [slots]);

  async function bulkAdd() {
    if (!channelId || !startDate || !endDate || !times.trim()) { setErr('fill all fields'); return; }
    setBusy('bulk'); setErr(null);
    try {
      const start = new Date(startDate + 'T00:00:00');
      const end = new Date(endDate + 'T00:00:00');
      const timeList = times.split(',').map((t) => t.trim()).filter(Boolean);
      const slotsToAdd: { channelId: string; type: 'long' | 'short' | 'post'; scheduledAt: string }[] = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (!weekdays.includes(d.getDay())) continue;
        const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        for (const t of timeList) {
          slotsToAdd.push({
            channelId, type: bulkType, scheduledAt: nyDateAndTimeToIso(ymd, t),
          });
        }
      }
      if (slotsToAdd.length === 0) { setErr('no dates matched'); setBusy(null); return; }
      const res = await fetch('/api/proxy/slots/bulk', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slots: slotsToAdd }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function duplicateMonth(targetMonth: string) {
    if (!channelId) return;
    setBusy('dup'); setErr(null);
    try {
      const res = await fetch('/api/proxy/slots/duplicate', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channelId, sourceMonth: initialMonth, targetMonth }),
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

  function toggleWeekday(d: number) {
    setWeekdays(weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d]);
  }

  // Compute next month string for "duplicate" button
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
            <select value={channelId} onChange={(e) => nav({ channelId: e.target.value })}>
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
            <select value={bulkType} onChange={(e) => setBulkType(e.target.value as 'long' | 'short' | 'post')}>
              <option value="short">short</option>
              <option value="long">long</option>
            </select>
          </div>
          <div>
            <label>Start date (NY)</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label>End date (NY)</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div>
            <label>Times of day (NY, comma-sep, 24h)</label>
            <input type="text" value={times} onChange={(e) => setTimes(e.target.value)} placeholder="11:00, 15:00" />
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label>Weekdays</label>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
            <label key={i} style={{ display: 'inline-flex', alignItems: 'center', marginRight: 12 }}>
              <input type="checkbox" checked={weekdays.includes(i)} onChange={() => toggleWeekday(i)} />
              <span style={{ marginLeft: 4 }}>{d}</span>
            </label>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn" onClick={bulkAdd} disabled={busy === 'bulk'}>
            {busy === 'bulk' ? 'Adding…' : 'Add slots'}
          </button>
        </div>
        {err && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{err}</p>}
      </div>

      <h3>Slots in {initialMonth} ({slots.length})</h3>
      {grouped.length === 0
        ? <div className="card"><p className="muted">No slots yet. Use bulk-add above.</p></div>
        : grouped.map(([day, ds]) => (
            <div key={day} className="card">
              <b>{day}</b>
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr><th>Time</th><th>Type</th><th>Status</th><th>Assigned to</th><th></th></tr>
                </thead>
                <tbody>
                  {ds.map((s) => (
                    <tr key={s.id}>
                      <td>{fmt(s.scheduledAt)}</td>
                      <td>{s.type}</td>
                      <td><span className={`badge ${s.status === 'available' ? 'green' : s.status === 'assigned' ? 'blue' : s.status === 'used' ? 'gray' : 'yellow'}`}>{s.status}</span></td>
                      <td>{s.assignedItem ? s.assignedItem.expectedFilename : '—'}</td>
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
          ))}
    </>
  );
}
