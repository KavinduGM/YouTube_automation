import { prisma, logger } from '@yt/shared';
import { moveFile } from '@yt/shared/google/drive';

// Move the item's video + thumbnail to the published folder. Uses the
// ChannelMonth for the item's scheduledPublishAt month if one is
// configured, falling back to the channel-level publishedFolderId.
export async function moveToPublishedFolder(itemId: string): Promise<void> {
  const item = await prisma.contentItem.findUnique({
    where: { id: itemId },
    include: { channel: { include: { months: true } } },
  });
  if (!item) return;

  const target = pickPublishedFolder(item);
  if (!target) return;

  const moved: string[] = [];
  if (item.driveFileId) {
    try {
      const r = await moveFile(item.driveFileId, target);
      if (r.moved) moved.push(`video:${item.driveFileId}`);
    } catch (err) {
      logger.warn({ err, fileId: item.driveFileId, itemId }, 'move video failed');
    }
  }
  if (item.driveThumbId) {
    try {
      const r = await moveFile(item.driveThumbId, target);
      if (r.moved) moved.push(`thumb:${item.driveThumbId}`);
    } catch (err) {
      logger.warn({ err, fileId: item.driveThumbId, itemId }, 'move thumbnail failed');
    }
  }
  if (moved.length > 0) {
    await prisma.contentEvent.create({
      data: {
        contentItemId: itemId,
        type: 'moved',
        message: `Moved to published folder: ${moved.join(', ')}`,
        meta: { folderId: target },
      },
    });
  }
}

function pickPublishedFolder(item: {
  scheduledPublishAt: Date;
  channel: { publishedFolderId: string | null; months: { month: string; publishedFolderId: string | null }[] };
}): string | null {
  const monthKey = monthString(item.scheduledPublishAt);
  const cm = item.channel.months.find((m) => m.month === monthKey);
  return cm?.publishedFolderId ?? item.channel.publishedFolderId ?? null;
}

function monthString(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
