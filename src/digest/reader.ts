import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

interface RunEvent {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
}

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (!('at' in value) || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at))) return null;
  if (!('job' in value) || typeof value.job !== 'string' || value.job.trim() === '') return null;
  if (!('status' in value) || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')) return null;
  if (!('owner' in value) || (value.owner !== null && typeof value.owner !== 'string')) return null;
  const error = 'error' in value ? value.error : undefined;
  if (error !== undefined && typeof error !== 'string') return null;

  return {
    at: value.at,
    job: value.job,
    status: value.status,
    owner: value.owner,
    error,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) {
    throw new RangeError('Night must use YYYY-MM-DD format');
  }

  const digest: NightDigest = {
    found: true,
    rows: [],
    badLines: 0,
    counts: { ok: 0, retry: 0, fail: 0 },
  };
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return { ...digest, found: false };
    }
    throw error;
  }

  const rows = new Map<string, DigestRow>();
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const event = parseEvent(line);
    if (event === null) {
      digest.badLines += 1;
      continue;
    }

    digest.counts[event.status] += 1;
    const row = rows.get(event.job) ?? {
      job: event.job,
      owner: event.owner,
      runs: 0,
      retries: 0,
      failures: 0,
      lastStatus: event.status,
      lastError: null,
      firstAt: event.at,
      lastAt: event.at,
    };
    row.runs += 1;
    row.retries += Number(event.status === 'retry');
    row.failures += Number(event.status === 'fail');
    row.owner = event.owner;
    row.lastStatus = event.status;
    row.lastError = event.error ?? row.lastError;
    row.lastAt = event.at;
    rows.set(event.job, row);
  }

  digest.rows = [...rows.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return digest;
};
