import { loadContent, getCatalog } from "./content.js";
import {
  createGame,
  step,
  command,
  available,
  canBuild,
  getStats,
  getSellValue,
  getPurchaseCost,
  serializeGame,
  restoreGame,
  SAVE_VERSION,
  isCompatibleGameGrid,
  previewBuild,
  nextWave,
  footprintOf,
  towerAt,
  isMeleeTower,
  PERKS,
  RESEARCH_ELEMENT,
  grantExp,
  targetOf,
  sendIncome,
  perkGold,
  VOLLEY,
} from "./simulation.js";
import { mountArena, artFor } from "./arena.js";
import { artUrl, iconUrl, ELEMENT_ICON, registerTowerArt, TEAM_COLORS, recolorTeam } from "./art.js";
import { createSoundtrack } from "./soundtrack.js";
import { createSfx, haptic } from "./sfx.js";
import { t, num, goldText } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const format = (n) => num(n, { maximumFractionDigits: 2 });
/** Creep income: two decimals at most, only one once the value is above 10 (v0.09). */
const formatInc = (n) => num(n, { maximumFractionDigits: Math.abs(n) > 10 ? 1 : 2 });
// gold in full up to 99,999, then k with one decimal, from a million k without decimals
const resourceNumber = (n) => goldText(n);
const SAVE = "felito.duel.v4";
const MUSIC_PREF = "felito.music.enabled";
const SOUND_PREF = "felito.sound.enabled";
const AI_PREF = "felito.ai.level";
const PREVIEW_PREF = "felito.build.preview.v2";
const TIPS_PREF = "felito.tips.enabled";
const APP_VERSION = "0.10n",
  APP_DATE = "16.10.2026";
const WAVES_PREF = "felito.waves";
const COACH_PREF = "felito.coach.v1";
const pref = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
};
const savePref = (key, value) => {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
};
// Raise the controls (v0.07l): phones and app views can cover the bottom edge; the whole game
// then ends this far above it. Touch screens start with a small gap.
const LIFT_PREF = "felito.lift";
// v0.09y: 96 px added for very tight views.
const LIFTS = [0, 24, 48, 72, 96];
let liftChoice = (() => {
  const v = Number(pref(LIFT_PREF, ""));
  if (pref(LIFT_PREF, "") !== "" && LIFTS.includes(v)) return v;
  try {
    if (!matchMedia("(pointer: coarse)").matches) return 0;
    // v0.10g: a normal mobile browser handles its bars through the safe area, so no gap; inside
    // the Claude app (an embedded frame) a small gap stays.
    let embedded = false;
    try {
      embedded = window.self !== window.top;
    } catch {
      embedded = true;
    }
    return embedded ? 24 : 0;
  } catch {
    return 0;
  }
})();
// Double tap on one of your towers (v0.08a): upgrade (default), tower info, or nothing.
const DBL_PREF = "felito.dblclick";
const DBL_MODES = ["upgrade", "info", "off"];
let dblMode = DBL_MODES.includes(pref(DBL_PREF, "upgrade")) ? pref(DBL_PREF, "upgrade") : "upgrade";
// v0.10e: in the Claude app the top safe area is tall (status bar plus the app's X and … buttons).
// Its free middle strip takes the wave chip, so the board gets that row back.
function applyTopBand() {
  const shell = document.querySelector(".game-shell");
  if (!shell) return;
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top)";
  document.body.appendChild(probe);
  const inset = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  shell.classList.toggle("top-band", inset >= 76);
}
addEventListener("resize", applyTopBand);
addEventListener("orientationchange", applyTopBand);
function applyLift() {
  applyTopBand();
  document.querySelector(".game-shell")?.style.setProperty("--lift", liftChoice + "px");
  document.documentElement.style.setProperty("--lift", liftChoice + "px");
}
let musicEnabled = pref(MUSIC_PREF, "true") !== "false";
let soundEnabled = pref(SOUND_PREF, "true") !== "false";
let aiChoice = ["veryEasy", "easy", "normal", "hard"].includes(pref(AI_PREF, "easy")) ? pref(AI_PREF, "easy") : "easy";
let buildPreview = pref(PREVIEW_PREF, "false") === "true";
let tipsEnabled = pref(TIPS_PREF, "true") !== "false";
let wavesOn = pref(WAVES_PREF, "true") !== "false";
// v0.10c/f: number of AI enemies for Vs AI (1–7), chosen like the difficulty; 1 = classic duel.
const AI_COUNT_PREF = "felito.aiCount";
const AI_COUNTS = [1, 2, 3, 4, 5, 6, 7];
let aiCount = AI_COUNTS.includes(Number(pref(AI_COUNT_PREF, "3"))) ? Number(pref(AI_COUNT_PREF, "3")) : 3;
let warnedWave = 0;
const sfx = createSfx();
sfx.setEnabled(soundEnabled);
const AI_NAMES = { veryEasy: "Very easy", easy: "Easy", normal: "Normal", hard: "Hard" };
// Player colour: chosen in the main menu; the other side is red, or blue when you play red.
const COLOR_PREF = "felito.color";
let colorChoice = TEAM_COLORS[pref(COLOR_PREF, "blue")] ? pref(COLOR_PREF, "blue") : "blue";
const rivalColor = () => (colorChoice === "red" ? "blue" : "red");
// v0.08b: four players. Seats get distinct colours; the rival plate shows whoever you send to.
const FFA_COLORS = ["red", "green", "yellow", "purple", "teal", "orange", "pink", "blue"];
const isFfa = () => (game?.players?.length || 2) > 2;
function seatColors() {
  if (!isFfa()) return { [own]: colorChoice, [1 - own]: rivalColor() };
  const free = FFA_COLORS.filter((c) => c !== colorChoice && TEAM_COLORS[c]),
    out = {};
  let k = 0;
  for (const pl of game.players) out[pl.id] = pl.id === own ? colorChoice : free[k++];
  return out;
}
/** The player you send to (1v1: the other side). */
const rivalIndex = () => (isFfa() ? targetOf(game, own).id : 1 - own);
const seatName = (i) => (i === own ? t("You") : t(TEAM_COLORS[seatColors()[i]]?.name || "AI"));
/**
 * v0.09b: an AI shows its difficulty in its portrait — very easy keeps the goblin, easy the
 * skeleton, normal the grunt, hard the alchemist. Human players keep the goblin portrait.
 */
const AI_PORTRAIT = { easy: "n00R", normal: "n00M", hard: "n021" };
function portraitFor(q) {
  const id = q?.ai ? AI_PORTRAIT[q.aiLevel || game.aiLevel] : null,
    item = id && catalog?.byId[id];
  return item ? headCrop(artUrl(artFor(item))) : "assets/art/portrait-enemy.webp";
}
/** Head and shoulders per figure: left, top, size in the image's pixels. */
const HEAD_BOX = { "creep-skeleton": [128, 22, 172], "creep-orc": [132, 22, 176], "creep-alchemist": [118, 62, 176] };
/** A square head-and-shoulders crop of a full-body creep figure (made once per image). */
const headCrops = new Map();
function headCrop(url) {
  const hit = headCrops.get(url);
  if (typeof hit === "string") return hit;
  if (!hit) {
    headCrops.set(url, true);
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth,
          h = img.naturalHeight,
          c = Object.assign(document.createElement("canvas"), { width: w, height: h }),
          ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, w, h).data;
        let top = h,
          left = w,
          right = 0;
        for (let y = 0; y < h; y += 2)
          for (let x = 0; x < w; x += 2)
            if (d[(y * w + x) * 4 + 3] > 40) {
              if (y < top) top = y;
              if (x < left) left = x;
              if (x > right) right = x;
            }
        const box = HEAD_BOX[url.split("/").pop().replace(".webp", "")],
          size = box ? box[2] : Math.max(40, Math.round((right - left) * 0.5)),
          cx = box ? box[0] + size / 2 : (left + right) / 2,
          out = Object.assign(document.createElement("canvas"), { width: 96, height: 96 });
        out.getContext("2d").drawImage(img, cx - size / 2, box ? box[1] : Math.max(0, top - size * 0.04), size, size, 0, 0, 96, 96);
        headCrops.set(url, out.toDataURL("image/webp", 0.9));
        if (game) refreshUI();
      } catch {
        headCrops.set(url, url);
      }
    };
    img.src = url;
  }
  return url;
}
function setPortrait(img, q) {
  const src = portraitFor(q);
  if (img && img.getAttribute("src") !== src) {
    img.setAttribute("src", src);
    img.classList.toggle("creep-portrait", src !== "assets/art/portrait-enemy.webp");
  }
}
/**
 * v0.09: with more than one enemy, the rival plate holds every enemy in a simplified form:
 * portrait in the player's colour, lives and income; your current target wears a sword badge.
 * Eliminated players keep their place, marked with a skull and faded.
 */
let enemyStackKey = "";
function renderEnemyStack(force = false) {
  const stack = $("enemy-stack"),
    plate = document.querySelector(".player-plate.rival"),
    multi = !!game && begun && isFfa();
  plate.classList.toggle("multi", multi);
  stack.hidden = !multi;
  if (!multi) return;
  const colors = seatColors(),
    n = game.players.length,
    seats = [];
  for (let k = 1; k < n; k++) seats.push(game.players[(own + k) % n]);
  const key = seats.map((q) => q.id + ":" + colors[q.id]).join(",");
  stack.dataset.count = String(seats.length);
  if (force || key !== enemyStackKey) {
    enemyStackKey = key;
    stack.innerHTML = seats
      .map(
        (q) =>
          `<button class="enemy-cell" type="button" data-seat="${q.id}" style="--pc:${TEAM_COLORS[colors[q.id]]?.css || "#888"}"><span class="ec-top"><span class="ec-face"><img class="portrait" src="assets/art/portrait-enemy.webp" alt=""><i class="plate-skull" aria-hidden="true"></i><img class="ec-target" src="${iconUrl("attack")}" alt=""></span><span class="ec-stats"><span class="ec-lives"><img src="${iconUrl("heart")}" alt=""><b></b></span></span></span><span class="ec-gold"><img src="${iconUrl("coin")}" alt=""><b></b></span><em class="ec-inc"></em><span class="ec-level"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.2l2.6 5.6 6.1.7-4.5 4.2 1.2 6.1L10 14.8l-5.4 3 1.2-6.1-4.5-4.2 6.1-.7z" fill="#a35bff" stroke="#2a0f4f" stroke-width="1.4" stroke-linejoin="round"/></svg><b></b></span></button>`,
      )
      .join("");
  }
  const target = game.players[own].out ? -1 : targetOf(game, own).id;
  for (const cell of stack.querySelectorAll("[data-seat]")) {
    const q = game.players[Number(cell.dataset.seat)],
      label = `${seatName(q.id)} · ${q.lives} ${t("Lives")}${q.out ? " · " + t("out") : q.id === target ? " · " + t("your target") : ""}`;
    setPortrait(cell.querySelector(".portrait"), q);
    cell.classList.toggle("out", !!q.out);
    cell.classList.toggle("target", q.id === target && !q.out);
    cell.classList.toggle("viewing", q.id === view);
    const lives = String(q.lives),
      gold = q.out ? "–" : resourceNumber(Math.floor(q.gold)),
      inc = q.out ? "" : "+" + resourceNumber(Math.floor(q.income));
    if (cell.querySelector(".ec-lives b").textContent !== lives) cell.querySelector(".ec-lives b").textContent = lives;
    const lvl = String(q.level || 1);
    if (cell.querySelector(".ec-level b").textContent !== lvl) cell.querySelector(".ec-level b").textContent = lvl;
    if (cell.querySelector(".ec-gold b").textContent !== gold) cell.querySelector(".ec-gold b").textContent = gold;
    if (cell.querySelector(".ec-inc").textContent !== inc) cell.querySelector(".ec-inc").textContent = inc;
    if (cell.getAttribute("aria-label") !== label) {
      cell.setAttribute("aria-label", label);
      cell.dataset.help = label;
    }
  }
}
// ---- v0.09q: Arrow Volley — an active ability button beside the board ----------------------
let volleyAim = false;
function setVolleyAim(on) {
  volleyAim = !!on;
  $("volley-button")?.classList.toggle("aiming", volleyAim);
  document.querySelector(".game-shell")?.classList.toggle("volley-aiming", volleyAim);
}
function volleyPress() {
  const p = game?.players[own];
  if (!p || !begun || !(p.perks?.volley > 0)) return;
  if (volleyAim) return setVolleyAim(false);
  if (p.volleyReady > game.time) {
    note(t("Arrow Volley ready in {n} s", { n: Math.ceil(p.volleyReady - game.time) }));
    return;
  }
  if (tab !== "build") setPage("build", { scroll: false });
  if (view !== own) showMaze(own);
  selected = null;
  pending = null;
  selectedTower = null;
  renderCards();
  setVolleyAim(true);
  tone("select");
  note("Tap your field where the arrows should fall.");
}
/** Fires the volley at a point of your field (x, y as shares of the board). */
function fireVolley(x, y) {
  setVolleyAim(false);
  const result = dispatch({ type: "volley", x, y });
}
function refreshVolley(p) {
  const btn = $("volley-button");
  if (!btn) return;
  const has = begun && p.perks?.volley > 0;
  btn.hidden = !has;
  if (!has) return;
  const left = Math.max(0, (p.volleyReady ?? 0) - game.time),
    ready = left <= 0;
  btn.classList.toggle("ready", ready);
  btn.style.setProperty("--cd", ready ? 0 : Math.min(1, left / VOLLEY.cooldown));
  const label = ready ? "" : String(Math.ceil(left));
  if ($("volley-time").textContent !== label) $("volley-time").textContent = label;
  const lvl = $("level-button"),
    z = arena?.geometry?.();
  if (z?.side && lvl) {
    const size = Math.round(z.side.w),
      top = Math.round(z.side.y + 14 + size + 14) + "px",
      x = Math.round(z.side.x) + "px";
    if (btn.style.left !== x) btn.style.left = x;
    if (btn.style.top !== top) btn.style.top = top;
    btn.style.setProperty("--slot", size + "px");
  }
  if (!ready && volleyAim) setVolleyAim(false);
}
/** Show a player's maze (from the plates or a swipe). */
function showMaze(player) {
  if (player === own ? tab !== "build" : tab === "research") setPage("build", { scroll: false });
  // v0.09e: another player's field drops the tower blueprint you were placing
  if (player !== own && selected) {
    selected = null;
    pending = null;
    renderCards();
  }
  view = player;
  selectedTower = null;
  hoverCell = null;
  $("tower-panel").hidden = true;
  deckSignature = "";
  refreshUI();
  arena?.refresh();
}
/**
 * v0.09: swiping over the board moves to the neighbouring field. The fields stand in a ring in
 * seat order (the last one borders the first); eliminated players are skipped.
 */
function swipeView(step) {
  if (!game || !begun) return false;
  const n = game.players.length;
  for (let k = 1; k < n; k++) {
    const q = game.players[(((view + step * k) % n) + n) % n];
    if (!q.out || q.id === own) {
      if (q.id === view) return false;
      showMaze(q.id);
      tone("tap");
      return true;
    }
  }
  return false;
}
/** Next lane for the rival plate: your target first, then the other players still in. */
function nextLane() {
  if (!isFfa()) return 1 - own;
  if (view === own) return rivalIndex();
  const n = game.players.length;
  for (let k = 1; k < n; k++) {
    const q = game.players[(view + k) % n];
    if (q.id !== own && !q.out) return q.id;
  }
  return own;
}
function applyColors() {
  const shell = document.querySelector(".game-shell");
  shell?.style.setProperty("--own-color", TEAM_COLORS[colorChoice].css);
  shell?.style.setProperty("--rival-color", TEAM_COLORS[game && begun ? seatColors()[rivalIndex()] : rivalColor()].css);
}
applyLift();
/** Tower art for cards in the player's colour; recoloured once in the background, then cached. */
const teamArt = new Map();
function towerArtUrl(key) {
  const url = artUrl(key);
  if (TEAM_COLORS[colorChoice].hue === null || !/^tower-/.test(key)) return url;
  const id = key + "#" + colorChoice,
    hit = teamArt.get(id);
  if (typeof hit === "string") return hit;
  if (!hit) {
    teamArt.set(id, true);
    const img = new Image();
    img.onload = () => {
      try {
        const c = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight }),
          ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height);
        recolorTeam(data.data, colorChoice);
        ctx.putImageData(data, 0, 0);
        teamArt.set(id, c.toDataURL("image/webp", 0.9));
        if (game) {
          deckSignature = "";
          renderCards();
        }
      } catch {
        teamArt.set(id, url);
      }
    };
    img.src = url;
  }
  return url;
}
const music = createSoundtrack();
music.setEnabled(musicEnabled);
// The menu theme (1.3 MB) loads after the game is up, not in competition with it.
let musicPlayback = null;
function syncMusic() {
  // The battle theme keeps running through pause menus; only a finished or
  // abandoned duel returns to the menu theme.
  const battle = Boolean(begun && !shownResult && game?.winner == null);
  const track = battle ? "battle" : "menu";
  if (track !== musicPlayback) {
    musicPlayback = track;
    music.play(track);
  }
  music.setDucked(Boolean(battle && game?.paused));
}
// Button handlers have already started/resumed the duel when this gesture bubbles.
document.addEventListener("click", () => {
  syncMusic();
  if (musicEnabled) music.unlock();
  sfx.unlock();
});
let unusableSave = false;
let game,
  catalog,
  arena,
  room,
  networkAbort,
  connected = false,
  own = 0,
  view = 0,
  tab = "build",
  selected = null,
  selectedTower = null,
  pending = null,
  drag = null,
  chosenFaction = "water",
  chosenMode = "arena",
  sessionMode = "training",
  begun = false,
  shownResult = false;
applyColors(); // after `game` exists (v0.08b: colours depend on the seats)
let uiTime = 0,
  saveTime = 0,
  networkTime = 0,
  toastTimeout,
  installPrompt,
  lastEvent = 0,
  lastSendTime = -999,
  gameSpeed = 1,
  nudgeShown = 0,
  modalWasPaused = true,
  sendTier = 1,
  networkSendFailures = 0,
  transportBlocked = false;
const networkPauses = new Set();
const lastSendCards = [null, null];
const uiPauses = new Set();
let deckSignature = "";
let queued = [],
  upQueue = [], // upgrades waiting for gold or for construction to finish: { towerId, id, from }
  queuedFor = null;
const researchCopy = {
  R00K: ["Watcher Owl", "More range for your towers."],
  R000: ["Forged Arrows", "+5% damage for arrow towers per level."],
  R00J: ["Fire Arrows", "+10% damage for arrow towers per level."],
  R005: ["Heavy Weapons", "+5% damage for guards and cannons per level."],
  R00M: ["Fire", "Unlocks the fire upgrade paths."],
  R00N: ["Water", "Unlocks the water upgrade paths."],
  R00O: ["Storm", "Unlocks the storm upgrade paths."],
  R00P: ["Plague", "Unlocks the plague upgrade paths."],
  R00Q: ["Earth", "Unlocks the earth upgrade paths."],
  R00R: ["Arcane", "Unlocks the arcane upgrade paths."],
  R00U: ["Creep Armor", "More armor and life."],
  R00V: ["Leadership", "More life for your creeps."],
  R00W: ["Tailwind", "Faster, better armored creeps."],
  R00X: ["Willpower", "More life and speed for creeps."],
  R001: ["Healing Power", "More life and regeneration."],
  R002: ["Sparring Lessons", "Faster attacks for selected towers."],
  R006: ["Magic Library", "More income from creep purchases."],
  R00C: ["Unholy Frenzy", "Your towers attack faster."],
  R00D: ["Spirit Wolves", "Later payouts bring wolves."],
  R013: ["Improved Construction", "More life for your towers."],
};

