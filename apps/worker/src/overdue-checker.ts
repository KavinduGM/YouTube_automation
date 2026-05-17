import { prisma, env, sendEmail, overdueAlertEmail, logger } from '@yt/shared';

// Detects items whose scheduledPublishAt has passed but haven't moved
// through the expected statuses, and sends a single digest email to all
// approvers. Runs once per hour (driven by the worker loop interval).
//
// Overdue rules:
//  - status in (planned, pending_approval, approved, scheduling) AND
//    scheduledPublishAt < (now - graceMinutes)
//
// We send at most one alert per item per 12 hours (tracked via lastError
// stamp prefix; simple but effective).

const GRACE_MS = 30 * 60 * 1000;          // 30 min before alerting
const ALERT_THROTTLE_MS = 12 * 3600 * 1000; // 12 h between repeat alerts

export async function runOverdueCheckerOnce(): Promise<void> {
  const e = env();
  const now = Date.now();
  const cutoff = new Date(now - GRACE_MS);

  const items = await prisma.contentItem.findMany({
    where: {
      status: { in: ['planned', 'pending_approval', 'approved', 'scheduling'] },
      scheduledPublishAt: { lt: cutoff },
    },
    include: { channel: true },
    orderBy: { scheduledPublishAt: 'asc' },
  });

  // Throttle — skip items whose lastError already contains "OVERDUE_ALERT@<recent epoch>"
  const toAlert = items.filter((i) => {
    const m = /OVERDUE_ALERT@(\d+)/.exec(i.lastError ?? '');
    if (!m) return true;
    const ts = Number(m[1]);
    return now - ts > ALERT_THROTTLE_MS;
  });

  if (toAlert.length === 0) {
    logger.debug({ total: items.length }, 'overdue-checker: no fresh alerts');
    return;
  }

  if (e.ALLOWED_APPROVER_EMAILS.length === 0) {
    logger.warn('overdue-checker: no approver emails configured');
    return;
  }

  const tpl = overdueAlertEmail({
    items: toAlert.map((i) => ({
      channel: i.channel.name,
      finalFilename: i.expectedFilename,
      scheduledAt: new Intl.DateTimeFormat('en-US', {
        timeZone: e.TZ,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(i.scheduledPublishAt) + ` (${e.TZ})`,
      status: i.status,
      reviewUrl: `${e.DASHBOARD_URL}/items/${i.id}`,
    })),
  });
  await sendEmail({ to: e.ALLOWED_APPROVER_EMAILS, ...tpl });

  // Stamp lastError with the throttle marker (preserve existing text if any).
  const stamp = `OVERDUE_ALERT@${now}`;
  for (const i of toAlert) {
    const existing = (i.lastError ?? '').replace(/(\s*\|?\s*)?OVERDUE_ALERT@\d+/g, '').trim();
    const next = existing ? `${existing} | ${stamp}` : stamp;
    await prisma.contentItem.update({
      where: { id: i.id },
      data: { lastError: next },
    });
  }
  logger.info({ count: toAlert.length }, 'overdue-checker: alert sent');
}
