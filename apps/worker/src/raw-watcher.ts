import {
  prisma,
  logger,
  env,
  parseRawFilename,
  parseRawDoc,
  computeExpectedFilename,
  sendEmail,
  editorTaskAssignedEmail,
  type ContentType,
} from '@yt/shared';
import { walkFolder, getVideoDurationMs } from '@yt/shared/google/drive';

// Detects RAW uploads — admin's files matching {CHANNEL}_{TAG}.{ext}.
// Creates an EditorTask + planned ContentItem from the next available
// publish slot in the FILE'S MONTH (so May raws consume May slots).
//
// Sources of folders to walk, in priority:
//   1. ChannelMonth.driveFolderId for every (channel, month) row
//   2. Channel.driveFolderId as a fallback (legacy / catch-all)
//
// Each walked folder is tagged with the month it belongs to, so slots
// can be matched correctly.

const LONG_THRESHOLD_MS = 5 * 60 * 1000;

export async function runRawWatcherOnce(): Promise<void> {
  const channels = await prisma.channel.findMany({
    include: { months: true },
  });
  if (channels.length === 0) return;

  for (const ch of channels) {
    // Build list of (folderId, monthHint | null) to walk
    const folders: { folderId: string; month: string | null }[] = [];
    for (const m of ch.months) {
      if (m.driveFolderId) folders.push({ folderId: m.driveFolderId, month: m.month });
    }
    if (ch.driveFolderId) folders.push({ folderId: ch.driveFolderId, month: null });
    if (folders.length === 0) continue;

    for (const f of folders) {
      try {
        await processFolder(ch.id, ch.slug as 'OAP' | 'OAG' | 'NUR', f.folderId, f.month);
      } catch (err) {
        logger.error({ err, channel: ch.slug, folderId: f.folderId }, 'raw-watcher: folder failed');
      }
    }
  }
}

async function processFolder(
  channelId: string,
  channelSlug: 'OAP' | 'OAG' | 'NUR',
  folderId: string,
  monthHint: string | null,
): Promise<void> {
  const files = await walkFolder(folderId);

  type RawCandidate = { fileId: string; filename: string; tag: string; mimeType: string };
  type DocCandidate = {
    fileId: string; filename: string; tag: string;
    kind: 'theory' | 'question' | 'other'; mimeType: string; size: number;
  };
  const rawsByTag = new Map<string, RawCandidate>();
  const docsByTag = new Map<string, DocCandidate[]>();

  for (const f of files) {
    const docParsed = parseRawDoc(f.name);
    if (docParsed) {
      const arr = docsByTag.get(docParsed.tag) ?? [];
      arr.push({
        fileId: f.id,
        filename: f.name,
        tag: docParsed.tag,
        kind: docParsed.kind,
        mimeType: f.mimeType,
        size: f.size,
      });
      docsByTag.set(docParsed.tag, arr);
      continue;
    }
    const rawParsed = parseRawFilename(f.name);
    if (!rawParsed) continue;
    if (!f.mimeType.startsWith('video/')) continue;
    rawsByTag.set(rawParsed.tag, {
      fileId: f.id,
      filename: f.name,
      tag: rawParsed.tag,
      mimeType: f.mimeType,
    });
  }

  for (const [tag, raw] of rawsByTag) {
    const existing = await prisma.editorTask.findUnique({ where: { rawDriveFileId: raw.fileId } });
    if (existing) {
      await syncDocs(existing.id, docsByTag.get(tag) ?? []);
      continue;
    }

    const durMs = await getVideoDurationMs(raw.fileId);
    if (!durMs) {
      logger.info({ fileId: raw.fileId, filename: raw.filename }, 'raw-watcher: duration not yet available — retry');
      continue;
    }
    const type: ContentType = durMs >= LONG_THRESHOLD_MS ? 'long' : 'short';

    let result: { itemId: string; expectedFilename: string; scheduledAt: Date } | null = null;
    try {
      result = await prisma.$transaction(async (tx) => {
        // Scope slot selection to the month hinted by the folder, if any
        const slotFilter: import('@prisma/client').Prisma.PublishSlotWhereInput = {
          channelId,
          type,
          status: 'available',
        };
        if (monthHint) {
          const [y, m] = monthHint.split('-').map(Number);
          const start = new Date(Date.UTC(y, (m ?? 1) - 1, 1));
          const end = new Date(Date.UTC(y, (m ?? 1), 1));
          slotFilter.scheduledAt = { gte: start, lt: end };
        }
        const slot = await tx.publishSlot.findFirst({
          where: slotFilter,
          orderBy: { scheduledAt: 'asc' },
        });
        if (!slot) return null;

        const slotIndex = await computeSlotNumber(tx, {
          channelId, type, scheduledAt: slot.scheduledAt, slotId: slot.id,
        });
        const expectedFilename = computeExpectedFilename({
          channel: channelSlug, type, scheduledAt: slot.scheduledAt, slot: slotIndex, tag,
        });
        const exists = await tx.contentItem.findUnique({ where: { expectedFilename } });
        if (exists) return null;

        const item = await tx.contentItem.create({
          data: {
            channelId,
            type,
            expectedFilename,
            examTag: tag,
            title: tag,
            description: '',
            tags: [],
            scheduledPublishAt: slot.scheduledAt,
            status: 'planned',
          },
        });
        await tx.publishSlot.update({
          where: { id: slot.id },
          data: { status: 'assigned', assignedItemId: item.id },
        });
        return { itemId: item.id, expectedFilename, scheduledAt: slot.scheduledAt };
      });
    } catch (err) {
      logger.error({ err, tag, channelId }, 'raw-watcher: tx failed');
      continue;
    }

    if (!result) {
      logger.warn({ tag, channelId, type, monthHint }, 'raw-watcher: no slot available');
      continue;
    }

    const task = await prisma.editorTask.create({
      data: {
        channelId,
        rawDriveFileId: raw.fileId,
        rawFilename: raw.filename,
        rawTag: tag,
        contentItemId: result.itemId,
        detectedType: type,
        durationMillis: durMs,
        status: 'pending',
        assignedEditorId: await pickEditorId(),
      },
    });

    await syncDocs(task.id, docsByTag.get(tag) ?? []);
    await notifyEditor(task.id, result.expectedFilename, result.scheduledAt, type).catch((err) =>
      logger.error({ err, taskId: task.id }, 'failed to notify editor'),
    );
    logger.info(
      { taskId: task.id, tag, type, monthHint, expectedFilename: result.expectedFilename },
      'raw-watcher: created EditorTask',
    );
  }
}

