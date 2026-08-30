/**
 * Renders public/favicon.svg to the raster icons that some platforms still
 * need. Re-run after editing the SVG:  node scripts/make-icons.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('public/favicon.svg', 'utf8');
const browser = await chromium.launch();

async function render(size, out, scheme = 'light') {
  const ctx = await browser.newContext({
    viewport: { width: size, height: size },
    colorScheme: scheme,
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.setContent(
    `<html><body style="margin:0">
       <div style="width:${size}px;height:${size}px">${svg}</div>
     </body></html>`,
  );
  await page.waitForTimeout(120);
  const buf = await page.screenshot({ omitBackground: true });
  writeFileSync(out, buf);
  await ctx.close();
  console.log(`wrote ${out} (${size}x${size})`);
}

// iOS home screen. Always the light mark: iOS composites it on its own
// wallpaper, not on browser chrome.
await render(180, 'public/apple-touch-icon.png');
// A legibility proof at real favicon size, kept out of the build.
await render(16, process.argv[2] ? `${process.argv[2]}/icon-16.png` : 'icon-16.png');
await render(32, process.argv[2] ? `${process.argv[2]}/icon-32.png` : 'icon-32.png');

await browser.close();
