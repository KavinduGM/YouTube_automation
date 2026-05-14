import { join } from 'node:path';
import { mkdir, unlink } from 'node:fs/promises';
import {
  prisma,
  logger,
  env,
  sendEmail,
  failureEmail,
} from '@yt/shared';
import { downloadFile } from '@yt/shared/google/drive';
import { uploadAndSchedule } from '@yt/shared/google/youtube';
import { writeStatusToSheet } from '@yt/shared/google/sheets';

const MAX_ATTEMPTS = 3;

// Picks up content items that have been approved and uploads them to YouTube.
// Strategy:
//   - Take items with status='approved'.
//   - Lock by transitioning to 'scheduling' first (optimistic).
//   - Download from Drive → upload to YouTube with publishAt → write back.
//   - On failure: increment attempts, set 'failed' if max reached, alert email.
//
// Safety: scheduledPublishAt must be in the future. YouTube rejects past timestamps;
// we add a small buffer (5 min minimum). If the scheduled time has already passed,
// we still upload but with privacyStatus='public' and no publishAt (publishes immediately).

export async function runSchedulerOnce(): Promise<void> {
  const candidates = await prisma.contentItem.findMany({
    where: {
      status: 'approved',
      driveFileId: { not: null },
      attempts: { lt: MAX_ATTEMPTS },
    },
    take: 5,
    orderBy: { scheduledPublishAt: 'asc' },
  });

  for (const item of candidates) {
    await processItem(item.id).catch((err) =>
      logger.error({ err, itemId: item.id }, 'scheduler: item failed'),
    );
  }
}

