import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '@yt/shared';

// Aggregate counts + recent activity for the overview dashboard.
// Both admins and editors can call this; the response is identical
// (counts reflect everything in the system, not per-user).

export const statsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.get('/overview', async () => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const [
      pendingApproval,
      planned,
      approved,
      scheduling,
      scheduled,
      publishedThisMonth,
      failed,
      rejected,
      tasksPending,
      tasksOngoing,
      tasksInReview,
      tasksRevision,
      channelsTotal,
      recentEvents,
      recentTasks,
      upcomingItems,
    ] = await Promise.all([
      prisma.contentItem.count({ where: { status: 'pending_approval' } }),
      prisma.contentItem.count({ where: { status: 'planned' } }),
      prisma.contentItem.count({ where: { status: 'approved' } }),
      prisma.contentItem.count({ where: { status: 'scheduling' } }),
      prisma.contentItem.count({ where: { status: 'scheduled' } }),
      prisma.contentItem.count({
        where: {
          status: 'published',
          scheduledPublishAt: { gte: monthStart, lt: monthEnd },
        },
      }),
      prisma.contentItem.count({ where: { status: 'failed' } }),
      prisma.contentItem.count({ where: { status: 'rejected' } }),
      prisma.editorTask.count({ where: { status: 'pending' } }),
      prisma.editorTask.count({ where: { status: 'ongoing' } }),
      prisma.editorTask.count({ where: { status: 'submitted' } }),
      prisma.editorTask.count({ where: { status: 'revision_requested' } }),
      prisma.channel.count(),
      prisma.contentEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 15,
        include: {
          contentItem: { select: { id: true, title: true, expectedFilename: true, channel: { select: { slug: true, name: true } } } },
        },
      }),
      prisma.editorTask.findMany({
        where: { status: { in: ['pending', 'ongoing', 'submitted', 'revision_requested'] } },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          channel: { select: { slug: true, name: true } },
          contentItem: { select: { expectedFilename: true, scheduledPublishAt: true } },
        },
      }),
      prisma.contentItem.findMany({
        where: { status: { in: ['scheduled', 'approved', 'pending_approval'] } },
        orderBy: { scheduledPublishAt: 'asc' },
        take: 8,
        include: { channel: { select: { slug: true, name: true } } },
      }),
    ]);

    return {
      counts: {
        pendingApproval,
        planned,
        approved,
        scheduling,
        scheduled,
        publishedThisMonth,
        failed,
        rejected,
        tasksPending,
        tasksOngoing,
        tasksInReview,
        tasksRevision,
        channelsTotal,
      },
      recentEvents: recentEvents.map((e) => ({
        id: e.id,
        type: e.type,
        message: e.message,
        actorEmail: e.actorEmail,
        createdAt: e.createdAt,
        item: e.contentItem ? {
          id: e.contentItem.id,
          title: e.contentItem.title,
          filename: e.contentItem.expectedFilename,
          channel: e.contentItem.channel.name,
          channelSlug: e.contentItem.channel.slug,
        } : null,
      })),
      recentTasks: recentTasks.map((t) => ({
        id: t.id,
        rawFilename: t.rawFilename,
        status: t.status,
        channel: t.channel.name,
        channelSlug: t.channel.slug,
        expectedFilename: t.contentItem?.expectedFilename ?? null,
        scheduledPublishAt: t.contentItem?.scheduledPublishAt ?? null,
        createdAt: t.createdAt,
      })),
      upcomingItems: upcomingItems.map((i) => ({
        id: i.id,
        title: i.title,
        filename: i.expectedFilename,
        status: i.status,
        type: i.type,
        format: i.format,
        scheduledPublishAt: i.scheduledPublishAt,
        channel: i.channel.name,
        channelSlug: i.channel.slug,
      })),
    };
  });
};