async function computeSlotNumber(
  tx: import('@prisma/client').Prisma.TransactionClient,
  opts: { channelId: string; type: ContentType; scheduledAt: Date; slotId: string },
): Promise<number> {
  const d = opts.scheduledAt;
  let rangeStart: Date;
  let rangeEnd: Date;
  if (opts.type === 'long') {
    const dayOfMonth = d.getUTCDate();
    const weekNum = Math.floor((dayOfMonth - 1) / 7);
    const firstOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    rangeStart = new Date(firstOfMonth.getTime() + weekNum * 7 * 86400_000);
    rangeEnd = new Date(rangeStart.getTime() + 7 * 86400_000);
  } else {
    rangeStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    rangeEnd = new Date(rangeStart.getTime() + 86400_000);
  }
  const earlier = await tx.publishSlot.count({
    where: {
      channelId: opts.channelId,
      type: opts.type,
      scheduledAt: { gte: rangeStart, lt: rangeEnd, lte: opts.scheduledAt },
      NOT: { id: opts.slotId },
    },
  });
  return earlier + 1;
}

async function pickEditorId(): Promise<string | null> {
  const editor = await prisma.user.findFirst({
    where: { role: 'editor', active: true },
    orderBy: { createdAt: 'asc' },
  });
  return editor?.id ?? null;
}

async function syncDocs(
  taskId: string,
  docs: Array<{ fileId: string; filename: string; kind: 'theory' | 'question' | 'other'; mimeType: string; size: number }>,
): Promise<void> {
  for (const d of docs) {
    const existing = await prisma.editorTaskDoc.findFirst({ where: { taskId, driveFileId: d.fileId } });
    if (existing) continue;
    await prisma.editorTaskDoc.create({
      data: {
        taskId,
        driveFileId: d.fileId,
        filename: d.filename,
        kind: d.kind,
        mimeType: d.mimeType,
        sizeBytes: d.size,
      },
    });
  }
}

async function notifyEditor(
  taskId: string,
  expectedFilename: string,
  scheduledAt: Date,
  detectedType: string,
): Promise<void> {
  const e = env();
  const task = await prisma.editorTask.findUnique({
    where: { id: taskId },
    include: { channel: true, assignedEditor: true },
  });
  if (!task?.assignedEditor?.email) return;
  const tpl = editorTaskAssignedEmail({
    channel: task.channel.name,
    rawFilename: task.rawFilename,
    finalFilename: expectedFilename,
    detectedType,
    scheduledAt: new Intl.DateTimeFormat('en-US', {
      timeZone: e.TZ,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(scheduledAt) + ` (${e.TZ})`,
    reviewUrl: `${e.DASHBOARD_URL}/editor/tasks/${task.id}`,
  });
  await sendEmail({ to: task.assignedEditor.email, ...tpl });
}
