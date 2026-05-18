import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import MonthsClient from './MonthsClient';

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

export default async function ChannelMonthsPage() {
  const me = await getMe();
  if (!me?.user) redirect('/login');
  if (me.user.role !== 'admin') redirect('/');
  const [{ channels }, { months }] = await Promise.all([
    apiGet<{ channels: Channel[] }>('/channels'),
    apiGet<{ months: ChannelMonth[] }>('/channel-months'),
  ]);
  return (
    <>
      <h1>Monthly folders</h1>
      <p className="muted">Each channel × month gets its own Drive folders + sheet. Raw uploads in a month's folder consume slots from that month only.</p>
      <MonthsClient channels={channels} initialMonths={months} />
    </>
  );
}
