import { redirect } from 'next/navigation';
import { apiGet, getMe } from '@/lib/api';
import ChannelsClient from './ChannelsClient';

interface Channel {
  id: string; slug: string; name: string;
  filenamePrefix: string | null;
  hasQuestionVideos: boolean;
  hasAnimationVideos: boolean;
  hasShortVideos: boolean;
  youtubeChannelId: string | null;
  driveFolderId: string | null;
  publishedFolderId: string | null;
  rawArchiveFolderId: string | null;
  defaultSheetId: string | null;
  connected: boolean;
}

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: { connected?: string; oauth_error?: string };
}) {
  const me = await getMe();
  if (!me?.user) redirect('/login');
  if (me.user.role !== 'admin') redirect('/');
  const data = await apiGet<{ channels: Channel[]; driveSheets: { email: string } | null }>('/channels');
  return (
    <>
      <h1>Channels</h1>
      <p className="muted">Create channels, set their filename prefix, and connect each to its YouTube account.</p>
      {searchParams.connected && (
        <div className="alert ok">Connected: {searchParams.connected}</div>
      )}
      {searchParams.oauth_error && (
        <div className="alert error">OAuth error: {searchParams.oauth_error}</div>
      )}
      <ChannelsClient initial={data} />
    </>
  );
}
