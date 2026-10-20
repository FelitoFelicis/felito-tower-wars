#!/usr/bin/env node
// v0.23: builds vendor/babylon-felito.js (minified) from tools/babylon/babylon-felito.full.js (the readable
// Babylon.js subset bundle). Usage: node tools/build-babylon.mjs   (needs esbuild: set ESBUILD=/path/to/esbuild,
// otherwise it runs `npx -y esbuild@0.28.2`).
//
// Trimming: the game makes every texture with B.DynamicTexture from a canvas and never loads a texture file
// by URL, nor a prefiltered cube texture. The bundle's only ways into the file-format loaders (.dds .env
// .hdr .ktx/.ktx2 .basis .tga .exr .ies) are the lazy `Promise.resolve().then(() => __req(N))` calls in the
// texture-loader registry and in createPrefilteredCubeTexture. Those calls are replaced by a rejected
// promise (a clear error should one ever be hit), and every module no longer reachable from the entry is
// removed. The script checks that no remaining module references a removed one.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const input = join(root, "tools/babylon/babylon-felito.full.js");
const output = join(root, "vendor/babylon-felito.js");
const CUT = {
  "packages/dev/core/src/Materials/Textures/Loaders/textureLoaderManager.ts": "texture file loaders",
  "packages/dev/core/src/Engines/Extensions/engine.prefilteredCubeTexture.pure.ts": "prefiltered cube textures",
};
const LAZY = /Promise\.resolve\(\)\.then\(\(\) => __req\((\d+)\)\)/g;

let src = readFileSync(input, "utf8");
const header = /^\/\* (.+?) \*\/\n__defs\[(\d+)\] = function \(exports, module\) \{\n/gm;
const parse = (text) => {
  const mods = [];
  let m;
  header.lastIndex = 0;
  while ((m = header.exec(text))) mods.push({ path: m[1], id: +m[2], start: m.index, bodyStart: header.lastIndex });
  const tail = text.lastIndexOf("\nglobalThis.BABYLON");
  mods.forEach((x, i) => (x.end = i + 1 < mods.length ? mods[i + 1].start : tail));
  return mods;
};

// 1. sever the lazy loader edges
for (const x of parse(src).reverse()) {
  if (!CUT[x.path]) continue;
  const body = src.slice(x.bodyStart, x.end);
  const cut = body.replace(LAZY, (_, id) => `Promise.reject(new Error("babylon-felito: ${CUT[x.path]} are not included (module ${id})"))`);
  if (cut === body) throw new Error("expected lazy requires in " + x.path);
  src = src.slice(0, x.bodyStart) + cut + src.slice(x.end);
}
// 2. drop everything the entry (module 0) can no longer reach
const mods = parse(src),
  byId = new Map(mods.map((x) => [x.id, x]));
for (const x of mods) x.deps = [...new Set([...src.slice(x.bodyStart, x.end).matchAll(/__req\((\d+)\)/g)].map((d) => +d[1]))];
const keep = new Set(),
  stack = [0];
while (stack.length) {
  const id = stack.pop();
  if (keep.has(id)) continue;
  if (!byId.has(id)) throw new Error("missing module " + id);
  keep.add(id);
  stack.push(...byId.get(id).deps);
}
const dropped = mods.filter((x) => !keep.has(x.id));
for (const x of [...dropped].reverse()) src = src.slice(0, x.start) + src.slice(x.end);
for (const x of parse(src)) {
  const refs = [...src.slice(x.bodyStart, x.end).matchAll(/__req\((\d+)\)/g)].map((d) => +d[1]);
  const bad = refs.filter((id) => !keep.has(id));
  if (bad.length) throw new Error(`${x.path} still references removed module(s) ${bad.join(", ")}`);
}
console.log(`removed ${dropped.length} modules (${dropped.reduce((a, x) => a + x.end - x.start, 0)} bytes):`);
for (const x of dropped) console.log("  " + x.path.replace("packages/dev/core/src/", ""));

// 3. minify
const tmp = join(mkdtempSync(join(tmpdir(), "babylon-")), "babylon-felito.trimmed.js");
writeFileSync(tmp, src);
const banner = "/* Babylon.js subset for Felito Tower Wars (Apache-2.0, see vendor/BABYLON-LICENSE.md). Built by tools/build-babylon.mjs from tools/babylon/babylon-felito.full.js */";
const args = [tmp, "--minify", "--target=es2020", "--charset=utf8", "--legal-comments=none", `--banner:js=${banner}`, `--outfile=${output}`, "--log-level=warning"];
if (process.env.ESBUILD) execFileSync(process.env.ESBUILD, args, { stdio: "inherit" });
else execFileSync("npx", ["-y", "esbuild@0.28.2", ...args], { stdio: "inherit" });
console.log(`vendor/babylon-felito.js: ${readFileSync(output).length} bytes (full: ${readFileSync(input).length} bytes)`);
