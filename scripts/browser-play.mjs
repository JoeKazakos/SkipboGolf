/**
 * Drives a full Skip-Bo Golf game in a real browser.
 * Usage: node scripts/browser-play.mjs <screenshot-dir>
 * Requires the dev server to be running on :5173.
 */
import { chromium } from 'playwright';

const OUT = process.argv[2] || '.';
const W = Number(process.env.PLAY_WIDTH ?? 1440);
const H = Number(process.env.PLAY_HEIGHT ?? 950);
const TOUCH = process.env.PLAY_TOUCH === '1';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: W, height: H },
  isMobile: TOUCH,
  hasTouch: TOUCH,
  deviceScaleFactor: TOUCH ? 2 : 1,
});
const page = await context.newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
// The setup screen now precedes the table.
const deal = page.getByRole('button', { name: /Deal the round/ });
if (await deal.count()) {
  const opponents = process.env.PLAY_OPPONENTS;
  if (opponents) {
    await page.getByRole('button', { name: opponents, exact: true }).click();
    await page.waitForTimeout(200);
  }
  await deal.click();
  await page.waitForTimeout(900);
}
await page.getByRole('button', { name: 'Fast' }).click();

const log = [];
const note = (m) => { log.push(m); console.log(m); };

/** Buttons that are enabled and represent a playable spot in the human grid. */
function humanSpots() {
  return page.locator('.seat--human button.spot--legal:not([disabled])');
}

let humanTurns = 0;
let totalPlacements = 0;
let waveChains = 0;
let maxChain = 0;
let guard = 0;
const deadline = Date.now() + Number(process.env.PLAY_TIMEOUT_MS ?? 240000);

while (Date.now() < deadline) {
  guard++;
  if (guard > 4000) { note('GUARD: too many iterations'); break; }

  if (await page.locator('.gameover, .game-over').count() > 0) {
    note('Game over screen reached');
    break;
  }

  // Is it the human's turn with something to do?
  const centre = page.locator('button[aria-label^="Draw the centre card"]:not([disabled])');
  const pile = page.locator('button[aria-label^="Draw from the face-down"]:not([disabled])');
  const discard = page.getByRole('button', { name: /Discard & end turn/i });

  if (await pile.count() > 0 || await centre.count() > 0) {
    if (await centre.count() > 0) { await centre.first().click(); note('human: took centre card'); }
    else { await pile.first().click(); note('human: drew from pile'); }
    await page.waitForTimeout(120);

    // Place into the first legal spot, then chain any legal waves.
    let placements = 0;
    while (placements < 10) {
      const spots = await humanSpots().count();
      if (spots === 0) break;
      const label = await humanSpots().first().getAttribute('aria-label');
      await humanSpots().first().click();
      placements++;
      await page.waitForTimeout(70);
      if (placements > 1) note(`  wave ${placements - 1}: into ${label}`);
    }
    if (placements > 0) {
      totalPlacements += placements;
      if (placements > 1) waveChains++;
      maxChain = Math.max(maxChain, placements);
      note(`human: ${placements} placement(s) this turn`);

      // The spots played this turn must now be locked (section 15.1).
      const stillLegal = await humanSpots().count();
      const lockedCount = await page.locator('.seat--human button.spot[disabled]').count();
      if (placements >= 1 && lockedCount < 1) {
        note(`  WARNING: expected locked spots after ${placements} placements, found ${lockedCount}`);
      }
      note(`  spots still legal: ${stillLegal}, locked/disabled: ${lockedCount}`);
    }

    if (await discard.isEnabled().catch(() => false)) {
      await discard.click();
      humanTurns++;
      note(`human: discarded, turn ${humanTurns} complete`);
    }
    await page.waitForTimeout(200);
    continue;
  }

  // Otherwise the opponents are playing; wait for them.
  await page.waitForTimeout(300);
}

await page.screenshot({ path: `${OUT}/02-final.png`, fullPage: true });

const finalState = await page.evaluate(() => {
  const txt = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ');
  return {
    banner: txt(document.querySelector('.turn-banner, .banner, header') || document.body).slice(0, 200),
    gameOver: !!document.querySelector('.gameover, .game-over'),
    bodyTail: txt(document.body).slice(-400),
  };
});

console.log('\n=== RESULT ===');
console.log(
  JSON.stringify(
    { humanTurns, totalPlacements, waveChains, maxChain, finalState, errors },
    null,
    2,
  ),
);
await browser.close();
