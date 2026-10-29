import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '',
};

let runsDir: string;

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  config.runsDir = runsDir;
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

function writeNight(night: string, content: string): void {
  writeFileSync(join(runsDir, `${night}.jsonl`), content, 'utf8');
}

function tableRows(html: string): Array<{ cells: string[]; className: string }> {
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  return [...tbody.matchAll(/<tr(?: class="([^"]*)")?>([\s\S]*?)<\/tr>/g)].map(
    ([, className = '', row]) => ({
      className,
      cells: [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(([, cell]) =>
        cell.replace(/<[^>]*>/g, '').trim(),
      ),
    }),
  );
}

describe('digest routes', () => {
  it('renders and returns the same sorted rows, with warnings and preserved data', async () => {
    writeNight(
      '2026-10-28',
      [
        '{malformed json',
        JSON.stringify({ at: '2026-10-28T01:00:00+05:30', job: 'zeta', status: 'retry', owner: 'Zed' }),
        JSON.stringify({ at: '2026-10-28T01:10:00+05:30', job: 'alpha', status: 'fail', owner: 'Ada', error: 'first attempt failed' }),
        JSON.stringify({ at: '2026-10-28T01:20:00+05:30', job: 'zeta', status: 'retry', owner: 'Zed' }),
        JSON.stringify({ at: '2026-10-28T01:30:00+05:30', job: 'beta', status: 'ok', owner: null }),
        JSON.stringify({ at: '2026-10-27T21:00:00-03:00', job: 'zeta', status: 'retry', owner: 'Zed' }),
        JSON.stringify({ at: '2026-10-27T21:10:00-03:00', job: 'zeta', status: 'ok', owner: 'Zed' }),
        JSON.stringify({ at: '2026-10-28T01:40:00+05:30', job: 'alpha', status: 'ok', owner: 'Ada' }),
      ].join('\n'),
    );

    const app = createApp(config);
    const [pageResponse, jsonResponse] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);

    expect(pageResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);

    const html = await pageResponse.text();
    const digest = await jsonResponse.json();
    const rows = tableRows(html);

    expect(digest).toMatchObject({
      found: true,
      badLines: 1,
      counts: { ok: 3, retry: 3, fail: 1 },
    });
    expect(digest.rows.map((row: { job: string }) => row.job)).toEqual(['alpha', 'beta', 'zeta']);
    expect(rows.map(({ cells }) => cells[0])).toEqual(digest.rows.map((row: { job: string }) => row.job));

    const [alpha, beta, zeta] = rows;
    expect(alpha.className).toBe('warn'); // Any fail event marks the row, even after a success.
    expect(beta.className).toBe('');
    expect(zeta.className).toBe('warn'); // Three retries mark the row.
    expect(beta.cells[1]).toBe('—');
    expect(html).toContain('2026-10-28T01:00:00+05:30');
    expect(html).toContain('2026-10-27T21:10:00-03:00');
    expect(digest.rows[2]).toMatchObject({
      firstAt: '2026-10-28T01:00:00+05:30',
      lastAt: '2026-10-27T21:10:00-03:00',
      retries: 3,
    });
  });

  it('returns 404 for missing nights and invalid night formats', async () => {
    const app = createApp(config);

    for (const path of ['/digest/2026-10-28', '/api/digest/2026-10-28', '/digest/today', '/api/digest/today']) {
      const response = await app.request(path);
      expect(response.status).toBe(404);
    }
  });

  it('serves an empty file as an empty digest and says nothing ran on the page', async () => {
    writeNight('2026-10-29', '');
    const app = createApp(config);

    const [pageResponse, jsonResponse] = await Promise.all([
      app.request('/digest/2026-10-29'),
      app.request('/api/digest/2026-10-29'),
    ]);

    expect(pageResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(await pageResponse.text()).toContain('nothing ran');
    expect(await jsonResponse.json()).toEqual({
      found: true,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });
});
