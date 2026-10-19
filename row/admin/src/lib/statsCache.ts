// Disk-backed snapshot cache for the public Projects page. SERVER ONLY.
//
// Why a file and not Redis: the whole snapshot is ~30 KB (see MAX_BYTES below) and
// changes a few times an hour. A cache server would buy eviction, TTL sweeping and a
// wire protocol — none of which this workload uses — at the cost of a service to keep
// alive on the IIS box. A file gives the three properties that ARE needed: it survives
// app-pool recycles, it is shared by every IIS worker process, and it reads in
// microseconds.
//
// Why not Next's own data cache (unstable_cache): that lives in .next/cache, which a
// redeploy wipes. Rebuilding the frozen year slices costs ~25s of 8-second zone-wide
// queries, and we don't want to pay it on every deploy. This file sits OUTSIDE the
// build output and survives.
//
// Concurrency: writes go to a temp file and are renamed over the target. Rename is
// atomic on NTFS, so a reader never sees a half-written snapshot. Two workers racing a
// write is fine — last one wins, and both wrote the same thing.

import { promises as fs } from "fs";
import path from "path";

/** Anything bigger than this is treated as runaway growth: the snapshot is discarded and
 *  rebuilt from scratch rather than patched further (see store() in projectStatsServer).
 *
 *  Sized against the real thing, which measures ~28 KB — states, districts, areas and one
 *  page of cards are all fixed-size, and frozenYears adds ~150 bytes per rotary year, so
 *  the snapshot is effectively bounded. This is a fault detector, not a working limit,
 *  and it is set generously on purpose: firing it costs a full ~30s rebuild, so a ceiling
 *  tight enough to trip in normal operation would be worse than no ceiling at all. */
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const DIR = process.env.STATS_CACHE_DIR ?? path.join(process.cwd(), ".cache");
const FILE = path.join(DIR, "project-stats.json");

/** In-process copy, so repeated reads within one request don't touch the disk.
 *  Re-read when the file's mtime moves — that's how one worker notices another
 *  worker's refresh. */
let memo: { data: unknown; mtimeMs: number } | null = null;

export async function readSnapshot<T>(): Promise<T | null> {
  try {
    const stat = await fs.stat(FILE);
    if (memo && memo.mtimeMs === stat.mtimeMs) return memo.data as T;

    // Oversized on disk — discard rather than parse. Next read rebuilds.
    if (stat.size > MAX_BYTES) {
      await discardSnapshot();
      return null;
    }

    const raw = await fs.readFile(FILE, "utf8");
    const data = JSON.parse(raw) as T;
    memo = { data, mtimeMs: stat.mtimeMs };
    return data;
  } catch {
    // Missing, unreadable or corrupt JSON — the caller rebuilds.
    return null;
  }
}

/**
 * Outcome of a write. "too-large" and "io-error" are kept apart on purpose because the
 * right response differs: an oversized snapshot should be rebuilt from scratch, while an
 * unwritable directory must NOT trigger a rebuild — that would just fail again, on a
 * loop, every time the freshness probe found a change.
 */
export type WriteResult = "ok" | "too-large" | "io-error";

/** Persist a snapshot. On "too-large" nothing is written and the old file is dropped —
 *  the caller's data is suspect, so serving it (or keeping the previous one) would risk
 *  stale or wrong numbers. Never throws; see the catch below for why that matters. */
export async function writeSnapshot(data: unknown): Promise<WriteResult> {
  const body = JSON.stringify(data);
  if (Buffer.byteLength(body) > MAX_BYTES) {
    await discardSnapshot();
    return "too-large";
  }

  try {
    await fs.mkdir(DIR, { recursive: true });
    // Unique temp name: two workers writing at once must not share a temp file.
    const tmp = `${FILE}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tmp, body, "utf8");
    await fs.rename(tmp, FILE); // atomic on NTFS

    const stat = await fs.stat(FILE);
    memo = { data, mtimeMs: stat.mtimeMs };
    return "ok";
  } catch (err) {
    // The cache directory is not writable (wrong app-pool identity is the usual
    // cause on IIS), the disk is full, or a scanner is holding the file. This MUST
    // NOT throw: every caller invokes this from a fire-and-forget path, so an
    // unhandled rejection here would take the whole Node process down over a
    // permissions mistake. Degrade to "no cache" instead — slow, but serving.
    console.error("[statsCache] snapshot write failed: running uncached:", err);
    return "io-error";
  }
}

export async function discardSnapshot(): Promise<void> {
  memo = null;
  try {
    await fs.unlink(FILE);
  } catch {
    /* already gone */
  }
}
