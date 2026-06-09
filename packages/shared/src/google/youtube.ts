import { google } from 'googleapis';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { clientForChannel } from './auth.js';

export interface UploadOptions {
  channelId: string;            // our DB channel id
  videoFilePath: string;
  thumbnailFilePath?: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;           // e.g. "27" Education
  defaultLanguage: string;      // e.g. "en-US"
  recordingCountry?: string;    // ISO 3166-1 alpha-2, e.g. "US"
  madeForKids: boolean;
  publishAt: Date;
  isShort: boolean;
}

export interface UploadResult {
  videoId: string;
  url: string;
  /**
   * Set if the video upload succeeded but setting the custom thumbnail
   * failed (typically because the channel isn't verified). The video
   * itself is fine; YouTube uses an auto-generated thumbnail.
   */
  thumbnailError?: string;
}

// Upload a video to YouTube and schedule it. Uses resumable upload.
// Sets privacyStatus = 'private' with publishAt; YouTube flips it public at the time.
export async function uploadAndSchedule(opts: UploadOptions): Promise<UploadResult> {
  const auth = await clientForChannel(opts.channelId);
  const yt = google.youtube({ version: 'v3', auth });

  const fileStat = await stat(opts.videoFilePath);

  let description = opts.description;
  if (opts.isShort && !/#shorts/i.test(description)) {
    description = `${description.trimEnd()}\n\n#Shorts`;
  }

  const insertRes = await yt.videos.insert({
    part: ['snippet', 'status', 'recordingDetails'],
    notifySubscribers: true,
    requestBody: {
      snippet: {
        title: opts.title.slice(0, 100),
        description,
        tags: opts.tags,
        categoryId: opts.categoryId,
        defaultLanguage: opts.defaultLanguage,
        defaultAudioLanguage: opts.defaultLanguage,
      },
      status: {
        privacyStatus: 'private',
        publishAt: opts.publishAt.toISOString(),
        selfDeclaredMadeForKids: opts.madeForKids,
      },
      recordingDetails: opts.recordingCountry
        ? { locationDescription: opts.recordingCountry }
        : undefined,
    },
    media: {
      mimeType: mimeForExt(opts.videoFilePath),
      body: createReadStream(opts.videoFilePath),
    },
  });

  const videoId = insertRes.data.id;
  if (!videoId) throw new Error('YouTube upload returned no video id');

  let thumbnailError: string | undefined;
  if (opts.thumbnailFilePath) {
    try {
      await yt.thumbnails.set({
        videoId,
        media: {
          mimeType: mimeForExt(opts.thumbnailFilePath),
          body: createReadStream(opts.thumbnailFilePath),
        },
      });
    } catch (err) {
      // Video is already uploaded; don't lose it by throwing. Caller
      // records the warning and the operator can fix it manually.
      thumbnailError = (err as Error).message ?? String(err);
    }
  }

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailError,
  };

  void fileStat; // kept for future progress reporting
}

function mimeForExt(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'mp4': return 'video/mp4';
    case 'mov': return 'video/quicktime';
    case 'm4v': return 'video/x-m4v';
    case 'webm': return 'video/webm';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    default: return 'application/octet-stream';
  }
}

// Fetch the current status of a previously uploaded video. Used to confirm "published".
export async function getVideoStatus(channelId: string, videoId: string): Promise<{
  privacyStatus: string;
  publishAt?: string;
} | null> {
  const auth = await clientForChannel(channelId);
  const yt = google.youtube({ version: 'v3', auth });
  const res = await yt.videos.list({ part: ['status'], id: [videoId] });
  const v = res.data.items?.[0];
  if (!v?.status) return null;
  return {
    privacyStatus: v.status.privacyStatus ?? 'unknown',
    publishAt: v.status.publishAt ?? undefined,
  };
}

