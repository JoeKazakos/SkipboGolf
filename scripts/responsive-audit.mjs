/**
 * Audits the app across a matrix of real device viewports.
 *
 * Reports horizontal overflow, elements wider than the viewport, and tap
 * targets below the 44px accessibility minimum, then screenshots each.
 *
 * Usage: node scripts/responsive-audit.mjs <screenshot-dir> [--table]
 * Requires the dev server on :5173.
 */
import { chromium } from 'playwright';

const OUT = process.argv[2] || '.';

const VIEWPORTS = [
  { name: 'phone-se', width: 375, height: 667, mobile: true },
  { name: 'phone-14', width: 393, height: 852, mobile: true },
  { name: 'phone-xl', width: 430, height: 932, mobile: true },
  { name: 'phone-landscape', width: 852, height: 393, mobile: true },
  { name: 'tablet-port', width: 768, height: 1024, mobile: true },
  { name: 'tablet-land', width: 1024, height: 768, mobile: false },
  { name: 'laptop', width: 1440, height: 900, mobile: false },
  { name: 'desktop-xl', width: 1920, height: 1080, mobile: false },
];

/** Measures layout problems that a screenshot alone would not make obvious. */
async function measure(page, viewportWidth, isTouch) {
  return page.evaluate(([vw, touch]) => {
    const problems = [];
    if (touch && !matchMedia('(pointer: coarse)').matches) {
      problems.push({ kind: 'emulation-warning', detail: 'touch viewport but pointer is not coarse' });
    }

    const docWidth = document.documentElement.scrollWidth;
    if (docWidth > vw + 1) {
      problems.push({ kind: 'page-overflow', detail: `scrollWidth ${docWidth} > ${vw}` });
    }

    // Any element sticking out past the right edge of the viewport.
    const wide = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1) {
        const cls = typeof el.className === 'string' ? el.className : '';
        wide.push(`${el.tagName.toLowerCase()}.${cls.split(' ')[0]} right=${Math.round(r.right)}`);
      }
    }
    if (wide.length) problems.push({ kind: 'element-overflow', detail: [...new Set(wide)].slice(0, 6) });

    // Interactive controls too small to tap reliably. A touch-input standard,
    // so it is not applied to mouse-driven viewports.
    const small = [];
    if (!touch) return problems;
    for (const el of document.querySelectorAll('button, select, summary, a')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 || r.width < 24) {
        const cls = typeof el.className === 'string' ? el.className : '';
        small.push(`${cls.split(' ')[0] || el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    if (small.length) problems.push({ kind: 'small-tap-target', detail: [...new Set(small)].slice(0, 8) });

    return problems;
  }, [viewportWidth, isTouch]);
}

const browser = await chromium.launch();
const report = [];

/**
 * Opens a fresh context for one measurement.
 *
 * Each screen gets its own context because a fullPage screenshot disturbs
 * Chromium's device emulation: after one is taken, `pointer: coarse` stops
 * matching, and everything measured afterwards is silently scored against
 * desktop rules. Measuring in a clean context avoids that false signal.
 */
async function open(vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    deviceScaleFactor: vp.mobile ? 2 : 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  return { context, page, errors };
}

for (const vp of VIEWPORTS) {
  // Pass 1: the setup screen. Measure before screenshotting.
  const a = await open(vp);
  const setupProblems = await measure(a.page, vp.width, vp.mobile);
  await a.page.screenshot({ path: `${OUT}/r-${vp.name}-setup.png`, fullPage: true });
  await a.context.close();

  // Pass 2: the table, in a clean context so emulation is intact.
  const b2 = await open(vp);
  await b2.page.getByRole('button', { name: /Deal the round/ }).click();
  await b2.page.waitForTimeout(1100);
  const tableProblems = await measure(b2.page, vp.width, vp.mobile);
  await b2.page.screenshot({ path: `${OUT}/r-${vp.name}-table.png`, fullPage: false });
  await b2.context.close();

  report.push({
    viewport: `${vp.name} ${vp.width}x${vp.height}`,
    setup: setupProblems,
    table: tableProblems,
    errors: [...a.errors, ...b2.errors],
  });
}

await browser.close();

for (const row of report) {
  const clean = row.setup.length === 0 && row.table.length === 0 && row.errors.length === 0;
  console.log(`\n=== ${row.viewport} ${clean ? 'OK' : 'PROBLEMS'}`);
  for (const [screen, list] of [['setup', row.setup], ['table', row.table]]) {
    for (const p of list) {
      console.log(`  [${screen}] ${p.kind}: ${JSON.stringify(p.detail)}`);
    }
  }
  for (const e of row.errors) console.log(`  [error] ${e}`);
}
