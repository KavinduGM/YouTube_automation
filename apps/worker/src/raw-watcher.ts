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
  type VideoFormatSlug,
} from '@yt/shared';
import { walkFolder, getVideoDurationMs } from '@yt/shared/google/drive';

// Watches per-month channel folders for raw uploads, parses their type/format
// from the filename, claims the next matching publish slot, and creates an
// EditorTask + planned ContentItem.

const LONG_THRESHOLD_MS = 5 * 60 * 1000; // duration probe used only if filename is ambiguous

export async function runRawWatcherOnce(): Promise<void> {
  const channels = await prisma.channel.findMany({
    include: { months: true },
  });
  if (channels.length === 0) return;

  // Build prefix → channel map for fast lookup
  const byPrefix = new Map(channels.map((c) => [c.filenamePrefix.toUpperCase(), c]));

  for (const ch of channels) {
    const folders: { folderId: string; month: string | null }[] = [];
    for (const m of ch.months) {
      if (m.driveFolderId) folders.push({ folderId: m.driveFolderId, month: m.month });
    }
    if (ch.driveFolderId) folders.push({ folderId: ch.driveFolderId, month: null });
    if (folders.length === 0) continue;

    for (const f of folders) {
      try {
        await processFolder(byPrefix, f.folderId, f.month);
      } catch (err) {
        logger.error({ err, channel: ch.slug, folderId: f.folderId }, 'raw-watcher: folder failed');
      }
    }
  }
}

