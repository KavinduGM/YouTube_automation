import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import ScheduleClient from './ScheduleClient';

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

function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: { channelId?: string; month?: string };
}) {
  const me = await getMe();
  if (!me?.user) redirect('/login');
  if (me.user.role !== 'admin') redirect('/');
  const { channels } = await apiGet<{ channels: Channel[] }>('/channels');
  const month = searchParams.month ?? thisMonth();
  const channelId = searchParams.channelId ?? channels[0]?.id;
  let slots: Slot[] = [];
  if (channelId) {
    const data = await apiGet<{ slots: Slot[] }>(`/slots?channelId=${channelId}&month=${month}`);
    slots = data.slots;
  }
  return (
    <>
      <h1>Schedule</h1>
      <p className="muted">Pre-fill publishing slots. As raw videos arrive, the next matching-format slot in the right month is consumed.</p>
      <ScheduleClient channels={channels} initialSlots={slots} channelId={channelId} month={month} />
    </>
  );
}
