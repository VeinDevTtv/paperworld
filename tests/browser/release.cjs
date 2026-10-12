/* Browser regression tests with synthetic maps and mocked provider responses.
 * These verify the production UI/engine, NOT model quality, cameras or microphones.
 * Playwright is installed in an isolated CI tools folder; production dependencies
 * and the project's lockfile are deliberately not changed by this harness.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = process.cwd();
const out = path.join(root, '.local', 'ci-browser');
const baseURL = 'http://127.0.0.1:3100';
const initial = {
  locations: [
    { id: 'd', label: 'Depot', kind: 'depot', x: 10, y: 50 },
    { id: 'j', label: 'Junction', kind: 'junction', x: 40, y: 50 },
    { id: 'h', label: 'Home', kind: 'home', x: 80, y: 20 },
    { id: 's', label: 'Shop', kind: 'shop', x: 75, y: 80 },
  ],
  roads: [
    { id: 'dj', from: 'd', to: 'j', closed: false },
    { id: 'jh', from: 'j', to: 'h', closed: false },
    { id: 'js', from: 'j', to: 's', closed: false },
  ],
};
const blocked = { ...initial, roads: initial.roads.map(r => ({ ...r, closed: r.id === 'jh' })) };
const restored = { ...blocked, roads: [...blocked.roads, { id: 'sh', from: 's', to: 'h', closed: false }] };
const ready = {
  image: { provider: 'codex', ready: true, model: 'TEST FIXTURE', detail: 'mocked for UI tests' },
  command: { provider: 'codex', ready: true, model: 'TEST FIXTURE', detail: 'mocked for UI tests' },
  jev: { ready: true, model: 'TEST FIXTURE' },
  openaiApi: { enabled: false, ready: false, model: '' },
};
let server;
let browser;
let serverLog;

before(async () => {
  fs.mkdirSync(out, { recursive: true });
  serverLog = fs.createWriteStream(path.join(out, 'server.log'));
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3100'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', OPENAI_API_KEY: '', TYPESAFE_API_KEY: '', PAPERWORLD_ALLOW_PAID_API: 'false', PAPERWORLD_OPENAI_PROVIDER: 'codex' },
  });
  server.stdout.pipe(serverLog); server.stderr.pipe(serverLog);
  const deadline = Date.now() + 30000;
  let available = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Production server exited: ${server.exitCode}`);
    try { if ((await fetch(baseURL)).status === 200) { available = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(available, 'production server becomes ready');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve => {
      const timer = setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 3000);
      server.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
  serverLog?.end();
});

async function session(t, name, width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const state = { scanMap: initial, scans: 0, commands: 0, pending: null, delayCommand: false, failCommand: false, modes: [] };
  await page.route('**/api/providers', route => route.fulfill({ json: ready }));
  await page.route('**/api/parse-map', async route => {
    state.scans++;
    await route.fulfill({ json: { map: state.scanMap, provider: 'codex', model: 'TEST FIXTURE', latencyMs: 0, requiresReview: true, reviewReasons: [] } });
  });
  await page.route('**/api/command', async route => {
    state.commands++;
    const request = route.request().postDataJSON();
    state.modes.push(request.mode);
    if (state.delayCommand) await new Promise(resolve => { state.pending = resolve; });
    if (state.failCommand) return route.fulfill({ status: 503, json: { error: 'typesafe_request_failed' } });
    await route.fulfill({ json: {
      commands: [{ type: 'dispatch-delivery', from: 'd', to: 's', priority: 'urgent', courierId: 'courier-1' }],
      clarification: null, provider: request.mode === 'codex' ? 'codex' : 'typesafe', model: 'TEST FIXTURE', latencyMs: 0,
    } }).catch(() => {});
  });
  t.after(async () => {
    state.pending?.();
    await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify({ evidence: 'synthetic input / mocked providers / actual production UI and engine', width, scans: state.scans, commands: state.commands, modes: state.modes, pageErrors: errors }, null, 2));
    await context.close();
  });
  await page.goto(baseURL);
  await page.locator('#command-text').waitFor();
  return { page, state, errors };
}
async function scan(page, state, map, file = 'initial.png') {
  state.scanMap = map;
  const prior = state.scans;
  await page.locator('input[type=file]').setInputFiles(path.join(root, 'public', 'demo', file));
  await page.getByRole('button', { name: /^Confirm (map|changes)$/ }).click();
  assert.equal(state.scans, prior + 1, 'one provider request per explicit upload');
}
async function steps(page, n) {
  await page.locator('.run-controls').evaluate(el => { el.open = true; });
  for (let i = 0; i < n; i++) await page.getByRole('button', { name: 'Advance simulation by one second', exact: true }).click();
}
async function prepareRecovery(page, state) {
  await scan(page, state, initial);
  await page.getByRole('button', { name: 'Start deliveries', exact: true }).first().click();
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  await steps(page, 1);
  await scan(page, state, blocked, 'blocked.png');
  await steps(page, 3);
  assert.match(await page.getByLabel('Delivery status', { exact: true }).innerText(), /Waiting\s*1/);
  await scan(page, state, restored, 'reconnected.png');
}
async function compare(page) {
  await page.locator('.road-comparison').evaluate(el => { el.open = true; });
  await page.getByRole('button', { name: 'Compare latest road change', exact: true }).click();
  await page.getByTestId('comparison-readonly').waitFor();
}
async function leave(page) {
  await page.locator('.comparison-switch').getByRole('button', { name: 'Return to live world', exact: true }).click();
  await page.locator('#command-text').waitFor();
}
async function snapshot(page) {
  return page.evaluate(() => ({
    status: document.querySelector('[aria-label="Delivery status"]')?.textContent,
    time: document.querySelector('.simulation-clock strong')?.textContent,
    packages: [...document.querySelectorAll('.package-row')].map(el => el.textContent),
    couriers: [...document.querySelectorAll('.courier-row')].map(el => el.textContent),
    events: [...document.querySelectorAll('.event-list li')].map(el => el.textContent),
  }));
}