// The original names, except for the creeps and buildings renamed in this port.
const namesEn = { Peon: "Goblin", "Chaos Peon": "Imp", Lumbermill: "EXP Generator" };
function itemName(item) {
  if (researchCopy[item?.id]) return t(researchCopy[item.id][0]);
  const short = (item?.shortName || item?.name || "").replace(/\s*\[.*?\]/g, "").trim();
  return namesEn[short] || short;
}
function cardAction(item) {
  return item.kind === "send" ? "send" : item.kind === "research" ? "research" : item.isRoot ? "build" : "upgrade";
}
function cardHint(item) {
  if (researchCopy[item.id]) return t(researchCopy[item.id][1]);
  if (item.kind === "send") return t("+{n} income", { n: formatInc(incomeFor(item)) });
  return t(
    { h003: "Arrows", h000: "Melee", h02R: "Splash", h03V: "Magic", h02Q: "+1 income", h05L: "Elements", h01F: "EXP every round" }[
      item.id
    ] || "Tower upgrade",
  );
}
const isFreeLabel = (label) => String(label).startsWith(t("Free"));
/** Income a send adds for you right now, buffs included (Feudality, research), at most 2 decimals. */
const incomeFor = (item) => (game ? sendIncome(game, own, item.id) : item.income);
function priceLabel(item) {
  const free = item.id === "h003" && item.kind !== "send" ? game?.players[own]?.freeArchers || 0 : 0;
  if (free > 0) return free > 1 ? t("Free ×{n}", { n: free }) : t("Free");
  const c = itemPrice(item);
  return item.kind === "research" ? `${format(c.wood || c.gold)}` : `${format(c.gold)}`;
}
function stockCount(item) {
  return Math.max(0, Math.floor(game.players[own].stock[item.id]?.count ?? 0));
}
function cardStatus(item) {
  const p = game.players[own];
  if (item.kind === "send") {
    if (game.warmup) return `${Math.ceil(game.incomeRemaining)}s`;
    const stock = p.stock[item.id];
    if (stock && stock.count < 1) return `${Math.max(1, Math.ceil(stock.next - game.time))}s`;
  }
  const level = p.research[item.id] || 0;
  return item.kind === "research" && level ? t("Level {n}", { n: level }) : "";
}
function setUiPause(reason, value) {
  value ? uiPauses.add(reason) : uiPauses.delete(reason);
  pause(uiPauses.size > 0);
}
function setPage(next, { scroll = true } = {}) {
  if (!["build", "send", "research"].includes(next)) return;
  tab = next;
  view = next === "send" ? rivalIndex() : own;
  selectedTower = null;
  pending = null;
  $("tower-panel").hidden = true;
  if (next === "send") document.querySelector('[data-tab="send"]')?.classList.remove("nudge");
  document.querySelector(".game-shell").dataset.page = next;
  $("page-title").textContent = t(next === "build" ? "Build" : next === "send" ? "Send" : "Upgrade");
  $("page-subtitle").textContent =
    next === "build"
      ? t("Pick a tower. Tap a free field.")
      : next === "send"
        ? t("Send creeps. Raise your income.")
        : "";
  document.querySelectorAll("[data-tab]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === next);
    b.setAttribute("aria-current", b.dataset.tab === next ? "page" : "false");
  });
  deckSignature = "";
  renderCards();
  refreshUI();
  if (scroll) {
    $("cards").scrollTo({ top: 0, left: 0 });
    document.querySelector(".page-body").scrollTo({ top: 0, left: 0 });
    requestAnimationFrame(scrollDeckToBest);
  }
  arena?.refresh();
}
function itemPrice(item) {
  return getPurchaseCost(game, own, item.id) || { gold: item.cost, wood: item.woodCost, time: 0 };
}
function validAutoSend(id, player = own) {
  if (id === null || id === undefined) return true;
  const item = typeof id === "string" ? catalog.byId[id] : null;
  return !!(item?.kind === "send" && item.playable && item.tier === game.players[player].tier);
}
function refreshAutoSend() {
  const p = game?.players[own];
  if (!p) return;
  $("auto-send").hidden = true;
  $("side-dock").hidden = !begun;
  const id = p.autoSend,
    item = id ? catalog.byId[id] : null,
    on = !!item && p.autoSendActive !== false,
    slot = $("auto-slot"),
    key = `${id}|${on}`;
  $("tier-badge").textContent = `T${p.tier}`;
  if (slot.dataset.key === key) return;
  slot.dataset.key = key;
  slot.classList.toggle("filled", !!item);
  slot.classList.toggle("off", !!item && !on);
  slot.innerHTML = item ? `<img src="${artUrl(artFor(item))}" alt="">${on ? "" : `<span class="auto-slot-off">${t("Off")}</span>`}` : '<span class="auto-slot-empty">+</span>';
  slot.setAttribute("aria-label", item ? t(on ? "Auto-spawn {name}: on. Tap to switch, drag out to clear." : "Auto-spawn {name}: off. Tap to switch, drag out to clear.", { name: itemName(item) }) : t("Auto-spawn: drag a creep here"));
  slot.title = slot.getAttribute("aria-label");
}
// ---- help mode: the "?" button switches tooltips on for every button ---------------------
const HELP_PREF = "felito.help.tooltips";
let helpMode = pref(HELP_PREF, "false") === "true",
  helpFor = null,
  helpTimer = 0;
const helpTip = Object.assign(document.createElement("div"), { id: "help-tip", className: "help-tip", hidden: true });
helpTip.setAttribute("role", "tooltip");
document.body.append(helpTip);
function setHelpMode(on, announce = false) {
  helpMode = on;
  savePref(HELP_PREF, on);
  const b = $("help-button");
  b?.classList.toggle("active", on);
  b?.setAttribute("aria-pressed", String(on));
  if (!on) hideHelp();
  if (announce) {
    toast(on ? "Tooltips on: point at a button with the mouse." : "Tooltips off.");
    tone("tap");
  }
}
// ---- v0.08b: tooltips for creeps and towers as a list of values ---------------------------
const ARMOR_NAMES = { small: "light", medium: "medium", large: "heavy", fort: "fortified", hero: "hero", divine: "divine", none: "unarmoured", normal: "medium" };
const HIDDEN_ABILITIES = new Set(["Aroa", "Aro1", "Aeth", "Aloc", "Aasl"]);

