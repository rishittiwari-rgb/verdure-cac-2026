// Screenshots of the sub-pages + the reduced-motion static fallback.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let URL = process.env.VERDURE_URL || "http://localhost:3002/";
let OUT = path.resolve("reference/verdure/subpages");

function findChromium()
{
  let root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
  let best = null;
  if (fs.existsSync(root))
  {
    let entries = fs.readdirSync(root);
    for (let i = 0; i < entries.length; i++)
    {
      let e = entries[i];
      if (!/^chromium-/.test(e)) continue;
      let candidates = ["chrome-win64\\chrome.exe", "chrome-win\\chrome.exe"];
      for (let j = 0; j < candidates.length; j++)
      {
        let p = path.join(root, e, candidates[j]);
        if (fs.existsSync(p))
        {
          if (best === null || p > best) best = p;
        }
      }
    }
  }
  return best;
}

fs.mkdirSync(OUT, { recursive: true });
let exe = findChromium();
let browser = await chromium.launch(exe ? { executablePath: exe } : { channel: "chrome" });

let context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
let page = await context.newPage();

let pages = [
  ["story", "story"],
  ["partnerships", "partnerships"],
  ["login", "login"],
];
for (let i = 0; i < pages.length; i++)
{
  await page.goto(URL + pages[i][0], { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, pages[i][1] + "-top.png") });
  if (pages[i][0] !== "login")
  {
    await page.evaluate(function () { window.scrollTo(0, document.body.scrollHeight * 0.45); });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, pages[i][1] + "-mid.png") });
  }
}
await context.close();

// reduced-motion static fallback
let rmContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
let rmPage = await rmContext.newPage();
await rmPage.goto(URL, { waitUntil: "load", timeout: 60000 });
await rmPage.waitForTimeout(1500);
await rmPage.screenshot({ path: path.join(OUT, "rm-hero.png") });
await rmPage.evaluate(function () { window.scrollTo(0, document.body.scrollHeight * 0.3); });
await rmPage.waitForTimeout(800);
await rmPage.screenshot({ path: path.join(OUT, "rm-mid.png") });
await rmContext.close();

await browser.close();
console.log("subpages done");
