import { chromium } from '/home/user/Fusion/motion/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:5180/e2e/fixtures/app-screen.html'); await p.waitForTimeout(800);
await p.screenshot({ path: 'orbit-app.png' });
const q = await b.newPage({ viewport: { width: 512, height: 512 } });
await q.goto('http://localhost:5180/e2e/fixtures/logo.html'); await q.waitForTimeout(300);
await q.screenshot({ path: 'orbit-logo.png', omitBackground: true });
await b.close();