/** Readable ability names of a unit (internal helpers and colour codes left out). */
function abilityNames(item) {
  const names = (item.abilities || [])
    .map((id) => catalog.abilities[id])
    .filter((a) => a && !HIDDEN_ABILITIES.has(a.baseId))
    .map((a) => String(a.fields?.anam?.[0] ?? a.fields?.anam?.[1] ?? "").replace(/\|c[0-9a-fA-F]{8}|\|r|\[[^\]]*\]/g, "").trim())
    .filter((n) => n && !n.startsWith("*") && !/^Ani|Animation/i.test(n));
  return [...new Set(names)];
}
function statTip(item, action, towerId = null) {
  const a = available(game, own, action, item.id, towerId),
    price = action === "build" ? priceLabel(item) : format(itemPrice(item).gold),
    rows = [];
  if (item.kind === "send") {
    const unit = catalog.byId[item.spawnIds?.[0]] || item,
      count = item.spawnIds?.length || 1,
      us = getStats(game, own, unit.id);
    rows.push([t("Hitpoints"), format(us.hp)]);
    rows.push([t("Speed"), `${format(us.speed / game.grid.cellUnits)} ${t("fields/s")}`]);
    const inc = incomeFor(item);
    rows.push([t("Income"), "+" + formatInc(inc) + (Math.abs(inc - item.income) > 0.004 ? ` (${t("base")} ${formatInc(item.income)})` : "")]);
    rows.push([t("Stock"), String(stockCount(item))]);
  } else {
    const s = getStats(game, own, item.id),
      air = item.targets?.includes("air"),
      ground = item.targets?.includes("ground");
    rows.push([t("Damage"), format(s.damage) + (Math.abs(s.damage - item.damage) > 0.004 ? ` (${t("base")} ${format(item.damage)})` : "")]);
    rows.push([t("Range"), isMeleeTower(item) ? t("Melee") : `${format(s.range / game.grid.cellUnits)} ${t("fields")}`]);
    rows.push([t("Attacks every"), `${format(s.cooldown)} s`]);
    rows.push([t("Targets"), ground && air ? t("ground and air") : air ? t("air only") : t("ground only")]);
  }
  const abilities = abilityNames(item);
  rows.push([t("Abilities"), abilities.length ? abilities.join(", ") : t("none")]);
  return {
    html:
      `<div class="tip-head"><b>${esc(itemName(item))}</b><span class="tip-gold"><img src="${iconUrl("coin")}" alt="Gold">${esc(price)}</span></div>` +
      rows.map(([k, v]) => `<div class="tip-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("") +
      (a.ok ? "" : `<div class="tip-warn">${esc(t(a.reason))}</div>`),
  };
}
/** Tooltip: values for creep and tower cards, else an explicit help text or the button's label. */
function helpText(el) {
  if (el.dataset.help) return t(el.dataset.help) + (el.id === "wave-chip" && el.title ? " " + el.title : "");
  if (el.dataset.card && game) {
    const item = catalog?.byId[el.dataset.card];
    if (item?.kind === "send") return statTip(item, "send");
    if (item && item.kind !== "research" && (item.attacks || item.isRoot)) return statTip(item, "build");
  }
  if (el.dataset.upgrade && game) {
    const item = catalog?.byId[el.dataset.upgrade],
      tower = upgradeTower();
    if (item) return statTip(item, "upgrade", tower?.id);
  }
  return el.getAttribute("aria-label") || el.title || "";
}
function showHelp(el) {
  const text = helpText(el);
  if (!text) return hideHelp();
  helpFor = el;
  if (typeof text === "object") {
    helpTip.innerHTML = text.html;
    helpTip.classList.add("stats");
  } else {
    helpTip.textContent = text;
    helpTip.classList.remove("stats");
  }
  helpTip.hidden = false;
  const r = el.getBoundingClientRect(),
    w = helpTip.offsetWidth,
    h = helpTip.offsetHeight,
    left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)),
    top = r.top - h - 8 >= 6 ? r.top - h - 8 : Math.min(innerHeight - h - 6, r.bottom + 8);
  helpTip.style.left = left + "px";
  helpTip.style.top = top + "px";
}
function hideHelp() {
  helpFor = null;
  helpTip.hidden = true;
  clearTimeout(helpTimer);
}
const helpTarget = (e) => (e.target.closest?.("dialog") ? null : e.target.closest?.("[data-help], button, [role=button], [data-card], [data-upgrade]"));
document.addEventListener("pointerover", (e) => {
  if (!helpMode || e.pointerType === "touch") return;
  const el = helpTarget(e);
  if (el && el !== helpFor) showHelp(el);
  else if (!el) hideHelp();
});
document.addEventListener("pointerout", (e) => {
  if (helpMode && helpFor && !helpFor.contains(e.relatedTarget)) hideHelp();
});
// Touch has no hover: in help mode a tap also shows the tip for a moment.
document.addEventListener("pointerdown", (e) => {
  if (!helpMode || e.pointerType !== "touch") return;
  const el = helpTarget(e);
  if (!el) return hideHelp();
  showHelp(el);
  clearTimeout(helpTimer);
  helpTimer = setTimeout(hideHelp, 2600);
});
// ---- v0.09: tooltips for chosen abilities inside the level dialog ([data-tip]) -------------
// Dialogs sit in the browser's top layer, so this tip lives inside the open dialog.
const dialogTip = Object.assign(document.createElement("div"), { className: "help-tip stats dialog-tip", hidden: true });
dialogTip.setAttribute("role", "tooltip");
let dialogTipFor = null,
  dialogTipTimer = 0;
function showDialogTip(el) {
  const host = el.closest("dialog") || document.body;
  if (dialogTip.parentNode !== host) host.append(dialogTip);
  const level = el.dataset.tipLevel;
  dialogTip.innerHTML =
    `<div class="tip-head"><b>${esc(el.dataset.tip)}</b>${level ? `<span class="tip-level">${esc(t("Level {n}", { n: level }))}</span>` : ""}</div>` +
    (el.dataset.tipText ? `<div class="tip-text">${esc(el.dataset.tipText)}</div>` : "");
  dialogTip.hidden = false;
  dialogTipFor = el;
  const r = el.getBoundingClientRect(),
    w = dialogTip.offsetWidth,
    h = dialogTip.offsetHeight,
    left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)),
    top = r.top - h - 8 >= 6 ? r.top - h - 8 : Math.min(innerHeight - h - 6, r.bottom + 8);
  dialogTip.style.left = left + "px";
  dialogTip.style.top = top + "px";
}
function hideDialogTip() {
  dialogTipFor = null;
  dialogTip.hidden = true;
  clearTimeout(dialogTipTimer);
}
document.addEventListener("pointerover", (e) => {
  if (e.pointerType === "touch") return;
  const el = e.target.closest?.("[data-tip]");
  if (el && el !== dialogTipFor) showDialogTip(el);
  else if (!el && dialogTipFor) hideDialogTip();
});
document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest?.("[data-tip]");
  if (!el) return dialogTipFor && hideDialogTip();
  if (e.pointerType !== "touch") return;
  showDialogTip(el);
  clearTimeout(dialogTipTimer);
  dialogTipTimer = setTimeout(hideDialogTip, 2800);
});
$("modal").addEventListener("close", hideDialogTip);
// v0.09f: a right click drops the tower blueprint you are placing (no browser menu in the game)
document.addEventListener("contextmenu", (e) => {
  if (!game || !begun || e.target.closest?.("dialog")) return;
  if (!e.target.closest?.(".game-shell")) return;
  e.preventDefault();
  if (volleyAim) setVolleyAim(false);
  if (tab === "build" && (selected || drag)) {
    selected = null;
    pending = null;
    hoverCell = null;
    renderCards();
    refreshUI();
    tone("tap");
  }
});
/** Static page texts carry their German key in data-t (text), data-ta (aria-label), data-tt (title). */
function applyStaticTexts() {
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  document.querySelectorAll("[data-ta]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.ta)));
  document.querySelectorAll("[data-tt]").forEach((el) => (el.title = t(el.dataset.tt)));
}
applyStaticTexts();
function toast(message, kind = "") {
  const el = $("toast");
  el.textContent = t(message); // literal German messages and simulation reasons translate here
  el.dataset.kind = kind;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove("show"), 2200);
}
/** Minor hints go to the bottom banner only while tips are switched on (v0.09). */
function note(message, kind = "") {
  if (tipsEnabled) toast(message, kind);
}
function tone(name = "tap") {
  sfx.play(name);
}
function networkState() {
  return {
    ...game,
    commands: [],
    pendingSpawns: [],
    events: game.events.slice(-40),
    effects: [],
    players: game.players.map((p) => ({
      ...p,
      creeps: p.creeps.map((c) => ({
        id: c.id,
        typeId: c.typeId,
        x: c.x,
        y: c.y,
        hp: c.hp,
        maxHp: c.maxHp,
        owner: c.owner,
        defender: c.defender,
        flying: c.flying,
        progress: c.progress,
        dead: c.dead,
      })),
    })),
  };
}
function sendState() {
  if (transportBlocked) return false;
  const sent = room?.send({ kind: "state", game: networkState() });
  networkSendFailures = sent ? 0 : networkSendFailures + 1;
  if (networkSendFailures >= 30) {
    transportBlocked = true;
    game.paused = true;
    room?.send({ kind: "transport-pause" });
    showModal(
      `${modalHeader(t("Transfer paused"))}<p class="modal-copy">${t("The connection can't send the game state right now. Both arenas are paused.")}</p><button class="primary-button" id="retry-network">${t("Try the connection again")}</button>`,
    );
    $("retry-network").onclick = () => {
      transportBlocked = false;
      networkSendFailures = 0;
      game.paused = false;
      closeModal();
      sendState();
    };
  }
  return sent;
}
function pause(value) {
  if (!game || (!value && transportBlocked)) return;
  // v0.10h: online (PvP) games never pause for menus, level-up picks or the app going to the
  // background; only a lost or blocked connection stops the duel.
  if (room) return;
  if (room?.role === "guest") room.send({ kind: "pause", paused: value });
  else {
    if (room) {
      value ? networkPauses.add(0) : networkPauses.delete(0);
      game.paused = transportBlocked || networkPauses.size > 0;
    } else game.paused = value;
    if (room && connected) sendState();
  }
}
function showModal(body, { pauseGame = true, welcome = false } = {}) {
  closeSheet();
  hideDialogTip();
  if (pauseGame && begun) setUiPause("modal", true);
  $("modal").classList.toggle("welcome-modal", welcome);
  $("modal").classList.remove("with-flag");
  $("modal-body").innerHTML = body;
  if (!$("modal").open) $("modal").showModal();
  $("modal-body")
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.onclick = closeModal));
}
function closeModal() {
  if (!begun && catalog) {
    disconnectRoom();
    welcome();
    return;
  }
  if (begun && !shownResult) setUiPause("modal", false);
  if ($("modal").open) $("modal").close();
}
$("modal").addEventListener("close", () => {
  if (!$("modal").open && begun && !shownResult) setUiPause("modal", false);
});
$("modal").addEventListener("cancel", (e) => {
  e.preventDefault();
  if (begun) closeModal();
});
const modalHeader = (title) =>
  `<div class="modal-header"><h2>${esc(title)}</h2><button class="close-modal" data-close aria-label="${t("Close")}">×</button></div>`;

function welcome() {
  const saved = unusableSave ? null : localStorage.getItem(SAVE);
  showModal(
    `<div class="welcome-art" aria-hidden="true"></div><button class="welcome-options" id="welcome-options" type="button" aria-label="${t("Options")}"><img src="${iconUrl("gear")}" alt=""></button><span class="app-version">v${APP_VERSION} · ${APP_DATE}</span><img class="welcome-logo" src="assets/art/ui-logo.webp" alt="Felito Tower Wars"><div class="welcome-panel" id="welcome-panel" data-view="home"><div class="welcome-home">${saved ? `<button class="secondary-button welcome-continue" id="resume-game">${t("Continue")}</button>` : ""}<span class="modal-label">${t("Your color")}: <b id="color-name">${t(TEAM_COLORS[colorChoice].name)}</b></span><div class="color-picker" role="radiogroup" aria-label="${t("Your color")}">${Object.entries(TEAM_COLORS).map(([id, c]) => `<button role="radio" data-color="${id}" aria-checked="${id === colorChoice}" aria-label="${t(c.name)}" title="${t(c.name)}" class="${id === colorChoice ? "active" : ""}" style="--c:${c.css}"></button>`).join("")}</div><div class="welcome-modes"><button class="primary-button big welcome-mode" data-open="ai">${t("Vs AI")}</button><button class="primary-button big welcome-mode alt" data-open="player">${t("Vs Player")}</button></div></div><section class="welcome-group" data-sub="ai" aria-label="${t("Vs AI")}"><h3 class="welcome-group-title"><button class="welcome-back" type="button" data-back aria-label="${t("Back")}">‹</button>${t("Vs AI")}</h3><div class="segmented ai-levels" role="radiogroup" aria-label="${t("Difficulty")}">${Object.entries(AI_NAMES).map(([id, name]) => `<button role="radio" data-ai="${id}" aria-checked="${id === aiChoice}" class="${id === aiChoice ? "active" : ""}">${t(name)}</button>`).join("")}</div><div class="welcome-inline"><span class="modal-label">${t("Neutral waves")}</span><div class="segmented" role="radiogroup" aria-label="${t("Neutral waves")}">${[["on", "On"], ["off", "Off"]].map(([id, name]) => `<button role="radio" data-waves="${id}" aria-checked="${(id === "on") === wavesOn}" class="${(id === "on") === wavesOn ? "active" : ""}">${t(name)}</button>`).join("")}</div></div><span class="modal-label">${t("Number of AI enemies")}</span><div class="segmented ai-count" role="radiogroup" aria-label="${t("Number of AI enemies")}">${AI_COUNTS.map((n) => `<button role="radio" data-aicount="${n}" aria-checked="${n === aiCount}" class="${n === aiCount ? "active" : ""}">${n}</button>`).join("")}</div><button class="primary-button big" id="start-training">${t("Start")}</button></section><section class="welcome-group" data-sub="player" aria-label="${t("Vs Player")}"><h3 class="welcome-group-title"><button class="welcome-back" type="button" data-back aria-label="${t("Back")}">‹</button>${t("Vs Player")}</h3><div class="welcome-row pvp-row"><button class="primary-button" id="start-quick">${t("Quick Match")}</button><button class="secondary-button" id="start-online">${t("Play a friend")}</button><button class="secondary-button" id="start-ranked" disabled aria-disabled="true" title="${t("Ranked matches are coming soon.")}">${t("Ranked match")}</button></div></section></div>`,
    { pauseGame: false, welcome: true },
  );
  $("modal-body")
    .querySelectorAll("[data-element]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          chosenFaction = b.dataset.element;
          $("modal-body")
            .querySelectorAll("[data-element]")
            .forEach((x) => {
              x.classList.toggle("active", x === b);
              x.setAttribute("aria-checked", String(x === b));
            });
          tone("tap");
        }),
    );
  if ($("start-hotseat")) $("start-hotseat").onclick = () => startLocal({ hotseat: true });
  $("modal-body")
    .querySelectorAll("[data-ai]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          aiChoice = b.dataset.ai;
          savePref(AI_PREF, aiChoice);
          $("modal-body")
            .querySelectorAll("[data-ai]")
            .forEach((x) => {
              x.classList.toggle("active", x === b);
              x.setAttribute("aria-checked", String(x === b));
            });
          tone("tap");
        }),
    );
  $("modal-body")
    .querySelectorAll("[data-waves]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          wavesOn = b.dataset.waves === "on";
          savePref(WAVES_PREF, wavesOn);
          $("modal-body")
            .querySelectorAll("[data-waves]")
            .forEach((x) => {
              x.classList.toggle("active", x === b);
              x.setAttribute("aria-checked", String(x === b));
            });
          tone("tap");
        }),
    );
  $("modal-body")
    .querySelectorAll("[data-color]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          colorChoice = b.dataset.color;
          savePref(COLOR_PREF, colorChoice);
          applyColors();
          $("color-name").textContent = t(TEAM_COLORS[colorChoice].name);
          $("modal-body")
            .querySelectorAll("[data-color]")
            .forEach((x) => {
              x.classList.toggle("active", x === b);
              x.setAttribute("aria-checked", String(x === b));
            });
          tone("tap");
        }),
    );
  $("modal-body")
    .querySelectorAll("[data-aicount]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          aiCount = Number(b.dataset.aicount);
          savePref(AI_COUNT_PREF, aiCount);
          $("modal-body")
            .querySelectorAll("[data-aicount]")
            .forEach((x) => {
              x.classList.toggle("active", x === b);
              x.setAttribute("aria-checked", String(x === b));
            });
          tone("tap");
        }),
    );
  $("start-training").onclick = () => (aiCount === 1 ? startLocal() : startLocal({ ffa: true, seats: aiCount + 1 }));
  $("welcome-options").onclick = optionsModal;
  $("start-online").onclick = () => onlineMenu();
  $("start-quick").onclick = () => quickMatch();
  // Start menu pages (v0.10a): home with colour and the two mode buttons; Vs AI and Vs Player open
  // as their own pages with a back button.
  const welcomeView = (view) => {
    $("welcome-panel").dataset.view = view;
    tone("tap");
  };
  $("modal-body").querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => welcomeView(b.dataset.open)));
  $("modal-body").querySelectorAll("[data-back]").forEach((b) => (b.onclick = () => welcomeView("home")));
  // Ranked matches (v0.09z): button is in place, matchmaking follows later.
  $("start-ranked").onclick = () => {
    tone("tap");
    toast(t("Ranked matches are coming soon."));
  };
  if (saved)
    $("resume-game").onclick = () => {
      try {
        game = restoreGame(saved);
        game.paused = false;
        own = 0;
        view = 0;
        begun = true;
        shownResult = false;
        uiPauses.clear();
        sessionMode = game.players.length > 2 ? "ffa" : game.players[1].ai ? "training" : "hotseat";
        applyColors();
        closeModal();
        setPage("build");
      } catch {
        unusableSave = true;
        toast(t("This save doesn't fit the new arena and stays stored."));
        welcome();
      }
    };
}
function disconnectRoom() {
  networkAbort?.abort();
  networkAbort = null;
  const old = room;
  room = null;
  connected = false;
  transportBlocked = false;
  networkSendFailures = 0;
  networkPauses.clear();
  old?.close();
}
let shownRival = -1;
/** Four players: you are out. Keep watching, play again or back to the menu. */
function ownKnockedOut(place) {
  if (shownResult) return;
  shownResult = true;
  try {
    localStorage.removeItem(SAVE);
  } catch {}
  tone("defeat");
  const me = game.players[own];
  showModal(
    `<div class="modal-kicker" style="text-align:center">${t("KNOCKED OUT")}</div><img class="modal-hero result-hero" src="${artUrl("creep-golem")}" alt=""><h2 class="welcome-title">${t("Place {n} of {m}", { n: place, m: game.players.length })}</h2><div class="result-stats"><span><b>${me.stats.kills}</b>${t("stopped")}</span><span><b>${me.stats.sent}</b>${t("sent")}</span><span><b>${me.stats.leaks}</b>${t("breakthroughs")}</span><span><b>+${resourceNumber(me.income)}</b>${t("Income")}</span></div><button class="primary-button" id="ko-watch">${t("Keep watching")}</button><button class="secondary-button" id="ko-again">${t("Play again")}</button><button class="secondary-button" id="ko-menu">${t("Main menu")}</button>`,
    { pauseGame: false },
  );
  $("ko-watch").onclick = () => {
    if ($("modal").open) $("modal").close();
  };
  $("ko-again").onclick = () => {
    shownResult = false;
    startLocal({ ffa: true, seats: game.players.length });
  };
  $("ko-menu").onclick = () => {
    begun = false;
    shownResult = false;
    welcome();
  };
}
function startLocal({ hotseat = false, ffa = false, seats = 4 } = {}) {
  disconnectRoom();
  uiPauses.clear();
  sessionMode = hotseat ? "hotseat" : ffa ? "ffa" : "training";
  own = 0;
  view = 0;
  begun = true;
  shownResult = false;
  lastEvent = 0;
  game = createGame({
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
    mode: chosenMode,
    faction: chosenFaction,
    ai: !hotseat,
    aiLevel: aiChoice,
    waves: wavesOn,
    seats: ffa ? Math.min(8, Math.max(3, seats)) : 2,
  });
  applyColors();
  warnedWave = 0;
  game.paused = false;
  selected = null;
  selectedTower = null;
  pending = null;
  lastSendTime = -999;
  nudgeShown = 0;
  gameSpeed = 1;
  lastSendCards.fill(null);
  closeModal();
  setPage("build");
  tone("select");
  coach("start");
}
function dispatch(input, { quiet = false, fromQueue = false } = {}) {
  if (!begun) return;
  // queued pre-builds go ahead whichever lane is on screen
  if (view !== own && input.type === "build" && !fromQueue) {
    toast("Switch back to your defence first.");
    return;
  }
  if (input.type === "autoSend" && !validAutoSend(input.id)) {
    toast("Pick a creep card from your current tier.");
    return;
  }
  if (room?.role === "guest") {
    if (!room.send({ kind: "command", command: { ...input, player: 1 } })) toast("The connection isn't ready yet.");
    else if (input.type === "send") sendFx(input.id, catalog.byId[input.id]?.spawnIds?.length || 1);
    return;
  }
  const result = command(game, { ...input, player: own });
  if (!result.ok) {
    if (!quiet) {
      toast(result.reason || "Not possible right now.");
      tone("error");
    }
  } else {
    if (!quiet || performance.now() - lastQuietTone > 140) {
      lastQuietTone = performance.now();
      tone({ send: "send", build: "build", upgrade: "upgrade", sell: "sell", research: "upgrade" }[input.type] || "tap");
    }
    if (input.type === "send") {
      const item = catalog.byId[input.id];
      lastSendTime = game.time;
      /* Einkommens-Hinweis beim Senden entfernt */
      coach("sent");
    }
    if (input.type === "build") coach("built");
  }
  renderCards();
  refreshUI();
  if (selectedTower) showTower(selectedTower);
  if (input.type === "send" && result.ok) sendFx(input.id, result.count || 1);
  return result;
}
// ---- send feedback: the pressed card pulses and a counter rises from it --------------
// The counter adds up the creeps of one type sent in a burst and starts again at zero
// once that type has not been sent for SEND_COUNT_RESET ms.
const SEND_COUNT_RESET = 3000,
  sendCounts = new Map();
function sendFx(id, count, auto = false) {
  const now = performance.now(),
    key = auto ? "auto:" + id : id,
    entry = sendCounts.get(key);
  const n = (entry && now - entry.t <= SEND_COUNT_RESET ? entry.n : 0) + 1; // presses, not creeps
  sendCounts.set(key, { n, t: now });
  // auto-spawns count up over the auto slot left of the board
  const card = auto ? $("auto-slot") : $("cards")?.querySelector(`[data-card="${id}"]`);
  if (!card || card.offsetParent === null) return;
  card.classList.remove("sent-pulse");
  void card.offsetWidth;
  card.classList.add("sent-pulse");
  const r = card.getBoundingClientRect(),
    pop = document.createElement("span");
  pop.className = "send-count";
  pop.textContent = "×" + n;
  pop.style.left = `${r.left + r.width / 2 + (Math.random() - 0.5) * r.width * 0.3}px`;
  pop.style.top = `${r.top + 4}px`;
  document.body.appendChild(pop);
  pop.addEventListener("animationend", () => pop.remove(), { once: true });
  setTimeout(() => pop.remove(), 1500);
}

function deckItems() {
  if (tab === "build") {
    const order = ["h003", "h000", "h02R", "h03V", "h02Q", "h05L", "h01F"];
    return catalog.towers
      .filter((x) => x.isRoot && x.playable && x.support !== "farm")
      .filter((x) => !isLocked(available(game, own, "build", x.id)))
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  if (tab === "send") {
    const p = game.players[own];
    // Current tier only (12 monsters incl. its boss), cheapest first, boss last; a bought boss disappears.
    return catalog.sends
      .filter((x) => x.playable && x.tier === p.tier && !(x.bossTier && p.bossBought?.[x.id]))
      .sort((a, b) => a.tier - b.tier || Number(!!a.bossTier) - Number(!!b.bossTier) || a.cost - b.cost);
  }
  const p = game.players[own],
    elementIds = catalog.factions.map((f) => f.research);
  return catalog.research
    .filter(
      (x) =>
        x.playable &&
        (p.research[x.id] || 0) < x.maxLevel &&
        x.requires.every((r) => !elementIds.includes(r.id) || (p.research[r.id] || 0) >= r.level),
    )
    .sort((a, b) => Number(elementIds.includes(a.id)) - Number(elementIds.includes(b.id)) || a.woodCost - b.woodCost);
}
function upgradeTower() {
  if (!game || tab !== "build" || view !== own || !selectedTower) return null;
  return game.players[own].towers.find((t) => t.id === selectedTower) || null;
}
function deckSig() {
  const t = upgradeTower();
  if (t) {
    const ups = catalog.byId[t.typeId].upgrades.map((id) => catalog.byId[id]).filter(Boolean);
    return "up|" + t.id + "|" + t.typeId + "|" + (t.buildRemaining > 0 ? 1 : 0) + "|" + (upQueue.find((q) => q.towerId === t.id)?.id || "") + "|" + ups.map((u) => { const a = available(game, own, "upgrade", u.id, t.id); return a.ok ? 1 : isLocked(a) ? 2 : 0; }).join("");
  }
  return deckItems().map((i) => i.id).join(",") + "|" + JSON.stringify(game.players[own].research);
}
/** Upgrades of the selected tower, shown in the bottom build dialog instead of a popup. */
/** Not enough gold/wood right now (the option itself is unlocked). */
const isPoor = (a) => !a.ok && /more gold/.test(a.reason || "");
/** Locked by a missing technology or rule: such buttons are not shown at all. */
const isLocked = (a) => !a.ok && !isPoor(a) && !/Still under construction|Restocking|Setup|Duel over|duel is over/.test(a.reason || "");
/** Upgrades of the selected tower in the bottom bar: upgrades from the left, sell pinned right. */
/**
 * Tapping an upgrade: done at once when possible; otherwise it is queued like a pre-build and
 * runs as soon as there is gold (or construction ends). Tapping the queued one again cancels it.
 */
function upgradeTap(tw, id) {
  const a = available(game, own, "upgrade", id, tw.id),
    mine = upQueue.find((q) => q.towerId === tw.id);
  if (mine?.id === id) {
    upQueue = upQueue.filter((q) => q.towerId !== tw.id);
    note("Queued upgrade cancelled.");
    tone("tap");
    renderCards();
    return;
  }
  if (a.ok) {
    upQueue = upQueue.filter((q) => q.towerId !== tw.id);
    rememberUpgrade(id);
    dispatch({ type: "upgrade", id, towerId: tw.id });
    return;
  }
  if (isPoor(a) || /Still under construction/.test(a.reason || "")) {
    rememberUpgrade(id);
    upQueue = upQueue.filter((q) => q.towerId !== tw.id).concat({ towerId: tw.id, id, from: tw.typeId });
    note(isPoor(a) ? "Upgrade queued: starts as soon as you have enough gold." : "Upgrade queued: starts when construction is done.");
    tone("tap");
    renderCards();
    return;
  }
  toast(a.reason || "Not possible right now.");
  tone("error");
}
// ---- double tap = upgrade (v0.08a) -----------------------------------------------------------
// The bot remembers the upgrades you chose (newest first). A double tap repeats the newest one
// this tower can still reach; several levels ahead, the whole chain is queued step by step.
let upHistory = [],
  upHistoryGame = null;
function rememberUpgrade(id) {
  if (upHistoryGame !== game) {
    upHistory = [];
    upHistoryGame = game;
  }
  upHistory = [id, ...upHistory.filter((x) => x !== id)].slice(0, 24);
}
/** Upgrade steps from one tower type to another (ids after `fromId`), or null. */
function upgradePath(fromId, targetId) {
  if (fromId === targetId) return null;
  const queue = [[fromId, []]],
    seen = new Set([fromId]);
  while (queue.length) {
    const [id, path] = queue.shift();
    for (const next of catalog.byId[id]?.upgrades || []) {
      if (seen.has(next) || !catalog.byId[next]) continue;
      const steps = [...path, next];
      if (next === targetId) return steps;
      seen.add(next);
      queue.push([next, steps]);
    }
  }
  return null;
}
function doubleUpgrade(tw) {
  const options = (catalog.byId[tw.typeId]?.upgrades || []).filter((id) => catalog.byId[id] && !isLocked(available(game, own, "upgrade", id, tw.id)));
  selectedTower = tw.id;
  if (!options.length) {
    note("Highest level reached");
    showTower(tw);
    return;
  }
  if (upHistoryGame !== game) upHistory = [];
  let chain = null;
  for (const target of upHistory) {
    const steps = upgradePath(tw.typeId, target);
    if (steps && options.includes(steps[0])) {
      chain = steps;
      break;
    }
  }
  if (!chain && options.length === 1) chain = options;
  if (!chain) {
    showTower(tw);
    note("Several upgrades: pick one in the menu once, then a double tap repeats your choice.");
    return;
  }
  let from = tw.typeId;
  upQueue = upQueue.filter((q) => q.towerId !== tw.id).concat(
    chain.map((id) => {
      const step = { towerId: tw.id, id, from };
      from = id;
      return step;
    }),
  );
  rememberUpgrade(chain[chain.length - 1]);
  const goal = catalog.byId[chain[chain.length - 1]];
  runQueue();
  showTower(tw);
  renderCards();
  if (chain.length > 1) note(t("{n} upgrades queued up to {name}", { n: chain.length, name: `${itemName(goal)} Level ${goal.level || 1}` }));
  else if (upQueue.some((q) => q.towerId === tw.id)) note("Upgrade queued: starts as soon as you have enough gold.");
  tone("upgrade");
}
function upgradeDeck(tw) {
  const item = catalog.byId[tw.typeId],
    ups = item.upgrades
      .map((id) => catalog.byId[id])
      .filter((u) => u && !isLocked(available(game, own, "upgrade", u.id, tw.id))),
    sell = getSellValue(game, own, tw.id),
    refund = typeof sell === "number" ? sell : sell?.gold || 0;
  $("deck-title").textContent = `${t("Upgrade")} · ${itemName(item)}`;
  $("cards").classList.toggle("many", ups.length > 3);
  $("cards").innerHTML =
    ups
      .map((u) => {
        const a = available(game, own, "upgrade", u.id, tw.id),
          locked = false,
          waiting = upQueue.some((q) => q.towerId === tw.id && q.id === u.id),
          name = `${itemName(u)} Level ${u.level || 1}`;
        const afterBuild = /Still under construction/.test(a.reason || "");
        return `<button class="unit-card up-card ${a.ok || afterBuild ? "" : "unaffordable"} ${isPoor(a) ? "poor" : ""} ${waiting ? "queued" : ""}" data-upgrade="${u.id}" aria-label="${esc(t("Upgrade to {name}, {cost} gold", { name, cost: format(u.cost) }))}${a.ok ? "" : ", " + esc(t(a.reason))}" title="${esc(a.ok ? name : t(a.reason))}"><span class="up-title">${esc(name)}</span><span class="up-art"><img src="${towerArtUrl(artFor(u))}" alt=""></span><span class="up-cost"><span class="price">${format(u.cost)}</span>${u.woodCost ? `<span class="price wood-price">${format(u.woodCost)}</span>` : ""}</span><i class="up-arrow" aria-hidden="true"></i>${waiting ? '<span class="up-queued">⏳</span>' : ""}${locked ? `<span class="up-lock">${esc(t(a.reason))}</span>` : ""}</button>`;
      })
      .join("") +
    (ups.length ? "" : `<div class="up-empty">${t("Highest level reached")}</div>`) +
    `<button class="unit-card up-card sell-card" id="up-sell" aria-label="${esc(t("Sell {name} for {gold} gold", { name: itemName(item), gold: format(refund) }))}"><span class="up-title">${t("Sell")}</span><span class="up-art"><img src="${iconUrl("coin")}" alt=""></span><span class="up-cost"><span class="price">+${format(refund)}</span></span></button>`;
  $("cards").querySelectorAll("[data-upgrade]").forEach((b) => (b.onclick = () => upgradeTap(tw, b.dataset.upgrade)));
  $("up-sell").onclick = () => {
    dispatch({ type: "sell", towerId: tw.id });
    closeUpgradeDeck();
  };
  $("deck-tip").hidden = true;
  $("deck-expand").hidden = true;
  $("deck-count").textContent = "";
  deckSignature = deckSig();
  requestAnimationFrame(updateDeckArrows);
}
let deckClosed = { at: 0, towerId: null };
function closeUpgradeDeck() {
  if (!selectedTower) return;
  deckClosed = { at: performance.now(), towerId: selectedTower };
  selectedTower = null;
  renderCards();
}
// A press anywhere outside the bottom bar closes the upgrade bar.
document.addEventListener(
  "pointerdown",
  (e) => {
    if (!upgradeTower()) return;
    if (e.target.closest?.(".command-deck") || e.target.closest?.("dialog")) return;
    closeUpgradeDeck();
  },
  true,
);
/** Tapping a tower opens its upgrade bar; tapping the same tower again shows its details. */
let lastTowerTap = { id: null, at: 0 };
function onTowerTap(tower, at = performance.now(), point = null) {
  if (volleyAim && view === own) return fireVolley(point?.fx ?? tower.x, point?.fy ?? tower.y);
  const now = at || performance.now(),
    double = lastTowerTap.id === tower.id && now - lastTowerTap.at < (window.felitoTestDoubleTapMs || 380);
  lastTowerTap = { id: tower.id, at: double ? 0 : now };
  if (view === own && double && dblMode === "upgrade") {
    deckClosed = { at: 0, towerId: null };
    doubleUpgrade(tower);
    return;
  }
  const again = selectedTower === tower.id || (deckClosed.towerId === tower.id && performance.now() - deckClosed.at < 600);
  if (view === own && again && !(double && dblMode === "off")) {
    deckClosed = { at: 0, towerId: null };
    selectedTower = null;
    renderCards();
    itemDetail(tower.typeId, tower.id, own);
    return;
  }
  showTower(tower);
}
function cardMarkup(item) {
  const a = available(game, own, cardAction(item), item.id),
    label = priceLabel(item),
    kindClass = item.kind === "send" ? "card-send" : item.kind === "research" ? "card-research" : "card-tower";
  return `<button class="unit-card ${kindClass} ${item.kind === "send" && (item.bossTier || item.flying) ? "framed" : ""} ${selected === item.id && tab === "build" ? "selected" : ""} ${a.ok ? "" : "unaffordable"} ${isPoor(a) ? "poor" : ""}" data-kind="${item.kind}" data-card="${item.id}" aria-label="${esc(itemName(item))}, ${esc(label)} Gold, ${esc(cardHint(item))}${a.ok ? "" : ", " + esc(t(a.reason))}"><span class="unit-name">${esc(itemName(item))}</span><span class="card-art"><img src="${item.kind === "send" ? artUrl(artFor(item)) : towerArtUrl(artFor(item))}" alt=""></span><span class="card-foot${item.kind === "send" && (label + formatInc(incomeFor(item))).length >= (item.bossTier || item.flying ? 6 : 7) ? " long" : ""}"><span class="price${item.kind === "research" && itemPrice(item).wood ? " wood-price" : ""}${isFreeLabel(label) ? " free" : ""}">${label}</span>${item.kind === "send" ? `<span class="card-note${incomeFor(item) > item.income + 0.004 ? " buffed" : ""}">+${formatInc(incomeFor(item))}</span>` : ""}</span><span class="card-status">${cardStatus(item)}</span>${item.kind === "send" ? `<span class="card-stock">${stockCount(item)}</span>${item.bossTier ? '<i class="frame-boss" aria-hidden="true"></i>' : item.flying ? '<i class="frame-air" aria-hidden="true"></i>' : ""}` : ""}</button>`;
}
function renderCards() {
  if (!game) return;
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("deck-title").textContent =
    tab === "build"
      ? t("Your towers")
      : tab === "send"
        ? t("Creeps · Tier {n}", { n: game.players[own].tier })
        : t("Upgrades & elements");
  $("tier-select").hidden = true;
  const upTower = upgradeTower();
  $("cards").classList.toggle("upgrade-mode", !!upTower);
  if (!upTower) $("cards").classList.remove("many");
  if (upTower) return upgradeDeck(upTower);
  const list = deckItems();
  deckSignature = deckSig();
  $("cards").innerHTML =
    (list.map(cardMarkup).join("") || `<div class="empty-deck">${t("All available upgrades researched.")}</div>`);
  $("cards")
    .querySelectorAll("[data-card]")
    .forEach((b) => {
      b.onclick = () => {
        if (performance.now() < suppressClickUntil) return;
        selectCard(b.dataset.card);
      };
      if (tab === "build") b.addEventListener("pointerdown", startCardDrag);
      if (tab === "send") b.addEventListener("pointerdown", startSendHold);
    });
  if (sendHold) $("cards").querySelector(`[data-card="${sendHold.id}"]`)?.classList.add("holding");
  $("deck-tip").hidden = tab !== "build";
  $("deck-tip").textContent = "Elementhalle →";
  $("deck-expand").hidden = list.length <= 4;
  $("deck-count").textContent = t("All {n}", { n: list.length });
  if (!$("deck-sheet").hidden) renderSheet(list);
  requestAnimationFrame(updateDeckArrows);
  refreshAutoSend();
}
// ---- Deck navigation: swipe strip with arrows, and an "All" sheet with every card ----
function updateDeckArrows() {
  const strip = $("cards"),
    more = strip.scrollWidth - strip.clientWidth > 4;
  const left = more && strip.scrollLeft > 4,
    right = more && strip.scrollLeft < strip.scrollWidth - strip.clientWidth - 4;
  $("deck-prev").hidden = !left;
  $("deck-next").hidden = !right;
  strip.classList.toggle("more-left", left);
  strip.classList.toggle("more-right", right);
}
function scrollDeck(direction) {
  const strip = $("cards"),
    card = strip.querySelector(".unit-card");
  const step = card ? (card.offsetWidth + 6) * 3 : strip.clientWidth * 0.75;
  strip.scrollBy({ left: direction * step, behavior: "smooth" });
}
/** On the send tab, bring the strongest affordable monster into view. */
function scrollDeckToBest() {
  if (tab !== "send") return;
  const strip = $("cards"),
    cards = [...strip.querySelectorAll("[data-card]")],
    best = cards.filter((b) => !b.classList.contains("unaffordable") && !catalog.byId[b.dataset.card]?.bossTier).pop();
  if (!best) return;
  const target = best.offsetLeft + best.offsetWidth - strip.clientWidth + 10;
  strip.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
}
function renderSheet(list = deckItems()) {
  const titles = { build: t("All towers"), send: t("All creeps · Tier {n}", { n: game.players[own].tier }), research: t("All upgrades") };
  $("sheet-title").textContent = titles[tab];
  $("sheet-sub").textContent = tab === "send" ? t("Tap sends at once") : tab === "build" ? t("Pick, then tap a field") : "";
  $("sheet-cards").innerHTML = list.map(cardMarkup).join("");
  $("sheet-cards")
    .querySelectorAll("[data-card]")
    .forEach((b) => {
      b.onclick = () => {
        selectCard(b.dataset.card);
        // Sending stays open for several buys in a row; building needs the field.
        if (tab !== "send") closeSheet();
      };
    });
}
function openSheet() {
  if (!game) return;
  renderSheet();
  $("deck-sheet").hidden = false;
  $("deck-backdrop").hidden = false;
  $("deck-expand").setAttribute("aria-expanded", "true");
  document.querySelector(".game-shell").classList.add("sheet-open");
  tone("tap");
}
function closeSheet() {
  if ($("deck-sheet").hidden) return;
  $("deck-sheet").hidden = true;
  $("deck-backdrop").hidden = true;
  $("deck-expand").setAttribute("aria-expanded", "false");
  document.querySelector(".game-shell").classList.remove("sheet-open");
}
function selectCard(id) {
  const item = catalog.byId[id];
  if (!item) return;
  if (tab === "build") {
    if (selected === id && !drag) {
      selected = null;
      pending = null;
      renderCards();
      refreshUI();
      return;
    }
    selected = id;
    pending = null;
    view = own;
    selectedTower = null;
    $("tower-panel").hidden = true;
    renderCards();
    refreshUI();
    tone("select");
    const a = available(game, own, "build", id);
    // v0.09n: missing gold shows at the placement preview, no extra banner
    if (!drag && !a.ok && !isPoor(a)) toast(a.reason);
    else if (!drag && tipsEnabled) toast(t("{name} · tap a field or drag the card onto the board", { name: itemName(item) }));
  } else if (tab === "send") {
    lastSendCards[own] = id;
    dispatch({ type: "send", id });
    refreshAutoSend();
  } else researchDetail(id);
}
// ---- Level rewards ---------------------------------------------------------------------
let openingShown = "";
/** Art for a level perk (v0.08b). */
// v0.09q: drawn perk symbols (SVG), loaded with the page
// v0.09v: painted style like the crown/sword icons, generated by dev/art/reward-icons.py
const PERK_SVG = {"arrowhead": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n</defs><g filter=\"url(#drop)\"><g transform=\"rotate(40 128 128)\">\n<rect x=\"114\" y=\"176\" width=\"28\" height=\"74\" rx=\"9\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<rect x=\"114\" y=\"200\" width=\"28\" height=\"10\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"3\"/><rect x=\"114\" y=\"220\" width=\"28\" height=\"10\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"3\"/>\n<polygon points=\"128,8 196,150 160,138 148,166 108,166 96,138 60,150\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<polygon points=\"128,8 128,166 108,166 96,138 60,150\" fill=\"url(#steelL)\"/>\n<polygon points=\"128,8 196,150 160,138 148,166 108,166 96,138 60,150\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<line x1=\"128\" y1=\"14\" x2=\"128\" y2=\"160\" stroke=\"#ffffff\" stroke-width=\"2.5\" opacity=\".8\"/>\n<path d=\"M118 40 L84 128\" stroke=\"#fff\" stroke-width=\"9\" stroke-linecap=\"round\" filter=\"url(#soft)\" opacity=\".9\"/>\n<rect x=\"94\" y=\"156\" width=\"68\" height=\"30\" rx=\"10\" fill=\"url(#goldH)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<path d=\"M100 164 H156\" stroke=\"#fff6b0\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\".8\"/>\n</g><g transform=\"translate(97 154)\"><rect x=\"-17\" y=\"-17\" width=\"34\" height=\"34\" rx=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<path d=\"M-11 -11H11V11H-11Z\" fill=\"#0a2a80\" stroke=\"#161c33\" stroke-width=\"2.5\"/><path d=\"M-11 -11L0 0L11 -11Z\" fill=\"#7fd0ff\"/><path d=\"M-11 -11L0 0L-11 11Z\" fill=\"#3a8cff\"/><path d=\"M11 -11L0 0L11 11Z\" fill=\"#1450c8\"/><path d=\"M-11 11L0 0L11 11Z\" fill=\"#0c3494\"/><circle cx=\"-4.95\" cy=\"-6.050000000000001\" r=\"2.42\" fill=\"#fff\"/></g></g></svg>", "militia": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n</defs><g filter=\"url(#drop)\"><g><polygon points=\"93.3,185.3 226.1,52.5 236.0,20.0 203.5,29.9 70.7,162.7\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><polygon points=\"93.3,185.3 226.1,52.5 236.0,20.0 82.0,174.0\" fill=\"url(#steelL)\"/><polyline points=\"93.3,185.3 226.1,52.5 236.0,20.0 203.5,29.9 70.7,162.7\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><line x1=\"82.0\" y1=\"174.0\" x2=\"236.0\" y2=\"20.0\" stroke=\"#ffffff\" stroke-width=\"2\" opacity=\".7\"/>\n<g transform=\"rotate(45 78 178)\"><rect x=\"34\" y=\"166\" width=\"88\" height=\"22\" rx=\"9\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"5\"/><rect x=\"67\" y=\"186\" width=\"22\" height=\"44\" rx=\"6\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"4\"/><circle cx=\"78\" cy=\"240\" r=\"13\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/></g><g transform=\"translate(78 178)\"><rect x=\"-14\" y=\"-14\" width=\"28\" height=\"28\" rx=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<path d=\"M-8 -8H8V8H-8Z\" fill=\"#0a2a80\" stroke=\"#161c33\" stroke-width=\"2.5\"/><path d=\"M-8 -8L0 0L8 -8Z\" fill=\"#7fd0ff\"/><path d=\"M-8 -8L0 0L-8 8Z\" fill=\"#3a8cff\"/><path d=\"M8 -8L0 0L8 8Z\" fill=\"#1450c8\"/><path d=\"M-8 8L0 0L8 8Z\" fill=\"#0c3494\"/><circle cx=\"-3.6\" cy=\"-4.4\" r=\"1.76\" fill=\"#fff\"/></g></g>\n<g transform=\"translate(150 150) scale(.84) translate(-136 -140)\">\n<circle cx=\"136\" cy=\"140\" r=\"86\" fill=\"url(#shieldWood)\" stroke=\"#24170f\" stroke-width=\"6\"/>\n<clipPath id=\"sc\"><circle cx=\"136\" cy=\"140\" r=\"74\"/></clipPath>\n<g clip-path=\"url(#sc)\"><rect x=\"56\" y=\"50\" width=\"34\" height=\"190\" fill=\"#000\" opacity=\".12\"/><rect x=\"124\" y=\"50\" width=\"34\" height=\"190\" fill=\"#000\" opacity=\".12\"/><rect x=\"192\" y=\"50\" width=\"34\" height=\"190\" fill=\"#000\" opacity=\".12\"/>\n<path d=\"M90 50V240M124 50V240M158 50V240M192 50V240\" stroke=\"#4a220a\" stroke-width=\"3\" opacity=\".7\"/></g>\n<circle cx=\"136\" cy=\"140\" r=\"80\" fill=\"none\" stroke=\"url(#goldH)\" stroke-width=\"13\"/>\n<circle cx=\"136\" cy=\"140\" r=\"86\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"5\"/><circle cx=\"136\" cy=\"140\" r=\"73\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"3.5\"/>\n<path d=\"M76 104 A70 70 0 0 1 118 66\" stroke=\"#fff6b0\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\" opacity=\".8\"/>\n<circle cx=\"136\" cy=\"140\" r=\"27\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"5\"/><circle cx=\"136\" cy=\"140\" r=\"16\" fill=\"url(#gem)\" stroke=\"#161c33\" stroke-width=\"3\"/><circle cx=\"130\" cy=\"134\" r=\"5\" fill=\"#fff\"/>\n<path d=\"M96 96 Q110 82 132 78\" stroke=\"#fff\" stroke-width=\"10\" fill=\"none\" stroke-linecap=\"round\" filter=\"url(#soft2)\" opacity=\".55\"/></g></g></svg>", "novice": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n</defs><g filter=\"url(#drop)\"><path d=\"M44 52 H196 V212 H60 Z\" fill=\"url(#parch)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<rect x=\"30\" y=\"34\" width=\"180\" height=\"34\" rx=\"17\" fill=\"url(#roll)\" stroke=\"#24170f\" stroke-width=\"6\"/><circle cx=\"47\" cy=\"51\" r=\"11\" fill=\"#c08a46\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<rect x=\"44\" y=\"198\" width=\"180\" height=\"32\" rx=\"16\" fill=\"url(#roll)\" stroke=\"#24170f\" stroke-width=\"6\"/><circle cx=\"207\" cy=\"214\" r=\"10\" fill=\"#c08a46\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<g stroke=\"#8a5a2a\" stroke-width=\"7\" stroke-linecap=\"round\" opacity=\".55\"><path d=\"M70 98H170M70 124H178M70 150H150M70 176H130\"/></g>\n<path d=\"M60 84 Q56 140 66 196\" stroke=\"#fff\" stroke-width=\"8\" fill=\"none\" filter=\"url(#soft)\" opacity=\".7\"/>\n<circle cx=\"160\" cy=\"176\" r=\"18\" fill=\"url(#red)\" stroke=\"#24170f\" stroke-width=\"4\"/><circle cx=\"154\" cy=\"170\" r=\"5\" fill=\"#fff\" opacity=\".8\"/>\n<path d=\"M120 214 Q150 120 238 18 Q232 96 150 196 Z\" fill=\"url(#feather)\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M126 206 Q170 118 232 26\" stroke=\"#161c33\" stroke-width=\"4\" fill=\"none\"/>\n<path d=\"M150 168 Q186 110 222 54\" stroke=\"#fff\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\" opacity=\".9\"/>\n<path d=\"M170 140 l-14 -6 M186 116 l-14 -6 M202 92 l-14 -6\" stroke=\"#9cbbe6\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n<path d=\"M112 238 L120 206 L140 214 Z\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/></g></svg>", "volley": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n</defs><g filter=\"url(#drop)\"><g stroke=\"#ffffff\" stroke-linecap=\"round\" opacity=\".45\" filter=\"url(#soft)\" stroke-width=\"7\"><path d=\"M30 14 L44 56 M106 6 L118 40 M182 20 L194 56\"/></g>\n<g transform=\"translate(58 120) rotate(-18) scale(1.05)\">\n<path d=\"M-12 -86 L-28 -112 L-26 -76 L-10 -58 Z M12 -86 L28 -112 L26 -76 L10 -58 Z\" fill=\"url(#red)\" stroke=\"#24170f\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/>\n<rect x=\"-8\" y=\"-96\" width=\"16\" height=\"118\" rx=\"6\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"4.5\"/>\n<rect x=\"-10\" y=\"6\" width=\"20\" height=\"12\" rx=\"4\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3.5\"/>\n<polygon points=\"0,66 -22,14 22,14\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><polygon points=\"0,66 -22,14 0,14\" fill=\"url(#steelL)\"/>\n<polygon points=\"0,66 -22,14 22,14\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/></g><g transform=\"translate(196 108) rotate(-18) scale(1.05)\">\n<path d=\"M-12 -86 L-28 -112 L-26 -76 L-10 -58 Z M12 -86 L28 -112 L26 -76 L10 -58 Z\" fill=\"url(#red)\" stroke=\"#24170f\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/>\n<rect x=\"-8\" y=\"-96\" width=\"16\" height=\"118\" rx=\"6\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"4.5\"/>\n<rect x=\"-10\" y=\"6\" width=\"20\" height=\"12\" rx=\"4\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3.5\"/>\n<polygon points=\"0,66 -22,14 22,14\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><polygon points=\"0,66 -22,14 0,14\" fill=\"url(#steelL)\"/>\n<polygon points=\"0,66 -22,14 22,14\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/></g><g transform=\"translate(128 150) rotate(-18) scale(1.15)\">\n<path d=\"M-12 -86 L-28 -112 L-26 -76 L-10 -58 Z M12 -86 L28 -112 L26 -76 L10 -58 Z\" fill=\"url(#red)\" stroke=\"#24170f\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/>\n<rect x=\"-8\" y=\"-96\" width=\"16\" height=\"118\" rx=\"6\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"4.5\"/>\n<rect x=\"-10\" y=\"6\" width=\"20\" height=\"12\" rx=\"4\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3.5\"/>\n<polygon points=\"0,66 -22,14 22,14\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><polygon points=\"0,66 -22,14 0,14\" fill=\"url(#steelL)\"/>\n<polygon points=\"0,66 -22,14 22,14\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/></g></g></svg>", "evolution": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n</defs><g filter=\"url(#drop)\"><clipPath id=\"fl\"><circle cx=\"128\" cy=\"160\" r=\"76\"/></clipPath>\n<path d=\"M104 34 H152 V92 A78 78 0 1 1 104 92 Z\" fill=\"url(#glass)\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<g clip-path=\"url(#fl)\"><rect x=\"40\" y=\"128\" width=\"180\" height=\"120\" fill=\"url(#potion)\"/><ellipse cx=\"128\" cy=\"128\" rx=\"76\" ry=\"9\" fill=\"#f0b4ff\"/>\n<circle cx=\"96\" cy=\"196\" r=\"7\" fill=\"#f6c8ff\" opacity=\".7\"/><circle cx=\"160\" cy=\"214\" r=\"5\" fill=\"#f6c8ff\" opacity=\".7\"/><circle cx=\"148\" cy=\"176\" r=\"4\" fill=\"#f6c8ff\" opacity=\".7\"/></g>\n<path d=\"M104 34 H152 V92 A78 78 0 1 1 104 92 Z\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M76 140 Q80 112 104 100\" stroke=\"#fff\" stroke-width=\"12\" fill=\"none\" stroke-linecap=\"round\" filter=\"url(#soft)\" opacity=\".9\"/><circle cx=\"176\" cy=\"122\" r=\"7\" fill=\"#fff\" opacity=\".85\" filter=\"url(#soft)\"/>\n<rect x=\"96\" y=\"12\" width=\"64\" height=\"34\" rx=\"9\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"5\"/><rect x=\"98\" y=\"42\" width=\"60\" height=\"12\" rx=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<path d=\"M80 150 H176 L168 214 H88 Z\" fill=\"url(#parch)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M128 156 L160 188 H142 V208 H114 V188 H96 Z\" fill=\"url(#green)\" stroke=\"#0e3a08\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M124 166 L106 184\" stroke=\"#efffc8\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\".9\"/></g></svg>", "pillage": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n</defs>\n<g filter=\"url(#drop)\">\n<g transform=\"rotate(32 150 120)\">\n<rect x=\"118\" y=\"150\" width=\"20\" height=\"40\" rx=\"7\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<rect x=\"96\" y=\"140\" width=\"64\" height=\"16\" rx=\"6\" fill=\"url(#goldH)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<polygon points=\"128,6 152,140 104,140\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<polygon points=\"128,6 128,140 104,140\" fill=\"url(#steelL)\"/>\n<polygon points=\"128,6 152,140 104,140\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<circle cx=\"128\" cy=\"196\" r=\"9\" fill=\"url(#gem)\" stroke=\"#161c33\" stroke-width=\"3\"/>\n</g>\n<path d=\"M70 132 C40 170 46 236 128 238 C210 236 216 170 186 132 Z\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M84 146 C66 176 70 214 108 226\" stroke=\"#c98a52\" stroke-width=\"7\" stroke-linecap=\"round\" fill=\"none\" opacity=\".55\"/>\n<path d=\"M90 120 Q128 136 166 120 L172 140 Q128 156 84 140 Z\" fill=\"#6e3a16\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M92 132 Q128 146 164 132\" stroke=\"url(#red)\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\"/>\n<ellipse cx=\"108\" cy=\"112\" rx=\"16\" ry=\"12.8\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"108\" cy=\"110\" rx=\"9.6\" ry=\"7.2\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/><ellipse cx=\"146\" cy=\"106\" rx=\"16\" ry=\"12.8\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"146\" cy=\"104\" rx=\"9.6\" ry=\"7.2\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/><ellipse cx=\"128\" cy=\"92\" rx=\"15\" ry=\"12.0\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"128\" cy=\"90\" rx=\"9.0\" ry=\"6.8\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/><ellipse cx=\"176\" cy=\"196\" rx=\"14\" ry=\"11.2\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"176\" cy=\"194\" rx=\"8.4\" ry=\"6.3\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/><ellipse cx=\"196\" cy=\"218\" rx=\"13\" ry=\"10.4\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"196\" cy=\"216\" rx=\"7.8\" ry=\"5.9\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/><ellipse cx=\"64\" cy=\"214\" rx=\"12\" ry=\"9.6\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"64\" cy=\"212\" rx=\"7.2\" ry=\"5.4\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/>\n<path d=\"M112 102 l6 -8\" stroke=\"#fff\" stroke-width=\"4\" stroke-linecap=\"round\" filter=\"url(#soft)\"/>\n</g></svg>", "crowd": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n</defs>\n<g filter=\"url(#drop)\">\n<g transform=\"rotate(-20 128 128)\">\n<rect x=\"150\" y=\"30\" width=\"16\" height=\"210\" rx=\"7\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<rect x=\"148\" y=\"150\" width=\"20\" height=\"10\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"3\"/>\n<path d=\"M158 40 C120 22 66 30 30 70 C70 52 112 52 156 66 Z\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M150 46 C116 34 72 40 44 62 C78 50 112 50 150 58 Z\" fill=\"url(#steelL)\"/>\n<rect x=\"146\" y=\"38\" width=\"24\" height=\"30\" rx=\"5\" fill=\"url(#goldH)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n</g>\n<g transform=\"translate(70 196) scale(1.05)\"><path d=\"M-22 -4 C-22 -30 22 -30 22 -4 C22 8 14 12 12 16 L12 24 H-12 L-12 16 C-14 12 -22 8 -22 -4 Z\" fill=\"url(#parch)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<ellipse cx=\"-9\" cy=\"-2\" rx=\"6\" ry=\"7\" fill=\"#24170f\"/><ellipse cx=\"9\" cy=\"-2\" rx=\"6\" ry=\"7\" fill=\"#24170f\"/><path d=\"M0 6 L-4 13 H4 Z\" fill=\"#24170f\"/>\n<path d=\"M-6 24 V18 M0 24 V18 M6 24 V18\" stroke=\"#24170f\" stroke-width=\"3\"/><path d=\"M-14 -16 Q-6 -24 4 -24\" stroke=\"#fff\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\" opacity=\".8\"/></g><g transform=\"translate(124 214) scale(1.15)\"><path d=\"M-22 -4 C-22 -30 22 -30 22 -4 C22 8 14 12 12 16 L12 24 H-12 L-12 16 C-14 12 -22 8 -22 -4 Z\" fill=\"url(#parch)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<ellipse cx=\"-9\" cy=\"-2\" rx=\"6\" ry=\"7\" fill=\"#24170f\"/><ellipse cx=\"9\" cy=\"-2\" rx=\"6\" ry=\"7\" fill=\"#24170f\"/><path d=\"M0 6 L-4 13 H4 Z\" fill=\"#24170f\"/>\n<path d=\"M-6 24 V18 M0 24 V18 M6 24 V18\" stroke=\"#24170f\" stroke-width=\"3\"/><path d=\"M-14 -16 Q-6 -24 4 -24\" stroke=\"#fff\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\" opacity=\".8\"/></g><g transform=\"translate(184 198) scale(1.0)\"><path d=\"M-22 -4 C-22 -30 22 -30 22 -4 C22 8 14 12 12 16 L12 24 H-12 L-12 16 C-14 12 -22 8 -22 -4 Z\" fill=\"url(#parch)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<ellipse cx=\"-9\" cy=\"-2\" rx=\"6\" ry=\"7\" fill=\"#24170f\"/><ellipse cx=\"9\" cy=\"-2\" rx=\"6\" ry=\"7\" fill=\"#24170f\"/><path d=\"M0 6 L-4 13 H4 Z\" fill=\"#24170f\"/>\n<path d=\"M-6 24 V18 M0 24 V18 M6 24 V18\" stroke=\"#24170f\" stroke-width=\"3\"/><path d=\"M-14 -16 Q-6 -24 4 -24\" stroke=\"#fff\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\" opacity=\".8\"/></g>\n</g></svg>", "golem": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n</defs>\n<g filter=\"url(#drop)\">\n<path d=\"M52 92 C44 60 72 34 128 34 C184 34 212 60 204 92 L214 176 C218 214 182 236 128 236 C74 236 38 214 42 176 Z\" fill=\"#8a7a66\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M60 92 C56 66 80 46 128 46 C150 46 168 50 180 58 C150 54 92 58 76 96 L66 170 C62 190 70 206 84 214 C58 204 52 186 54 170 Z\" fill=\"#b8a68a\" opacity=\".85\"/>\n<path d=\"M86 64 L104 92 L92 120 M172 70 L156 100 L170 128 M120 196 L132 214 L124 232\" stroke=\"#3e2f22\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n<path d=\"M78 128 Q100 112 118 130 Q100 144 78 128 Z\" fill=\"#24170f\"/><path d=\"M138 130 Q156 112 178 128 Q156 144 138 130 Z\" fill=\"#24170f\"/>\n<path d=\"M70 112 L122 120 L118 104 L74 98 Z\" fill=\"#5e5040\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/><path d=\"M186 112 L134 120 L138 104 L182 98 Z\" fill=\"#5e5040\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/><ellipse cx=\"98\" cy=\"129\" rx=\"10\" ry=\"6\" fill=\"#ffb02e\"/><ellipse cx=\"158\" cy=\"129\" rx=\"10\" ry=\"6\" fill=\"#ffb02e\"/>\n<ellipse cx=\"98\" cy=\"129\" rx=\"4\" ry=\"3\" fill=\"#fff6c0\"/><ellipse cx=\"158\" cy=\"129\" rx=\"4\" ry=\"3\" fill=\"#fff6c0\"/>\n<path d=\"M94 184 Q128 172 162 184\" stroke=\"#24170f\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M30 118 C10 112 4 136 20 146 C34 154 44 140 42 128\" fill=\"#8a7a66\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M226 118 C246 112 252 136 236 146 C222 154 212 140 214 128\" fill=\"#8a7a66\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<g transform=\"translate(206 70)\"><path d=\"M0 -26 C12 -10 12 10 0 26 C-12 10 -12 -10 0 -26Z\" fill=\"url(#green)\" stroke=\"#0e3a08\" stroke-width=\"4\"/><path d=\"M0 -20 V20\" stroke=\"#efffc8\" stroke-width=\"3\" opacity=\".8\"/></g>\n<path d=\"M80 60 Q100 48 124 48\" stroke=\"#fff\" stroke-width=\"6\" fill=\"none\" stroke-linecap=\"round\" filter=\"url(#soft)\" opacity=\".7\"/>\n</g></svg>"};
const svgUrl = (name) => "data:image/svg+xml," + encodeURIComponent(PERK_SVG[name]);
const PERK_ART = {
  recruit: () => iconUrl("attack"),
  feudal: () => iconUrl("crown"),
  archery: () => svgUrl("arrowhead"),
  patrol: () => towerArtUrl("tower-archer"),
  militia: () => svgUrl("militia"),
  evolution: () => svgUrl("evolution"),
  gold: () => iconUrl("coin"),
  novice: () => svgUrl("novice"),
  volley: () => svgUrl("volley"),
  pillage: () => svgUrl("pillage"),
  crowd: () => svgUrl("crowd"),
  golem: () => svgUrl("golem"),
};
/** Perk text with its numbers filled in (the gold perk shows the amount, not the formula). */
const perkText = (id, level) => t(PERKS[id].text, { gold: format(perkGold(level)) });
const elementOf = (id) => catalog.factions.find((f) => f.id === id);
function pickCard(o, i, p) {
  if (o.type === "element") {
    const f = elementOf(o.id);
    return `<button class="pick-card pick-element el-${f.id}" data-pick="${i}" style="--el:${f.color}"><img src="${iconUrl(ELEMENT_ICON[f.id])}" alt=""><b>${esc(t(f.name))}</b><span>${t("New element towers and upgrades")}</span></button>`;
  }
  if (o.type === "research") {
    const item = catalog.byId[o.id],
      level = p.research[o.id] || 0,
      el = elementOf(RESEARCH_ELEMENT[o.id]);
    return `<button class="pick-card${el ? " pick-element el-" + el.id : ""}" data-pick="${i}"${el ? ` style="--el:${el.color}"` : ""}><img src="${artUrl(artFor(item))}" alt=""><b>${esc(itemName(item))}</b><span>${esc(cardHint(item))}</span><small>${t("Level {a} → {b}", { a: level, b: level + 1 })}</small></button>`;
  }
  if (o.type === "perk") {
    const d = PERKS[o.id],
      level = p.perks?.[o.id] || 0,
      pel = d.element ? elementOf(d.element) : null; // v0.10n: element perks get the element frame
    return `<button class="pick-card pick-perk perk-${o.id}${pel ? " pick-element el-" + pel.id : ""}" data-pick="${i}"${pel ? ` style="--el:${pel.color}"` : ""}><img src="${PERK_ART[o.id]()}" alt="">${o.id === "patrol" ? '<i class="perk-badge">×2</i>' : ""}<b>${esc(t(d.name))}</b><span>${esc(perkText(o.id, p.picks[0]?.level || p.level))}</span><small>${t("Level {a} → {b}", { a: level, b: level + 1 })}</small></button>`;
  }
  const [icon, title, note] =
    o.type === "gold"
      ? ["coin", `+${format(o.amount)} Gold`, t("Instant")]
      : o.type === "income"
        ? ["income", t("+{n} income", { n: format(o.amount) }), t("Every round")]
        : ["heart", t("+{n} lives", { n: o.amount }), t("Instant")];
  return `<button class="pick-card pick-generic" data-pick="${i}"><img src="${iconUrl(icon)}" alt=""><b>${title}</b><span>${note}</span></button>`;
}
/** Rewards taken so far, as small tiles with their level (v0.08b). */
/** v0.08c: with no reward waiting, the level button shows what every player has chosen so far. */
function playerName(q) {
  if (q.id === own) return t("You");
  if (isFfa()) return seatName(q.id);
  if (sessionMode === "training") return `${t("AI")} · ${t(AI_NAMES[q.aiLevel || game.aiLevel] || "Normal")}`;
  if (sessionMode === "online") return t("Enemy");
  return t(q.id === 0 ? "Player 1" : "Player 2");
}
function abilitiesModal() {
  const p = game?.players[own];
  if (!p) return;
  const order = [p, ...game.players.filter((q) => q.id !== own)],
    colors = seatColors(),
    section = (q) =>
      `<div class="abil-player${q.out ? " out" : ""}" style="--pc:${TEAM_COLORS[colors[q.id]]?.css || "#6a8496"}"><div class="abil-head"><b>${esc(playerName(q))}</b><span>Lv ${q.level} · ${format(Math.floor(q.exp))}/${format(q.expNext)} EXP</span></div>${ownedTiles(q, { names: true, label: false }) || `<p class="modal-note">${t("No abilities chosen yet.")}</p>`}</div>`;
  showModal(
    `${modalHeader(t("Abilities"))}${order.map(section).join("")}<p class="modal-note">${t("Level {n}: collect EXP for the next reward.", { n: p.level })}</p>`,
    { pauseGame: sessionMode !== "online" },
  );
}
function ownedTiles(p, { names = false, label = true } = {}) {
  // v0.09: every tile carries its effect for the hover / tap tooltip (data-tip)
  const tiles = [],
    tile = (cls, style, name, img, level, text) => {
      const tip = ` data-tip="${esc(name)}" data-tip-text="${esc(text || "")}" data-tip-level="${level || ""}"`;
      return names
        ? `<span class="owned-chip"${tip}><span class="owned-tile${cls}"${style}><img src="${img}" alt="">${level ? `<b>${level}</b>` : ""}</span><span>${esc(name)}</span></span>`
        : `<span class="owned-tile${cls}"${style}${tip}><img src="${img}" alt="">${level ? `<b>${level}</b>` : ""}</span>`;
    };
  for (const f of catalog.factions)
    if (p.research[f.unlock]) tiles.push(tile(` el-${f.id}`, ` style="--el:${f.color}"`, t(f.name), iconUrl(ELEMENT_ICON[f.id]), 0, t("Element: unlocks its towers and upgrades.")));
  for (const r of catalog.research) {
    const level = p.research[r.id] || 0;
    if (!level || !r.playerResearch || !r.playable || catalog.factions.some((f) => f.research === r.id)) continue;
    const el = elementOf(RESEARCH_ELEMENT[r.id]);
    tiles.push(tile(el ? " el-" + el.id : "", el ? ` style="--el:${el.color}"` : "", itemName(r), artUrl(artFor(r)), level, cardHint(r)));
  }
  for (const [id, level] of Object.entries(p.perks || {}))
    if (level && PERKS[id]) tiles.push(tile(` perk-${id}`, "", t(PERKS[id].name), PERK_ART[id](), level, perkText(id, p.level)));
  return tiles.length ? `<div class="owned-row">${label ? `<span class="modal-label">${t("Already chosen")}</span>` : ""}<div class="owned-tiles${names ? " named" : ""}">${tiles.join("")}</div></div>` : "";
}
/** The level reward dialog: three choices, an element on the opening pick and at levels 10 and 25. */
function pickModal() {
  const p = game?.players[own],
    pick = p?.picks[0];
  if (!pick) return abilitiesModal();
  const title = pick.kind === "element" ? (pick.level <= 1 ? t("Choose your first element") : t("Level {n}: new element", { n: pick.level })) : t("Level {n}: choose a reward", { n: pick.level });
  showModal(
    `${modalHeader(title)}<div class="pick-grid">${pick.options.map((o, i) => pickCard(o, i, p)).join("")}</div>${ownedTiles(p)}<p class="modal-note">${p.picks.length > 2 ? t("{n} more rewards after this.", { n: p.picks.length - 1 }) : p.picks.length > 1 ? t("One more reward after this.") : t("EXP comes from breakthroughs, EXP generators and boss purchases.")}</p>`,
    { pauseGame: sessionMode !== "online" },
  );
  $("modal-body")
    .querySelectorAll("[data-pick]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const result = dispatch({ type: "pick", index: Number(b.dataset.pick) });
          if (result && !result.ok) return;
          tone("upgrade");
          if (game.players[own].picks.length && room?.role !== "guest") pickModal();
          else closeModal();
        }),
    );
}
function refreshLevelButton(p) {
  const btn = $("level-button");
  btn.hidden = !begun;
  if (!begun) return;
  $("level-number").textContent = p.level;
  $("level-pending").hidden = !p.picks.length;
  const unspent = String(p.picks.length);
  if ($("level-pending").textContent !== unspent) $("level-pending").textContent = unspent;
  // v0.09t: the button fills with experience from the bottom up
  const fill = Math.round(Math.max(0, Math.min(1, p.exp / Math.max(1, p.expNext))) * 1000) / 10 + "%";
  if (btn.style.getPropertyValue("--xp") !== fill) btn.style.setProperty("--xp", fill);
  btn.classList.toggle("ready", p.picks.length > 0);
  // Left of the board: the level button on top, the auto-spawn slot at the bottom edge.
  const z = arena?.geometry?.();
  if (z?.side) {
    const dock = $("side-dock"),
      size = Math.round(z.side.w),
      x = Math.round(z.side.x) + "px",
      bottom = z.top + z.bh, // v0.09: no exit strip
      dockTop = Math.round(bottom - (dock.offsetHeight || size + 34)) + "px",
      top = Math.round(z.side.y + 14) + "px";
    if (dock.style.left !== x || dock.style.top !== dockTop) Object.assign(dock.style, { left: x, top: dockTop, width: size + "px" });
    dock.style.setProperty("--slot", size + "px");
    if (btn.style.left !== x) btn.style.left = x;
    if (btn.style.top !== top) btn.style.top = top;
    btn.style.setProperty("--slot", size + "px");
  }
  // the opening element choice opens by itself
  const key = `${game.seed}:${own}`;
  if (p.picks[0]?.kind === "element" && p.picks[0].level <= 1 && openingShown !== key && !$("modal").open && game.running) {
    openingShown = key;
    pickModal();
  }
}
/** Tier up: a glare sweeps across every send button. */
function tierGlow() {
  [...$("cards").querySelectorAll(".unit-card")].forEach((card, i) => {
    const glare = document.createElement("i");
    glare.className = "tier-glare";
    glare.style.animationDelay = `${i * 45}ms`;
    card.appendChild(glare);
    setTimeout(() => glare.remove(), 1600 + i * 45);
  });
}
/** Next neutral wave: type, countdown and a warning when the defence cannot hit it. */
function refreshWaveChip(p) {
  const chip = $("wave-chip"),
    next = game.waves && game.running ? nextWave(game) : null;
  chip.hidden = !next;
  if (!next) return;
  const seconds = Math.max(0, Math.ceil(next.seconds)),
    hitsAir = p.towers.some((t) => catalog.byId[t.typeId]?.targets?.includes("air")),
    airRisk = (next.flying || next.mixed) && !hitsAir;
  chip.dataset.kind = next.type;
  chip.classList.toggle("soon", seconds <= 6);
  chip.classList.toggle("risk", airRisk);
  $("wave-text").textContent = `${t("Wave {n}", { n: next.number })} · ${t(next.label)}`;
  $("wave-time").textContent = seconds + "s";
  chip.title = t(next.tip);
  if (airRisk && seconds <= 12 && warnedWave !== next.number && begun) {
    warnedWave = next.number;
    toast("Flyers incoming! Only archers, magic and halls hit air.");
  }
}
const matchClock = () =>
  game ? `${String(Math.floor(game.time / 60)).padStart(2, "0")}:${String(Math.floor(game.time % 60)).padStart(2, "0")}` : "00:00";
