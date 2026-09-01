/**
 * Verifies the DEPLOYED site actually works, not just that it returns 200.
 *
 * A static host will serve a blank page with a cheerful 200, so reachability
 * proves nothing. The things that break specifically on deployment are all
 * path-related, and each fails quietly:
 *
 *  - assets resolving against the domain root instead of /SkipboGolf/, which
 *    yields a white page and no error the user can act on;
 *  - the WEB WORKER failing to load, which is the dangerous one. The game
 *    renders perfectly and the opponents simply never take their turn, so it
 *    looks like a hang rather than a 404.
 *
 * So this plays real turns and asserts the opponents move.
 *
 * Usage: node scripts/deploy-check.mjs [url] [outDir]
 */
import { chromium, devices } from 'playwright';

const URL = process.argv[2] || 'https://joekazakos.github.io/SkipboGolf/';
const OUT = process.argv[3] || '.';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
};

const browser = await chromium.launch();

// ---------------------------------------------------------------------------
// 1. Desktop: load, assets, and a real game
// ---------------------------------------------------------------------------
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));
page.on('requestfailed', (r) => failedRequests.push(`${r.failure()?.errorText} ${r.url()}`));
page.on('response', (r) => {
  if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
});

console.log(`\nchecking ${URL}\n`);
const response = await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
check('page responds 200', response?.status() === 200, `status ${response?.status()}`);

await page.waitForTimeout(1500);

// The app mounts into #root; an unmounted React app is the classic base-path
// failure and looks identical to a server problem from the outside.
const mounted = await page.evaluate(() => (document.querySelector('#root')?.children.length ?? 0) > 0);
check('React app mounted', mounted);

const bodyChars = await page.evaluate(() => (document.body.textContent || '').length);
check('page has content', bodyChars > 200, `${bodyChars} characters`);

check('no failed requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));
check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

await page.screenshot({ path: `${OUT}/deploy-01-setup.png`, fullPage: true });

// Start a game. Three opponents keeps the run quick while still exercising
// multi-opponent turn order.
const opponentButton = page.getByRole('button', { name: '3 opponents' });
if (await opponentButton.count()) await opponentButton.first().click();
await page.getByRole('button', { name: /Deal the round/ }).first().click();
await page.waitForTimeout(2500);

const dealt = await page.locator('.seat--human .spot').count();
check('round dealt, human grid rendered', dealt === 10, `${dealt} spots`);
await page.screenshot({ path: `${OUT}/deploy-02-dealt.png`, fullPage: true });

// ---------------------------------------------------------------------------
// 2. Play turns, and prove the OPPONENTS move
// ---------------------------------------------------------------------------
// This is the worker test. If the worker 404s under the deployed base path the
// board still renders and the human can still act, but no opponent ever plays.
//
// Face-up is the absence of data-facedown, not a modifier class - an earlier
// version of this script guessed `.spot--up`, counted zero, and reported a
// broken deployment when the game was working perfectly.
const opponentUp = () =>
  page.locator('.seat--opponent .spot .card:not([data-facedown="true"])').count();
const opponentFaceUpBefore = await opponentUp();

// A turn is draw, then optionally place, then discard to END it. Placing alone
// leaves the human still in the act phase able to wave again, so a loop that
// only draws and places never yields the turn and the opponents never move -
// which is the other thing the earlier version got wrong.
let humanTurns = 0;
for (let turn = 0; turn < 4; turn++) {
  const centre = page.locator('button[aria-label^="Draw the center card"]:not([disabled])');
  const pile = page.locator('button[aria-label^="Draw from the face-down"]:not([disabled])');
  if (await centre.count()) await centre.first().click();
  else if (await pile.count()) await pile.first().click();
  else break;
  await page.waitForTimeout(400);

  const legal = page.locator('.seat--human button.spot--legal:not([disabled])');
  if (await legal.count()) {
    await legal.first().click();
    await page.waitForTimeout(400);
  }

  const discard = page.getByRole('button', { name: /Discard & end turn/i });
  if (await discard.count()) await discard.first().click();
  humanTurns += 1;

  // WAIT for the turn to come back rather than sleeping a guessed interval.
  // Three opponents each run a real search and the UI paces them deliberately,
  // so a fixed six seconds was not enough - and the loop then reported "the
  // human could only take one turn" when the game was simply still thinking.
  // Waiting on the condition is both faster when they are quick and correct
  // when they are not.
  await page
    .locator('button[aria-label^="Draw"]:not([disabled])')
    .first()
    .waitFor({ state: 'visible', timeout: 90000 })
    .catch(() => {});
}

check('human could take turns', humanTurns >= 3, `${humanTurns} turns`);

const opponentFaceUpAfter = await opponentUp();
check(
  'OPPONENTS ACTUALLY MOVED (web worker works)',
  opponentFaceUpAfter > opponentFaceUpBefore,
  `${opponentFaceUpBefore} -> ${opponentFaceUpAfter} face-up cards`,
);

await page.screenshot({ path: `${OUT}/deploy-03-played.png`, fullPage: true });

// The worker is a separate request under the base path; confirm it was fetched
// and served, rather than inferring it from behaviour alone.
const workerOk = await page.evaluate(async () => {
  const entries = performance.getEntriesByType('resource').map((e) => e.name);
  const worker = entries.find((n) => /worker.*\.js$/.test(n));
  if (!worker) return { found: false };
  const r = await fetch(worker, { method: 'GET' });
  return { found: true, url: worker, status: r.status };
});
check(
  'worker asset fetched under the deployed base path',
  workerOk.found && workerOk.status === 200,
  workerOk.found ? `${workerOk.status} ${workerOk.url.split('/').slice(-2).join('/')}` : 'no worker request seen',
);

// ---------------------------------------------------------------------------
// 3. Persistence, which is what makes a refresh not lose the game
// ---------------------------------------------------------------------------
const stored = await page.evaluate(() => Object.keys(localStorage).length);
check('state persisted to localStorage', stored > 0, `${stored} keys`);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const survived = await page.evaluate(() => (document.querySelector('#root')?.children.length ?? 0) > 0);
check('survives a reload', survived);

// ---------------------------------------------------------------------------
// 4. Mobile viewport, since the point of deploying is playing on a phone
// ---------------------------------------------------------------------------
const phone = await browser.newContext({ ...devices['iPhone 13'] });
const mobile = await phone.newPage();
const mobileErrors = [];
mobile.on('pageerror', (e) => mobileErrors.push(e.message));
await mobile.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await mobile.waitForTimeout(1500);

const mobileMounted = await mobile.evaluate(() => (document.querySelector('#root')?.children.length ?? 0) > 0);
check('mobile: app mounted', mobileMounted);

const overflow = await mobile.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check('mobile: no horizontal overflow', overflow <= 1, `${overflow}px`);
check('mobile: no page errors', mobileErrors.length === 0, mobileErrors.slice(0, 2).join(' | '));
await mobile.screenshot({ path: `${OUT}/deploy-04-mobile.png`, fullPage: true });

await browser.close();

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFAILURES:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('The deployed site is functional.');
