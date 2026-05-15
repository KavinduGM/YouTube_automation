import { prisma, logger } from '@yt/shared';
import { moveFile } from '@yt/shared/google/drive';

// Move the item's video + thumbnail to the channel's published folder
// (if configured). Best-effort: failures are logged warnings, not errors.
// Idempotent — calling repeatedly is safe; files already in target are skipped.
export async function moveToPublishedFolder(itemId: string): Promise<void> {
  const item = await prisma.contentItem.findUnique({
    where: { id: itemId },
    include: { channel: true },
  });
  if (!item) return;
  const target = item.channel.publishedFolderId;
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
