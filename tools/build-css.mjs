#!/usr/bin/env node
// v0.23: writes style.min.css from style.css (the commented source). No dependencies: node tools/build-css.mjs
// A conservative minifier: drops comments and needless whitespace, never touches strings, url(...),
// or spaces that carry meaning (descendant selectors, calc() operators, value lists).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "style.css"), "utf8");

export function minifyCss(css) {
  let out = "",
    i = 0,
    space = false;
  const n = css.length;
  // a pending whitespace is dropped next to these characters
  const tight = new Set(["{", "}", ";", ",", ">", "~", "!"]);
  const flush = (next) => {
    if (space && out && !tight.has(out[out.length - 1]) && !tight.has(next) && out[out.length - 1] !== ":" && next !== ")" && out[out.length - 1] !== "(") out += " ";
    space = false;
  };
  while (i < n) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      space = true;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      flush(c);
      out += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if ((c === "u" || c === "U") && /^url\(/i.test(css.slice(i, i + 4))) {
      let j = i + 4;
      while (j < n && css[j] !== ")") j += css[j] === "\\" ? 2 : 1;
      flush(c);
      out += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") {
      space = true;
      i++;
      continue;
    }
    // ">" and "~" are combinators only outside declarations' values; both are safe to tighten either way,
    // "+" is not (calc), so it keeps its spaces
    flush(c);
    if (c === "}" && out.endsWith(";")) out = out.slice(0, -1);
    out += c;
    i++;
  }
  return out.trim() + "\n";
}

const min = minifyCss(src);
writeFileSync(join(root, "style.min.css"), "/* generated from style.css by tools/build-css.mjs – edit style.css, then run: node tools/build-css.mjs */\n" + min);
console.log(`style.min.css: ${min.length} bytes (style.css: ${Buffer.byteLength(src)} bytes)`);
