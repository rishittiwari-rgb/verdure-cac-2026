// Fresh production-build page rendering; no submissions or external services.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
const origin = process.env.VERDURE_LEGAL_TEST_URL || "http://127.0.0.1:3105";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const chrome = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const context = await chrome.newContext({ viewport: { width: 1280, height: 900 } });
await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const page = await context.newPage(), errors = [];
page.on("pageerror", error => errors.push(error.message));
let checks = 0;
function check(name, value) { assert.ok(value, name); console.log(`PASS ${name}`); checks++; }
try {
  // The first browser request after next start is deliberately not pre-warmed.
  await page.goto(`${origin}/support`);
  await page.locator('form[data-ready="true"]').waitFor();
  check("cold production support page hydrates", await page.getByRole("button", { name: "Send support request", exact: true }).isVisible());
  check("unhydrated fallback uses POST with a fixed destination", await page.locator("form").getAttribute("method") === "post" && await page.locator("form").getAttribute("action") === "/api/submissions");
  for (const [path, title] of [["/terms", "Terms of Service"], ["/privacy", "Privacy Policy"]]) {
    const response = await page.goto(`${origin}${path}`);
    check(`${path} resolves locally`, response.status() === 200 && await page.getByRole("heading", { name: title, exact: true }).count() === 1);
    check(`${path} has linked contents and support`, await page.locator('nav[aria-label="On this page"] a').count() >= 10 && await page.locator('a[href="/support"]').count() >= 1);
    await page.setViewportSize({ width: 390, height: 844 });
    check(`${path} mobile has no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `/tmp/verdure-${path.slice(1)}-mobile.png` });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  const text = await page.locator("main").innerText();
  check("privacy explains forms, independent retention and provider requests", ["Support requests store", "immutable audit", "Anthropic", "separate from app account deletion", "Vercel Web Analytics"].every(value => text.includes(value)));
  check("legacy shipping and payment-provider claims removed", !["Shipping and billing address", "Apple Pay or Google Pay", "shopping cart", "logistics and courier"].some(value => text.includes(value)));
  await page.goto(`${origin}/partnerships#interest`);
  await page.waitForFunction(() => document.querySelectorAll('form[data-ready="true"]').length === 2);
  check("production partnership forms hydrate", await page.locator("form").count() === 2);
  const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
  check("terms and support are in sitemap", sitemap.includes("https://verdure-app.com/terms") && sitemap.includes("https://verdure-app.com/support"));
  const website = await readFile(new URL("../src/lib/legal.ts", import.meta.url), "utf8");
  const swift = await readFile(new URL("../../Verdure/Verdure/Models/Legal.swift", import.meta.url), "utf8");
  for (const [constant, name] of [["PRIVACY_SECTIONS", "privacySections"], ["TERMS_SECTIONS", "termsSections"]]) {
    const webSections = JSON.parse(website.split(`export const ${constant}: LegalSection[] = `)[1].split(";\n")[0]);
    const appSections = [...swift.split(`static let ${name}: [Section] = [`)[1].split("\n    ]")[0].matchAll(/Section\(title: ("(?:\\.|[^"\\])*"),\s*body: ("(?:\\.|[^"\\])*?")\)/g)].map(match => ({ title: JSON.parse(match[1]), body: JSON.parse(match[2]) }));
    assert.deepEqual(appSections, webSections.map(({ title, body }) => ({ title, body })));
    check(`${name} app and website copy match exactly`, appSections.length >= 10);
  }
  await page.goto(`${origin}/pricing`);
  check("pricing includes the working offline-pack benefit", await page.getByText("Offline park and place packs", { exact: true }).count() === 1);
  const pricing = await page.locator("main").innerText();
  check("pricing explains seven-day packs without selling base imagery", pricing.includes("Packs last seven days") && pricing.includes("Background map imagery is not included") && pricing.includes("trail overviews are free") && !/offline maps/i.test(pricing));
  const paywall = await readFile(new URL("../../Verdure/Verdure/Views/Paywall/PaywallView.swift", import.meta.url), "utf8");
  const listing = await readFile(new URL("../../AppStore/LISTING.md", import.meta.url), "utf8");
  check("native paywall and listing match the offline-pack pricing benefit", [paywall, listing].every(copy => copy.includes("Offline park and place packs") && copy.includes("background map imagery is not included")));
  check("no page JavaScript errors", errors.length === 0);
  console.log(`${checks} legal and production-page checks passed`);
} finally { await context.close(); await chrome.close(); }