for (const width of [1280, 390]) test(`paper recovery and read-only comparison at ${width}px`, { timeout: 120000 }, async t => {
  const { page, state, errors } = await session(t, `recovery-${width}`, width);
  await prepareRecovery(page, state);
  const live = await snapshot(page);
  const calls = { scans: state.scans, commands: state.commands };
  await compare(page);
  assert.equal(await page.locator('#command-text').count(), 0, 'live command panel is not actionable in preview');
  assert.equal(await page.getByRole('button', { name: 'Upload & scan', exact: true }).isDisabled(), true);
  assert.match(await page.getByTestId('comparison-takeaway').innerText(), /pkg-1.*completes.*without it, it remains blocked/);
  await page.getByRole('button', { name: 'Without change', exact: true }).click();
  assert.match(await page.getByLabel('Delivery status', { exact: true }).innerText(), /Waiting\s*1/);
  await page.getByRole('button', { name: 'With change', exact: true }).click();
  assert.match(await page.getByLabel('Delivery status', { exact: true }).innerText(), /Delivered\s*2/);
  assert.deepEqual({ scans: state.scans, commands: state.commands }, calls, 'comparison makes no inference requests');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
  await page.screenshot({ path: path.join(out, `comparison-${width}.png`), fullPage: true });
  await leave(page);
  assert.deepEqual(await snapshot(page), live, 'previewing outcomes preserves the live observable state');
  await steps(page, 20);
  assert.match(await page.getByLabel('Delivery status', { exact: true }).innerText(), /Delivered\s*2/);
  assert.equal(await page.locator('.package-status-delivered').count(), 2);
  assert.deepEqual(errors, []);
});

test('pending and already-open commands cannot survive a comparison preview', { timeout: 120000 }, async t => {
  const { page, state, errors } = await session(t, 'stale-command');
  await prepareRecovery(page, state);
  const live = await snapshot(page);
  state.delayCommand = true;
  await page.locator('#command-text').fill('Send an urgent delivery from Depot to Shop');
  await page.getByRole('button', { name: 'Review command', exact: true }).click();
  while (!state.pending) await page.waitForTimeout(20);
  await compare(page);
  state.pending(); state.delayCommand = false;
  await leave(page);
  await page.waitForTimeout(150);
  assert.equal(await page.getByRole('button', { name: 'Confirm and apply', exact: true }).count(), 0);
  assert.deepEqual(await snapshot(page), live);
  await page.locator('#command-text').fill('Send an urgent delivery from Depot to Shop');
  await page.getByRole('button', { name: 'Review command', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and apply', exact: true }).waitFor();
  await compare(page);
  await leave(page);
  assert.equal(await page.getByRole('button', { name: 'Confirm and apply', exact: true }).count(), 0);
  assert.deepEqual(await snapshot(page), live);
  await steps(page, 20);
  state.failCommand = true;
  await page.locator('#command-text').fill('Send an urgent delivery from Depot to Shop');
  await page.getByRole('button', { name: 'Review command', exact: true }).click();
  await page.getByRole('button', { name: 'Use Codex', exact: true }).waitFor();
  const beforeFallback = state.commands;
  await page.waitForTimeout(100);
  assert.equal(state.commands, beforeFallback, 'no silent provider fallback');
  state.failCommand = false;
  await page.getByRole('button', { name: 'Use Codex', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and apply', exact: true }).click();
  assert.equal(state.modes.at(-1), 'codex');
  await steps(page, 30);
  assert.equal(await page.locator('.package-status-delivered').count(), 3);
  assert.deepEqual(errors, []);
});

test('camera permission denial leaves the world unchanged and makes no scan', { timeout: 60000 }, async t => {
  const { page, state, errors } = await session(t, 'camera-denial');
  const live = await snapshot(page);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied in test', 'NotAllowedError'); };
  });
  await page.getByRole('button', { name: 'Use camera', exact: true }).click();
  await page.getByText(/Camera permission was denied/).waitFor();
  assert.equal(state.scans, 0);
  assert.deepEqual(await snapshot(page), live);
  assert.deepEqual(errors, []);
});
