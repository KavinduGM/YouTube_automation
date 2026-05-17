import { env, logger } from '@yt/shared';
import { runDriveWatcherOnce } from './drive-watcher.js';
import { runRawWatcherOnce } from './raw-watcher.js';
import { runSchedulerOnce } from './scheduler.js';
import { runPublishConfirmerOnce } from './publish-confirmer.js';
import { runOverdueCheckerOnce } from './overdue-checker.js';

async function loop(name: string, fn: () => Promise<void>, intervalSec: number) {
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });
  while (!stopping) {
    const t0 = Date.now();
    try {
      await fn();
    } catch (err) {
      logger.error({ err, loop: name }, 'worker loop failed');
    }
    const elapsed = Date.now() - t0;
    const wait = Math.max(0, intervalSec * 1000 - elapsed);
    await new Promise((r) => setTimeout(r, wait));
  }
  logger.info({ loop: name }, 'worker loop stopped');
}

async function main() {
  const e = env();
  logger.info(
    { tz: e.TZ, drivePoll: e.DRIVE_POLL_INTERVAL_SECONDS, sched: e.SCHEDULER_INTERVAL_SECONDS },
    'worker starting',
  );
  await Promise.all([
    loop('raw-watcher', runRawWatcherOnce, e.DRIVE_POLL_INTERVAL_SECONDS),
    loop('drive-watcher', runDriveWatcherOnce, e.DRIVE_POLL_INTERVAL_SECONDS),
    loop('scheduler', runSchedulerOnce, e.SCHEDULER_INTERVAL_SECONDS),
    loop('publish-confirmer', runPublishConfirmerOnce, 600),
    loop('overdue-checker', runOverdueCheckerOnce, 3600), // hourly
  ]);
}

main().catch((err) => {
  logger.fatal({ err }, 'worker crashed');
  process.exit(1);
});