async function processItem(itemId: string): Promise<void> {
  // Atomic lock: only succeed if still 'approved'.
  const lockResult = await prisma.contentItem.updateMany({
    where: { id: itemId, status: 'approved' },
    data: { status: 'scheduling', attempts: { increment: 1 } },
  });
  if (lockResult.count === 0) {
    logger.debug({ itemId }, 'scheduler: item no longer approved, skipping');
    return;
  }

  const item = await prisma.contentItem.findUnique({
    where: { id: itemId },
    include: { channel: true, approvedBy: true },
  });
  if (!item) return;
  if (!item.driveFileId) {
    await markFailed(itemId, 'No driveFileId on item');
    return;
  }

  const e = env();
  await mkdir(e.TMP_DIR, { recursive: true });
  const ext = item.expectedFilename.split('.').pop() ?? 'mp4';
  const localVideo = join(e.TMP_DIR, `${item.id}.${ext}`);
  const localThumb = item.driveThumbId ? join(e.TMP_DIR, `${item.id}.thumb`) : undefined;

  try {
    await downloadFile(item.driveFileId, localVideo);
    if (item.driveThumbId && localThumb) await downloadFile(item.driveThumbId, localThumb);

    // Compute effective publishAt (must be ≥ now + 5 min, else publish immediately)
    const now = Date.now();
    const minFuture = now + 5 * 60 * 1000;
    const effectivePublishAt =
      item.scheduledPublishAt.getTime() > minFuture ? item.scheduledPublishAt : null;

    let videoId: string;
    let url: string;
    if (effectivePublishAt) {
      const result = await uploadAndSchedule({
        channelId: item.channelId,
        videoFilePath: localVideo,
        thumbnailFilePath: localThumb,
        title: item.title,
        description: item.description,
        tags: item.tags,
        categoryId: item.categoryId,
        defaultLanguage: item.defaultLanguage,
        madeForKids: item.madeForKids,
        publishAt: effectivePublishAt,
        isShort: item.type === 'short',
      });
      videoId = result.videoId;
      url = result.url;
    } else {
      // Publish immediately (scheduled time has passed)
      logger.warn({ itemId }, 'scheduled time has passed; publishing immediately');
      const result = await uploadImmediate({
        channelId: item.channelId,
        videoFilePath: localVideo,
        thumbnailFilePath: localThumb,
        title: item.title,
        description: item.description,
        tags: item.tags,
        categoryId: item.categoryId,
        defaultLanguage: item.defaultLanguage,
        madeForKids: item.madeForKids,
        isShort: item.type === 'short',
      });
      videoId = result.videoId;
      url = result.url;
    }

    await prisma.contentItem.update({
      where: { id: item.id },
      data: {
        status: effectivePublishAt ? 'scheduled' : 'published',
        youtubeVideoId: videoId,
        youtubeUrl: url,
        lastError: null,
      },
    });
    await prisma.contentEvent.create({
      data: {
        contentItemId: item.id,
        type: effectivePublishAt ? 'scheduled' : 'published',
        message: `YouTube videoId=${videoId}`,
        meta: { url, publishAt: effectivePublishAt?.toISOString() ?? null },
      },
    });

    // Sheet write-back (best effort)
    if (item.sheetId) {
      try {
        await writeStatusToSheet({
          spreadsheetId: item.sheetId,
          tab: item.sheetTab ?? undefined,
          matchByFilename: item.expectedFilename,
          status: effectivePublishAt ? 'scheduled' : 'published',
          youtubeUrl: url,
          youtubeId: videoId,
          scheduledAt: effectivePublishAt?.toISOString(),
          approvedBy: item.approvedBy?.email ?? undefined,
        });
      } catch (err) {
        logger.warn({ err, itemId: item.id }, 'sheet write-back failed (non-fatal)');
      }
    }
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    const willRetry = (item.attempts ?? 0) + 0 < MAX_ATTEMPTS - 1;
    // Note: attempts was already incremented at lock time, so item.attempts is stale here.
    const fresh = await prisma.contentItem.findUnique({ where: { id: itemId } });
    const attempts = fresh?.attempts ?? 0;
    if (attempts >= MAX_ATTEMPTS) {
      await markFailed(itemId, msg);
    } else {
      // back to 'approved' to retry next loop
      await prisma.contentItem.update({
        where: { id: itemId },
        data: { status: 'approved', lastError: msg },
      });
      await prisma.contentEvent.create({
        data: { contentItemId: itemId, type: 'failed', message: `attempt ${attempts}: ${msg}` },
      });
      logger.warn({ itemId, attempts, msg }, 'scheduler: will retry');
    }
    void willRetry;
  } finally {
    await unlink(localVideo).catch(() => {});
    if (localThumb) await unlink(localThumb).catch(() => {});
  }
}

async function markFailed(itemId: string, msg: string): Promise<void> {
  const item = await prisma.contentItem.update({
    where: { id: itemId },
    data: { status: 'failed', lastError: msg },
    include: { channel: true },
  });
  await prisma.contentEvent.create({
    data: { contentItemId: itemId, type: 'failed', message: msg },
  });
  logger.error({ itemId, msg }, 'scheduler: item permanently failed');

  const e = env();
  if (e.ALLOWED_APPROVER_EMAILS.length > 0) {
    const tpl = failureEmail({
      channel: item.channel.name,
      title: item.title,
      filename: item.expectedFilename,
      error: msg,
      reviewUrl: `${e.DASHBOARD_URL}/items/${itemId}`,
    });
    await sendEmail({ to: e.ALLOWED_APPROVER_EMAILS, ...tpl }).catch(() => {});
  }
}

// Wrapper for immediate publish (no publishAt). Reuses the same uploader code path.
async function uploadImmediate(opts: Parameters<typeof uploadAndSchedule>[0] extends infer T
  ? T extends { publishAt: Date }
    ? Omit<T, 'publishAt'>
    : never
  : never): Promise<{ videoId: string; url: string }> {
  // Hack: pass a date 5s in the future so YouTube accepts publishAt; effectively immediate.
  return uploadAndSchedule({ ...opts, publishAt: new Date(Date.now() + 60_000) });
}
