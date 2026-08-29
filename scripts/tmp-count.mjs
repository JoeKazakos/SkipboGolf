import { chromium } from 'playwright';
const OUT = process.argv[2];
const b = await chromium.launch();
for (const n of [1, 2, 6]) {
  const ctx = await b.newContext({ viewport:{width:1440,height:900} });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  await p.goto('http://localhost:5173/', { waitUntil:'networkidle' });
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: String(n), exact: true }).click();
  await p.waitForTimeout(200);
  await p.getByRole('button', { name: /Deal the round/ }).click();
  await p.waitForTimeout(1200);
  const info = await p.evaluate(() => ({
    opponentSeats: document.querySelectorAll('.seat--opponent').length,
    humanSeats: document.querySelectorAll('.seat--human').length,
    cols: getComputedStyle(document.querySelector('.opponents')).gridTemplateColumns.split(' ').length,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  console.log(n, JSON.stringify({ ...info, errors }));
  await p.screenshot({ path: `${OUT}/count-${n}.png` });
  await ctx.close();
}
await b.close();
