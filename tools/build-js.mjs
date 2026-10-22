#!/usr/bin/env node
// v0.24j: minified copies of the game's modules for publishing: build/src/*.js (one file per module, same names and
// imports, so index.html and the import map stay as they are). Publish build/src/x.js under the path src/x.js.
// The source in src/ stays the readable, commented original. Needs esbuild: npm install, then node tools/build-js.mjs
import { readdirSync, mkdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src"),
  outDir = join(root, "build", "src");
mkdirSync(outDir, { recursive: true });
let before = 0,
  after = 0;
for (const name of readdirSync(srcDir).filter((f) => f.endsWith(".js"))) {
  const code = readFileSync(join(srcDir, name), "utf8");
  const out = await transform(code, {
    loader: "js",
    format: "esm",
    target: "es2022",
    minify: true, // whitespace, syntax and local names; exported names and imports stay
    legalComments: "none",
    charset: "utf8",
  });
  writeFileSync(join(outDir, name), out.code);
  before += statSync(join(srcDir, name)).size;
  after += out.code.length;
  console.log(`${name.padEnd(18)} ${String(code.length).padStart(8)} → ${String(out.code.length).padStart(8)} bytes`);
}
console.log(`total ${before} → ${after} bytes (${Math.round((100 * after) / before)} %)`);
