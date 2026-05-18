import { prisma, logger } from '@yt/shared';
import { moveFile } from '@yt/shared/google/drive';

// After the final video has been uploaded to YouTube, move the editor's
// raw video (and any attached doc files) into the channel's raw archive
// folder so the working folder stays clean.
//
// Uses the per-month rawArchiveFolderId if configured for the item's
// scheduled month, falling back to the channel-level field. No-op if
// neither is set.
//
// Idempotent (moveFile already skips if file is in the target).
export async function moveRawToArchive(contentItemId: string): Promise<void> {
  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: { channel: { include: { months: true } } },
  });
  if (!item) return;
  const target = pickArchiveFolder(item);
  if (!target) return;

  const task = await prisma.editorTask.findFirst({
    where: { contentItemId },
    include: { docs: true },
  });
  if (!task) return;

  const moved: string[] = [];
  try {
    const r = await moveFile(task.rawDriveFileId, target);
    if (r.moved) moved.push(`raw:${task.rawDriveFileId}`);
  } catch (err) {
    logger.warn({ err, fileId: task.rawDriveFileId, itemId: contentItemId }, 'move raw video failed');
  }
  for (const d of task.docs) {
    try {
      const r = await moveFile(d.driveFileId, target);
      if (r.moved) moved.push(`doc:${d.driveFileId}`);
    } catch (err) {
      logger.warn({ err, fileId: d.driveFileId, itemId: contentItemId }, 'move doc failed');
    }
  }
  if (moved.length > 0) {
    await prisma.contentEvent.create({
      data: {
        contentItemId,
        type: 'raw_archived',
        message: `Moved raw + docs to archive folder: ${moved.join(', ')}`,
        meta: { folderId: target },
      },
    });
  }
}

function pickArchiveFolder(item: {
  scheduledPublishAt: Date;
  channel: { rawArchiveFolderId: string | null; months: { month: string; rawArchiveFolderId: string | null }[] };
}): string | null {
  const monthKey = `${item.scheduledPublishAt.getUTCFullYear()}-${String(item.scheduledPublishAt.getUTCMonth() + 1).padStart(2, '0')}`;
  const cm = item.channel.months.find((m) => m.month === monthKey);
  return cm?.rawArchiveFolderId ?? item.channel.rawArchiveFolderId ?? null;
}
