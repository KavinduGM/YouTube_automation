import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import ChannelsClient from './ChannelsClient';

interface Channel {
  id: string; slug: string; name: string;
  youtubeChannelId: string | null;
  driveFolderId: string | null;
  defaultSheetId: string | null;
  connected: boolean;
}

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: { connected?: string; oauth_error?: string; channelId?: string };
}) {
  const me = await getMe();
  if (!me?.user) redirect('/login');

  const data = await apiGet<{ channels: Channel[]; driveSheets: { email: string } | null }>('/channels');
  return (
    <>
      <h1>Channels & connections</h1>
      {searchParams.connected && (
        <div className="card" style={{ background: '#ecfdf5' }}>
          ✓ Connected: {searchParams.connected}
          {searchParams.channelId ? ` (channel ${searchParams.channelId})` : ''}
        </div>
      )}
      {searchParams.oauth_error && (
        <div className="card" style={{ background: '#fef2f2' }}>
          OAuth error: {searchParams.oauth_error}
        </div>
      )}
      <ChannelsClient initial={data} />
    </>
  );
}
