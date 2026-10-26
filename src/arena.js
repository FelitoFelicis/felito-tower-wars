import { getStats, attackInfo, divineShield, isHeavy, isMagicTower, isMeleeTower, towerAt, towerSize, footprintOf, STRIP, HELLFIRE, loneActive, zoneOf, hpBarScale, tierSends, laneRows, baseRows } from "./simulation.js";
/** v0.19j: is this send one of the 4 most expensive non-boss creeps of its tier? (heavy HP-bar frame) */
const TOP_FOUR = new Map();
function topFour(def) {
  if (!def?.isSend || !def.tier) return true;
  if (!TOP_FOUR.has(def.id)) {
    const list = tierSends(def.tier).filter((x) => !x.bossTier);
    TOP_FOUR.set(def.id, list.findIndex((x) => x.id === def.id) >= list.length - 4);
  }
  return TOP_FOUR.get(def.id);
}
import { ART_MANIFEST, ANIM_MANIFEST, animUrl, artFor, artUrl, towerTier, TEAM_COLORS, CLOTH_COLORS, recolorTeam, activeArtSet, artSetFor, useArtSet, setArtKey, setArtMeta, setPropUrl, SET_ART } from "./art.js";
// v0.23n: design variants removed: no per-figure motion profiles (motion.js) any more
const towerIdle = () => ({ lean: 0, stretch: 1 }),
  towerAttack = () => null,
  towerAttackStyle = () => null,
  creepGait = () => null;
/** v0.22n2: mix a colour towards another (0 = black, 0xffffff = white) by k. */
const metalTint = (hex, to, k) => {
  const ch = (c, sh) => ((c >> sh) & 255) * (1 - k) + ((to >> sh) & 255) * k;
  return (Math.round(ch(hex, 16)) << 16) | (Math.round(ch(hex, 8)) << 8) | Math.round(ch(hex, 0));
};
import { t } from "./i18n.js";
import { Stage, BLEND, TINT, hsvToColor } from "./b2d.js";
// v0.23n: only the original board (design.js removed)
const boardPalette = () => null,
  currentDesign = () => "original",
  boardProps = () => null;

export { artFor, artUrl };

const NO_PATH = []; // v0.23
const ANIM_KEY = {}; // v0.23: art key -> "anim:" + key, built once
/** v0.23b: Options › Gameplay › Tiles: "checkers" (lighter and darker fields, default), "grid" (plain grid), "none" (no grid lines). */
let tileMode = "checkers";
/**
 * v0.23f/i: a corner of a creep's path walked as a curve: a quadratic Bézier from r before the corner (x1, y1)
 * to r after it (from x0 → x1 to x1 → x2). `p` (the creep's point) is moved onto the curve when it lies within r
 * of the corner, either coming up to it (`ahead`) or just past it. Returns true when p was moved.
 */
/** v0.23g: a fixed 0..1 value per creep (its own corner radius); kept beside the creep, not in the game state. */
const VARY = new WeakMap();
function varyOf(c) {
  let v = VARY.get(c);
  if (v === undefined) VARY.set(c, (v = (((parseInt(String(c.id).replace(/\D/g, ""), 10) || 0) * 2654435761) >>> 0) / 4294967296));
  return v;
}
/** v0.23i: a node of a creep's path (-1 = the node it came from), or null. */
function pathNode(c, k) {
  const n = k >= 0 ? c.path[k] : k === -1 ? c.prevNode : null;
  return n && Number.isFinite(n.x) ? n : null;
}
function cornerTo(x0, y0, x1, y1, x2, y2, p, cell, vary, ahead) {
  let ix = x1 - x0,
    iy = y1 - y0,
    jx = x2 - x1,
    jy = y2 - y1;
  const li = Math.hypot(ix, iy),
    lj = Math.hypot(jx, jy);
  if (li < 1e-6 || lj < 1e-6) return false;
  ix /= li;
  iy /= li;
  jx /= lj;
  jy /= lj;
  if (ix * jx + iy * jy > 0.94) return false; // straight on (< 20°)
  const r = Math.min(cell * (0.3 + 0.32 * vary), li / 2, lj / 2), // v0.23g: every creep its own radius
    d = ahead ? Math.hypot(x1 - p.x, y1 - p.y) : Math.hypot(p.x - x1, p.y - y1);
  if (d >= r) return false;
  const t = ahead ? (r - d) / (2 * r) : 0.5 + d / (2 * r),
    u = 1 - t,
    ex = x1 - ix * r,
    ey = y1 - iy * r,
    xx = x1 + jx * r,
    xy = y1 + jy * r;
  p.x = u * u * ex + 2 * u * t * x1 + t * t * xx;
  p.y = u * u * ey + 2 * u * t * y1 + t * t * xy;
  return true;
}
const byDepth = (p, q) => p.depth - q.depth; // v0.23i
const DEATH_KEY = {}; // v0.23a (creep graphic overhaul): art key -> "anim:" + key + "-death" (or null), built once
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const lerp = (a, b, t) => a + (b - a) * t;
const FONT = "Lilita One, DM Sans, system-ui, sans-serif";

/** Projectile and impact colours per element; plain arrows are warm gold. */
const ELEMENT_COLOR = {
  water: 0x8fe1ff,
  fire: 0xff8a45,
  storm: 0xd4c6ff,
  earth: 0xe9b86e,
  arcane: 0xff7fe6,
  plague: 0xa6f06a,
};
function shotStyle(def) {
  const color = ELEMENT_COLOR[def?.element] ?? (def?.attackType === "siege" ? 0x3b302a : 0xffe28a);
  const splash = (def?.splashFull || 0) + (def?.splashMedium || 0) + (def?.splashSmall || 0) > 0;
  return { color, splash, glow: !!ELEMENT_COLOR[def?.element], size: splash ? 4.4 : def?.attackType === "magic" ? 3.6 : 2.6 };
}
/** Small deterministic hash for per-cell variation. */
const hash = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** A whole, square-cell portrait board fitted between the real HUD and dock, with room for a stone frame. */
/** `a` blended towards `b` by t, then brightness scaled by k (0x-colour in, 0x-colour out). */
function mixColor(a, b, t, k = 1) {
  const ch = (c, sh) => (c >> sh) & 255,
    mix = (sh) => Math.max(0, Math.min(255, Math.round((ch(a, sh) * (1 - t) + ch(b, sh) * t) * k)));
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}
/** Within a send tier the cheap creeps are drawn small and the expensive ones large. */
const CREEP_SIZE = new Map();
let creepSizeCatalog = null;
function creepSize(catalog, id) {
  if (creepSizeCatalog !== catalog) {
    CREEP_SIZE.clear();
    creepSizeCatalog = catalog;
    const tiers = new Map();
    for (const s of catalog.sends || []) {
      if (s.bossTier || !s.tier) continue;
      if (!tiers.has(s.tier)) tiers.set(s.tier, []);
      tiers.get(s.tier).push(s);
    }
    for (const list of tiers.values()) {
      list.sort((a, b) => a.cost - b.cost);
      list.forEach((s, i) => {
        // v0.16g: wider spread from the weakest to the strongest creep, +1 % per tier above 1
        const f = (0.68 + (0.6 * i) / Math.max(1, list.length - 1)) * tierGrowth(s.tier);
        for (const unit of [s.id, ...(s.spawnIds || [])]) if (!CREEP_SIZE.has(unit)) CREEP_SIZE.set(unit, f);
      });
    }
  }
  return (CREEP_SIZE.get(id) ?? 1) * (SIZE_BOOST[id] || 1);
}
const tierGrowth = (tier) => 1 + 0.01 * Math.max(0, (tier || 1) - 1);
/** Creeps drawn larger than their rank alone would make them. */
const SIZE_BOOST = { n00S: 1.3, nAGO: 1.45, n00P: 0.95, n02W: 0.6, n02Z: 0.65, n034: 0.65, n02Y: 0.65, n036: 0.65, n037: 0.65 }; // tier 1 Raiders, v0.12: Arcane Golem; v0.21p: little Naga Sirens; v0.24s: Flying Sheep 5 % smaller, small Spawn Spider spawns
/** v0.17d: mobile layout B is switched on by a class on <html> (set by the app). */
const layoutB = () => typeof document !== "undefined" && document.documentElement.classList.contains("layout-b");
/** Mobile Max: the board fills the whole screen width and runs under the HUD and the buttons. */
const layoutFull = () => typeof document !== "undefined" && document.documentElement.classList.contains("layout-full");
/**
 * v0.24r: a lane grows by 3 rows with every tier upgrade (simulation.js laneRows). `grid.rows` is the lane's
 * current height, `grid.total` the full grid (where creeps are measured), `grid.base` the starting height that
 * sets the cell size. When the grown lane is taller than the screen, the board scrolls up and down (`lane`).
 */
export function arenaGeometry(width, height, grid = { cols: 6, rows: 9 }, mode = "build", insets = { top: 84, bottom: 172 }, scrollY = 0) {
  const z = baseGeometry(width, height, grid, mode, insets, scrollY),
    total = grid?.total || z.logicalRows;
  z.totalRows = total;
  z.ny = z.ch * total; // height of one unit of creep y (creeps are measured in the full grid)
  if (!z.scroll) {
    const bottom = z.h - Math.max(0, insets?.bottom || 0) - 4,
      end = z.top + z.bh + (z.frameV || 5) + 6;
    if (end > bottom + 1) z.scroll = { lo: 0, hi: end - bottom, def: 0, lane: true };
  }
  return z;
}
function baseGeometry(width, height, grid = { cols: 6, rows: 9 }, mode = "build", insets = { top: 84, bottom: 172 }, scrollY = 0) {
  const w = Math.max(1, width),
    h = Math.max(1, height),
    logicalCols = grid.cols,
    logicalRows = grid.rows,
    safeTop = Math.max(0, insets.top),
    safeBottom = Math.max(0, insets.bottom),
    frame = 13,
    // v0.12: thin wall above and below the board, so the board can use the full height
    frameV = 5;
  const availableHeight = Math.max(9, h - safeTop - safeBottom - frameV * 2),
    fitRows = Math.min(logicalRows, grid?.base || logicalRows), // v0.24r: the cell size follows the starting height
    byHeight = availableHeight / (fitRows + STRIP); // v0.09: no exit strip below the board
  // Mobile Max: the board is as wide as the screen and taller than the free space between the
  // HUD and the cards. It sits in world space from y = 0 down; the camera scrolls over it
  // (`scrollY` = world y at the top edge of the screen). Level button and mini map float in the top
  // corners, the auto slot and the abilities in a row above the cards.
  if (layoutFull()) {
    const fr = 7,
      cell = Math.max(1, (w - fr * 2) / logicalCols),
      bw = cell * logicalCols,
      bh = cell * logicalRows,
      strip = cell * STRIP,
      left = fr,
      top = frameV + strip,
      sideW = clamp(Math.round(w * 0.1), 38, 52),
      band = sideW + 42,
      // v0.17o: no enemy mini map in Mobile Max, only the level button in the top corner
      clearTop = safeTop + 8 + sideW * 1.3,
      clearBottom = h - safeBottom - band,
      // lo: the first row right below the corner buttons; hi: the last row right above the bottom row
      lo0 = top - clearTop,
      hi0 = top + bh + 4 - clearBottom,
      fits = hi0 <= lo0,
      centre = top + bh / 2 - (clearTop + clearBottom) / 2,
      lo = fits ? centre : lo0,
      hi = fits ? centre : hi0;
    return {
      w, h, mode, mini: false, rotated: false, passive: mode !== "build",
      logicalCols, logicalRows, cols: logicalCols, rows: logicalRows,
      left, top, bw, bh, cw: cell, ch: cell, frame: fr, frameV, strip,
      full: true,
      scroll: { lo, hi, def: (lo + hi) / 2 },
      clearTop,
      clearBottom,
      pip: null,
      side: { x: 6, y: safeTop + 6 - 14, w: sideW, full: true },
    };
  }
  // v0.17d: mobile layout B: no mini map; one button column right of the board (options and help on
  // top, level and auto slot in the middle, Build and Send at the bottom), so the board can grow.
  if (layoutB()) {
    const colGap = 5,
      edgeLeft = frame + 4,
      // the column takes what a full-height board leaves free, at least 76 px (two 36 px squares)
      colW = clamp(Math.floor(w - edgeLeft - frame - colGap - 4 - logicalCols * byHeight), 76, 96),
      colReserve = frame + colGap + colW + 4,
      cell = Math.max(1, Math.min(Math.max(5, w - edgeLeft - colReserve) / logicalCols, byHeight)),
      bw = cell * logicalCols,
      bh = cell * logicalRows,
      strip = cell * STRIP,
      left = edgeLeft + Math.max(0, (w - edgeLeft - colReserve - bw) / 2),
      top = safeTop + frameV + strip + Math.max(0, (availableHeight - bh - strip) / 2),
      sq = Math.floor((colW - 4) / 2),
      slot = Math.round(colW * 0.62),
      col = { x: left + bw + frame + colGap, y: top - strip, w: colW, h: bh + strip, sq };
    return {
      w, h, mode, mini: false, rotated: false, passive: mode !== "build",
      logicalCols, logicalRows, cols: logicalCols, rows: logicalRows,
      left, top, bw, bh, cw: cell, ch: cell, frame, frameV, strip,
      pip: null,
      col,
      side: { x: col.x + (colW - slot) / 2, y: col.y + sq + 8 - 14, w: slot, layoutB: true },
    };
  }
  // A portrait mini map of the other lane sits in its own column right of the board, never over it.
  // v0.12: side columns shrink (down to 38 px) and sit tighter so the board can reach full height.
  const layout = (pipW) => {
    const pipGap = 4,
      edge = 3,
      pipReserve = frame + pipGap + pipW + edge,
      sideReserve = frame + 3 + pipW + 3,
      edgeLeft = frame + 4,
      twoColumns = Math.min(Math.max(5, w - 2 * (frame + 6)) / logicalCols, Math.max(5, w - sideReserve - pipReserve) / logicalCols, byHeight),
      // Narrow screens (v0.07l): one column right of the board holds mini map, level button and auto slot.
      oneColumn = Math.min(Math.max(5, w - edgeLeft - pipReserve) / logicalCols, byHeight),
      compact = oneColumn > twoColumns * 1.02;
    return { pipW, pipGap, pipReserve, sideReserve, edgeLeft, compact, cell: Math.max(1, compact ? oneColumn : twoColumns) };
  };
  let L = layout(clamp(Math.round(w * 0.1), 38, 60));
  for (let pw = L.pipW - 2; pw >= 38 && L.cell < byHeight - 0.01 && !L.compact; pw -= 2) {
    const next = layout(pw);
    if (next.cell <= L.cell) break;
    L = next;
  }
  const { pipW, pipGap, pipReserve, sideReserve, edgeLeft, compact, cell } = L,
    pipH = (pipW * logicalRows) / logicalCols,
    sideW = pipW,
    sideGap = 3;
  const bw = cell * logicalCols,
    bh = cell * logicalRows,
    strip = cell * STRIP,
    left = compact ? edgeLeft + Math.max(0, (w - edgeLeft - pipReserve - bw) / 2) : Math.max(sideReserve, Math.min((w - bw) / 2, w - pipReserve - bw)),
    top = safeTop + frameV + strip + Math.max(0, (availableHeight - bh - strip) / 2);
  let pip = { x: left + bw + frame + pipGap, y: top - strip, w: pipW, h: pipH },
    // compact: the level button sits below the mini map and its label
    side = compact ? { x: pip.x, y: pip.y + pipH + 36, w: pipW, compact: true } : { x: left - frame - sideGap - sideW, y: top - strip, w: sideW };
  // v0.24p: Desktop Wide: the mini maps sit beside the player windows (app.js), the level button right of the board
  if (layoutWide()) {
    side = { x: pip.x, y: pip.y, w: pipW, wide: true };
    pip = null;
  }
  return {
    w,
    h,
    mode,
    mini: false,
    rotated: false,
    passive: mode !== "build",
    logicalCols,
    logicalRows,
    cols: logicalCols,
    rows: logicalRows,
    left,
    top,
    bw,
    bh,
    cw: cell,
    ch: cell,
    frame,
    frameV,
    strip,
    pip,
    side,
  };
}

const layoutWide = () => typeof document !== "undefined" && document.documentElement.classList.contains("layout-wide");
/** Mini map of the other lane: portrait, in its own column beside the board. */
export function pipGeometry(z) {
  return z.pip;
}

/**
 * Towers draw 5 % smaller than their field. Levels 1–3 stay nearly the same size; from level 4 a
 * figure grows slowly (v0.08a: level 5 now has the size level 3 had, level 7 that of level 5 …).
 */
/** v0.21o: the shimmering tier aura round towers of level 4 and up (off on the user's request). */
const TIER_AURA = false;
const TOWER_SCALE = 0.95;
const LEVEL_SCALE = [0.92, 0.92, 0.925, 0.93, 0.965, 1, 1.04, 1.08, 1.12, 1.16];
const levelScale = (level) => LEVEL_SCALE[Math.max(1, Math.min(9, level | 0))];
/** Level badge colours: grey for neutral towers, the element's colour for elemental ones. */
const BADGE_COLORS = { neutral: "#56606b", water: "#1f6fa8", fire: "#b8462a", storm: "#5656c4", earth: "#8a6430", arcane: "#a3408a", plague: "#4c8a2c" };

