export type RunStatus = 'ok' | 'retry' | 'fail';

/** Counts of valid log events, including every retry, not final job statuses. */
export interface EventCounts {
  ok: number;
  retry: number;
  fail: number;
}

export interface DigestRow {
  job: string;
  /** Owner from the last event; null is retained for display as an em dash. */
  owner: string | null;
  /** All valid events for this job, including retry and fail events. */
  runs: number;
  retries: number;
  /** Fail events, so a later success does not hide an earlier failure. */
  failures: number;
  lastStatus: RunStatus;
  /** Most recent error supplied for the job, or null if none was supplied. */
  lastError: string | null;
  /** First and last event timestamps in log order, preserving original offsets. */
  firstAt: string;
  lastAt: string;
}

export interface NightDigest {
  /** False only when the night's file does not exist. */
  found: boolean;
  /** One row per job, sorted by job in ascending string order. */
  rows: DigestRow[];
  /** Malformed JSON or invalid event records; blank lines are ignored. */
  badLines: number;
  counts: EventCounts;
}

/**
 * Read runs/<night>.jsonl synchronously. The implementation lives in reader.ts.
 * A missing file returns found: false, no rows, and zero counts/badLines.
 * An empty file returns found: true, no rows, and zero counts/badLines.
 * Bad lines are counted and skipped, leaving valid events available to render.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest;
