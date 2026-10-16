import { getStats, divineShield, isMagicTower, isMeleeTower, towerAt, towerSize, footprintOf, STRIP, HELLFIRE } from "./simulation.js";
import { ART_MANIFEST, ANIM_MANIFEST, animUrl, artFor, artUrl, towerTier, TOWER_ART, CREEP_ART, TEAM_COLORS, recolorTeam } from "./art.js";
import { t } from "./i18n.js";
import { Stage, BLEND, TINT, hsvToColor } from "./b2d.js";

export { artFor, artUrl };

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
        const f = 0.7 + (0.45 * i) / Math.max(1, list.length - 1);
        for (const unit of [s.id, ...(s.spawnIds || [])]) if (!CREEP_SIZE.has(unit)) CREEP_SIZE.set(unit, f);
      });
    }
  }
  return (CREEP_SIZE.get(id) ?? 1) * (SIZE_BOOST[id] || 1);
}
/** Creeps drawn larger than their rank alone would make them. */
const SIZE_BOOST = { n00S: 1.3 }; // tier 1 Raiders
export function arenaGeometry(width, height, grid = { cols: 6, rows: 9 }, mode = "build", insets = { top: 84, bottom: 172 }) {
  const w = Math.max(1, width),
    h = Math.max(1, height),
    logicalCols = grid.cols,
    logicalRows = grid.rows,
    safeTop = Math.max(0, insets.top),
    safeBottom = Math.max(0, insets.bottom),
    frame = 13;
  // A portrait mini map of the other lane sits in its own column right of the board, never over it.
  const pipW = clamp(Math.round(w * 0.1), 34, 60),
    pipH = (pipW * logicalRows) / logicalCols,
    pipGap = 8,
    edge = 6,
    pipReserve = frame + pipGap + pipW + edge,
    // A matching column left of the board holds the auto-spawn slot and the level button.
    sideW = pipW,
    sideGap = 6,
    sideReserve = frame + sideGap + sideW + 4;
  const availableHeight = Math.max(9, h - safeTop - safeBottom - frame * 2),
    byHeight = availableHeight / (logicalRows + STRIP), // v0.09: no exit strip below the board
    twoColumns = Math.min(Math.max(5, w - 2 * (frame + 9)) / logicalCols, Math.max(5, w - sideReserve - pipReserve) / logicalCols, byHeight),
    // Narrow screens (v0.07l): when the width limits the board, one column right of it holds
    // the mini map, the level button and the auto-spawn slot, and the board takes the rest.
    edgeLeft = frame + 5,
    oneColumn = Math.min(Math.max(5, w - edgeLeft - pipReserve) / logicalCols, byHeight),
    compact = oneColumn > twoColumns * 1.02,
    cell = Math.max(1, compact ? oneColumn : twoColumns);
  const bw = cell * logicalCols,
    bh = cell * logicalRows,
    strip = cell * STRIP,
    left = compact ? edgeLeft + Math.max(0, (w - edgeLeft - pipReserve - bw) / 2) : Math.max(sideReserve, Math.min((w - bw) / 2, w - pipReserve - bw)),
    top = safeTop + frame + strip + (availableHeight - bh - strip) / 2;
  const pip = { x: left + bw + frame + pipGap, y: top - strip, w: pipW, h: pipH },
    // compact: the level button sits below the mini map and its label
    side = compact ? { x: pip.x, y: pip.y + pipH + 36, w: pipW, compact: true } : { x: left - frame - sideGap - sideW, y: top - strip, w: sideW };
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
    strip,
    pip,
    side,
  };
}

/** Mini map of the other lane: portrait, in its own column beside the board. */
export function pipGeometry(z) {
  return z.pip;
}

