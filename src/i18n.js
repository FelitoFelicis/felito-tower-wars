/**
 * Texts (v0.09h): the game is English only; strings in the code are the texts shown.
 * `t` only fills {name} placeholders, so callers stay unchanged if a language returns later.
 */
if (typeof document !== "undefined") document.documentElement.lang = "en";

/** Numbers in English format: 1,234.5 */
export const num = (n, opts = { maximumFractionDigits: 2 }) => Number(n || 0).toLocaleString("en-US", opts);
/** Gold: the full number up to 99,999; from 100,000 in k with one decimal; from 1,000,000 in k without. */
export function goldText(n) {
  const v = Math.abs(Number(n) || 0),
    sign = n < 0 ? "−" : "";
  if (v >= 1e6) return sign + num(Math.round(v / 1000), { maximumFractionDigits: 0 }) + "k";
  if (v >= 1e5) return sign + num(Math.floor(v / 100) / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "k";
  return sign + num(Math.floor(v + 1e-6), { maximumFractionDigits: 0 });
}

/** Text with {name} placeholders filled from `vars`. */
export function t(text, vars) {
  let s = String(text ?? "");
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? "") + "");
  return s;
}
