// Runs before `prisma db push` to neutralize anything that would block
// schema migration. Idempotent — safe to run on a fresh DB too.
//
// Currently handles:
//   1. EditorTaskStatus enum renames: in_progress → ongoing, done → completed.
//      Prisma db push can't change enum values that existing rows reference,
//      so we temporarily move those rows to a value that exists in BOTH the
//      old and new enums ('pending' for in_progress, 'submitted' for done),
//      then db push can safely drop the old labels.
//   2. Backfill Channel.filenamePrefix from slug if any row has it null
//      AFTER db push adds the column. (This part runs in bootstrap.ts.)

import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient({ log: ['error'] });
  try {
    // Translate any legacy EditorTask rows. Use try/catch per statement
    // because on a fresh DB the table doesn't exist yet (catch and ignore).
    try {
      const r1 = await prisma.$executeRawUnsafe(
        `UPDATE "EditorTask" SET status = 'pending' WHERE status::text = 'in_progress'`,
      );
      if (r1 > 0) console.log(`pre-migrate: moved ${r1} EditorTask(s) from in_progress → pending`);
    } catch (e) {
      console.log('pre-migrate: EditorTask in_progress translate skipped:', (e as Error).message);
    }
    try {
      const r2 = await prisma.$executeRawUnsafe(
        `UPDATE "EditorTask" SET status = 'submitted' WHERE status::text = 'done'`,
      );
      if (r2 > 0) console.log(`pre-migrate: moved ${r2} EditorTask(s) from done → submitted (will be re-marked completed by approval flow)`);
    } catch (e) {
      console.log('pre-migrate: EditorTask done translate skipped:', (e as Error).message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('pre-migrate fatal:', err);
  process.exit(1);
});
