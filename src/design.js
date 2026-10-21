/**
 * Design variants: four looks for the same game.
 *   original  – Felix's night forest
 *   sonne     – "Sonnenwiese": daylight, the board as a floating meadow island, cream panels with brown outlines
 *   bonbon    – "Bonbon": flat candy colours, white sticker panels with thick navy outlines and hard shadows
 *   pets      – "Pfotenwelt": every tower and monster is a cute animal (kittens shoot, dogs guard), warm meadow
 * Sonnenwiese and Bonbon draw all figures as round toys (assets/art-toy), Pfotenwelt as animals
 * (assets/art-pets); both sets move with their own motion per figure (src/motion.js).
 * The choice is kept per browser (Options › Graphic › Design). Original stays the default; the new looks
 * are called "Circle Tower Wars". Everything else (rules, balance, online) is the same in all of them.
 */
export const DESIGNS = [
  // the game's UI is English: Sonnenwiese shows as "Meadow", Bonbon as "Candy", Pfotenwelt as "Paws"
  { id: "original", name: "Original" },
  { id: "sonne", name: "Meadow" },
  { id: "bonbon", name: "Candy" },
  { id: "pets", name: "Paws" },
];
const KEY = "felito.design";

/** Board colours per design (0xRRGGBB). "original" has none: the board keeps its painted tiles. */
export const BOARD = {
  sonne: {
    sky: [0xc4ecff, 0x92d6f4],
    cloud: 0xffffff,
    tileA: 0x98d862,
    tileB: 0x8acf55,
    grid: [0xffffff, 0.12],
    path: [0xefd193, 0xe8c680, 0xf2d79d, 0xeacb88],
    pathEdge: [0xc9a15c, 0.35],
    rim: 0x62b33d,
    rimLight: 0xb2e57a,
    soil: 0xa36d3c,
    soilDark: 0x7d522c,
    strip: 0xc2adff,
    stripDeep: 0x8f72e6,
    shadow: [0x3a7fa8, 0.25],
  },
  bonbon: {
    sky: [0x4fd8cf, 0x36bfb8],
    dots: [0xffffff, 0.16],
    tileA: 0xd0f170,
    tileB: 0xc1e85d,
    grid: [0xffffff, 0.22],
    path: [0xffcca0, 0xffc293, 0xffd2aa, 0xffc699],
    pathEdge: [0xf29a62, 0.3],
    outline: 0x23255c,
    inner: 0xffffff,
    strip: 0xff9fd0,
    stripDeep: 0xff5ea8,
    shadow: [0x23255c, 1],
  },
  pets: {
    sky: [0xffe8c6, 0xffd29e],
    paws: [0xffffff, 0.28],
    tileA: 0xa9de6e,
    tileB: 0x9cd462,
    grid: [0xffffff, 0.14],
    path: [0xf7dfb2, 0xf1d5a2, 0xf8e3bb, 0xf3d9a9],
    pathEdge: [0xd2a76a, 0.35],
    pathPaw: [0xc99a5b, 0.5],
    rim: 0x7cc44c,
    rimLight: 0xc6ee8f,
    soil: 0xc98b56,
    soilDark: 0x9c6a3f,
    strip: 0xffc2da,
    stripDeep: 0xf28cb9,
    shadow: [0xc0814f, 0.28],
  },
};
/** Props around the board per design, from the design's art set (see arena placeProps). */
const PROPS = {
  sonne: { trees: ["tree-green", "tree-orange", "tree-green", "tree-purple", "bush"], small: ["flowers", "mushrooms", "boulder", "lantern", "fence", "crystals"], gate: "portal", goal: "castle" },
  bonbon: { trees: ["tree-purple", "tree-orange", "tree-green", "bush"], small: ["mushrooms", "crystals", "flowers", "lantern", "boulder"], gate: "portal", goal: "castle" },
  pets: { trees: ["tree-green", "tree-blossom", "cat-tree", "tree-green", "bush"], small: ["yarn", "bowl", "bones", "flowers", "doghouse", "mushrooms"], gate: "portal", goal: "castle" },
};
export const boardProps = () => PROPS[currentDesign()] || null;

export const currentDesign = () => (typeof document !== "undefined" && document.documentElement.dataset.design) || "original";
export const boardPalette = () => BOARD[currentDesign()] || null;

export function setDesign(id) {
  if (!DESIGNS.some((d) => d.id === id)) id = "original";
  document.documentElement.dataset.design = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = id === "sonne" ? "#92d6f4" : id === "bonbon" ? "#36bfb8" : id === "pets" ? "#ffd29e" : "#173d35";
  // the two new looks carry the name Circle Tower Wars
  document.title = id === "original" ? document.title.replace(/Circle Tower Wars/g, "Felito Tower Wars") : document.title.replace(/Felito Tower Wars/g, "Circle Tower Wars");
}

let stored = null;
try {
  stored = localStorage.getItem(KEY);
} catch {}
setDesign(stored || "original");

/** Options › Graphic: one "Design" row like the Layout row. */
export const designRow = (t = (x) => x) =>
  `<div class="choice-row design-row" role="group" aria-label="${t("Design")}"><span>${t("Design")}</span>${DESIGNS.map(
    (d) => `<button type="button" class="choice-button${currentDesign() === d.id ? " active" : ""}" data-design="${d.id}" aria-pressed="${currentDesign() === d.id}">${t(d.name)}</button>`,
  ).join("")}</div>`;