function refreshUI() {
  if (!game) return;
  const p = game.players[own],
    enemy = game.players[rivalIndex()];
  if (enemy.id !== shownRival) {
    shownRival = enemy.id;
    applyColors();
  }
  $("gold").textContent = resourceNumber(Math.floor(p.gold));
  $("gold").title = format(Math.floor(p.gold)) + " Gold";
  $("income").textContent = "+" + resourceNumber(p.income + (p.incomeDecimal || 0) / 100);
  $("income").title = t("+{n} income", { n: format(p.income + (p.incomeDecimal || 0) / 100) });
  bumpNumber("own-lives", p.lives);
  const incomeOf = (pl) => "+" + resourceNumber(Math.floor(pl.income)); // whole numbers only (v0.07j)
  $("gold-income").textContent = incomeOf(p);
  $("own-gold").textContent = resourceNumber(Math.floor(p.gold));
  $("own-income").textContent = incomeOf(p);
  $("rival-gold").textContent = resourceNumber(Math.floor(enemy.gold));
  $("rival-income").textContent = incomeOf(enemy);
  for (const [prefix, pl] of [["own", p], ["rival", enemy]]) {
    $(prefix + "-exp").style.width = `${Math.min(100, (100 * pl.exp) / Math.max(1, pl.expNext))}%`;
    $(prefix + "-level").textContent = pl.level;
  }
  refreshLevelButton(p);
  refreshVolley(p);
  bumpNumber("rival-lives", enemy.lives);
  renderEnemyStack();
  setPortrait(document.querySelector(".player-plate.rival .plate-face .portrait"), enemy);
  document.querySelector(".player-plate.own").classList.toggle("out", !!p.out);
  document.querySelector(".player-plate.rival").classList.toggle("out", !isFfa() && !!enemy.out);
  updateNudge(p);
  const secs = Math.max(0, Math.ceil(game.incomeRemaining));
  $("income-time").textContent = secs;
  $("income-time").classList.toggle("soon", secs <= 3 && !game.paused && game.running);
  if ($("menu-clock")) $("menu-clock").textContent = matchClock();
  $("income-ring").style.strokeDashoffset = 106.82 * (1 - Math.min(1, game.incomeRemaining / (game.warmup ? 12 : 15)));
  $("match-clock").textContent = matchClock();
  $("speed-label").textContent = game.paused ? "PAUSE" : game.warmup ? t("SETUP") : "LIVE";
  $("speed-button").hidden = !!room || !begun;
  if (room || !begun) gameSpeed = 1;
  $("speed-button").textContent = gameSpeed + "×";
  $("speed-button").classList.toggle("fast", gameSpeed > 1);
  $("rival-name").textContent =
    sessionMode === "ffa"
      ? `${seatName(enemy.id)} · ${t(AI_NAMES[enemy.aiLevel || game.aiLevel] || "Normal")}`
      : sessionMode === "training"
        ? `${t("AI")} · ${t(AI_NAMES[game.aiLevel] || "Normal")}`
        : t(own === 0 ? "Player 2" : "Player 1");
  $("rival-sub").textContent = t(sessionMode === "training" || sessionMode === "ffa" ? "AI" : sessionMode === "hotseat" ? "Local" : connected ? "Connected" : "Connecting …");
  $("arena-label").textContent = view === own ? t("Your arena") : isFfa() ? seatName(view) : t("Enemy");
  $("view-button").textContent = t(tab !== "build" ? "Back" : view === own ? "Enemy" : "Back");
  $("view-button").classList.toggle("active", view !== own);
  $("round-label").textContent = game.warmup ? t("Setup") : t("Round {n}", { n: game.round });
  refreshWaveChip(p);
  $("arena-hint").textContent =
    tab !== "build" || view !== own
      ? ""
      : selected && !selectedTower
        ? t("Tap a free field")
        : p.towers.length === 0
          ? t("Pick a tower below")
          : "";
  if (deckSig() !== deckSignature) renderCards();
  document.querySelectorAll("#cards [data-card], #sheet-cards [data-card]").forEach((b) => {
    const item = catalog.byId[b.dataset.card],
      a = available(game, own, cardAction(item), item.id),
      label = priceLabel(item);
    b.classList.toggle("unaffordable", !a.ok);
    b.classList.toggle("poor", isPoor(a));
    b.querySelector(".price").textContent = label;
    b.querySelector(".price").classList.toggle("free", isFreeLabel(label));
    const note = item.kind === "send" ? b.querySelector(".card-note") : null;
    if (note) {
      const inc = incomeFor(item),
        text = "+" + formatInc(inc);
      if (note.textContent !== text) note.textContent = text;
      note.classList.toggle("buffed", inc > item.income + 0.004);
    }
    b.querySelector(".card-status").textContent = cardStatus(item);
    const stock = b.querySelector(".card-stock");
    if (stock) stock.textContent = stockCount(item);
    b.setAttribute("aria-label", `${itemName(item)}, ${label}, ${cardHint(item)}${a.ok ? "" : ", " + t(a.reason)}`);
  });
  refreshAutoSend();
}
/** A 2×2 hall is placed with the tapped field as its top-left corner, pulled inside the board. */
function anchorFor(id, gridX, gridY) {
  const n = id ? footprintOf(id) : 1;
  if (n === 1 || !game) return { gridX, gridY };
  return {
    gridX: Math.max(0, Math.min(game.grid.cols - n, gridX)),
    gridY: Math.max(0, Math.min(game.grid.rows - n, gridY)),
  };
}
function onCell(tapped) {
  if (volleyAim && view === own) return fireVolley(tapped.fx ?? (tapped.gridX + 0.5) / game.grid.cols, tapped.fy ?? (tapped.gridY + 0.5) / game.grid.rows);
  if (tab !== "build") return;
  if (performance.now() - deckClosed.at < 600) return;
  if (view !== own) {
    if (selected) toast("Switch to your arena.");
    return;
  }
  if (!selected) {
    note("Pick a tower first.");
    return;
  }
  selectedTower = null;
  $("tower-panel").hidden = true;
  const hitQueued = queued.find((q) => {
    const n = footprintOf(q.id);
    return tapped.gridX >= q.gridX && tapped.gridX < q.gridX + n && tapped.gridY >= q.gridY && tapped.gridY < q.gridY + n;
  });
  if (hitQueued) {
    queued = queued.filter((q) => q !== hitQueued);
    note("Pre-build cancelled.");
    return;
  }
  const cell = anchorFor(selected, tapped.gridX, tapped.gridY);
  const check = canBuild(game, own, cell.gridX, cell.gridY, selected);
  if (tryQueue(selected, cell.gridX, cell.gridY, check)) return;
  if (!check.ok) {
    pending = { gridX: cell.gridX, gridY: cell.gridY, until: performance.now() + 1400 };
    toast(check.reason);
    tone("error");
    return;
  }
  const afford = available(game, own, "build", selected);
  const confirmed = pending && pending.gridX === cell.gridX && pending.gridY === cell.gridY && pending.ok;
  if (buildPreview && !confirmed && afford.ok) {
    pending = { gridX: cell.gridX, gridY: cell.gridY, ok: true };
    tone("tap");
    return;
  }
  pending = null;
  dispatch({ type: "build", id: selected, ...cell });
}
/** Pre-build: remember a tower that is blocked only by a creep or by missing gold/wood. */
function tryQueue(id, gridX, gridY, check) {
  const a = available(game, own, "build", id),
    blockedByCreep = !check.ok && /creep/i.test(check.reason || ""),
    poor = check.ok && !a.ok && /more gold/.test(a.reason || "");
  if (!blockedByCreep && !poor) return false;
  if (blockedByCreep && !a.ok && !/more gold/.test(a.reason || "")) return false;
  if (!queued.some((q) => q.gridX === gridX && q.gridY === gridY)) queued.push({ id, gridX, gridY });
  note(blockedByCreep ? "Pre-build: builds as soon as the field is free." : "Pre-build: builds as soon as you can afford it.");
  tone("tap");
  return true;
}
let queueTime = 0;
function runQueue() {
  if (queuedFor !== game) {
    queued = [];
    upQueue = [];
    queuedFor = game;
  }
  if (!begun) return;
  // queued upgrades first come, first served
  if (upQueue.length) {
    const p = game.players[own],
      waiting = [];
    let changed = false;
    const busy = new Set(); // later steps of a chain wait for the earlier ones
    for (const q of upQueue) {
      if (busy.has(q.towerId)) {
        waiting.push(q);
        continue;
      }
      const t = p.towers.find((x) => x.id === q.towerId);
      if (!t || t.typeId !== q.from) {
        changed = true;
        continue;
      }
      const a = available(game, own, "upgrade", q.id, q.towerId);
      if (a.ok) {
        dispatch({ type: "upgrade", id: q.id, towerId: q.towerId });
        changed = true;
        busy.add(q.towerId);
        continue;
      }
      if (isPoor(a) || /Still under construction/.test(a.reason || "")) {
        waiting.push(q);
        busy.add(q.towerId);
      } else changed = true;
    }
    upQueue = waiting;
    if (changed) renderCards();
  }
  if (!queued.length) return syncAutoHold();
  const keep = [];
  for (const q of queued) {
    if (towerAt(game.players[own], q.gridX, q.gridY)) continue;
    const c = canBuild(game, own, q.gridX, q.gridY, q.id),
      a = available(game, own, "build", q.id);
    if (c.ok && a.ok) {
      // a guest's command goes to the host; the next check sees the tower
      const result = dispatch({ type: "build", id: q.id, gridX: q.gridX, gridY: q.gridY }, { quiet: true, fromQueue: true });
      if (result?.ok || room?.role === "guest") continue;
    }
    if (!c.ok && !/creep/i.test(c.reason || "")) continue;
    if (!a.ok && !/more gold/.test(a.reason || "")) continue;
    keep.push(q);
  }
  queued = keep;
  syncAutoHold();
}
/** Auto-spawn waits while pre-builds or upgrades are queued (v0.08b); the flag goes through a command. */
function syncAutoHold() {
  const p = game?.players?.[own];
  if (!p || !begun) return;
  const hold = queued.length > 0 || upQueue.length > 0;
  if (!!p.autoHold !== hold) dispatch({ type: "autoHold", hold }, { quiet: true });
}
/** v0.09: the field under the mouse while a tower card is selected (placement preview). */
let hoverCell = null;
/** Placement preview shared by tap-to-confirm, card dragging and mouse hover. */
function currentPreview() {
  if (!game || !selected || tab !== "build" || view !== own) return null;
  const at = drag?.cell || pending || (drag ? null : hoverCell);
  if (!at) return null;
  if (pending?.until && performance.now() > pending.until) {
    pending = null;
    return null;
  }
  const anchored = anchorFor(selected, at.gridX, at.gridY),
    result = previewBuild(game, own, anchored.gridX, anchored.gridY, selected),
    afford = available(game, own, "build", selected);
  return {
    ...result,
    ok: result.ok && afford.ok,
    reason: result.ok ? afford.reason : result.reason,
    player: own,
    id: selected,
    size: footprintOf(selected),
    confirm: !drag && !!pending?.ok,
  };
}

