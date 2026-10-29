import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const temporaryDirs: string[] = [];
const night = '2026-10-28';

function runsDir(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  temporaryDirs.push(dir);
  if (contents !== undefined) writeFileSync(join(dir, `${night}.jsonl`), contents);
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('night reader', () => {
  it('digests the real fixture without changing offsets or dropping the null owner', () => {
    const digest = readNight('runs', night);
    expect(digest.found).toBe(true);
    expect(digest.badLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest.rows).toEqual([
      { job: 'digest/render', owner: null, runs: 1, retries: 0, failures: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
      { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, failures: 0, lastStatus: 'ok', lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
      { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, failures: 0, lastStatus: 'ok', lastError: 'lock held', firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
      { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, failures: 1, lastStatus: 'fail', lastError: 'quota exceeded', firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
      { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, failures: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
    ]);
  });

  it('uses log order, retains earlier failures, and keeps the last supplied error', () => {
    const events = [
      { at: '2026-10-29T02:00:00+05:30', job: 'z', owner: 'first', status: 'fail', error: 'first error' },
      { at: '2026-10-28T23:00:00-03:00', job: 'a', owner: null, status: 'ok' },
      { at: '2026-10-29T01:00:00+05:30', job: 'z', owner: 'second', status: 'retry', error: 'last error' },
      { at: '2026-10-29T00:00:00+05:30', job: 'z', owner: null, status: 'ok' },
    ];
    const digest = readNight(runsDir(events.map((event) => JSON.stringify(event)).join('\n')), night);
    expect(digest.rows.map((row) => row.job)).toEqual(['a', 'z']);
    expect(digest.rows[1]).toEqual({
      job: 'z', owner: null, runs: 3, retries: 1, failures: 1,
      lastStatus: 'ok', lastError: 'last error',
      firstAt: '2026-10-29T02:00:00+05:30', lastAt: '2026-10-29T00:00:00+05:30',
    });
    expect(digest.counts).toEqual({ ok: 2, retry: 1, fail: 1 });
  });

  it('counts malformed JSON and invalid event records while recovering later valid lines', () => {
    const valid = { at: '2026-10-29T00:00:00+01:00', job: 'kept', owner: null, status: 'ok' };
    const invalid: unknown[] = [
      null, [], 3, 'text', {},
      { ...valid, status: 'unknown' },
      { ...valid, owner: 5 },
      { at: valid.at, job: valid.job, status: valid.status },
      { ...valid, at: 'not a timestamp' },
      { ...valid, job: '  ' },
      { ...valid, error: null },
    ];
    const contents = ['{broken', ...invalid.map((event) => JSON.stringify(event)), '', '  ', JSON.stringify(valid), ''].join('\r\n');
    const digest = readNight(runsDir(contents), night);
    expect(digest.badLines).toBe(invalid.length + 1);
    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0].job).toBe('kept');
    expect(digest.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('distinguishes missing, empty, and entirely damaged nights', () => {
    const empty = { found: true, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
    expect(readNight(runsDir(), night)).toEqual({ ...empty, found: false });
    expect(readNight(runsDir(''), night)).toEqual(empty);
    expect(readNight(runsDir('\n \r\n'), night)).toEqual(empty);
    expect(readNight(runsDir('bad\n{}'), night)).toEqual({ ...empty, badLines: 2 });
  });

  it('rejects unsafe night names before accessing files', () => {
    const dir = runsDir();
    for (const invalid of ['../2026-10-28', '/2026-10-28', '2026-10-28/extra', '2026-10-28\0', '2026-1-2']) {
      expect(() => readNight(dir, invalid)).toThrow(RangeError);
    }
  });

  it('does not misreport other filesystem failures as missing nights', () => {
    const dir = runsDir();
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrow();
  });
});
