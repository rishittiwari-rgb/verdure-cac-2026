// Identify a public calendar platform before choosing an ingestion adapter.
// Usage: node scripts/fingerprint.mjs events.scu.edu [other.host ...]
// Read-only: probes public pages and feed endpoints; never writes Firestore.

const hosts = process.argv.slice(2);
if (!hosts.length) {
  console.error("Usage: node scripts/fingerprint.mjs <hostname> [hostname ...]");
  process.exit(2);
}

const standardProbes = [
  ["LiveWhale JSON v2", "/live/json/v2/events/max/1/hide_repeats/true"],
  ["LiveWhale iCal", "/live/ical/events"],
  ["Localist API", "/api/2/events?days=1&pp=1"],
  ["CivicPlus RSS index", "/rss.aspx"],
];

function validHost(host) {
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host)
    && host.includes(".") && !host.includes("..")
    && !/^(localhost|127\.|10\.|192\.168\.|172\.)/i.test(host);
}

async function read(url, maxBytes = 200_000) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Verdure-source-survey/1.0 (+https://verdure-app.com)" },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    // Cap response bytes: platform identification needs only the beginning.
    const reader = res.body?.getReader();
    let text = "";
    if (reader) {
      const decoder = new TextDecoder();
      while (text.length < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      await reader.cancel().catch(() => {});
    }
    return { status: res.status, type: res.headers.get("content-type") ?? "", url: res.url, text };
  } catch (e) {
    return { status: "error", type: "", url, text: "", error: e instanceof Error ? e.message : String(e) };
  }
}

function htmlEvidence(html) {
  const generator = /<meta\b[^>]*name=["']generator["'][^>]*content=["']([^"']+)/i.exec(html)
    ?? /<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']generator["']/i.exec(html);
  const signals = [];
  if (/\/Home\/Components\/Calendar\/Event\//i.test(html)) signals.push("CivicPlus event URLs");
  if (/\/browse\/groups|\/event\/[a-z0-9-]+/i.test(html)) signals.push("Localist-style URLs");
  if (/\/live\/(?:json|ical|rss)\//i.test(html)) signals.push("LiveWhale feed URLs");
  if (/bibliocommons\.com\/events\/search/i.test(html)) signals.push("BiblioCommons event URLs");
  if (/\/month\/categories\//i.test(html)) signals.push("Trumba-style URLs");
  return { generator: generator?.[1] ?? "not found", signals };
}

function platform(host, home, results) {
  const evidence = htmlEvidence(home.text);
  if (/livewhale/i.test(evidence.generator)) return ["LiveWhale", "meta generator"];
  if (/localist/i.test(evidence.generator)) return ["Localist", "meta generator"];
  if (/civicplus/i.test(evidence.generator)) return ["CivicPlus", "meta generator"];
  if (/drupal/i.test(evidence.generator)) return ["Drupal", "meta generator"];
  if (/bibliocommons\.com$/i.test(host)) return ["BiblioCommons", "host"];
  if (/\.libcal\.com$/i.test(host) && /springshare|libcal/i.test(home.text)) return ["LibCal", "calendar host"];
  if (/\.legistar\.com$/i.test(host) && results["Legistar Events API"]?.status === 200) return ["Legistar", "public Web API"];
  if (results["LiveWhale JSON v2"]?.status === 200 &&
      /"meta"\s*:\s*\{|"data"\s*:\s*\[/.test(results["LiveWhale JSON v2"].text)) {
    return ["LiveWhale", "JSON v2 feed"];
  }
  if (results["Localist API"]?.status === 200 &&
      /"events"\s*:\s*\[/.test(results["Localist API"].text)) {
    return ["Localist", "API response"];
  }
  if (results["CivicPlus RSS index"]?.status === 200 &&
      /RSSFeed\.aspx|ModID=/i.test(results["CivicPlus RSS index"].text)) {
    return ["CivicPlus", "RSS index"];
  }
  if (evidence.signals.length) return ["candidate only", evidence.signals.join(", ")];
  return ["unknown", "no positive platform signal"];
}

for (const host of hosts) {
  if (!validHost(host)) {
    console.error(`Invalid hostname: ${host}`);
    process.exitCode = 2;
    continue;
  }
  const base = `https://${host}`;
  const probes = [...standardProbes];
  let calendarPage;
  if (host.endsWith(".libcal.com")) {
    calendarPage = await read(`${base}/calendar`);
    const calendarId = /<option\s+value="(\d+)"\s+data-cal_id="\1"/i.exec(calendarPage.text)?.[1];
    if (calendarId) probes.push(["LibCal RSS", `/rss.php?m=month&cid=${calendarId}`]);
  }
  if (host.endsWith(".legistar.com") && host !== "webapi.legistar.com") {
    const client = host.split(".")[0];
    probes.push(["Legistar Events API", `https://webapi.legistar.com/v1/${client}/events?$top=1`]);
  }
  if (host.endsWith(".bibliocommons.com")) {
    const library = host.split(".")[0];
    probes.push(["BiblioCommons gateway", `https://gateway.bibliocommons.com/v2/libraries/${library}/events?limit=1`]);
  }
  const home = await read(base);
  const robots = await read(`${base}/robots.txt`, 50_000);
  const results = {};
  for (const [name, path] of probes) results[name] = await read(path.startsWith("https://") ? path : `${base}${path}`, 50_000);
  const [detected, reason] = platform(host, home, results);
  const evidence = htmlEvidence(home.text);
  console.log(`\n## ${host}`);
  console.log(`Platform: ${detected} (${reason})`);
  console.log(`Home: ${home.status}; meta generator: ${evidence.generator}`);
  console.log(`robots.txt: ${robots.status}; terms: manual review required before HTML scraping`);
  if (calendarPage) console.log(`Calendar page: ${calendarPage.status}`);
  console.log("| Endpoint | HTTP | Type | Final host |");
  console.log("| --- | ---: | --- | --- |");
  for (const [name] of probes) {
    const r = results[name];
    let finalHost = "—";
    try { finalHost = new URL(r.url).host; } catch {}
    console.log(`| ${name} | ${r.status} | ${r.type || "—"} | ${finalHost} |`);
  }
  console.log("A 403, a 404, and a working endpoint are separate findings. Review source terms before any HTML parser.");
}