// ---- hold a monster card: send it 15 times per second --------------------------------
let sendHold = null,
  lastQuietTone = 0;
const SEND_HOLD_RATE = 15,
  SEND_HOLD_DELAY = 250;
// A tap sends once (on release), holding sends 15 per second, dragging moves the creep into the
// auto-spawn slot. The same pointer logic lets you drag the slot's creep out to clear it.
let sendPress = null;
function startSendHold(e) {
  if (tab !== "send" || (e.button ?? 0) > 0 || !begun) return;
  const id = e.currentTarget.dataset.card;
  stopSendHold();
  e.preventDefault();
  suppressClickUntil = Infinity; // the click after a press is handled here, not by onclick
  sendPress = { id, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, mode: "tap", fromSlot: false };
  sendHold = { id, interval: null };
  sendHold.timer = setTimeout(() => {
    if (!sendHold || sendPress?.mode !== "tap") return;
    sendPress.mode = "hold";
    $("cards").querySelector(`[data-card="${id}"]`)?.classList.add("holding");
    const fire = () => {
      if (!sendHold || tab !== "send" || !begun) return stopSendHold();
      if (!available(game, own, "send", sendHold.id).ok) return;
      lastSendCards[own] = sendHold.id;
      dispatch({ type: "send", id: sendHold.id }, { quiet: true });
    };
    fire();
    sendHold.interval = setInterval(fire, 1000 / SEND_HOLD_RATE);
  }, SEND_HOLD_DELAY);
}
function startSlotPress(e) {
  if ((e.button ?? 0) > 0 || !begun) return;
  const id = game.players[own].autoSend;
  e.preventDefault();
  sendPress = { id, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, mode: "tap", fromSlot: true };
}
function overSlot(x, y) {
  const r = $("auto-slot").getBoundingClientRect();
  return x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8;
}
document.addEventListener(
  "pointermove",
  (e) => {
    const sp = sendPress;
    if (!sp || e.pointerId !== sp.pointerId || !sp.id) return;
    const moved = Math.hypot(e.clientX - sp.x0, e.clientY - sp.y0);
    // A slow drag start may already have turned into a hold; pulling clearly away still drags.
    if ((sp.mode === "tap" && moved > 10) || (sp.mode === "hold" && moved > 28)) {
      sp.mode = "drag";
      clearTimeout(sendHold?.timer);
      clearInterval(sendHold?.interval);
      document.querySelectorAll("#cards .holding").forEach((b) => b.classList.remove("holding"));
      const ghost = $("drag-ghost");
      ghost.src = artUrl(artFor(catalog.byId[sp.id]));
      ghost.hidden = false;
      ghost.classList.add("creep-ghost");
    }
    if (sp.mode === "drag") {
      // the creep sits centred under the finger or pointer
      const ghost = $("drag-ghost"),
        box = document.querySelector(".game-shell").getBoundingClientRect(),
        half = (ghost.offsetWidth || 56) / 2;
      ghost.style.left = "0px";
      ghost.style.top = "0px";
      ghost.style.transform = `translate(${e.clientX - box.left - half}px, ${e.clientY - box.top - half}px)`;
      $("auto-slot").classList.toggle("drop-target", overSlot(e.clientX, e.clientY));
    }
  },
  { passive: true },
);
function stopSendHold(e) {
  const sp = sendPress;
  sendPress = null;
  if (sp && (!e || e.type !== "blur")) {
    const ghost = $("drag-ghost");
    if (sp.mode === "drag") {
      ghost.hidden = true;
      ghost.classList.remove("creep-ghost");
      $("auto-slot").classList.remove("drop-target");
      const inside = e && overSlot(e.clientX, e.clientY);
      if (!sp.fromSlot && inside) {
        dispatch({ type: "autoSend", id: sp.id, active: true });
        tone("select");
      } else if (sp.fromSlot && !inside) {
        dispatch({ type: "autoSend", id: null, active: false });
        tone("sell");
      }
    } else if (sp.mode === "tap" && e?.type === "pointerup") {
      if (sp.fromSlot) {
        const p = game.players[own];
        if (p.autoSend) dispatch({ type: "autoSend", active: p.autoSendActive === false });
      } else selectCard(sp.id);
    }
  }
  if (!sendHold) {
    if (suppressClickUntil === Infinity) suppressClickUntil = performance.now() + 60;
    refreshAutoSend();
    return;
  }
  clearTimeout(sendHold.timer);
  clearInterval(sendHold.interval);
  sendHold = null;
  suppressClickUntil = performance.now() + 60;
  document.querySelectorAll("#cards .holding").forEach((b) => b.classList.remove("holding"));
  refreshAutoSend();
}
document.addEventListener("pointerup", stopSendHold);
document.addEventListener("pointercancel", (e) => {
  if (sendPress) sendPress.mode = sendPress.mode === "drag" ? "drag" : "cancel";
  stopSendHold(e);
});
window.addEventListener("blur", stopSendHold);

