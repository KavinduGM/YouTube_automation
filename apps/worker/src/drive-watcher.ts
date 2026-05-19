import { join } from 'node:path';
import { mkdir, unlink } from 'node:fs/promises';
import {
  prisma,
  logger,
  env,
  parseFinalFilename,
  isVideo,
  isImage,
  sendEmail,
  pendingApprovalEmail,
} from '@yt/shared';
import { walkFolder, downloadFile } from '@yt/shared/google/drive';
import { setThumbnail } from '@yt/shared/google/youtube';

// Walks each channel's Drive folder, finds files matching the naming convention,
// pairs videos with thumbnails, and matches them to ContentItems.
//
// Behavior:
//  - If a video file's basename matches an item's expectedFilename's basename → attach.
//  - If item is in `planned` → move to `uploaded`, then `pending_approval`, send email.
//  - If item is already in a later status, just keep the driveFileId fresh.
//  - If a file is found that does NOT match any item, log a warning (does NOT auto-create).

export async function runDriveWatcherOnce(): Promise<void> {
  // Walk every (channel × month) folder + any legacy channel-level folder.
  const channels = await prisma.channel.findMany({ include: { months: true } });
  if (channels.length === 0) return;
  for (const ch of channels) {
    const folders: string[] = [];
    for (const m of ch.months) {
      if (m.driveFolderId) folders.push(m.driveFolderId);
    }
    if (ch.driveFolderId) folders.push(ch.driveFolderId);
    for (const folderId of folders) {
      try {
        await processChannelFolder(ch.id, folderId);
      } catch (err) {
        logger.error({ err, channel: ch.slug, folderId }, 'drive-watcher: folder failed');
      }
    }
  }
}

async function processChannelFolder(channelId: string, folderId: string): Promise<void> {
  const files = await walkFolder(folderId);

  // Group by base name (without extension) so we can pair video + thumbnail.
  type Pair = { video?: { id: string; name: string; ext: string }; thumb?: { id: string; name: string; ext: string } };
  const byBase = new Map<string, Pair>();

  for (const f of files) {
    const parsed = parseFinalFilename(f.name);
    if (parsed) {
      const slot = byBase.get(parsed.baseName) ?? {};
      if (isVideo(parsed.ext)) slot.video = { id: f.id, name: f.name, ext: parsed.ext };
      else if (isImage(parsed.ext)) slot.thumb = { id: f.id, name: f.name, ext: parsed.ext };
      byBase.set(parsed.baseName, slot);
      continue;
    }
    // Fallback: thumbnail with a non-conforming base name but same prefix.
    const m = /^(.+)\.([A-Za-z0-9]+)$/.exec(f.name);
    if (!m) continue;
    const [, base, ext] = m;
    if (!base || !ext) continue;
    if (!isImage(ext)) continue;
    const slot = byBase.get(base) ?? {};
    slot.thumb = { id: f.id, name: f.name, ext };
    byBase.set(base, slot);
  }

  for (const [baseName, pair] of byBase) {
    if (!pair.video) continue;

    // Find content item by expectedFilename matching the base name + any video extension.
    const item = await prisma.contentItem.findFirst({
      where: {
        channelId,
        expectedFilename: { startsWith: baseName + '.' },
      },
    });

    if (!item) {
      logger.warn({ baseName, fileId: pair.video.id }, 'drive-watcher: no matching ContentItem');
      continue;
    }

    const updateData: {
      driveFileId: string;
      driveThumbId?: string;
      uploadedAt?: Date;
      status?: 'uploaded' | 'pending_approval';
    } = {
      driveFileId: pair.video.id,
    };
    if (pair.thumb) updateData.driveThumbId = pair.thumb.id;

    const shouldNotify = item.status === 'planned';
    if (shouldNotify) {
      updateData.status = 'pending_approval';
      updateData.uploadedAt = new Date();
    }

    // Detect a NEW thumbnail arriving for an item already on YouTube.
    const newThumbForExisting =
      pair.thumb &&
      item.youtubeVideoId &&
      item.driveThumbId !== pair.thumb.id &&
      ['scheduled', 'published'].includes(item.status);

    const updated = await prisma.contentItem.update({
      where: { id: item.id },
      data: updateData,
    });

    if (shouldNotify) {
      await prisma.contentEvent.create({
        data: {
          contentItemId: item.id,
          type: 'matched',
          message: `Drive file matched: ${pair.video.name}`,
          meta: { driveFileId: pair.video.id, driveThumbId: pair.thumb?.id ?? null },
        },
      });
      await notifyApprovers(updated.id).catch((err) =>
        logger.error({ err, itemId: updated.id }, 'failed to send pending approval email'),
      );
    }

    // Push the thumbnail to YouTube post-upload, if newly arrived.
    if (newThumbForExisting && pair.thumb) {
      await pushThumbnailToYouTube(item.id, item.channelId, item.youtubeVideoId!, pair.thumb.id, pair.thumb.ext)
        .catch((err) => logger.error({ err, itemId: item.id }, 'late thumbnail upload failed'));
    }
  }
}

async function pushThumbnailToYouTube(
  itemId: string,
  channelId: string,
  youtubeVideoId: string,
  thumbDriveFileId: string,
  ext: string,
): Promise<void> {
  const e = env();
  await mkdir(e.TMP_DIR, { recursive: true });
  const localPath = join(e.TMP_DIR, `${itemId}-late-thumb.${ext}`);
  try {
    await downloadFile(thumbDriveFileId, localPath);
    await setThumbnail({ channelId, videoId: youtubeVideoId, thumbnailFilePath: localPath });
    await prisma.contentItem.update({
      where: { id: itemId },
      data: { lastError: null }, // clear any previous "thumbnail failed" note
    });
    await prisma.contentEvent.create({
      data: {
        contentItemId: itemId,
        type: 'thumbnail_set',
        message: `Custom thumbnail pushed to YouTube post-upload`,
        meta: { videoId: youtubeVideoId, driveFileId: thumbDriveFileId },
      },
    });
    logger.info({ itemId, youtubeVideoId }, 'late thumbnail set on YouTube');
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    await prisma.contentItem.update({
      where: { id: itemId },
      data: { lastError: `Thumbnail upload failed (post-publish): ${msg}` },
    }).catch(() => {});
    throw err;
  } finally {
    await unlink(localPath).catch(() => {});
  }
}

async function notifyApprovers(itemId: string): Promise<void> {
  const e = env();
  const item = await prisma.contentItem.findUnique({
    where: { id: itemId },
    include: { channel: true },
  });
  if (!item) return;

  const approvers = e.ALLOWED_APPROVER_EMAILS;
  if (approvers.length === 0) return;

  const reviewUrl = `${e.DASHBOARD_URL}/items/${item.id}`;
  const scheduledAt = new Intl.DateTimeFormat('en-US', {
    timeZone: e.TZ,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(item.scheduledPublishAt);

  const msg = pendingApprovalEmail({
    channel: item.channel.name,
    title: item.title,
    type: item.type,
    scheduledAt: `${scheduledAt} (${e.TZ})`,
    filename: item.expectedFilename,
    reviewUrl,
  });

  await sendEmail({ to: approvers, ...msg });
}
