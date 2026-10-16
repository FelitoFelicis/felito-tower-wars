/**
 * Screenshots of 3D models from tools/model-preview.html (needs a local server on port 8080:
 * `python3 -m http.server 8080` in the repository folder).
 *
 *   node tools/model-shots.mjs --models t-archer,t-footman --out shots/models [--tier 1] [--yaw 0]
 *        [--size 420] [--walk 0] [--sheet]   (--sheet: one image with all models instead of one per model)
 *
 * Prints triangle counts per model. Playwright is taken from PLAYWRIGHT_MODULE or the global install.
 */
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]);
    return acc;
  }, []),
);
const mod = process.env.PLAYWRIGHT_MODULE || "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const { chromium } = await import(mod);
const exe = fs.existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined;
const out = args.out || "shots/models";
fs.mkdirSync(out, { recursive: true });
const base = args.base || "http://localhost:8080/tools/model-preview.html";
const size = Number(args.size || 420);
const models = (args.models || "").split(",").filter(Boolean);
const common = `tier=${args.tier || 1}&yaw=${args.yaw || 0}&walk=${args.walk || 0}` + (args.pitch ? `&pitch=${args.pitch}` : "") + (args.tilt ? `&tilt=${args.tilt}` : "") + (args.plate === "0" ? "&plate=0" : "") + (args.kind ? `&kind=${args.kind}` : "");
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
async function shot(list, file, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${base}?${common}${list.length ? "&models=" + list.join(",") : ""}${list.length === 1 ? "&labels=0" : ""}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: file });
  return page.evaluate(() => window.__stats);
}
if (args.sheet || !models.length) {
  const n = models.length || 20,
    cols = Math.min(n, Math.ceil(Math.sqrt(n * 1.6)));
  const stats = await shot(models, path.join(out, args.name || "sheet.png"), Math.min(2400, cols * 260), Math.min(1800, Math.ceil(n / cols) * 300));
  console.log(stats.map((s) => `${s.key}: ${s.triangles ?? "ERROR"} triangles`).join("\n"));
} else
  for (const m of models) {
    const stats = await shot([m], path.join(out, `${m}${args.tier && args.tier !== "1" ? "-t" + args.tier : ""}${args.yaw && args.yaw !== "0" ? "-side" : ""}.png`), size, size);
    console.log(stats.map((s) => `${s.key}: ${s.triangles ?? "ERROR"} triangles`).join("\n"));
  }
if (errors.length) console.log("ERRORS:\n" + [...new Set(errors)].join("\n"));
await browser.close();