// ---- drag a tower card onto the field ---------------------------------------
let suppressClickUntil = 0;
function startCardDrag(e) {
  if (tab !== "build" || (e.button ?? 0) > 0 || !begun) return;
  drag = { id: e.currentTarget.dataset.card, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, active: false, cell: null };
}
function dragTarget(e) {
  // Aim slightly above the finger so the target cell stays visible.
  const cell = arena?.gridAtClient(e.clientX, e.clientY - 38);
  if (!cell || !game) return null;
  return cell.gridX >= 0 && cell.gridX < game.grid.cols && cell.gridY >= 0 && cell.gridY < game.grid.rows ? cell : null;
}
document.addEventListener(
  "pointermove",
  (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.x0,
      dy = e.clientY - drag.y0;
    if (!drag.active) {
      if (dy < -14 && Math.abs(dy) > Math.abs(dx) * 1.1) {
        drag.active = true;
        selectCard(drag.id);
        const ghost = $("drag-ghost");
        ghost.src = artUrl(artFor(catalog.byId[drag.id]));
        ghost.hidden = false;
      } else if (Math.abs(dx) > 12) {
        drag = null;
        return;
      } else return;
    }
    e.preventDefault();
    const ghost = $("drag-ghost"),
      box = document.querySelector(".game-shell").getBoundingClientRect();
    ghost.style.transform = `translate(${e.clientX - box.left - 30}px, ${e.clientY - box.top - 78}px)`;
    drag.cell = dragTarget(e);
    ghost.classList.toggle("over-field", !!drag.cell);
  },
  { passive: false },
);
function endCardDrag(e, cancelled = false) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;
  $("drag-ghost").hidden = true;
  if (!d.active) return;
  suppressClickUntil = performance.now() + 400;
  if (cancelled || !d.cell) return;
  pending = null;
  const at = anchorFor(d.id, d.cell.gridX, d.cell.gridY);
  const check = canBuild(game, own, at.gridX, at.gridY, d.id);
  if (tryQueue(d.id, at.gridX, at.gridY, check)) return;
  if (!check.ok) {
    toast(check.reason);
    tone("error");
    return;
  }
  dispatch({ type: "build", id: d.id, gridX: at.gridX, gridY: at.gridY });
}
document.addEventListener("pointerup", (e) => endCardDrag(e));
document.addEventListener("pointercancel", (e) => endCardDrag(e, true));

// ---- HUD feedback -------------------------------------------------------------
const shownNumbers = {};
function bumpNumber(id, value) {
  const el = $(id);
  if (shownNumbers[id] !== undefined && shownNumbers[id] !== value) {
    el.classList.remove("bump-up", "bump-down");
    void el.offsetWidth;
    el.classList.add(value > shownNumbers[id] ? "bump-up" : "bump-down");
  }
  shownNumbers[id] = value;
  el.textContent = value;
}
/** v0.09w: First Blood — a short bloody pop-up and a grim orc shout for everyone. */
function firstBlood(e) {
  const mine = e.player === own;
  if (mine) hudPop("#own-level", `+${e.exp ?? 50} EXP`, "exp");
  const pop = document.createElement("div");
  pop.className = "first-blood";
  pop.innerHTML = `<svg viewBox="0 0 200 120" aria-hidden="true"><path d="M100 8c14 0 18 14 30 10s22-6 26 6-8 18 4 24 30 4 28 18-20 10-26 18 6 22-8 26-20-8-30-2-10 12-24 10-14-12-26-14-24 10-34 0 4-18-6-26-28-6-30-20 16-14 20-22-10-18 2-26 22 4 30-2S86 8 100 8Z" fill="#9e0b0b"/><circle cx="18" cy="30" r="5" fill="#9e0b0b"/><circle cx="186" cy="92" r="6" fill="#9e0b0b"/><circle cx="168" cy="14" r="3.5" fill="#9e0b0b"/><circle cx="34" cy="104" r="4" fill="#9e0b0b"/><path d="M60 100q2 14 0 18M128 104q3 10 1 14" stroke="#9e0b0b" stroke-width="5" stroke-linecap="round"/></svg><b>${t("First Blood!")}</b><small>${esc(playerName(game.players[e.player]))} · +${e.exp ?? 50} EXP</small>`;
  $("app")?.appendChild(pop) || document.body.appendChild(pop);
  setTimeout(() => pop.remove(), 2400);
  sfx.play("firstBlood");
  haptic([60, 40, 90]);
  // the voice line: a deep, slow orc shout through the browser's speech synthesis
  try {
    if (!sfx.enabled || !window.speechSynthesis) return;
    const say = new SpeechSynthesisUtterance("First blood! Zug zug!");
    say.lang = "en-US";
    say.pitch = 0.1;
    say.rate = 0.82;
    say.volume = 1;
    const voices = speechSynthesis.getVoices().filter((v) => v.lang?.startsWith("en"));
    say.voice = voices.find((v) => /male|david|daniel|fred|george|guy|mark/i.test(v.name) && !/female/i.test(v.name)) || voices[0] || null;
    speechSynthesis.cancel();
    setTimeout(() => speechSynthesis.speak(say), 250);
  } catch {}
}
function hudPop(anchorSelector, text, kind = "gold") {
  const anchor = document.querySelector(anchorSelector);
  if (!anchor) return;
  const pop = document.createElement("span");
  pop.className = `hud-pop ${kind}`;
  pop.textContent = text;
  anchor.append(pop);
  setTimeout(() => pop.remove(), 1300);
}
let bannerTimer;
/** Important events: no banner over the board any more, a short note at the bottom edge instead. */
function banner(title, sub = "", kind = "boss") {
  toast(sub ? `${t(title)} ${t(sub)}` : title, kind);
}
function updateNudge(p) {
  const tabButton = document.querySelector('[data-tab="send"]');
  if (!tabButton || !begun || !catalog) return;
  const cheapest = catalog.sends
    .filter((s) => s.playable && s.tier === p.tier && !s.bossTier)
    .reduce((min, s) => Math.min(min, s.cost), Infinity);
  const sinceAction = game.time - Math.max(lastSendTime, game.rules?.warmup ?? 12);
  const idle = !game.warmup && game.running && tab !== "send" && sinceAction > 25 && p.gold >= cheapest * 2;
  tabButton.classList.toggle("nudge", idle);
  if (idle && tipsEnabled && nudgeShown < 2 && sinceAction > 25 + nudgeShown * 60) {
    nudgeShown++;
    toast("Gold to spare? Send creeps – it raises your income for good.");
  }
}

