import { chromium } from 'playwright';

const OUT = process.argv[2] || '.';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

await page.screenshot({ path: `${OUT}/01-initial.png`, fullPage: true });

const summary = await page.evaluate(() => {
  const txt = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ');
  const buttons = [...document.querySelectorAll('button')].map((b) => ({
    text: txt(b).slice(0, 60),
    disabled: b.disabled,
    cls: b.className.slice(0, 70),
    aria: b.getAttribute('aria-label'),
  }));
  return {
    title: document.title,
    rootChildren: document.querySelector('#root')?.children.length ?? 0,
    bodyChars: (document.body.textContent || '').length,
    buttonCount: buttons.length,
    buttons: buttons.slice(0, 40),
    headings: [...document.querySelectorAll('h1,h2,h3')].map((h) => txt(h)),
  };
});

console.log(JSON.stringify({ summary, errors }, null, 2));
await browser.close();
