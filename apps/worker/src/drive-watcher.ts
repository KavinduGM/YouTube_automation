import {
  prisma,
  logger,
  env,
  parseFilename,
  isVideo,
  isImage,
  sendEmail,
  pendingApprovalEmail,
} from '@yt/shared';
import { walkFolder } from '@yt/shared/google/drive';

// Walks each channel's Drive folder, finds files matching the naming convention,
// pairs videos with thumbnails, and matches them to ContentItems.
//
// Behavior:
//  - If a video file's basename matches an item's expectedFilename's basename → attach.
//  - If item is in `planned` → move to `uploaded`, then `pending_approval`, send email.
//  - If item is already in a later status, just keep the driveFileId fresh.
//  - If a file is found that does NOT match any item, log a warning (does NOT auto-create).

export async function runDriveWatcherOnce(): Promise<void> {
  const channels = await prisma.channel.findMany({
    where: { driveFolderId: { not: null } },
  });
  if (channels.length === 0) {
    logger.debug('drive-watcher: no channels with driveFolderId configured');
    return;
  }

  for (const ch of channels) {
    if (!ch.driveFolderId) continue;
    try {
      await processChannelFolder(ch.id, ch.driveFolderId);
    } catch (err) {
      logger.error({ err, channel: ch.slug }, 'drive-watcher: channel failed');
    }
  }
}

async function processChannelFolder(channelId: string, folderId: string): Promise<void> {
  const files = await walkFolder(folderId);

  // Group by base name (without extension) so we can pair video + thumbnail.
  type Pair = { video?: { id: string; name: string; ext: string }; thumb?: { id: string; name: string; ext: string } };
  const byBase = new Map<string, Pair>();

  for (const f of files) {
    const parsed = parseFilename(f.name);
    if (!parsed) continue;
    const slot = byBase.get(parsed.baseName) ?? {};
    if (isVideo(parsed.ext)) slot.video = { id: f.id, name: f.name, ext: parsed.ext };
    else if (isImage(parsed.ext)) slot.thumb = { id: f.id, name: f.name, ext: parsed.ext };
    byBase.set(parsed.baseName, slot);
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