// ---- first-game coaching --------------------------------------------------------
let coachSeen = new Set();
try {
  coachSeen = new Set(JSON.parse(pref(COACH_PREF, "[]")));
} catch {}
const COACH_STEPS = {
  start: {
    title: "Build",
    text: "Pick a tower below and tap a field. Towers lengthen the creeps' path: the longer the path, the longer your towers shoot.",
  },
  built: {
    title: "Attack",
    text: "After the setup phase: under <b>Send</b>, send creeps to your enemy. Every group raises your income for good. Whoever never sends loses the arms race.",
    requires: "start",
    tab: "send",
  },
  sent: {
    title: "Income",
    text: "Your income arrives every 15 seconds (green ring at the top). The small map on the right shows your creeps at the enemy. If creeps break through on your side, build more.",
    requires: "built",
  },
};
function coach(key) {
  const step = COACH_STEPS[key];
  if (!tipsEnabled || !step || coachSeen.has(key) || sessionMode === "online") return;
  if (step.requires && !coachSeen.has(step.requires)) return;
  coachSeen.add(key);
  savePref(COACH_PREF, JSON.stringify([...coachSeen]));
  const box = $("coach");
  box.innerHTML = `<div><b>${esc(t(step.title))}</b><p>${t(step.text)}</p></div><button type="button" id="coach-ok">OK</button>`;
  box.hidden = false;
  box.classList.remove("show");
  void box.offsetWidth;
  box.classList.add("show");
  if (step.tab) document.querySelector(`[data-tab="${step.tab}"]`)?.classList.add("nudge");
  clearTimeout(coach.timer);
  coach.timer = setTimeout(() => (box.hidden = true), 14000);
  $("coach-ok").onclick = () => {
    box.hidden = true;
    tone("tap");
  };
}

function showTower(towerOrId) {
  const id = typeof towerOrId === "object" ? towerOrId.id : towerOrId;
  const p = game.players[view],
    tower = p.towers.find((t) => t.id === id);
  if (!tower) {
    selectedTower = null;
    $("tower-panel").hidden = true;
    return;
  }
  selectedTower = id;
  if (view === own) {
    $("tower-panel").hidden = true;
    if (tab !== "build") setPage("build");
    if (deckSig() !== deckSignature) renderCards();
    return;
  }
  const item = catalog.byId[tower.typeId],
    stats = getStats(game, view, tower.typeId),
    upgrades = item.upgrades.map((id) => catalog.byId[id]).filter(Boolean),
    sell = getSellValue(game, view, id);
  const renderKey = [
    view,
    id,
    tower.typeId,
    Math.ceil(tower.buildRemaining),
    stats.damage,
    stats.range,
    stats.cooldown,
    stats.hp,
    view === own ? upgrades.map((u) => (available(game, own, "upgrade", u.id, id).ok ? 1 : 0)).join("") : "",
  ].join(":");
  if (!$("tower-panel").hidden && $("tower-panel").dataset.renderKey === renderKey) return;
  $("tower-panel").dataset.renderKey = renderKey;
  $("tower-panel").hidden = false;
  $("tower-panel").innerHTML =
    `<div class="tower-panel-top"><img src="${artUrl(artFor(item))}" alt=""><div><h3>${esc(itemName(item))} <small>· ${item.level}</small></h3><div class="tower-stats">${t("{n} damage", { n: format(stats.damage) })} · ${format(stats.cooldown)} s · ${isMeleeTower(item) ? t("Melee · adjacent fields") : t("{n} fields range", { n: format(stats.range / game.grid.cellUnits) })}</div></div><button class="close-tower" aria-label="${t("Close tower info")}">×</button></div>${tower.buildRemaining > 0 ? `<div class="modal-note">${t("Building · {n} s", { n: Math.ceil(tower.buildRemaining) })}</div>` : ""}${
      view === own
        ? `<div class="tower-buttons${upgrades.length > 3 ? " many" : ""}">${upgrades
            .map((u) => {
              const a = available(game, own, "upgrade", u.id, id),
                locked = !a.ok && !/more gold/.test(a.reason || "");
              return `<button data-upgrade="${u.id}" class="upgrade-card ${a.ok ? "" : "unaffordable"} ${locked ? "locked" : ""}" title="${esc(a.ok ? itemName(u) : t(a.reason))}"><img src="${artUrl(artFor(u))}" alt=""><span class="up-name">${esc(itemName(u))}</span>${u.level > 1 ? `<small>Lv ${u.level}</small>` : ""}<span class="cost"><img src="${iconUrl("coin")}" alt="Gold">${format(u.cost)}</span>${locked ? `<span class="up-lock">${esc(t(a.reason))}</span>` : ""}</button>`;
            })
            .join(
              "",
            )}<button class="sell" id="sell-tower">${t("Sell")}<br>+${format(typeof sell === "number" ? sell : sell?.gold || 0)} Gold</button></div>`
        : ""
    }<button id="tower-more" class="text-button">${t("All stats, abilities & upgrade paths ↗")}</button>`;
  $("tower-panel").querySelector(".close-tower").onclick = () => {
    selectedTower = null;
    $("tower-panel").hidden = true;
  };
  $("tower-panel")
    .querySelectorAll("[data-upgrade]")
    .forEach((b) => (b.onclick = () => {
      const t = game.players[own].towers.find((x) => x.id === id);
      if (t) upgradeTap(t, b.dataset.upgrade);
    }));
  if ($("sell-tower"))
    $("sell-tower").onclick = () => {
      dispatch({ type: "sell", towerId: id });
      selectedTower = null;
      $("tower-panel").hidden = true;
    };
  $("tower-more").onclick = () => itemDetail(item.id, id, view);
}
function researchDetail(id) {
  const item = catalog.byId[id],
    owned = (game.players[own].research?.[id] || 0) > 0;
  showModal(
    `${modalHeader(itemName(item))}<img class="modal-hero" src="${artUrl(artFor(item))}" alt=""><p class="modal-copy">${esc(cardHint(item))}</p><div class="rule-row"><strong>${t(owned ? "Already unlocked" : "Level reward")}</strong>${t(owned ? "Active in this match." : "Upgrades come with level-ups: collect EXP from breakthroughs, creeps and EXP generators.")}</div><details class="info-disclosure"><summary>${t("Exact values")}</summary><p class="modal-copy">${esc(item.description).replace(/\n/g, "<br>")}</p></details><button class="primary-button" data-close>${t("Back")}</button>`,
  );
}
function itemDetail(id, towerId, detailPlayer = own) {
  const item = catalog.byId[id],
    stats = item.kind === "research" ? null : getStats(game, detailPlayer, id),
    canAct = detailPlayer === own;
  showModal(
    `${modalHeader(itemName(item))}<img class="modal-hero" src="${artUrl(artFor(item))}" alt=""><p class="modal-copy">${esc(cardHint(item))}</p>${stats ? `<div class="detail-stats"><span><b>${format(stats.damage)}</b>${t("Damage")}</span><span><b>${isMeleeTower(item) ? 1 : format(stats.range / game.grid.cellUnits)}</b>${t(isMeleeTower(item) ? "field around (melee)" : "fields range")}</span><span><b>${format(stats.hp)}</b>${t("Lives")}</span>${item.kind === "send" ? `<span><b>${format(stats.speed / game.grid.cellUnits)}</b>${t("fields / s")}</span>` : ""}</div>` : ""}${
      item.upgrades?.length
        ? `<div class="rule-row"><strong>${t("Upgrade")}</strong>${item.upgrades
            .map((uid) => {
              const u = catalog.byId[uid];
              return `<button class="secondary-button" data-detail-upgrade="${uid}">${esc(itemName(u))} · <span class="cost"><img src="${iconUrl("coin")}" alt="Gold">${format(u.cost)}</span></button>`;
            })
            .join("")}</div>`
        : ""
    }`,
  );
  $("modal-body")
    .querySelectorAll("[data-detail-upgrade]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          if (towerId && canAct) {
            closeModal();
            dispatch({ type: "upgrade", id: b.dataset.detailUpgrade, towerId });
          } else itemDetail(b.dataset.detailUpgrade, undefined, detailPlayer);
        }),
    );
  if (!towerId && canAct && (item.kind === "send" || item.kind === "research" || item.isRoot)) {
    const action = document.createElement("button");
    action.className = "primary-button";
    action.textContent = t(item.kind === "send" ? "Send creep" : item.kind === "research" ? "View upgrade" : "Select tower");
    action.onclick = () => {
      closeModal();
      setPage(item.kind === "send" ? "send" : item.kind === "research" ? "research" : "build");
      selectCard(id);
    };
    $("modal-body").append(action);
  }
}
function catalogModal() {
  showModal(
    `${modalHeader(t("All cards"))}<input class="catalog-search" id="catalog-search" placeholder="${t("Name or original ID …")}" aria-label="${t("Search the catalog")}"><div class="pills"><button class="active" data-filter="tower">${t("Towers")}</button><button data-filter="send">${t("Creeps")}</button><button data-filter="research">${t("Upgrades")}</button></div><div id="catalog-grid" class="catalog-grid"></div>`,
  );
  let filter = "tower";
  const draw = () => {
    const q = $("catalog-search").value.toLowerCase();
    const list = (filter === "tower" ? catalog.towers : filter === "send" ? catalog.sends : catalog.research).filter(
      (u) => [u.name, u.id, itemName(u)].join(" ").toLowerCase().includes(q),
    );
    $("catalog-grid").innerHTML = list.map(cardMarkup).join("");
    $("catalog-grid")
      .querySelectorAll(".unaffordable")
      .forEach((el) => el.classList.remove("unaffordable"));
    $("catalog-grid")
      .querySelectorAll("[data-card]")
      .forEach((b) => (b.onclick = () => itemDetail(b.dataset.card)));
  };
  $("catalog-search").oninput = draw;
  $("modal-body")
    .querySelectorAll("[data-filter]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          filter = b.dataset.filter;
          $("modal-body")
            .querySelectorAll("[data-filter]")
            .forEach((x) => x.classList.toggle("active", x === b));
          draw();
        }),
    );
  draw();
}
const RULES_DE = [
  ["Your goal", "Bring your enemy's 30 lives to zero. Creeps you send run through the enemy's defence. Survivors cost a life and then run on through the next player's field (in a duel, the same one again)."],
  ["The economy", "30 gold and a free archer to start. After 12 seconds of setup: 20 income, then every 15 seconds. Buying creeps raises your income."],
  ["Experience & levels", "The purple bar shows your EXP. Breakthroughs, some creeps and EXP generators give experience. With every level-up you choose one of three rewards from the level button beside the board."],
  ["No juggling", "A new tower may lengthen the way of walking creeps but never force them to turn back. Sold towers open shortcuts only for the next creeps."],
  ["Building & upgrading", "Pick a tower card and tap a field: you see the new path and how many fields longer it gets, a second tap builds. Faster: drag the card straight onto the board. Every row can be built on. Creeps appear at the purple portal strip at the top and break through as soon as they leave the board at the bottom. Towers shape the path; blocking it completely is not allowed. Tap towers to upgrade or sell them. Without enough gold an upgrade is queued and starts by itself."],
  ["Auto-spawn", "Drag a creep card into the frame left of the board: that creep is sent automatically. Tap to switch it off and on, drag it out to clear it."],
  ["Six elements", "Water, fire, storm, earth, arcane and plague. At the start you choose one of three elements; levels 10 and 25 add one more each. All other levels offer upgrades."],
  ["Neutral waves", "From round 3, every two rounds a neutral wave runs through both lanes on top of the creeps sent. Every wave has a trait: swarm, fast, armored, flyers (only anti-air hits), regeneration, magic immune, splitting, mixed, and every tenth is a boss that costs 3 lives. Waves keep getting stronger. A breakthrough costs lives but gives nobody a life. Can be switched on and off in the main menu."],
  ["Stronger creeps", "Buying a boss unlocks the next tier. Armor, damage types, flyers, restocking and groups shape the duel."],
  ["Current port status", "This is a playable 1v1 development build with extracted original data. The mobile board, the AI and some missing Warcraft base values are new. Not every special spell and JASS trigger works exactly like the original yet. Details are on every card and in the project documentation."],
];
function rulesModal() {
  showModal(
    `${modalHeader(t("The rulebook"))}${RULES_DE.map(([h, text]) => `<div class="rule-row"><strong>${t(h)}</strong>${t(text)}</div>`).join("")}<button class="primary-button" data-close>${t("Back to the arena")}</button>`,
  );
}
/** Shared settings, used by the in-game menu and the main-menu options. */
const onOff = (v) => t(v ? "On" : "Off");
function settingsButtons() {
  // v0.09g: no language switch while English is the only language
  return `<button class="secondary-button" id="menu-music" aria-pressed="${musicEnabled}">${t("Music")}: ${onOff(musicEnabled)}</button><button class="secondary-button" id="menu-sound">${t("Sound effects")}: ${onOff(soundEnabled)}</button><button class="secondary-button" id="menu-tips">${t("Tips")}: ${onOff(tipsEnabled)}</button><button class="secondary-button" id="menu-preview">${t("Build with preview")}: ${onOff(buildPreview)}</button><button class="secondary-button" id="menu-lift">${liftText()}</button><button class="secondary-button" id="menu-dbl">${dblText()}</button>`;
}
const dblText = () => `${t("Double tap on a tower")}: ${t({ upgrade: "Upgrade", info: "Tower info", off: "Off" }[dblMode])}`;
const liftText = () => `${t("Raise controls")}: ${liftChoice ? "+" + liftChoice + " px" : t("Off")}`;
function wireSettings(reopen) {
  $("menu-music").onclick = () => {
    musicEnabled = !musicEnabled;
    music.setEnabled(musicEnabled);
    if (musicEnabled) music.unlock();
    try {
      localStorage.setItem(MUSIC_PREF, String(musicEnabled));
    } catch {}
    $("menu-music").textContent = `${t("Music")}: ${onOff(musicEnabled)}`;
    $("menu-music").setAttribute("aria-pressed", String(musicEnabled));
  };
  $("menu-sound").onclick = () => {
    soundEnabled = !soundEnabled;
    sfx.setEnabled(soundEnabled);
    savePref(SOUND_PREF, soundEnabled);
    $("menu-sound").textContent = `${t("Sound effects")}: ${onOff(soundEnabled)}`;
    tone("select");
  };
  $("menu-tips").onclick = () => {
    tipsEnabled = !tipsEnabled;
    savePref(TIPS_PREF, tipsEnabled);
    if (!tipsEnabled) $("coach").hidden = true;
    $("menu-tips").textContent = `${t("Tips")}: ${onOff(tipsEnabled)}`;
  };
  $("menu-preview").onclick = () => {
    buildPreview = !buildPreview;
    savePref(PREVIEW_PREF, buildPreview);
    $("menu-preview").textContent = `${t("Build with preview")}: ${onOff(buildPreview)}`;
    toast(buildPreview ? "First tap shows the new path, second tap builds." : "One tap builds at once.");
  };
  $("menu-dbl").onclick = () => {
    dblMode = DBL_MODES[(DBL_MODES.indexOf(dblMode) + 1) % DBL_MODES.length];
    savePref(DBL_PREF, dblMode);
    $("menu-dbl").textContent = dblText();
    tone("select");
  };
  $("menu-lift").onclick = () => {
    liftChoice = LIFTS[(LIFTS.indexOf(liftChoice) + 1) % LIFTS.length];
    savePref(LIFT_PREF, liftChoice);
    applyLift();
    $("menu-lift").textContent = liftText();
    tone("select");
  };
  $("menu-rules").onclick = rulesModal;
}
/** In-game menu: settings only, rulebook at the bottom. */
const FLAG_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 4v25" stroke="#c9b48a" stroke-width="2.6" stroke-linecap="round"/><path d="M9 5.5c4-2 7 1.5 11 0s5-1.5 7-.5v11c-2-1-3.5-1-7 .5s-7-2-11 0z" fill="#fff" stroke="#9aa6ae" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
/** v0.09: you can give up from the pause menu (1v1: the other side wins, four players: you are out). */
const canSurrender = () => begun && !shownResult && game?.running && !game.players[own]?.out;
function surrender() {
  const result = dispatch({ type: "surrender" });
  if (result && result.ok === false) return;
  closeModal();
}
/** In-game menu: settings only, rulebook at the bottom. The red × closes it. */
function menu() {
  showModal(
    `${canSurrender() ? `<button class="surrender-flag" id="menu-surrender" type="button" aria-label="${t("Surrender")}" title="${t("Surrender")}">${FLAG_SVG}</button>` : ""}${modalHeader(t(room ? "Menu" : "Paused"))}<div id="surrender-confirm" class="surrender-confirm" hidden><b>${t("Really surrender?")}</b><span>${t(isFfa() ? "You drop out of this match." : "Your opponent wins the duel.")}</span><div class="surrender-row"><button class="danger-button" id="surrender-yes" type="button">${t("Surrender")}</button><button class="secondary-button" id="surrender-no" type="button">${t("Resume")}</button></div></div><div class="menu-clock"><img src="${iconUrl("hourglass")}" alt=""><span>${t("Match time")}</span><b id="menu-clock">${matchClock()}</b></div>${sessionMode === "hotseat" ? `<button class="secondary-button" id="switch-player">${t("Switch player")}</button>` : ""}${settingsButtons()}<button class="secondary-button" id="menu-catalog">${t("Card book")}</button><button class="secondary-button" id="menu-rules">${t("Rules & development status")}</button><p class="modal-note">${t("Training is saved automatically.")}</p>`,
  );
  $("modal").classList.toggle("with-flag", canSurrender());
  if ($("menu-surrender")) {
    $("menu-surrender").onclick = () => {
      $("surrender-confirm").hidden = false;
      tone("tap");
    };
    $("surrender-no").onclick = () => ($("surrender-confirm").hidden = true);
    $("surrender-yes").onclick = surrender;
  }
  wireSettings(menu);
  $("menu-catalog").onclick = catalogModal;
  if ($("switch-player"))
    $("switch-player").onclick = () => {
      own = 1 - own;
      selectedTower = null;
      closeModal();
      setPage(tab);
      toast(t("Player {n}", { n: own + 1 }));
    };
}
/** Options from the main menu; closing returns to the main menu. */
function optionsModal() {
  showModal(
    `${modalHeader(t("Options"))}${settingsButtons()}<button class="secondary-button" id="menu-install">${t("Install app")}</button><button class="secondary-button" id="menu-rules">${t("Rules & development status")}</button><button class="primary-button" data-close>${t("Back to the main menu")}</button>`,
  );
  wireSettings(optionsModal);
  $("menu-install").onclick = installHelp;
}
function installHelp() {
  if (installPrompt) {
    installPrompt.prompt();
    installPrompt = null;
    return;
  }
  showModal(
    `${modalHeader(t("Your phone app"))}<img class="modal-hero" src="assets/art/ui-logo.webp" alt="Felito Tower Wars"><p class="modal-copy">${t("<b>iPhone:</b> Open the game address in Safari. Tap Share and “Add to Home Screen”.<br><br><b>Android:</b> Open the address in Chrome. In the browser menu choose “Install app” or “Add to Home screen”.")}</p><p class="modal-note">${t("AI training also works offline after the first full load. A direct duel needs an internet connection. A private deployment needs the owner's sign-in.")}</p><button class="primary-button" data-close>${t("Got it")}</button>`,
  );
}

