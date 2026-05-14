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
  defaultLanguage: string;      // e.g. "en"
  madeForKids: boolean;
  publishAt: Date;              // scheduled publish time (UTC)
  isShort: boolean;             // adds #Shorts to description if not present
}

export interface UploadResult {
  videoId: string;
  url: string;
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
    part: ['snippet', 'status'],
    notifySubscribers: true,
    requestBody: {
      snippet: {
        title: opts.title.slice(0, 100), // YouTube hard cap
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
    },
    media: {
      mimeType: mimeForExt(opts.videoFilePath),
      body: createReadStream(opts.videoFilePath),
    },
  });

  const videoId = insertRes.data.id;
  if (!videoId) throw new Error('YouTube upload returned no video id');

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
      // Don't fail the whole upload for a thumbnail problem; surface for ops.
      throw new Error(
        `Video uploaded as ${videoId} but thumbnail failed: ${(err as Error).message}`,
      );
    }
  }

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
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