// Set (or replace) the custom thumbnail on a video that's already uploaded.
// Use for the case where the thumbnail file appears in Drive AFTER the
// video was already pushed to YouTube.
export async function setThumbnail(opts: {
  channelId: string;
  videoId: string;
  thumbnailFilePath: string;
}): Promise<void> {
  const auth = await clientForChannel(opts.channelId);
  const yt = google.youtube({ version: 'v3', auth });
  await yt.thumbnails.set({
    videoId: opts.videoId,
    media: {
      mimeType: mimeForExt(opts.thumbnailFilePath),
      body: createReadStream(opts.thumbnailFilePath),
    },
  });
}

// ─────── Playlists ───────

export interface YouTubePlaylist {
  id: string;
  title: string;
  itemCount: number;
  privacyStatus: string;
}

// List all playlists owned by the authenticated channel.
export async function listPlaylists(channelId: string): Promise<YouTubePlaylist[]> {
  const auth = await clientForChannel(channelId);
  const yt = google.youtube({ version: 'v3', auth });
  const out: YouTubePlaylist[] = [];
  let pageToken: string | undefined;
  do {
    const res: { data: { items?: Array<{ id?: string | null; snippet?: { title?: string | null }; contentDetails?: { itemCount?: number | null }; status?: { privacyStatus?: string | null } }>; nextPageToken?: string | null } } =
      await yt.playlists.list({
        part: ['snippet', 'contentDetails', 'status'],
        mine: true,
        maxResults: 50,
        pageToken,
      });
    for (const p of res.data.items ?? []) {
      if (!p.id) continue;
      out.push({
        id: p.id,
        title: p.snippet?.title ?? '(untitled)',
        itemCount: p.contentDetails?.itemCount ?? 0,
        privacyStatus: p.status?.privacyStatus ?? 'unknown',
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

// Create a new playlist on the authenticated channel.
export async function createPlaylist(opts: {
  channelId: string;
  title: string;
  description?: string;
  privacyStatus?: 'public' | 'private' | 'unlisted';
}): Promise<YouTubePlaylist> {
  const auth = await clientForChannel(opts.channelId);
  const yt = google.youtube({ version: 'v3', auth });
  const res = await yt.playlists.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: { title: opts.title, description: opts.description },
      status: { privacyStatus: opts.privacyStatus ?? 'public' },
    },
  });
  const p = res.data;
  if (!p.id) throw new Error('YouTube did not return a playlist id');
  return {
    id: p.id,
    title: p.snippet?.title ?? opts.title,
    itemCount: 0,
    privacyStatus: p.status?.privacyStatus ?? (opts.privacyStatus ?? 'public'),
  };
}

// Append a video to a playlist. Idempotent: if the video is already in
// the playlist, YouTube returns success (with the same playlistItemId).
export async function addVideoToPlaylist(opts: {
  channelId: string;
  playlistId: string;
  videoId: string;
}): Promise<void> {
  const auth = await clientForChannel(opts.channelId);
  const yt = google.youtube({ version: 'v3', auth });
  await yt.playlistItems.insert({
    part: ['snippet'],
    requestBody: {
      snippet: {
        playlistId: opts.playlistId,
        resourceId: { kind: 'youtube#video', videoId: opts.videoId },
      },
    },
  });
}

// Delete a video from YouTube. Works for scheduled (private) and live videos.
// Returns true if deleted, false if YouTube reports it doesn't exist (already gone).
export async function deleteVideo(channelId: string, videoId: string): Promise<boolean> {
  const auth = await clientForChannel(channelId);
  const yt = google.youtube({ version: 'v3', auth });
  try {
    await yt.videos.delete({ id: videoId });
    return true;
  } catch (err) {
    const e = err as { code?: number; errors?: Array<{ reason?: string }> };
    // 404 / videoNotFound — already deleted, treat as success
    if (e.code === 404 || e.errors?.some((x) => x.reason === 'videoNotFound')) {
      return false;
    }
    throw err;
  }
}
