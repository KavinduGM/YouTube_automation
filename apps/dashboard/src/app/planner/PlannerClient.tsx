'use client';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { PlannerItem } from './page';

interface Channel { id: string; slug: string; name: string }

const TZ = 'America/New_York';

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

function nyDayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

function fmtDayHeader(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(Date.UTC(y, (m ?? 1) - 1, d, 12)));
}

function statusColor(s: string): 'green' | 'blue' | 'yellow' | 'red' | 'gray' | 'purple' {
  switch (s) {
    case 'published':         return 'green';
    case 'scheduled':         return 'blue';
    case 'scheduling':        return 'purple';
    case 'approved':          return 'purple';
    case 'pending_approval':  return 'yellow';
    case 'uploaded':          return 'yellow';
    case 'failed':            return 'red';
    case 'rejected':          return 'red';
    case 'canceled':          return 'gray';
    case 'planned':           return 'gray';
    default:                  return 'gray';
  }
}

// All statuses we want to allow filtering by, in display order.
const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: '',                  label: 'All' },
  { key: 'planned',           label: 'Planned' },
  { key: 'pending_approval',  label: 'Pending approval' },
  { key: 'approved',          label: 'Approved' },
  { key: 'scheduled',         label: 'Scheduled' },
  { key: 'published',         label: 'Published' },
  { key: 'failed',            label: 'Failed' },
  { key: 'rejected',          label: 'Rejected' },
];

export default function PlannerClient({
  channels, items, month, channelId, statusFilter,
}: {
  channels: Channel[];
  items: PlannerItem[];
  month: string;
  channelId: string;
  statusFilter: string;
}) {
  const router = useRouter();

  function nav(opts: { month?: string; channelId?: string | null; status?: string | null }) {
    const params = new URLSearchParams();
    const m = opts.month ?? month;
    const c = opts.channelId === null ? '' : (opts.channelId ?? channelId);
    const s = opts.status === null ? '' : (opts.status ?? statusFilter);
    if (m) params.set('month', m);
    if (c) params.set('channelId', c);
    if (s) params.set('status', s);
    router.push(`/planner?${params.toString()}`);
  }

  // Summary counts at the top: per-status totals across the loaded set.
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const it of items) out[it.status] = (out[it.status] ?? 0) + 1;
    return out;
  }, [items]);

  // Group items by NY-local day.
  const grouped = useMemo(() => {
    const byDay = new Map<string, PlannerItem[]>();
    for (const it of items) {
      const day = nyDayKey(it.scheduledPublishAt);
      const list = byDay.get(day) ?? [];
      list.push(it);
      byDay.set(day, list);
    }
    // Sort within each day by time ascending.
    for (const list of byDay.values()) {
      list.sort((a, b) => a.scheduledPublishAt.localeCompare(b.scheduledPublishAt));
    }
    return Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const monthLabel = (() => {
    const [y, m] = month.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
      .format(new Date(Date.UTC(y, (m ?? 1) - 1, 1)));
  })();

  return (
    <>
      <div className="card">
        <div className="row">
          <div>
            <label>Month</label>
            <input type="month" value={month} onChange={(e) => nav({ month: e.target.value })} />
          </div>
          <div>
            <label>Channel</label>
            <select value={channelId} onChange={(e) => nav({ channelId: e.target.value || null })}>
              <option value="">All channels</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.key;
            const count = f.key === '' ? items.length : (counts[f.key] ?? 0);
            return (
              <button key={f.key}
                      className={`btn small ${active ? 'primary' : 'secondary'}`}
                      onClick={() => nav({ status: f.key || null })}>
                {f.label} <span style={{ opacity: 0.7 }}>· {count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <h2 style={{ marginTop: 16 }}>{monthLabel} <span className="muted">({items.length} items)</span></h2>

      {grouped.length === 0 ? (
        <div className="card"><p className="muted">No items in this month matching the filters.</p></div>
      ) : grouped.map(([day, list]) => (
        <div key={day} className="card">
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>{fmtDayHeader(day)} <span className="muted">({list.length})</span></h3>
          <table style={{ marginBottom: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Time</th>
                <th style={{ width: 110 }}>Channel</th>
                <th style={{ width: 70 }}>Type</th>
                <th>Title</th>
                <th style={{ width: 130 }}>Status</th>
                <th style={{ width: 60 }}>Links</th>
              </tr>
            </thead>
            <tbody>
              {list.map((it) => (
                <tr key={it.id}>
                  <td>{fmtTime(it.scheduledPublishAt)}</td>
                  <td><span className="badge gray">{it.channel.slug}</span></td>
                  <td>{it.type}{it.format ? ` · ${it.format}` : ''}</td>
                  <td>
                    <a href={`/items/${it.id}`} style={{ fontWeight: 500 }}>{it.title || it.expectedFilename}</a>
                    <div className="muted" style={{ fontSize: 12 }}><code>{it.expectedFilename}</code></div>
                  </td>
                  <td><span className={`badge ${statusColor(it.status)}`}>{it.status.replace(/_/g, ' ')}</span></td>
                  <td>
                    {it.youtubeUrl && (
                      <a href={it.youtubeUrl} target="_blank" rel="noreferrer" title="YouTube">YT</a>
                    )}
                    {it.youtubeUrl && it.driveFileId && ' · '}
                    {it.driveFileId && (
                      <a href={`https://drive.google.com/file/d/${it.driveFileId}/view`} target="_blank" rel="noreferrer" title="Drive">Drive</a>
                    )}
                    {!it.youtubeUrl && !it.driveFileId && '—'}
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
