import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import { fmtDateTime, statusBadge } from '@/lib/format';
import AutoRefresh from '@/components/AutoRefresh';

interface Stats {
  counts: {
    pendingApproval: number;
    planned: number;
    approved: number;
    scheduling: number;
    scheduled: number;
    publishedThisMonth: number;
    failed: number;
    rejected: number;
    tasksPending: number;
    tasksOngoing: number;
    tasksInReview: number;
    tasksRevision: number;
    channelsTotal: number;
  };
  recentEvents: Array<{
    id: string;
    type: string;
    message: string | null;
    actorEmail: string | null;
    createdAt: string;
    item: { id: string; title: string; filename: string; channel: string; channelSlug: string } | null;
  }>;
  recentTasks: Array<{
    id: string;
    rawFilename: string;
    status: string;
    channel: string;
    channelSlug: string;
    expectedFilename: string | null;
    scheduledPublishAt: string | null;
    createdAt: string;
  }>;
  upcomingItems: Array<{
    id: string;
    title: string;
    filename: string;
    status: string;
    type: string;
    format: string | null;
    scheduledPublishAt: string;
    channel: string;
    channelSlug: string;
  }>;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', ongoing: 'Ongoing', submitted: 'In Review',
  revision_requested: 'Needs revision', completed: 'Completed', canceled: 'Canceled',
};

export default async function DashboardPage() {
  const me = await getMe();
  if (!me?.user) redirect('/login');
  const isAdmin = me.user.role === 'admin';
  const stats = await apiGet<Stats>('/stats/overview');

  return (
    <>
      <AutoRefresh intervalSeconds={30} />
      <h1>Overview</h1>
      <p className="muted">Live snapshot of everything happening across your channels.</p>

      <div className="stat-grid">
        <StatCard label="Pending approval" value={stats.counts.pendingApproval} flavor={stats.counts.pendingApproval > 0 ? 'primary' : undefined} href="/inbox" />
        <StatCard label="Scheduled" value={stats.counts.scheduled} flavor="ok" href="/items?status=scheduled" />
        <StatCard label="Published this month" value={stats.counts.publishedThisMonth} flavor="ok" href="/items?status=published" />
        <StatCard label="Failed" value={stats.counts.failed} flavor={stats.counts.failed > 0 ? 'danger' : undefined} href="/items?status=failed" />
        {isAdmin && <StatCard label="Editor: pending" value={stats.counts.tasksPending} flavor={stats.counts.tasksPending > 0 ? 'primary' : undefined} href="/tasks?status=pending" />}
        {isAdmin && <StatCard label="Editor: ongoing" value={stats.counts.tasksOngoing} flavor="warn" href="/tasks?status=ongoing" />}
        {isAdmin && <StatCard label="Editor: in review" value={stats.counts.tasksInReview} flavor={stats.counts.tasksInReview > 0 ? 'primary' : undefined} href="/tasks?status=submitted" />}
        {isAdmin && <StatCard label="Revision needed" value={stats.counts.tasksRevision} flavor={stats.counts.tasksRevision > 0 ? 'danger' : undefined} href="/tasks?status=revision_requested" />}
        {isAdmin && <StatCard label="Planned (waiting raw)" value={stats.counts.planned} href="/items?status=planned" />}
        {isAdmin && <StatCard label="Channels" value={stats.counts.channelsTotal} href="/channels" />}
      </div>

      <h2>Upcoming publishes</h2>
      {stats.upcomingItems.length === 0 ? (
        <div className="card"><p className="muted">Nothing in the upcoming queue.</p></div>
      ) : (
        <div className="feed">
          {stats.upcomingItems.map((i) => (
            <div key={i.id} className="feed-row">
              <div className="when">{fmtDateTime(i.scheduledPublishAt)}</div>
              <div className="body">
                <span className="badge gray">{i.channelSlug}</span>{' '}
                <span className="badge blue">{i.type}{i.format ? `·${i.format}` : ''}</span>{' '}
                <Link href={`/items/${i.id}`}>{i.title || i.filename}</Link>{' '}
                <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: 11 }} className={statusBadge(i.status)}>{i.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2>Recent activity</h2>
      {stats.recentEvents.length === 0 ? (
        <div className="card"><p className="muted">No events yet.</p></div>
      ) : (
        <div className="feed">
          {stats.recentEvents.map((e) => (
            <div key={e.id} className="feed-row">
              <div className="when">{fmtDateTime(e.createdAt)}</div>
              <div className="body">
                <b>{e.type}</b>{e.actorEmail ? ` by ${e.actorEmail}` : ''}{' '}
                {e.item && <>· <Link href={`/items/${e.item.id}`}>{e.item.title || e.item.filename}</Link></>}
                {e.message && <div className="muted" style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>{e.message}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && stats.recentTasks.length > 0 && (
        <>
          <h2>Active editor tasks</h2>
          <div className="feed">
            {stats.recentTasks.map((t) => (
              <div key={t.id} className="feed-row">
                <div className="when">{fmtDateTime(t.createdAt)}</div>
                <div className="body">
                  <span className="badge gray">{t.channelSlug}</span>{' '}
                  <span className={`badge ${t.status === 'submitted' ? 'blue' : t.status === 'revision_requested' ? 'red' : t.status === 'ongoing' ? 'yellow' : 'gray'}`}>
                    {STATUS_LABEL[t.status] ?? t.status}
                  </span>{' '}
                  <Link href={`/tasks?status=${t.status}`}><code>{t.rawFilename}</code></Link>
                  {t.expectedFilename && <div className="muted" style={{ marginTop: 2 }}>→ <code>{t.expectedFilename}</code></div>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function StatCard({ label, value, flavor, href }: {
  label: string;
  value: number;
  flavor?: 'primary' | 'ok' | 'danger' | 'warn';
  href?: string;
}) {
  return (
    <div className={`stat-card${flavor ? ` ${flavor}` : ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {href && <Link href={href}>View →</Link>}
    </div>
  );
}