async function processFolder(
  byPrefix: Map<string, Awaited<ReturnType<typeof prisma.channel.findFirst>>>,
  folderId: string,
  monthHint: string | null,
): Promise<void> {
  const files = await walkFolder(folderId);

  type RawCandidate = {
    fileId: string; filename: string; tag: string; mimeType: string;
    type: ContentType; format: VideoFormatSlug | null; shortNumber: number | null;
    prefix: string;
  };
  type DocCandidate = {
    fileId: string; filename: string; tag: string;
    kind: 'theory' | 'question' | 'other'; mimeType: string; size: number; prefix: string;
  };
  const raws = new Map<string, RawCandidate>();        // key: rawFilename
  const docsByPrefixTag = new Map<string, DocCandidate[]>(); // key: prefix:tag

  for (const f of files) {
    const dp = parseRawDoc(f.name);
    if (dp) {
      const ch = byPrefix.get(dp.prefix.toUpperCase());
      if (!ch) continue;
      const key = `${dp.prefix.toUpperCase()}:${dp.tag}`;
      const arr = docsByPrefixTag.get(key) ?? [];
      arr.push({
        fileId: f.id,
        filename: f.name,
        tag: dp.tag,
        kind: dp.kind,
        mimeType: f.mimeType,
        size: f.size,
        prefix: dp.prefix.toUpperCase(),
      });
      docsByPrefixTag.set(key, arr);
      continue;
    }
    const rp = parseRawFilename(f.name);
    if (!rp) continue;
    if (!f.mimeType.startsWith('video/')) continue;
    const ch = byPrefix.get(rp.prefix.toUpperCase());
    if (!ch) continue;
    raws.set(f.name, {
      fileId: f.id,
      filename: f.name,
      tag: rp.tag,
      mimeType: f.mimeType,
      type: rp.type,
      format: rp.format ?? null,
      shortNumber: rp.shortNumber ?? null,
      prefix: rp.prefix.toUpperCase(),
    });
  }

  for (const raw of raws.values()) {
    const existing = await prisma.editorTask.findUnique({ where: { rawDriveFileId: raw.fileId } });
    if (existing) {
      await syncDocs(existing.id, docsByPrefixTag.get(`${raw.prefix}:${raw.tag}`) ?? []);
      continue;
    }

    const ch = byPrefix.get(raw.prefix);
    if (!ch) continue;

    // Probe duration only as a sanity check / fallback. Filename is authoritative.
    const durMs = await getVideoDurationMs(raw.fileId);
    if (!durMs && raw.type === 'long') {
      logger.info({ filename: raw.filename }, 'raw-watcher: waiting for duration probe');
      continue;
    }
    // Sanity: long should be ≥5 min
    if (raw.type === 'long' && durMs && durMs < LONG_THRESHOLD_MS) {
      logger.warn(
        { filename: raw.filename, durMs },
        'raw-watcher: file marked long but duration suggests short — proceeding anyway',
      );
    }

    let result: { itemId: string; expectedFilename: string; scheduledAt: Date } | null = null;
    try {
      result = await prisma.$transaction(async (tx) => {
        const slotFilter: import('@prisma/client').Prisma.PublishSlotWhereInput = {
          channelId: ch.id,
          type: raw.type,
          status: 'available',
        };
        // Match format strictly when set
        if (raw.format) slotFilter.format = raw.format;
        else if (raw.type === 'long') slotFilter.format = null;
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
          channelId: ch.id, type: raw.type, scheduledAt: slot.scheduledAt, slotId: slot.id,
        });
        const expectedFilename = computeExpectedFilename({
          prefix: raw.prefix,
          type: raw.type,
          scheduledAt: slot.scheduledAt,
          slot: slotIndex,
          tag: raw.tag,
          format: raw.format ?? undefined,
        });
        const exists = await tx.contentItem.findUnique({ where: { expectedFilename } });
        if (exists) return null;

        const item = await tx.contentItem.create({
          data: {
            channelId: ch.id,
            type: raw.type,
            format: raw.format ?? null,
            expectedFilename,
            examTag: raw.tag,
            title: raw.tag,
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
      logger.error({ err, raw: raw.filename }, 'raw-watcher: tx failed');
      continue;
    }

    if (!result) {
      logger.warn({ raw: raw.filename, monthHint, type: raw.type, format: raw.format }, 'raw-watcher: no slot available');
      continue;
    }

    const task = await prisma.editorTask.create({
      data: {
        channelId: ch.id,
        rawDriveFileId: raw.fileId,
        rawFilename: raw.filename,
        rawTag: raw.tag,
        contentItemId: result.itemId,
        detectedType: raw.type,
        detectedFormat: raw.format ?? null,
        durationMillis: durMs ?? null,
        status: 'pending',
        assignedEditorId: await pickEditorId(),
      },
    });
    await syncDocs(task.id, docsByPrefixTag.get(`${raw.prefix}:${raw.tag}`) ?? []);
    await notifyEditor(task.id, result.expectedFilename, result.scheduledAt, raw.type, raw.format ?? null)
      .catch((err) => logger.error({ err, taskId: task.id }, 'failed to notify editor'));
    logger.info(
      { taskId: task.id, raw: raw.filename, type: raw.type, format: raw.format, expectedFilename: result.expectedFilename },
      'raw-watcher: created EditorTask',
    );
  }
}

async function computeSlotNumber(
  tx: import('@prisma/client').Prisma.TransactionClient,
  opts: { channelId: string; type: ContentType; scheduledAt: Date; slotId: string },
): Promise<number> {
  // Count earlier slots on the SAME day (we now use date-based filenames for all types).
  const d = opts.scheduledAt;
  const rangeStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const rangeEnd = new Date(rangeStart.getTime() + 86400_000);
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
  type: ContentType,
  format: VideoFormatSlug | null,
): Promise<void> {
  const e = env();
  const task = await prisma.editorTask.findUnique({
    where: { id: taskId },
    include: { channel: true, assignedEditor: true },
  });
  if (!task?.assignedEditor?.email) return;
  const typeLabel = format ? `${type} ${format}` : type;
  const tpl = editorTaskAssignedEmail({
    channel: task.channel.name,
    rawFilename: task.rawFilename,
    finalFilename: expectedFilename,
    detectedType: typeLabel,
    scheduledAt: new Intl.DateTimeFormat('en-US', {
      timeZone: e.TZ,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(scheduledAt) + ` (${e.TZ})`,
    reviewUrl: `${e.DASHBOARD_URL}/editor/tasks/${task.id}`,
  });
  await sendEmail({ to: task.assignedEditor.email, ...tpl });
}