// Quick Match (v0.10i): automatic 1v1 against the next searching player, no room code.
async function quickMatch() {
  disconnectRoom();
  networkAbort = new AbortController();
  const signal = networkAbort.signal;
  showModal(
    `${modalHeader(t("Quick Match"))}<p class="modal-copy">${t("You'll be paired with the next player who is searching. Keep this page open.")}</p><div id="network-status" class="network-status">${t("Searching for an opponent …")}</div><button class="secondary-button" id="qm-cancel">${t("Cancel")}</button>`,
  );
  $("qm-cancel").onclick = () => {
    networkAbort?.abort();
    closeModal();
  };
  const status = (message) => {
    if ($("network-status")) $("network-status").textContent = message;
  };
  // Closing the dialog any other way (× button) also stops the search.
  const watch = setInterval(() => {
    if (!$("qm-cancel")) networkAbort?.abort();
    if (signal.aborted) clearInterval(watch);
  }, 300);
  try {
    const { findQuickMatch } = await import("./multiplayer.js");
    const match = await findQuickMatch({ signal, onStatus: (s) => status(t(s.message)) });
    clearInterval(watch);
    if (signal.aborted) return;
    status(t("Opponent found! Connecting …"));
    tone("tap");
    if (match.role === "host") connectOnline(undefined, match.code);
    else connectOnline(match.code, true);
  } catch (error) {
    if (signal.aborted) return;
    status(t("Connection failed:") + " " + error.message);
  }
}
function onlineMenu() {
  showModal(
    `${modalHeader(t("Play with a friend"))}<p class="modal-copy">${t("One player opens a room. The other enters the same code. Each defends their own arena.")}</p><button class="primary-button" id="create-room">${t("Open a room →")}</button><label for="room-input" class="modal-label">${t("YOUR OPPONENT'S ROOM CODE")}</label><input id="room-input" maxlength="12" autocomplete="off" autocapitalize="characters" placeholder="XXXXXXXX"><button class="secondary-button" id="join-room">${t("Join room")}</button><div id="network-status" class="network-status">${t("Ready for a direct duel.")}</div><p class="modal-note">${t("Internet required. The connection runs directly over WebRTC; PeerJS brokers the contact. Both devices must be able to open the game page. Some mobile or company networks block direct connections.")}</p>`,
  );
  $("create-room").onclick = () => connectOnline();
  $("join-room").onclick = () => {
    const code = $("room-input").value.trim().toUpperCase();
    if (!code) {
      toast("Enter a room code first.");
      return;
    }
    connectOnline(code);
  };
}
async function connectOnline(code, preset) {
  disconnectRoom();
  lastSendCards.fill(null);
  networkAbort = new AbortController();
  const signal = networkAbort.signal;
  sessionMode = "online";
  begun = false;
  if ($("create-room")) $("create-room").disabled = true;
  if ($("join-room")) $("join-room").disabled = true;
  const status = (message) => {
    if ($("network-status")) $("network-status").textContent = message;
  };
  status(t("Connecting …"));
  try {
    const { createRoom, joinRoom } = await import("./multiplayer.js");
    const callbacks = {
      signal,
      onStatus: (s) => {
        status(t(s.message));
        if (s.state === "error" && !begun) {
          if ($("create-room")) $("create-room").disabled = false;
          if ($("join-room")) $("join-room").disabled = false;
        }
      },
      onConnect: (r) => {
        room = r;
        connected = true;
        own = r.role === "host" ? 0 : 1;
        view = own;
        if (r.role === "guest") r.send({ kind: "ready", faction: chosenFaction });
      },
      onData: receiveNetwork,
      onDisconnect: () => {
        if (signal.aborted) return;
        connected = false;
        if (game) game.paused = true;
        if (!begun) {
          if ($("create-room")) $("create-room").disabled = false;
          if ($("join-room")) $("join-room").disabled = false;
          return;
        }
        toast("The connection was lost. The duel is paused.");
        showModal(
          `${modalHeader(t("Connection lost"))}<p class="modal-copy">${t("The direct duel is paused. Open a new room to play again.")}</p><button class="primary-button" id="network-restart">${t("Open a new room")}</button>`,
        );
        if ($("network-restart")) $("network-restart").onclick = onlineMenu;
      },
    };
    let r;
    if (code && preset) {
      // Quick Match guest: the host registers its room a moment later, so retry briefly.
      for (let tries = 0; ; tries++) {
        await new Promise((ok) => setTimeout(ok, 1200));
        if (signal.aborted) return;
        try {
          r = await joinRoom(code, callbacks);
          break;
        } catch (error) {
          if (tries >= 4 || error.code !== "peer-unavailable") throw error;
        }
      }
    } else r = code ? await joinRoom(code, callbacks) : await createRoom(callbacks, {}, preset);
    if (signal.aborted) {
      r.close();
      return;
    }
    room = r;
    if (!code && !preset && $("network-status")) {
      $("network-status").innerHTML =
        `${t("Your room is open.")}<div class="room-code">${esc(r.code)}</div>${t("Share this code with your opponent. Keep the game page open on both devices.")}`;
    }
  } catch (error) {
    if (signal.aborted) return;
    status(t("Connection failed:") + " " + error.message);
    if ($("create-room")) $("create-room").disabled = false;
    if ($("join-room")) $("join-room").disabled = false;
  }
}
function receiveNetwork(message) {
  if (!message || typeof message !== "object" || !room) return;
  if (message.kind === "transport-pause" && room.role === "guest") {
    game.paused = true;
    toast("Transfer paused. The host is restoring the connection.");
    return;
  }
  if (room.role === "host") {
    if (message.kind === "ready" && !begun) {
      const faction = catalog.factions.some((f) => f.id === message.faction) ? message.faction : "fire";
      game = createGame({
        seed: crypto.getRandomValues(new Uint32Array(1))[0],
        mode: chosenMode,
        factions: [chosenFaction, faction],
        ai: false,
        waves: wavesOn,
      });
      warnedWave = 0;
      own = 0;
      view = 0;
      begun = true;
      shownResult = false;
      game.paused = false;
      uiPauses.clear();
      selected = null;
      lastEvent = 0;
      closeModal();
      setPage("build");
      sendState();
    }
    if (
      message.kind === "command" &&
      begun &&
      message.command &&
      ["build", "send", "upgrade", "sell", "autoSend", "autoHold", "pick", "surrender", "volley"].includes(message.command.type)
    ) {
      const c = message.command,
        id = typeof c.id === "string" ? c.id : c.id === null ? null : undefined;
      const result =
        c.type === "autoSend" && !validAutoSend(id, 1)
          ? { ok: false, reason: "Pick a creep card from your current tier." }
          : command(game, {
              type: c.type,
              id,
              towerId: typeof c.towerId === "string" ? c.towerId : undefined,
              gridX: c.gridX,
              gridY: c.gridY,
              index: Number.isInteger(c.index) ? c.index : undefined,
              active: typeof c.active === "boolean" ? c.active : undefined,
              hold: typeof c.hold === "boolean" ? c.hold : undefined,
              x: typeof c.x === "number" ? c.x : undefined,
              y: typeof c.y === "number" ? c.y : undefined,
              player: 1,
            });
      room.send({ kind: "result", result });
      sendState();
    }
    if (message.kind === "pause" && typeof message.paused === "boolean") {
      // v0.10h: no pauses in PvP; a pause request from the guest is ignored
      networkPauses.clear();
      game.paused = transportBlocked || networkPauses.size > 0;
      sendState();
    }
  } else if (
    message.kind === "state" &&
    message.game?.version === SAVE_VERSION &&
    message.game.players?.length === 2 &&
    isCompatibleGameGrid(message.game)
  ) {
    game = message.game;
    own = 1;
    if (!begun) {
      begun = true;
      shownResult = false;
      uiPauses.clear();
      selected = null;
      lastEvent = 0;
      closeModal();
      setPage("build");
    }
    refreshUI();
  } else if (message.kind === "result") {
    if (!message.result?.ok) toast(message.result?.reason || "Not possible");
    else tone("tap");
    renderCards();
  }
}
function tick(dt) {
  syncMusic();
  if (!game) return;
  if (begun && (!room || room.role === "host") && (!room || connected)) step(game, room ? dt : dt * gameSpeed);
  uiTime += dt;
  queueTime += dt;
  if (queueTime >= 0.25) {
    queueTime = 0;
    runQueue();
  }
  saveTime += dt;
  networkTime += dt;
  if (uiTime >= 0.15) {
    uiTime = 0;
    refreshUI();
    if (selectedTower) showTower(selectedTower);
    for (const e of game.events || []) {
      const seq = e.seq || e.id;
      if (typeof seq !== "number" || seq <= lastEvent) continue;
      lastEvent = seq;
      if (e.type === "volleyStart" && e.player === view) tone("volley");
      if (e.type === "leak" && e.player === own) {
        tone("leak");
        haptic(70);
      }
      if (e.type === "leak" && e.owner === own) {
        tone("breach");
        haptic([15, 40, 15]);
      }
      // v0.10k: Pillage shows the stolen gold on both gold counters
      if (e.type === "pillage" && e.owner === own) hudPop("#own-gold", `+${resourceNumber(e.gold)}`);
      if (e.type === "pillage" && e.player === own) hudPop("#own-gold", `−${resourceNumber(e.gold)}`);
      if (e.type === "send" && e.player === own && e.auto) sendFx(e.id, e.count || 1, true);
      if (e.type === "kill" && e.player === own && view === own) tone("kill");
      if (e.type === "built" && e.player === own) tone("built");
      if (e.type === "income" && e.player === own) {
        tone("bell"); // v0.08c: a new round starts
        hudPop("#own-gold", `+${resourceNumber(e.gold)}`);
        if (e.exp > 0) hudPop("#own-level", `+${resourceNumber(e.exp)} EXP`, "exp");
      }
      if (e.type === "achievement" && e.player === own && e.exp) hudPop("#own-level", `+${e.exp} EXP`, "exp");
      if (e.type === "firstBlood") firstBlood(e);
      if (e.type === "levelUp" && e.player === own) {
        note(t(e.kind === "element" ? "Level {n}: a new element awaits" : "Level {n}: choose a reward", { n: e.level }), "level");
        tone("tier");
      }
      if (e.type === "rotate" && isFfa() && !game.players[own].out) {
        note(t("New target: {name}", { name: seatName(rivalIndex()) }), "level");
        applyColors();
      }
      if (e.type === "eliminated") {
        // v0.09: an eliminated player's field leaves the rotation; whoever looks at it moves on
        if (view === e.player) {
          const next = game.players.find((q) => q.id === own && !q.out) || game.players.find((q) => !q.out);
          if (next) showMaze(next.id);
        }
        renderEnemyStack(true);
        if (e.player === own) ownKnockedOut(e.place);
        else toast(t("{name} is out · place {n}", { name: seatName(e.player), n: e.place }));
      }
      if (e.type === "send" && e.player !== own && catalog.byId[e.id]?.bossTier && (!isFfa() || targetOf(game, e.player).id === own)) {
        banner("Boss attack!", t("{name} is coming down your lane", { name: itemName(catalog.byId[e.id]) }), "boss");
        haptic([40, 60, 40]);
      }
      if (e.type === "wave") {
        // Neutral waves: no big banner over the board, just a flash on the wave chip in the HUD.
        const chip = $("wave-chip");
        chip.classList.remove("arrived");
        void chip.offsetWidth;
        chip.classList.add("arrived");
        clearTimeout(chip.arrivedTimer);
        chip.arrivedTimer = setTimeout(() => chip.classList.remove("arrived"), 1600);
        tone(e.boss ? "breach" : "tier");
        haptic(e.boss ? [40, 60, 40] : 30);
      }
      if (e.type === "tier" && e.player === own) {
        sendTier = game.players[own].tier;
        renderCards();
        tierGlow();
        sfx.fanfare?.(e.tier);
      }
    }
  }
  if (networkTime >= 0.12) {
    networkTime = 0;
    if (room?.role === "host" && connected && begun) sendState();
  }
  if (saveTime >= 3) {
    saveTime = 0;
    if (begun && !room && game.running)
      try {
        localStorage.setItem(SAVE, serializeGame(game));
      } catch {}
  }
  if (begun && game.winner !== null && game.winner !== undefined && !shownResult) {
    shownResult = true;
    if (!room) localStorage.removeItem(SAVE);
    const won = game.winner === own,
      me = game.players[own],
      tip =
        won || !["training", "ffa"].includes(sessionMode)
          ? ""
          : me.stats.sent < 5
            ? t("Tip: send more creeps. Every group raises your income for good.")
            : me.towers.length < 8
              ? t("Tip: build towers in rows so the path gets longer.")
              : t("Tip: tap towers and upgrade them instead of only building new ones.");
    tone(won ? "victory" : "defeat");
    showModal(
      `<div class="modal-kicker" style="text-align:center">${t(isFfa() ? "MATCH OVER" : "DUEL OVER")}</div>${isFfa() ? `<p class="modal-copy result-place">${t("Place {n} of {m}", { n: won ? 1 : me.place || 2, m: game.players.length })}</p>` : ""}<img class="modal-hero result-hero" src="${artUrl(won ? "tower-archer" : "creep-golem")}" alt=""><h2 class="welcome-title">${won ? t("Your line.<br><span>Your victory.</span>") : t("Well fought.<br><span>Another round?</span>")}</h2><div class="result-stats"><span><b>${me.stats.kills}</b>${t("stopped")}</span><span><b>${me.stats.sent}</b>${t("sent")}</span><span><b>${me.stats.leaks}</b>${t("breakthroughs")}</span><span><b>+${resourceNumber(me.income)}</b>${t("Income")}</span>${game.waves ? `<span><b>${game.wave}</b>${t("waves")}</span>` : ""}</div><p class="modal-copy" style="text-align:center">${t("Match time")} ${$("match-clock").textContent}${sessionMode === "training" ? ` · ${t("AI")} ${t(AI_NAMES[game.aiLevel] || "Normal")}` : ""}</p>${tip ? `<p class="modal-note result-tip">${tip}</p>` : ""}<button class="primary-button" id="play-again">${t("Play again")}</button>${sessionMode === "training" && game.aiLevel !== "hard" && won ? `<button class="secondary-button" id="play-harder">${t("Harder AI")}</button>` : ""}<button class="secondary-button" id="to-menu">${t("Main menu")}</button>`,
      { pauseGame: false },
    );
    $("play-again").onclick = () => {
      shownResult = false;
      startLocal({ hotseat: sessionMode === "hotseat", ffa: sessionMode === "ffa", seats: game.players.length });
    };
    if ($("play-harder"))
      $("play-harder").onclick = () => {
        aiChoice = { veryEasy: "easy", easy: "normal", normal: "hard" }[game.aiLevel] || "hard";
        savePref(AI_PREF, aiChoice);
        shownResult = false;
        startLocal();
      };
    $("to-menu").onclick = () => {
      begun = false;
      shownResult = false;
      disconnectRoom();
      welcome();
    };
  }
}
/**
 * v0.09j: the level-up dialog's pictures (element symbols, reward icons) load at start-up, ahead
 * of the board's art stream, so the opening element pick shows them at once.
 */
const preloadedArt = [];
function preloadDialogArt() {
  const urls = [
    ...Object.values(ELEMENT_ICON).map((k) => iconUrl(k)),
    ...["coin", "income", "heart", "crown", "attack", "hourglass", "gear"].map((k) => iconUrl(k)),
  ];
  for (const url of urls) {
    const img = new Image();
    img.fetchPriority = "high";
    img.decoding = "async";
    img.src = url;
    img.decode?.().catch(() => {});
    preloadedArt.push(img);
  }
}
preloadDialogArt();
async function init() {
  try {
    catalog = await loadContent();
    registerTowerArt(catalog.towers);
    game = createGame({ seed: 42, faction: chosenFaction, mode: chosenMode });
    game.paused = true;
    arena = mountArena({
      container: $("arena"),
      getState: () => game,
      getCatalog: () => catalog,
      getViewPlayer: () => view,
      getMode: () => tab,
      getSelection: () =>
        tab !== "build"
          ? null
          : selectedTower
            ? { towerId: selectedTower, player: view }
            : selected
              ? { id: selected, player: own }
              : null,
      getOwnPlayer: () => own,
      getColors: seatColors,
      getPipPlayer: () => (view === own ? rivalIndex() : own),
      getPreview: currentPreview,
      getQueued: () => (queuedFor === game ? queued : []),
      getUpQueued: () => (queuedFor === game ? upQueue : []),
      onPip: () => {
        if (tab !== "build") setPage("build");
        else {
          view = view === own ? rivalIndex() : own;
          selectedTower = null;
          pending = null;
          if (view !== own) selected = null;
          $("tower-panel").hidden = true;
          refreshUI();
          arena.refresh();
        }
        tone("tap");
      },
      onCell,
      onTower: onTowerTap,
      onSwipe: swipeView,
      getAim: () => (volleyAim && view === own ? { radius: VOLLEY.radius } : null),
      onHover: (cell) => {
        hoverCell = cell && tab === "build" && selected && view === own ? cell : null;
      },
      onTick: tick,
    });
    document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => setPage(b.dataset.tab)));
    $("deck-expand").onclick = () => ($("deck-sheet").hidden ? openSheet() : closeSheet());
    $("sheet-close").onclick = closeSheet;
    $("deck-backdrop").onclick = closeSheet;
    $("deck-prev").onclick = () => scrollDeck(-1);
    $("deck-next").onclick = () => scrollDeck(1);
    $("cards").addEventListener("scroll", updateDeckArrows, { passive: true });
    window.addEventListener("resize", updateDeckArrows);
    // Mouse wheel scrolls the strip sideways on desktop.
    $("cards").addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          $("cards").scrollLeft += e.deltaY;
          e.preventDefault();
        }
      },
      { passive: false },
    );
    $("auto-slot").addEventListener("pointerdown", startSlotPress);
    $("auto-slot").onclick = () => {
      // keyboard activation; pointer taps are handled on release
      if (performance.now() < suppressClickUntil) return;
      const p = game.players[own];
      if (p.autoSend) dispatch({ type: "autoSend", active: p.autoSendActive === false });
    };
    $("level-button").onclick = () => pickModal();
    $("volley-button").innerHTML = `<img src="${svgUrl("volley")}" alt=""><i class="volley-cd" aria-hidden="true"></i><b id="volley-time"></b>`;
    $("volley-button").onclick = volleyPress;
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && volleyAim) setVolleyAim(false);
    });
    $("menu-button").onclick = menu;
    $("speed-button").onclick = () => {
      gameSpeed = gameSpeed === 1 ? 2 : 1;
      $("speed-button").textContent = gameSpeed + "×";
      $("speed-button").classList.toggle("fast", gameSpeed > 1);
      tone("tap");
    };
    $("view-button").onclick = () => {
      if (tab !== "build") {
        setPage("build");
        return;
      }
      view = view === own ? rivalIndex() : own;
      selectedTower = null;
      $("tower-panel").hidden = true;
      refreshUI();
      arena.refresh();
    };
    // Tapping a player's info plate opens that player's maze.
    document.querySelector(".player-plate.own").onclick = () => showMaze(own);
    document.querySelector(".player-plate.rival").onclick = (e) => {
      const cell = e.target.closest?.("[data-seat]");
      if (cell) {
        const seat = Number(cell.dataset.seat);
        if (!game.players[seat]?.out) showMaze(seat);
        return;
      }
      if (!isFfa()) showMaze(nextLane());
    };
    document.querySelectorAll(".player-plate").forEach(
      (el) =>
        (el.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            el.click();
          }
        }),
    );
    $("help-button").onclick = () => setHelpMode(!helpMode, true);
    setHelpMode(helpMode);
    $("faction-button").onclick = () => setPage("research");
    // The "?" button made way for the options button; the rulebook lives in the options menu.
    $("tier-select").onchange = (e) => {
      sendTier = Number(e.target.value);
      renderCards();
    };
    setPage("build");
    welcome();
    setTimeout(() => music.preload("menu"), 1500);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1")
      Object.defineProperty(window, "felitoDebug", {
        value: {
          get state() {
            return game;
          },
          get catalog() {
            return catalog;
          },
          command: (input) => command(game, input),
          step: (dt) => step(game, dt),
          grantExp: (n, who = own) => grantExp(game, who, n),
          get player() {
            return own;
          },
          get view() {
            return view;
          },
          get page() {
            return tab;
          },
          get connected() {
            return connected;
          },
          get music() {
            return music.getState();
          },
          geometry: () => arena.geometry(),
          cellCenter: (x, y) => arena.cellCenter(x, y),
          startLocal,
        },
      });
  } catch (error) {
    console.error(error);
    $("game-loader").textContent = t("Start failed:") + " " + error.message;
    showModal(
      `${modalHeader(t("Arena not loaded"))}<p class="modal-copy">${esc(error.message)}</p><button class="primary-button" id="retry-load">${t("Reload")}</button>`,
      { pauseGame: false },
    );
    $("retry-load").onclick = () => location.reload();
  }
}
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});
document.addEventListener("visibilitychange", () => {
  music.setHidden(document.hidden);
  if (document.hidden && begun) {
    setUiPause("background", true);
    if (!room)
      try {
        localStorage.setItem(SAVE, serializeGame(game));
      } catch {}
  } else if (begun && uiPauses.has("background")) {
    if (!$("modal").open && !room) menu(); // v0.10h: online games carry on without the menu
    setUiPause("background", false);
  }
});
window.addEventListener("pagehide", () => {
  if (game && begun && !room)
    try {
      localStorage.setItem(SAVE, serializeGame(game));
    } catch {}
});
init();
