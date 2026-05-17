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

// Detects RAW uploads (admin's dropped files matching {CHANNEL}_{TAG}.{ext})
// and creates an EditorTask + placeholder ContentItem from the next available
// publish slot.
//
// Files are duration-probed; if Drive hasn't finished processing the file,
// we skip this cycle and try again on the next poll.

const LONG_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes => long, else short

export async function runRawWatcherOnce(): Promise<void> {
  const channels = await prisma.channel.findMany({
    where: { driveFolderId: { not: null } },
  });
  if (channels.length === 0) return;

  for (const ch of channels) {
    if (!ch.driveFolderId) continue;
    try {
      await processChannelForRaw(ch.id, ch.driveFolderId);
    } catch (err) {
      logger.error({ err, channel: ch.slug }, 'raw-watcher: channel failed');
    }
  }
}

async function processChannelForRaw(channelId: string, folderId: string): Promise<void> {
  const files = await walkFolder(folderId);

  // First pass: collect all raw videos and their candidate doc files
  type RawCandidate = { fileId: string; filename: string; tag: string; mimeType: string };
  type DocCandidate = { fileId: string; filename: string; tag: string; kind: 'theory' | 'question' | 'other'; mimeType: string; size: number };
  const rawsByTag = new Map<string, RawCandidate>();
  const docsByTag = new Map<string, DocCandidate[]>();

  for (const f of files) {
    // Try doc first (more specific pattern)
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
    // Only treat as video raw if mime starts with video/
    if (!f.mimeType.startsWith('video/')) continue;
    rawsByTag.set(rawParsed.tag, {
      fileId: f.id,
      filename: f.name,
      tag: rawParsed.tag,
      mimeType: f.mimeType,
    });
  }

  // For each raw, ensure an EditorTask exists
  for (const [tag, raw] of rawsByTag) {
    const existing = await prisma.editorTask.findUnique({
      where: { rawDriveFileId: raw.fileId },
    });
    if (existing) {
      // Already tracked — sync docs only (in case new docs appeared)
      await syncDocs(existing.id, docsByTag.get(tag) ?? []);
      continue;
    }

    // Probe video duration
    const durMs = await getVideoDurationMs(raw.fileId);
    if (!durMs) {
      logger.info(
        { fileId: raw.fileId, filename: raw.filename },
        'raw-watcher: duration not yet available — retry next cycle',
      );
      continue;
    }
    const type: ContentType = durMs >= LONG_THRESHOLD_MS ? 'long' : 'short';

    // Pop next available slot atomically. Use a transaction so two workers
    // would never claim the same slot.
    const channelRecord = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    const channelSlug = channelRecord.slug as 'OAP' | 'OAG' | 'NUR';

    let result: { itemId: string; slotId: string; expectedFilename: string; scheduledAt: Date } | null = null;
    try {
      result = await prisma.$transaction(async (tx) => {
        const slot = await tx.publishSlot.findFirst({
          where: { channelId, type, status: 'available' },
          orderBy: { scheduledAt: 'asc' },
        });
        if (!slot) return null;

        const slotIndex = await computeSlotNumber(tx, {
          channelId,
          type,
          scheduledAt: slot.scheduledAt,
          slotId: slot.id,
        });
        const expectedFilename = computeExpectedFilename({
          channel: channelSlug,
          type,
          scheduledAt: slot.scheduledAt,
          slot: slotIndex,
          tag,
        });

        // Avoid filename collision with an existing ContentItem
        const exists = await tx.contentItem.findUnique({ where: { expectedFilename } });
        if (exists) {
          // very rare — skip slot and move to next pass
          return null;
        }

        const item = await tx.contentItem.create({
          data: {
            channelId,
            type,
            expectedFilename,
            examTag: tag,
            title: tag, // placeholder; admin will edit
            description: '', // admin will fill in
            tags: [],
            scheduledPublishAt: slot.scheduledAt,
            status: 'planned',
          },
        });
        await tx.publishSlot.update({
          where: { id: slot.id },
          data: { status: 'assigned', assignedItemId: item.id },
        });
        return {
          itemId: item.id,
          slotId: slot.id,
          expectedFilename,
          scheduledAt: slot.scheduledAt,
        };
      });
    } catch (err) {
      logger.error({ err, tag, channelId }, 'raw-watcher: slot assignment tx failed');
      continue;
    }

    if (!result) {
      logger.warn({ tag, channelId, type }, 'raw-watcher: no slot available for raw');
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

    // Attach docs
    await syncDocs(task.id, docsByTag.get(tag) ?? []);

    // Notify the assigned editor
    await notifyEditor(task.id, result.expectedFilename, result.scheduledAt, type).catch((err) =>
      logger.error({ err, taskId: task.id }, 'failed to notify editor'),
    );

    logger.info(
      { taskId: task.id, tag, type, scheduledAt: result.scheduledAt, expectedFilename: result.expectedFilename },
      'raw-watcher: created EditorTask',
    );
  }
}

async function computeSlotNumber(
  tx: import('@prisma/client').Prisma.TransactionClient,
  opts: {
    channelId: string;
    type: ContentType;
    scheduledAt: Date;
    slotId: string;
  },
): Promise<number> {
  // For shorts: count slots with the same date.
  // For longs: count slots with the same week-of-month.
  const d = opts.scheduledAt;
  let rangeStart: Date;
  let rangeEnd: Date;
  if (opts.type === 'long') {
    // Week-of-month range
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
    const existing = await prisma.editorTaskDoc.findFirst({
      where: { taskId, driveFileId: d.fileId },
    });
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
  if (!task?.assignedEditor) return;
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
