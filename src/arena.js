import { getStats, divineShield, isMagicTower, isMeleeTower, towerAt, towerSize, footprintOf, STRIP, HELLFIRE, LONE } from "./simulation.js";
import { ART_MANIFEST, ANIM_MANIFEST, animUrl, artFor, artUrl, towerTier, TOWER_ART, CREEP_ART, TEAM_COLORS, CLOTH_COLORS, recolorTeam } from "./art.js";
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
const SIZE_BOOST = { n00S: 1.3, nAGO: 1.45 }; // tier 1 Raiders, v0.12: Arcane Golem
/** v0.17d: mobile layout B is switched on by a class on <html> (set by the app). */
const layoutB = () => typeof document !== "undefined" && document.documentElement.classList.contains("layout-b");
export function arenaGeometry(width, height, grid = { cols: 6, rows: 9 }, mode = "build", insets = { top: 84, bottom: 172 }) {
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
    byHeight = availableHeight / (logicalRows + STRIP); // v0.09: no exit strip below the board
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
      top = safeTop + frameV + strip + (availableHeight - bh - strip) / 2,
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
    top = safeTop + frameV + strip + (availableHeight - bh - strip) / 2;
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
    frameV,
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
  onTowerRight = () => {},
  popups = { numbers: true, notes: true },
  onPip = () => {},
  onSwipe = () => {},
  peekLane = () => null, // v0.15: {name, color} of the field a swipe in that direction would show
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
  let insets = { top: 84, bottom: 172 };
  function measureInsets() {
    const box = container.getBoundingClientRect(),
      hud = document.querySelector(".mini-hud")?.getBoundingClientRect(),
      dock = document.querySelector(".command-deck")?.getBoundingClientRect();
    insets = {
      top: hud ? Math.max(0, hud.bottom - box.top) : 84,
      bottom: dock ? Math.max(0, box.bottom - dock.top) : 172,
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
      this.bolts = []; // v0.12
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
      const color = CLOTH_COLORS[colorId];
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
            pos = this.toGrid(p.x, p.y),
            inside = state && pos.gridX >= 0 && pos.gridX < state.grid.cols && pos.gridY >= 0 && pos.gridY < state.grid.rows;
          onHover(inside ? pos : null);
        }
      });
      canvas.addEventListener("pointerleave", () => onHover(null));
      // v0.13: right click on a tower (a double right click sells it, see app.js)
      canvas.addEventListener("contextmenu", (ev) => {
        const state = getState();
        if (!state || getMode() !== "build") return;
        const box = canvas.getBoundingClientRect(),
          pos = this.toGrid(ev.clientX - box.left, ev.clientY - box.top);
        if (pos.gridX < 0 || pos.gridX >= state.grid.cols || pos.gridY < 0 || pos.gridY >= state.grid.rows) return;
        const tower = towerAt(state.players[getViewPlayer()], pos.gridX, pos.gridY);
        if (tower) onTowerRight(tower, ev.timeStamp);
      });
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
              info = press.peekStep === step ? press.peek : peekLane(step);
            // v0.15: a swipe rolls the board out to the side, then the next field rolls in
            if (Math.abs(dx) > 44 && info) this.roll(step, info, () => onSwipe(step));
            else this.slideTo(0, 200);
            return;
          }
          if (this.stage.slideX && !this.slide) this.slideTo(0, 200);
        }
        if (!press || press.id !== p.id || press.seed !== state?.seed || Math.hypot(p.x - press.x, p.y - press.y) > 12) return;
        const r = pipGeometry(this.geometry());
        if (r && p.x >= r.x - 6 && p.x <= r.x + r.w + 6 && p.y >= r.y - 6 && p.y <= r.y + r.h + 12) {
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
      // v0.13: Options › Graphic can hide the numbers (+gold, hearts, damage) and the word pop-ups
      const numeric = /\d/.test(text);
      if (numeric ? !popups.numbers : !popups.notes) return;
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
        } else if (e.type === "income" && e.player === view && e.gens?.length) {
          // v0.17c: EXP pop-up over every EXP generator at the start of a round
          for (const gen of e.gens) {
            const q = this.point(gen.x, gen.y),
              n = Math.round(gen.exp * 100) / 100;
            this.burst(q.x, q.y - cell * 0.35, 0xb48cff, 6, 45, 2.2, 0.55, -30, true);
            this.floatText(q.x, q.y - cell * 0.45, `+${n} EXP`, "#d2b0ff", 15, 44, 1.2);
          }
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
        const ac = aim.arcane ? 0xc07aff : aim.fire ? 0xff7a2a : 0xffd27a,
          al = aim.arcane ? 0xeacbff : aim.fire ? 0xffc89a : 0xffe7a8; // v0.10p: violet for Arcane Burst, v0.12: orange for Pillar of Fire
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
        // v0.13: Lone Guardians active: a white aura with beams turning outwards
        if (!building && def.attacks && player.perks?.lone && player.towers.length <= LONE.towers) {
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
        if (def.perkUnit || def.id === "hROK") this.labels.get(key)?.setVisible(false); // v0.12: walls (v0.17: and rocks) carry no level badge
        else this.levelBadge(key, level, cx - tc * 0.36, cy + tc * 0.2, Math.floor(cy) + 101, BADGE_COLORS[def.element] || BADGE_COLORS.neutral);
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
      this.drawPerkFx(game, view, z, time, g, glow); // v0.12: Pillar of Fire, Monsun
      // ---- creeps (v0.12: and Arcane Golems walking up the lane)
      for (const c of player.golems?.length ? [...player.creeps, ...player.golems] : player.creeps) {
        if (c.hp <= 0) continue;
        const def = catalog.byId[c.typeId || c.unitId || c.defId || c.type];
        if (!def) continue;
        const key = `${view}:c:${c.id}`,
          phase0 = parseInt(String(c.id).replace(/\D/g, ""), 10) || 0,
          raw = this.point(c.x, c.y),
          // Render-only spread so a group reads as several units, not one blob.
          q = { x: raw.x + ((((phase0 * 37) % 7) - 3) / 3) * cell * 0.14, y: raw.y + ((((phase0 * 53) % 5) - 2) / 2) * cell * 0.1 },
          artKey = this.ready(c.art || artFor(def), "creep"), // v0.16: c.art (wave 1 boxer goblin)
          m = ART_MANIFEST[artKey],
          // v0.14: creeps wear their sender's colour (team blue in the art moved to that colour)
          teamId = c.owner >= 0 ? colorOf(c.owner) : "neutral", // v0.15: neutral creeps wear brown; v0.17c: the Arcane Golem too wears its owner's colour
          recolor = !!teamId && CLOTH_COLORS[teamId].hue !== null,
          skin = recolor ? this.teamTexture(artKey, teamId) : artKey;
        alive.add(key);
        let sprite = this.units.get(key);
        const baseWalk = this.animFor(artKey),
          walk = baseWalk && recolor ? { ...baseWalk, tex: this.teamTexture(baseWalk.tex, teamId) } : baseWalk;
        if (!sprite) {
          sprite = this.stage.image(q.x, q.y, walk ? walk.tex : skin, walk ? 0 : undefined);
          sprite.setData("hp", c.hp).setData("px", q.x);
          this.units.set(key, sprite);
        }
        const boss = !!(def.bossTier || c.waveBoss),
          flying = !!(c.flying ?? def.flying),
          neutral = c.owner < 0,
          height = cell * (boss ? 1.3 * (c.waveBoss ? 1 : tierGrowth(def.tier || (def.bossTier || 2) - 1)) : (flying ? 0.82 : 0.78) * (neutral ? 1 : creepSize(catalog, def.id))) * (c.golem ? 1 + 0.07 * ((c.level || 1) - 1) : 1), // v0.17c: the Arcane Golem grows 7 % per perk level
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
        } else if (sprite.texture.key !== skin) sprite.setTexture(skin);
        if ((sprite.getData("hit") || 0) > time) sprite.setTint(0xffffff).setTintMode(TINT.FILL);
        else {
          sprite.setTintMode(TINT.MULTIPLY);
          if (divineShield(game, c)) sprite.setTint(0xfff2b0);
          else if (statuses.some((st) => st.abilityId === "entangle")) sprite.setTint(0xa8ff9a);
          else if (statuses.some((st) => st.stun)) sprite.setTint(0xfff3a0);
          else if (slowed) sprite.setTint(statuses.some((st) => st.abilityId === "frost") ? 0xd2efff : 0x9fd8ff); // v0.16: frost gets the sheen instead
          else if (poisoned) sprite.setTint(0xc4f59a);
          else if (c.immune) sprite.setTint(0xe2d2ff);
          else if (c.burning) sprite.setTint(0xffa060); // v0.10w: Burning Treant
          else sprite.clearTint();
        }
        const flap = flying ? 1 + Math.sin(time * 0.03 + phase0) * 0.05 : 1;
        sprite
          .setOrigin(walk ? (m.w / 2 + walk.ox) / walk.fw : 0.5, walk ? (m.footY + walk.oy) / walk.fh : m.footY / m.h)
          .setPosition(q.x, q.y + cell * 0.18 - lift)
          .setScale(s * (sprite.getData("face") === -1 ? -1 : 1) * (c.buff === "fat" ? 1.42 : 1), s * flap * (c.buff === "fat" ? 1.06 : 1)) // v0.15: fat quest creeps
          .setRotation(flying || walk ? 0 : Math.sin(step) * 0.07)
          .setDepth(3000 + Math.floor(q.y) + (flying ? 1200 : 0)); // creeps always draw in front of towers
        g.fillStyle(0x06120e, flying ? 0.22 : 0.32);
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
        // v0.17: no ring under neutral creeps any more; their grey clothes set them apart
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
      // v0.12: Monsun lightning bolts
      for (let i = this.bolts.length - 1; i >= 0; i--) {
        const b = this.bolts[i];
        b.life -= dt;
        if (b.life <= 0) {
          this.bolts.splice(i, 1);
          continue;
        }
        const k = b.life / b.max;
        for (const [w, c, a] of [[b.small ? 7 : 11, 0x8fc8ff, 0.35], [b.small ? 2.5 : 4, 0xfffbe0, 1]]) {
          fa.lineStyle(w, c, a * k);
          fa.beginPath();
          fa.moveTo(b.pts[0].x, b.pts[0].y);
          for (const pt of b.pts.slice(1)) fa.lineTo(pt.x, pt.y);
          fa.strokePath();
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
      if (!r) {
        this.pipLabel.setVisible(false); // v0.17d: layout B has no mini map
        return;
      }
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
            top = q.y - cell * 3.4,
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
          if (!this.shook?.has(f.start)) {
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
    clearFx() {
      this.projectiles = [];
      this.particles = [];
      this.rings = [];
      this.swipes = [];
      this.bolts = [];
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
