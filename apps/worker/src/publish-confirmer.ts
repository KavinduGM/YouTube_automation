import { prisma, logger } from '@yt/shared';
import { getVideoStatus } from '@yt/shared/google/youtube';

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
          data: { contentItemId: item.id, type: 'published', message: `confirmed live (${s.privacyStatus})` },
        });
      }
    } catch (err) {
      logger.warn({ err, itemId: item.id }, 'publish-confirmer: check failed');
    }
  }
}
