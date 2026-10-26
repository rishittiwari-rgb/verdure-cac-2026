// Records the Verdure build with the SAME protocol used on the reference:
// video passes at 1440x900 and 390x844, measurement stills at 2% scroll
// increments, and interaction stills. Compare against reference/everswap/.
// Usage: node reference/record-verdure.mjs [desktop|mobile|stills|frames] [passN]
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let URL = process.env.VERDURE_URL || "http://localhost:3000/";
let PASS = process.argv[3] || "pass1";
let OUT = path.resolve("reference/verdure");

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
  try
  {
    await page.waitForFunction(function ()
    {
      let p = document.getElementById("preloader");
      return p === null || getComputedStyle(p).display === "none";
    }, null, { timeout: 30000 });
  }
  catch (err)
  {
    console.log("preloader never finished; continuing");
  }
  await page.waitForTimeout(2600);
}

async function measureTotal(page)
{
  return await page.evaluate(function ()
  {
    return {
      total: document.documentElement.scrollHeight,
      vh: window.innerHeight,
      vw: window.innerWidth,
    };
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
  let dir = path.join(OUT, "video-" + label + "-" + PASS);
  fs.mkdirSync(dir, { recursive: true });
  let context = await browser.newContext({
    viewport: viewport,
    recordVideo: { dir: dir, size: viewport },
  });
  let page = await context.newPage();
  await page.goto(URL, { waitUntil: "load", timeout: 60000 });
  await waitReady(page);
  let m = await measureTotal(page);
  console.log(label, "scrollHeight:", m.total, "vh:", m.vh);
  let total = m.total - m.vh;
  await page.mouse.move(viewport.width / 2, viewport.height / 2);

  // PASS 1: constant velocity
  await page.waitForTimeout(1500);
  await wheelBy(page, total, 45, 16);
  await page.waitForTimeout(2500);
  await context.close();
  console.log("video saved for", label);
}

async function measurementStills(browser)
{
  let dir = path.join(OUT, "frames-" + PASS);
  fs.mkdirSync(dir, { recursive: true });
  let context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await context.newPage();
  await page.goto(URL, { waitUntil: "load", timeout: 60000 });
  await waitReady(page);
  let m = await measureTotal(page);
  let total = m.total - m.vh;
  await page.mouse.move(720, 450);
  for (let pct = 0; pct <= 100; pct = pct + 2)
  {
    let target = Math.round(total * pct / 100);
    await page.evaluate(function (y)
    {
      window.scrollTo(0, y);
    }, target);
    await page.waitForTimeout(650);
    let name = "p" + String(pct).padStart(3, "0") + ".png";
    await page.screenshot({ path: path.join(dir, name) });
  }
  await context.close();
  console.log("frames done, total px:", total);
}

async function interactionStills(browser)
{
  let dir = path.join(OUT, "stills-" + PASS);
  fs.mkdirSync(dir, { recursive: true });
  let context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await context.newPage();

  await page.goto(URL, { waitUntil: "commit", timeout: 60000 });
  for (let i = 0; i < 5; i++)
  {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(dir, "preloader-" + i + ".png") });
  }
  await waitReady(page);
  await page.screenshot({ path: path.join(dir, "hero.png") });

  let cta = page.locator("nav .pill").first();
  try
  {
    await cta.hover({ timeout: 3000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(dir, "cta-hover.png") });
  }
  catch (err)
  {
    console.log("cta hover skipped");
  }
  await page.mouse.move(720, 450);

  let m = await measureTotal(page);
  let vh = m.vh;
  let shots = [
    ["habit-title", 3.2],
    ["habit-night", 5.0],
    ["glow", 8.6],
    ["loop-1", 10.6],
    ["loop-2", 12.2],
    ["everyone-2", 17.2],
    ["rediscovered", 20.6],
    ["game", 22.6],
    ["team", 25.4],
    ["roadmap", 28.2],
    ["plans", 30.6],
    ["onemap", 33.0],
    ["join", 35.2],
  ];
  for (let i = 0; i < shots.length; i++)
  {
    await page.evaluate(function (y)
    {
      window.scrollTo(0, y);
    }, Math.round(shots[i][1] * vh));
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(dir, shots[i][0] + ".png") });
  }

  // mobile sweep
  await context.close();
  let mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let mpage = await mctx.newPage();
  await mpage.goto(URL, { waitUntil: "load", timeout: 60000 });
  await waitReady(mpage);
  await mpage.screenshot({ path: path.join(dir, "m-hero.png") });
  let mm = await measureTotal(mpage);
  let mShots = [
    ["m-habit", 4.4],
    ["m-loop", 11.4],
    ["m-onemap", 33.0],
    ["m-join", 35.2],
  ];
  for (let i = 0; i < mShots.length; i++)
  {
    await mpage.evaluate(function (y)
    {
      window.scrollTo(0, y);
    }, Math.round(mShots[i][1] * mm.vh));
    await mpage.waitForTimeout(900);
    await mpage.screenshot({ path: path.join(dir, mShots[i][0] + ".png") });
  }
  await mctx.close();
  console.log("stills done");
}

let mode = process.argv[2] || "stills";
let browser = await launch();
try
{
  if (mode === "desktop" || mode === "all") await videoPass(browser, { width: 1440, height: 900 }, "desktop");
  if (mode === "mobile" || mode === "all") await videoPass(browser, { width: 390, height: 844 }, "mobile");
  if (mode === "stills" || mode === "all") await interactionStills(browser);
  if (mode === "frames" || mode === "all") await measurementStills(browser);
}
finally
{
  await browser.close();
}
console.log("DONE " + mode + " " + PASS);
