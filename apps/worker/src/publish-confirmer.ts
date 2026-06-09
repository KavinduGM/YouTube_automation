import { prisma, logger } from '@yt/shared';
import { getVideoStatus } from '@yt/shared/google/youtube';
import { moveToPublishedFolder } from './move-to-published.js';
import { moveRawToArchive } from './move-raw-to-archive.js';

// Confirms that 'scheduled' items have actually flipped to public/published on YouTube.
// Runs every 10 minutes; only checks items whose scheduledPublishAt is in the past.

export async function runPublishConfirmerOnce(): Promise<void> {
  const now = new Date();
  const candidates = await prisma.contentItem.findMany({
    where: {
      status: 'scheduled',
      scheduledPublishAt: { lt: now },
      youtubeVideoId: { not: null },
    },
    include: { approvedBy: true },
    take: 25,
  });

  for (const item of candidates) {
    if (!item.youtubeVideoId) continue;
    try {
      const s = await getVideoStatus(item.channelId, item.youtubeVideoId);
      if (!s) continue;
      if (s.privacyStatus === 'public' || s.privacyStatus === 'unlisted') {
        await prisma.contentItem.update({
          where: { id: item.id },
          data: { status: 'published' },
        });
        await prisma.contentEvent.create({
          data: {
            contentItemId: item.id,
            type: 'published',
            message: `confirmed live (${s.privacyStatus})`,
          },
        });

        // Move to published folder (idempotent — runs even if scheduler
        // already tried but failed, e.g. before Drive scope was upgraded).
        await moveToPublishedFolder(item.id).catch(() => {});
        // Also retry the raw archive move.
        await moveRawToArchive(item.id).catch(() => {});
      }
    } catch (err) {
      logger.warn({ err, itemId: item.id }, 'publish-confirmer: check failed');
    }
  }

  // Retroactive move: for items already `published` that still have a
  // driveFileId in the working folder (e.g. uploaded before the
  // publishedFolderId was set, or before Drive scope was upgraded),
  // attempt the move again. moveFile is idempotent so this is safe.
  const orphans = await prisma.contentItem.findMany({
    where: {
      status: 'published',
      driveFileId: { not: null },
      channel: { publishedFolderId: { not: null } },
    },
    take: 25,
  });
  for (const o of orphans) {
    await moveToPublishedFolder(o.id).catch(() => {});
    await moveRawToArchive(o.id).catch(() => {});
  }
}