export function mountArena({
  container,
  getState,
  getCatalog,
  getViewPlayer,
  getOwnPlayer = getViewPlayer,
  getSelection,
  getPreview = () => null,
  getQueued = () => [],
  getUpQueued = () => [],
  getColors = () => ({}),
  getMode = () => "build",
  onCell,
  onTower,
  onTowerRight = () => {},
  onCellRight = () => false,
  popups = { numbers: true, notes: true },
  onPip = () => {},
  onSwipe = () => {},
  peekLane = () => null, // v0.15: {name, color} of the field a swipe in that direction would show
  onHover = () => {},
  getAim = () => null,
  onTick,
  getPipPlayer = null,
  getMinimapMode = () => "on", // v0.18c: "on", "off" or "all"
  getMiniPlayers = () => [], // v0.18c: the fields shown in the "All" row
  getAllyPlayers = () => [], // v0.21d: team games: your allies' fields, shown beside the normal mini map
  getPrefetch = () => null, // v0.23: catalog items whose art the board should load ahead (buildable towers, sendable creeps)
}) {
  /** v0.24r: the shown lane's grid: its own height (it grows with the tier), the full grid and the starting height. */
  const viewGrid = () => {
    const state = getState();
    if (!state?.grid) return undefined;
    return { cols: state.grid.cols, rows: laneRows(state, state.players?.[getViewPlayer()]), total: state.grid.rows, base: baseRows(state), cellUnits: state.grid.cellUnits };
  };
  /** A lane's colour: the player's choice, else blue for you and red for the other side. */
  const colorOf = (player) => {
    const id = getColors()?.[player];
    return TEAM_COLORS[id] ? id : player === getOwnPlayer() ? "blue" : "red";
  };
  // v0.15: while the board slides sideways, the neighbouring field's border appears in the gap
  const peekEl = document.createElement("div");
  peekEl.className = "lane-peek";
  peekEl.hidden = true;
  peekEl.innerHTML = "<span></span>";
  container.append(peekEl);
  let peekInfo = null,
    peekSide = 0;
  function showPeek(offset, width, info = peekInfo) {
    if (!offset || !info) {
      if (!peekEl.hidden) peekEl.hidden = true;
      return;
    }
    const w = Math.min(width, Math.abs(offset)),
      side = offset < 0 ? "right" : "left";
    if (peekInfo !== info || peekSide !== side) {
      peekInfo = info;
      peekSide = side;
      peekEl.style.setProperty("--peek", info.color || "#888");
      peekEl.firstChild.textContent = info.name || "";
      peekEl.dataset.side = side;
    }
    peekEl.hidden = false;
    peekEl.style.width = Math.round(w) + "px";
    peekEl.style.opacity = String(Math.min(1, w / 40));
  }
  // Mobile Max: a thin bar on the right edge shows where the board stands while it moves
  const thumbEl = document.createElement("div");
  thumbEl.className = "scroll-thumb";
  container.append(thumbEl);
  let thumbHide = 0;
  function showThumb(z, y, linger = 900) {
    const r = z?.scroll;
    if (!r || r.hi - r.lo < 2) return;
    const track = Math.max(40, z.clearBottom - z.clearTop),
      size = Math.max(28, (track * track) / (track + r.hi - r.lo)),
      k = clamp((y - r.lo) / (r.hi - r.lo), 0, 1);
    thumbEl.style.top = Math.round(z.clearTop + k * (track - size)) + "px";
    thumbEl.style.height = Math.round(size) + "px";
    thumbEl.classList.add("show");
    clearTimeout(thumbHide);
    thumbHide = setTimeout(() => thumbEl.classList.remove("show"), linger);
  }
  let insets = { top: 84, bottom: 172 };
  function measureInsets() {
    const box = container.getBoundingClientRect(),
      hud = document.querySelector(".mini-hud")?.getBoundingClientRect(),
      dock = document.querySelector(".command-deck")?.getBoundingClientRect(),
      // Mobile Max: the send buttons rise above the deck; the board may scroll up to their top edge
      cards = layoutFull() ? document.getElementById("cards")?.getBoundingClientRect() : null,
      dockTop = dock ? Math.min(dock.top, cards && cards.height > 0 ? cards.top - 8 : Infinity) : null;
    // v0.24b: Desktop Wide: the HUD and the cards sit beside the board, so it may use the full height
    if (document.documentElement.classList.contains("layout-wide")) {
      insets = { top: 4, bottom: 4 };
      return;
    }
    insets = {
      top: hud ? Math.max(0, hud.bottom - box.top) : 84,
      bottom: dockTop !== null ? Math.max(0, box.bottom - dockTop) : 172,
    };
  }
  measureInsets();
  // Render at the device's pixel density: the canvas is sized in device pixels and
  // the camera zooms by DPR, so world units stay CSS pixels everywhere else.
  // v0.23: at most 2 (was 2.5); MSAA only below a pixel ratio of 2
  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const DECO = ["deco-bush", "deco-crate", "deco-crystal", "deco-grass", "deco-mush-purple", "deco-mush-teal", "deco-pine", "deco-rock", "deco-torch"];
  const GRASS = ["tile-grass", "tile-grass-2", "tile-grass-3"];
  // Start fast: only the board itself and two fallback figures load before the arena opens.
  // v0.23: every other figure loads the first time it is needed (it was: all ~190 pictures streamed in at the
  // start and were kept three times, as canvas, image and texture). The art of the towers you can build and the
  // creeps you can send is fetched ahead (getPrefetch), the entry-level and element towers right after the start.
  const ESSENTIAL = ["tile-path", "tower-archer", "creep-goblin"];
  const FIRST = ["tower-archer-v2", "tower-guard-l1", "tower-cannon-v3", "tower-hall", "tower-arcane-v2", "tower-farm"];
  const ELEMENT_ART = ["tower-frost", "tower-fire", "tower-storm", "tower-earth", "tower-arcane", "tower-poison"]; // v0.23: element art stays preloaded
  /** How long a new figure may stay hidden while its art loads before a stand-in shows (ms). */
  const ART_WAIT = 400;

  // v0.08: the board is drawn with Babylon.js (see b2d.js), the scene keeps its old shape.
  class Arena {
    constructor(stage) {
      this.stage = stage;
      this.units = new Map();
      this.lastView = -1;
      this.lastEvent = 0;
      this.terrainKey = "";
      this.pathKey = "";
      this.press = null;
      this.projectiles = [];
      this.particles = [];
      this.rings = [];
      this.swipes = [];
      this.beams = new Map(); // v0.18b: Focus Fire beams (Earth Laser), one per tower
      this.bolts = []; // v0.12
      this.floaters = [];
      this.textPool = [];
      this.skinKeys = new Map(); // v0.23: art key -> colour -> texture key (no string building per frame)
      this.painters = {};
      this.waiting = new Map(); // v0.23: unit key -> since when its art is loading
      this._look = { art: null, tex: null, anim: null, hide: false };
      this.badgeBatches = new Map(); // v0.23: depth -> level badges of that row, one draw call
      this.plankGfx = new Map(); // v0.24h: one layer per Siege Plank, sorted right above its tower
      this.badgeNames = {};
      this.flash = 0;
      this.gainFlash = 0;
      this.fireflies = Array.from({ length: 18 }, (_, i) => ({ seed: i * 7.31, x: hash(i, 3), y: hash(i, 9) }));
      this.artSetShown = activeArtSet(); // design variants: the set whose pictures the board is loading or showing
      this.folded = new Map(); // v0.23a: art key -> the key the active set draws
      this.atlasLoads = new Map(); // v0.23a: scenery atlases on their way
    }
    preload() {
      // v0.23: the meadow (grass tiles and props) comes as one atlas, drawn in a single call
      // v0.23a: the design variants load their board props as such an atlas instead; figures from the active art set
      return Promise.all([this.loadTerrainAtlas(), ...ESSENTIAL.map((key) => this.stage.load(this.fold(key), artUrl(key), { meta: this.setMeta(key) }))]);
    }
    /**
     * v0.23a: the atlas of the board scenery of the active design: "terrain" (grass tiles and props of the
     * original), "terrain:<design>" (the props around the island in the new looks). Resolves when it is there.
     */
    loadTerrainAtlas() {
      const props = boardProps(),
        set = activeArtSet(),
        design = currentDesign(),
        key = props && set ? "terrain:" + design : "terrain";
      if (this.stage.hasTexture(key)) return Promise.resolve(key);
      if (this.atlasLoads.has(key)) return this.atlasLoads.get(key);
      const items = key === "terrain" ? [...GRASS, ...DECO].map((k) => [k, artUrl(k)]) : [...new Set([...props.trees, ...props.small, props.gate, props.goal])].map((n) => [n, setPropUrl(set, "deco-" + n)]),
        job = this.stage.loadAtlas(key, items).then((r) => {
          this.atlasLoads.delete(key);
          this.terrainKey = ""; // draw the board again with it
          return r;
        });
      this.atlasLoads.set(key, job);
      return job;
    }
    /** v0.23a: art sets: the key a figure draws (level variants fold into their base figure), cached per set. */
    fold(key) {
      if (!activeArtSet()) return key;
      let f = this.folded.get(key);
      if (f === undefined) this.folded.set(key, (f = setArtKey(key)));
      return f;
    }
    /** v0.23a: size and plate data of a figure from the active art set (null: the original art, ART_MANIFEST). */
    setMeta(key) {
      return setArtMeta(activeArtSet(), key);
    }
    /** v0.23a: size and plate data of the picture a texture holds (it travels with the picture, see need). */
    artMeta(tex, art) {
      return this.stage.textures.get(tex)?.meta || ART_MANIFEST[art] || ART_MANIFEST[tex] || ART_MANIFEST["tower-archer"];
    }
    /**
     * Design variants: switch every figure to the art set of the chosen design. v0.23a: no picture is kept
     * after its upload, so every figure texture loaded so far (and every one on its way) is fetched again from
     * the new set and replaced in place (team colours painted again); the old one shows until then.
     * Figures not loaded yet simply load from the new set when first needed.
     */
    switchArt() {
      useArtSet(artSetFor(currentDesign()));
      if (this.artSetShown === activeArtSet()) return false;
      this.artSetShown = activeArtSet();
      this.folded.clear();
      const set = activeArtSet(),
        stage = this.stage;
      for (const tex of stage.artKeys()) {
        const hash = tex.indexOf("#"),
          key = hash < 0 ? tex : tex.slice(0, hash),
          colorId = hash < 0 ? null : tex.slice(hash + 1);
        if (!SET_ART.test(key)) continue; // scenery, frame animations ("anim:"), atlases stay
        if (set && setArtKey(key) !== key) continue; // level variants are not drawn in a set (they keep the original art)
        const url = artUrl(key);
        if (stage.urlOf(tex) === url) continue;
        stage.reloadImage(tex, url, { meta: setArtMeta(set, key), paint: colorId ? (this.painters[colorId] ||= (d) => recolorTeam(d, colorId)) : null });
      }
      // the scenery of the new look (its atlas loads now if needed; the old look's atlas is let go)
      for (const key of [...stage.textures.keys()]) if ((key === "terrain" || key.startsWith("terrain:")) && key !== (boardProps() && set ? "terrain:" + currentDesign() : "terrain")) stage.dropTexture(key);
      this.loadTerrainAtlas();
      this.terrainKey = "";
      this.pathKey = "";
      this.pathRef = null;
      return true;
    }
    /**
     * v0.23: the texture key of `key` (a still, or "anim:" + key for a sheet) in a player's colour if it has
     * arrived; else it is requested (team blue moved to that colour's hue while loading) and null comes back.
     */
    need(key, colorId, urgent = true, ask = true) {
      const still = !key.startsWith("anim:");
      if (still) key = this.fold(key); // v0.23a: art sets: level variants draw their base figure
      const color = CLOTH_COLORS[colorId],
        recolor = !!color && color.hue !== null;
      let tex = key;
      if (recolor) {
        let byColor = this.skinKeys.get(key);
        if (!byColor) this.skinKeys.set(key, (byColor = new Map()));
        tex = byColor.get(colorId);
        if (!tex) byColor.set(colorId, (tex = key + "#" + colorId));
      }
      if (this.stage.hasTexture(tex) || !ask) return this.stage.hasTexture(tex) ? tex : null;
      const sheet = key.startsWith("anim:") ? ANIM_MANIFEST[key.slice(5)] : null,
        url = sheet ? animUrl(key.slice(5)) : artUrl(key);
      if (url.startsWith("data:image/gif")) return null; // v0.24j: a pack picture before the packs are there: ask again later
      this.stage.request(tex, url, {
        fw: sheet?.fw || 0,
        fh: sheet?.fh || 0,
        paint: recolor ? (this.painters[colorId] ||= (d) => recolorTeam(d, colorId)) : null,
        urgent,
        meta: still ? this.setMeta(key) : null, // v0.23a: the size data of an art-set picture travels with it
      });
      return null;
    }
    /**
     * v0.23: what a figure shows: { art, tex, anim, hide } in a reused object. The wanted art (its frame
     * animation first) once loaded; until then the picture it already shows; a new figure stays hidden for
     * up to ART_WAIT ms, then the line's base art or a stand-in in the same colour fills in.
     */
    look(sprite, unitKey, want, colorId, kind, now) {
      want = this.fold(want); // v0.23a: art sets: level variants draw their base figure, no frame animations
      const L = this._look,
        sheet = activeArtSet() ? null : ANIM_MANIFEST[want],
        animTex = sheet ? this.need((ANIM_KEY[want] ||= "anim:" + want), colorId) : null,
        tex = animTex || this.need(want, colorId);
      // v0.23a (creep graphic overhaul): the death sheet comes along once the walk is there
      if (animTex && sheet.dirs) {
        const dk = DEATH_KEY[want] !== undefined ? DEATH_KEY[want] : (DEATH_KEY[want] = ANIM_MANIFEST[want + "-death"] ? "anim:" + want + "-death" : null);
        if (dk && !ANIM_MANIFEST[dk.slice(5)].in) this.need(dk, colorId, false); // v0.23zb: a death row inside the walk sheet comes with it
      }
      L.hide = false;
      if (tex) {
        this.waiting.delete(unitKey);
        L.art = want;
        L.tex = tex;
        L.anim = animTex ? sheet : null;
      } else if (sprite?._look) {
        Object.assign(L, sprite._look);
        return L;
      } else {
        const since = this.waiting.get(unitKey) ?? now;
        this.waiting.set(unitKey, since);
        const stand = kind === "creep" ? "creep-goblin" : "tower-archer",
          base = want.replace(/-(v|l)\d$/, ""),
          baseTex = base !== want && this.need(base, colorId, false, false);
        L.anim = null;
        if (baseTex) {
          L.art = base;
          L.tex = baseTex;
        } else {
          L.art = stand;
          L.tex = this.need(stand, colorId) || stand;
          L.hide = now - since < ART_WAIT;
        }
        if (L.hide) return L;
      }
      if (sprite) Object.assign((sprite._look ||= {}), L);
      return L;
    }
    /** v0.23: art for a ghost (preview, pre-build): the wanted still once loaded, else its base or the stand-in. */
    stillFor(want, colorId) {
      const L = this._look;
      L.anim = null;
      L.hide = false;
      want = this.fold(want); // v0.23a
      const base = want.replace(/-(v|l)\d$/, "");
      L.art = want;
      L.tex = this.need(want, colorId);
      if (!L.tex && base !== want && (L.tex = this.need(base, colorId, false, false))) L.art = base;
      if (!L.tex) {
        L.art = "tower-archer";
        L.tex = this.need("tower-archer", colorId) || "tower-archer";
      }
      return L;
    }
    /** v0.25m: like need(), but resolves once the texture is there (key, or null if it cannot load yet). */
    want(key, colorId) {
      const still = !key.startsWith("anim:");
      if (still) key = this.fold(key);
      const color = CLOTH_COLORS[colorId],
        recolor = !!color && color.hue !== null;
      let tex = key;
      if (recolor) {
        let byColor = this.skinKeys.get(key);
        if (!byColor) this.skinKeys.set(key, (byColor = new Map()));
        tex = byColor.get(colorId);
        if (!tex) byColor.set(colorId, (tex = key + "#" + colorId));
      }
      if (this.stage.hasTexture(tex)) return Promise.resolve(tex);
      const sheet = key.startsWith("anim:") ? ANIM_MANIFEST[key.slice(5)] : null,
        url = sheet ? animUrl(key.slice(5)) : artUrl(key);
      if (url.startsWith("data:image/gif")) return Promise.resolve(null);
      return this.stage.load(tex, url, {
        fw: sheet?.fw || 0,
        fh: sheet?.fh || 0,
        paint: recolor ? (this.painters[colorId] ||= (d) => recolorTeam(d, colorId)) : null,
        meta: still ? this.setMeta(key) : null,
      });
    }
    /**
     * v0.25m: loads (and colours) everything a match shows before it starts: the items given (the player's cards,
     * items.neutral: the neutral waves), and for every player the creeps of their tier and the root towers.
     * progress(0..1) is called as pictures arrive; resolves when all are there (or failed).
     */
    warm(items, progress) {
      const jobs = [],
        seen = new Set(),
        add = (key, colorId) => {
          if (!key || !ART_MANIFEST[key]) return;
          const id = key + "|" + colorId;
          if (seen.has(id)) return;
          seen.add(id);
          jobs.push(this.want(key, colorId));
          if (ANIM_MANIFEST[key] && !activeArtSet()) {
            jobs.push(this.want("anim:" + key, colorId));
            const death = ANIM_MANIFEST[key + "-death"];
            if (death && !death.in) jobs.push(this.want("anim:" + key + "-death", colorId));
          }
        },
        game = getState(),
        catalog = getCatalog(),
        own = colorOf(getOwnPlayer()),
        players = (game?.players || []).filter((pl) => pl && !pl.out);
      for (const item of items || []) add(artFor(item), own);
      for (const item of items?.neutral || []) add(artFor(item), "neutral");
      if (catalog)
        for (const pl of players) {
          const pc = colorOf(pl.id);
          for (const item of catalog.sends || []) if (item.playable && item.tier === pl.tier) add(artFor(item), pc);
          for (const item of catalog.towers || []) if (item.isRoot && item.playable && item.support !== "farm") add(artFor(item), pc);
        }
      let done = 0;
      const total = jobs.length || 1;
      progress?.(0);
      return Promise.all(jobs.map((j) => Promise.resolve(j).catch(() => null).then((r) => (done++, progress?.(done / total), r))));
    }
    /** v0.23: fetch ahead the art of what the player can build and send now (in their colour), once a second. */
    prefetch(now) {
      if (now - (this.prefetchAt || 0) < 1000) return;
      this.prefetchAt = now;
      const items = getPrefetch(),
        catalog = getCatalog(),
        color = colorOf(getOwnPlayer());
      if (!items || !catalog) return;
      for (const item of items) {
        const key = artFor(item);
        if (!ART_MANIFEST[key]) continue;
        this.need(key, color, false);
        if (ANIM_MANIFEST[key] && !activeArtSet()) this.need("anim:" + key, color, false); // v0.23a: art sets have no frame animations
      }
      // v0.25m: the neutral waves to come
      for (const item of items.neutral || []) {
        const key = artFor(item);
        if (!ART_MANIFEST[key]) continue;
        this.need(key, "neutral", false);
        if (ANIM_MANIFEST[key] && !activeArtSet()) this.need("anim:" + key, "neutral", false);
      }
      // v0.23b: the creeps every player can send now, in that player's colour (a bought boss moves its buyer to the
      // next tier at once, so that tier loads right away): the standing picture first, then the walk sheet
      const game = getState();
      if (!game?.players) return;
      for (const pl of game.players) {
        if (!pl || pl.out) continue;
        const pc = colorOf(pl.id);
        for (const item of catalog.sends || []) {
          if (!item.playable || (item.tier !== pl.tier && item.tier !== pl.tier + 1)) continue; // v0.25m: and the next tier
          const key = artFor(item);
          if (!ART_MANIFEST[key]) continue;
          this.need(key, pc, false);
          if (ANIM_MANIFEST[key] && !activeArtSet()) this.need("anim:" + key, pc, false);
        }
        // v0.25m: the upgrades of the towers on the board
        for (const t of pl.towers || [])
          for (const up of catalog.byId?.[t.typeId]?.upgrades || []) {
            const next = catalog.byId[up],
              key = next && artFor(next);
            if (key && ART_MANIFEST[key]) this.need(key, pc, false);
          }
      }
    }
    /**
     * v0.23a (creep graphic overhaul): a killed creep with a death sheet stays where it fell and plays its
     * six death frames (flyers sink to the ground meanwhile), lies still for a moment and fades. Creeps that
     * break through or leave the screen simply vanish as before.
     */
    settleDeaths(view, time) {
      this.dying ||= [];
      for (const [key, s] of this.gone) {
        const art = s.getData("art"),
          dk = art && DEATH_KEY[art],
          meta = dk && ANIM_MANIFEST[dk.slice(5)],
          killedAt = this.killed?.get(key),
          tex = meta && killedAt !== undefined && time - killedAt <= 600 ? this.need(meta.in ? "anim:" + meta.in : dk, s.getData("team"), false, false) : null; // v0.23zb: `in`: the death row of the walk sheet
        if (!tex) {
          s.destroy();
          continue;
        }
        const lift = s.getData("lift") || 0,
          shown = s.getData("show") ?? s.getData("dir") ?? 0,
          sx = Math.abs(s.sx) * (shown >= 1 && shown <= 3 ? -1 : 1), // right-facing creeps fall the mirrored way
          sy = Math.abs(s.sy);
        s.setBatched(false); // v0.23i: the fall is drawn by the figure itself
        s.setBend(0);
        s.setTintMode(TINT.MULTIPLY).clearTint();
        s.setTexture(tex, meta.first || 0).setOrigin(meta.footX / meta.fw, meta.footY / meta.fh).setScale(sx, sy).setRotation(0).setAlpha(1);
        s.setVisible(true).setDepth(lift > 2 ? 4190 + Math.floor(s.y + lift) : this.fallenDepth(s.y + lift)); // v0.23e: fallen creeps sort with towers too
        this.dying.push({ s, view, start: time, meta, tex, groundY: s.y + lift, lift });
      }
      this.gone.length = 0;
      if (this.killed?.size > 64) for (const [k, t] of this.killed) if (time - t > 2000) this.killed.delete(k);
      if (!this.dying.length) return;
      this.dying = this.dying.filter((d) => {
        const el = time - d.start,
          play = d.meta.ms * d.meta.frames,
          hold = 900,
          fade = 500;
        if (d.view !== view || el > play + hold + fade || d.s.destroyed) {
          d.s.destroy();
          return false;
        }
        this.showFrame(d.s, d.tex, (d.meta.first || 0) + Math.min(d.meta.frames - 1, Math.floor(el / d.meta.ms)));
        const fall = clamp(el / (d.meta.ms * 4), 0, 1);
        d.s.setPosition(d.s.x, d.groundY - d.lift * (1 - fall * fall));
        d.s.setAlpha(el > play + hold ? 1 - (el - play - hold) / fade : 1);
        return true;
      });
    }
    /** Switch a sprite to the given sheet frame without resetting it every draw. */
    showFrame(sprite, tex, frame) {
      if (sprite.texture.key !== tex) sprite.setTexture(tex, frame);
      else if (sprite.frame.name !== frame) sprite.setFrame(frame);
    }
    create() {
      for (const key of [...FIRST, ...ELEMENT_ART]) this.need(key, colorOf(getOwnPlayer()), false); // v0.23
      this.bg = this.stage.graphics().setDepth(0);
      this.frameG = this.stage.graphics().setDepth(1);
      // v0.23: grass tiles and props in one batch (they were ~90 images, one draw call each): props outside
      // the wall first (they lay under the tiles), then the tiles, then the tufts on the meadow
      this.meadow = this.stage.sprites("terrain").setDepth(1.5);
      this.pathBatch = this.stage.sprites("tile-path").setDepth(3); // v0.23: path tiles, one draw call
      this.iceBatch = this.stage.sprites("tile-path").setDepth(3.5);
      this.badgeAtlas();
      this.grout = this.stage.graphics().setDepth(4);
      this.pathLayer = this.stage.graphics().setDepth(5);
      this.terrainFx = this.stage.graphics().setDepth(3.7); // v0.22h1: Frozen Ground ice and Hill Paths mud over the path tiles
      this.overlay = this.stage.graphics().setDepth(20);
      this.shadeG = this.stage.graphics().setDepth(4400);
      this.glow = this.stage.graphics().setDepth(4600).setBlendMode(BLEND.ADD);
      this.fx = this.stage.graphics().setDepth(5000);
      this.fxAdd = this.stage.graphics().setDepth(5001).setBlendMode(BLEND.ADD);
      this.pip = this.stage.graphics().setDepth(7000);
      this.bars = this.stage.graphics().setDepth(6400);
      this.hpBars = this.stage.graphics().setDepth(6450);
      this.vignette = this.stage.graphics().setDepth(8000);
      this.strips = this.stage.graphics().setDepth(6); // spawn strip (portal fields) and exit strip
      this.flatTiles = this.stage.graphics().setDepth(2); // design variants: flat checker tiles
      this.ghost = this.stage.image(0, 0, "tower-archer").setDepth(4000).setVisible(false);
      this.previewLabel = this.stage
        .text(0, 0, "", { fontFamily: FONT, fontSize: "14px", color: "#ffffff", stroke: "#10221d", strokeThickness: 5, resolution: DPR })
        .setOrigin(0.5, 1)
        .setDepth(6500)
        .setVisible(false);
      this.pipLabel = this.stage
        .text(0, 0, t("ENEMY"), { fontFamily: FONT, fontSize: "10px", color: "#ffe9b0", stroke: "#0b1a16", strokeThickness: 3, resolution: DPR })
        .setOrigin(0, 0)
        .setDepth(7001);
      this.drawTerrain();
      document.getElementById("game-loader")?.remove();
      // Commit a tap on release. A drag/scroll gesture or an intervening view
      // change never spends resources; the attack/research views are passive.
      // Pointer positions stay in screen pixels (gestures); `wy` turns a screen y into board (world) y.
      const canvas = this.stage.canvas,
        at = (ev) => {
          const box = canvas.getBoundingClientRect();
          return { id: ev.pointerId, x: ev.clientX - box.left, y: ev.clientY - box.top };
        },
        wy = (y) => y + (this.stage.scrollY || 0);
      canvas.addEventListener("pointerdown", (ev) => {
        if ((ev.button ?? 0) > 0) return; // right and middle clicks never build (v0.09f)
        const p = at(ev);
        this.scrollVel = 0; // a touch stops the board gliding
        this.press = { id: p.id, x: p.x, y: p.y, view: getViewPlayer(), seed: getState()?.seed, t: performance.now() };
        try {
          canvas.setPointerCapture(ev.pointerId);
        } catch {}
      });
      // v0.09: a sideways swipe over the board shows the neighbouring player's field; the board
      // follows the finger a little. A mouse without a pressed button previews the placement.
      canvas.addEventListener("pointermove", (ev) => {
        const p = at(ev),
          press = this.press;
        if (press && press.id === p.id) {
          const dx = p.x - press.x,
            dy = p.y - press.y;
          if (!press.swiping && !press.scrolling && Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.3) press.swiping = true;
          // Mobile Max: an up/down drag moves the board under the HUD and the buttons
          const range = this.geometry().scroll;
          if (range && !press.swiping && !press.scrolling && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 1.1)
            Object.assign(press, { scrolling: true, scroll0: this.scrollY ?? range.def, y0: p.y, lastY: p.y, lastT: performance.now(), vel: 0 });
          if (press.scrolling) {
            const now = performance.now(),
              step = now - press.lastT;
            if (step > 0) press.vel = press.vel * 0.6 + ((-(p.y - press.lastY) / step) * 1000) * 0.4;
            press.lastY = p.y;
            press.lastT = now;
            this.setScroll(this.rubber(press.scroll0 - (p.y - press.y0), range));
            if (ev.pointerType === "mouse") onHover(null);
            return;
          }
          if (press.swiping) {
            // v0.15: the board follows the finger closely; the next field's border shows in the gap
            const step = dx < 0 ? 1 : -1;
            if (press.peekStep !== step) (press.peekStep = step), (press.peek = peekLane(step));
            const limit = this.stage.width * (press.peek ? 0.6 : 0.12);
            this.setSlide(clamp(dx * 0.85, -limit, limit), press.peek);
          }
          if (ev.pointerType === "mouse") onHover(null);
          return;
        }
        this.pointer = { x: p.x, y: p.y, at: performance.now() };
        if (ev.pointerType === "mouse" || ev.pointerType === "pen") {
          const state = getState(),
            pos = this.toGrid(p.x, wy(p.y)),
            inside = state && pos.gridX >= 0 && pos.gridX < state.grid.cols && pos.gridY >= 0 && pos.gridY < laneRows(state, state.players[getViewPlayer()]);
          onHover(inside ? pos : null);
        }
      });
      canvas.addEventListener("pointerleave", () => onHover(null));
      // v0.13: right click on a tower (a double right click sells it, see app.js)
      canvas.addEventListener("contextmenu", (ev) => {
        const state = getState();
        if (!state || getMode() !== "build") return;
        const box = canvas.getBoundingClientRect(),
          pos = this.toGrid(ev.clientX - box.left, wy(ev.clientY - box.top));
        if (pos.gridX < 0 || pos.gridX >= state.grid.cols || pos.gridY < 0 || pos.gridY >= laneRows(state, state.players[getViewPlayer()])) return;
        const tower = towerAt(state.players[getViewPlayer()], pos.gridX, pos.gridY);
        if (tower) onTowerRight(tower, ev.timeStamp);
        else onCellRight(pos); // v0.18a: an empty field (e.g. a pre-build)
      });
      // Mobile Max with a mouse: the mouse wheel moves the board up and down
      canvas.addEventListener(
        "wheel",
        (ev) => {
          const range = this.geometry().scroll;
          if (!range || range.hi - range.lo < 1 || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
          ev.preventDefault();
          ev.stopPropagation(); // v0.25j: a vertical wheel moves the maze up and down instead of switching lanes
          this.scrollVel = 0;
          this.setScroll(clamp((this.scrollY ?? range.def) + ev.deltaY, range.lo, range.hi));
        },
        { passive: false },
      );
      canvas.addEventListener("pointerup", (ev) => {
        const p = at(ev);
        const press = this.press;
        this.press = null;
        const state = getState();
        if (press && press.id === p.id) {
          const dx = p.x - press.x,
            dy = p.y - press.y,
            quick = performance.now() - press.t < 700;
          if (press.scrolling) {
            // the board glides on a little after a flick, then settles inside its range
            this.scrollVel = performance.now() - press.lastT < 80 ? clamp(press.vel, -2600, 2600) : 0;
            return;
          }
          if (press.swiping || (quick && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3)) {
            const step = dx < 0 ? 1 : -1,
              info = press.peekStep === step ? press.peek : peekLane(step);
            // v0.15: a swipe rolls the board out to the side, then the next field rolls in
            if (Math.abs(dx) > 44 && info) this.roll(step, info, () => onSwipe(step));
            else this.slideTo(0, 200);
            return;
          }
          if (this.stage.slideX && !this.slide) this.slideTo(0, 200);
        }
        if (!press || press.id !== p.id || press.seed !== state?.seed || Math.hypot(p.x - press.x, p.y - press.y) > 12) return;
        // Mobile Max: fields hidden under the HUD are never built by a tap that lands on the HUD
        if (this.geometry().full && p.y < insets.top) return;
        const r = getMinimapMode() === "on" ? pipGeometry(this.geometry()) : null,
          y = wy(p.y);
        // v0.18c: the row of see-through mini maps ("All")
        const hit = (this.miniRects || []).find((m) => p.x >= m.x - 3 && p.x <= m.x + m.w + 3 && y >= m.y - 3 && y <= m.y + m.h + 3);
        if (hit) {
          onPip(hit.player);
          return;
        }
        if (r && p.x >= r.x - 6 && p.x <= r.x + r.w + 6 && y >= r.y - 6 && y <= r.y + r.h + 12) {
          onPip();
          return;
        }
        if (press.view !== getViewPlayer()) return;
        const pos = this.toGrid(p.x, y);
        if (pos.gridX < 0 || pos.gridX >= state.grid.cols || pos.gridY < 0 || pos.gridY >= laneRows(state, state.players[getViewPlayer()])) return;
        const z = this.geometry();
        pos.fx = (p.x - z.left) / z.bw; // exact point on the board, as a share (v0.09q: volley aim)
        pos.fy = (y - z.top) / z.ny; // v0.24r: a share of the full grid height
        const player = state.players[getViewPlayer()],
          tower = towerAt(player, pos.gridX, pos.gridY);
        // v0.17h: towers (own or enemy) can be tapped outside Build too; empty fields only in Build
        if (tower) onTower(tower, ev.timeStamp, pos);
        else if (getMode() === "build") onCell(pos);
      });
      // a release outside the board, or a cancelled touch, never counts as a tap
      this.onOutside = (ev) => {
        if (ev.target !== canvas) this.press = null;
      };
      window.addEventListener("pointerup", this.onOutside);
      canvas.addEventListener("pointercancel", () => {
        this.press = null;
        if (this.stage.slideX && !this.slide) this.slideTo(0, 200);
      });
    }
    /** Ease the board back from a sideways offset (after a swipe or a cancelled drag). */
    slideFrom(offset) {
      this.setSlide(offset);
      this.slideTo(0, 200);
    }
    /** v0.15: sideways offset of the whole board, with the neighbour's border in the gap. */
    setSlide(x, info) {
      this.stage.slideX = x;
      showPeek(x, this.stage.width, info);
    }
    slideTo(to, ms, then, info) {
      this.slide = { from: this.stage.slideX || 0, to, t0: performance.now(), ms, then, info, ease: this.slide?.ease };
    }
    /**
     * v0.15: roll to another field: the board glides out to the side (the next field's border
     * filling the gap), `apply` switches the view, and the new field glides in from the other side.
     */
    roll(step, info, apply, back = null, speed = 1) {
      const w = this.stage.width,
        out = step > 0 ? -w : w;
      this.slideTo(out, Math.max(90, 170 * (1 - Math.abs(this.stage.slideX || 0) / w)) / speed, () => {
        const changed = apply() !== false;
        if (!changed) return this.slideFrom(0);
        back = back ?? peekLane(-step);
        this.setSlide(-out * 0.9, back);
        this.slideTo(0, 260 / speed, null, back);
      }, info);
    }
    stepSlide() {
      const s = this.slide;
      if (!s) return;
      const k = clamp((performance.now() - s.t0) / s.ms, 0, 1),
        e = s.to === 0 ? 1 - Math.pow(1 - k, 3) : k * k * (3 - 2 * k);
      this.setSlide(s.from + (s.to - s.from) * e, s.info ?? peekInfo);
      if (k >= 1) {
        this.slide = null;
        this.setSlide(s.to, s.info ?? peekInfo);
        s.then?.();
      }
    }
    geometry() {
      return arenaGeometry(this.stage.width, this.stage.height, viewGrid(), getMode(), insets, this.stage.scrollY || 0);
    }
    // ---- Mobile Max: scrolling the board up and down ---------------------------------
    setScroll(y, linger) {
      const moved = this.scrollY != null && Math.abs(y - this.scrollY) > 0.05;
      this.scrollY = y;
      this.stage.scrollY = y;
      if (moved || linger) showThumb(this.geometry(), y, linger);
    }
    /** Past either end the board follows the finger only a little (rubber band). */
    rubber(y, range) {
      const pull = (d) => 70 * (1 - 1 / (1 + d / 140));
      if (y < range.lo) return range.lo - pull(range.lo - y);
      if (y > range.hi) return range.hi + pull(y - range.hi);
      return y;
    }
    /** Per frame: start in the middle, glide after a flick, spring back into the range. */
    stepScroll(z, dt) {
      const range = z.scroll;
      if (!range) {
        if (this.stage.scrollY) this.setScroll(0);
        this.scrollY = null;
        return;
      }
      if (this.scrollY == null) return this.setScroll(range.def, 2600); // at the start the bar shows for a moment
      if (this.press?.scrolling) return;
      let y = this.scrollY,
        v = this.scrollVel || 0;
      if (Math.abs(v) > 12) {
        y += v * dt;
        v *= Math.exp(-dt * (y < range.lo || y > range.hi ? 18 : 4.2));
      } else v = 0;
      if (y < range.lo) y += (range.lo - y) * Math.min(1, dt * 11);
      else if (y > range.hi) y -= (y - range.hi) * Math.min(1, dt * 11);
      if (Math.abs(y - range.lo) < 0.3 && y < range.lo) y = range.lo;
      if (Math.abs(y - range.hi) < 0.3 && y > range.hi) y = range.hi;
      this.scrollVel = v;
      if (y !== this.scrollY) this.setScroll(y);
    }
    /**
     * v0.23f: where a ground creep is drawn. Near a corner of its path the creep follows a curve (a quadratic
     * Bézier from r before the corner to r after it), so it does not turn on the spot. Display only; the
     * simulation keeps the exact path, towers aim at the real position (at most a few pixels apart).
     */
    roundedPoint(c, cell, z) {
      // v0.23i: the board geometry comes from the caller (it was computed anew for every point), no closures
      const L = z.left,
        T = z.top,
        W = z.bw,
        H = z.ny, // v0.25b: creep y is a share of the full grid (was z.bh, the lane height: creeps were drawn too high since v0.24r)
        raw = { x: L + c.x * W, y: T + c.y * H };
      if (c.flying || c.knock || !Array.isArray(c.path) || !c.path.length) return raw;
      const ox = c.ox || 0,
        oy = c.oy || 0,
        i = c.pathIndex,
        vary = varyOf(c), // 0..1, fixed per creep
        P = pathNode(c, i - 1),
        N = pathNode(c, i);
      if (!P || !N) return raw;
      // coming up to the next node N (corner P → N → A), or just past the node P behind (corner Q → P → N)
      const A = pathNode(c, i + 1);
      if (A && cornerTo(L + (P.x + ox) * W, T + (P.y + oy) * H, L + (N.x + ox) * W, T + (N.y + oy) * H, L + (A.x + ox) * W, T + (A.y + oy) * H, raw, cell, vary, true)) return raw;
      const Q = pathNode(c, i - 2);
      if (Q) cornerTo(L + (Q.x + ox) * W, T + (Q.y + oy) * H, L + (P.x + ox) * W, T + (P.y + oy) * H, L + (N.x + ox) * W, T + (N.y + oy) * H, raw, cell, vary, false);
      return raw;
    }
    /** v0.23i: "view:c:id", built once per creep and view. */
    creepKey(view, id) {
      const keys = (this._ckeys ||= new Map());
      let byView = keys.get(view);
      if (!byView) keys.set(view, (byView = new Map()));
      let k = byView.get(id);
      if (k === undefined) {
        if (byView.size > 2000) byView.clear();
        byView.set(id, (k = `${view}:c:${id}`));
      }
      return k;
    }
    /**
     * v0.23g: creeps packed into a blob ease apart a little (display only): each creep is pushed away from the
     * creeps closer than ~0.36 fields, up to a fifth of a field, and the push follows smoothly (~0.3 s).
     */
    spreadCreeps(list, view, cell, time, z) {
      // v0.23i: reuses its points, grid cells and offsets from frame to frame (no strings or arrays per creep)
      const R = cell * 0.36,
        offs = ((this.spreadOff ||= new Map()).get(view) || (this.spreadOff.set(view, new Map()), this.spreadOff.get(view))),
        at = (this.spreadAt ||= new Map()),
        dt = Math.min(100, time - (at.get(view) ?? time)),
        pts = (this._spreadPts ||= []),
        grid = (this._spreadGrid ||= new Map()),
        kk = 1 - Math.exp(-dt / 300),
        cap = cell * 0.2;
      at.set(view, time);
      for (const cellList of grid.values()) cellList.length = 0;
      let n = 0;
      for (const c of list) {
        if (c.hp <= 0) continue;
        const e = pts[n] || (pts[n] = { c: null, x: 0, y: 0, fly: false, gx: 0, gy: 0 });
        n++;
        e.c = c;
        e.x = z.left + c.x * z.bw;
        e.y = z.top + c.y * z.ny;
        e.fly = !!c.flying;
        e.gx = Math.floor(e.x / R);
        e.gy = Math.floor(e.y / R);
        const k = e.gx * 65536 + e.gy;
        let cl = grid.get(k);
        if (!cl) grid.set(k, (cl = []));
        cl.push(e);
      }
      for (let m = 0; m < n; m++) {
        const e = pts[m];
        let fx = 0,
          fy = 0;
        for (let ix = e.gx - 1; ix <= e.gx + 1; ix++)
          for (let iy = e.gy - 1; iy <= e.gy + 1; iy++) {
            const cl = grid.get(ix * 65536 + iy);
            if (!cl) continue;
            for (const o of cl) {
              if (o === e || o.fly !== e.fly) continue;
              let dx = e.x - o.x,
                dy = e.y - o.y,
                d = Math.hypot(dx, dy);
              if (d >= R) continue;
              if (d < 0.01) {
                // exactly on top of each other: split by id
                dx = varyOf(e.c) < varyOf(o.c) ? -1 : 1;
                dy = 0;
                d = 1;
              }
              const w = (R - d) / R;
              fx += (dx / d) * w;
              fy += (dy / d) * w;
            }
          }
        let tx = fx * cell * 0.12,
          ty = fy * cell * 0.12;
        const l = Math.hypot(tx, ty);
        if (l > cap) {
          tx *= cap / l;
          ty *= cap / l;
        }
        let o = offs.get(e.c.id);
        if (!o) offs.set(e.c.id, (o = { x: 0, y: 0, seen: 0 }));
        o.x += (tx - o.x) * kk;
        o.y += (ty - o.y) * kk;
        o.seen = time;
      }
      // forget creeps that are gone (now and then)
      if (offs.size > n + 64) for (const [id, o] of offs) if (o.seen !== time) offs.delete(id);
      for (let m = 0; m < n; m++) pts[m].c = null; // do not keep creeps alive
      if (grid.size > 4096) grid.clear();
      return offs;
    }
    point(x, y) {
      const z = this.geometry();
      return { x: z.left + x * z.bw, y: z.top + y * z.ny }; // v0.24r: y is a share of the full grid
    }
    toGrid(x, y) {
      const z = this.geometry(),
        u = (x - z.left) / z.bw,
        v = (y - z.top) / z.ch;
      return { gridX: Math.floor(u * z.logicalCols), gridY: Math.floor(v) };
    }
    keyFor(z) {
      return [z.w, z.h, z.left, z.top, z.bw, z.bh, z.logicalCols, z.logicalRows, currentDesign()].join(":"); // design variants: a new look redraws the board
    }
    // ---- static scenery ---------------------------------------------------------
    drawTerrain() {
      if (!this.bg) return;
      const z = this.geometry(),
        g = this.bg,
        f = this.frameG,
        cell = z.cw;
      g.clear();
      const P = boardPalette();
      if (P) return this.drawThemeTerrain(z, P);
      this.flatTiles?.clear();
      this.propBack?.clear(); // v0.23a: the props of the new looks
      this.propFront?.clear();
      if (!this.stage.hasTexture("terrain")) this.loadTerrainAtlas(); // v0.23a: after a switch back to the original look
      // Night forest around the arena (Mobile Max: also above and below, where the board scrolls).
      const y0 = z.scroll ? Math.min(0, z.scroll.lo) - 160 : 0,
        span = z.scroll ? Math.max(z.h, z.scroll.hi + z.h + 160 - y0) : z.h;
      g.fillGradientStyle(0x0d2a2a, 0x0d2a2a, 0x081815, 0x081815, 1);
      g.fillRect(0, y0, z.w, span);
      for (let i = 0; i < 46; i++) {
        const x = hash(i, 1) * z.w,
          y = y0 + hash(i, 2) * span,
          s = 18 + hash(i, 4) * 26,
          shade = [0x0f3330, 0x123b33, 0x0b2622][i % 3];
        g.fillStyle(shade, 0.95);
        g.fillTriangle(x, y - s * 1.6, x - s * 0.7, y, x + s * 0.7, y);
        g.fillTriangle(x, y - s * 2.2, x - s * 0.5, y - s * 0.8, x + s * 0.5, y - s * 0.8);
      }
      for (let i = 0; i < 26; i++) {
        const x = hash(i, 11) * z.w,
          y = y0 + hash(i, 12) * span,
          c = i % 2 ? 0x46e0d0 : 0xb06cff;
        g.fillStyle(c, 0.16);
        g.fillCircle(x, y, 7);
        g.fillStyle(c, 0.75);
        g.fillEllipse(x, y, 5, 3);
      }
      // Wall frame in the lane owner's colour, bricks a little brighter and darker.
      f.clear();
      const L = z.left - z.frame,
        fv = z.frameV ?? z.frame,
        T = z.top - z.strip - fv,
        W = z.bw + z.frame * 2,
        H = z.bh + z.strip + fv * 2,
        wall = TEAM_COLORS[colorOf(getViewPlayer())].hex,
        tint = (k) => mixColor(0x46525a, wall, 0.8, k * 0.82);
      f.fillStyle(0x05110f, 0.6);
      f.fillRoundedRect(L - 4, T + 2, W + 8, H + 8, 14);
      f.fillStyle(tint(0.62));
      f.fillRoundedRect(L, T, W, H, Math.min(12, fv + 4));
      const block = z.frame * 1.6;
      for (const side of ["top", "bottom", "left", "right"]) {
        const horizontal = side === "top" || side === "bottom",
          len = horizontal ? W : H,
          n = Math.ceil(len / block);
        for (let i = 0; i < n; i++) {
          const tone = [tint(0.9), tint(0.78), tint(1), tint(0.72)][Math.floor(hash(i, side.length) * 4)];
          f.fillStyle(tone);
          if (horizontal) f.fillRoundedRect(L + i * block + 1, side === "top" ? T + 1 : T + H - fv + 1, block - 2, Math.max(2, fv - 2), 2);
          else f.fillRoundedRect(side === "left" ? L + 1 : L + W - z.frame + 1, T + i * block + 1, z.frame - 3, block - 2, 3);
        }
      }
      f.lineStyle(2, tint(0.3), 0.9);
      f.strokeRoundedRect(L, T, W, H, Math.min(12, fv + 4));
      f.lineStyle(1, tint(1.5), 0.35);
      f.strokeRoundedRect(L + 2, T + 2, W - 4, H - 4, Math.min(10, fv + 2));
      // Inner board drop shadow.
      f.fillStyle(0x0a1412, 0.7);
      f.fillRect(z.left - 2, z.top - z.strip - 2, z.bw + 4, z.bh + z.strip + 4);
      this.braziers = [];
      for (const yy of z.full ? [] : [1.5, 4.5, 7.5])
        for (const xx of [L + z.frame / 2, L + W - z.frame / 2]) {
          const y = z.top + yy * cell;
          f.fillStyle(0x24292d);
          f.fillEllipse(xx, y + 3, z.frame * 1.25, z.frame * 0.7);
          f.fillStyle(0x6b5032);
          f.fillEllipse(xx, y, z.frame * 1.05, z.frame * 0.55);
          this.braziers.push({ x: xx, y: y - 2, seed: xx * 0.01 + yy });
        }
      // Grass and plaza tiles, rotated per cell so the texture never looks tiled.
      // v0.23: all in one batch from the "terrain" atlas, in the order the depths drew them before
      // (props outside the wall at 1.5, tiles at 2, meadow tufts at 2.5)
      const mb = this.meadow.clear(),
        tiles = [],
        tufts = [],
        deco = (list, key, x, y, size, alpha = 1) => list.push([key, x, y, size, alpha]);
      for (let y = 0; y < z.logicalRows; y++)
        for (let x = 0; x < z.logicalCols; x++) tiles.push([x, y]);
      // Meadow detail and scenery: tufts under the path layer, props in the plaza corners
      // and around the wall, so the board never reads as one flat green.
      for (let y = 0; y < z.logicalRows; y++)
        for (let x = 0; x < z.logicalCols; x++) {
          const r = hash(x, y, 21);
          if (r > 0.42) continue;
          const key = r < 0.06 ? "deco-mush-teal" : r < 0.1 ? "deco-mush-purple" : "deco-grass";
          deco(tufts, key, z.left + (x + 0.2 + hash(x, y, 22) * 0.6) * cell, z.top + (y + 0.35 + hash(x, y, 23) * 0.5) * cell, cell * (key === "deco-grass" ? 0.34 : 0.26), 0.92);
        }
      // Forest props outside the wall (only where the screen leaves room).
      const outside = [];
      for (let i = 0; i < 14; i++) {
        const left = i % 2 === 0,
          x = left ? L - 8 - hash(i, 41) * 30 : L + W + 8 + hash(i, 41) * 30,
          y = T + 30 + hash(i, 42) * (H - 40);
        if (x < 6 || x > z.w - 6) continue;
        outside.push([["deco-pine", "deco-rock", "deco-bush", "deco-mush-teal", "deco-crystal"][i % 5], x, y]);
      }
      // Mobile Max: forest above and below the wall, seen when the board is pulled to either end
      if (z.full)
        for (let i = 0; i < 16; i++) {
          const above = i % 2 === 0,
            x = 14 + hash(i, 51) * (z.w - 28),
            y = above ? T - 12 - hash(i, 52) * 120 : T + H + 34 + hash(i, 52) * 130;
          outside.push([["deco-pine", "deco-rock", "deco-bush", "deco-pine", "deco-mush-teal", "deco-crystal"][i % 6], x, y]);
        }
      const props = outside.map(([key, x, y]) => [key, x, y, cell * (key === "deco-pine" ? 0.9 : 0.55), 1]);
      const prop = ([key, x, y, size, alpha]) => {
        const r = this.stage.rect("terrain", key);
        if (!r) return;
        const s = size / Math.max(r.w, r.h);
        mb.quad(x, y, r.w * s, r.h * s, 0.5, 0.9, 0, hash(x, y, 3) > 0.5, 0xffffff, alpha, r.uv);
      };
      props.forEach(prop);
      for (const [x, y] of tiles) {
        const r = hash(x, y),
          grass = GRASS[Math.floor(hash(x, y, 13) * GRASS.length)],
          rect = this.stage.rect("terrain", grass);
        if (!rect) continue;
        const sx = (cell + 0.6) / rect.w,
          sy = (cell + 0.6) / rect.h;
        mb.quad(z.left + (x + 0.5) * cell, z.top + (y + 0.5) * cell, rect.w * sx, rect.h * sy, 0.5, 0.5, (Math.floor(r * 4) * 90 * Math.PI) / 180, hash(y, x, 5) > 0.5, [0xe9f1df, 0xdfe9d3, 0xf2f6e8, 0xe4edd9][Math.floor(hash(x, y, 2) * 4)], 1, rect.uv);
      }
      tufts.forEach(prop);
      // v0.23b: checkers: every other field a little darker, the others a little lighter (under the path tiles)
      if (tileMode === "checkers") {
        const ft = this.flatTiles;
        for (let y = 0; y < z.logicalRows; y++)
          for (let x = 0; x < z.logicalCols; x++) {
            if ((x + y) & 1) ft.fillStyle(0x000000, 0.13);
            else ft.fillStyle(0xffffff, 0.05);
            ft.fillRect(z.left + x * cell, z.top + y * cell, cell, cell);
          }
      }
      // Grout between tiles.
      const gr = this.grout;
      gr.clear();
      if (tileMode !== "none") for (let i = 0; i <= z.logicalCols; i++) {
        gr.lineStyle(2, 0x1b2a1c, 0.55);
        gr.lineBetween(z.left + i * cell, z.top, z.left + i * cell, z.top + z.bh);
        gr.lineStyle(1, 0xd8f0b0, 0.12);
        gr.lineBetween(z.left + i * cell + 1.5, z.top, z.left + i * cell + 1.5, z.top + z.bh);
      }
      if (tileMode !== "none") for (let j = 0; j <= z.logicalRows; j++) {
        gr.lineStyle(2, 0x1b2a1c, 0.55);
        gr.lineBetween(z.left, z.top + j * cell, z.left + z.bw, z.top + j * cell);
        gr.lineStyle(1, 0xd8f0b0, 0.12);
        gr.lineBetween(z.left, z.top + j * cell + 1.5, z.left + z.bw, z.top + j * cell + 1.5);
      }
      // Soft vignette over the board edges.
      const sh = this.shadeG;
      sh.clear();
      for (let i = 0; i < 6; i++) {
        sh.lineStyle(cell * 0.12, 0x061210, 0.09);
        sh.strokeRect(z.left + i * cell * 0.06, z.top + i * cell * 0.06, z.bw - i * cell * 0.12, z.bh - i * cell * 0.12);
      }
      this.drawStrips(z);
      this.terrainKey = this.keyFor(z) + "|" + colorOf(getViewPlayer());
      this.pathKey = "";
      this.pathRef = null;
    }
    /**
     * Design variants: the board without painted detail. Sonnenwiese and Pfotenwelt: sky (clouds or paw prints),
     * the board as a floating meadow island (grass rim, soil cliff underneath). Bonbon: turquoise with dots, the
     * board as a sticker (thick navy outline, white edge, hard shadow). Tiles are flat two-tone checks; the
     * design's props stand around the island (placeProps), never on the board.
     */
    drawThemeTerrain(z, P) {
      const g = this.bg,
        f = this.frameG,
        cell = z.cw,
        y0 = z.scroll ? Math.min(0, z.scroll.lo) - 160 : 0,
        span = z.scroll ? Math.max(z.h, z.scroll.hi + z.h + 160 - y0) : z.h;
      this.meadow.clear(); // v0.23a: the original's grass and props batch
      this.braziers = [];
      this.shadeG.clear();
      // background
      g.fillGradientStyle(P.sky[0], P.sky[0], P.sky[1], P.sky[1], 1);
      g.fillRect(0, y0, z.w, span);
      if (P.cloud) {
        for (let i = 0; i < 9; i++) {
          const x = hash(i, 61) * z.w,
            y = y0 + hash(i, 62) * span,
            s = 16 + hash(i, 63) * 18;
          g.fillStyle(P.cloud, 0.75);
          g.fillEllipse(x, y, s * 3.2, s * 1.3);
          g.fillCircle(x - s * 0.6, y - s * 0.35, s * 0.75);
          g.fillCircle(x + s * 0.35, y - s * 0.55, s * 0.95);
        }
      }
      if (P.dots) {
        const step = 30;
        g.fillStyle(P.dots[0], P.dots[1]);
        for (let y = Math.floor(y0 / step) * step; y < y0 + span; y += step)
          for (let x = (y / step) % 2 ? step / 2 : 0; x < z.w + step; x += step) g.fillCircle(x, y, 3.2);
      }
      if (P.paws) {
        // Pfotenwelt: soft paw prints scattered over the warm sky
        g.fillStyle(P.paws[0], P.paws[1]);
        const step = 74;
        for (let y = Math.floor(y0 / step) * step, row = 0; y < y0 + span + step; y += step, row++)
          for (let x = row % 2 ? step / 2 : 0, col = 0; x < z.w + step; x += step, col++) {
            const px = x + (hash(col, row, 31) - 0.5) * 24,
              py = y + (hash(col, row, 32) - 0.5) * 24,
              r = 7 + hash(col, row, 33) * 3;
            g.fillEllipse(px, py + r * 0.35, r * 1.5, r * 1.25);
            for (const [ox, oy] of [[-0.85, -0.65], [-0.3, -1.05], [0.3, -1.05], [0.85, -0.65]]) g.fillCircle(px + ox * r, py + oy * r, r * 0.33);
          }
      }
      // frame
      f.clear();
      const L = z.left - z.frame,
        fv = z.frameV ?? z.frame,
        T = z.top - z.strip - fv,
        W = z.bw + z.frame * 2,
        H = z.bh + z.strip + fv * 2,
        r = Math.min(18, z.frame + 8);
      if (P.soil) {
        const soilH = Math.max(14, cell * 0.34);
        f.fillStyle(P.shadow[0], P.shadow[1]);
        f.fillEllipse(L + W / 2, T + H + soilH + 10, W * 0.92, soilH * 1.4);
        f.fillStyle(P.soilDark, 1);
        f.fillRoundedRect(L + 4, T + H - r, W - 8, soilH + r + 4, r);
        f.fillStyle(P.soil, 1);
        f.fillRoundedRect(L + 2, T + H - r, W - 4, soilH + r - 2, r);
        for (let i = 0; i < 9; i++) {
          f.fillStyle(P.soilDark, 0.55);
          f.fillEllipse(L + 16 + hash(i, 71) * (W - 32), T + H + 4 + hash(i, 72) * (soilH - 8), 7 + hash(i, 73) * 8, 4 + hash(i, 74) * 3);
        }
        f.fillStyle(P.rim, 1);
        f.fillRoundedRect(L, T, W, H, r);
        f.lineStyle(2, P.rimLight, 0.9);
        f.strokeRoundedRect(L + 2, T + 2, W - 4, H - 4, r - 2);
      } else {
        f.fillStyle(P.shadow[0], P.shadow[1]);
        f.fillRoundedRect(L, T + 6, W, H, r);
        f.fillStyle(P.outline, 1);
        f.fillRoundedRect(L, T, W, H, r);
        f.fillStyle(P.inner, 1);
        f.fillRoundedRect(L + 3, T + 3, W - 6, H - 6, r - 3);
      }
      this.placeProps(z, L, T, W, H, P);
      // flat checker tiles
      const ft = this.flatTiles;
      ft.clear();
      for (let y = 0; y < z.logicalRows; y++)
        for (let x = 0; x < z.logicalCols; x++) {
          ft.fillStyle((x + y) & 1 ? P.tileB : P.tileA, 1);
          ft.fillRect(z.left + x * cell, z.top + y * cell, cell + 0.5, cell + 0.5);
        }
      const gr = this.grout;
      gr.clear();
      gr.lineStyle(1, P.grid[0], tileMode === "none" ? 0 : P.grid[1]); // v0.23b: Tiles › No grid
      for (let i = 1; i < z.logicalCols; i++) gr.lineBetween(z.left + i * cell, z.top, z.left + i * cell, z.top + z.bh);
      for (let j = 1; j < z.logicalRows; j++) gr.lineBetween(z.left, z.top + j * cell, z.left + z.bw, z.top + j * cell);
      this.drawStrips(z);
      this.terrainKey = this.keyFor(z) + "|" + colorOf(getViewPlayer());
      this.pathKey = "";
      this.pathRef = null; // v0.23a
    }
    /**
     * Design variants: props from the design's art set around the island, like a diorama. The portal stands
     * above the spawn row (the monsters come out of it), the castle below the exit, trees and small things
     * peek out from behind the island's edges. Nothing is placed on the board itself.
     */
    placeProps(z, L, T, W, H, P) {
      const props = boardProps(),
        set = activeArtSet();
      if (!props || !set) return;
      // v0.23a: all props come from one atlas of the design ("terrain:<design>", see loadTerrainAtlas) and
      // draw in two batches: behind the island's edge and in front of its cliff (they were an image each)
      const atlas = "terrain:" + currentDesign();
      if (this.propAtlas !== atlas) {
        this.propBack?.destroy();
        this.propFront?.destroy();
        this.propBack = this.stage.sprites(atlas).setDepth(0.75);
        this.propFront = this.stage.sprites(atlas).setDepth(1.6);
        this.propAtlas = atlas;
      }
      this.propBack.clear();
      this.propFront.clear();
      if (!this.stage.hasTexture(atlas)) {
        this.loadTerrainAtlas(); // draws the board again once it is there
        return;
      }
      const list = [],
        cell = z.cw,
        put = (n, x, y, size, depth, flip = false) => {
          const r = this.stage.rect(atlas, n);
          if (!r) return;
          const meta = setArtMeta(set, "deco-" + n) || { w: r.w, h: r.h, footY: r.h },
            k = size / Math.max(meta.w, meta.h);
          list.push([depth, list.length, x, y, r.w * k, r.h * k, meta.footY / meta.h, flip, r.uv]);
        },
        soil = P.soil ? Math.max(14, cell * 0.34) : 6,
        cx = L + W / 2,
        trees = props.trees,
        small = props.small;
      // above the spawn row: the portal in the middle, trees to both sides (behind the island's edge)
      put(props.gate, cx, T + cell * 0.18, cell * 1.9, 0.8);
      for (let i = 0; i < 6; i++) {
        const side = i % 2 ? 1 : -1,
          step = Math.floor(i / 2),
          x = cx + side * (cell * 1.55 + step * cell * 1.05 + hash(i, 81) * cell * 0.3);
        if (x < L - cell * 0.4 || x > L + W + cell * 0.4) continue;
        put(trees[(i + step) % trees.length], x, T + cell * (0.22 + 0.08 * hash(i, 82)), cell * (0.95 + 0.25 * hash(i, 83)), 0.75 - step * 0.01, hash(i, 84) > 0.5);
      }
      // below the exit: the castle, flanked by trees and small things in front of the cliff
      const by = T + H + soil + cell * 0.55;
      put(props.goal, cx, by + cell * 0.55, cell * 2.1, 1.6);
      for (let i = 0; i < 6; i++) {
        const side = i % 2 ? 1 : -1,
          step = Math.floor(i / 2),
          x = cx + side * (cell * 1.7 + step * cell * 1.1 + hash(i, 91) * cell * 0.3),
          tree = step !== 1;
        if (x < L - cell * 0.4 || x > L + W + cell * 0.4) continue;
        put(tree ? trees[(i + 1) % trees.length] : small[i % small.length], x, by + cell * (tree ? 0.35 : 0.5) + hash(i, 92) * cell * 0.2, cell * (tree ? 1.05 : 0.6), 1.55 + (tree ? 0 : 0.02), hash(i, 93) > 0.5);
      }
      // along both sides: bushes and trees half hidden behind the island
      const rows = Math.max(2, Math.floor(H / (cell * 1.6)));
      for (let r = 0; r < rows; r++)
        for (const side of [-1, 1]) {
          const y = T + cell * 1.2 + (r + 0.5) * ((H - cell * 1.2) / rows) + hash(r, side, 95) * cell * 0.4,
            x = side < 0 ? L + cell * 0.12 : L + W - cell * 0.12,
            n = (r + (side > 0 ? 1 : 0)) % 3 === 0 ? small[(r + 2) % small.length] : trees[(r * 2 + (side > 0 ? 1 : 0)) % trees.length];
          put(n, x + side * cell * 0.25, y, cell * (small.includes(n) ? 0.55 : 0.85), 0.7, side > 0);
          // wide screens: a second, looser row further out where there is room
          if (L > cell * 1.1 && z.w - (L + W) > cell * 1.1) {
            const far = side < 0 ? L - cell * 0.85 : L + W + cell * 0.85,
              m = (r + (side > 0 ? 2 : 1)) % 2 ? trees[(r + 3) % trees.length] : small[(r * 3 + 1) % small.length];
            put(m, far + (hash(r, side, 97) - 0.5) * cell * 0.4, y + cell * 0.6, cell * (small.includes(m) ? 0.6 : 1), 0.65 + y * 1e-6, side < 0);
          }
        }
      // the depths they had as single images (behind the frame below 1, in front of it above) give the order
      list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [depth, , x, y, w, h, oy, flip, uv] of list) (depth < 1 ? this.propBack : this.propFront).quad(x, y, w, h, 0.5, oy, 0, flip, 0xffffff, 1, uv);
    }
    /** Spawn strip: a row of quarter-height portal fields above the board. */
    drawStrips(z) {
      const g = this.strips,
        cell = z.cw,
        sh = z.strip,
        top = z.top - sh,
        bottom = z.top + z.bh;
      g.clear();
      const P = boardPalette();
      if (P) {
        // design variants: light portal row, rounded pads
        g.fillStyle(P.stripDeep, 1);
        g.fillRect(z.left, top, z.bw, sh);
        for (let x = 0; x < z.logicalCols; x++) {
          const x0 = z.left + x * cell + 3;
          g.fillStyle(P.strip, 1);
          g.fillRoundedRect(x0, top + 2, cell - 6, sh - 4, Math.min(8, sh / 2 - 1));
          g.fillStyle(0xffffff, 0.75);
          g.fillRoundedRect(x0 + cell * 0.22, top + sh * 0.38, cell * 0.56 - 6, sh * 0.24, sh * 0.12);
        }
        return;
      }
      g.fillStyle(0x1a0d2e, 1);
      g.fillRect(z.left, top, z.bw, sh);
      for (let x = 0; x < z.logicalCols; x++) {
        const x0 = z.left + x * cell + 3;
        g.fillStyle(0x3b1a63, 1);
        g.fillRoundedRect(x0, top + 2, cell - 6, sh - 4, Math.min(6, sh / 2 - 1));
        g.fillStyle(0x8a4dff, 0.55);
        g.fillRoundedRect(x0 + cell * 0.18, top + sh * 0.35, cell * 0.64 - 6, sh * 0.3, sh * 0.15);
        g.lineStyle(1.5, 0xc79bff, 0.7);
        g.strokeRoundedRect(x0, top + 2, cell - 6, sh - 4, Math.min(6, sh / 2 - 1));
      }
      // v0.09: no goal line any more; creeps break through as they leave the board at the bottom
    }
    drawPathTiles(player, z) {
      const path = player.path || NO_PATH,
        frozen = (player.perks?.permafrost || 0) > 0, // v0.10o: Frozen Ground (was Permafrost) turns the path to ice
        hills = (player.perks?.hills || 0) > 0; // v0.22h1: Hill Paths: the upward steps become muddy hill trails
      // v0.23: the simulation hands out a new path array whenever the path changes: compare that (and the
      // flags) first, the key string is only built when one of them changed
      if (path === this.pathRef && frozen === this.pathIce && hills === this.pathHills) return;
      this.pathRef = path;
      this.pathIce = frozen;
      this.pathHills = hills;
      const key = path.map((p) => p.gridX + "," + p.gridY).join(";") + "|" + this.terrainKey + (frozen ? "|ice" : "") + (hills ? "|hill" : "");
      if (key === this.pathKey) return;
      this.pathKey = key;
      const cell = z.cw,
        tiles = this.pathBatch.clear(),
        ice = this.iceBatch.clear(),
        PP = boardPalette(); // design variants
      for (const p of path) {
        if (p.gridY < 0 || p.gridY >= z.logicalRows) continue; // strips are not tiled
        // v0.23: one batch for the tiles, one for the ice sheen (they were an image each)
        const x = z.left + (p.gridX + 0.5) * cell,
          y = z.top + (p.gridY + 0.5) * cell,
          rot = (Math.floor(hash(p.gridX, p.gridY, 7) * 4) * 90 * Math.PI) / 180;
        // design variants: the path is a flat, light colour (sand / peach), no stone texture (v0.23a: fill tint in the batch)
        tiles.quad(x, y, cell + 0.6, cell + 0.6, 0.5, 0.5, rot, false, frozen ? [0x5fa9e6, 0x6ab3ec, 0x58a2e0, 0x72b8ee][Math.floor(hash(p.gridX, p.gridY, 9) * 4)] : PP ? PP.path[(p.gridX + p.gridY) & 1 ? 1 : 0] : 0xffffff, 1, null, PP && !frozen ? 1 : 0); // v0.22h1: deeper water blue
        // v0.10o: Permafrost: a pale ice sheen over the same tile
        if (frozen) ice.quad(x, y, cell + 0.6, cell + 0.6, 0.5, 0.5, rot, false, 0xb4e4ff, 0.34 + 0.1 * hash(p.gridX, p.gridY, 11), null, 1);
      }
      this.drawTerrainFx(path, z, frozen, hills);
    }
    /**
     * v0.22h1: path dressing. Frozen Ground: a glossy sheet of ice (water-blue wash, cracks, light streaks).
     * Hill Paths: every tile of an upward step turns into a muddy hill trail with boulders along its sides.
     */
    drawTerrainFx(path, z, frozen, hills) {
      const g = this.terrainFx,
        cell = z.cw;
      g.clear();
      if (!frozen && !hills) return;
      const inside = (p) => p.gridY >= 0 && p.gridY < z.logicalRows,
        up = new Set();
      if (hills)
        for (let k = 1; k < path.length; k++)
          if (path[k].gridY < path[k - 1].gridY) {
            up.add(path[k - 1].gridX + "," + path[k - 1].gridY);
            up.add(path[k].gridX + "," + path[k].gridY);
          }
      for (let k = 0; k < path.length; k++) {
        const p = path[k];
        if (!inside(p)) continue;
        const x0 = z.left + p.gridX * cell,
          y0 = z.top + p.gridY * cell,
          h = (n) => hash(p.gridX, p.gridY, n);
        if (up.has(p.gridX + "," + p.gridY)) {
          // the trail runs up and down here: boulders sit left and right, otherwise above and below
          const prev = path[k - 1],
            next = path[k + 1],
            vertical = (prev && prev.gridX === p.gridX) || (next && next.gridX === p.gridX);
          g.fillStyle(0x6b4423, 0.42);
          g.fillRect(x0, y0, cell, cell);
          g.fillStyle(0x4a2c14, 0.45);
          for (let m = 0; m < 4; m++) g.fillEllipse(x0 + cell * (0.22 + 0.56 * h(20 + m)), y0 + cell * (0.2 + 0.6 * h(30 + m)), cell * (0.14 + 0.1 * h(40 + m)), cell * (0.08 + 0.05 * h(50 + m)));
          // faint steps cut into the slope
          g.lineStyle(Math.max(1, cell * 0.035), 0x3a2210, 0.35);
          for (let m = 1; m < 4; m++) {
            if (vertical) g.lineBetween(x0 + cell * 0.28, y0 + (cell * m) / 4, x0 + cell * 0.72, y0 + (cell * m) / 4);
            else g.lineBetween(x0 + (cell * m) / 4, y0 + cell * 0.28, x0 + (cell * m) / 4, y0 + cell * 0.72);
          }
          for (let m = 0; m < 4; m++) {
            const side = m % 2 ? 1 : 0,
              along = 0.15 + 0.7 * h(60 + m),
              across = side ? 0.9 - 0.06 * h(70 + m) : 0.1 + 0.06 * h(70 + m),
              bx = x0 + cell * (vertical ? across : along),
              by = y0 + cell * (vertical ? along : across),
              r = cell * (0.06 + 0.05 * h(80 + m));
            g.fillStyle(0x2a1a0e, 0.5);
            g.fillEllipse(bx + r * 0.2, by + r * 0.35, r * 2.1, r * 1.3);
            g.fillStyle([0x8d8478, 0x9b9184, 0x7c7468][Math.floor(h(90 + m) * 3)], 1);
            g.fillEllipse(bx, by, r * 2, r * 1.6);
            g.fillStyle(0xe2dcd0, 0.55);
            g.fillEllipse(bx - r * 0.35, by - r * 0.3, r * 0.7, r * 0.45);
          }
        } else if (frozen) {
          // glossy ice: a water-blue wash, a hairline crack and two light streaks
          g.fillStyle(0x3f9be8, 0.16);
          g.fillRect(x0, y0, cell, cell);
          g.lineStyle(Math.max(1, cell * 0.02), 0xeaf8ff, 0.45);
          const cx = x0 + cell * (0.3 + 0.4 * h(21)),
            cy = y0 + cell * (0.3 + 0.4 * h(22));
          g.lineBetween(cx, cy, cx + cell * (0.18 - 0.36 * h(23)), cy + cell * 0.22);
          g.lineBetween(cx, cy, cx - cell * 0.2, cy - cell * (0.1 + 0.12 * h(24)));
          g.lineStyle(Math.max(1.5, cell * 0.05), 0xffffff, 0.22);
          g.lineBetween(x0 + cell * 0.15, y0 + cell * 0.55, x0 + cell * 0.45, y0 + cell * 0.25);
          g.lineBetween(x0 + cell * 0.5, y0 + cell * 0.8, x0 + cell * 0.72, y0 + cell * 0.58);
        }
      }
    }
    // ---- pooled floating text -----------------------------------------------------
    floatText(x, y, text, color = "#ffe27a", size = 15, rise = 34, life = 0.9, bonus = false) {
      // v0.13: Options › Graphic can hide the numbers (+gold, hearts, damage) and the word pop-ups
      const numeric = /\d/.test(text);
      if (numeric ? !popups.numbers : !popups.notes) return;
      if (this.floaters.length > 36) this.recycle(this.floaters.shift());
      const t =
        this.textPool.pop() ||
        this.stage.text(0, 0, "", { fontFamily: FONT, stroke: "#14231e", strokeThickness: 5, resolution: DPR }).setOrigin(0.5, 1).setDepth(6000);
      t.setText(text).setColor(color).setFontSize(size).setStroke(bonus ? "#3a2200" : "#14231e", bonus ? 9 : 5).setPosition(x, y).setAlpha(1).setScale(0.6).setVisible(true);
      this.floaters.push({ t, x, y, rise, life, max: life, bonus, size, seed: Math.random() * 6.28 });
    }
    recycle(f) {
      f.t.setVisible(false);
      this.textPool.push(f.t);
    }
    burst(x, y, color, count = 8, speed = 70, size = 2.6, life = 0.45, gravity = 120, additive = false) {
      for (let i = 0; i < count; i++) {
        const a = (Math.PI * 2 * i) / count + Math.random() * 0.6,
          v = speed * (0.5 + Math.random() * 0.7);
        this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.35, life, max: life, color, size, gravity, additive });
      }
      if (this.particles.length > 280) this.particles.splice(0, this.particles.length - 280);
    }
    ring(x, y, r0, r1, color, life = 0.35, width = 2.5) {
      this.rings.push({ x, y, r0, r1, color, life, max: life, width });
    }
    consumeEvents(game, view, own, catalog, z, time) {
      const cell = z.cw;
      for (const e of game.events || []) {
        const seq = e.seq || e.id || 0;
        if (seq <= this.lastEvent) continue;
        this.lastEvent = Math.max(this.lastEvent, seq);
        const lane = game.players[view];
        if (e.type === "shot" && e.player === view) {
          const tower = lane.towers.find((t) => t.id === e.towerId),
            def = catalog.byId[tower?.typeId],
            origin = e.bounce ? e.from : tower || e.from,
            from = this.point(origin.x, origin.y);
          const sprite = this.units.get(`${view}:t:${e.towerId}`);
          if (sprite) {
            sprite.setData("recoil", time + 120).setData("atk", time);
            sprite.setData("aimX", e.to.x < (tower || e.from).x ? -1 : 1);
          }
          if (e.focus) {
            // v0.18b: Focus Fire: a steady beam from the tower to its target, stronger the longer it holds
            const to = this.point(e.to.x, e.to.y),
              beam = this.beams.get(e.towerId) || {};
            Object.assign(beam, { targetId: e.targetId, x0: from.x, y0: from.y - cell * 0.55, tx: to.x, ty: to.y - cell * 0.2, power: clamp((e.focus - 1) / Math.max(1, (e.focusMax || 5) - 1), 0, 1), life: 0.6, max: 0.6 });
            beam.shown ??= 0;
            this.beams.set(e.towerId, beam);
          } else if (def?.fields?.ua1w === "normal") {
            const to = this.point(e.to.x, e.to.y);
            this.swipes.push({ a: { x: from.x, y: from.y - cell * 0.35 }, b: to, life: 0.18, max: 0.18, cell });
            this.burst(to.x, to.y - cell * 0.15, 0xfff1c4, 5, 50, 2, 0.22, 0, true);
          } else {
            const style = shotStyle(def),
              to = this.point(e.to.x, e.to.y),
              d = Math.hypot(to.x - from.x, to.y - from.y);
            this.projectiles.push({
              x0: from.x,
              y0: from.y - cell * 0.55,
              targetId: e.targetId,
              tx: to.x,
              ty: to.y - cell * 0.2,
              t: 0,
              // v0.23b: arrows fly 30 % faster
              dur: clamp(d / (cell * 10), 0.07, 0.34) / (/arrow/i.test(def?.fields?.ua1m || "") || def?.attackType === "pierce" ? 1.3 : 1),
              ...style,
              arc: style.splash ? cell * 0.5 : 0,
            });
          }
        } else if (e.type === "skill" && e.player === view) {
          const q = this.point(e.x, e.y);
          if (e.kind === "execute") {
            this.floatText(q.x, q.y - cell * 0.55, t("EXECUTE {n}", { n: e.amount }), "#ff6a5a", 17, 44, 1.1);
            this.ring(q.x, q.y, cell * 0.1, cell * 0.7, 0xff5040, 0.6, 3);
            this.burst(q.x, q.y - cell * 0.2, 0xff8a5a, 10, 90, 2.6, 0.4, 0, true);
          } else if (e.kind === "stun") {
            this.floatText(q.x, q.y - cell * 0.55, t("STUNNED"), "#ffe26a", 12, 30, 0.8);
            this.burst(q.x, q.y - cell * 0.5, 0xfff0a0, 6, 50, 2, 0.35, 0, true);
          } else if (e.kind === "entangle") {
            this.floatText(q.x, q.y - cell * 0.55, t("ENTANGLED"), "#9cff8a", 12, 30, 0.9);
            this.ring(q.x, q.y + cell * 0.1, cell * 0.1, cell * 0.45, 0x6bdc5a, 0.6, 3);
          } else if (e.kind === "howl") {
            // v0.17p: Pit Lord's Howl
            const r = ((e.radius || 192) / game.grid.cellUnits) * cell;
            this.ring(q.x, q.y + cell * 0.1, cell * 0.2, r, 0xb04a8a, 0.6, 4);
          } else if (e.kind === "stomp") {
            const r = ((e.radius || 256) / game.grid.cellUnits) * cell;
            this.ring(q.x, q.y + cell * 0.1, cell * 0.2, r, 0xd8b070, 0.7, 5);
            this.burst(q.x, q.y + cell * 0.15, 0xc9a46a, 14, 120, 3, 0.5, 40);
            this.stage.shake(90, 0.003);
          } else if (e.kind === "splash") {
            const r = ((e.radius || 150) / game.grid.cellUnits) * cell,
              core = ((e.core || 45) / game.grid.cellUnits) * cell;
            this.ring(q.x, q.y + cell * 0.05, core * 0.5, r, 0xffb060, 0.55, 3);
            this.ring(q.x, q.y + cell * 0.05, core * 0.2, core, 0xfff0c0, 0.8, 3);
            this.burst(q.x, q.y, 0xffc070, 8, 70, 2.4, 0.35, 0, true);
          } else if (e.kind === "empower") {
            const tower = lane.towers.find((t) => t.id === e.towerId),
              tq = tower ? this.point(tower.x, tower.y) : q;
            this.floatText(tq.x, tq.y - cell * 0.9, t("MAGIC BURST"), "#d8b8ff", 13, 34, 1);
            this.ring(q.x, q.y, cell * 0.1, cell * 0.75, 0xb88cff, 0.75, 4);
            this.burst(q.x, q.y - cell * 0.2, 0xd0b0ff, 12, 100, 2.8, 0.5, 0, true);
          } else if (e.kind === "fireblock") {
            // v0.19j: Fire Block: a small explosion near the breach
            this.floatText(q.x, q.y - cell * 0.7, t("FIRE BLOCK"), "#ffb070", 13, 34, 1.1);
            this.ring(q.x, q.y, cell * 0.2, cell * 1.5, 0xff7a2a, 0.8, 5);
            this.burst(q.x, q.y - cell * 0.2, 0xffb040, 18, 130, 3, 0.55, -40, true);
          } else if (e.kind === "waterblock") {
            this.floatText(q.x, q.y - cell * 0.6, t("BLOCKED"), "#9ee0ff", 13, 34, 1.1);
            this.ring(q.x, q.y, cell * 0.2, cell * 1.1, 0x7fd0ff, 0.8, 4);
          } else if (e.kind === "airblock") {
            // v0.20c: Air Block: a gust ring and a short text where the flyer was turned back
            this.floatText(q.x, q.y - cell * 0.7, t("AIR BLOCK"), "#c8f6ff", 13, 34, 1.1);
            this.ring(q.x, q.y, cell * 0.2, cell * 1.3, 0xbff0f4, 0.85, 5);
            this.burst(q.x, q.y - cell * 0.2, 0xe8fbff, 14, 120, 2.6, 0.45, -20, true);
          } else if (e.kind === "guardOn") {
            this.floatText(q.x, q.y - cell * 0.7, t("RIVER GUARDIAN"), "#9ee0ff", 12, 30, 1.1);
            this.ring(q.x, q.y - cell * 0.2, cell * 0.6, cell * 0.25, 0x7fd0ff, 0.5, 3);
          } else if (e.kind === "guardBreak") {
            // the shield cracks: a bright ring, shards flying off, then it is gone
            this.ring(q.x, q.y - cell * 0.25, cell * 0.3, cell * 0.75, 0xd8f6ff, 0.35, 3);
            this.burst(q.x, q.y - cell * 0.3, 0x9fe4ff, 14, 120, 2.6, 0.45, 160, true);
            this.burst(q.x, q.y - cell * 0.3, 0xffffff, 6, 80, 1.8, 0.3, 120, true);
            this.floatText(q.x, q.y - cell * 0.7, t("SHIELD BROKEN"), "#c8f0ff", 11, 26, 0.9);
          } else if (e.kind === "pocks") {
            this.floatText(q.x, q.y - cell * 0.6, t("POCKS"), "#b8ff6a", 12, 30, 1);
            this.burst(q.x, q.y - cell * 0.3, 0x9cff4a, 10, 60, 2.4, 0.6, -20, true);
          } else if (e.kind === "golemHit") {
            this.burst(q.x, q.y - cell * 0.2, 0xd8a8ff, 8, 90, 2.4, 0.4, 0, true);
            this.ring(q.x, q.y, cell * 0.1, cell * 0.5, 0xc07aff, 0.4, 3);
          } else if (e.kind === "enrage") {
            // v0.21z: the Meat Golem denies its death and rises enraged
            this.floatText(q.x, q.y - cell * 0.95, t("ENRAGED"), "#ff5a4a", 16, 40, 1.4);
            this.ring(q.x, q.y + cell * 0.1, cell * 0.3, cell * 1.4, 0xff3a2a, 0.9, 5);
            this.burst(q.x, q.y - cell * 0.4, 0xff6a4a, 16, 110, 3, 0.6, 0, true);
            this.stage.shake(220, 0.002);
          } else if (e.kind === "crowd") this.floatText(q.x, q.y - cell * 0.55, t("CULLED"), "#ff9a5a", 12, 30, 0.9);
          else if (e.kind === "miss") this.floatText(q.x, q.y - cell * 0.5, t("DODGED"), "#c9d4dc", 11, 26, 0.7);
          else if (e.kind === "ultimate") {
            const names = { entangle: "ENTANGLE", decay: "DECAY", shrink: "SHRINK RAY", rockets: "ROCKET SWARM", flamestrike: "FLAME STRIKE", chain: "CHAIN LIGHTNING", blizzard: "BLIZZARD", tsunami: "TSUNAMI", raise: "RAISE DEAD" };
            const tower = lane.towers.find((t) => t.id === e.towerId),
              tq = tower ? this.point(tower.x, tower.y) : q;
            this.floatText(tq.x, tq.y - cell * 0.95, t(names[e.name] || "ULTIMATE"), "#ffd86a", 15, 40, 1.3);
            this.ring(q.x, q.y, cell * 0.2, cell * 1.4, e.name === "blizzard" || e.name === "tsunami" ? 0x8fd0ff : e.name === "decay" ? 0x9cff6a : 0xffb050, 0.7, 5);
            this.burst(q.x, q.y - cell * 0.2, 0xffe6a0, 16, 130, 3, 0.6, 0, true);
          } else if (e.kind === "curse") {
            this.floatText(q.x, q.y - cell * 0.7, t("CURSED"), "#d8a8ff", 12, 30, 1);
            this.burst(q.x, q.y - cell * 0.4, 0xb070ff, 8, 50, 2.2, 0.5, -20, true);
          }
        } else if (e.type === "volley" && e.player === view) {
          // an arrow from the sky: falls steeply onto its creep (or the ground)
          // v0.22q2: every arrow from a slightly different angle (left, steep or a bit from the right) and height
          const to = this.point(e.x, e.y),
            drift = (hash(seq, 3) - 0.5) * cell * 0.6,
            slant = (hash(seq, 7) - 0.65) * cell * 1.3,
            high = cell * (2.3 + hash(seq, 11) * 0.7);
          this.projectiles.push({ x0: to.x + drift + slant, y0: to.y - high, targetId: e.targetId, tx: to.x + drift * 0.2, ty: to.y - cell * 0.15, t: 0, dur: 0.26, color: 0xffe28a, size: 3.6, splash: false, glow: false, arc: 0, arrow: true });
        } else if (e.type === "plank" && e.player === view) {
          // v0.23zb: a Siege Plank lands on a tower
          const q = this.point(e.x, e.y);
          this.burst(q.x, q.y, 0xc8a070, 12, 70, 2.4, 0.5, 30, false);
          this.floatText(q.x, q.y - cell * 0.6, t("SIEGE PLANK"), "#e8c890", 13, 34, 1.1);
        } else if (e.type === "infested" && e.player === view) {
          // v0.23x: a field turns into infested ground
          const q = this.point(e.x, e.y);
          this.ring(q.x, q.y, cell * 0.1, cell * 0.75, 0x7dff3a, 0.8, 4);
          this.burst(q.x, q.y, 0xb8ff7a, 12, 70, 2.4, 0.5, -20, true);
          this.floatText(q.x, q.y - cell * 0.6, t("INFESTED"), "#c8ff8a", 13, 34, 1.1);
        } else if (e.type === "infestedBurst" && e.player === view) {
          // v0.23x: a strong green beam bursts up from the ground through the creep
          const q = this.point(e.x, e.y);
          this.bolts.push({ pts: [{ x: q.x, y: q.y + cell * 0.25 }, { x: q.x, y: q.y - cell * 2.4 }], life: 0.32, max: 0.32, plague: true });
          this.ring(q.x, q.y + cell * 0.15, cell * 0.1, cell * 0.5, 0x7dff3a, 0.9, 3);
          this.burst(q.x, q.y - cell * 0.2, 0xc8ff8a, 12, 110, 2.6, 0.45, -60, true);
          this.floatText(q.x, q.y - cell * 0.7, String(e.damage), "#c8ff8a", 13, 34, 1);
        } else if (e.type === "frostbolt" && e.player === view) {
          // v0.23w: Frost Bolt: an icy streak from the upper right, then a frost ring and ice shards over the area
          const q = this.point(e.x, e.y);
          this.bolts.push({ pts: [{ x: q.x + cell * 1.6, y: q.y - cell * 3.4 }, { x: q.x, y: q.y - cell * 0.2 }], life: 0.3, max: 0.3, ice: true });
          this.ring(q.x, q.y, cell * 0.2, cell * e.radius, 0x5ac8ff, 0.9, 5);
          this.ring(q.x, q.y, cell * 0.1, cell * e.radius * 0.7, 0xe0f8ff, 0.75, 3);
          this.burst(q.x, q.y - cell * 0.2, 0xcff2ff, 20, 130, 3, 0.6, 20, true);
          this.burst(q.x, q.y, 0x7ad8ff, 12, 90, 2.4, 0.5, 0, true);
          if (e.hits) this.floatText(q.x, q.y - cell * 0.6, t("FROST BOLT") + " " + e.damage, "#bfeaff", 14, 38, 1.1);
        } else if (e.type === "burst" && e.player === view) {
          // v0.10p: Arcane Burst: violet shock ring over the whole area
          const q = this.point(e.x, e.y);
          this.ring(q.x, q.y, cell * 0.2, cell * e.radius, 0xc07aff, 0.85, 5);
          this.ring(q.x, q.y, cell * 0.1, cell * e.radius * 0.7, 0xf0d8ff, 0.7, 3);
          this.burst(q.x, q.y, 0xd8a8ff, 18, 140, 3, 0.6, 0, true);
          if (e.hits) this.floatText(q.x, q.y - cell * 0.6, t("ARCANE BURST") + " " + e.damage, "#e2c2ff", 14, 38, 1.1);
        } else if (e.type === "lightning" && e.player === view) {
          // v0.12: Monsun lightning, a jagged bolt from the sky
          const q = this.point(e.x, e.y),
            pts = [];
          for (let k = 0, n = 7; k <= n; k++) pts.push({ x: q.x + (k && k < n ? (Math.random() - 0.5) * cell * 0.7 : 0), y: q.y - cell * 0.3 - cell * 3.2 * (1 - k / n) });
          this.bolts.push({ pts, life: 0.28, max: 0.28, small: !!e.small });
          this.burst(q.x, q.y - cell * 0.3, 0xfff6b0, e.small ? 6 : 10, 90, 2.4, 0.35, 0, true);
          this.flash = Math.max(this.flash, e.small ? 0 : 0.12);
        } else if (e.type === "summon" && e.player === view) {
          const q = this.point(e.x, e.y);
          this.ring(q.x, q.y + cell * 0.1, cell * 0.1, cell * 1.1, 0xc07aff, 0.9, 5);
          this.ring(q.x, q.y + cell * 0.1, cell * 0.2, cell * 0.7, 0xf0d8ff, 0.7, 3);
          this.burst(q.x, q.y - cell * 0.3, 0xe2c2ff, 18, 120, 3, 0.7, -30, true);
          this.floatText(q.x, q.y - cell * 0.8, t("SUMMONED"), "#e2c2ff", 14, 38, 1.2);
        } else if ((e.type === "golem" || e.type === "golemPortal" || e.type === "golemDown") && e.player === view) {
          const q = this.point(e.x, e.y);
          this.ring(q.x, q.y, cell * 0.2, cell * (e.type === "golemDown" ? 0.8 : 1.2), 0xc07aff, 0.7, 4);
          this.burst(q.x, q.y - cell * 0.3, e.type === "golemDown" ? 0xb8b0a8 : 0xd8a8ff, 14, 100, 3, 0.6, 30, e.type !== "golemDown");
          if (e.type === "golemPortal") this.floatText(q.x, q.y + cell * 0.2, t("TO THE NEXT LANE"), "#e2c2ff", 12, 30, 1.1);
        } else if (e.type === "pillar" && e.player === view) {
          const q = this.point(e.x, e.y);
          this.floatText(q.x, q.y - cell * (e.radius || 2.5) * 0.6, t("PILLAR OF FIRE"), "#ffb070", 15, 40, 1.2);
        } else if (e.type === "monsun" && e.player === view) {
          this.floatText(z.left + z.bw / 2, z.top + z.bh * 0.45, t("MONSUN"), "#bfe6ff", 20, 50, 1.4);
        } else if (e.type === "volleyStart" && e.player === view) {
          const q = this.point(e.x, e.y);
          this.ring(q.x, q.y, cell * 0.3, cell * 1.5, 0xffe7a8, 0.6, 3);
        } else if ((e.type === "income" || e.type === "expGen") && e.player === view && e.gens?.length) {
          // v0.17c: EXP pop-up over every EXP generator (v0.19d2: every 4 s since v0.24oF)
          for (const gen of e.gens) {
            const q = this.point(gen.x, gen.y),
              n = Math.round(gen.exp * 100) / 100;
            this.burst(q.x, q.y - cell * 0.35, 0xb48cff, 6, 45, 2.2, 0.55, -30, true);
            this.floatText(q.x, q.y - cell * 0.45, `+${n} EXP`, "#d2b0ff", 15, 44, 1.2);
          }
        } else if (e.type === "kill" && e.player === view) {
          (this.killed ||= new Map()).set(`${view}:c:${e.creepId}`, time); // v0.23a (creep graphic overhaul): death animation
          const q = this.point(e.x, e.y),
            def = catalog.byId[e.id],
            big = !!def?.bossTier;
          this.burst(q.x, q.y - cell * 0.2, 0xf7f1dd, big ? 18 : 9, big ? 120 : 75, big ? 3.6 : 2.6, big ? 0.7 : 0.45);
          this.burst(q.x, q.y - cell * 0.2, 0xb48cff, big ? 10 : 5, 55, 2.4, 0.55, -30, true);
          this.ring(q.x, q.y, cell * 0.1, cell * (big ? 0.9 : 0.45), 0xfff6d5, big ? 0.5 : 0.3, big ? 4 : 2);
          // v0.22j1: bounty without decimals; a Bounty Bonus kill gets a thicker outline and a calm golden glitter
          if (e.bounty > 0) this.floatText(q.x, q.y - cell * 0.45, `+${Math.max(1, Math.round(e.bounty))}`, e.bonus ? "#fff1a0" : "#ffe27a", (big ? 20 : 15) + (e.bonus ? 2 : 0), 34, e.bonus ? 1.05 : 0.9, !!e.bonus);
          if (big) this.stage.shake(180, 0.006);
        } else if (e.type === "leak" && (e.player === own || e.owner === own)) {
          // Life pop-ups always count the player's own lives, whichever maze is on screen:
          // −1 when a creep breaks through at home, +1 when one of ours breaks through over there.
          const lost = e.player === own,
            here = e.player === view,
            q = this.point(e.x, e.y);
          this.floatText(q.x, q.y - cell * 0.3, lost ? `−${e.amount || 1} ♥` : "+1 ♥", lost ? "#ff9aa0" : "#8ff0b0", lost ? 22 : 20, 46, 1.2);
          if (here) this.ring(q.x, q.y, cell * 0.2, cell * 1.3, lost ? 0xff6b74 : 0x7fe8a0, 0.5, 4);
          if (lost) {
            this.flash = 1;
            if (here) this.stage.shake(140, 0.005);
          } else this.gainFlash = 1;
        } else if ((e.type === "build" || e.type === "upgrade") && e.player === view) {
          const tower = lane.towers.find((t) => t.id === e.towerId);
          if (tower) {
            const q = this.point(tower.x, tower.y);
            this.burst(q.x, q.y + cell * 0.18, 0xd9c79a, 10, 55, 2.6, 0.45, 60);
            this.ring(q.x, q.y + cell * 0.1, cell * 0.2, cell * 0.66, e.type === "upgrade" ? 0xfff0a0 : 0xe8dcb5, 0.4, 3);
            const sprite = this.units.get(`${view}:t:${e.towerId}`);
            if (sprite) sprite.setData("pop", time);
            if (e.evolution) {
              // v0.16: Evolution reward: green arrows rise from the upgraded tower
              [-0.28, 0, 0.28, -0.14, 0.14].forEach((dx, k) =>
                this.floatText(q.x + dx * cell, q.y - cell * (0.1 + (k > 2 ? 0.25 : 0)), "▲", k > 2 ? "#b8ffbf" : "#6ee87a", k > 2 ? 16 : 22, 70 + k * 6, 1.1 + k * 0.08),
              );
              this.ring(q.x, q.y + cell * 0.1, cell * 0.2, cell * 0.8, 0x6ee87a, 0.55, 4);
            }
          }
        } else if (e.type === "built" && e.player === view) {
          const tower = lane.towers.find((t) => t.id === e.towerId);
          if (tower) {
            const q = this.point(tower.x, tower.y);
            this.burst(q.x, q.y - cell * 0.4, 0xfff3b0, 9, 55, 2.2, 0.45, -20, true);
            this.ring(q.x, q.y + cell * 0.12, cell * 0.25, cell * 0.6, 0x7fdcff, 0.45, 3);
          }
        } else if (e.type === "sell" && e.player === view) {
          // v0.17b: the tower is already removed when the event arrives; the event carries its position
          const tower = lane.towers.find((t) => t.id === e.towerId) || (e.x !== undefined ? { x: e.x, y: e.y } : null);
          if (tower) {
            const q = this.point(tower.x, tower.y);
            this.burst(q.x, q.y, 0xd9c79a, 12, 70, 2.6, 0.5);
            if (e.refund > 0) {
              this.burst(q.x, q.y - cell * 0.3, 0xffd34a, 10, 60, 2.4, 0.6, -30, true);
              this.floatText(q.x, q.y - cell * 0.35, `+${Math.round(e.refund)} Gold`, "#ffd84a", 18, 52, 1.3);
            }
          }
        }
      }
    }
    /** `redraw`: a frame drawn out of turn (after a resize) without a game tick. */
    update(time, delta, redraw = false) {
      this.stepSlide();
      if (!redraw) onTick(Math.min(delta / 1000, 0.1));
      const game = getState();
      if (!game) return;
      // v0.23: while the game is paused or a dialog is open, the board redraws ~10 times a second (unless a
      // finger or the mouse is busy with it); the canvas keeps showing the last frame in between
      const wall = performance.now();
      if (!redraw && (game.paused || modalEl?.open) && !this.press && !this.slide && !this.scrollVel && wall - (this.pointer?.at ?? -1e9) > 400 && wall >= this.stage.shakeUntil && wall - (this.drawnAt ?? -1e9) < 100)
        return false;
      const dt = redraw ? 0 : Math.min((wall - (this.drawnAt ?? wall - delta)) / 1000, 0.1);
      this.drawnAt = wall;
      this.prefetch(wall);
      if (this.gameSeed !== game.seed || game.eventId < this.lastEvent) {
        this.gameSeed = game.seed;
        this.lastEvent = game.eventId || 0;
        this.clearFx();
        this.scrollY = null; // Mobile Max: a new match starts with the board in the middle
        this.scrollVel = 0;
      }
      this.stepScroll(this.geometry(), dt);
      const view = getViewPlayer(),
        own = getOwnPlayer(),
        player = game.players[view],
        catalog = getCatalog(),
        z = this.geometry(),
        g = this.overlay,
        pl = this.pathLayer,
        glow = this.glow;
      g.clear();
      pl.clear();
      glow.clear();
      this.bars.clear();
      this.hpBars.clear();
      if (this.terrainKey !== this.keyFor(z) + "|" + colorOf(view)) {
        this.drawTerrain();
        this.press = null;
      }
      if (view !== this.lastView) {
        this.clearFx();
        this.lastView = view;
        this.lastEvent = game.eventId || 0;
        this.pathKey = "";
        this.pathRef = null;
      }
      const cell = z.cw,
        selected = z.passive ? null : getSelection(),
        preview = z.passive ? null : getPreview();
      this.drawPathTiles(player, z);
      // ---- ambient light: braziers, portal, castle, fireflies
      for (const b of this.braziers || []) {
        const flick = 0.75 + 0.25 * Math.sin(time * 0.013 + b.seed * 3) * Math.sin(time * 0.007 + b.seed);
        glow.fillStyle(0xff9a3c, 0.1 * flick);
        glow.fillCircle(b.x, b.y, cell * 0.9);
        glow.fillStyle(0xffb050, 0.22 * flick);
        glow.fillCircle(b.x, b.y, cell * 0.35);
        glow.fillStyle(0xffe08a, 0.9);
        glow.fillTriangle(b.x - 3.5, b.y, b.x + 3.5, b.y, b.x + Math.sin(time * 0.02 + b.seed) * 1.5, b.y - 9 * flick);
      }
      // portal fields shimmer along the spawn strip
      for (let x = 0; x < z.logicalCols; x++) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.004 + x * 1.3),
          cx = z.left + (x + 0.5) * cell;
        glow.fillStyle(0xa04dff, 0.1 + 0.08 * pulse);
        glow.fillEllipse(cx, z.top - z.strip / 2, cell * 0.9, z.strip * 1.6);
      }
      for (const f of boardPalette() ? [] : this.fireflies) {
        const x = (f.x * z.w + Math.sin(time * 0.0004 + f.seed) * 40 + z.w) % z.w,
          y = ((f.y * z.h + Math.cos(time * 0.0003 + f.seed * 2) * 30 + z.h) % z.h) + (this.stage.scrollY || 0),
          a = 0.35 + 0.35 * Math.sin(time * 0.003 + f.seed * 5);
        glow.fillStyle(0xd8ff8a, a * 0.35);
        glow.fillCircle(x, y, 4);
        glow.fillStyle(0xf4ffc8, a);
        glow.fillCircle(x, y, 1.4);
      }
      // ---- v0.10p: Lava Floor (v0.10q: 6th row; v0.23k: random tiles). v0.22i1: looks like its perk tile (dark basalt plates on
      // glowing lava, bright cracks and bubbles) and lies under every field of the row, towers included
      // v0.23k: on the player's lava tiles (random fields) instead of the whole 6th row
      if ((player.perks?.hellfire || 0) > 0) {
        for (const [col, y] of player.lava || []) {
          const x0 = z.left + col * cell,
            y0 = z.top + y * cell,
            flick = 0.5 + 0.5 * Math.sin(time * 0.003 + col * 1.7),
            h = (n) => hash(col, y, n);
          pl.fillStyle(0x3a0e06, 0.92);
          pl.fillRect(x0, y0, cell, cell);
          pl.fillStyle(0xff5a0a, 0.82 + 0.12 * flick);
          pl.fillRect(x0 + cell * 0.03, y0 + cell * 0.03, cell * 0.94, cell * 0.94);
          pl.fillStyle(0xffb02a, 0.25 + 0.2 * flick);
          pl.fillRect(x0 + cell * 0.12, y0 + cell * 0.12, cell * 0.76, cell * 0.76);
          // a 3×3 lattice of jittered points; each of the four quads becomes a basalt plate, shrunk so lava shows between
          // edge points slide along their edge, the middle point moves freely, so the plates come out irregular
          const pt = (i, k) => [
            x0 + cell * (0.04 + 0.46 * i + (i === 1 ? (h(10 + i * 3 + k) - 0.5) * 0.34 : 0)),
            y0 + cell * (0.04 + 0.46 * k + (k === 1 ? (h(20 + i * 3 + k) - 0.5) * 0.34 : 0)),
          ];
          for (let qi = 0; qi < 2; qi++)
            for (let qk = 0; qk < 2; qk++) {
              const quad = [pt(qi, qk), pt(qi + 1, qk), pt(qi + 1, qk + 1), pt(qi, qk + 1)],
                mx = quad.reduce((a, v) => a + v[0], 0) / 4,
                my = quad.reduce((a, v) => a + v[1], 0) / 4,
                shrink = (f, dx = 0, dy = 0) => quad.map(([px, py]) => [mx + (px - mx) * f + dx, my + (py - my) * f + dy]),
                fan = (pts) => {
                  pl.fillTriangle(pts[0][0], pts[0][1], pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
                  pl.fillTriangle(pts[0][0], pts[0][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1]);
                };
              // cut one corner off each plate (a different one per plate) so they read as broken basalt, not squares
              const cut = Math.floor(h(50 + qi * 2 + qk) * 4),
                five = (pts) => {
                  const a = pts[cut],
                    prev = pts[(cut + 3) % 4],
                    next = pts[(cut + 1) % 4],
                    c1 = [a[0] + (prev[0] - a[0]) * 0.32, a[1] + (prev[1] - a[1]) * 0.32],
                    c2 = [a[0] + (next[0] - a[0]) * 0.32, a[1] + (next[1] - a[1]) * 0.32],
                    out = [];
                  for (let n = 0; n < 4; n++) {
                    if (n === cut) out.push(c1, c2);
                    else out.push(pts[n]);
                  }
                  // c1 sits on the edge to the previous corner, c2 on the edge to the next: keep the ring in order
                  return out;
                },
                poly = (pts) => {
                  for (let n = 1; n < pts.length - 1; n++) pl.fillTriangle(pts[0][0], pts[0][1], pts[n][0], pts[n][1], pts[n + 1][0], pts[n + 1][1]);
                };
              pl.fillStyle(0x1a1214, 1);
              poly(five(shrink(0.86)));
              pl.fillStyle(0x34313a, 1);
              poly(five(shrink(0.76)));
              pl.fillStyle(0x4f4b56, 0.9);
              poly(five(shrink(0.5, -cell * 0.03, -cell * 0.03)));
              pl.fillStyle(0xffffff, 0.16);
              poly(five(shrink(0.22, -cell * 0.06, -cell * 0.06)));
            }
          // bright cracks and a few bubbles in the lava
          const mid = pt(1, 1);
          pl.lineStyle(Math.max(1, cell * 0.022), 0xffe28a, 0.4 + 0.35 * flick);
          for (const [i, k] of [[1, 0], [2, 1], [1, 2], [0, 1]]) {
            const e = pt(i, k);
            pl.lineBetween(mid[0], mid[1], e[0], e[1]);
          }
          for (let k = 0; k < 2; k++) {
            const bx = x0 + cell * (0.2 + 0.6 * h(30 + k)),
              by = y0 + cell * (k ? 0.5 : 0.08 + 0.84 * h(40)),
              br = cell * 0.045 * (0.7 + 0.5 * Math.sin(time * 0.005 + k * 2 + col));
            pl.fillStyle(0xfff2a0, 0.9);
            pl.fillCircle(bx, by, Math.max(1, br));
          }
        }
      }
      // ---- v0.23x: Infested Ground: scarred earth with acid glowing in the cracks and thin green light rising from them;
      // spent (recharging) fields go grey; small pips show the strikes left
      for (const t of player.infested || []) {
        const x0 = z.left + t.x * cell,
          y0 = z.top + t.y * cell,
          h = (n) => hash(t.x, t.y, 70 + n),
          live = game.time + 1e-6 >= t.ready,
          charge = live ? 1 : Math.max(0, 1 - (t.ready - game.time) / 3.33),
          flick = 0.5 + 0.5 * Math.sin(time * 0.006 + t.x * 1.3 + t.y),
          acid = live ? 0x7dff3a : 0x8a9188,
          deep = live ? 0x2f7a12 : 0x4a4f48;
        pl.fillStyle(0x2a2418, 0.9);
        pl.fillRect(x0 + cell * 0.04, y0 + cell * 0.04, cell * 0.92, cell * 0.92);
        pl.fillStyle(deep, live ? 0.55 + 0.2 * flick : 0.5);
        pl.fillEllipse(x0 + cell / 2, y0 + cell / 2, cell * 0.8, cell * 0.62);
        // scars: jagged cracks from the middle
        const cx = x0 + cell * (0.45 + 0.1 * h(1)),
          cy = y0 + cell * (0.45 + 0.1 * h(2)),
          scars = [];
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + h(3 + k) * 0.9,
            len = cell * (0.28 + 0.16 * h(10 + k)),
            mx = cx + Math.cos(a + 0.35) * len * 0.5,
            my = cy + Math.sin(a + 0.35) * len * 0.5;
          scars.push([cx, cy, mx, my, cx + Math.cos(a) * len, cy + Math.sin(a) * len]);
        }
        pl.lineStyle(Math.max(2, cell * 0.075), 0x120e08, 0.95);
        for (const [ax, ay, bx, by, ex, ey] of scars) {
          pl.lineBetween(ax, ay, bx, by);
          pl.lineBetween(bx, by, ex, ey);
        }
        pl.lineStyle(Math.max(1, cell * 0.03), acid, live ? 0.75 + 0.25 * flick : 0.6);
        for (const [ax, ay, bx, by, ex, ey] of scars) {
          pl.lineBetween(ax, ay, bx, by);
          pl.lineBetween(bx, by, ex, ey);
        }
        if (live || charge > 0.6) {
          // light from below: soft glow and a few thin beams rising from the cracks
          const k0 = live ? 1 : (charge - 0.6) / 0.4;
          glow.fillStyle(0x7dff3a, (0.12 + 0.1 * flick) * k0);
          glow.fillCircle(cx, cy, cell * 0.42);
          for (let k = 0; k < 4; k++) {
            const sc = scars[k],
              bx = sc[2],
              by = sc[3],
              hh = cell * (0.35 + 0.35 * (0.5 + 0.5 * Math.sin(time * 0.004 + k * 1.9 + t.x)));
            glow.fillStyle(0xb8ff7a, (0.22 + 0.15 * flick) * k0);
            glow.fillRect(bx - cell * 0.012, by - hh, cell * 0.024, hh);
          }
        }
        // strikes left
        for (let k = 0; k < t.charges; k++) {
          pl.fillStyle(live ? 0xc8ff8a : 0x9aa098, 0.95);
          pl.fillCircle(x0 + cell * (0.14 + k * 0.1), y0 + cell * 0.88, Math.max(1.2, cell * 0.03));
        }
      }
      // ---- v0.23zb: Siege Planks: wooden boards with iron bands laid over a tower; they fade in their last 3 s
      // v0.24h: each plank has its own layer right above its tower (was the health-bar layer, over every creep), so
      // creeps crossing it walk on top of it
      const plankKeys = new Set();
      for (const pl of player.planks || []) {
        const key = `${player.id}:${pl.x},${pl.y}`;
        plankKeys.add(key);
        let hb = this.plankGfx.get(key);
        if (!hb) this.plankGfx.set(key, (hb = this.stage.graphics()));
        hb.clear().setDepth(Math.floor(z.top + (pl.y + 0.6) * cell) + 100.3);
        const x0 = z.left + pl.x * cell,
          y0 = z.top + pl.y * cell,
          left = pl.until - game.time,
          a = clamp(left / 3, 0.35, 1),
          vert = pl.dir !== "h",
          w = vert ? cell * 0.56 : cell * 1.08,
          h = vert ? cell * 1.08 : cell * 0.56,
          cx = x0 + cell / 2,
          cy = y0 + cell * 0.46,
          bx = cx - w / 2,
          by = cy - h / 2;
        hb.fillStyle(0x2a1a0c, 0.9 * a);
        hb.fillRoundedRect(bx - 2, by - 2, w + 4, h + 4, 4);
        hb.fillStyle(0x8a5a2c, a);
        hb.fillRoundedRect(bx, by, w, h, 3);
        hb.lineStyle(1.2, 0x4a2c12, 0.9 * a);
        for (let k = 1; k < 3; k++) {
          if (vert) hb.lineBetween(bx + (w * k) / 3, by + 2, bx + (w * k) / 3, by + h - 2);
          else hb.lineBetween(bx + 2, by + (h * k) / 3, bx + w - 2, by + (h * k) / 3);
        }
        hb.fillStyle(0x6c727a, a);
        for (const f of [0.18, 0.82]) {
          if (vert) hb.fillRect(bx - 1, by + h * f - 2, w + 2, 4);
          else hb.fillRect(bx + w * f - 2, by - 1, 4, h + 2);
        }
      }
      for (const [k, gfx] of this.plankGfx)
        if (!plankKeys.has(k)) {
          gfx.destroy();
          this.plankGfx.delete(k);
        }
      // ---- v0.18h: Low Tides water (bottom rows) and Backup Line mist (top rows)
      const tides = zoneOf(game, player, "tides");
      if (tides) {
        const calm = tides.on;
        for (let y = tides.from; y < tides.to; y++)
          for (let col = 0; col < z.logicalCols; col++) {
            const x0 = z.left + col * cell,
              y0 = z.top + y * cell,
              w = 0.5 + 0.5 * Math.sin(time * (calm ? 0.0016 : 0.0034) + col * 0.9 + y * 1.3);
            pl.fillStyle(calm ? 0x7fd4ff : 0x1c3a5c, calm ? 0.26 : 0.42);
            pl.fillRect(x0, y0, cell, cell);
            pl.lineStyle(calm ? 2 : 2.5, calm ? 0xe4f8ff : 0x9ab4c8, calm ? 0.28 + 0.14 * w : 0.3 + 0.25 * w);
            for (let k = 0; k < 2; k++) {
              const yy = y0 + cell * (0.3 + 0.4 * k) + Math.sin(time * (calm ? 0.002 : 0.004) + col + k * 2) * cell * (calm ? 0.03 : 0.07),
                amp = cell * (calm ? 0.04 : 0.09);
              pl.beginPath();
              for (let i = 0; i <= 8; i++) {
                const xx = x0 + (cell * i) / 8,
                  py = yy + Math.sin((i / 8) * Math.PI * 2 + time * (calm ? 0.003 : 0.007) + col) * amp;
                i ? pl.lineTo(xx, py) : pl.moveTo(xx, py);
              }
              pl.strokePath();
            }
          }
      }
      const mist = zoneOf(game, player, "backup");
      if (mist) {
        const white = mist.on,
          tone = white ? 0xf4f8ff : 0x6e7480;
        for (let y = mist.from; y < mist.to; y++)
          for (let col = 0; col < z.logicalCols; col++)
            for (let k = 0; k < 2; k++) {
              const drift = Math.sin(time * 0.0006 + col * 1.1 + y * 0.7 + k * 2.4),
                cx = z.left + (col + 0.3 + 0.4 * k + drift * 0.12) * cell,
                cy = z.top + (y + 0.35 + 0.3 * hash(col, y, 50 + k)) * cell;
              glow.fillStyle(tone, white ? 0.13 : 0.17);
              glow.fillEllipse(cx, cy, cell * 1.05, cell * 0.62);
              glow.fillStyle(tone, white ? 0.09 : 0.12);
              glow.fillEllipse(cx + cell * 0.18, cy - cell * 0.12, cell * 0.7, cell * 0.42);
            }
      }
      // ---- route flow on the dirt tiles
      const path = player.path || [];
      if (path.length) {
        const pts = path.map((p) => this.point(p.x, p.y));
        this.chevrons(pl, pts, time, cell, 0x4a3018, preview?.ok ? 0.18 : 0.38, true);
      }
      // ---- placement aids
      if (selected?.towerId) {
        const t = player.towers.find((t) => t.id === selected.towerId);
        if (t) {
          const q = this.point(t.x, t.y),
            r = (getStats(game, view, t.typeId).range / game.grid.cellUnits) * z.cw;
          this.drawReach(g, catalog.byId[t.typeId], q, r, z.cw, towerSize(t));
          // v0.21y: splash radius, like the reach: around the creep it is shooting at, else around the tower
          const splash = attackInfo(game, t.typeId, game.players[view]).splash;
          if (splash > 0) {
            const aim = t.aimId && player.creeps.find((c) => c.id === t.aimId && !c.dead && c.hp > 0),
              sq = aim ? this.point(aim.x, aim.y) : q,
              sr = (splash / game.grid.cellUnits) * z.cw;
            g.fillStyle(0xffb35a, 0.14);
            g.fillCircle(sq.x, sq.y, sr);
            g.lineStyle(2, 0xffc47a, 0.75);
            g.strokeCircle(sq.x, sq.y, sr);
          }
          const pulse = 0.5 + 0.5 * Math.sin(time * 0.008);
          const sc = cell * towerSize(t);
          g.lineStyle(3, 0xffe47a, 0.55 + pulse * 0.4);
          g.strokeEllipse(q.x, q.y + sc * 0.12, sc * 0.98, sc * 0.5);
        }
      } // v0.17l: no more glowing frames on free fields while a tower card is picked
      // v0.09q: Arrow Volley aim — the area follows the pointer
      const aim = getAim();
      if (aim && this.pointer) {
        const r = aim.radius * cell,
          px = this.pointer.x,
          py = this.pointer.y,
          pulse = 0.5 + 0.5 * Math.sin(time * 0.01);
        const ac = aim.arcane ? 0xc07aff : aim.fire ? 0xff7a2a : aim.ice ? 0x5ac8ff : aim.plague ? 0x7dff3a : 0xffd27a,
          al = aim.arcane ? 0xeacbff : aim.fire ? 0xffc89a : aim.ice ? 0xd8f6ff : aim.plague ? 0xdcffb8 : 0xffe7a8; // v0.23w: ice blue for Frost Bolt; v0.23x: acid green for Infested Ground
        if (aim.tile) {
          // v0.23x: Infested Ground aims at one field: the field under the pointer lights up
          const col = Math.floor((px - z.left) / cell),
            row = Math.floor((py - z.top) / cell);
          if (col >= 0 && row >= 0 && col < z.logicalCols && row < z.logicalRows) {
            g.fillStyle(ac, 0.18 + 0.1 * pulse);
            g.fillRect(z.left + col * cell, z.top + row * cell, cell, cell);
            g.lineStyle(2.5, al, 0.9);
            g.strokeRect(z.left + col * cell + 1, z.top + row * cell + 1, cell - 2, cell - 2);
          }
        } else { // v0.10p: violet for Arcane Burst, v0.12: orange for Pillar of Fire
        g.fillStyle(ac, 0.12 + 0.06 * pulse);
        g.fillCircle(px, py, r);
        g.lineStyle(2.5, al, 0.85);
        g.strokeCircle(px, py, r);
        g.lineStyle(1.5, al, 0.6);
        g.lineBetween(px - 8, py, px + 8, py);
        g.lineBetween(px, py - 8, px, py + 8);
        }
      }
      this.drawQueued(game, view, getQueued(), catalog, z, time);
      this.drawPreview(game, view, preview, catalog, z, time);
      // ---- towers: figures on their pedestals
      const alive = this.alive || (this.alive = new Set()),
        team = TEAM_COLORS[colorOf(view)].hex,
        viewColor = colorOf(view),
        now = performance.now();
      alive.clear();
      for (const b of this.badgeBatches.values()) {
        b.clear();
        b.used = false;
      }
      for (const t of player.towers) {
        const tc = cell * towerSize(t); // a 2×2 hall draws at twice the size
        const def = catalog.byId[t.typeId || t.unitId || t.defId || t.type || t.id];
        if (!def) continue;
        const key = `${view}:t:${t.id}`,
          q = this.point(t.x, t.y);
        alive.add(key);
        let sprite = this.units.get(key);
        // v0.23: the art loads on first use; meanwhile the figure keeps its old picture (upgrades) or waits
        const look = this.look(sprite, key, artFor(def), viewColor, "tower", now),
          artKey = look.art,
          m = this.artMeta(look.tex, artKey), // v0.23a: the size data of the picture shown (art sets)
          skin = look.tex,
          anim = look.anim;
        if (!sprite) {
          sprite = this.stage.image(q.x, q.y, skin, anim ? 0 : undefined);
          this.units.set(key, sprite);
        }
        if (sprite.visible === look.hide) sprite.setVisible(!look.hide);
        const building = (t.buildRemaining || 0) > 0,
          // Higher levels of the same figure stand a little taller on a slightly larger pedestal.
          base = ((tc * 0.98 * TOWER_SCALE) / m.plateW) * levelScale(def.level || 1) * (t.stone === "large" ? 1.23 : t.stone === "small" ? 0.8 : 1), // v0.18h: Quarry stones; v0.19c1: large ones 6 % larger
          phase = (parseInt(String(t.id).replace(/\D/g, ""), 10) || 0) * 1.7;
        const popT = sprite.getData("pop") ? clamp((time - sprite.getData("pop")) / 280, 0, 1) : 1,
          pop = popT < 1 ? 0.5 + 0.5 * this.backOut(popT) : 1,
          recoil = 0,
          moving = !!activeArtSet() && !t.stone && artKey.startsWith("tower-"), // design variants: every figure moves its own way (motion.js)
          breathe = t.stone || moving ? 0 : Math.sin(time * 0.0032 + phase) * 0.014; // v0.18h: stones stand still
        // v0.09: every figure without its own frame animation acts out each attack (see attackPose)
        const pose = moving ? this.figureMotion(def, artKey, sprite, time, phase, building, q, tc) : !anim && !building ? this.attackPose(def, sprite, time) : null;
        if (pose) sprite.setBend((m.plateCY - (m.plateCY - m.plateTop) * 0.35) / m.h, pose.lean * m.h * 0.12, pose.stretch);
        else sprite.setBend(0);
        const cx = q.x,
          cy = q.y + tc * 0.1;
        if (anim) {
          // Attack swing from the shot event; frame 0 is the still pose.
          const atk = sprite.getData("atk");
          let frame = 0;
          if (atk != null && !building) {
            const k = Math.floor((time - atk) / anim.ms) + (anim.start || 0);
            if (k < anim.frames) frame = k;
          }
          this.showFrame(sprite, skin, frame);
        } else if (sprite.texture.key !== skin) sprite.setTexture(skin);
        sprite
          .setOrigin(anim ? (m.plateCX + anim.ox) / anim.fw : m.plateCX / m.w, anim ? (m.plateCY + anim.oy) / anim.fh : m.plateCY / m.h)
          .setPosition(cx, cy - recoil * tc * 0.03)
          .setScale(base * pop * (1 + recoil * 0.05), base * pop * (1 + breathe + recoil * 0.07))
          .setFlipX(false)
          .setDepth(Math.floor(cy) + 100)
          .setAlpha(building ? 0.55 : 1);
        if (t.curse && t.curse.until > game.time) sprite.setTint(0xd2b0ff).setTintMode(TINT.MULTIPLY);
        else if (t.stone === "large") sprite.setTint(0xb8ae9e).setTintMode(TINT.MULTIPLY); // v0.18h: large stones a shade darker
        else sprite.clearTint();
        // v0.17p: Trueshot Aura buff: a small, transparent crosshair on the figure's torso (static, no flicker)
        if (t.trueshot && !building) {
          const hx = cx,
            hy = cy - tc * 0.42,
            hr = tc * 0.1,
            bars = this.bars;
          bars.lineStyle(1.6, 0xfff2c0, 0.42);
          bars.strokeCircle(hx, hy, hr);
          bars.lineBetween(hx - hr * 1.5, hy, hx - hr * 0.45, hy);
          bars.lineBetween(hx + hr * 0.45, hy, hx + hr * 1.5, hy);
          bars.lineBetween(hx, hy - hr * 1.5, hx, hy - hr * 0.45);
          bars.lineBetween(hx, hy + hr * 0.45, hx, hy + hr * 1.5);
          bars.fillStyle(0xfff2c0, 0.42);
          bars.fillCircle(hx, hy, Math.max(1, hr * 0.14));
        }
        // v0.19b1: Earth Laser after a Focus Fire kill: grey smoke rises from the weapon for 1 s (calm, fades out)
        if (t.smokeUntil > game.time && !building) {
          const left = clamp(t.smokeUntil - game.time, 0, 1),
            sb = this.bars;
          for (let k = 0; k < 4; k++) {
            const age = (1 - left + k * 0.25) % 1,
              sx = cx + Math.sin(phase + k * 2.1 + age * 3) * tc * 0.07,
              sy = cy - tc * (0.62 + age * 0.38);
            sb.fillStyle(0x8c9198, 0.5 * Math.min(1, left * 2) * (1 - age * 0.6));
            sb.fillCircle(sx, sy, tc * (0.05 + age * 0.08));
          }
        }
        // team glow under the pedestal
        glow.fillStyle(team, 0.16);
        glow.fillEllipse(cx, cy + tc * 0.06, tc * 1.0, tc * 0.5);
        // v0.13: Lone Guardians active: a white aura with beams turning outwards
        if (!building && def.attacks && loneActive(player)) { // v0.22g1: limit by perk level
          const pulse = 0.5 + 0.5 * Math.sin(time * 0.005 + phase),
            ay = cy - tc * 0.12;
          glow.fillStyle(0xffffff, 0.1 + 0.07 * pulse);
          glow.fillEllipse(cx, ay, tc * 1.2, tc * 1.0);
          glow.fillStyle(0xffffff, 0.12 + 0.08 * pulse);
          glow.fillEllipse(cx, ay, tc * 0.7, tc * 0.6);
          const beams = 8,
            spin = time * 0.0007 + phase;
          for (let k = 0; k < beams; k++) {
            const a = spin + (Math.PI * 2 * k) / beams,
              run = ((time * 0.0012 + k * 0.37 + phase) % 1),
              r0 = tc * (0.22 + run * 0.18),
              r1 = tc * (0.5 + run * 0.32),
              w = 0.07,
              ca = Math.cos(a),
              sa = Math.sin(a) * 0.82;
            glow.fillStyle(0xffffff, 0.34 * (1 - run));
            glow.fillTriangle(cx + Math.cos(a - w) * r0, ay + Math.sin(a - w) * r0 * 0.82, cx + Math.cos(a + w) * r0, ay + Math.sin(a + w) * r0 * 0.82, cx + ca * r1, ay + sa * r1);
          }
          g.lineStyle(1.6, 0xffffff, 0.45 + 0.3 * pulse);
          g.strokeEllipse(cx, cy + tc * 0.05, tc * 1.0, tc * 0.52);
        }
        // immolation: a flickering fire ring at the aura radius
        const burn = this.immolation(def, catalog);
        if (burn && !building) {
          const flick = 0.6 + 0.4 * Math.sin(time * 0.02 + phase) * Math.sin(time * 0.013);
          glow.fillStyle(0xff7a2a, 0.07 * flick);
          glow.fillCircle(cx, cy - tc * 0.05, (burn / game.grid.cellUnits) * cell);
          glow.lineStyle(2, 0xffa040, 0.35 * flick);
          glow.strokeCircle(cx, cy - tc * 0.05, (burn / game.grid.cellUnits) * cell);
        }
        // tier aura: silver, gold, violet, prismatic for the top figures
        // v0.21o: the tier aura (silver / gold / violet / prismatic from level 4) is switched off
        const tier = towerTier(def);
        if (TIER_AURA && tier >= 4 && !building) {
          const colors = { 4: 0xa8d8ff, 5: 0xffcf5a, 6: 0xc68cff },
            hue = (time * 0.00012 + phase * 0.05) % 1,
            color = tier >= 7 ? hsvToColor(hue, 0.55, 1) : colors[tier],
            pulse = 0.5 + 0.5 * Math.sin(time * 0.004 + phase);
          glow.fillStyle(color, 0.12 + 0.1 * pulse);
          glow.fillEllipse(cx, cy + tc * 0.04, tc * 1.12, tc * 0.6);
          g.lineStyle(2, color, 0.55 + 0.3 * pulse);
          g.strokeEllipse(cx, cy + tc * 0.05, tc * 1.02, tc * 0.54);
          const sparks = tier >= 7 ? 4 : tier - 2;
          for (let k = 0; k < sparks; k++) {
            const a = time * 0.0018 + phase + (Math.PI * 2 * k) / sparks;
            glow.fillStyle(color, 0.9);
            glow.fillCircle(cx + Math.cos(a) * tc * 0.5, cy + tc * 0.05 + Math.sin(a) * tc * 0.27, tier >= 6 ? 2.6 : 2);
          }
        }
        g.fillStyle(0x07130f, 0.35);
        g.fillEllipse(cx, cy + tc * 0.14, tc * 0.92, tc * 0.4);
        // Magic towers: a mana bar under the pedestal; a full bar glows before the empowered bolt.
        if (!building && isMagicTower(def)) {
          const maxMana = getStats(game, view, t.typeId).mana || 1,
            fill = clamp((t.mana || 0) / maxMana, 0, 1),
            bw = tc * 0.62,
            bx = cx - bw / 2,
            by = cy + tc * 0.34;
          const mb = this.bars;
          mb.fillStyle(0x07101a, 0.85);
          mb.fillRoundedRect(bx - 1.5, by - 1.5, bw + 3, 6, 3);
          mb.fillStyle(fill >= 1 ? 0xb88cff : 0x5a8cff, 1);
          if (fill > 0) mb.fillRoundedRect(bx, by, Math.max(3, bw * fill), 3, 1.5);
          if (fill >= 1) {
            glow.fillStyle(0xa070ff, 0.18 + 0.1 * Math.sin(time * 0.012 + phase));
            glow.fillEllipse(cx, cy + tc * 0.04, tc * 1.05, tc * 0.55);
          }
        }
        if (building) {
          const total = t.buildTotal || 1,
            done = 1 - t.buildRemaining / total;
          g.lineStyle(4, 0x10201b, 0.75);
          g.strokeEllipse(cx, cy + tc * 0.04, tc * 0.98, tc * 0.52);
          g.lineStyle(4, 0xffd36a, 1);
          g.beginPath();
          const rx = tc * 0.49,
            ry = tc * 0.26;
          for (let k = 0; k <= 40 * done; k++) {
            const a = -Math.PI / 2 + (Math.PI * 2 * k) / 40;
            const px = cx + Math.cos(a) * rx,
              py = cy + tc * 0.04 + Math.sin(a) * ry;
            k ? g.lineTo(px, py) : g.moveTo(px, py);
          }
          g.strokePath();
        }
        const level = t.level || def.level || 1;
        // v0.12: walls (v0.17: and rocks) carry no level badge
        if (!def.perkUnit && def.id !== "hROK") this.levelBadge(level, cx - tc * 0.36, cy + tc * 0.2, Math.floor(cy) + 100.25, BADGE_COLORS[def.element] || BADGE_COLORS.neutral); // v0.24b: just above its own tower, behind creeps walking in front (their row band sorts at +100.5; was +101, in front of them)
      }
      for (const [depth, b] of this.badgeBatches)
        if (!b.used) {
          b.destroy();
          this.badgeBatches.delete(depth);
        }
      // ---- disease clouds
      for (const cl of game.clouds || []) {
        if (cl.lane !== view) continue;
        const q = this.point(cl.x, cl.y),
          r = (cl.radius / game.grid.cellUnits) * cell,
          fade = Math.min(1, cl.remaining / 0.6),
          [base, spark] = cl.kind === "fire" ? [0xff6a20, 0xffc060] : cl.kind === "ice" ? [0x6ab8ff, 0xe0f4ff] : [0x7fd23a, 0xb8ff6a];
        if (!cl.kind) {
          this.drawPoisonCloud(g, glow, q, r, fade, time, cl.x * 9 + cl.y * 5);
          continue;
        }
        g.fillStyle(base, (cl.kind ? 0.12 : 0.16) * fade);
        g.fillCircle(q.x, q.y, r);
        for (let k = 0; k < (cl.kind === "ice" ? 9 : 5); k++) {
          const a = time * (cl.kind === "ice" ? 0.004 : 0.0015) + k * 1.26 + cl.x * 9;
          glow.fillStyle(spark, 0.22 * fade);
          glow.fillCircle(q.x + Math.cos(a) * r * 0.55, q.y + Math.sin(a) * r * 0.35, r * (cl.kind === "ice" ? 0.08 : 0.22));
        }
      }
      // ---- queued upgrades: a pulsing green arrow over the tower until gold is there
      if (view === own)
        for (const uq of getUpQueued()) {
          const t = player.towers.find((x) => x.id === uq.towerId);
          if (!t) continue;
          const q = this.point(t.x, t.y),
            tc = cell * towerSize(t),
            pulse = 0.5 + 0.5 * Math.sin(time * 0.008),
            hb = this.hpBars,
            ax = q.x + tc * 0.3,
            ay = q.y - tc * 0.42 - pulse * tc * 0.06,
            s = tc * 0.13;
          hb.lineStyle(2, 0x6ee87a, 0.35 + 0.4 * pulse);
          hb.strokeEllipse(q.x, q.y + tc * 0.12, tc * 0.86, tc * 0.36);
          hb.fillStyle(0x08300e, 0.95);
          hb.fillTriangle(ax - s * 1.25, ay + 0.15 * s, ax + s * 1.25, ay + 0.15 * s, ax, ay - s * 1.35);
          hb.fillRect(ax - s * 0.62, ay, s * 1.24, s * 1.35);
          hb.fillStyle(0x6ee87a, 1);
          hb.fillTriangle(ax - s, ay, ax + s, ay, ax, ay - s);
          hb.fillRect(ax - s * 0.4, ay - 1, s * 0.8, s * 1.1);
        }
      this.drawPerkFx(game, view, z, time, g, glow); // v0.12: Pillar of Fire, Monsun
      // ---- creeps (v0.12: and Arcane Golems walking up the lane)
      const walkers = player.golems?.length ? [...player.creeps, ...player.golems] : player.creeps,
        apart = this.spreadCreeps(walkers, view, cell, time, z); // v0.23g: packed groups ease apart (display only)
      // v0.24h: a creep on a Siege Plank walks over its tower: drawn above the tower and the plank
      const plankRows = player.planks?.length ? player.planks : null,
        creepDepth = (c, d) => {
          if (!plankRows) return d;
          const gx = Math.floor(c.x * z.logicalCols),
            gy = Math.floor(c.y * z.totalRows),
            pl = plankRows.find((k) => k.x === gx && k.y === gy);
          return pl ? Math.max(d, Math.floor(z.top + (pl.y + 0.6) * cell) + 100.6) : d;
        };
      for (const c of walkers) {
        if (c.hp <= 0) continue;
        const def = catalog.byId[c.typeId || c.unitId || c.defId || c.type];
        if (!def) continue;
        const key = this.creepKey(view, c.id), // v0.23i: the key string is made once per creep
          phase0 = parseInt(String(c.id).replace(/\D/g, ""), 10) || 0,
          raw = this.roundedPoint(c, cell, z), // v0.23f: corners of the path are walked as a curve (display only)
          // Render-only spread so a group reads as several units, not one blob.
          push = apart.get(c.id),
          q = { x: raw.x + ((((phase0 * 37) % 7) - 3) / 3) * cell * 0.14 + (push?.x || 0), y: raw.y + ((((phase0 * 53) % 5) - 2) / 2) * cell * 0.1 + (push?.y || 0) },
          // v0.14: creeps wear their sender's colour (team blue in the art moved to that colour)
          teamId = c.owner >= 0 ? colorOf(c.owner) : "neutral"; // v0.15: neutral creeps wear brown; v0.17c: the Arcane Golem too wears its owner's colour
        alive.add(key);
        let sprite = this.units.get(key);
        // v0.23: a creep whose art is still loading stays out of sight for a moment (it comes out of the portal)
        const base = c.art || artFor(def),
          look = this.look(sprite, key, (c.planted && ANIM_MANIFEST[base]?.bare) || base, teamId, "creep", now), // v0.16: c.art (wave 1 boxer goblin); v0.23zb: the Siege Ogre without its plank
          artKey = look.art,
          m = this.artMeta(look.tex, artKey), // v0.23a: the size data of the picture shown (art sets)
          skin = look.tex,
          walk = look.anim;
        if (look.hide) {
          if (sprite?.visible) sprite.setVisible(false);
          continue;
        }
        if (sprite && !sprite.visible) sprite.setVisible(true);
        if (!sprite) {
          sprite = this.stage.image(q.x, q.y, skin, walk ? 0 : undefined);
          sprite.setData("hp", c.hp).setData("px", q.x);
          this.units.set(key, sprite);
        }
        const boss = !!(def.bossTier || c.waveBoss),
          flying = !!(c.flying ?? def.flying),
          neutral = c.owner < 0,
          height = cell * (boss ? 1.3 * (c.waveBoss ? 1 : tierGrowth(def.tier || (def.bossTier || 2) - 1)) : (flying ? 0.82 : 0.78) * creepSize(catalog, def.id)) * (c.golem ? 1 + 0.07 * ((c.level || 1) - 1) : 1), // v0.17c: the Arcane Golem grows 7 % per perk level
          s = (height / (walk?.figH ? (walk.figS || walk.figH) * 1.04 : m.h)) * (walk?.scale || 1) * (1 - 0.12 * (c.shrink || 0)) * (c.scale || 1), // v0.26: c.scale (Lesser Skeleton); v0.23j: walk.scale for figures that read too large // v0.23a: 8-way walks are scaled by their own figure size (wide figures a bit smaller)
          step = time * 0.016 + phase0;
        // design variants: each monster walks its own way (motion.js); its clock runs with its pace and stops when stunned
        let gait = null;
        if (activeArtSet() && artKey.startsWith("creep-")) {
          const st = c.statuses || [],
            stuck = st.some((x) => x.stun || x.abilityId === "entangle") || c.enrageUntil > game.time, // the growling Meat Golem stands still too
            rate = stuck ? 0 : clamp((c.speed || 270) / 270, 0.45, 2.2) * (st.some((x) => x.slow > 0 && !x.poison) ? 0.6 : 1),
            last = sprite.getData("gt") ?? time,
            clock = (sprite.getData("gc") ?? phase0 * 1.7) + (Math.min(100, time - last) * rate * 0.016);
          sprite.setData("gt", time).setData("gc", clock);
          gait = creepGait(artKey, clock, stuck ? 0 : time / 1000, phase0);
        }
        const lift = (flying ? cell * 0.32 + (gait ? 0 : Math.sin(time * 0.006 + phase0) * cell * 0.05) : walk || gait ? 0 : Math.abs(Math.sin(step)) * cell * 0.05) + (gait ? gait.y * cell : 0);
        const dx = q.x - (sprite.getData("px") ?? q.x);
        if (Math.abs(dx) > 0.35) sprite.setData("face", dx < 0 ? -1 : 1);
        sprite.setData("px", q.x);
        sprite.setData("lift", lift).setData("art", artKey).setData("team", teamId); // v0.23a: for the death animation
        if (walk?.dirs) {
          // v0.23a (creep graphic overhaul): 8-way walk. The heading follows a smoothed screen velocity and only
          // turns once it is clearly in the next sector, so corners do not flicker between two views.
          const px = sprite.getData("wx") ?? raw.x,
            py = sprite.getData("wy") ?? raw.y,
            ddx = raw.x - px,
            ddy = raw.y - py,
            moved = Math.hypot(ddx, ddy);
          sprite.setData("wx", raw.x).setData("wy", raw.y);
          if (moved < cell * 2) {
            // steps follow the ground: one full cycle (two steps) per ~0.6 figure heights walked
            sprite.setData("wd", (sprite.getData("wd") ?? phase0 * 0.37) + moved);
            // time-based smoothing (~0.25 s), so a corner in the path is taken as a curve
            const kk = 1 - Math.exp(-Math.min(100, time - (sprite.getData("vt") ?? time)) / 250),
              vx = (sprite.getData("vx") ?? ddx) * (1 - kk) + ddx * kk,
              vy = (sprite.getData("vy") ?? ddy) * (1 - kk) + ddy * kk;
            sprite.setData("vt", time).setData("vx", vx).setData("vy", vy);
            if (Math.hypot(vx, vy) > cell * 0.002) {
              const ang = Math.atan2(vy, vx),
                cur = sprite.getData("dir"),
                k = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8,
                next = (10 - k) % 8;
              let turn = cur === undefined;
              if (!turn && next !== cur) {
                const curAng = (((10 - cur) % 8) * Math.PI) / 4,
                  off = Math.abs(Math.atan2(Math.sin(ang - curAng), Math.cos(ang - curAng)));
                turn = off > Math.PI / 8 + 0.14; // ~8° past the sector edge
              }
              if (turn && next !== cur) sprite.setData("dir", next);
            }
          }
        }
        if (c.hp < (sprite.getData("hp") ?? c.hp) - 0.01 && time - (sprite.getData("flashAt") || 0) > 170)
          sprite.setData("flashAt", time).setData("hit", time + 55);
        sprite.setData("hp", c.hp);
        const statuses = c.statuses || [],
          slowed = statuses.some((st) => st.slow > 0 && !st.poison),
          poisoned = statuses.some((st) => st.poison || st.dps > 0);
        let bob = 0; // v0.25a: a small hop per stride for sheets whose figures barely move their legs (front views)
        if (walk) {
          // Walk cycle runs with the creep's pace; stunned or rooted creeps freeze mid-step.
          const stuck = statuses.some((st) => st.stun || st.abilityId === "entangle") || c.enrageUntil > game.time, // v0.21z: growling Meat Golem
            rate = stuck ? 0 : clamp((c.speed || 270) / 270, 0.45, 2.2) * (slowed ? 0.6 : 1),
            last = sprite.getData("wt") ?? time,
            clock = (sprite.getData("wc") ?? phase0 * 97) + Math.min(100, time - last) * rate;
          sprite.setData("wt", time).setData("wc", clock);
          if (walk.dirs) {
            // v0.23a: the cycle is driven by the distance walked (feet match the ground speed; a stopped or
            // stunned creep freezes mid-step). Turns play out through each view in between, one every 130 ms.
            const stride = Math.max(4, height * 0.6 * (walk.stride || 1)), // v0.23f: 0.85 → 0.6 figure heights per cycle (no moonwalking); v0.23r: walk.stride slows single sheets
              pos = (((((sprite.getData("wd") ?? 0) / stride) * walk.frames) % walk.frames) + walk.frames) % walk.frames,
              dir = sprite.getData("dir") ?? 0;
            if (walk.bob && !stuck) bob = Math.abs(Math.sin(Math.PI * (pos / walk.frames) * (walk.bobSteps || 1))) * walk.bob * height;
            let shown = sprite.getData("show") ?? dir;
            if (shown !== dir && time - (sprite.getData("showAt") ?? -1e9) >= 130) {
              const diff = ((dir - shown + 12) % 8) - 4; // shortest way round, -4..3
              shown = (shown + (diff >= 0 ? 1 : -1) + 8) % 8;
              sprite.setData("showAt", time);
            }
            sprite.setData("show", shown);
            if (c.planting && !c.planting.approach && walk.plantRow !== undefined) {
              // v0.23zb: the Siege Ogre lays its plank down
              const k = clamp((game.time - c.planting.start) / Math.max(0.1, c.planting.until - c.planting.start), 0, 0.999);
              this.showFrame(sprite, skin, walk.plantRow * walk.cols + Math.floor(k * walk.plantFrames));
            } else this.showFrame(sprite, skin, shown * walk.frames + Math.floor(pos));
          } else this.showFrame(sprite, skin, Math.floor(clock / walk.ms) % walk.frames);
        } else if (sprite.texture.key !== skin) sprite.setTexture(skin);
        // v0.23s: no white flash on the figure when hit; the health bar flashes instead (below)
        {
          sprite.setTintMode(TINT.MULTIPLY);
          if (!!c.clone !== sprite.getData("clone")) sprite.setData("clone", !!c.clone).setAlpha(c.clone ? 0.85 : 1); // v0.23w: clones 15 % see-through
          if (divineShield(game, c)) sprite.setTint(0xfff2b0);
          else if (statuses.some((st) => st.abilityId === "entangle")) sprite.setTint(0xa8ff9a);
          else if (statuses.some((st) => st.stun)) sprite.setTint(0xfff3a0);
          else if (slowed) sprite.setTint(statuses.some((st) => st.abilityId === "frost") ? 0xd2efff : 0x9fd8ff); // v0.16: frost gets the sheen instead
          else if (poisoned) sprite.setTint(0xc4f59a);
          else if (c.immune) sprite.setTint(0xe2d2ff);
          else if (c.enraged) sprite.setTint(0xff8f80); // v0.21z: Enraged Meat Golem
          else if (c.burning) sprite.setTint(0xffa060); // v0.10w: Burning Treant
          else if (c.spiritWolf) sprite.setTint(0xe8d0ff); // v0.19a1: Spirit Wolves
          else if (c.clone) {
            // v0.23w: Clones: a soft arcane shimmer that comes and goes
            const k = 0.5 + 0.5 * Math.sin(time * 0.004 + phase0),
              r = Math.round(0xe4 - 0x14 * k),
              gr = Math.round(0xc8 - 0x30 * k);
            sprite.setTint((r << 16) | (gr << 8) | 0xff);
          } else sprite.clearTint();
        }
        const flap = flying && !gait ? 1 + Math.sin(time * 0.03 + phase0) * 0.05 : 1,
          // v0.21z: Enraged Meat Golem: 10 % larger; while it growls it swells once, smoothly
          growl = c.enrageUntil > game.time ? Math.sin(Math.PI * clamp(1 - (c.enrageUntil - game.time) / 1.2, 0, 1)) : 0,
          rage = c.enraged ? 1.1 + 0.1 * growl : 1;
        const face = sprite.getData("face") === -1 && !walk?.dirs ? -1 : 1; // v0.23a: 8-way walks have their own views, no mirroring
        const ground = !flying && !gait && artKey.startsWith("creep-n-"); // v0.23b: bestiary figures of the original design
        if (gait) sprite.setBend(m.footY / m.h, gait.lean * face * m.h * 0.12, 1);
        else sprite.setBend(0);
        sprite
          .setOrigin(walk ? (walk.footX ?? m.w / 2 + walk.ox) / walk.fw : 0.5, walk ? (walk.footY ?? m.footY + walk.oy) / walk.fh : m.footY / m.h)
          .setPosition(q.x, q.y + (ground ? cell * 0.2 + height * 0.04 : cell * 0.18) - lift - bob) // v0.23b: ground creeps stand in their shadow, feet slightly sunk
          .setScale(s * rage * face * (c.buff === "fat" ? 1.42 : 1) * (c.spiritWolf ? 1.08 : 1) * (gait ? gait.sx : 1), s * rage * flap * (c.buff === "fat" ? 1.06 : 1) * (c.spiritWolf ? 1.08 : 1) * (gait ? gait.sy : 1)) // v0.15: fat quest creeps; v0.19a1: Spirit Wolves a little larger
          .setRotation(gait ? gait.rot * face : flying || walk ? 0 : Math.sin(step) * 0.07)
          // v0.23e: the board is seen from the bottom: ground creeps sort with the towers by where their feet are
          // (lower on the board = in front); flyers stay above everything on the ground
          .setDepth(flying ? 4200 + Math.floor(q.y) : creepDepth(c, 100.5 + Math.floor(q.y + cell * 0.2)));
        sprite.setData("hx", sprite.x).setData("hy", sprite.y - height * 0.45); // v0.25b: where shots hit this figure (its middle)
        if (gait) g.fillStyle(0x2d5a1c, flying ? 0.14 : 0.2); // design variants: a softer, green-tinted shadow on the light meadow
        else g.fillStyle(0x06120e, flying ? 0.22 : 0.32);
        g.fillEllipse(q.x, q.y + cell * 0.2, cell * (boss ? 0.8 : 0.48), cell * (boss ? 0.28 : 0.17));
        if (c.buff === "fast") {
          // v0.15: fast quest creeps: a winged helmet and fine golden boots
          const hb = this.hpBars,
            face = sprite.getData("face") === -1 ? -1 : 1,
            top = q.y + cell * 0.18 - lift - height * 0.9,
            flapW = 1 + Math.sin(time * 0.025 + phase0) * 0.18,
            ww = height * 0.2 * flapW,
            wh = height * 0.12;
          hb.fillStyle(0x9aa6b2, 1);
          hb.fillEllipse(q.x, top + wh * 0.35, height * 0.3, height * 0.13); // helmet cap
          hb.fillStyle(0xe8edf2, 1);
          hb.fillEllipse(q.x - face * height * 0.03, top + wh * 0.2, height * 0.16, height * 0.06);
          for (const side of [-1, 1]) {
            const bx = q.x + side * height * 0.14;
            hb.fillStyle(0x3a3c45, 1);
            hb.fillTriangle(bx, top + wh * 0.5, bx + side * ww * 1.15, top - wh * 1.15, bx + side * ww * 0.5, top + wh * 0.65);
            hb.fillStyle(0xffffff, 1);
            hb.fillTriangle(bx, top + wh * 0.35, bx + side * ww, top - wh, bx + side * ww * 0.45, top + wh * 0.5);
            hb.fillStyle(0xd8e2ea, 1);
            hb.fillTriangle(bx, top + wh * 0.35, bx + side * ww * 0.7, top - wh * 0.4, bx + side * ww * 0.3, top + wh * 0.45);
          }
          const foot = q.y + cell * 0.16 - lift;
          for (const side of [-1, 1]) {
            const fx2 = q.x + side * height * 0.1 + Math.sin(step + (side > 0 ? Math.PI : 0)) * height * 0.03;
            hb.fillStyle(0x6b3a06, 1);
            hb.fillEllipse(fx2 + face * height * 0.02, foot, height * 0.2, height * 0.1);
            hb.fillStyle(0xffc928, 1);
            hb.fillEllipse(fx2 + face * height * 0.02, foot - height * 0.012, height * 0.16, height * 0.07);
            hb.fillStyle(0xfff3a0, 1);
            hb.fillCircle(fx2 + face * height * 0.04, foot - height * 0.02, Math.max(1, height * 0.015));
          }
        }
        const growth = c.owner >= 0 ? game.players[c.owner]?.growth?.[c.typeId] || 0 : 0;
        if (growth > 0) {
          // v0.20f: Supergrowth: a soft green glow at the feet and a few leaves drifting slowly upwards
          const foot = q.y + cell * 0.2 - lift,
            strength = clamp(growth, 0, 1);
          glow.fillStyle(0x6fe03a, 0.12 + 0.14 * strength);
          glow.fillEllipse(q.x, foot, height * 0.75, height * 0.22);
          for (let k = 0; k < 3; k++) {
            const life = ((time * 0.00042 + phase0 * 0.31 + k / 3) % 1),
              a = phase0 + k * 2.1 + life * 2.4,
              lx = q.x + Math.cos(a) * height * 0.32,
              ly = foot - life * height * 0.7,
              alpha = Math.sin(life * Math.PI) * 0.8,
              r = Math.max(2, height * 0.075);
            glow.fillStyle(0x5ed62a, alpha);
            glow.fillEllipse(lx, ly, r * 2.2, r * 1.2);
            glow.fillStyle(0xeaffa8, alpha * 0.95);
            glow.fillEllipse(lx - r * 0.3, ly - r * 0.15, r * 1.1, r * 0.55);
          }
        }
        if (c.guard) {
          // v0.14: River Guardian: a water shield bubble with droplets circling the creep
          const share = clamp(c.guard.hp / Math.max(1, c.guard.max), 0, 1),
            cy = q.y + cell * 0.18 - lift - height * 0.45,
            rr = height * 0.62,
            wob = Math.sin(time * 0.006 + phase0) * 0.04;
          glow.fillStyle(0x5cc8ff, 0.1 + 0.12 * share);
          glow.fillCircle(q.x, cy, rr * (1 + wob));
          g.lineStyle(2, 0x9fe4ff, 0.35 + 0.45 * share);
          g.strokeEllipse(q.x, cy, rr * 2 * (1 + wob), rr * 2 * (1 - wob));
          for (let k = 0; k < 3; k++) {
            const a = time * 0.004 + phase0 + (k * Math.PI * 2) / 3;
            glow.fillStyle(0xd8f6ff, 0.75);
            glow.fillCircle(q.x + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.45, Math.max(2, height * 0.05));
          }
        }
        if (statuses.some((st) => st.abilityId === "frost" && st.ice)) {
          // v0.22h1: Water Block: the creep's feet are frozen into a ring of icicles
          const fy = q.y + cell * 0.18 - lift,
            w = height * 0.62;
          g.fillStyle(0x9fdcff, 0.55);
          g.fillEllipse(q.x, fy, w * 1.25, w * 0.42);
          for (let k = 0; k < 6; k++) {
            const ix = q.x + (k / 5 - 0.5) * w * 1.05,
              ih = height * (0.2 + 0.12 * ((k * 37 + Math.round(phase0 * 10)) % 3) / 2),
              iw = height * 0.075;
            g.fillStyle(k % 2 ? 0xbfe9ff : 0xe6f8ff, 0.92);
            g.fillTriangle(ix - iw, fy + w * 0.08, ix + iw, fy + w * 0.08, ix, fy - ih);
            g.lineStyle(1, 0x4f9fd6, 0.8);
            g.lineBetween(ix - iw, fy + w * 0.08, ix, fy - ih);
            g.lineBetween(ix, fy - ih, ix + iw, fy + w * 0.08);
          }
        }
        if (statuses.some((st) => st.abilityId === "frost")) {
          // v0.16: frost: a light blue, see-through sheen over the creep and a few ice glints
          const cy = q.y + cell * 0.18 - lift - height * 0.45;
          glow.fillStyle(0x9fdcff, 0.3);
          glow.fillEllipse(q.x, cy, height * 0.82, height * 0.95);
          glow.fillStyle(0xe6f8ff, 0.55);
          for (let k = 0; k < 3; k++) {
            const a = phase0 * 1.7 + k * 2.1 + time * 0.002;
            glow.fillCircle(q.x + Math.cos(a) * height * 0.3, cy + Math.sin(a) * height * 0.35, Math.max(1.5, height * 0.035));
          }
        }
        if (divineShield(game, c)) {
          glow.fillStyle(0xffe680, 0.18 + 0.08 * Math.sin(time * 0.01));
          glow.fillCircle(q.x, q.y - height * 0.45, height * 0.6);
        }
        if (c.enraged) {
          // v0.21z: Enraged Meat Golem: a calm red glow, brighter while it growls
          glow.fillStyle(0xff3a24, 0.13 + 0.04 * Math.sin(time * 0.004 + phase0) + 0.2 * growl);
          glow.fillCircle(q.x, q.y + cell * 0.18 - height * 0.5, height * (0.6 + 0.12 * growl));
        }
        if (c.burning) {
          // v0.10w: Burning Treant: flickering flames on its crown
          for (let k = 0; k < 4; k++) {
            const fl = 0.5 + 0.5 * Math.sin(time * 0.02 + k * 1.9 + phase0),
              fx = q.x + (k - 1.5) * height * 0.14,
              fy = q.y + cell * 0.18 - lift - height * (0.72 + 0.12 * fl);
            glow.fillStyle(0xff5a12, 0.35 + 0.25 * fl);
            glow.fillCircle(fx, fy, height * (0.09 + 0.05 * fl));
            glow.fillStyle(0xffd24a, 0.55 + 0.3 * fl);
            glow.fillCircle(fx, fy + height * 0.03, height * (0.04 + 0.03 * fl));
          }
        }
        if (c.golem) {
          // v0.12: Arcane Golem: violet glow and runes circling at its feet
          glow.fillStyle(0xb06aff, 0.16 + 0.06 * Math.sin(time * 0.008));
          glow.fillCircle(q.x, q.y + cell * 0.18 - height * 0.45, height * 0.62);
          g.lineStyle(2, 0xd8a8ff, 0.8);
          g.strokeEllipse(q.x, q.y + cell * 0.2, cell * 0.8, cell * 0.28);
        }
        // v0.24i: Spirit Wolves no longer wear the arcane veil sphere (their violet tint stays)
        // v0.17: no ring under neutral creeps any more; their grey clothes set them apart
        // Health bar only once a creep has lost health; drawn on top of everything on the board.
        // v0.25i: also when a River Guardian shield took the hit (the hit points stay full) and after small hits on
        // big creeps (below 0.1 % the bar stayed hidden)
        const maxHp = c.maxHp || def.hp,
          ratio = clamp(c.hp / maxHp, 0, 1),
          guarded = c.guard && c.guard.max > 0 ? clamp(c.guard.hp / c.guard.max, 0, 1) : null,
          eps = Math.max(1e-3, maxHp * 1e-6); // any real hit, not float noise
        if (c.hp < maxHp - eps || (guarded != null && c.guard.hp < c.guard.max - 1e-3)) {
          const hb = this.hpBars,
            bar = boss ? cell * 0.95 : cell * 0.55 * hpBarScale(def), // v0.19h1: weak creeps get shorter bars
            barH = boss ? 6 : 4,
            // v0.23l: just above the head of the figure as drawn (its own size and scale), not above the nominal
            // creep height (wide or scaled figures had their bar far above them)
            figTop = gait ? q.y + cell * 0.18 - lift - height : sprite.y - Math.abs(sprite.sy) * (walk?.figH ? walk.figH : (m.footY ?? m.h) * 0.92),
            barY = Math.min(figTop, q.y + cell * 0.18 - lift - height * 0.45) - barH - 4;
          // v0.17q: heavy creeps carry an iron frame, bosses a gold frame
          // v0.22n2: a sent boss's frame is metal in its owner's colour (neutral wave bosses stay gold)
          const frame = boss ? "gold" : c.heavy || isHeavy(def) ? "iron" : null,
            see = 0.9; // v0.22n2: every health bar 10 % transparent
          if (frame) {
            // v0.19j: heavy creeps outside the 4 strongest of their tier get a slimmer, plainer iron frame
            const light = frame === "iron" && !topFour(def),
              team = frame === "gold" && c.owner >= 0 ? TEAM_COLORS[colorOf(c.owner)]?.hex : null,
              [outer, inner, rivet] =
                team != null ? [metalTint(team, 0, 0.55), team, metalTint(team, 0xffffff, 0.6)] : frame === "gold" ? [0x6a4206, 0xffcc3a, 0xfff2a8] : light ? [0x2c3238, 0x737d87, 0xb8c0c8] : [0x23282e, 0x9aa4ae, 0xe2e8ee],
              fw = frame === "gold" ? 4 : light ? 2 : 3.5,
              alpha = (light ? 0.8 : 1) * see;
            hb.fillStyle(outer, alpha);
            hb.fillRoundedRect(q.x - bar / 2 - fw - 1.5, barY - fw - 1.5, bar + fw * 2 + 3, barH + fw * 2 + 3, 4);
            hb.fillStyle(inner, alpha);
            hb.fillRoundedRect(q.x - bar / 2 - fw, barY - fw, bar + fw * 2, barH + fw * 2, 3);
            if (team != null) {
              // metallic sheen: a bright band on the upper half, a darker one below
              hb.fillStyle(metalTint(team, 0xffffff, 0.45), 0.75 * see);
              hb.fillRoundedRect(q.x - bar / 2 - fw + 1, barY - fw + 0.5, bar + fw * 2 - 2, Math.max(1, (barH + fw * 2) * 0.32), 2);
              hb.fillStyle(metalTint(team, 0, 0.3), 0.6 * see);
              hb.fillRoundedRect(q.x - bar / 2 - fw + 1, barY + barH + fw * 0.35, bar + fw * 2 - 2, Math.max(1, fw * 0.5), 1.5);
            }
            if (!light) {
              hb.fillStyle(rivet, see);
              for (const sx of [-1, 1]) hb.fillCircle(q.x + sx * (bar / 2 + 1.5 + (fw - 1.5) / 2), barY + barH / 2, Math.max(0.8, (fw - 1.5) * 0.38));
            }
          }
          hb.fillStyle(0x0b1512, 0.9 * see);
          hb.fillRoundedRect(q.x - bar / 2 - 1.5, barY - 1.5, bar + 3, barH + 3, 3);
          hb.fillStyle(ratio > 0.5 ? 0x8ff05a : ratio > 0.25 ? 0xffc75a : 0xff5f52, see);
          hb.fillRoundedRect(q.x - bar / 2, barY, Math.max(1, bar * ratio), barH, 2);
          if (guarded != null) {
            // v0.25i: the River Guardian shield as a water-blue line over the top of the bar (what is left of it)
            hb.fillStyle(0x9fe4ff, see);
            hb.fillRoundedRect(q.x - bar / 2, barY - 1, Math.max(1, bar * guarded), Math.max(2, barH * 0.5), 1.5);
          }
          // v0.23s: hit flash: a white overlay (25 % transparent) on the bar itself, not on its frame
          if ((sprite.getData("hit") || 0) > time) {
            hb.fillStyle(0xffffff, 0.75);
            hb.fillRoundedRect(q.x - bar / 2, barY, Math.max(1, bar * ratio), barH, 2);
          }
        }
      }
      this.batchCreeps(view, z, z.totalRows, cell, alive); // v0.23i: creeps drawn in a few batches instead of one call each
      this.gone ||= [];
      for (const [key, s] of this.units)
        if (!alive.has(key)) {
          // v0.23a (creep graphic overhaul): creeps with a death sheet wait for this frame's kill events
          if (s.getData("art") && DEATH_KEY[s.getData("art")] && !activeArtSet()) this.gone.push([key, s]);
          else s.destroy();
          this.units.delete(key);
        }
      for (const key of this.waiting.keys()) if (!alive.has(key)) this.waiting.delete(key); // v0.23
      this.consumeEvents(game, view, own, catalog, z, time);
      this.settleDeaths(view, time);
      this.drawFx(game, player, dt, cell, view);
      this.drawPip(game, view, own, z, catalog, time);
      this.drawVignette(z, dt);
    }
    /**
     * v0.23i: the creeps of the board are drawn as sprite batches: one per texture and per board row, so a 200-creep
     * wave costs a few dozen draw calls instead of 200. Each row band starts at the towers of that row: creeps
     * whose feet are below those towers draw in front of them and behind the towers of the next row (the same
     * order as before); inside a batch the creeps are sorted by their feet. Flyers share one band above everything
     * on the ground. Design variants (bending figures) keep drawing one by one.
     */
    /**
     * v0.23l: depth of a fallen ground creep: behind every living creep of its board row (the living ones of a row
     * are drawn together, see batchCreeps), in front of the towers of that row, behind everything further down.
     */
    fallenDepth(feet) {
      if (!this._bandH || activeArtSet()) return 100.25 + Math.floor(feet);
      return 100.4 + Math.floor(this._bandTop + Math.floor((feet - this._bandTop) / this._bandH) * this._bandH);
    }
    batchCreeps(view, z, rows, cell, alive) {
      // pool: texture key -> (band depth -> { batch, items, used }); everything is reused from frame to frame
      const pool = (this.creepBatches ||= new Map()),
        uv = (this._batchUv ||= [0, 0, 0, 0]),
        stage = this.stage,
        set = activeArtSet(),
        top = z.top + 0.5 * z.ch + cell * 0.1, // feet line of the first tower row
        rowH = z.ch,
        // v0.25a: four bands per board row (was one), and inside a band the texture batches are ordered by the lowest
        // feet they hold: a small creep just behind a boss or another large creep no longer pops in front of it
        sub = Math.max(2, rowH / 4);
      this._bandTop = top; // v0.23l: for fallenDepth (whole rows, behind every living creep of the row)
      this._bandH = rowH;
      for (const bands of pool.values()) for (const g of bands.values()) g.items.length = 0;
      for (const key of alive) {
        if (key.indexOf(":c:") < 0) continue;
        const s = this.units.get(key);
        if (!s) continue;
        const ok = !set && !s.bend && s.visible && s.alpha > 0 && s.blend === BLEND.NORMAL && stage.hasTexture(s.texture.key);
        s.setBatched(ok);
        if (!ok) continue;
        const air = s.depth >= 4000,
          depth = air ? 4200.5 : 100.5 + Math.floor(top + Math.floor((s.depth - 100.5 - top) / sub) * sub);
        let bands = pool.get(s.texture.key);
        if (!bands) pool.set(s.texture.key, (bands = new Map()));
        let g = bands.get(depth);
        if (!g) bands.set(depth, (g = { batch: null, items: [] }));
        g.items.push(s);
      }
      for (const [tex, bands] of pool) {
        for (const [depth, g] of bands) {
          if (!g.items.length) {
            g.batch?.destroy();
            bands.delete(depth);
            continue;
          }
          const b = (g.batch ||= stage.sprites(tex).setDepth(depth)),
            t = stage.textures.get(tex);
          b.clear();
          if (g.items.length > 1) g.items.sort(byDepth);
          // v0.25a: the batch whose lowest feet are further down draws later inside its band (stays below the next band)
          const order = depth >= 4200 ? depth : depth + 0.45 * clamp((g.items[g.items.length - 1].depth - depth) / sub, 0, 0.99);
          if (b.depth !== order) b.setDepth(order);
          for (const s of g.items) {
            stage._uv(tex, s.frame.name, uv);
            const tint = (Math.round(s.tint[0] * 255) << 16) | (Math.round(s.tint[1] * 255) << 8) | Math.round(s.tint[2] * 255);
            b.quad(s.x, s.y, t.fw * s.sx, t.fh * s.sy, s.ox, s.oy, s.rot, s.flipX, tint, s.alpha, uv, s.fill);
          }
        }
        if (!bands.size) pool.delete(tex);
      }
    }
    /** Phase of the running attack (0..1) or null (same timing as attackPose). */
    attackPhase(def, sprite, time) {
      const atk = sprite.getData("atk");
      if (atk == null && this.poseK == null) return null;
      const dur = clamp((def.cooldown || 1) * 850, 240, 520),
        k = this.poseK ?? (time - atk) / dur; // poseK: fixed phase for local screenshots only
      return k < 0 || k >= 1 ? null : k;
    }
    /**
     * Design variants: idle and attack of a figure from its own profile in motion.js. Stomps and slams
     * puff a little dust ring on landing.
     */
    figureMotion(def, artKey, sprite, time, phase, building, q, tc) {
      const idle = building ? { lean: 0, stretch: 1 } : towerIdle(artKey, time / 1000, phase),
        k = building ? null : this.attackPhase(def, sprite, time),
        hit = k == null ? null : towerAttack(artKey, k),
        aim = sprite.getData("aimX") || 1;
      if (hit && k > 0.38 && k < 0.85) {
        const style = towerAttackStyle(artKey);
        if (style === "stomp" || style === "slam") {
          const x = (k - 0.38) / 0.47,
            g = this.overlay;
          g.lineStyle(Math.max(1.5, tc * 0.035), 0xffffff, 0.45 * (1 - x));
          g.strokeEllipse(q.x, q.y + tc * 0.14, tc * (0.7 + 0.7 * x), tc * (0.3 + 0.3 * x));
        }
      }
      return { lean: (hit ? hit.lean * aim : 0) + idle.lean, stretch: (hit ? hit.stretch : 1) * idle.stretch };
    }
    /**
     * Attack pose of a tower figure from its last shot: the body above the pedestal leans and
     * stretches. Melee towers wind up and lunge, archers draw and release, cannons kick back and
     * spring, casters rise and thrust. `lean` is in units of an eighth of the figure's height,
     * positive towards the target.
     */
    attackPose(def, sprite, time) {
      const atk = sprite.getData("atk");
      if (atk == null && this.poseK == null) return null;
      const dur = clamp((def.cooldown || 1) * 850, 240, 520),
        k = this.poseK ?? (time - atk) / dur; // poseK: fixed phase for local screenshots only
      if (k < 0 || k >= 1) return null;
      const aim = sprite.getData("aimX") || 1,
        ease = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3),
        seg = (a, b) => clamp((k - a) / (b - a), 0, 1);
      let lean = 0,
        stretch = 1;
      const kind = isMeleeTower(def) ? "melee" : def.attackType === "siege" || (def.splashFull || 0) > 0 ? "siege" : isMagicTower(def) || def.attackType === "magic" ? "magic" : "ranged";
      if (kind === "melee") {
        if (k < 0.3) {
          lean = -0.45 * ease(seg(0, 0.3));
          stretch = 1 + 0.03 * seg(0, 0.3);
        } else if (k < 0.48) {
          const x = seg(0.3, 0.48);
          lean = -0.45 + 1.75 * x * x;
          stretch = 1.03 - 0.08 * x;
        } else {
          const x = ease(seg(0.48, 1));
          lean = 1.3 * (1 - x);
          stretch = 0.95 + 0.05 * x;
        }
      } else if (kind === "siege") {
        if (k < 0.1) {
          lean = -0.7 * ease(seg(0, 0.1));
          stretch = 1 - 0.1 * seg(0, 0.1);
        } else {
          const y = seg(0.1, 1);
          lean = -0.7 * Math.exp(-5 * y) * Math.cos(11 * y);
          stretch = 1 - 0.1 * Math.exp(-6 * y) * Math.cos(9 * y);
        }
      } else if (kind === "magic") {
        if (k < 0.4) {
          lean = 0.1 * seg(0, 0.4);
          stretch = 1 + 0.1 * ease(seg(0, 0.4));
        } else if (k < 0.55) {
          const x = seg(0.4, 0.55);
          lean = 0.1 + 0.5 * x;
          stretch = 1.1 - 0.14 * x;
        } else {
          const x = ease(seg(0.55, 1));
          lean = 0.6 * (1 - x);
          stretch = 0.96 + 0.04 * x;
        }
      } else {
        if (k < 0.45) {
          lean = -0.32 * ease(seg(0, 0.45));
          stretch = 1 + 0.035 * seg(0, 0.45);
        } else if (k < 0.58) {
          const x = seg(0.45, 0.58);
          lean = -0.32 + 0.82 * x;
          stretch = 1.035 - 0.05 * x;
        } else {
          const x = ease(seg(0.58, 1));
          lean = 0.5 * (1 - x);
          stretch = 0.985 + 0.015 * x;
        }
      }
      return { lean: lean * aim, stretch };
    }
    /** Immolation aura radius of a tower type (0 when it has none). */
    immolation(def, catalog) {
      this.burnCache ||= new Map();
      if (!this.burnCache.has(def.id)) {
        // v0.17p: the widest immolation aura (Phoenix has two)
        const r = Math.max(0, ...(def.abilities || []).map((id) => catalog.abilities[id]).filter((x) => x?.baseId === "AIcf").map((a) => Number(a.fields?.aare?.[1] ?? a.fields?.aare?.[0] ?? 192)));
        this.burnCache.set(def.id, r);
      }
      return this.burnCache.get(def.id);
    }
    /**
     * v0.23: level badges come from one shared atlas (every colour × level, drawn exactly like the text labels
     * they replace) and are batched per row, so the depth order with the figures stays the same.
     */
    badgeAtlas(extra) {
      this.badgeSet ||= new Set(Object.values(BADGE_COLORS).flatMap((c) => Array.from({ length: 10 }, (_, i) => c + "|" + (i + 1))));
      if (extra) this.badgeSet.add(extra);
      const entries = [...this.badgeSet].map((name) => {
        const [color, text] = name.split("|");
        return { name, text, pad: [3, 0, 3, 1], style: { fontFamily: FONT, fontSize: "11px", color: "#ffffff", stroke: "#0b0f14", strokeThickness: 3, backgroundColor: color } };
      });
      this.stage.textAtlas("badges", entries, DPR);
    }
    levelBadge(level, x, y, depth, color = BADGE_COLORS.neutral) {
      const names = (this.badgeNames[color] ||= []),
        name = (names[level] ||= color + "|" + level);
      let r = this.stage.rect("badges", name);
      if (!r) {
        this.badgeAtlas(name);
        r = this.stage.rect("badges", name);
        if (!r) return;
      }
      let batch = this.badgeBatches.get(depth);
      if (!batch) this.badgeBatches.set(depth, (batch = this.stage.sprites("badges").setDepth(depth)));
      batch.used = true;
      batch.quad(x, y, r.w, r.h, 0.5, 0.5, 0, false, 0xffffff, 1, r.uv);
    }
    /** Pfotenwelt: instead of arrows, little paw prints walk along the route (left, right, left …). */
    pawFlow(g, pts, time, cell, [color, alpha]) {
      const spacing = cell * 0.42,
        r = cell * 0.085;
      let total = 0;
      const segs = [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1],
          b = pts[i],
          len = Math.hypot(b.x - a.x, b.y - a.y);
        segs.push({ a, b, len, start: total });
        total += len;
      }
      if (total <= 0) return;
      const run = time * 0.001 * cell * 0.55,
        offset = (run % (spacing * 2)) + spacing * 0.5;
      g.fillStyle(color, alpha);
      let n = 0;
      for (let d = offset; d < total - spacing * 0.3; d += spacing, n++) {
        const s = segs.find((s) => d >= s.start && d <= s.start + s.len) || segs[segs.length - 1],
          t = (d - s.start) / (s.len || 1),
          ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x),
          side = n % 2 ? 1 : -1, // the offset wraps by two steps, so every print keeps its side
          ca = Math.cos(ang),
          sa = Math.sin(ang),
          x = lerp(s.a.x, s.b.x, t) - sa * cell * 0.1 * side,
          y = lerp(s.a.y, s.b.y, t) + ca * cell * 0.1 * side,
          // fade in at the start and out at the end of the route
          fade = Math.min(1, d / spacing, (total - d) / spacing);
        g.fillStyle(color, alpha * fade);
        g.fillEllipse(x - ca * r * 0.2, y - sa * r * 0.2, r * 1.25, r * 1.25);
        for (const [u, v] of [[0.85, -0.62], [1.12, -0.2], [1.12, 0.22], [0.85, 0.64]]) g.fillCircle(x + ca * u * r - sa * v * r, y + sa * u * r + ca * v * r, r * 0.3);
      }
    }
    chevrons(g, pts, time, cell, color, alpha, paws = false) {
      const PP = paws && boardPalette()?.pathPaw;
      if (PP) return this.pawFlow(g, pts, time, cell, PP); // Pfotenwelt: the route is walked by paw prints
      const spacing = cell * 0.62,
        size = cell * 0.1;
      let total = 0;
      const segs = [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1],
          b = pts[i],
          len = Math.hypot(b.x - a.x, b.y - a.y);
        segs.push({ a, b, len, start: total });
        total += len;
      }
      if (total <= 0) return;
      g.lineStyle(2.5, color, alpha);
      const offset = ((time * 0.001 * cell * 0.55) % spacing) + spacing * 0.5;
      for (let d = offset; d < total - spacing * 0.3; d += spacing) {
        const s = segs.find((s) => d >= s.start && d <= s.start + s.len) || segs[segs.length - 1],
          t = (d - s.start) / (s.len || 1),
          x = lerp(s.a.x, s.b.x, t),
          y = lerp(s.a.y, s.b.y, t),
          ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
        const bx = Math.cos(ang),
          by = Math.sin(ang),
          nx = -by,
          ny = bx;
        g.beginPath();
        g.moveTo(x - bx * size + nx * size, y - by * size + ny * size);
        g.lineTo(x + bx * size * 0.4, y + by * size * 0.4);
        g.lineTo(x - bx * size - nx * size, y - by * size - ny * size);
        g.strokePath();
      }
    }
    /** Translucent pre-build ghosts: built automatically once gold is there / the field is free. */
    drawQueued(game, view, list, catalog, z, time) {
      this.queueGhosts = this.queueGhosts || [];
      while (this.queueGhosts.length < list.length)
        this.queueGhosts.push(this.stage.image(0, 0, "tower-archer").setDepth(3900).setVisible(false));
      this.queueGhosts.forEach((img, i) => {
        const qd = list[i];
        if (!qd || view !== getOwnPlayer()) return img.setVisible(false);
        const def = catalog.byId[qd.id],
          fp = footprintOf(qd.id),
          q = this.point((qd.gridX + fp / 2) / z.logicalCols, (qd.gridY + fp / 2) / z.totalRows),
          cell = z.cw * fp;
        if (!def) return img.setVisible(false);
        const still = this.stillFor(artFor(def), colorOf(getOwnPlayer())), // v0.23
          m = this.artMeta(still.tex, still.art); // v0.23a: the size data of the picture shown (art sets)
        img
          .setTexture(still.tex)
          .setVisible(true)
          .setOrigin(m.plateCX / m.w, m.plateCY / m.h)
          .setAlpha(0.4)
          .setPosition(q.x, q.y + cell * 0.1)
          .setScale(((cell * 0.98 * TOWER_SCALE) / m.plateW) * levelScale(def.level || 1))
          .setDepth(Math.floor(q.y + cell * 0.1) + 110);
      });
    }
    /** Reach overlay: a circle for ranged towers, the 3×3 block of fields for melee towers. */
    drawReach(g, def, q, r, cw, size = 1) {
      if (isMeleeTower(def) && size === 1) {
        // Clipped to the board including the portal strip.
        const half = cw * 1.5,
          a = this.point(0, 0),
          b = this.point(1, 1),
          s = cw * STRIP,
          x0 = Math.max(q.x - half, a.x),
          x1 = Math.min(q.x + half, b.x),
          y0 = Math.max(q.y - half, a.y - s),
          y1 = Math.min(q.y + half, b.y);
        g.fillStyle(0xbff3ff, 0.09);
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
        g.lineStyle(2, 0xbff3ff, 0.7);
        g.strokeRect(x0, y0, x1 - x0, y1 - y0);
        return;
      }
      g.fillStyle(0xbff3ff, 0.09);
      g.fillCircle(q.x, q.y, r);
      g.lineStyle(2, 0xbff3ff, 0.65);
      g.strokeCircle(q.x, q.y, r);
    }
    drawPreview(game, view, preview, catalog, z, time) {
      const g = this.overlay;
      if (!preview || preview.player !== view) {
        this.ghost.setVisible(false);
        this.previewLabel.setVisible(false);
        return;
      }
      const fp = preview.size || 1,
        q = this.point((preview.gridX + fp / 2) / z.logicalCols, (preview.gridY + fp / 2) / z.totalRows),
        cell = z.cw * fp,
        inside = preview.gridX >= 0 && preview.gridX < z.logicalCols && preview.gridY >= 0 && preview.gridY < z.logicalRows;
      if (!inside) {
        this.ghost.setVisible(false);
        this.previewLabel.setVisible(false);
        return;
      }
      const ok = preview.ok,
        def = catalog.byId[preview.id];
      if (ok && preview.path?.length) {
        const pts = preview.path.map((p) => this.point(p.x, p.y));
        g.lineStyle(Math.max(4, z.cw * 0.28), 0x7fe3ff, 0.3);
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.strokePath();
        this.chevrons(g, pts, time * 1.8, z.cw, 0xe8fbff, 0.95);
      }
      g.fillStyle(ok ? 0xc8ffb0 : 0xff7a7a, ok ? 0.25 : 0.32);
      g.fillRoundedRect(q.x - cell / 2 + 3, q.y - cell / 2 + 3, cell - 6, cell - 6, 7);
      g.lineStyle(3, ok ? 0xeaffd8 : 0xffb0b0, 0.95);
      g.strokeRoundedRect(q.x - cell / 2 + 3, q.y - cell / 2 + 3, cell - 6, cell - 6, 7);
      if (def && ok) {
        const r = (getStats(game, view, def.id).range / game.grid.cellUnits) * z.cw;
        this.drawReach(g, def, q, r, z.cw, fp);
      }
      if (!ok) {
        g.lineStyle(3.5, 0xffe1e1, 0.95);
        const s = cell * 0.16;
        g.lineBetween(q.x - s, q.y - s, q.x + s, q.y + s);
        g.lineBetween(q.x + s, q.y - s, q.x - s, q.y + s);
      }
      if (def) {
        const still = this.stillFor(artFor(def), colorOf(getOwnPlayer())), // v0.23
          m = this.artMeta(still.tex, still.art), // v0.23a: the size data of the picture shown (art sets)
          s = ((cell * 0.98 * TOWER_SCALE) / m.plateW) * levelScale(def.level || 1);
        this.ghost
          .setTexture(still.tex)
          .setVisible(ok)
          .setOrigin(m.plateCX / m.w, m.plateCY / m.h)
          .setAlpha(0.6 + 0.15 * Math.sin(time * 0.01))
          .setPosition(q.x, q.y + cell * 0.1)
          .setScale(s)
          .setDepth(Math.floor(q.y + cell * 0.1) + 120);
      }
      const label = ok
        ? preview.confirm
          ? t("Tap again to build")
          : preview.delta > 0
            ? t("Path +{n}", { n: preview.delta })
            : t("Path unchanged")
        : t(preview.reason || "Not possible here");
      this.previewLabel
        .setText(label)
        .setColor(ok ? (preview.delta > 0 ? "#c9ffb0" : "#ffffff") : "#ffc2c2")
        .setPosition(clamp(q.x, z.left + 64, z.left + z.bw - 64), Math.max(z.top + 16, q.y - cell * 0.95))
        .setVisible(true);
    }
    drawFx(game, player, dt, cell, view = player.id) {
      const f = this.fx,
        fa = this.fxAdd;
      f.clear();
      fa.clear();
      // Homing projectiles: travel visibly from tower to the creep they hit.
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const p = this.projectiles[i];
        p.t += dt;
        const target = player.creeps.find((c) => c.id === p.targetId);
        if (target && target.hp > 0) {
          // v0.25b: aim at the figure as it is drawn (curved corners, spread-out groups, its own height),
          // not at the creep's logical spot on the ground
          const fig = this.units.get(this.creepKey(view, target.id)),
            hy = fig?.visible ? fig.getData("hy") : null;
          if (hy != null) {
            p.tx = fig.getData("hx");
            p.ty = hy;
          } else {
            const q = this.point(target.x, target.y);
            p.tx = q.x;
            p.ty = q.y - cell * 0.2;
          }
        }
        const k = clamp(p.t / p.dur, 0, 1),
          x = lerp(p.x0, p.tx, k),
          y = lerp(p.y0, p.ty, k) - Math.sin(k * Math.PI) * p.arc;
        const kb = clamp(k - 0.25, 0, 1),
          bx = lerp(p.x0, p.tx, kb),
          by = lerp(p.y0, p.ty, kb) - Math.sin(kb * Math.PI) * p.arc;
        if (p.arrow) {
          // v0.09u: Arrow Volley — a real arrow (shaft, head, fletching), 50 % larger than before
          const dx = p.tx - p.x0,
            dy = p.ty - p.y0,
            len = Math.hypot(dx, dy) || 1,
            ux = dx / len,
            uy = dy / len,
            L = cell * 0.62,
            sx = x - ux * L,
            sy = y - uy * L,
            w = p.size;
          f.lineStyle(w * 1.9, 0x1b1630, 0.9);
          f.lineBetween(sx, sy, x, y);
          f.lineStyle(w * 0.9, 0xb57a3e, 1);
          f.lineBetween(sx, sy, x, y);
          const hx = x + ux * w * 2.6,
            hy = y + uy * w * 2.6;
          f.fillStyle(0x1b1630, 1);
          f.fillTriangle(hx + ux * 1.5, hy + uy * 1.5, x - uy * w * 1.9, y + ux * w * 1.9, x + uy * w * 1.9, y - ux * w * 1.9);
          f.fillStyle(0xe8eef6, 1);
          f.fillTriangle(hx, hy, x - uy * w * 1.3, y + ux * w * 1.3, x + uy * w * 1.3, y - ux * w * 1.3);
          f.fillStyle(0xd8403a, 1);
          f.fillTriangle(sx, sy, sx - ux * w * 2.4 - uy * w * 1.6, sy - uy * w * 2.4 + ux * w * 1.6, sx + ux * w * 1.2, sy + uy * w * 1.2);
          f.fillTriangle(sx, sy, sx - ux * w * 2.4 + uy * w * 1.6, sy - uy * w * 2.4 - ux * w * 1.6, sx + ux * w * 1.2, sy + uy * w * 1.2);
          if (k >= 1) {
            this.projectiles.splice(i, 1);
            this.burst(p.tx, p.ty, 0xfff1c4, 4, 50, 2, 0.2, 0, true);
          }
          continue;
        }
        if (p.glow) {
          fa.lineStyle(p.size * 2.2, p.color, 0.35);
          fa.lineBetween(bx, by, x, y);
          fa.fillStyle(p.color, 0.45);
          fa.fillCircle(x, y, p.size * 2.4);
        } else {
          f.lineStyle(p.size * 0.9, p.color === 0x3b302a ? 0x8a7a6a : p.color, 0.55);
          f.lineBetween(bx, by, x, y);
        }
        f.fillStyle(p.color, 1);
        f.fillCircle(x, y, p.size);
        f.fillStyle(0xffffff, 0.85);
        f.fillCircle(x - p.size * 0.25, y - p.size * 0.25, p.size * 0.4);
        if (k >= 1) {
          this.projectiles.splice(i, 1);
          if (p.splash) {
            const boom = p.color === 0x3b302a ? 0xffb35c : p.color;
            this.ring(x, y, cell * 0.1, cell * 0.75, boom, 0.32, 3.5);
            this.burst(x, y, boom, 9, 80, 2.6, 0.34, 40, true);
          } else this.burst(x, y, p.color, 4, 45, 1.9, 0.2, 0, p.glow);
        }
      }
      // v0.12: Monsun lightning bolts
      for (let i = this.bolts.length - 1; i >= 0; i--) {
        const b = this.bolts[i];
        b.life -= dt;
        if (b.life <= 0) {
          this.bolts.splice(i, 1);
          continue;
        }
        const k = b.life / b.max;
        for (const [w, c, a] of b.plague ? [[16, 0x5aff1a, 0.45], [6, 0xeaffd0, 1]] : b.ice ? [[14, 0x5ac8ff, 0.4], [5, 0xe8fbff, 1]] : [[b.small ? 7 : 11, 0x8fc8ff, 0.35], [b.small ? 2.5 : 4, 0xfffbe0, 1]]) { // v0.23w: icy Frost Bolt streak
          fa.lineStyle(w, c, a * k);
          fa.beginPath();
          fa.moveTo(b.pts[0].x, b.pts[0].y);
          for (const pt of b.pts.slice(1)) fa.lineTo(pt.x, pt.y);
          fa.strokePath();
        }
      }
      // v0.18b: Focus Fire beams: width, glow and brightness follow the charge (eased, never flickering)
      for (const [id, b] of this.beams) {
        b.life -= dt;
        if (b.life <= 0) {
          this.beams.delete(id);
          continue;
        }
        const target = player.creeps.find((c) => c.id === b.targetId);
        if (target && target.hp > 0) {
          const q = this.point(target.x, target.y);
          b.tx = q.x;
          b.ty = q.y - cell * 0.2;
        }
        b.shown += (b.power - b.shown) * Math.min(1, dt * 6);
        const p = b.shown,
          fade = Math.min(1, (b.life / b.max) * 2.5);
        for (const [w, color, a] of [
          [cell * (0.1 + 0.34 * p), 0x4fae3a, 0.16 + 0.3 * p],
          [cell * (0.05 + 0.14 * p), 0xa6f06a, 0.5 + 0.35 * p],
          [cell * (0.018 + 0.04 * p), 0xffffff, 0.65 + 0.35 * p],
        ]) {
          fa.lineStyle(w, color, a * fade);
          fa.lineBetween(b.x0, b.y0, b.tx, b.ty);
        }
        fa.fillStyle(0xc8ff9a, (0.35 + 0.45 * p) * fade);
        fa.fillCircle(b.tx, b.ty, cell * (0.07 + 0.2 * p));
        fa.fillStyle(0xa6f06a, (0.3 + 0.4 * p) * fade);
        fa.fillCircle(b.x0, b.y0, cell * (0.05 + 0.12 * p));
      }
      for (let i = this.swipes.length - 1; i >= 0; i--) {
        const s = this.swipes[i];
        s.life -= dt;
        if (s.life <= 0) {
          this.swipes.splice(i, 1);
          continue;
        }
        const a = s.a,
          b = s.b,
          dir = Math.atan2(b.y - a.y, b.x - a.x),
          reach = Math.min(s.cell * 0.7, Math.hypot(b.x - a.x, b.y - a.y)),
          x = a.x + Math.cos(dir) * reach,
          y = a.y + Math.sin(dir) * reach,
          k = 1 - s.life / s.max;
        fa.lineStyle(5, 0xfff3c4, (1 - k) * 0.9);
        fa.beginPath();
        fa.arc(x, y, s.cell * 0.3, dir - 1.2 + k * 0.8, dir + 0.2 + k * 1.3);
        fa.strokePath();
      }
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          // v0.23: swap-remove (splice moved every later particle)
          const last = this.particles.pop();
          if (last !== p) this.particles[i] = last;
          continue;
        }
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const k = p.life / p.max,
          target = p.additive ? fa : f;
        target.fillStyle(p.color, Math.min(1, k * 1.4));
        target.fillCircle(p.x, p.y, p.size * (0.4 + 0.6 * k));
      }
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.life -= dt;
        if (r.life <= 0) {
          this.rings.splice(i, 1);
          continue;
        }
        const k = 1 - r.life / r.max;
        fa.lineStyle(r.width * (1 - k * 0.6), r.color, 1 - k);
        fa.strokeCircle(r.x, r.y, lerp(r.r0, r.r1, 1 - Math.pow(1 - k, 3)));
      }
      for (let i = this.floaters.length - 1; i >= 0; i--) {
        const fl = this.floaters[i];
        fl.life -= dt;
        if (fl.life <= 0) {
          this.recycle(fl);
          this.floaters.splice(i, 1);
          continue;
        }
        const k = 1 - fl.life / fl.max;
        if (fl.bonus) {
          // like the highest-income shine: a slow sweep from gold to pale gold, two soft four-point glints
          const sweep = 0.5 + 0.5 * Math.sin(k * Math.PI * 2 + fl.seed);
          const step = Math.round(sweep * 6) / 6, // a few steps only, so the text is not redrawn every frame
            mix = (c0, c1) => Math.round(c0 + (c1 - c0) * step).toString(16).padStart(2, "0");
          fl.t.setColor("#" + mix(0xff, 0xff) + mix(0xe2, 0xfb) + mix(0x7a, 0xe6));
          const yy = fl.y - fl.rise * (1 - Math.pow(1 - k, 2)) - fl.size * 0.55,
            fade = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
          for (let n = 0; n < 2; n++) {
            const ph = Math.sin(k * Math.PI * 2.2 + n * 2.4 + fl.seed),
              a = Math.max(0, ph) * 0.95 * fade,
              gx = fl.x + (n ? 1 : -1) * fl.size * (0.75 + 0.15 * n),
              gy = yy + (n ? -fl.size * 0.25 : fl.size * 0.1),
              r = fl.size * (0.22 + 0.12 * Math.max(0, ph));
            if (a <= 0.02) continue;
            fa.lineStyle(Math.max(1, fl.size * 0.09), 0xfffbe0, a);
            fa.lineBetween(gx - r, gy, gx + r, gy);
            fa.lineBetween(gx, gy - r, gx, gy + r);
            fa.fillStyle(0xffffff, a);
            fa.fillCircle(gx, gy, Math.max(1, fl.size * 0.08));
          }
        }
        fl.t
          .setPosition(fl.x, fl.y - fl.rise * (1 - Math.pow(1 - k, 2)))
          .setScale(k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - Math.min(0.1, (k - 0.15) * 0.4))
          .setAlpha(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
      }
    }
    drawPip(game, view, own, z, catalog, time) {
      const g = this.pip,
        mode = getMinimapMode(),
        other = getPipPlayer ? getPipPlayer() : 1 - view,
        lane = game.players[other],
        pr = mode === "on" ? pipGeometry(z) : null,
        // v0.24r: the mini map shows the other lane at its own (grown) height; it scrolls with a scrolling lane
        r = pr && { ...pr, y: pr.y + ((z.scroll?.lane && this.stage.scrollY) || 0), h: (pr.w * laneRows(game, lane)) / game.grid.cols },
        { cols } = game.grid,
        rows = baseRows(game);
      g.clear();
      this.miniRects = [];
      // v0.24p: Desktop Wide draws the mini maps beside the player windows (app.js)
      if (layoutWide()) {
        this.pipLabel.setVisible(false);
        return;
      }
      if (mode === "all") {
        // v0.18c: every other field as a 40 % see-through mini map, side by side below the player plates
        const ids = getMiniPlayers().filter((id) => game.players[id]),
          n = ids.length,
          gap = 8,
          mw = n ? Math.max(18, Math.min(52, (z.w - 16 - (n - 1) * gap) / n)) : 0,
          mh = (mw * rows) / cols,
          x0 = (z.w - (n * mw + (n - 1) * gap)) / 2,
          y0 = (this.stage.scrollY || 0) + insets.top + 8;
        ids.forEach((id, i) => {
          const m = { x: x0 + i * (mw + gap), y: y0, w: mw, h: mh, player: id };
          this.miniRects.push(m);
          this.drawLaneMap(g, game, game.players[id], id, own, m, catalog, 0.6, true);
        });
        this.pipLabel.setVisible(false);
        return;
      }
      if (!r) {
        this.pipLabel.setVisible(false); // v0.17d: layout B has no mini map; v0.18c: Minimap off
        return;
      }
      this.drawLaneMap(g, game, lane, other, own, r, catalog, 1, false);
      // v0.21d: team games: while the mini map is visible, your allies' fields always show too, as
      // see-through mini maps on the left (like the "All" row, framed in their colours)
      const allies = getAllyPlayers().filter((id) => id !== other && game.players[id]);
      if (allies.length) {
        const gap = 8,
          mw = Math.max(18, Math.min(44, (z.w / 2 - 16 - (allies.length - 1) * gap) / allies.length)),
          mh = (mw * rows) / cols,
          y0 = (this.stage.scrollY || 0) + insets.top + 8;
        // beside the board (desktop) they would cover the level button: there they stack under the enemy map
        const below = !z.side?.compact,
          bw2 = Math.min(r.w, Math.max(18, r.w * 0.75)),
          bh2 = (bw2 * rows) / cols;
        allies.forEach((id, i) => {
          const m = below ? { x: r.x + (r.w - bw2) / 2, y: r.y + r.h + 34 + i * (bh2 + gap), w: bw2, h: bh2, player: id } : { x: 8 + i * (mw + gap), y: y0, w: mw, h: mh, player: id };
          this.miniRects.push(m);
          this.drawLaneMap(g, game, game.players[id], id, own, m, catalog, 0.6, true);
        });
      }
      const mine = lane.creeps.filter((c) => c.owner === own && c.hp > 0).length;
      this.pipLabel
        .setText(other === own ? t("YOU") : mine ? `${t("ENEMY")}\n${mine}` : t("ENEMY"))
        .setOrigin(0.5, 0)
        .setAlign("center")
        .setPosition(r.x + r.w / 2, r.y + r.h + 6)
        .setVisible(true);
    }
    /** One field drawn small: grass, path, towers and creeps; `a` scales every alpha, `team` frames it in the player's colour. */
    drawLaneMap(g, game, lane, other, own, r, catalog, a, team) {
      const { cols } = game.grid,
        rows = laneRows(game, lane); // v0.24r: the lane's own height
      // Portrait, same orientation as the main board.
      const sx = r.w / cols,
        sy = r.h / rows,
        P = (nx, ny) => ({ x: r.x + nx * r.w, y: r.y + ny * game.grid.rows * sy }); // creep y is a share of the full grid
      g.fillStyle(0x0a1a22, 0.92 * a);
      g.fillRoundedRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8, 8);
      g.fillStyle(0x3f7a3a, a);
      g.fillRect(r.x, r.y, r.w, r.h);
      g.fillStyle(0x8a4dff, 0.9 * a);
      g.fillRect(r.x, r.y, r.w, Math.max(2, sy * 0.25));
      const path = lane.path || [];
      if (path.length > 1) {
        g.lineStyle(Math.max(team ? 1.5 : 2, sx * 0.5), 0xb08a5a, a);
        g.beginPath();
        path.forEach((p, i) => {
          const q = P(p.x, p.y);
          i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y);
        });
        g.strokePath();
      }
      for (const t of lane.towers) {
        const q = P(t.x, t.y);
        g.fillStyle(0x163a4a, a);
        g.fillCircle(q.x, q.y, Math.min(sx, sy) * 0.42);
        g.fillStyle(TEAM_COLORS[colorOf(other)].hex, a);
        g.fillCircle(q.x, q.y, Math.min(sx, sy) * 0.22);
      }
      for (const c of lane.creeps) {
        if (c.hp <= 0) continue;
        const q = P(c.x, c.y),
          mine = c.owner === own;
        const rad = (catalog.byId[c.typeId]?.bossTier || c.waveBoss ? 3.4 : 2.1) * (team ? 0.8 : 1);
        if (mine) {
          // v0.25i: your own creeps in your player colour with a white outline (was yellow)
          g.fillStyle(0xffffff, a);
          g.fillCircle(q.x, q.y, rad + 1);
          g.fillStyle(TEAM_COLORS[colorOf(own)].hex, a);
        } else g.fillStyle(c.owner < 0 ? 0xb48cff : 0xff8a7a, a);
        g.fillCircle(q.x, q.y, rad);
      }
      if (team) g.lineStyle(2, TEAM_COLORS[colorOf(other)].hex, 0.9 * a);
      else g.lineStyle(2, this.gainFlash > 0 ? 0x9ce0ff : 0xd9b45a, this.gainFlash > 0 ? 0.6 + this.gainFlash * 0.4 : 0.9);
      g.strokeRoundedRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8, 8);
    }
    drawVignette(z, dt) {
      const g = this.vignette;
      g.clear();
      if (this.gainFlash > 0) this.gainFlash = Math.max(0, this.gainFlash - dt * 1.4);
      if (this.flash <= 0) return;
      this.flash = Math.max(0, this.flash - dt * 1.8);
      const a = this.flash,
        band = 5,
        sy = this.stage.scrollY || 0; // the red edge stays on the screen edge while the board scrolls
      for (let i = 0; i < 12; i++) {
        const alpha = a * 0.34 * (1 - i / 12),
          o = i * band;
        g.fillStyle(0xff2a3a, alpha);
        g.fillRect(o, sy + o, z.w - o * 2, band);
        g.fillRect(o, sy + z.h - o - band, z.w - o * 2, band);
        g.fillRect(o, sy + o + band, band, z.h - o * 2 - band * 2);
        g.fillRect(z.w - o - band, sy + o + band, band, z.h - o * 2 - band * 2);
      }
    }
    backOut(t) {
      const s = 1.9;
      return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
    }
    /** v0.12: Pillar of Fire (flames, pillar, scorched ground) and Monsun winds, drawn from the game state. */
    drawPerkFx(game, view, z, time, g, glow) {
      const cell = z.cw,
        now = game.time;
      for (const f of game.pillars || []) {
        if (f.player !== view) continue;
        const q = this.point(f.x, f.y),
          r = f.radius * cell,
          seed = (f.start * 13.7) % 1;
        if (now >= f.end) {
          // scorched ground, fading out
          const fade = clamp((f.until - now) / 3, 0, 1);
          g.fillStyle(0x1a0c06, 0.42 * fade);
          g.fillEllipse(q.x, q.y, r * 2, r * 1.7);
          g.fillStyle(0x2e1408, 0.35 * fade);
          g.fillEllipse(q.x, q.y, r * 1.3, r * 1.05);
          for (let k = 0; k < 10; k++) {
            const a = hash(k, 31 + seed) * Math.PI * 2,
              d = Math.sqrt(hash(k, 37 + seed)) * r * 0.85,
              tw = 0.5 + 0.5 * Math.sin(time * 0.006 + k * 2.1);
            glow.fillStyle(0xff6a1a, 0.5 * fade * tw);
            glow.fillCircle(q.x + Math.cos(a) * d, q.y + Math.sin(a) * d * 0.85, 1.5 + 2 * tw);
          }
          continue;
        }
        const erupting = now >= f.erupt,
          flames = erupting ? 22 : 12,
          k0 = erupting ? 1 : clamp((now - f.start) / Math.max(0.01, f.erupt - f.start), 0, 1);
        glow.fillStyle(0xff5a12, erupting ? 0.28 : 0.1 + 0.08 * k0);
        glow.fillCircle(q.x, q.y, r);
        g.lineStyle(erupting ? 4 : 2.5, 0xffa040, erupting ? 0.9 : 0.5 + 0.4 * k0);
        g.strokeEllipse(q.x, q.y, r * 2, r * 1.85);
        // dancing flames over the area
        for (let k = 0; k < flames; k++) {
          const a = hash(k, 7 + seed) * Math.PI * 2,
            d = Math.sqrt(hash(k, 11 + seed)) * r * 0.9,
            x = q.x + Math.cos(a) * d,
            y = q.y + Math.sin(a) * d * 0.9,
            fl = 0.5 + 0.5 * Math.sin(time * 0.025 + k * 1.7),
            h = cell * (erupting ? 0.5 : 0.22 * k0 + 0.08) * (0.7 + 0.6 * fl);
          glow.fillStyle(0xff4a0c, 0.55);
          glow.fillTriangle(x - h * 0.32, y, x + h * 0.32, y, x + Math.sin(time * 0.02 + k) * h * 0.15, y - h);
          glow.fillStyle(0xffd24a, 0.75);
          glow.fillTriangle(x - h * 0.16, y, x + h * 0.16, y, x, y - h * 0.6);
        }
        if (erupting) {
          // the pillar itself: a tall column of fire, brightest in the middle
          const life = clamp((f.end - now) / Math.max(0.01, f.end - f.erupt), 0, 1),
            top = q.y - cell * (f.small ? 1.8 : 3.4), // v0.19j: Fire Block explosions are smaller
            w = r * 0.55 * (0.8 + 0.2 * Math.sin(time * 0.03));
          for (let k = 0; k < 9; k++) {
            const y = q.y - (q.y - top) * (k / 8),
              ww = w * (1 - k * 0.07) * (0.85 + 0.15 * Math.sin(time * 0.04 + k));
            glow.fillStyle(0xff3a08, 0.3 * life + 0.15);
            glow.fillEllipse(q.x + Math.sin(time * 0.02 + k) * cell * 0.08, y, ww * 2, cell * 0.9);
            glow.fillStyle(0xffc24a, 0.35 * life + 0.15);
            glow.fillEllipse(q.x, y, ww, cell * 0.6);
          }
          glow.fillStyle(0xfff4c0, 0.5);
          glow.fillEllipse(q.x, q.y - cell * 0.4, w * 0.6, cell * 1.6);
          if (Math.random() < 0.35) this.burst(q.x + (Math.random() - 0.5) * r, q.y - Math.random() * cell, 0xffb040, 3, 110, 2.6, 0.5, -60, true);
          if (!f.small && !this.shook?.has(f.start)) {
            (this.shook ||= new Set()).add(f.start);
            this.stage.shake(260, 0.008);
          }
        }
      }
      const m = game.players[view]?.monsun;
      if (m && now <= m.until) {
        const fade = clamp(Math.min((now - m.start) / 0.6, (m.until - now) / 0.6), 0, 1);
        g.fillStyle(0x0a1830, 0.2 * fade);
        g.fillRect(z.left, z.top - z.strip, z.bw, z.bh + z.strip);
        for (let k = 0; k < 30; k++) {
          const x = z.left + hash(k, 41) * z.bw,
            speed = 0.35 + 0.4 * hash(k, 43),
            y = z.top + z.bh - (((time * 0.001 * speed * z.bh * 0.9 + hash(k, 47) * z.bh) % z.bh) + 0),
            len = cell * (0.5 + 0.6 * hash(k, 53));
          glow.lineStyle(2, 0xd8f0ff, 0.35 * fade);
          glow.lineBetween(x, y, x + Math.sin(time * 0.003 + k) * cell * 0.12, y - len);
        }
      }
    }
    /**
     * v0.26a: the Disease Launcher's cloud: slowly billowing green poison puffs with a darker rim and a
     * see-through green skull floating in the middle.
     */
    drawPoisonCloud(g, glow, q, r, fade, time, seed) {
      const t = time * 0.0011 + seed;
      g.fillStyle(0x2f6b12, 0.14 * fade); // darker rim
      g.fillCircle(q.x, q.y, r);
      for (let k = 0; k < 7; k++) {
        const a = k * 0.9 + t * (k % 2 ? 0.6 : -0.45),
          d = r * (0.32 + 0.12 * Math.sin(t * 1.7 + k)),
          pr = r * (0.38 + 0.08 * Math.sin(t * 1.3 + k * 2.1));
        g.fillStyle(k % 3 ? 0x5fbf2a : 0x7fd23a, 0.11 * fade);
        g.fillCircle(q.x + Math.cos(a) * d, q.y + Math.sin(a) * d * 0.7, pr);
      }
      for (let k = 0; k < 4; k++) {
        const a = t * 0.8 + k * 1.57;
        glow.fillStyle(0xb8ff6a, 0.12 * fade);
        glow.fillCircle(q.x + Math.cos(a) * r * 0.5, q.y + Math.sin(a) * r * 0.32, r * 0.16);
      }
      // the skull: transparent green, bobbing gently
      const s = r * 0.34,
        x = q.x,
        y = q.y - r * 0.08 + Math.sin(time * 0.002 + seed) * r * 0.04,
        al = 0.42 * fade;
      glow.fillStyle(0x9cff5a, al);
      glow.fillCircle(x, y - s * 0.12, s * 0.62); // cranium
      glow.fillRoundedRect(x - s * 0.36, y + s * 0.2, s * 0.72, s * 0.42, s * 0.12); // jaw
      g.fillStyle(0x0f3a08, 0.7 * fade); // sockets, nose, teeth gaps
      g.fillEllipse(x - s * 0.24, y - s * 0.1, s * 0.3, s * 0.34);
      g.fillEllipse(x + s * 0.24, y - s * 0.1, s * 0.3, s * 0.34);
      g.fillTriangle(x, y + s * 0.1, x - s * 0.08, y + s * 0.26, x + s * 0.08, y + s * 0.26);
      for (let k = -1; k <= 1; k++) g.fillRect(x + k * s * 0.17 - s * 0.02, y + s * 0.36, s * 0.04, s * 0.22);
    }
    clearFx() {
      this.projectiles = [];
      this.particles = [];
      this.rings = [];
      this.swipes = [];
      this.beams = new Map();
      this.bolts = [];
      for (const f of this.floaters) this.recycle(f);
      this.floaters = [];
      this.flash = 0;
      this.gainFlash = 0;
    }
  }
  const modalEl = document.getElementById("modal"); // v0.23: the dialog (menu, picks, results) over the board
  const stage = new Stage(container, { background: "#0b201d", dpr: DPR, antialias: (window.devicePixelRatio || 1) < 2 }),
    arena = new Arena(stage);
  if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) window.felitoArena = arena; // local debugging only
  let started = false,
    destroyed = false;
  const preloaded = arena
    .preload()
    .catch(() => {})
    .then(() => {
      if (destroyed) return;
      arena.create();
      started = true;
      arena.switchArt(); // design variants: a design picked while the board was still loading
      stage.start((time, delta, redraw) => arena.update(time, delta, redraw));
    });
  // The board follows its container and the HUD/dock around it.
  const resize = new ResizeObserver(() => {
    measureInsets();
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      stage.resize();
      if (started) stage.redraw(); // v0.23: the resized (cleared) canvas never shows empty for a frame
    }
  });
  for (const el of [
    container,
    document.querySelector(".mini-hud"),
    document.querySelector(".command-deck"),
    document.querySelector(".bottom-nav"),
    document.getElementById("cards"),
  ])
    if (el) resize.observe(el);
  const scene = () => (started ? arena : null);
  return {
    /** v0.25m: load a match's art before it starts (see Arena.warm); resolves when done. */
    warm(items, progress) {
      return preloaded.then(() => {
        const sc = scene();
        return sc ? sc.warm(items, progress) : [];
      });
    },
    /** v0.15: roll the view to another field (apply switches it). */
    roll(step, info, apply, back) {
      const sc = scene();
      if (!sc) return apply();
      sc.roll(step, info, apply, back);
    },
    /** v0.13: Options › Graphic */
    setPopups(value) {
      Object.assign(popups, value);
    },
    /** v0.23b: Options › Gameplay › Tiles */
    setTiles(mode) {
      if (mode === tileMode) return;
      tileMode = mode;
      const sc = scene();
      if (sc) sc.terrainKey = "";
    },
    destroy() {
      resize.disconnect();
      destroyed = true;
      if (arena.onOutside) window.removeEventListener("pointerup", arena.onOutside);
      stage.disposed = true;
      stage.dispose();
    },
    refresh() {
      measureInsets();
      scene()?.drawTerrain();
    },
    /**
     * v0.24j: frees graphics memory between matches: creep animation sheets and every copy of a picture in a player
     * colour go (they come back from the browser cache when a match needs them again). Towers and scenery stay.
     */
    /** v0.24j: pictures that failed before the art packs were there are asked for again. */
    retryArt() {
      stage.failed?.clear();
    },
    releaseArt() {
      const sc = scene();
      if (!sc || stage.disposed) return 0;
      let n = 0;
      for (const key of [...stage.textures.keys()])
        if (key.startsWith("anim:") || key.includes("#")) {
          stage.dropTexture(key);
          n++;
        }
      for (const [art, byColor] of sc.skinKeys) for (const [cid, tex] of byColor) if (!stage.hasTexture(tex)) byColor.delete(cid);
      return n;
    },
    /** Design variants: swap the figures to the chosen design's art set. */
    switchArt() {
      return scene()?.switchArt?.();
    },
    geometry() {
      return (
        scene()?.geometry() || arenaGeometry(container.clientWidth, container.clientHeight, viewGrid(), getMode(), insets)
      );
    },
    /** A cell's centre in screen pixels of the board container (Mobile Max: after scrolling). */
    cellCenter(gridX, gridY) {
      const grid = getState().grid,
        pt = scene()?.point((gridX + 0.5) / grid.cols, (gridY + 0.5) / grid.rows);
      return pt && { x: pt.x, y: pt.y - (stage.scrollY || 0) };
    },
    gridAt(x, y) {
      return scene()?.toGrid(x, y + (stage.scrollY || 0));
    },
    /** Client coordinates (e.g. a card drag) to a grid cell. */
    gridAtClient(clientX, clientY) {
      const box = container.getBoundingClientRect();
      return scene()?.toGrid(clientX - box.left, clientY - box.top + (stage.scrollY || 0));
    },
    /** Mobile Max: how far the board is scrolled (world y at the top of the screen). */
    scrollY() {
      return stage.scrollY || 0;
    },
  };
}
