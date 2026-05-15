import { prisma, logger } from '@yt/shared';
import { getVideoStatus } from '@yt/shared/google/youtube';
import { writeStatusToSheet } from '@yt/shared/google/sheets';

// Confirms that 'scheduled' items have actually flipped to public/published on YouTube.
// Runs every 10 minutes; only checks items whose scheduledPublishAt is in the past.
// Also writes the published status back to the linked Google Sheet.

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
        const publishedAt = new Date();
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

        // Sheet write-back — flip status to 'published' and stamp published_at.
        if (item.sheetId) {
          try {
            await writeStatusToSheet({
              spreadsheetId: item.sheetId,
              tab: item.sheetTab ?? undefined,
              matchByFilename: item.expectedFilename,
              status: 'published',
              youtubeUrl: item.youtubeUrl ?? undefined,
              youtubeId: item.youtubeVideoId,
              publishedAt: publishedAt.toISOString(),
              scheduledAt: item.scheduledPublishAt.toISOString(),
              approvedBy: item.approvedBy?.email ?? undefined,
            });
          } catch (err) {
            logger.warn({ err, itemId: item.id }, 'publish-confirmer: sheet write-back failed (non-fatal)');
          }
        }
      }
    } catch (err) {
      logger.warn({ err, itemId: item.id }, 'publish-confirmer: check failed');
    }
  }
}
