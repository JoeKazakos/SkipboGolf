import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:375,height:667}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
const p = await ctx.newPage();
await p.goto('http://localhost:5173/', { waitUntil:'networkidle' });
await p.getByRole('button', { name: /Deal the round/ }).click();
await p.waitForTimeout(1100);
const r = await p.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('button')) {
    const rect = el.getBoundingClientRect();
    if (!rect.width) continue;
    const cs = getComputedStyle(el);
    out.push({
      cls: el.className.trim().slice(0, 28),
      rectH: Math.round(rect.height),
      cssH: cs.height,
      minH: cs.minHeight,
    });
  }
  return { coarse: matchMedia('(pointer: coarse)').matches, buttons: out.slice(0, 10) };
});
console.log(JSON.stringify(r, null, 2));
await b.close();
