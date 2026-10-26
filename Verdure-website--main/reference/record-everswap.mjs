// Records everswap.com exactly as specified in Phase 0:
//  - video passes at 1440x900 and 390x844 (constant-velocity + slow eased pass)
//  - measurement stills at 2% virtual-scroll increments
//  - interaction stills (preloader, CTA hover, dots, card hover, footer)
// Usage: node reference/record-everswap.mjs [desktop|mobile|stills]
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let OUT = path.resolve("reference/everswap");

function findChromium()
{
  let root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
  let best = null;
  if (fs.existsSync(root))
  {
    let entries = fs.readdirSync(root);
    for (let i = 0; i < entries.length; i++)
    {
      let e = entries.charAt ? entries[i] : entries[i];
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

async function launch()
{
  let exe = findChromium();
  let opts = { headless: true };
  if (exe) opts.executablePath = exe;
  else opts.channel = "chrome";
  return await chromium.launch(opts);
}

async function waitReady(page)
{
  // preloader flips a `.is-ready` class when the scene is loaded
  try
  {
    await page.waitForFunction(function ()
    {
      let h = document.documentElement;
      let b = document.body;
      return h.classList.contains("is-ready") || b.classList.contains("is-ready");
    }, null, { timeout: 90000 });
  }
  catch (err)
  {
    console.log("is-ready never appeared, continuing after fixed wait");
  }
  await page.waitForTimeout(2500);
}

async function measureTotal(page)
{
  return await page.evaluate(function ()
  {
    let el = document.querySelector("#pages-container");
    let h = el ? el.getBoundingClientRect().height : 0;
    return { pagesHeight: h, vh: window.innerHeight, vw: window.innerWidth };
  });
}

async function wheelBy(page, total, pxPerStep, msPerStep)
{
  let sent = 0;
  while (sent < total)
  {
    let d = Math.min(pxPerStep, total - sent);
    await page.mouse.wheel(0, d);
    sent = sent + d;
    await page.waitForTimeout(msPerStep);
  }
}

async function videoPass(browser, viewport, label)
{
  let dir = path.join(OUT, "video-" + label);
  fs.mkdirSync(dir, { recursive: true });
  let context = await browser.newContext({
    viewport: viewport,
    recordVideo: { dir: dir, size: viewport },
    userAgent: viewport.width < 500
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : undefined,
  });
  let page = await context.newPage();
  await page.goto("https://everswap.com/", { waitUntil: "load", timeout: 60000 });
  await waitReady(page);
  let m = await measureTotal(page);
  console.log(label, "pagesHeight:", m.pagesHeight, "vh:", m.vh);
  let total = Math.max(m.pagesHeight - m.vh, m.vh * 18);
  await page.mouse.move(viewport.width / 2, viewport.height / 2);

  // PASS 1: constant velocity (~1400 px/s of wheel input)
  await page.waitForTimeout(1500);
  await wheelBy(page, total, 45, 32);
  await page.waitForTimeout(2500);

  // back to top fast
  await page.mouse.wheel(0, -total * 2);
  await page.waitForTimeout(3000);

  // PASS 2: slow pass with eased pauses around each section boundary
  // boundaries in px derived from vh multiples of each section length
  let bounds = [2, 8, 9.75, 14.75, 16.75, 19.75, 20.75];
  let prev = 0;
  for (let i = 0; i < bounds.length; i++)
  {
    let target = Math.min(bounds[i] * m.vh, total);
    let dist = target - prev;
    if (dist > 0) await wheelBy(page, dist, 25, 24);
    await page.waitForTimeout(1600);
    prev = target;
  }
  await page.waitForTimeout(2000);
  await context.close();
  console.log("video saved for", label);
}

async function measurementStills(browser)
{
  let dir = path.join(OUT, "frames");
  fs.mkdirSync(dir, { recursive: true });
  let context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await context.newPage();
  await page.goto("https://everswap.com/", { waitUntil: "load", timeout: 60000 });
  await waitReady(page);
  let m = await measureTotal(page);
  let total = Math.max(m.pagesHeight - m.vh, m.vh * 18);
  await page.mouse.move(720, 450);
  let sent = 0;
  for (let pct = 0; pct <= 100; pct = pct + 2)
  {
    let target = Math.round(total * pct / 100);
    let d = target - sent;
    if (d > 0)
    {
      await wheelBy(page, d, 60, 16);
      sent = target;
    }
    await page.waitForTimeout(900);
    let name = "p" + String(pct).padStart(3, "0") + ".png";
    await page.screenshot({ path: path.join(dir, name) });
  }
  await context.close();
  console.log("frames done, total px:", total);
}

async function interactionStills(browser)
{
  let dir = path.join(OUT, "stills");
  fs.mkdirSync(dir, { recursive: true });
  let context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await context.newPage();

  // preloader sequence
  await page.goto("https://everswap.com/", { waitUntil: "commit", timeout: 60000 });
  for (let i = 0; i < 8; i++)
  {
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(dir, "preloader-" + i + ".png") });
  }
  await waitReady(page);
  await page.screenshot({ path: path.join(dir, "hero.png") });

  // nav CTA hover (text swap)
  let cta = page.locator("#site-header__cta");
  await cta.hover();
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(dir, "cta-hover-mid.png") });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(dir, "cta-hover.png") });
  await page.mouse.move(720, 450);

  // side dots after scrolling into everblade
  let m = await measureTotal(page);
  await wheelBy(page, m.vh * 3.2, 60, 16);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(dir, "dots-everblade.png") });
  let dot = page.locator("#navbar li").nth(3);
  await dot.hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(dir, "dot-hover.png") });

  // audience cards
  await wheelBy(page, m.vh * 9.3, 60, 16);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(dir, "everyone.png") });
  let card = page.locator("#home-everyone__borrowers");
  try
  {
    await card.hover({ timeout: 3000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(dir, "card-hover.png") });
  }
  catch (err)
  {
    console.log("card hover skipped");
  }

  // pool CTA + footer
  await wheelBy(page, m.vh * 6, 60, 16);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(dir, "pool.png") });
  await wheelBy(page, m.vh * 3, 60, 16);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(dir, "footer.png") });
  let joinBtn = page.locator("#home-join__buttons a").first();
  try
  {
    await joinBtn.hover({ timeout: 3000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(dir, "footer-hover.png") });
  }
  catch (err)
  {
    console.log("footer hover skipped");
  }
  await context.close();
  console.log("stills done");
}

let mode = process.argv[2] || "all";
let browser = await launch();
try
{
  if (mode === "desktop" || mode === "all") await videoPass(browser, { width: 1440, height: 900 }, "desktop");
  if (mode === "mobile" || mode === "all") await videoPass(browser, { width: 390, height: 844 }, "mobile");
  if (mode === "stills" || mode === "all")
  {
    await interactionStills(browser);
    await measurementStills(browser);
  }
}
finally
{
  await browser.close();
}
console.log("DONE " + mode);
