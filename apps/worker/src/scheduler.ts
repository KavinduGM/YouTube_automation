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
import { moveToPublishedFolder } from './move-to-published.js';
import { moveRawToArchive } from './move-raw-to-archive.js';

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

  // Safety: if this item already has a youtubeVideoId, the upload has
  // already happened. Don't re-upload — that would create a duplicate
  // and burn quota. Mark as scheduled and move on.
  if (item.youtubeVideoId) {
    logger.warn(
      { itemId, youtubeVideoId: item.youtubeVideoId },
      'scheduler: item already has a YouTube video, skipping re-upload',
    );
    await prisma.contentItem.update({
      where: { id: item.id },
      data: {
        status: 'scheduled',
        lastError: 'Skipped re-upload — item already has youtubeVideoId',
      },
    });
    await prisma.contentEvent.create({
      data: {
        contentItemId: item.id,
        type: 'scheduled',
        message: `Skipped duplicate upload (videoId=${item.youtubeVideoId} already set)`,
      },
    });
    // Still try to move files if a published folder is configured
    await moveToPublishedFolder(item.id).catch(() => {});
    return;
  }

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
    let thumbnailError: string | undefined;
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
        recordingCountry: item.recordingCountry,
        madeForKids: item.madeForKids,
        publishAt: effectivePublishAt,
        isShort: item.type === 'short',
      });
      videoId = result.videoId;
      url = result.url;
      thumbnailError = result.thumbnailError;
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
        recordingCountry: item.recordingCountry,
        madeForKids: item.madeForKids,
        isShort: item.type === 'short',
      });
      videoId = result.videoId;
      url = result.url;
      thumbnailError = result.thumbnailError;
    }

    await prisma.contentItem.update({
      where: { id: item.id },
      data: {
        status: effectivePublishAt ? 'scheduled' : 'published',
        youtubeVideoId: videoId,
        youtubeUrl: url,
        // Keep the thumbnail warning visible in the UI but don't retry —
        // the video itself is live.
        lastError: thumbnailError ? `Video uploaded but thumbnail failed: ${thumbnailError}` : null,
      },
    });
    await prisma.contentEvent.create({
      data: {
        contentItemId: item.id,
        type: effectivePublishAt ? 'scheduled' : 'published',
        message: thumbnailError
          ? `YouTube videoId=${videoId} (thumbnail upload failed)`
          : `YouTube videoId=${videoId}`,
        meta: { url, publishAt: effectivePublishAt?.toISOString() ?? null, thumbnailError: thumbnailError ?? null },
      },
    });

    // Move both files to the channel's "published" folder if configured.
    // Best-effort — failure here doesn't undo the YouTube upload.
    await moveToPublishedFolder(item.id).catch((err) =>
      logger.warn({ err, itemId: item.id }, 'move-to-published failed (non-fatal)'),
    );
    // Also archive the raw video + any docs so the working folder stays clean.
    await moveRawToArchive(item.id).catch((err) =>
      logger.warn({ err, itemId: item.id }, 'move-raw-to-archive failed (non-fatal)'),
    );

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
async function uploadImmediate(
  opts: Omit<Parameters<typeof uploadAndSchedule>[0], 'publishAt'>,
): Promise<Awaited<ReturnType<typeof uploadAndSchedule>>> {
  // Pass a date 1 min in the future so YouTube accepts publishAt; effectively immediate.
  return uploadAndSchedule({ ...opts, publishAt: new Date(Date.now() + 60_000) });
}