/**
 * Towers draw 5 % smaller than their field. Levels 1–3 stay nearly the same size; from level 4 a
 * figure grows slowly (v0.08a: level 5 now has the size level 3 had, level 7 that of level 5 …).
 */
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
  onPip = () => {},
  onSwipe = () => {},
  onHover = () => {},
  getAim = () => null,
  onTick,
  getPipPlayer = null,
}) {
  /** A lane's colour: the player's choice, else blue for you and red for the other side. */
  const colorOf = (player) => {
    const id = getColors()?.[player];
    return TEAM_COLORS[id] ? id : player === getOwnPlayer() ? "blue" : "red";
  };
  let insets = { top: 84, bottom: 172 };
  function measureInsets() {
    const box = container.getBoundingClientRect(),
      hud = document.querySelector(".mini-hud")?.getBoundingClientRect(),
      dock = document.querySelector(".command-deck")?.getBoundingClientRect();
    insets = {
      top: hud ? Math.max(0, hud.bottom - box.top) + 4 : 84,
      bottom: dock ? Math.max(0, box.bottom - dock.top) + 6 : 172,
    };
  }
  measureInsets();
  // Render at the device's pixel density: the canvas is sized in device pixels and
  // the camera zooms by DPR, so world units stay CSS pixels everywhere else.
  const DPR = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
  const DECO = ["deco-bush", "deco-crate", "deco-crystal", "deco-grass", "deco-mush-purple", "deco-mush-teal", "deco-pine", "deco-rock", "deco-torch"];
  const GRASS = ["tile-grass", "tile-grass-2", "tile-grass-3"];
  // Start fast: only the board itself and two fallback figures load before the arena opens.
  // Every other figure streams in the background right after (entry-level towers first);
  // until a figure has arrived, its base art or a stand-in is drawn.
  const ESSENTIAL = [...GRASS, "tile-path", ...DECO, "tower-archer", "creep-goblin"];
  const FIRST = ["tower-archer-v2", "tower-guard-l1", "tower-cannon-v3", "tower-hall", "tower-arcane-v2", "tower-farm"];
  const BACKGROUND = [
    ...FIRST,
    ...CREEP_ART,
    ...TOWER_ART.filter((k) => !/-(v|l)\d$/.test(k)),
    ...TOWER_ART.filter((k) => /-(v|l)\d$/.test(k)),
  ].filter((k, i, all) => !ESSENTIAL.includes(k) && all.indexOf(k) === i);

  // v0.08: the board is drawn with Babylon.js (see b2d.js), the scene keeps its old shape.
  class Arena {
    constructor(stage) {
      this.stage = stage;
      this.units = new Map();
      this.labels = new Map();
      this.lastView = -1;
      this.lastEvent = 0;
      this.terrainKey = "";
      this.pathKey = "";
      this.press = null;
      this.projectiles = [];
      this.particles = [];
      this.rings = [];
      this.swipes = [];
      this.floaters = [];
      this.textPool = [];
      this.tiles = [];
      this.decos = [];
      this.pathTiles = [];
      this.flash = 0;
      this.gainFlash = 0;
      this.fireflies = Array.from({ length: 18 }, (_, i) => ({ seed: i * 7.31, x: hash(i, 3), y: hash(i, 9) }));
    }
    preload() {
      return Promise.all(ESSENTIAL.map((key) => this.stage.loadImage(key, artUrl(key))));
    }
    /** Queue every remaining figure and animation once the arena is up (six at a time). */
    streamArt() {
      const queue = [...BACKGROUND.map((key) => [key, artUrl(key), 0, 0]), ...Object.entries(ANIM_MANIFEST).map(([key, a]) => [`anim:${key}`, animUrl(key), a.fw, a.fh])];
      const next = () => {
        const item = queue.shift();
        if (item && !this.stage.disposed) this.stage.loadImage(...item).then(next);
      };
      for (let i = 0; i < 6; i++) next();
    }
    /** The art key if its texture has arrived, else the line's base art, else a stand-in. */
    ready(key, kind = "tower") {
      if (this.stage.hasTexture(key)) return key;
      const base = key.replace(/-(v|l)\d$/, "");
      if (this.stage.hasTexture(base)) return base;
      return kind === "creep" ? "creep-goblin" : "tower-archer";
    }
    /**
     * Player colour on tower figures: the art's team-blue cloth stays blue for the viewer's own
     * towers and turns red on the opponent's. Recoloured copies are made once per figure, in the
     * browser, the first time an enemy tower needs them.
     */
    /** The art in a player's colour: team blue moved to that colour's hue (cached per colour). */
    teamTexture(key, colorId) {
      const color = TEAM_COLORS[colorId];
      if (!color || color.hue === null || !this.stage.hasTexture(key)) return key;
      const red = key + "#" + colorId;
      if (this.stage.hasTexture(red)) return red;
      try {
        const src = this.stage.sourceImage(key),
          canvas = document.createElement("canvas");
        canvas.width = src.width;
        canvas.height = src.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(src, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height),
          d = img.data;
        recolorTeam(d, colorId);
        ctx.putImageData(img, 0, 0);
        const anim = Object.values(ANIM_MANIFEST).find((a, i) => `anim:${Object.keys(ANIM_MANIFEST)[i]}` === key);
        if (anim) this.stage.addCanvas(red, canvas, anim.fw, anim.fh);
        else this.stage.addCanvas(red, canvas);
        return this.stage.hasTexture(red) ? red : key;
      } catch (err) {
        console.warn("Team colour not possible for", key, err);
        return key;
      }
    }
    /** Frame animation for an art key, once its sheet has loaded. */
    animFor(artKey) {
      const a = ANIM_MANIFEST[artKey];
      if (!a) return null;
      const tex = `anim:${artKey}`;
      return this.stage.hasTexture(tex) ? { ...a, tex } : null;
    }
    /** Switch a sprite to the given sheet frame without resetting it every draw. */
    showFrame(sprite, tex, frame) {
      if (sprite.texture.key !== tex) sprite.setTexture(tex, frame);
      else if (sprite.frame.name !== frame) sprite.setFrame(frame);
    }
    create() {
      this.streamArt();
      this.bg = this.stage.graphics().setDepth(0);
      this.frameG = this.stage.graphics().setDepth(1);
      this.grout = this.stage.graphics().setDepth(4);
      this.pathLayer = this.stage.graphics().setDepth(5);
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
      const canvas = this.stage.canvas,
        at = (ev) => {
          const box = canvas.getBoundingClientRect();
          return { id: ev.pointerId, x: ev.clientX - box.left, y: ev.clientY - box.top };
        };
      canvas.addEventListener("pointerdown", (ev) => {
        if ((ev.button ?? 0) > 0) return; // right and middle clicks never build (v0.09f)
        const p = at(ev);
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
          if (!press.swiping && Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.3) press.swiping = true;
          if (press.swiping) this.stage.slideX = clamp(dx * 0.45, -this.stage.width * 0.3, this.stage.width * 0.3);
          if (ev.pointerType === "mouse") onHover(null);
          return;
        }
        this.pointer = { x: p.x, y: p.y, at: performance.now() };
        if (ev.pointerType === "mouse" || ev.pointerType === "pen") {
          const state = getState(),
            pos = this.toGrid(p.x, p.y),
            inside = state && pos.gridX >= 0 && pos.gridX < state.grid.cols && pos.gridY >= 0 && pos.gridY < state.grid.rows;
          onHover(inside ? pos : null);
        }
      });
      canvas.addEventListener("pointerleave", () => onHover(null));
      canvas.addEventListener("pointerup", (ev) => {
        const p = at(ev);
        const press = this.press;
        this.press = null;
        const state = getState();
        if (press && press.id === p.id) {
          const dx = p.x - press.x,
            dy = p.y - press.y,
            quick = performance.now() - press.t < 700;
          if (press.swiping || (quick && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3)) {
            const step = dx < 0 ? 1 : -1,
              changed = Math.abs(dx) > 44 && onSwipe(step);
            this.slideFrom(changed ? (dx < 0 ? this.stage.width * 0.32 : -this.stage.width * 0.32) : this.stage.slideX || 0);
            return;
          }
          if (this.stage.slideX) this.slideFrom(this.stage.slideX);
        }
        if (!press || press.id !== p.id || press.seed !== state?.seed || Math.hypot(p.x - press.x, p.y - press.y) > 12) return;
        const r = pipGeometry(this.geometry());
        if (p.x >= r.x - 6 && p.x <= r.x + r.w + 6 && p.y >= r.y - 6 && p.y <= r.y + r.h + 12) {
          onPip();
          return;
        }
        if (getMode() !== "build" || press.view !== getViewPlayer()) return;
        const pos = this.toGrid(p.x, p.y);
        if (pos.gridX < 0 || pos.gridX >= state.grid.cols || pos.gridY < 0 || pos.gridY >= state.grid.rows) return;
        const z = this.geometry();
        pos.fx = (p.x - z.left) / z.bw; // exact point on the board, as a share (v0.09q: volley aim)
        pos.fy = (p.y - z.top) / z.bh;
        const player = state.players[getViewPlayer()],
          tower = towerAt(player, pos.gridX, pos.gridY);
        if (tower) onTower(tower, ev.timeStamp, pos);
        else onCell(pos);
      });
      // a release outside the board, or a cancelled touch, never counts as a tap
      this.onOutside = (ev) => {
        if (ev.target !== canvas) this.press = null;
      };
      window.addEventListener("pointerup", this.onOutside);
      canvas.addEventListener("pointercancel", () => {
        this.press = null;
        if (this.stage.slideX) this.slideFrom(this.stage.slideX);
      });
    }
    /** Ease the board back from a sideways offset (after a swipe or a cancelled drag). */
    slideFrom(offset) {
      this.slide = { from: offset, t0: performance.now(), ms: 200 };
      this.stage.slideX = offset;
    }
    stepSlide() {
      const s = this.slide;
      if (!s) return;
      const k = clamp((performance.now() - s.t0) / s.ms, 0, 1),
        e = 1 - Math.pow(1 - k, 3);
      this.stage.slideX = s.from * (1 - e);
      if (k >= 1) {
        this.slide = null;
        this.stage.slideX = 0;
      }
    }
    geometry() {
      return arenaGeometry(this.stage.width, this.stage.height, getState()?.grid, getMode(), insets);
    }
    point(x, y) {
      const z = this.geometry();
      return { x: z.left + x * z.bw, y: z.top + y * z.bh };
    }
    toGrid(x, y) {
      const z = this.geometry(),
        u = (x - z.left) / z.bw,
        v = (y - z.top) / z.bh;
      return { gridX: Math.floor(u * z.logicalCols), gridY: Math.floor(v * z.logicalRows) };
    }
    keyFor(z) {
      return [z.w, z.h, z.left, z.top, z.bw, z.bh, z.logicalCols, z.logicalRows].join(":");
    }
    // ---- static scenery ---------------------------------------------------------
    drawTerrain() {
      if (!this.bg) return;
      const z = this.geometry(),
        g = this.bg,
        f = this.frameG,
        cell = z.cw;
      g.clear();
      // Night forest around the arena.
      g.fillGradientStyle(0x0d2a2a, 0x0d2a2a, 0x081815, 0x081815, 1);
      g.fillRect(0, 0, z.w, z.h);
      for (let i = 0; i < 46; i++) {
        const x = hash(i, 1) * z.w,
          y = hash(i, 2) * z.h,
          s = 18 + hash(i, 4) * 26,
          shade = [0x0f3330, 0x123b33, 0x0b2622][i % 3];
        g.fillStyle(shade, 0.95);
        g.fillTriangle(x, y - s * 1.6, x - s * 0.7, y, x + s * 0.7, y);
        g.fillTriangle(x, y - s * 2.2, x - s * 0.5, y - s * 0.8, x + s * 0.5, y - s * 0.8);
      }
      for (let i = 0; i < 26; i++) {
        const x = hash(i, 11) * z.w,
          y = hash(i, 12) * z.h,
          c = i % 2 ? 0x46e0d0 : 0xb06cff;
        g.fillStyle(c, 0.16);
        g.fillCircle(x, y, 7);
        g.fillStyle(c, 0.75);
        g.fillEllipse(x, y, 5, 3);
      }
      // Wall frame in the lane owner's colour, bricks a little brighter and darker.
      f.clear();
      const L = z.left - z.frame,
        T = z.top - z.strip - z.frame,
        W = z.bw + z.frame * 2,
        H = z.bh + z.strip + z.frame * 2,
        wall = TEAM_COLORS[colorOf(getViewPlayer())].hex,
        tint = (k) => mixColor(0x46525a, wall, 0.8, k * 0.82);
      f.fillStyle(0x05110f, 0.6);
      f.fillRoundedRect(L - 4, T + 2, W + 8, H + 8, 14);
      f.fillStyle(tint(0.62));
      f.fillRoundedRect(L, T, W, H, 12);
      const block = z.frame * 1.6;
      for (const side of ["top", "bottom", "left", "right"]) {
        const horizontal = side === "top" || side === "bottom",
          len = horizontal ? W : H,
          n = Math.ceil(len / block);
        for (let i = 0; i < n; i++) {
          const tone = [tint(0.9), tint(0.78), tint(1), tint(0.72)][Math.floor(hash(i, side.length) * 4)];
          f.fillStyle(tone);
          if (horizontal) f.fillRoundedRect(L + i * block + 1, side === "top" ? T + 1 : T + H - z.frame + 1, block - 2, z.frame - 3, 3);
          else f.fillRoundedRect(side === "left" ? L + 1 : L + W - z.frame + 1, T + i * block + 1, z.frame - 3, block - 2, 3);
        }
      }
      f.lineStyle(2, tint(0.3), 0.9);
      f.strokeRoundedRect(L, T, W, H, 12);
      f.lineStyle(1, tint(1.5), 0.35);
      f.strokeRoundedRect(L + 2, T + 2, W - 4, H - 4, 10);
      // Inner board drop shadow.
      f.fillStyle(0x0a1412, 0.7);
      f.fillRect(z.left - 2, z.top - z.strip - 2, z.bw + 4, z.bh + z.strip + 4);
      this.braziers = [];
      for (const yy of [1.5, 4.5, 7.5])
        for (const xx of [L + z.frame / 2, L + W - z.frame / 2]) {
          const y = z.top + yy * cell;
          f.fillStyle(0x24292d);
          f.fillEllipse(xx, y + 3, z.frame * 1.25, z.frame * 0.7);
          f.fillStyle(0x6b5032);
          f.fillEllipse(xx, y, z.frame * 1.05, z.frame * 0.55);
          this.braziers.push({ x: xx, y: y - 2, seed: xx * 0.01 + yy });
        }
      // Grass and plaza tiles, rotated per cell so the texture never looks tiled.
      for (const t of this.tiles) t.destroy();
      this.tiles = [];
      for (let y = 0; y < z.logicalRows; y++)
        for (let x = 0; x < z.logicalCols; x++) {
          const plaza = false, // every row is buildable meadow now
            r = hash(x, y),
            grass = GRASS[Math.floor(hash(x, y, 13) * GRASS.length)],
            img = this.stage
              .image(z.left + (x + 0.5) * cell, z.top + (y + 0.5) * cell, plaza ? "tile-path" : grass)
              .setDisplaySize(cell + 0.6, cell + 0.6)
              .setAngle(Math.floor(r * 4) * 90)
              .setDepth(2);
          img.setFlipX(hash(y, x, 5) > 0.5);
          img.setTint(plaza ? 0x9c958e : [0xe9f1df, 0xdfe9d3, 0xf2f6e8, 0xe4edd9][Math.floor(hash(x, y, 2) * 4)]);
          this.tiles.push(img);
        }
      // Meadow detail and scenery: tufts under the path layer, props in the plaza corners
      // and around the wall, so the board never reads as one flat green.
      for (const d of this.decos) d.destroy();
      this.decos = [];
      const deco = (key, x, y, size, depth, alpha = 1) => {
        const img = this.stage.image(x, y, key).setOrigin(0.5, 0.9).setDepth(depth).setAlpha(alpha);
        img.setScale(size / Math.max(img.width, img.height)).setFlipX(hash(x, y, 3) > 0.5);
        this.decos.push(img);
        return img;
      };
      for (let y = 0; y < z.logicalRows; y++)
        for (let x = 0; x < z.logicalCols; x++) {
          const r = hash(x, y, 21);
          if (r > 0.42) continue;
          const key = r < 0.06 ? "deco-mush-teal" : r < 0.1 ? "deco-mush-purple" : "deco-grass";
          deco(key, z.left + (x + 0.2 + hash(x, y, 22) * 0.6) * cell, z.top + (y + 0.35 + hash(x, y, 23) * 0.5) * cell, cell * (key === "deco-grass" ? 0.34 : 0.26), 2.5, 0.92);
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
      for (const [key, x, y] of outside) deco(key, x, y, cell * (key === "deco-pine" ? 0.9 : 0.55), 1.5);
      // Grout between tiles.
      const gr = this.grout;
      gr.clear();
      for (let i = 0; i <= z.logicalCols; i++) {
        gr.lineStyle(2, 0x1b2a1c, 0.55);
        gr.lineBetween(z.left + i * cell, z.top, z.left + i * cell, z.top + z.bh);
        gr.lineStyle(1, 0xd8f0b0, 0.12);
        gr.lineBetween(z.left + i * cell + 1.5, z.top, z.left + i * cell + 1.5, z.top + z.bh);
      }
      for (let j = 0; j <= z.logicalRows; j++) {
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
    }
    /** Spawn strip: a row of quarter-height portal fields above the board. */
    drawStrips(z) {
      const g = this.strips,
        cell = z.cw,
        sh = z.strip,
        top = z.top - sh,
        bottom = z.top + z.bh;
      g.clear();
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
      const path = player.path || [],
        frozen = (player.perks?.permafrost || 0) > 0, // v0.10o: Permafrost turns the path to frozen ground
        key = path.map((p) => p.gridX + "," + p.gridY).join(";") + "|" + this.terrainKey + (frozen ? "|ice" : "");
      if (key === this.pathKey) return;
      this.pathKey = key;
      const cell = z.cw;
      let i = 0;
      for (const p of path) {
        if (p.gridY < 0 || p.gridY >= z.logicalRows) continue; // strips are not tiled
        let img = this.pathTiles[i];
        if (!img) {
          img = this.stage.image(0, 0, "tile-path").setDepth(3);
          this.pathTiles.push(img);
        }
        img
          .setVisible(true)
          .setPosition(z.left + (p.gridX + 0.5) * cell, z.top + (p.gridY + 0.5) * cell)
          .setDisplaySize(cell + 0.6, cell + 0.6)
          .setAngle(Math.floor(hash(p.gridX, p.gridY, 7) * 4) * 90)
          .setTint(frozen ? [0x8fc4f0, 0x9acbf2, 0x86bdea, 0x94c8f0][Math.floor(hash(p.gridX, p.gridY, 9) * 4)] : 0xffffff);
        // v0.10o: Permafrost: a pale ice sheen over the same tile
        let ice = this.iceTiles?.[i];
        if (frozen && !ice) {
          (this.iceTiles ||= [])[i] = ice = this.stage.image(0, 0, "tile-path").setDepth(3.5).setTintMode(TINT.FILL);
        }
        if (ice)
          ice
            .setVisible(frozen)
            .setPosition(z.left + (p.gridX + 0.5) * cell, z.top + (p.gridY + 0.5) * cell)
            .setDisplaySize(cell + 0.6, cell + 0.6)
            .setAngle(Math.floor(hash(p.gridX, p.gridY, 7) * 4) * 90)
            .setTint(0xc8ecff)
            .setAlpha(0.26 + 0.1 * hash(p.gridX, p.gridY, 11));
        i++;
      }
      for (let k = i; k < (this.iceTiles?.length || 0); k++) this.iceTiles[k]?.setVisible(false);
      for (; i < this.pathTiles.length; i++) this.pathTiles[i].setVisible(false);
    }
    // ---- pooled floating text -----------------------------------------------------
    floatText(x, y, text, color = "#ffe27a", size = 15, rise = 34, life = 0.9) {
      if (this.floaters.length > 36) this.recycle(this.floaters.shift());
      const t =
        this.textPool.pop() ||
        this.stage.text(0, 0, "", { fontFamily: FONT, stroke: "#14231e", strokeThickness: 5, resolution: DPR }).setOrigin(0.5, 1).setDepth(6000);
      t.setText(text).setColor(color).setFontSize(size).setPosition(x, y).setAlpha(1).setScale(0.6).setVisible(true);
      this.floaters.push({ t, x, y, rise, life, max: life });
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
          if (def?.fields?.ua1w === "normal") {
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
              dur: clamp(d / (cell * 10), 0.07, 0.34),
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
          } else if (e.kind === "waterblock") {
            this.floatText(q.x, q.y - cell * 0.6, t("BLOCKED"), "#9ee0ff", 13, 34, 1.1);
            this.ring(q.x, q.y, cell * 0.2, cell * 1.1, 0x7fd0ff, 0.8, 4);
          } else if (e.kind === "pocks") {
            this.floatText(q.x, q.y - cell * 0.6, t("POCKS"), "#b8ff6a", 12, 30, 1);
            this.burst(q.x, q.y - cell * 0.3, 0x9cff4a, 10, 60, 2.4, 0.6, -20, true);
          } else if (e.kind === "crowd") this.floatText(q.x, q.y - cell * 0.55, t("CULLED"), "#ff9a5a", 12, 30, 0.9);
          else if (e.kind === "miss") this.floatText(q.x, q.y - cell * 0.5, t("DODGED"), "#c9d4dc", 11, 26, 0.7);
          else if (e.kind === "bloodlust") this.floatText(q.x, q.y - cell * 0.8, t("BLOODLUST"), "#ff8a7a", 11, 26, 0.9);
          else if (e.kind === "raise") this.floatText(q.x, q.y - cell * 0.8, t("+{n} INCOME", { n: e.amount }), "#b8ff8a", 12, 30, 1.1);
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
          const to = this.point(e.x, e.y),
            drift = (hash(seq, 3) - 0.5) * cell * 0.6;
          this.projectiles.push({ x0: to.x + drift - cell * 0.5, y0: to.y - cell * 2.6, targetId: e.targetId, tx: to.x + drift * 0.2, ty: to.y - cell * 0.15, t: 0, dur: 0.26, color: 0xffe28a, size: 3.6, splash: false, glow: false, arc: 0, arrow: true });
        } else if (e.type === "burst" && e.player === view) {
          // v0.10p: Arcane Burst: violet shock ring over the whole area
          const q = this.point(e.x, e.y);
          this.ring(q.x, q.y, cell * 0.2, cell * e.radius, 0xc07aff, 0.85, 5);
          this.ring(q.x, q.y, cell * 0.1, cell * e.radius * 0.7, 0xf0d8ff, 0.7, 3);
          this.burst(q.x, q.y, 0xd8a8ff, 18, 140, 3, 0.6, 0, true);
          if (e.hits) this.floatText(q.x, q.y - cell * 0.6, t("ARCANE BURST") + " " + e.damage, "#e2c2ff", 14, 38, 1.1);
        } else if (e.type === "volleyStart" && e.player === view) {
          const q = this.point(e.x, e.y);
          this.ring(q.x, q.y, cell * 0.3, cell * 1.5, 0xffe7a8, 0.6, 3);
        } else if (e.type === "kill" && e.player === view) {
          const q = this.point(e.x, e.y),
            def = catalog.byId[e.id],
            big = !!def?.bossTier;
          this.burst(q.x, q.y - cell * 0.2, 0xf7f1dd, big ? 18 : 9, big ? 120 : 75, big ? 3.6 : 2.6, big ? 0.7 : 0.45);
          this.burst(q.x, q.y - cell * 0.2, 0xb48cff, big ? 10 : 5, 55, 2.4, 0.55, -30, true);
          this.ring(q.x, q.y, cell * 0.1, cell * (big ? 0.9 : 0.45), 0xfff6d5, big ? 0.5 : 0.3, big ? 4 : 2);
          if (e.bounty > 0) this.floatText(q.x, q.y - cell * 0.45, `+${Math.round(e.bounty)}`, "#ffe27a", big ? 20 : 15);
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
          }
        } else if (e.type === "built" && e.player === view) {
          const tower = lane.towers.find((t) => t.id === e.towerId);
          if (tower) {
            const q = this.point(tower.x, tower.y);
            this.burst(q.x, q.y - cell * 0.4, 0xfff3b0, 9, 55, 2.2, 0.45, -20, true);
            this.ring(q.x, q.y + cell * 0.12, cell * 0.25, cell * 0.6, 0x7fdcff, 0.45, 3);
          }
        } else if (e.type === "sell" && e.player === view) {
          const tower = lane.towers.find((t) => t.id === e.towerId);
          if (tower) {
            const q = this.point(tower.x, tower.y);
            this.burst(q.x, q.y, 0xd9c79a, 12, 70, 2.6, 0.5);
            if (e.refund > 0) this.floatText(q.x, q.y - cell * 0.3, `+${e.refund}`, "#ffe27a", 16);
          }
        }
      }
    }
    update(time, delta) {
      const dt = Math.min(delta / 1000, 0.1);
      this.stepSlide();
      onTick(dt);
      const game = getState();
      if (!game) return;
      if (this.gameSeed !== game.seed || game.eventId < this.lastEvent) {
        this.gameSeed = game.seed;
        this.lastEvent = game.eventId || 0;
        this.clearFx();
      }
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
      for (const f of this.fireflies) {
        const x = (f.x * z.w + Math.sin(time * 0.0004 + f.seed) * 40 + z.w) % z.w,
          y = (f.y * z.h + Math.cos(time * 0.0003 + f.seed * 2) * 30 + z.h) % z.h,
          a = 0.35 + 0.35 * Math.sin(time * 0.003 + f.seed * 5);
        glow.fillStyle(0xd8ff8a, a * 0.35);
        glow.fillCircle(x, y, 4);
        glow.fillStyle(0xf4ffc8, a);
        glow.fillCircle(x, y, 1.4);
      }
      // ---- v0.10p: Hellfire (v0.10q: 6th row): free fields of the burning row glow like magma
      if ((player.perks?.hellfire || 0) > 0) {
        const y = HELLFIRE.row;
        for (let col = 0; col < z.logicalCols; col++) {
          if (towerAt(player, col, y)) continue;
          const x0 = z.left + col * cell,
            y0 = z.top + y * cell,
            flick = 0.5 + 0.5 * Math.sin(time * 0.004 + col * 1.7);
          pl.fillStyle(0x2a0802, 0.7);
          pl.fillRect(x0 + 1, y0 + 1, cell - 2, cell - 2);
          pl.fillStyle(0xff4a0a, 0.55 + 0.2 * flick);
          pl.fillRoundedRect(x0 + cell * 0.12, y0 + cell * 0.12, cell * 0.76, cell * 0.76, cell * 0.22);
          pl.fillStyle(0xffd24a, 0.6 + 0.3 * flick);
          for (let k = 0; k < 3; k++) {
            const bx = x0 + cell * (0.22 + 0.56 * hash(col, y, 20 + k)),
              by = y0 + cell * (0.22 + 0.56 * hash(y, col, 30 + k)),
              br = cell * (0.05 + 0.05 * hash(k, col, 40)) * (0.7 + 0.5 * Math.sin(time * 0.006 + k * 2 + col));
            pl.fillCircle(bx, by, Math.max(1, br));
          }
          pl.lineStyle(2, 0xffe08a, 0.35 + 0.3 * flick);
          pl.lineBetween(x0 + cell * 0.2, y0 + cell * 0.35, x0 + cell * 0.5, y0 + cell * 0.55);
          pl.lineBetween(x0 + cell * 0.5, y0 + cell * 0.55, x0 + cell * 0.78, y0 + cell * 0.42);
          pl.lineBetween(x0 + cell * 0.5, y0 + cell * 0.55, x0 + cell * 0.46, y0 + cell * 0.82);
        }
      }
      // ---- route flow on the dirt tiles
      const path = player.path || [];
      if (path.length) {
        const pts = path.map((p) => this.point(p.x, p.y));
        this.chevrons(pl, pts, time, cell, 0x4a3018, preview?.ok ? 0.18 : 0.38);
      }
      // ---- placement aids
      if (selected?.towerId) {
        const t = player.towers.find((t) => t.id === selected.towerId);
        if (t) {
          const q = this.point(t.x, t.y),
            r = (getStats(game, view, t.typeId).range / game.grid.cellUnits) * z.cw;
          this.drawReach(g, catalog.byId[t.typeId], q, r, z.cw, towerSize(t));
          const pulse = 0.5 + 0.5 * Math.sin(time * 0.008);
          const sc = cell * towerSize(t);
          g.lineStyle(3, 0xffe47a, 0.55 + pulse * 0.4);
          g.strokeEllipse(q.x, q.y + sc * 0.12, sc * 0.98, sc * 0.5);
        }
      } else if (selected && view === selected.player) {
        for (let y = 0; y < z.logicalRows; y++)
          for (let x = 0; x < z.logicalCols; x++) {
            if (towerAt(player, x, y)) continue;
            const q = this.point((x + 0.5) / z.logicalCols, (y + 0.5) / z.logicalRows);
            g.lineStyle(1.5, 0xf6f0c0, 0.35 + 0.15 * Math.sin(time * 0.006 + x + y));
            g.strokeRoundedRect(q.x - cell / 2 + 4, q.y - cell / 2 + 4, cell - 8, cell - 8, 6);
          }
      }
      // v0.09q: Arrow Volley aim — the area follows the pointer
      const aim = getAim();
      if (aim && this.pointer) {
        const r = aim.radius * cell,
          px = this.pointer.x,
          py = this.pointer.y,
          pulse = 0.5 + 0.5 * Math.sin(time * 0.01);
        const ac = aim.arcane ? 0xc07aff : 0xffd27a,
          al = aim.arcane ? 0xeacbff : 0xffe7a8; // v0.10p: violet for Arcane Burst
        g.fillStyle(ac, 0.12 + 0.06 * pulse);
        g.fillCircle(px, py, r);
        g.lineStyle(2.5, al, 0.85);
        g.strokeCircle(px, py, r);
        g.lineStyle(1.5, al, 0.6);
        g.lineBetween(px - 8, py, px + 8, py);
        g.lineBetween(px, py - 8, px, py + 8);
      }
      this.drawQueued(game, view, getQueued(), catalog, z, time);
      this.drawPreview(game, view, preview, catalog, z, time);
      // ---- towers: figures on their pedestals
      const alive = new Set(),
        team = TEAM_COLORS[colorOf(view)].hex;
      for (const t of player.towers) {
        const tc = cell * towerSize(t); // a 2×2 hall draws at twice the size
        const def = catalog.byId[t.typeId || t.unitId || t.defId || t.type || t.id];
        if (!def) continue;
        const key = `${view}:t:${t.id}`,
          q = this.point(t.x, t.y),
          artKey = this.ready(artFor(def)),
          m = ART_MANIFEST[artKey],
          skin = this.teamTexture(artKey, colorOf(view));
        alive.add(key);
        let sprite = this.units.get(key);
        const baseAnim = this.animFor(artKey),
          anim = baseAnim && TEAM_COLORS[colorOf(view)].hue !== null ? { ...baseAnim, tex: this.teamTexture(baseAnim.tex, colorOf(view)) } : baseAnim;
        if (!sprite) {
          sprite = this.stage.image(q.x, q.y, anim ? anim.tex : skin, anim ? 0 : undefined);
          this.units.set(key, sprite);
        }
        const building = (t.buildRemaining || 0) > 0,
          // Higher levels of the same figure stand a little taller on a slightly larger pedestal.
          base = ((tc * 0.98 * TOWER_SCALE) / m.plateW) * levelScale(def.level || 1),
          phase = (parseInt(String(t.id).replace(/\D/g, ""), 10) || 0) * 1.7;
        const popT = sprite.getData("pop") ? clamp((time - sprite.getData("pop")) / 280, 0, 1) : 1,
          pop = popT < 1 ? 0.5 + 0.5 * this.backOut(popT) : 1,
          recoil = 0,
          breathe = Math.sin(time * 0.0032 + phase) * 0.014;
        // v0.09: every figure without its own frame animation acts out each attack (see attackPose)
        const pose = !anim && !building ? this.attackPose(def, sprite, time) : null;
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
          this.showFrame(sprite, anim.tex, frame);
        } else if (sprite.texture.key !== skin) sprite.setTexture(skin);
        sprite
          .setOrigin(anim ? (m.plateCX + anim.ox) / anim.fw : m.plateCX / m.w, anim ? (m.plateCY + anim.oy) / anim.fh : m.plateCY / m.h)
          .setPosition(cx, cy - recoil * tc * 0.03)
          .setScale(base * pop * (1 + recoil * 0.05), base * pop * (1 + breathe + recoil * 0.07))
          .setFlipX(false)
          .setDepth(Math.floor(cy) + 100)
          .setAlpha(building ? 0.55 : 1);
        if (t.curse && t.curse.until > game.time) sprite.setTint(0xd2b0ff).setTintMode(TINT.MULTIPLY);
        else sprite.clearTint();
        // team glow under the pedestal
        glow.fillStyle(team, 0.16);
        glow.fillEllipse(cx, cy + tc * 0.06, tc * 1.0, tc * 0.5);
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
        const tier = towerTier(def);
        if (tier >= 4 && !building) {
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
        this.levelBadge(key, level, cx - tc * 0.36, cy + tc * 0.2, Math.floor(cy) + 101, BADGE_COLORS[def.element] || BADGE_COLORS.neutral);
      }
      // ---- disease clouds
      for (const cl of game.clouds || []) {
        if (cl.lane !== view) continue;
        const q = this.point(cl.x, cl.y),
          r = (cl.radius / game.grid.cellUnits) * cell,
          fade = Math.min(1, cl.remaining / 0.6),
          [base, spark] = cl.kind === "fire" ? [0xff6a20, 0xffc060] : cl.kind === "ice" ? [0x6ab8ff, 0xe0f4ff] : [0x7fd23a, 0xb8ff6a];
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
      // ---- creeps
      for (const c of player.creeps) {
        if (c.hp <= 0) continue;
        const def = catalog.byId[c.typeId || c.unitId || c.defId || c.type];
        if (!def) continue;
        const key = `${view}:c:${c.id}`,
          phase0 = parseInt(String(c.id).replace(/\D/g, ""), 10) || 0,
          raw = this.point(c.x, c.y),
          // Render-only spread so a group reads as several units, not one blob.
          q = { x: raw.x + ((((phase0 * 37) % 7) - 3) / 3) * cell * 0.14, y: raw.y + ((((phase0 * 53) % 5) - 2) / 2) * cell * 0.1 },
          artKey = this.ready(artFor(def), "creep"),
          m = ART_MANIFEST[artKey];
        alive.add(key);
        let sprite = this.units.get(key);
        const walk = this.animFor(artKey);
        if (!sprite) {
          sprite = this.stage.image(q.x, q.y, walk ? walk.tex : artKey, walk ? 0 : undefined);
          sprite.setData("hp", c.hp).setData("px", q.x);
          this.units.set(key, sprite);
        }
        const boss = !!(def.bossTier || c.waveBoss),
          flying = !!(c.flying ?? def.flying),
          neutral = c.owner < 0,
          height = cell * (boss ? 1.3 : (flying ? 0.82 : 0.78) * (neutral ? 1 : creepSize(catalog, def.id))),
          s = (height / m.h) * (1 - 0.12 * (c.shrink || 0)),
          step = time * 0.016 + phase0;
        const lift = flying ? cell * 0.32 + Math.sin(time * 0.006 + phase0) * cell * 0.05 : walk ? 0 : Math.abs(Math.sin(step)) * cell * 0.05;
        const dx = q.x - (sprite.getData("px") ?? q.x);
        if (Math.abs(dx) > 0.35) sprite.setData("face", dx < 0 ? -1 : 1);
        sprite.setData("px", q.x);
        if (c.hp < (sprite.getData("hp") ?? c.hp) - 0.01 && time - (sprite.getData("flashAt") || 0) > 170)
          sprite.setData("flashAt", time).setData("hit", time + 55);
        sprite.setData("hp", c.hp);
        const statuses = c.statuses || [],
          slowed = statuses.some((st) => st.slow > 0 && !st.poison),
          poisoned = statuses.some((st) => st.poison || st.dps > 0);
        if (walk) {
          // Walk cycle runs with the creep's pace; stunned or rooted creeps freeze mid-step.
          const stuck = statuses.some((st) => st.stun || st.abilityId === "entangle"),
            rate = stuck ? 0 : clamp((c.speed || 270) / 270, 0.45, 2.2) * (slowed ? 0.6 : 1),
            last = sprite.getData("wt") ?? time,
            clock = (sprite.getData("wc") ?? phase0 * 97) + Math.min(100, time - last) * rate;
          sprite.setData("wt", time).setData("wc", clock);
          this.showFrame(sprite, walk.tex, Math.floor(clock / walk.ms) % walk.frames);
        } else if (sprite.texture.key !== artKey) sprite.setTexture(artKey);
        if ((sprite.getData("hit") || 0) > time) sprite.setTint(0xffffff).setTintMode(TINT.FILL);
        else {
          sprite.setTintMode(TINT.MULTIPLY);
          if (divineShield(game, c)) sprite.setTint(0xfff2b0);
          else if (statuses.some((st) => st.abilityId === "entangle")) sprite.setTint(0xa8ff9a);
          else if (statuses.some((st) => st.stun)) sprite.setTint(0xfff3a0);
          else if (slowed) sprite.setTint(0x9fd8ff);
          else if (poisoned) sprite.setTint(0xc4f59a);
          else if (c.immune) sprite.setTint(0xe2d2ff);
          else if (c.burning) sprite.setTint(0xffa060); // v0.10w: Burning Treant
          else sprite.clearTint();
        }
        const flap = flying ? 1 + Math.sin(time * 0.03 + phase0) * 0.05 : 1;
        sprite
          .setOrigin(walk ? (m.w / 2 + walk.ox) / walk.fw : 0.5, walk ? (m.footY + walk.oy) / walk.fh : m.footY / m.h)
          .setPosition(q.x, q.y + cell * 0.18 - lift)
          .setScale(s * (sprite.getData("face") === -1 ? -1 : 1), s * flap)
          .setRotation(flying || walk ? 0 : Math.sin(step) * 0.07)
          .setDepth(3000 + Math.floor(q.y) + (flying ? 1200 : 0)); // creeps always draw in front of towers
        g.fillStyle(0x06120e, flying ? 0.22 : 0.32);
        g.fillEllipse(q.x, q.y + cell * 0.2, cell * (boss ? 0.8 : 0.48), cell * (boss ? 0.28 : 0.17));
        if (divineShield(game, c)) {
          glow.fillStyle(0xffe680, 0.18 + 0.08 * Math.sin(time * 0.01));
          glow.fillCircle(q.x, q.y - height * 0.45, height * 0.6);
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
        if (neutral) {
          // Neutral wave monsters stand on a violet rune ring so they read apart from sends.
          g.lineStyle(2, c.immune ? 0xf2e6ff : 0xa070ff, 0.75);
          g.strokeEllipse(q.x, q.y + cell * 0.2, cell * (boss ? 0.86 : 0.52), cell * (boss ? 0.3 : 0.19));
        }
        // Health bar only once a creep has lost health; drawn on top of everything on the board.
        const ratio = clamp(c.hp / (c.maxHp || def.hp), 0, 1);
        if (ratio < 0.999) {
          const hb = this.hpBars,
            bar = boss ? cell * 0.95 : cell * 0.55,
            barH = boss ? 6 : 4,
            barY = q.y + cell * 0.18 - lift - height - 6;
          hb.fillStyle(0x0b1512, 0.9);
          hb.fillRoundedRect(q.x - bar / 2 - 1.5, barY - 1.5, bar + 3, barH + 3, 3);
          hb.fillStyle(ratio > 0.5 ? 0x8ff05a : ratio > 0.25 ? 0xffc75a : 0xff5f52);
          hb.fillRoundedRect(q.x - bar / 2, barY, Math.max(1, bar * ratio), barH, 2);
        }
      }
      for (const [key, s] of this.units)
        if (!alive.has(key)) {
          s.destroy();
          this.units.delete(key);
          this.labels.get(key)?.destroy();
          this.labels.delete(key);
        }
      this.consumeEvents(game, view, own, catalog, z, time);
      this.drawFx(game, player, dt, cell);
      this.drawPip(game, view, own, z, catalog, time);
      this.drawVignette(z, dt);
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
        const a = (def.abilities || []).map((id) => catalog.abilities[id]).find((x) => x?.baseId === "AIcf");
        const r = a ? Number(a.fields?.aare?.[1] ?? a.fields?.aare?.[0] ?? 192) : 0;
        this.burnCache.set(def.id, r);
      }
      return this.burnCache.get(def.id);
    }
    levelBadge(key, level, x, y, depth, color = BADGE_COLORS.neutral) {
      let label = this.labels.get(key);
      if (!label) {
        label = this.stage
          .text(0, 0, "", { fontFamily: FONT, fontSize: "11px", color: "#ffffff", stroke: "#0b0f14", strokeThickness: 3, backgroundColor: color, resolution: DPR })
          .setPadding(3, 0, 3, 1)
          .setOrigin(0.5);
        this.labels.set(key, label);
      }
      if (label.getData("bg") !== color) label.setBackgroundColor(color).setData("bg", color);
      label.setText(String(level)).setPosition(x, y).setDepth(depth).setVisible(true);
    }
    chevrons(g, pts, time, cell, color, alpha) {
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
          q = this.point((qd.gridX + fp / 2) / z.logicalCols, (qd.gridY + fp / 2) / z.logicalRows),
          cell = z.cw * fp;
        if (!def) return img.setVisible(false);
        const artKey = this.ready(artFor(def)),
          m = ART_MANIFEST[artKey];
        img
          .setTexture(this.teamTexture(artKey, colorOf(getOwnPlayer())))
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
        q = this.point((preview.gridX + fp / 2) / z.logicalCols, (preview.gridY + fp / 2) / z.logicalRows),
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
        const artKey = this.ready(artFor(def)),
          m = ART_MANIFEST[artKey],
          s = ((cell * 0.98 * TOWER_SCALE) / m.plateW) * levelScale(def.level || 1);
        this.ghost
          .setTexture(this.teamTexture(artKey, colorOf(getOwnPlayer())))
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
    drawFx(game, player, dt, cell) {
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
          const q = this.point(target.x, target.y);
          p.tx = q.x;
          p.ty = q.y - cell * 0.2;
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
          this.particles.splice(i, 1);
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
        fl.t
          .setPosition(fl.x, fl.y - fl.rise * (1 - Math.pow(1 - k, 2)))
          .setScale(k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - Math.min(0.1, (k - 0.15) * 0.4))
          .setAlpha(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
      }
    }
    drawPip(game, view, own, z, catalog, time) {
      const g = this.pip,
        other = getPipPlayer ? getPipPlayer() : 1 - view,
        lane = game.players[other],
        r = pipGeometry(z),
        { cols, rows } = game.grid;
      g.clear();
      // Portrait, same orientation as the main board.
      const sx = r.w / cols,
        sy = r.h / rows,
        P = (nx, ny) => ({ x: r.x + nx * r.w, y: r.y + ny * r.h });
      g.fillStyle(0x0a1a22, 0.92);
      g.fillRoundedRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8, 8);
      g.fillStyle(0x3f7a3a, 1);
      g.fillRect(r.x, r.y, r.w, r.h);
      g.fillStyle(0x8a4dff, 0.9);
      g.fillRect(r.x, r.y, r.w, Math.max(2, sy * 0.25));
      const path = lane.path || [];
      if (path.length > 1) {
        g.lineStyle(Math.max(2, sx * 0.5), 0xb08a5a, 1);
        g.beginPath();
        path.forEach((p, i) => {
          const q = P(p.x, p.y);
          i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y);
        });
        g.strokePath();
      }
      for (const t of lane.towers) {
        const q = P(t.x, t.y);
        g.fillStyle(0x163a4a, 1);
        g.fillCircle(q.x, q.y, Math.min(sx, sy) * 0.42);
        g.fillStyle(TEAM_COLORS[colorOf(other)].hex, 1);
        g.fillCircle(q.x, q.y, Math.min(sx, sy) * 0.22);
      }
      for (const c of lane.creeps) {
        if (c.hp <= 0) continue;
        const q = P(c.x, c.y),
          mine = c.owner === own;
        g.fillStyle(c.owner < 0 ? 0xb48cff : mine ? 0xffe36e : 0xff8a7a, 1);
        g.fillCircle(q.x, q.y, catalog.byId[c.typeId]?.bossTier || c.waveBoss ? 3.4 : 2.1);
      }
      g.lineStyle(2, this.gainFlash > 0 ? 0x9ce0ff : 0xd9b45a, this.gainFlash > 0 ? 0.6 + this.gainFlash * 0.4 : 0.9);
      g.strokeRoundedRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8, 8);
      const mine = lane.creeps.filter((c) => c.owner === own && c.hp > 0).length;
      this.pipLabel
        .setText(other === own ? t("YOU") : mine ? `${t("ENEMY")}\n${mine}` : t("ENEMY"))
        .setOrigin(0.5, 0)
        .setAlign("center")
        .setPosition(r.x + r.w / 2, r.y + r.h + 6)
        .setVisible(true);
    }
    drawVignette(z, dt) {
      const g = this.vignette;
      g.clear();
      if (this.gainFlash > 0) this.gainFlash = Math.max(0, this.gainFlash - dt * 1.4);
      if (this.flash <= 0) return;
      this.flash = Math.max(0, this.flash - dt * 1.8);
      const a = this.flash,
        band = 5;
      for (let i = 0; i < 12; i++) {
        const alpha = a * 0.34 * (1 - i / 12),
          o = i * band;
        g.fillStyle(0xff2a3a, alpha);
        g.fillRect(o, o, z.w - o * 2, band);
        g.fillRect(o, z.h - o - band, z.w - o * 2, band);
        g.fillRect(o, o + band, band, z.h - o * 2 - band * 2);
        g.fillRect(z.w - o - band, o + band, band, z.h - o * 2 - band * 2);
      }
    }
    backOut(t) {
      const s = 1.9;
      return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
    }
    clearFx() {
      this.projectiles = [];
      this.particles = [];
      this.rings = [];
      this.swipes = [];
      for (const f of this.floaters) this.recycle(f);
      this.floaters = [];
      this.flash = 0;
      this.gainFlash = 0;
    }
  }
  const stage = new Stage(container, { background: "#0b201d", dpr: DPR }),
    arena = new Arena(stage);
  if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) window.felitoArena = arena; // local debugging only
  let started = false,
    destroyed = false;
  arena.preload().then(() => {
    if (destroyed) return;
    arena.create();
    started = true;
    stage.start((time, delta) => arena.update(time, delta));
  });
  // The board follows its container and the HUD/dock around it.
  const resize = new ResizeObserver(() => {
    measureInsets();
    if (container.clientWidth > 0 && container.clientHeight > 0) stage.resize();
  });
  for (const el of [
    container,
    document.querySelector(".mini-hud"),
    document.querySelector(".command-deck"),
    document.querySelector(".bottom-nav"),
  ])
    if (el) resize.observe(el);
  const scene = () => (started ? arena : null);
  return {
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
    geometry() {
      return (
        scene()?.geometry() || arenaGeometry(container.clientWidth, container.clientHeight, getState()?.grid, getMode(), insets)
      );
    },
    cellCenter(gridX, gridY) {
      const grid = getState().grid;
      return scene()?.point((gridX + 0.5) / grid.cols, (gridY + 0.5) / grid.rows);
    },
    gridAt(x, y) {
      return scene()?.toGrid(x, y);
    },
    /** Client coordinates (e.g. a card drag) to a grid cell. */
    gridAtClient(clientX, clientY) {
      const box = container.getBoundingClientRect();
      return scene()?.toGrid(clientX - box.left, clientY - box.top);
    },
  };
}
