// One-time data fix for a sync bug (fixed in apps/pos/sidecar/src/db.js):
// enqueueOutboxEvent used to send the sync event's createdAt as a
// timezone-less "YYYY-MM-DD HH:mm:ss" local string. The backend's
// `new Date(event.createdAt)` (sync.service.ts) parsed that as *the
// backend's own* local time (UTC), not the terminal's -- so a sale rung up
// at 12:41 PM in Phnom Penh (UTC+7) got its Order.createdAt stored as
// "12:41 UTC" instead of the correct "05:41 UTC". Every synced order's
// createdAt ended up `storeOffset` ahead of the real sale time.
//
// Detection: a sale can never legitimately sync *before* it happened, so
// createdAt > syncedAt is otherwise impossible -- every row matching that is
// a victim of this bug (verified against real data: every match showed a gap
// of storeOffset minus a few tens of seconds of ordinary sync-processing
// delay, with zero exceptions).
//
// Correction: the stored createdAt's own clock digits ARE the real sale's
// local wall-clock reading (that's what got mislabeled as UTC) -- reinterpret
// those digits in the order's own store's configured timezone to recover the
// true UTC instant, using the same zonedLocalToUtc the legacy importer
// already relies on for exactly this kind of conversion.
//
// Usage:
//   pnpm tsx scripts/fix-synced-order-timestamps.ts            # dry run (default, writes nothing)
//   pnpm tsx scripts/fix-synced-order-timestamps.ts --apply    # actually writes the corrections

import { prisma } from "../src/prisma";
import { zonedLocalToUtc } from "../src/modules/legacyImport/legacyImport.service";

const APPLY = process.argv.includes("--apply");

const pad = (n: number) => String(n).padStart(2, "0");

/** The stored (buggy) createdAt's own UTC-rendered digits are the real local
 * wall-clock reading -- this just re-renders them as a "YYYY-MM-DD HH:mm:ss"
 * string for zonedLocalToUtc to reinterpret in the order's store's real timezone. */
function toLocalString(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

interface Candidate {
  id: string;
  storeId: string;
  createdAt: Date;
  syncedAt: Date;
  timezone: string;
}

async function main() {
  const candidates = await prisma.$queryRaw<Candidate[]>`
    SELECT o."id", o."storeId", o."createdAt", o."syncedAt", s."timezone"
    FROM "Order" o
    JOIN "Store" s ON s."id" = o."storeId"
    WHERE o."syncedAt" IS NOT NULL
      AND o."createdAt" > o."syncedAt"
    ORDER BY o."createdAt" ASC
  `;

  if (candidates.length === 0) {
    console.log("No affected orders found.");
    return;
  }

  console.log(`${APPLY ? "Applying" : "Dry run — would apply"} corrections to ${candidates.length} order(s):\n`);

  let fixed = 0;
  let skipped = 0;
  for (const row of candidates) {
    const corrected = zonedLocalToUtc(toLocalString(row.createdAt), row.timezone);
    const deltaMin = Math.round((row.createdAt.getTime() - corrected.getTime()) / 60000);

    console.log(
      `${row.id}  ${row.createdAt.toISOString()} -> ${corrected.toISOString()}  (store ${row.storeId}, tz ${row.timezone}, -${deltaMin}min)`
    );

    // A real UTC offset is always within -12h..+14h and never exactly 0 --
    // anything outside that range means this row doesn't match the bug's
    // signature, and is left untouched rather than "corrected" by guesswork.
    if (deltaMin === 0 || deltaMin < -12 * 60 || deltaMin > 14 * 60) {
      console.warn(`  SKIPPED — correction size (${deltaMin}min) isn't a plausible timezone offset, left untouched.`);
      skipped++;
      continue;
    }

    if (APPLY) {
      await prisma.order.update({ where: { id: row.id }, data: { createdAt: corrected } });
    }
    fixed++;
  }

  console.log(`\n${APPLY ? "Fixed" : "Would fix"} ${fixed} of ${candidates.length} order(s) (${skipped} skipped).`);
  if (!APPLY) console.log("Re-run with --apply to write these changes.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });