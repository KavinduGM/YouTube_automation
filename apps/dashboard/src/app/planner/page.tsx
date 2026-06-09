import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import PlannerClient from './PlannerClient';
import AutoRefresh from '@/components/AutoRefresh';

interface Channel { id: string; slug: string; name: string }

export interface PlannerItem {
  id: string;
  title: string;
  type: 'long' | 'short' | 'post';
  format: 'question' | 'animation' | null;
  status: string;
  expectedFilename: string;
  scheduledPublishAt: string;
  youtubeUrl: string | null;
  driveFileId: string | null;
  channel: { id: string; slug: string; name: string };
}

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default async function PlannerPage({
  searchParams,
}: {
  searchParams: { month?: string; channelId?: string; status?: string };
}) {
  const me = await getMe();
  if (!me?.user) redirect('/login');
  // Editors don't need the planner — they see "My tasks" instead.
  if (me.user.role === 'editor') redirect('/');

  const month = searchParams.month ?? thisMonth();
  const { channels } = await apiGet<{ channels: Channel[] }>('/channels');

  const params = new URLSearchParams({ month, take: '500' });
  if (searchParams.channelId) params.set('channelId', searchParams.channelId);
  if (searchParams.status) params.set('status', searchParams.status);
  const { items } = await apiGet<{ items: PlannerItem[] }>(`/items?${params.toString()}`);

  return (
    <>
      <AutoRefresh intervalSeconds={60} />
      <h1>Content Planner</h1>
      <p className="muted">
        Every planned video grouped by publish date. Filters apply across all channels.
      </p>
      <PlannerClient
        channels={channels}
        items={items}
        month={month}
        channelId={searchParams.channelId ?? ''}
        statusFilter={searchParams.status ?? ''}
      />
    </>
  );
}
