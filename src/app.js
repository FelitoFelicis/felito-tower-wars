import { loadContent, getCatalog, WALL_ID, RULES } from "./content.js";
import {
  gunpowderTiles,
  setCommandHook,
  createGame,
  step,
  command,
  available,
  canBuild,
  getStats,
  getSellValue,
  getSellBase,
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
  RESEARCH_PERKS, // v0.21
  perkLook,
  FIRE_ARROWS,
  grantExp,
  targetOf,
  sendIncome,
  perkGold,
  VOLLEY,
  NOVICE,
  PILLAGE,
  BURST,
  hellfireDps,
  hellfireRound, // v0.21n
  OWL,
  researchMax, // v0.19a1
  WINGS, // v0.19b1: per-level tooltip values
  POCKS,
  CROWD,
  VOLTAGE,
  MELEE_PROTOCOL,
  AUTOLOADER,
  PERK_CONTINUOUS,
  STORMFEATHERS,
  FROZEN_GROUND,
  HILLS,
  loneTowers,
  loneSpeed,
  FRENZY,
  LEADERSHIP,
  HEAVY_WEAPONS,
  towerWorth,
  teamIncome,
  teamMates,
  TEAM_LIVES,
  FIREBLOCK,
  fireBlockDamage,
  fireBlockBack,
  HEALING,
  BANK,
  MIND,
  TAILWIND,
  CREEP_ARMOR,
  BOOTS,
  EXHUME,
  WATERBLOCK,
  AIRBLOCK, // v0.20c
  SYNTHESIZER, // v0.20d
  FORGE, // v0.21c
  volleyCd, // v0.21c
  SCHOLAR,
  airBlockDamage,
  SUPERGROWTH,
  guardShieldHp,
  burstRadius,
  treasureGold,
  treasureIncome,
  burningTreant,
  TREANT,
  ENRAGED_GOLEM,
  burstDamage,
  TOWER_ACHIEVEMENTS,
  GLOBAL_ACHIEVEMENTS,
  collectorExp,
  RECRUITER_ACHIEVEMENTS,
  BUILDER_ACHIEVEMENTS,
  BLOOD_ACHIEVEMENTS,
  PILLAR,
  AGOLEM,
  MONSUN,
  pillarDamage,
  golemHp,
  monsunDamage,
  perkElements,
  MANUFACTURE,
  NOBILITY,
  BREEDING,
  SLAVE,
  slaveSpeed,
  GUARDIAN,
  guardShare,
  guardMagic,
  stockMaxOf,
  startLives,
  lockRoundsLeft,
  QUESTS,
  CONTRACT_EXP,
  contractExp,
  contractGold,
  BANTER,
  UNTOUCHABLE,
  tierSends,
  fireArcher,
  fatHp,
  PERK_AVAILABILITY,
  UNDEAD_SENDS,
  isHeavy,
  hasDeathrattle,
  attackInfo,
  baseStats,
  feudalBonus,
  towerPerkBuffs,
  abilityCd,
  AUTO_MODES,
} from "./simulation.js";
import { mountArena, artFor } from "./arena.js";
import { artUrl, iconUrl, ELEMENT_ICON, ART_MANIFEST, registerTowerArt, TEAM_COLORS, recolorTeam } from "./art.js";
import { createSoundtrack } from "./soundtrack.js";
import { createSfx, haptic } from "./sfx.js";
import { t, num, goldText } from "./i18n.js";
import { MISSIONS, CAMPAIGN_PREF } from "./campaign.js";

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
const resourceNumber = (n) => goldText(Math.floor(n)); // v0.22h1: gold can hold fractions (bounties), shown without decimals
const SAVE = "felito.duel.v4";
const MUSIC_PREF = "felito.music.enabled";
const SOUND_PREF = "felito.sound.enabled";
const AI_PREF = "felito.ai.level";
const PREVIEW_PREF = "felito.build.preview.v2";
const TIPS_PREF = "felito.tips.enabled";
const APP_VERSION = "0.22v",
  APP_NOTE = "", // v0.17q: saved version, shown below the version number
  APP_DATE = "19.10.2026";
// v0.18: the version also stands in the page title (browser tab and the artifact window in chats)
try {
  document.title = `Felito Tower Wars · v${APP_VERSION}`;
} catch {}
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
// v0.17d: the "Raise controls" option (whole game lifted above the bottom edge) is gone.
// Double tap on one of your towers (v0.08a): upgrade (default), tower info, or nothing.
// v0.13: "upgrade" queues only the next logical step; "advanced" queues the whole chain up to the
// upgrade you picked last time (the old behaviour).
const DBL_PREF = "felito.dblclick";
const DBL_MODES = ["upgrade", "advanced", "info", "off"];
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
}
// v0.13: volume sliders (0–100) replace the music and sound on/off buttons; an old "off" becomes 0.
const VOL_PREFS = { master: "felito.vol.master", effects: "felito.vol.effects", music: "felito.vol.music" };
const volume = {
  master: Math.max(0, Math.min(100, Number(pref(VOL_PREFS.master, "100")) || 0)),
  effects: Math.max(0, Math.min(100, Number(pref(VOL_PREFS.effects, pref(SOUND_PREF, "true") === "false" ? "0" : "100")) || 0)),
  music: Math.max(0, Math.min(100, Number(pref(VOL_PREFS.music, pref(MUSIC_PREF, "true") === "false" ? "0" : "100")) || 0)),
};
// v0.17: mute switch (speaker button in the main menu)
const MUTE_PREF = "felito.muted";
let muted = pref(MUTE_PREF, "false") === "true";
let musicEnabled = !muted && volume.master > 0 && volume.music > 0;
let soundEnabled = !muted && volume.master > 0 && volume.effects > 0;
// v0.13: Graphic options: floating numbers on the board and the bottom notifications
const POPNUM_PREF = "felito.popNumbers",
  POPNOTE_PREF = "felito.popNotes";
let popNumbers = pref(POPNUM_PREF, "true") !== "false";
let popNotes = pref(POPNOTE_PREF, "true") !== "false";
// v0.18c: Minimap (Graphic): "on" (the mini map beside the board), "off", "all" (a see-through mini map of every
// other field in a row below the player plates)
const MINIMAP_PREF = "felito.minimap",
  MINIMAP_CHOICES = [
    ["on", "On"],
    ["off", "Off"],
    ["all", "All"],
  ];
let minimapMode = ["on", "off", "all"].includes(pref(MINIMAP_PREF, "on")) ? pref(MINIMAP_PREF, "on") : "on";
const minimapRow = () =>
  `<div class="choice-row minimap-row" role="group" aria-label="${t("Minimap")}"><span>${t("Minimap")}</span>${MINIMAP_CHOICES.map(
    ([m, name]) => `<button type="button" class="choice-button${minimapMode === m ? " active" : ""}" data-mini="${m}" aria-pressed="${minimapMode === m}">${t(name)}</button>`,
  ).join("")}</div>`;
// v0.14: mixed difficulty (toggle beside the levels): AIs of different levels up to the chosen one
const AI_MIXED_PREF = "felito.ai.mixed";
let aiMixed = pref(AI_MIXED_PREF, "false") === "true";
// v0.22b/d: Hardo is an experimental secret, only in Training: hidden until the sequence
// Mixed on, Mixed off, Mixed on, Hard, Normal, Hard. Then the other levels fall out of the menu and
// Hardo slams in. It lasts until the page reloads; tapping Hardo again brings the levels back.
const HARDO_CODE = ["mixOn", "mixOff", "mixOn", "hard", "normal", "hard"];
let hardoUnlocked = false,
  hardoInput = [];
let aiChoice = ["veryEasy", "easy", "normal", "hard", "insane"].includes(pref(AI_PREF, "easy")) ? pref(AI_PREF, "easy") : "easy";
if (aiChoice === "insane" && !hardoUnlocked) aiChoice = "hard";
let buildPreview = pref(PREVIEW_PREF, "false") === "true";
// v0.15: Predator view (Gameplay): while sending and watching your target, the view rolls to a new target
const PREDATOR_PREF = "felito.predator";
let predatorView = pref(PREDATOR_PREF, "false") === "true";
// v0.15: control scheme (Graphic): "mobile" (touch) or "pc" (mouse and keyboard); default by device
const CONTROL_PREF = "felito.controls";
const recommendedControls = () => {
  try {
    return matchMedia("(pointer: coarse)").matches ? "mobile" : "pc";
  } catch {
    return "mobile";
  }
};
let controlMode = ["mobile", "pc"].includes(pref(CONTROL_PREF, "")) ? pref(CONTROL_PREF, "") : recommendedControls();
/** v0.17g: one "Layout" row: PC, Mobile Default (layout A), Mobile Zoomed (layout B); the fitting one says "(recommended)". */
const LAYOUT_CHOICES = [
  ["pc", "PC"],
  ["mobile", "Mobile Default"],
  ["zoomed", "Mobile Zoomed"],
  ["full", "Mobile Max"], // the board fills the whole screen and scrolls under the buttons (layout F)
];
const layoutChoice = () =>
  controlMode === "pc" ? "pc" : mobileLayout === "F" ? "full" : mobileLayout === "B" || mobileLayout === "B2" ? "zoomed" : "mobile";
const controlsRow = () =>
  `<div class="choice-row layout-row" role="group" aria-label="${t("Layout")}"><span>${t("Layout")}</span>${LAYOUT_CHOICES.map(
    ([m, name]) =>
      `<button type="button" class="choice-button${layoutChoice() === m ? " active" : ""}" data-ctl="${m}" aria-pressed="${layoutChoice() === m}">${t(name)}${m === recommendedControls() ? ` <small>${t("(recommended)")}</small>` : ""}</button>`,
  ).join("")}</div>`;
// v0.17d: two layouts for the mobile version: A (bottom bar, mini map; the v0.17c layout, "LayoutMobileA")
// and B (no mini map, all buttons in one column right of the board, bigger board).
const MOBILE_LAYOUT_PREF = "felito.mobileLayout";
// v0.17k: "B2" = MobileZoomedLayoutB2, the zoomed layout of v0.17j (cards end at the safe-area edge). Internal
// only (not in the menu); B lets the cards reach 20 px into the safe area.
// "Mobile Max" (layout F): the board fills the whole screen and scrolls under the HUD and the buttons.
// Only an option; Mobile Default (A) stays the default.
const MOBILE_LAYOUTS = ["A", "B", "B2", "F"];
let mobileLayout = MOBILE_LAYOUTS.includes(pref(MOBILE_LAYOUT_PREF, "A")) ? pref(MOBILE_LAYOUT_PREF, "A") : "A";
function applyControlMode() {
  const root = document.documentElement,
    b = controlMode === "mobile" && (mobileLayout === "B" || mobileLayout === "B2"),
    full = controlMode === "mobile" && mobileLayout === "F";
  root.classList.toggle("pc-controls", controlMode === "pc");
  root.classList.toggle("layout-b2", controlMode === "mobile" && mobileLayout === "B2");
  if (root.classList.contains("layout-b") !== b || root.classList.contains("layout-full") !== full) {
    root.classList.toggle("layout-b", b);
    root.classList.toggle("layout-full", full);
    const nav = document.querySelector(".bottom-nav");
    if (nav && !b) nav.removeAttribute("style");
    try {
      abilityLayoutKey = ""; // not yet declared on the first call at start-up
      arena?.refresh?.();
    } catch {}
  }
}
applyControlMode();
let tipsEnabled = pref(TIPS_PREF, "true") !== "false";
let wavesOn = pref(WAVES_PREF, "true") !== "false";
// v0.10c/f: number of AI enemies for Vs AI (1–7), chosen like the difficulty; 1 = classic duel.
const AI_COUNT_PREF = "felito.aiCount";
const AI_COUNTS = [1, 2, 3, 4, 5, 6, 7];
let aiCount = AI_COUNTS.includes(Number(pref(AI_COUNT_PREF, "1"))) ? Number(pref(AI_COUNT_PREF, "1")) : 1; // v0.17g: default 1 AI enemy
let warnedWave = 0;
const sfx = createSfx();
sfx.setEnabled(soundEnabled);
sfx.setVolume?.(((muted ? 0 : volume.master) / 100) * (volume.effects / 100));
const AI_NAMES = { veryEasy: "Very easy", easy: "Easy", normal: "Normal", hard: "Hard", insane: "Hardo" }; // v0.22b: Hardo (secret experimental Training level, id "insane")
// Player colour: chosen in the main menu; the other side is red, or blue when you play red.
// v0.13: player name (main menu), shown on your plate and sent to online opponents
const NAME_PREF = "felito.playerName";
const cleanName = (v) => String(v || "").replace(/[<>&"'`\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
let playerNameChoice = cleanName(pref(NAME_PREF, ""));
const myName = () => playerNameChoice || t("You");
const COLOR_PREF = "felito.color";
// v0.18a: colorPick is what the player picked ("random" = none: a free colour is drawn at the start
// of every match); colorChoice is the colour actually played (online: the one the host assigned).
let colorPick = pref(COLOR_PREF, "blue") === "random" ? "random" : TEAM_COLORS[pref(COLOR_PREF, "blue")] ? pref(COLOR_PREF, "blue") : "blue";
let colorChoice = colorPick === "random" ? "blue" : colorPick;
const randomColor = (taken = []) => {
  const free = Object.keys(TEAM_COLORS).filter((c) => !taken.includes(c));
  return free[Math.floor(Math.random() * free.length)] || "blue";
};
/** At the start of a match: the picked colour, or a random free one. */
function rollColor() {
  colorChoice = colorPick === "random" ? randomColor(hardoGame() ? ["purple"] : []) : colorPick;
  if (hardoGame() && colorChoice === "purple") colorChoice = randomColor(["purple"]); // purple belongs to Hardo
}
const colorLabel = () => (colorPick === "random" ? t("Random") : t(TEAM_COLORS[colorPick].name));
/**
 * v0.18a: online colours, in join order. Everybody keeps the colour they picked if it is free. If
 * it is held by someone who picked it too, the newcomer is moved to a free colour. If it is held
 * by someone who was moved there (or drew it at random), that player moves again instead, so as
 * many players as possible keep their own pick. picks: colour id or null (random).
 */
function assignColors(picks) {
  const out = [],
    forced = [];
  const holder = (c) => out.findIndex((x) => x === c);
  picks.forEach((want, i) => {
    const pick = TEAM_COLORS[want] ? want : null,
      j = pick ? holder(pick) : -1;
    if (pick && j < 0) {
      out[i] = pick;
      forced[i] = false;
    } else if (pick && forced[j]) {
      out[i] = pick;
      forced[i] = false;
      out[j] = randomColor(out);
    } else {
      out[i] = randomColor(out);
      forced[i] = true;
    }
  });
  return out;
}
const rivalColor = () => (hardoGame() ? "purple" : colorChoice === "red" ? "blue" : "red"); // v0.22e: Hardo always wears purple
/** v0.22e: a Training match against Hardo (the secret "insane" level). */
const hardoGame = () => !!game?.players?.some((q) => q.ai && (q.aiLevel || game.aiLevel) === "insane");
const HARDO_ICON = "assets/art/icon-hardo.webp?v=022e";
// v0.08b: four players. Seats get distinct colours; the rival plate shows whoever you send to.
const FFA_COLORS = ["red", "green", "yellow", "purple", "teal", "orange", "pink", "blue"];
const isFfa = () => (game?.players?.length || 2) > 2;
function seatColors() {
  const online = game?.players;
  // v0.18a: assigned by the host; v0.19: for every seat (online matches with up to six players)
  if (online?.length && online.every((q) => TEAM_COLORS[q.color])) return Object.fromEntries(online.map((q, i) => [i, q.color]));
  if (!isFfa()) return { [own]: colorChoice, [1 - own]: rivalColor() };
  const free = FFA_COLORS.filter((c) => c !== colorChoice && TEAM_COLORS[c]),
    out = {};
  let k = 0;
  for (const pl of game.players) out[pl.id] = pl.id === own ? colorChoice : free[k++];
  return out;
}
/** The player you send to (1v1: the other side). */
const rivalIndex = () => (isFfa() ? targetOf(game, own).id : 1 - own);
const seatName = (i) =>
  i === own ? myName() : game?.players[i]?.ai && (game.players[i].aiLevel || game.aiLevel) === "insane" ? "Hardo" : game?.players[i]?.missionName ? t(game.players[i].missionName) : ((!game?.players[i]?.ai || game.players[i].aiTakeover || game.players[i].netLeft) && onlineName(game?.players[i])) || t(TEAM_COLORS[seatColors()[i]]?.name || "AI"); // v0.14: human opponents by name
/** v0.13: the name an online opponent typed in, if any. */
const onlineName = (q) => cleanName(q?.name && !/^(You|Player \d)$/.test(q.name) ? q.name : "");
/**
 * v0.09b: an AI shows its difficulty in its portrait — very easy keeps the goblin, easy the
 * skeleton, normal the grunt, hard the alchemist. Human players keep the goblin portrait.
 */
const AI_PORTRAIT = { easy: "n00R", normal: "n00M", hard: "n021", insane: "n02Q" };
/**
 * v0.19c1: player icons (PvP menu): the classic player portrait plus creep heads the AI never wears
 * (not the goblin, skeleton, orc or alchemist). Shown in the lobby, on the plates and in tooltips.
 */
// v0.19e2: row 1 towers (the classic archer, Footman, Bombard, Magic Tower, Footman level 4), row 2 creeps,
// row 3 the tier golems, each unlocked by a campaign mission (5 / 10 / 15 / 20 / 30)
const PLAYER_ICONS = ["player", "guard2", "h02R", "h03V", "guard4", "n00Q", "n00P", "n010", "n016", "n02M", "n00T", "n015", "n01H", "n01T", "n02R", "hardo"];
const HARDO_ICON_PREF = "felito.icon.hardo"; // v0.22e: Hardo's goblin, earned by beating Hardo once
const hardoIconEarned = () => pref(HARDO_ICON_PREF, "false") === "true";
const ICON_ART = { guard2: "tower-guard-l2", guard4: "tower-guard-elite" }; // v0.19g1: Footman level 2 instead of level 1
const ICON_UNLOCK = { n00T: 5, n015: 10, n01H: 15, n01T: 20, n02R: 30 };
const iconLocked = (id) => !!ICON_UNLOCK[id] && !campaignDone().has(ICON_UNLOCK[id]);
const ICON_PREF = "felito.playerIcon";
const savedIcon = pref(ICON_PREF, "player") === "h000" ? "guard2" : pref(ICON_PREF, "player"); // v0.19g1: the old Footman icon becomes Footman level 2
let iconChoice = PLAYER_ICONS.includes(savedIcon) ? savedIcon : "player";
function iconSrc(icon) {
  if (icon === "hardo") return HARDO_ICON;
  if (!icon || icon === "player" || !PLAYER_ICONS.includes(icon)) return "assets/art/portrait-player.webp";
  if (ICON_ART[icon]) return headCrop(artUrl(ICON_ART[icon]));
  const item = catalog?.byId[icon];
  return item ? headCrop(artUrl(artFor(item))) : "assets/art/portrait-player.webp";
}
/** Your own plate and splats: your icon (the classic portrait until you pick one). */
const ownPortrait = () => iconSrc(game?.players?.[own]?.icon || iconChoice);
function portraitFor(q) {
  if (q?.missionArt) return headCrop(artUrl(q.missionArt)); // v0.17: campaign enemies
  if (q && !q.ai && PLAYER_ICONS.includes(q.icon) && q.icon !== "player") return iconSrc(q.icon); // v0.19c1
  if (q?.ai && (q.aiLevel || game.aiLevel) === "insane") return HARDO_ICON; // v0.22e: the goblin with purple eyes
  const id = q?.ai ? AI_PORTRAIT[q.aiLevel || game.aiLevel] : null,
    item = id && catalog?.byId[id];
  return item ? headCrop(artUrl(artFor(item))) : "assets/art/portrait-enemy.webp";
}
/** Head and shoulders per figure: left, top, size in the image's pixels. */
const HEAD_BOX = { "creep-skeleton": [128, 22, 172], "creep-orc": [132, 22, 176], "creep-alchemist": [118, 62, 176] };
/** v0.19g1: figures whose face sat too low in the icon: the crop moves down by this share of its size. */
const HEAD_SHIFT = { "tower-guard-elite": 0.28, "creep-satyr": 0.22, "creep-sheep-fly": 0.32, "creep-troll": 0.22, "creep-siege-golem": 0.25, "creep-mountain-golem": 0.22, "creep-spellbreaker": 0.14, "creep-infernal": 0.14, "creep-ghoul": 0.14 }; // v0.20a: Flying Sheep, Spellbreaker, Infernal Golem and Zombie higher
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
        const key = url.split("/").pop().split("?")[0].replace(".webp", ""),
          box = HEAD_BOX[key],
          size = box ? box[2] : Math.max(40, Math.round((right - left) * 0.5)),
          cx = box ? box[0] + size / 2 : (left + right) / 2,
          out = Object.assign(document.createElement("canvas"), { width: 96, height: 96 });
        out.getContext("2d").drawImage(img, cx - size / 2, (box ? box[1] : Math.max(0, top - size * 0.04)) + size * (HEAD_SHIFT[key] || 0), size, size, 0, 0, 96, 96);
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
  if (!multi || !game.teams) showAllyStack(false); // v0.21d: the allies' window only exists in team games
  if (!multi) return;
  const colors = seatColors(),
    n = game.players.length,
    seats = [];
  if (game.teams) return renderTeamStack(stack, colors, force); // v0.20c: one shared window per team
  for (let k = 1; k < n; k++) seats.push(game.players[(own + k) % n]);
  const key = seats.map((q) => q.id + ":" + colors[q.id]).join(",");
  stack.dataset.count = String(seats.length);
  if (force || key !== enemyStackKey) {
    enemyStackKey = key;
    stack.innerHTML = seats
      .map(
        (q) =>
          `<button class="enemy-cell${game?.teams && q.team === game.players[own]?.team ? " ally" : ""}" type="button" data-seat="${q.id}" style="--pc:${TEAM_COLORS[colors[q.id]]?.css || "#888"}"><span class="ec-top"><span class="ec-face"><img class="portrait" src="assets/art/portrait-enemy.webp" alt=""><i class="plate-skull" aria-hidden="true"></i><img class="ec-target" src="${iconUrl("attack")}" alt=""></span><span class="ec-stats"><span class="ec-lives"><img src="${iconUrl("heart")}" alt=""><b></b></span></span></span><span class="ec-gold"><img src="${iconUrl("coin")}" alt=""><b></b></span><em class="ec-inc"></em><span class="ec-level"><i class="ec-lv">Lv</i><b></b><span class="ec-tier">T<b></b></span></span></button>`,
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
    const tierText = String(q.tier || 1); // v0.22u2
    if (cell.querySelector(".ec-tier b").textContent !== tierText) cell.querySelector(".ec-tier b").textContent = tierText;
    if (cell.querySelector(".ec-gold b").textContent !== gold) cell.querySelector(".ec-gold b").textContent = gold;
    if (cell.querySelector(".ec-inc").textContent !== inc) cell.querySelector(".ec-inc").textContent = inc;
    if (cell.getAttribute("aria-label") !== label) {
      cell.setAttribute("aria-label", label);
      cell.dataset.help = label;
    }
  }
}
/**
 * v0.20c: team games: the rival plate holds one shared window per team (enemy team first, then your
 * team mates): the members' portraits in a row (tap one to see that maze), then the team's lives,
 * gold (the shared pool, or everyone's gold added up) and income.
 */
const teamValues = (team) => {
  const list = game.players.filter((q) => q.team === team),
    live = list.filter((q) => !q.out);
  return {
    list,
    out: !live.length,
    lives: live.length ? live[0].lives : 0,
    gold: !live.length ? 0 : game.teams.gold === "shared" ? live[0].gold : live.reduce((sum, q) => sum + q.gold, 0),
    income: live.reduce((sum, q) => sum + q.income, 0),
  };
};
/** v0.21d: the allies' shared window sits in your own plate on the left, beside your own info. */
function showAllyStack(on) {
  const ally = $("ally-stack");
  if (!ally) return;
  ally.hidden = !on;
  document.querySelector(".player-plate.own")?.classList.toggle("allied", on);
  if (!on && ally.innerHTML) ally.innerHTML = "";
}
function renderTeamStack(stack, colors, force) {
  const me = game.players[own],
    teams = [1 - (me?.team | 0), me?.team | 0].filter((tm) => game.players.some((q) => q.team === tm && q.id !== own)),
    key = "teams:" + teams.map((tm) => tm + "=" + game.players.filter((q) => q.team === tm && q.id !== own).map((q) => q.id + colors[q.id]).join("/")).join(","),
    mine = me?.team | 0,
    foes = teams.filter((tm) => tm !== mine),
    allyStack = $("ally-stack"),
    hasAllies = teams.includes(mine) && !!allyStack;
  stack.dataset.count = String(foes.length);
  showAllyStack(hasAllies);
  if (force || key !== enemyStackKey) {
    enemyStackKey = key;
    const cellHtml = (tm) => {
        const mates = game.players.filter((q) => q.team === tm && q.id !== own),
          css = TEAM_COLORS[colors[mates[0].id]]?.css || "#888";
        return `<div class="enemy-cell team-cell${tm === (me?.team | 0) ? " ally" : ""}" role="button" tabindex="0" data-team="${tm}" style="--pc:${css}"><span class="tc-faces">${mates
          .map((q) => `<span class="tc-face" data-seat="${q.id}" style="--pc:${TEAM_COLORS[colors[q.id]]?.css || css}"><img class="portrait" src="assets/art/portrait-enemy.webp" alt=""><i class="plate-skull" aria-hidden="true"></i><img class="ec-target" src="${iconUrl("attack")}" alt=""></span>`)
          .join("")}</span><span class="ec-lives"><img src="${iconUrl("heart")}" alt=""><b></b></span><span class="ec-gold"><img src="${iconUrl("coin")}" alt=""><b></b></span><em class="ec-inc"></em></div>`;
    };
    stack.innerHTML = foes.map(cellHtml).join("");
    if (allyStack) allyStack.innerHTML = hasAllies ? cellHtml(mine) : ""; // v0.21d: allies on the left
  }
  const target = me?.out ? -1 : targetOf(game, own).id;
  for (const cell of [...stack.querySelectorAll(".team-cell"), ...(allyStack?.querySelectorAll(".team-cell") || [])]) {
    const v = teamValues(Number(cell.dataset.team)),
      lives = String(v.lives),
      gold = v.out ? "–" : resourceNumber(Math.floor(v.gold)),
      inc = v.out ? "" : "+" + resourceNumber(Math.floor(v.income));
    cell.classList.toggle("out", v.out);
    if (cell.querySelector(".ec-lives b").textContent !== lives) cell.querySelector(".ec-lives b").textContent = lives;
    if (cell.querySelector(".ec-gold b").textContent !== gold) cell.querySelector(".ec-gold b").textContent = gold;
    if (cell.querySelector(".ec-inc").textContent !== inc) cell.querySelector(".ec-inc").textContent = inc;
    for (const face of cell.querySelectorAll("[data-seat]")) {
      const q = game.players[Number(face.dataset.seat)];
      setPortrait(face.querySelector(".portrait"), q);
      face.classList.toggle("out", !!q.out);
      face.classList.toggle("target", q.id === target && !q.out);
      face.classList.toggle("viewing", q.id === view);
    }
  }
}
/** v0.20c: tooltip of a shared team window: the members, then the team's values. */
function teamTip(team) {
  const v = teamValues(team),
    row = (k, val, cls = "") => `<div class="tip-row${cls}"><span>${esc(k)}</span><b>${esc(val)}</b></div>`;
  return {
    html:
      `<div class="tip-head"><b>${esc(v.list.map((q) => playerLabel(q)).join(", "))}</b>${v.out ? `<span class="tip-level">${esc(t("out"))}</span>` : ""}</div>` +
      row(t("Lives"), String(v.lives)) +
      row(t("Gold"), v.out ? "–" : resourceNumber(Math.floor(v.gold))) +
      row(t("Income"), v.out ? "–" : "+" + resourceNumber(Math.floor(v.income)), " tip-inc"),
  };
}
// ---- v0.09q: Arrow Volley — an active ability button beside the board ----------------------
let volleyAim = false,
  aimKind = "volley"; // v0.10p: "volley" or "burst" (Arcane Burst)
function setVolleyAim(on, kind = aimKind) {
  volleyAim = !!on;
  aimKind = kind;
  $("volley-button")?.classList.toggle("aiming", volleyAim && aimKind === "volley");
  $("burst-button")?.classList.toggle("aiming", volleyAim && aimKind === "burst");
  for (const a of ABILITIES) $(a.id + "-button")?.classList.toggle("aiming", volleyAim && aimKind === a.id);
  document.querySelector(".game-shell")?.classList.toggle("volley-aiming", volleyAim);
}
function volleyPress() {
  const p = game?.players[own];
  if (!p || !begun || !(p.perks?.volley > 0)) return;
  if (volleyAim && aimKind === "volley") return setVolleyAim(false);
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
  setVolleyAim(true, "volley");
  tone("select");
  note("Tap your field where the arrows should fall.");
}
/** v0.10p: Arcane Burst button, same aiming as the volley. */
function burstPress() {
  const p = game?.players[own];
  if (!p || !begun || !(p.perks?.burst > 0)) return;
  if (volleyAim && aimKind === "burst") return setVolleyAim(false);
  if (p.burstReady > game.time) {
    note(t("Arcane Burst ready in {n} s", { n: Math.ceil(p.burstReady - game.time) }));
    return;
  }
  if (tab !== "build") setPage("build", { scroll: false });
  if (view !== own) showMaze(own);
  selected = null;
  pending = null;
  selectedTower = null;
  renderCards();
  setVolleyAim(true, "burst");
  tone("select");
  note("Tap your field where the arcane burst should strike.");
}
function refreshBurst(p, slot) {
  const btn = $("burst-button");
  if (!btn) return;
  const has = begun && !p.out && p.perks?.burst > 0;
  btn.hidden = !has;
  if (!has) return;
  const left = Math.max(0, (p.burstReady ?? 0) - game.time),
    ready = left <= 0;
  btn.classList.toggle("ready", ready);
  btn.style.setProperty("--cd", ready ? 0 : Math.min(1, left / abilityCd(p, BURST.cooldown)));
  const label = ready ? "" : String(Math.ceil(left));
  if ($("burst-time").textContent !== label) $("burst-time").textContent = label;
  if (!ready && volleyAim && aimKind === "burst") setVolleyAim(false);
}
// ---- v0.12: Pillar of Fire (aimed), Arcane Golem and Monsun (at once) -----------------
const ABILITIES = [
  { id: "pillar", ready: "pillarReady", cooldown: () => PILLAR.cooldown, name: "Pillar of Fire", aim: true, cls: "pillar-button", tip: "Tap your field where the pillar of fire should rise.", help: "Pillar of Fire: tap it, then tap your field. A pillar of fire burns that area (cooldown 75 s)." },
  { id: "agolem", ready: "golemReady", cooldown: () => AGOLEM.cooldown, name: "Arcane Golem", cls: "golem-button", help: "Arcane Golem: a golem walks your path upwards and knocks creeps back, then runs on into the next lane (cooldown 50 s)." },
  { id: "monsun", ready: "monsunReady", cooldown: () => MONSUN.cooldown, name: "Monsun", cls: "monsun-button", help: "Monsun: storm winds push the creeps in your field back while lightning strikes flyers (cooldown 40 s)." },
];
function abilityPress(a) {
  const p = game?.players[own];
  if (!p || !begun || !(p.perks?.[a.id] > 0)) return;
  if (a.aim && volleyAim && aimKind === a.id) return setVolleyAim(false);
  if (p[a.ready] > game.time) {
    note(t("{name} ready in {n} s", { name: t(a.name), n: Math.ceil(p[a.ready] - game.time) }));
    return;
  }
  if (!a.aim) {
    if (view !== own) showMaze(own);
    dispatch({ type: a.id });
    return;
  }
  if (tab !== "build") setPage("build", { scroll: false });
  if (view !== own) showMaze(own);
  selected = null;
  pending = null;
  selectedTower = null;
  renderCards();
  setVolleyAim(true, a.id);
  tone("select");
  note(a.tip);
}
function ensureAbilityButtons() {
  for (const a of ABILITIES) {
    if ($(a.id + "-button")) continue;
    const b = document.createElement("button");
    b.id = a.id + "-button";
    b.type = "button";
    b.className = "volley-button " + a.cls;
    b.hidden = true;
    b.setAttribute("aria-label", t(a.name));
    b.dataset.help = t(a.help);
    b.innerHTML = `<img src="${svgUrl(a.id)}" alt=""><i class="volley-cd" aria-hidden="true"></i><b id="${a.id}-time"></b>`;
    b.onclick = () => abilityPress(a);
    $("arena")?.appendChild(b);
  }
}
/** Shows the ability buttons the player owns below volley and burst; returns nothing. */
function refreshAbilities(p) {
  for (const a of ABILITIES) {
    const btn = $(a.id + "-button");
    if (!btn) continue;
    const has = begun && !p.out && p.perks?.[a.id] > 0;
    btn.hidden = !has;
    if (!has) continue;
    const left = Math.max(0, (p[a.ready] ?? 0) - game.time),
      ready = left <= 0;
    btn.classList.toggle("ready", ready);
    btn.style.setProperty("--cd", ready ? 0 : Math.min(1, left / abilityCd(p, a.cooldown())));
    const label = ready ? "" : String(Math.ceil(left)),
      time = $(a.id + "-time");
    if (time && time.textContent !== label) time.textContent = label;
    if (!ready && a.aim && volleyAim && aimKind === a.id) setVolleyAim(false);
  }
}
// ---- v0.17k: one list for all ability buttons ---------------------------------------------
// Order is the player's (drag an ability onto another to swap their places); drag an ability onto
// the board to use it there; in the zoomed mobile layout the ones that do not fit go into a book.
const ABILITY_IDS = ["volley", "burst", "pillar", "agolem", "monsun"],
  ABILITY_ORDER_PREF = "felito.abilityOrder",
  BOOK_SVG = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b0532f"/><stop offset="1" stop-color="#5a1f12"/></linearGradient><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2a8"/><stop offset=".5" stop-color="#e3a72c"/><stop offset="1" stop-color="#8a5a10"/></linearGradient></defs><path d="M10 14q0-5 5-5h37v42H16q-6 0-6 5z" fill="url(#bk)" stroke="#2a0d06" stroke-width="2.5"/><path d="M10 56q0-5 6-5h36v6H16q-6 0-6-1z" fill="#f3e6c4" stroke="#2a0d06" stroke-width="2"/><path d="M15 9v42" stroke="#3a1208" stroke-width="2"/><path d="M47 9v42" stroke="url(#bg)" stroke-width="4"/><circle cx="32" cy="29" r="9" fill="url(#bg)" stroke="#2a0d06" stroke-width="2"/><path d="M32 22l2.4 4.8 5.2.8-3.8 3.7.9 5.2-4.7-2.5-4.7 2.5.9-5.2-3.8-3.7 5.2-.8z" fill="#7a2cd9" stroke="#2a0d06" stroke-width="1"/><circle cx="29.5" cy="26.5" r="1.6" fill="#fff" opacity=".85"/><path d="M20 15h22" stroke="#e7b84a" stroke-width="1.5" opacity=".7"/></svg>`;
let abilityOrder = (() => {
    try {
      const v = JSON.parse(pref(ABILITY_ORDER_PREF, "[]"));
      return Array.isArray(v) ? v.filter((id) => ABILITY_IDS.includes(id)) : [];
    } catch {
      return [];
    }
  })(),
  abilityDrag = null,
  bookOpen = false,
  abilityLayoutKey = "";
const abilityRank = (id) => (abilityOrder.includes(id) ? abilityOrder.indexOf(id) : 100 + ABILITY_IDS.indexOf(id));
const ownedAbilities = (p) => ABILITY_IDS.filter((id) => begun && !p?.out && p?.perks?.[id] > 0).sort((a, b) => abilityRank(a) - abilityRank(b));
const abilityReadyKey = (id) => (id === "volley" ? "volleyReady" : id === "burst" ? "burstReady" : ABILITIES.find((a) => a.id === id)?.ready);
const abilityAims = (id) => id === "volley" || id === "burst" || !!ABILITIES.find((a) => a.id === id)?.aim;
const abilityName = (id) => (id === "volley" ? "Arrow Volley" : id === "burst" ? "Arcane Burst" : ABILITIES.find((a) => a.id === id)?.name || id);
function pressAbility(id) {
  if (id === "volley") return volleyPress();
  if (id === "burst") return burstPress();
  const a = ABILITIES.find((x) => x.id === id);
  if (a) abilityPress(a);
}
/** Swaps the places of two abilities and remembers the order. */
function swapAbilities(a, b) {
  const list = [...ABILITY_IDS].sort((x, y) => abilityRank(x) - abilityRank(y)),
    i = list.indexOf(a),
    j = list.indexOf(b);
  if (i < 0 || j < 0 || i === j) return;
  [list[i], list[j]] = [list[j], list[i]];
  abilityOrder = list;
  savePref(ABILITY_ORDER_PREF, JSON.stringify(list));
  abilityLayoutKey = "";
  tone("select");
}
function ensureAbilityBook() {
  if ($("ability-book")) return;
  const book = document.createElement("button");
  book.id = "ability-book";
  book.type = "button";
  book.className = "volley-button ability-book";
  book.hidden = true;
  book.setAttribute("aria-label", t("Abilities"));
  book.dataset.help = t("Ability book: the abilities that do not fit beside the board. Tap to open, then tap one or drag it onto your field. Drag an ability onto another to swap their places.");
  book.innerHTML = `<img src="${"data:image/svg+xml," + encodeURIComponent(BOOK_SVG)}" alt=""><i class="book-count" aria-hidden="true"></i>`;
  book.onclick = () => {
    if (performance.now() < suppressClickUntil) return;
    bookOpen = !bookOpen;
    $("ability-panel").hidden = !bookOpen;
    book.classList.toggle("open", bookOpen);
    tone("select");
  };
  const panel = document.createElement("div");
  panel.id = "ability-panel";
  panel.className = "ability-panel";
  panel.hidden = true;
  $("arena")?.append(book, panel);
  document.addEventListener("pointerdown", (e) => {
    if (bookOpen && !e.target.closest?.("#ability-panel, #ability-book")) closeAbilityBook();
  });
}
function closeAbilityBook() {
  bookOpen = false;
  if ($("ability-panel")) $("ability-panel").hidden = true;
  $("ability-book")?.classList.remove("open");
}
/** Bottom edge (in board-container pixels) of the free space above the cards. */
function cardsTopInArena() {
  const top = $("cards").getBoundingClientRect().top - $("arena").getBoundingClientRect().top;
  return top > 0 ? top : $("arena").clientHeight;
}
/**
 * Mobile Max: the abilities stand in one row above the cards, right of the auto slot (which sits in the
 * bottom-left corner); what does not fit goes into the book at the end of the row, which opens upwards.
 */
function layoutAbilityRow(p, z, book, panel, arenaEl) {
  const owned = ownedAbilities(p),
    size = Math.round(z.side.w),
    gap = 10,
    pitch = size + gap,
    y = Math.round(cardsTopInArena() - 8 - size),
    x0 = Math.round(z.side.x + size + gap + 4),
    fit = Math.max(1, Math.floor((z.w - 6 - x0 + gap) / pitch));
  let shown = owned,
    inBook = [];
  if (owned.length > fit) {
    shown = owned.slice(0, fit - 1);
    inBook = owned.slice(fit - 1);
  }
  const key = ["row", owned.join(","), shown.length, x0, y, size, bookOpen].join("|");
  if (key === abilityLayoutKey) return;
  abilityLayoutKey = key;
  const place = (el, slot) => {
    const left = x0 + pitch * slot + "px",
      top = y + "px";
    if (el.style.left !== left) el.style.left = left;
    if (el.style.top !== top) el.style.top = top;
    if (el.style.getPropertyValue("--slot") !== size + "px") el.style.setProperty("--slot", size + "px");
  };
  shown.forEach((id, i) => {
    const btn = $(id + "-button");
    if (!btn) return;
    if (btn.parentNode !== arenaEl) arenaEl.insertBefore(btn, book);
    place(btn, i);
  });
  inBook.forEach((id, i) => {
    const btn = $(id + "-button");
    if (!btn) return;
    if (panel.children[i] !== btn) panel.insertBefore(btn, panel.children[i] || null);
    if (btn.style.getPropertyValue("--slot") !== size + "px") btn.style.setProperty("--slot", size + "px");
  });
  book.hidden = !inBook.length;
  if (inBook.length) {
    place(book, shown.length);
    book.querySelector(".book-count").textContent = inBook.length;
    Object.assign(panel.style, { left: Math.max(4, Math.min(z.w - size - 16, x0 + pitch * shown.length - 6)) + "px", top: "auto", bottom: Math.round($("arena").clientHeight - y + 8) + "px" });
    panel.style.setProperty("--slot", size + "px");
  } else if (bookOpen) closeAbilityBook();
}
/** Places the owned ability buttons below the level button; in the zoomed layout the rest go into the book. */
function layoutAbilities(p) {
  ensureAbilityBook();
  const z = arena?.geometry?.(),
    book = $("ability-book"),
    panel = $("ability-panel"),
    arenaEl = $("arena");
  if (!z?.side || !book || !panel) return;
  if (z.full) return layoutAbilityRow(p, z, book, panel, arenaEl);
  const owned = ownedAbilities(p),
    size = Math.round(z.side.w),
    gap = z.side.layoutB ? 8 : 14, // tighter in the zoomed column so more abilities fit
    pitch = size + gap,
    first = z.side.y + 14 + size + gap, // the level button sits above the first slot
    dock = $("side-dock"),
    limit = z.side.layoutB && dock && !dock.hidden && dock.style.top ? parseFloat(dock.style.top) - 6 : Infinity,
    fit = Math.max(1, Math.floor((limit - first + gap) / pitch));
  panel.style.bottom = "";
  let shown = owned,
    inBook = [];
  if (owned.length > fit) {
    shown = owned.slice(0, fit - 1);
    inBook = owned.slice(fit - 1);
  }
  const x = Math.round(z.side.x),
    key = [owned.join(","), shown.length, x, Math.round(first), size, bookOpen].join("|");
  if (key === abilityLayoutKey) return;
  abilityLayoutKey = key;
  const place = (el, slot) => {
    const left = x + "px",
      top = Math.round(first + pitch * slot) + "px";
    if (el.style.left !== left) el.style.left = left;
    if (el.style.top !== top) el.style.top = top;
    if (el.style.getPropertyValue("--slot") !== size + "px") el.style.setProperty("--slot", size + "px");
  };
  shown.forEach((id, i) => {
    const btn = $(id + "-button");
    if (!btn) return;
    if (btn.parentNode !== arenaEl) arenaEl.insertBefore(btn, book);
    place(btn, i);
  });
  inBook.forEach((id, i) => {
    const btn = $(id + "-button");
    if (!btn) return;
    if (panel.children[i] !== btn) panel.insertBefore(btn, panel.children[i] || null); // keeps the player's order
    if (btn.style.getPropertyValue("--slot") !== size + "px") btn.style.setProperty("--slot", size + "px");
  });
  book.hidden = !inBook.length;
  if (inBook.length) {
    place(book, shown.length);
    book.querySelector(".book-count").textContent = inBook.length;
    const top = Math.round(first + pitch * shown.length);
    Object.assign(panel.style, { left: Math.max(4, x - size - 22) + "px", top: top + "px" });
    panel.style.setProperty("--slot", size + "px");
  } else if (bookOpen) closeAbilityBook();
}
function bindAbilityButton(id) {
  const btn = $(id + "-button");
  if (!btn || btn.dataset.dragBound) return;
  btn.dataset.dragBound = "1";
  const press = btn.onclick;
  btn.onclick = (e) => {
    if (performance.now() < suppressClickUntil) return;
    if (btn.parentNode?.id === "ability-panel") closeAbilityBook();
    press?.(e);
  };
  btn.addEventListener("pointerdown", (e) => {
    if ((e.button ?? 0) > 0 || !begun) return;
    abilityDrag = { id, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, active: false, cell: null, swap: null };
  });
}
document.addEventListener(
  "pointermove",
  (e) => {
    const d = abilityDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 10) return;
      d.active = true;
      const ghost = $("drag-ghost");
      ghost.src = svgUrl(d.id);
      ghost.classList.add("ability-ghost");
      ghost.hidden = false;
      $(d.id + "-button")?.classList.add("dragging");
    }
    e.preventDefault();
    const ghost = $("drag-ghost"),
      box = document.querySelector(".game-shell").getBoundingClientRect();
    ghost.style.transform = `translate(${e.clientX - box.left - 30}px, ${e.clientY - box.top - 70}px)`;
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".volley-button"),
      swap = under && under.id !== d.id + "-button" ? under : null;
    if (d.swap !== swap) {
      d.swap?.classList.remove("swap-target");
      swap?.classList.add("swap-target");
      d.swap = swap;
    }
    d.cell = swap ? null : dragTarget(e);
    ghost.classList.toggle("over-field", !!d.cell);
  },
  { passive: false },
);
function endAbilityDrag(e, cancelled = false) {
  const d = abilityDrag;
  if (!d || e.pointerId !== d.pointerId) return;
  abilityDrag = null;
  if (!d.active) return;
  const ghost = $("drag-ghost");
  ghost.hidden = true;
  ghost.classList.remove("ability-ghost", "over-field");
  $(d.id + "-button")?.classList.remove("dragging");
  d.swap?.classList.remove("swap-target");
  suppressClickUntil = performance.now() + 400;
  if (cancelled) return;
  if (d.swap) {
    const other = d.swap.id === "ability-book" ? [...$("ability-panel").children].map((b) => b.id.replace(/-button$/, ""))[0] : d.swap.id.replace(/-button$/, "");
    if (other) swapAbilities(d.id, other);
    return;
  }
  if (d.cell) castAbilityAt(d.id, d.cell);
}
document.addEventListener("pointerup", (e) => endAbilityDrag(e));
document.addEventListener("pointercancel", (e) => endAbilityDrag(e, true));
/** Uses an ability dropped on the board: aimed ones strike that cell, the others simply start. */
function castAbilityAt(id, cell) {
  const p = game?.players[own];
  if (!p || !begun || !(p.perks?.[id] > 0)) return;
  closeAbilityBook();
  const readyAt = p[abilityReadyKey(id)] ?? 0;
  if (readyAt > game.time) {
    note(t("{name} ready in {n} s", { name: t(abilityName(id)), n: Math.ceil(readyAt - game.time) }));
    return;
  }
  if (abilityAims(id) && view !== own) {
    note("Drop it on your own field.");
    return;
  }
  setVolleyAim(false);
  if (abilityAims(id)) dispatch({ type: id, x: (cell.gridX + 0.5) / game.grid.cols, y: (cell.gridY + 0.5) / game.grid.rows });
  else dispatch({ type: id });
  tone("select");
}
/** Fires the volley at a point of your field (x, y as shares of the board). */
function fireVolley(x, y) {
  setVolleyAim(false);
  const result = dispatch({ type: aimKind, x, y });
}
function refreshVolley(p) {
  const btn = $("volley-button");
  if (!btn) return;
  const has = begun && !p.out && p.perks?.volley > 0;
  btn.hidden = !has;
  if (!has) return;
  const left = Math.max(0, (p.volleyReady ?? 0) - game.time),
    ready = left <= 0;
  btn.classList.toggle("ready", ready);
  btn.style.setProperty("--cd", ready ? 0 : Math.min(1, left / abilityCd(p, volleyCd(p.perks?.volley || 1))));
  const label = ready ? "" : String(Math.ceil(left));
  if ($("volley-time").textContent !== label) $("volley-time").textContent = label;
  if (!ready && volleyAim && aimKind === "volley") setVolleyAim(false);
}
/** Show a player's maze (from the plates or a swipe). */
function showMaze(player, keepSend = false) {
  if (player === own ? tab !== "build" && !(keepSend && tab === "send") : tab === "research") setPage("build", { scroll: false });
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
      showMaze(q.id, true); // v0.15: swiping to your own field keeps the send cards open
      tone("tap");
      return true;
    }
  }
  return false;
}
/** v0.15: the field a swipe in direction `step` would show (for the border peeking in). */
function laneAt(step) {
  if (!game || !begun) return null;
  const n = game.players.length;
  for (let k = 1; k < n; k++) {
    const q = game.players[(((view + step * k) % n) + n) % n];
    if (!q.out || q.id === own) return q.id === view ? null : q.id;
  }
  return null;
}
const laneInfo = (id) => (id === null || id === undefined ? null : { id, name: seatName(id), color: TEAM_COLORS[seatColors()[id]]?.css || "#888" });
/** v0.15: roll the board smoothly over to a player's field (keeps the page). */
function rollTo(id, apply, speed = 1) {
  if (!arena || id === view) return apply ? apply() : undefined;
  const n = game.players.length,
    fwd = (((id - view) % n) + n) % n,
    step = fwd <= n - fwd ? 1 : -1,
    from = view;
  arena.roll(step, laneInfo(id), apply || (() => {
    view = id;
    selectedTower = null;
    hoverCell = null;
    $("tower-panel").hidden = true;
    deckSignature = "";
    refreshUI();
    arena?.refresh();
  }), laneInfo(from), speed);
}
/**
 * v0.15: Predator view. While the send cards are open and you watch the player you send to,
 * a change of target rolls the view over to the new target.
 */
function predatorCheck() {
  if (!game || !begun || predatorRolling) return;
  if (!predatorView || tab !== "send" || !isFfa()) return void (predatorLast = view !== own ? view : null);
  const target = rivalIndex();
  if (view === target) return void (predatorLast = target);
  if (predatorLast !== null && view === predatorLast && target !== own && !game.players[target]?.out) {
    predatorRolling = true;
    rollTo(target, () => {
      predatorRolling = false;
      predatorLast = target;
      view = target;
      selectedTower = null;
      hoverCell = null;
      $("tower-panel").hidden = true;
      deckSignature = "";
      refreshUI();
      arena?.refresh();
    }, 1 / 0.9); // v0.16g: Predator view rolls 10 % faster
    return;
  }
  predatorLast = null;
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
function towerArtUrl(key, quiet = false) {
  const url = artUrl(key);
  if (TEAM_COLORS[colorChoice].hue === null || !/^(tower|creep)-/.test(key)) return url; // v0.15: creep cards too
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
        const done = c.toDataURL("image/webp", 0.9),
          ready = new Image();
        // v0.10y1: decode the recoloured picture before cards switch to it, so dialogs never show it loading
        ready.src = done;
        preloadedArt.push(ready);
        (ready.decode?.() || Promise.resolve())
          .catch(() => {})
          .then(() => {
            teamArt.set(id, done);
            if (game && !quiet) {
              deckSignature = "";
              renderCards();
            }
          });
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
music.setVolume?.(((muted ? 0 : volume.master) / 100) * (volume.music / 100));
/**
 * v0.22e: Hardo's menu music: the main theme's melody (taken from the menu track by pitch analysis,
 * moved to C minor) played slow on a synthesized pipe organ over a pedal bass, looped.
 */
const hardoOrgan = (() => {
  let ctx = null,
    master = null,
    timer = null,
    playing = false,
    level = 0.6,
    next = 0;
  const BEAT = 0.62,
    // [midi, beats] – rests as null
    MELODY = [[67, 1], [72, 1], [75, 2], [67, 2], [null, 1], [60, 0.5], [63, 0.5], [67, 0.5], [68, 1], [72, 0.5], [75, 0.5], [74, 1.5], [null, 0.5], [72, 1], [75, 0.5], [74, 1], [67, 0.5], [71, 1], [72, 3], [null, 2]],
    // bass chords per 4 beats: C minor, A flat, G, C minor (+ one bar of rest)
    CHORDS = [[36, 48, 55, 63], [32, 44, 51, 60], [31, 43, 50, 59], [36, 48, 55, 63], [36, 43, 48, 51], [null]];
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }
  function pipe(midi, at, dur, gain) {
    const f = 440 * 2 ** ((midi - 69) / 12),
      v = ctx.createGain();
    v.gain.setValueAtTime(0.0001, at);
    v.gain.linearRampToValueAtTime(gain, at + 0.07);
    v.gain.setValueAtTime(gain, at + Math.max(0.08, dur - 0.12));
    v.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.25);
    v.connect(master);
    // drawbars: 16', 8', 4', 2 2/3', 2'
    [[0.5, 0.45, "sine"], [1, 1, "sine"], [2, 0.55, "sine"], [3, 0.3, "sine"], [4, 0.16, "triangle"]].forEach(([k, g, type]) => {
      const o = ctx.createOscillator(),
        og = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f * k, at);
      o.detune.setValueAtTime((k - 1) * 1.5, at);
      og.gain.value = g;
      o.connect(og).connect(v);
      o.start(at);
      o.stop(at + dur + 0.3);
    });
  }
  /** Schedules one pass of the theme from time t; returns its length in seconds. */
  function pass(t) {
    let b = 0;
    for (const [m, beats] of MELODY) {
      if (m) {
        pipe(m, t + b * BEAT, beats * BEAT * 0.94, 0.05);
        pipe(m - 12, t + b * BEAT, beats * BEAT * 0.94, 0.025);
      }
      b += beats;
    }
    CHORDS.forEach((ch, i) => ch.forEach((m) => m && pipe(m, t + i * 4 * BEAT, 4 * BEAT * 0.97, m < 40 ? 0.05 : 0.022)));
    return Math.max(b, CHORDS.length * 4) * BEAT;
  }
  function loop() {
    if (!playing) return;
    while (next < ctx.currentTime + 3) next += pass(next);
    timer = setTimeout(loop, 1000);
  }
  return {
    start(delay = 1) {
      if (playing || !ensure()) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      playing = true;
      master = ctx.createGain();
      master.gain.value = level;
      // a little room: a short feedback delay as reverb
      const d = ctx.createDelay(1),
        fb = ctx.createGain(),
        wet = ctx.createGain();
      d.delayTime.value = 0.23;
      fb.gain.value = 0.35;
      wet.gain.value = 0.35;
      master.connect(ctx.destination);
      master.connect(d);
      d.connect(fb).connect(d);
      d.connect(wet).connect(ctx.destination);
      next = ctx.currentTime + delay;
      clearTimeout(timer);
      timer = setTimeout(loop, Math.max(0, delay - 2.5) * 1000);
    },
    stop() {
      if (!playing) return;
      playing = false;
      clearTimeout(timer);
      const m = master;
      try {
        m.gain.cancelScheduledValues(ctx.currentTime);
        m.gain.setValueAtTime(m.gain.value, ctx.currentTime);
        m.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
      } catch {}
      setTimeout(() => {
        try {
          m.disconnect();
        } catch {}
      }, 1500);
    },
    setLevel(v) {
      level = Math.max(0, Math.min(1, v)) * 0.6;
      if (master && playing) master.gain.setTargetAtTime(level, ctx.currentTime, 0.1);
    },
  };
})();
{
  // the organ follows the music volume and the music switch
  const setVolume = music.setVolume?.bind(music),
    setEnabled = music.setEnabled.bind(music);
  if (setVolume)
    music.setVolume = (v) => {
      setVolume(v);
      hardoOrgan.setLevel(v);
    };
  music.setEnabled = (v) => {
    setEnabled(v);
    if (!v) hardoOrgan.stop();
    musicPlayback = null; // re-evaluate the track
  };
  hardoOrgan.setLevel(((muted ? 0 : volume.master) / 100) * (volume.music / 100));
}
let hardoMusicDelay = null;
// The menu theme (1.3 MB) loads after the game is up, not in competition with it.
let musicPlayback = null;
function syncMusic() {
  // The battle theme keeps running through pause menus; only a finished or
  // abandoned duel returns to the menu theme. v0.22e: in Hardo mode the menu plays his organ theme.
  const battle = Boolean(begun && !shownResult && game?.winner == null);
  const track = battle ? "battle" : hardoUnlocked ? "hardo" : "menu";
  if (track !== musicPlayback) {
    musicPlayback = track;
    if (track === "hardo") {
      music.stop();
      if (musicEnabled) hardoOrgan.start(hardoMusicDelay ?? 1.2);
      hardoMusicDelay = null;
    } else {
      hardoOrgan.stop();
      music.play(track);
    }
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
  shownResult = false,
  predatorLast = null, // v0.15: the target you were watching (Predator view)
  predatorRolling = false;
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
  R00K: ["Watcher Owl", "Archer-Line +{owl} range"],
  R00J: ["Fire Arrows", "Archer-Line +10% damage per level."],
  R005: ["Heavy Weapons", "Footman-Line and Bombard-Line +5% damage."],
  R00M: ["Fire", "Unlocks the fire upgrade paths."],
  R00N: ["Water", "Unlocks the water upgrade paths."],
  R00O: ["Storm", "Unlocks the storm upgrade paths."],
  R00P: ["Plague", "Unlocks the plague upgrade paths."],
  R00Q: ["Earth", "Unlocks the earth upgrade paths."],
  R00R: ["Arcane", "Unlocks the arcane upgrade paths."],
  // v0.19a1: reworked perks; their tooltips come from REWORK_HINT
  R00U: ["Creep Armor", "Creep get HP and income."],
  R00V: ["Leadership", "Creeps get more HP."],
  R00W: ["Tailwind", "Creep Speed."],
  R00X: ["Mind Control", "Creep HP and Creep Speed."],
  R001: ["Creep Medicine", "Creep HP and Creep Income."], // v0.20c: was Healing Power
  R002: ["Melee Protocol", "Attackspeed for melee."],
  R006: ["Magic Bank", "Interest on Gold. Paid out start of each round."],
  R00C: ["Unholy Frenzy", "Attackspeed for all towers."],
  R00D: ["Spirit Wolves", "1 Spirit Wolf per round, stronger every level. It gives income."],
};
/** v0.19a1: the short tooltips of the reworked perks, with the value of the given level. */
const pctOf = (x) => format(Math.round(x * 1000) / 10) + "%";
const REWORK_HINT = {
  R005: (lv) => t("Footman-Line and Bombard-Line +{v} damage", { v: pctOf(HEAVY_WEAPONS * lv) }), // v0.19j
  R002: (lv) => t("Melee attack speed +{v}", { v: pctOf(MELEE_PROTOCOL * lv) }), // v0.19l: shorter
  R00V: (lv) => t("Creeps +{v} HP", { v: pctOf(LEADERSHIP * lv) }),
  R00D: () => t("1 Spirit Wolf per round, stronger every level. It gives income"), // v0.21k
  R00C: (lv) => t("All towers attack speed +{v}", { v: pctOf(FRENZY * lv) }),
  R001: (lv) => t("Creep HP +{a}, creep income +{b}", { a: pctOf(HEALING.hp * lv), b: pctOf(HEALING.income * lv) }), // v0.20c
  R006: (lv) => t("{v} interest on your gold at the start of each round", { v: pctOf(BANK.rate * lv) }),
  R00X: (lv) => t("Creep HP +{a}, speed +{b}", { a: pctOf(MIND.hp * lv), b: pctOf(MIND.speed * lv) }),
  R00W: (lv) => t("Creep Speed +{v}", { v: pctOf(TAILWIND.speed * lv) }),
  R00U: (lv) => t("Creep HP +{a}, income +{b}", { a: pctOf(CREEP_ARMOR.hp * lv), b: pctOf(CREEP_ARMOR.income * lv) }),
  R00J: (lv) => t("Archer-Line +{v} damage", { v: pctOf(0.1 * lv) }),
};

// The original names, except for the creeps and buildings renamed in this port.
const namesEn = { Peon: "Goblin", "Chaos Peon": "Imp", Lumbermill: "EXP Generator", "Skeleton Grunt": "Skeleton Berserker", "Draenai Marauder": "Arcane Marauder" }; // v0.21h: two renames
function itemName(item) {
  if (researchCopy[item?.id]) return t(researchCopy[item.id][0]);
  if (item?.id === "n00Y" && game && burningTreant(game.players[own])) return t("Burning Treant"); // v0.10w
  const short = (item?.shortName || item?.name || "").replace(/\s*\[.*?\]/g, "").trim();
  return namesEn[short] || short;
}
function cardAction(item) {
  return item.kind === "send" ? "send" : item.kind === "research" ? "research" : item.isRoot ? "build" : "upgrade";
}
/** v0.21k: a former upgrade's level is its perk's level now (the research level is gone since v0.21). */
const researchLevel = (q, id) => (RESEARCH_PERKS[id] ? q?.perks?.[RESEARCH_PERKS[id]] || 0 : q?.research?.[id] || 0);
const researchCap = (item) => (RESEARCH_PERKS[item.id] ? PERKS[RESEARCH_PERKS[item.id]]?.max || 1 : researchMax(item));
function cardHint(item, current = false) {
  // v0.19a1: reworked perks show the value of the next level (owned tiles: the current one)
  const have = researchLevel(game?.players[own], item.id),
    lvNow = Math.max(1, Math.min(researchCap(item), current ? have : have + 1));
  if (REWORK_HINT[item.id]) return REWORK_HINT[item.id](lvNow);
  if (item.id === "R00K") {
    // v0.16g: the value of the next level instead of a list of all levels
    const lv = Math.min(OWL.range.length, lvNow);
    return t(researchCopy.R00K[1], { owl: format(OWL.range[lv - 1]), lv });
  }
  if (researchCopy[item.id]) return t(researchCopy[item.id][1]);
  if (item.kind === "send") return t("+{n} income", { n: formatInc(incomeFor(item)) });
  return t(
    { h003: "Arrows", h000: "Melee", h02R: "Splash", h03V: "Magic", h02Q: "+1 income", h05L: "Elements", h01F: "EXP every 5 s" }[
      item.id
    ] || "Tower upgrade",
  );
}
const isFreeLabel = (label) => String(label).startsWith(t("Free"));
/** Income a send adds for you right now, buffs included (Feudality, research), at most 2 decimals. */
const incomeFor = (item) => (game ? sendIncome(game, own, item.id) : item.income);
function priceLabel(item) {
  const free = item.kind === "send" ? 0 : item.id === "h003" ? game?.players[own]?.freeArchers || 0 : item.id === "h01F" ? game?.players[own]?.freeGens || 0 : 0; // v0.19g1: Novice generators
  if (free > 0) return free > 1 ? t("Free ×{n}", { n: free }) : t("Free");
  const c = itemPrice(item);
  return item.kind === "research" ? `${format(c.wood || c.gold)}` : `${format(c.gold)}`;
}
/**
 * v0.15: a creep still waiting for its start delay carries a padlock on crossed chains; the
 * lock shows the rounds left until it opens.
 */
const LOCK_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="lk-steel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8edf2"/><stop offset=".5" stop-color="#9aa6b2"/><stop offset="1" stop-color="#4c5662"/></linearGradient><linearGradient id="lk-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset=".45" stop-color="#e0a020"/><stop offset="1" stop-color="#8a5208"/></linearGradient></defs>${[
  [-1, 1],
  [1, 1],
]
  .map(([sx], k) => {
    const links = [];
    for (let i = 0; i < 9; i++) {
      const t0 = i / 8,
        x = sx < 0 ? 4 + t0 * 92 : 96 - t0 * 92,
        y = 6 + t0 * 88;
      links.push(i % 2 ? `<ellipse cx="${x}" cy="${y}" rx="3.4" ry="7.5" transform="rotate(${sx < 0 ? -45 : 45} ${x} ${y})" fill="none" stroke="url(#lk-steel)" stroke-width="3.2"/>` : `<ellipse cx="${x}" cy="${y}" rx="7.5" ry="4.2" transform="rotate(${sx < 0 ? 45 : -45} ${x} ${y})" fill="none" stroke="#2a3038" stroke-width="5"/><ellipse cx="${x}" cy="${y}" rx="7.5" ry="4.2" transform="rotate(${sx < 0 ? 45 : -45} ${x} ${y})" fill="none" stroke="url(#lk-steel)" stroke-width="3"/>`);
    }
    return `<g class="lk-chain" data-k="${k}">${links.join("")}</g>`;
  })
  .join("")}<path d="M36 46V36a14 14 0 0 1 28 0v10" fill="none" stroke="#2a3038" stroke-width="10"/><path d="M36 46V36a14 14 0 0 1 28 0v10" fill="none" stroke="url(#lk-steel)" stroke-width="6"/><rect x="27" y="44" width="46" height="38" rx="7" fill="url(#lk-body)" stroke="#3a2404" stroke-width="3"/><rect x="31" y="47" width="38" height="5" rx="2.5" fill="#fff6c0" opacity=".55"/></svg>`;
function cardLock(card, rounds) {
  let el = card.querySelector(".card-lock:not(.unlocking)");
  if (!rounds) {
    if (el) {
      // v0.17c: the shackle springs open, the chains slide apart and everything falls off the card.
      // The falling lock lives in its own layer over the card, so a re-render of the deck can't cut it short.
      const r = card.getBoundingClientRect();
      el.remove();
      if (tab === "send" && r.width > 0 && card.isConnected) {
        const fly = Object.assign(document.createElement("span"), { className: "card-lock unlocking lock-fly" });
        fly.innerHTML = el.innerHTML;
        fly.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
        document.body.append(fly);
        setTimeout(() => fly.remove(), 1400);
        sfx.play("unlock");
      }
    }
    card.classList.remove("locked");
    return;
  }
  if (!el) {
    el = Object.assign(document.createElement("span"), { className: "card-lock" });
    el.innerHTML = `${LOCK_SVG}<b></b>`;
    card.append(el);
  }
  card.classList.add("locked");
  const text = String(rounds);
  if (el.lastChild.textContent !== text) el.lastChild.textContent = text;
  el.title = t(rounds === 1 ? "Unlocks next round" : "Unlocks in {n} rounds", { n: rounds });
}
function stockCount(item) {
  return Math.max(0, Math.floor(game.players[own].stock[item.id]?.count ?? 0));
}
function cardStatus(item) {
  const p = game.players[own];
  if (item.kind === "send") {
    if (game.warmup || p.out) return ""; // v0.17: the setup shows the lock (1 round) instead of a timer; v0.18c: no timer once you are out
    const stock = p.stock[item.id];
    if (lockRoundsLeft(game, stock) > 0) return ""; // v0.15: the lock shows the rounds
    if (stock && stock.count < 1) return `${Math.max(1, Math.ceil(stock.next - game.time))}s`;
  }
  const level = researchLevel(p, item.id); // v0.21k
  return item.kind === "research" && level ? t("Level {n}", { n: level }) : "";
}
function setUiPause(reason, value) {
  value ? uiPauses.add(reason) : uiPauses.delete(reason);
  pause(uiPauses.size > 0);
}
function setPage(next, { scroll = true, stayOwn = false } = {}) {
  if (!["build", "send", "research"].includes(next)) return;
  tab = next;
  view = next === "send" && !stayOwn ? rivalIndex() : own; // v0.15: a double tap on Send stays on your field
  predatorLast = view !== own ? view : null;
  selectedTower = null;
  pending = null;
  $("tower-panel").hidden = true;
  if (next === "send") document.querySelector('[data-tab="send"]')?.classList.remove("nudge");
  document.querySelector(`[data-tab="${next}"]`)?.classList.remove("coach-nudge");
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
    mode = !item && AUTO_MODES.includes(p.autoMode) && p.autoMode !== "default" ? p.autoMode : null, // v0.18h: Eco / Tier Up
    on = (!!item || !!mode) && p.autoSendActive !== false,
    slot = $("auto-slot"),
    key = `${id}|${on}|${mode}`;
  $("tier-badge").textContent = `T${p.tier}`;
  if (slot.dataset.key === key) return;
  slot.dataset.key = key;
  slot.classList.toggle("filled", !!item || !!mode);
  slot.classList.toggle("mode", !!mode);
  slot.classList.toggle("off", (!!item || !!mode) && !on);
  const off = on ? "" : `<span class="auto-slot-off">${t("Off")}</span>`;
  slot.innerHTML = item
    ? `<img src="${towerArtUrl(artFor(item))}" alt="">${off}`
    : mode
      ? `<img class="auto-mode-icon" src="${iconUrl(mode === "eco" ? "coin" : "crown")}" alt=""><span class="auto-mode-name">${t(mode === "eco" ? "Eco" : "Tier Up")}</span>${off}`
      : `<span class="auto-slot-empty auto-slot-label">${t("Auto Spawn")}</span>`; // v0.19k: the name in the button instead of "+" and the headline
  slot.setAttribute(
    "aria-label",
    item
      ? t("Auto Spawn: {name} ({state}). Drag creep to activate. Double click to switch mode", { name: itemName(item), state: t(on ? "on" : "off") })
      : mode
        ? t(mode === "eco" ? "Eco: sends the best budget creeps. Double click to switch mode" : "Tier Up: saves for the boss, buys budget creeps when that is faster. Double click to switch mode") + (on ? "" : " (" + t("off") + ")") // v0.19k: shorter
        : t("Drag creep to activate. Click to switch mode"), // v0.22m2: a tap on the empty slot switches the mode
  );
  slot.title = slot.getAttribute("aria-label");
}
// ---- help mode: the "?" button switches tooltips on for every button ---------------------
const HELP_PREF = "felito.help.tooltips";
let helpMode = false, // v0.19a1: the "?" tooltips start switched off in every match
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

/** v0.14: a one-line description per ability for the tooltips (by its shown name). */
const POISON_SLOW = 0.03; // v0.22n2: simulation.js POISON_SLOW_PER_STACK, when the ability has no slow of its own
const ABILITY_DESC = {
  Multishot: "Fires one arrow per tower level at different creeps.", // v0.16
  // v0.16k: ultimates and armour that had no description yet
  "Auto Cannon": "Ultimate: fires cannon shots on its own when charged",
  Blizzard: "Ultimate: ice shards hit every creep in a wide area",
  Flamestrike: "Ultimate: a column of fire burns an area",
  "Mega Tsunami": "Ultimate: a huge wave crushes a whole row of creeps",
  "Swarm Rockets": "Ultimate: a swarm of rockets hits many creeps at once",
  "Void Armor": "Ignores 5 damage of every hit, but always takes at least 20%",
  "Tower Repair": "Repairs a tower over a few seconds",
  "Switch Weapon": "Switches between two attack modes",
  "Bounty Bonus": "+20% bounty per kill", // v0.22j1: fixed bonus instead of a chance
  "Explode Building": "Explodes when sold, hurting creeps nearby",
  "Explode on Death": "Explodes when destroyed",
  Dodge: "Has a chance to dodge attacks", // v0.22n2: was Evasion
  "Arrow Resistance": "Takes 33% less damage from Archer-Line towers",
  "Siege Resistance": "Takes 33% less damage from Bombard-Line towers",
  Deathrattle: "Summons 3 Skeletons on death",
  "Spawn Wisp": "Spawns a Wisp on death", // v0.21z: Treant
  Armor: "Ignores some damage from every hit", // v0.22n2: was Scale Armor
  "Nerf Resistance": "Slows, stuns and curses last much shorter",
  "Magic Resistance": "Magic attacks and spells inflict less damage",
  "Slow Resistance": "Reduces slowing debuffs",
  "Tier Boss": "Reduced damage from attacks, Debuffs last shorter", // v0.22n2
  "Splash Attack": "Part of the damage also hits creeps nearby",
  "Speed Aura": "Creeps nearby run faster; flying creeps get half the bonus", // v0.17p: was Endurance Aura
  "Divine Shield": "Now and then invulnerable for a few seconds",
  "Creep Armor Aura": "Creeps nearby get more armor",
  Detector: "Reveals invisible creeps nearby",
  Invisibility: "Invisible; only towers near a detector hit it",
  Spawn: "Spawns more creeps on its way",
  "Critical Shot": "Chance to deal double damage",
  "Multi Shot": "Shoots several arrows at once",
  "Frost Attack": "Hits slow the target",
  "Immolation Aura": "Burns creeps around the tower; flying creeps take 50% less damage",
  "Flash Execution": "Extra damage to creeps on low health", // Bash Tower line (the Death Knight's cull: abilityDesc)
  Feedback: "Extra damage to summoned creeps",
  Poison: "Slows and deals damage per second, can stack.",
  "Critical Hit": "Chance to deal double damage",
  "Frenzy Aura": "Towers nearby attack faster",
  "Bouncing Projectiles": "Shots bounce to further creeps",
  "Mana Regeneration Aura": "Towers nearby regain mana 50% faster", // v0.17p
  "Firestorm Aura": "Burns all creeps in a wide area",
  "Frost Aura": "Slows ground creeps in a wide area",
  "Slow Aura": "Slows flying creeps in a wide area",
  "Super Stun": "Chance to stun and deal extra damage",
  Entangle: "Chance to root a creep and hurt it over time",
  "Damage Aura": "Towers nearby deal more damage",
  "Mana Aura": "Towers nearby regain mana",
  "Corrosive Aura": "Lowers the armor of creeps nearby",
  "Decay Attack": "Chance to destroy part of a creep's health",
  "Napalm Aura": "Strongly lowers the armor of creeps nearby",
  "Flames and Decay": "Burns targets; chance of a flame strike",
  Slow: "Slows the attacks of a tower",
  "Entangle Aura": "Slightly slows ground creeps nearby",
  "Trueshot Aura": "Ranged towers nearby deal more damage", // v0.17p
  Production: "Generates EXP every 5 seconds",
  Howl: "When creeps come within 1.5 fields: 25% slower and +20% damage from towers for 12 s (cooldown 20 s)", // v0.17p
  "Phoenix Fire": "Burns creeps around the tower: 350 damage per second to ground and air", // v0.17p
  "Phoenix Stun": "Chance to stun and deal big extra damage",
  Stun: "Chance to stun and deal extra damage",
  "Arcane Missile": "Spell: magic missile damage",
  "Chain Lightning": "Spell: lightning jumps between creeps",
  "Stomp Slow": "Chance to slow creeps around the tower",
  "Skirmish Aura": "Melee towers nearby deal more damage",
  "Focus Fire": "Damage +9% every 0.25 s while attacking the same target, up to 500%", // v0.18b: replaces Armor Disruption
  "Curse Aura": "Towers nearby attack slower",
  "Disease Barrage": "Shots leave a disease cloud that hurts over time",
};
/** v0.17p: descriptions that depend on the tower (crit values per level, the Death Knight's cull). */
function abilityDesc(name, item) {
  if (/^Critical (Hit|Shot)$/.test(name)) {
    const a = (item.abilities || []).map((id) => catalog.abilities[id]).find((x) => x?.baseId === "ACct");
    const at = (key) => {
      const v = a?.fields?.[key],
        lvl = Math.min(Number(a?.fields?.alev?.[0] ?? 1), item.level || 1);
      return Number(v?.[lvl] ?? v?.[1] ?? v?.[0] ?? 0);
    };
    const chance = at("Ocr1"),
      mult = at("Ocr2");
    if (chance > 0 && chance < 1 && mult > 1) return `${Math.round(chance * 100)}% chance to deal ${Math.round(mult * 100)}% damage`;
  }
  if (name === "Flash Execution" && item.id === "h02C") return "Creeps below 666 or 10% HP are instant kills."; // v0.22n2
  // v0.22n2: creep and tower abilities with their values
  const abil = (re, base) => (item.abilities || []).map((id) => catalog.abilities[id]).find((a) => a && (!base || a.baseId === base) && re.test(String(a.fields?.anam?.[0] ?? a.fields?.anam?.[1] ?? "").replace(/\|c[0-9a-fA-F]{8}|\|r/g, "")));
  const fv = (a, key, lvl = 1) => {
    const v = a?.fields?.[key];
    if (v == null) return NaN;
    const top = Math.max(...Object.keys(v).map(Number).filter(Number.isFinite), 0);
    return Number(v[Math.min(lvl, top)] ?? v[1] ?? v[0]);
  };
  const pctN = (x) => num(Math.round(x * 1000) / 10, { maximumFractionDigits: 1 });
  if (name === "Armor") {
    const n = fv(abil(/^Scale Armor$/, "Ansk"), "Ssk3");
    if (n > 0) return `Ignore ${num(n)} damage from every hit`;
  }
  if (name === "Magic Resistance") {
    const n = fv(abil(/^Magic Resistance$/, "AIsr"), "isr2");
    return `Magic attacks and spells inflict ${pctN(n > 0 ? n : 0.3)}% less damage`;
  }
  if (name === "Slow Resistance") {
    const a = abil(/^Slow Resistance$/);
    if (a?.resist > 0) return `Reduces slowing debuffs by ${pctN(a.resist)}%`;
  }
  if (name === "Dodge") {
    const n = fv(abil(/^Evasion$/, "ACes"), "Eev1");
    return `Has ${pctN(n > 0 ? n : 0.2)}% chance to dodge attacks`;
  }
  if (name === "Poison") {
    const a = abil(/^Poison$/, "Aspo"),
      lvl = item.level || 1,
      dps = Math.max(1, fv(a, "Spo1", lvl) || 0),
      slow = fv(a, "Spo2", lvl) || POISON_SLOW;
    if (a) return `Slows by ${pctN(slow)}% and deals ${num(dps)} damage per second, can stack.`;
  }
  if (name === "Tier Boss") return "Reduced damage from attacks, Debuffs last shorter";
  // v0.21z: Treant EXP (30 − Treants you bought) and the Meat Golem's Enrage
  if (name === "EXP Bonus") {
    const bought = (game && game.players[own]?.treantCount) || 0,
      exp = Math.max(0, TREANT.exp - bought);
    return `Gives you ${exp} EXP when killed, 1 less for every Treant you buy`;
  }
  if (name === "Enrage") {
    return "Denies its first death and rises enraged with faster speed"; // v0.22n2 (enraged: +80 % speed)
  }
  return ABILITY_DESC[name];
}
/**
 * v0.16k: escaped text with its values (numbers, percentages, seconds, fields) in gold, so the
 * important part of a tooltip stands out.
 */
/** v0.22g1: tower line names ("Archer-Line") stand out in white in every tooltip. */
const LINE_NAME_RE = /\b(Archer|Arrow|Bombard|Footman|Melee)-Line\b/g;
const lineHtml = (html) => html.replace(LINE_NAME_RE, '<span class="line-name">$1-Line</span>');
function valHtml(text) {
  // values only (no ordinals like "4th", no digits inside escaped entities like &#39;)
  // v0.17g: EXP values in the EXP purple
  // v0.19j: gold amounts in the gold of the HUD, income in its green, EXP in its purple (by the word next to the value)
  const kindOf = (v, before, after) => {
    // a value right after another label ("HP +8%") belongs to that label, not to the word after it
    const label = (before.match(/([A-Za-z]+)\s*$/) || [])[1],
      free = !label || /^(and|or|by|to|for|of|steal|instantly|gives?|gets?|with|plus|another|extra|costs?|pays?|earns?)$/i.test(label),
      next = (w) => free && new RegExp("^\\s*(?:(?:more|less)\\s+)?" + w + "\\b", "i").test(after);
    if (/EXP$/i.test(v) || /EXP(?:\s+gain)?\s*$/i.test(before) || next("EXP")) return " exp";
    if (/gold$/i.test(v) || /\bgold\s*$/i.test(before) || next("gold")) return " gold";
    if (/\bincome\s*$/i.test(before) || next("income")) return " inc";
    return "";
  };
  return esc(text).replace(/(^|[^&#\w])([+−-]?\d+(?:[.,]\d+)?(?!\d|st\b|nd\b|rd\b|th\b)(?:\s?(?:%|s\b|fields?\b|gold\b|EXP\b|×))?)/g, (m, a, v, at, all) => `${a}<b class="val${kindOf(v, all.slice(Math.max(0, at - 16), at + a.length), all.slice(at + m.length, at + m.length + 14))}">${v}</b>`).replace(LINE_NAME_RE, '<span class="line-name">$1-Line</span>'); // v0.22g1: tower line names in white
}
/** v0.16k: typos in the map data, fixed for display. */
const ABILITY_RENAME = { Invisibillity: "Invisibility", "Mana Regenration Aura": "Mana Regeneration Aura", "Scale Armor": "Armor", Evasion: "Dodge" }; // v0.22n2: Armor, Dodge
/** Readable ability names of a unit (internal helpers and colour codes left out). */
function abilityNames(item) {
  const names = (item.abilities || [])
    .map((id) => catalog.abilities[id])
    .filter((a) => a && !HIDDEN_ABILITIES.has(a.baseId))
    .map((a) => String(a.fields?.anam?.[0] ?? a.fields?.anam?.[1] ?? "").replace(/\|c[0-9a-fA-F]{8}|\|r|\[[^\]]*\]/g, "").trim())
    .map((n) => ABILITY_RENAME[n] || n)
    .filter((n) => n && !n.startsWith("*") && !/^Ani|Animation|Dummy|Spellbook/i.test(n));
  if (fireArcher(item.id)) names.push("Multishot"); // v0.16
  return [...new Set(names)];
}
/** v0.17c: classes perks and quests refer to (undead, heavy, flying, boss, spawns on death). */
function creepClasses(item) {
  const out = [];
  if (item.bossTier) out.push(t("Boss"));
  if (item.flying) out.push(t("Flying"));
  if (UNDEAD_SENDS.has(item.id)) out.push(t("Undead"));
  if (isHeavy(item)) out.push(t("Heavy"));
  if (hasDeathrattle(item.id)) out.push(t("Spawns on death"));
  return out;
}
/** v0.22n2: damage per second: from 10 on at most one decimal, from 100 on none. */
const dpsFormat = (v) => num(v, { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2 });
/** v0.21x: a stat as "5 → 6" when perks or upgrades change it, else just the value. */
function changed(base, value, fmt = format) {
  return Number.isFinite(base) && Math.abs(value - base) > 0.004 && fmt(base) !== fmt(value) ? `${fmt(base)} → ${fmt(value)}` : fmt(value);
}
/**
 * Tooltip of a card or a tower. `who` = whose stats (v0.17c: enemy towers too); `bare` leaves out
 * the head line and the warning (used inside the detail dialog).
 */
function statTip(item, action, towerId = null, who = own, bare = false) {
  const a = who === own && action !== "info" ? available(game, own, action, item.id, towerId) : { ok: true },
    price = action === "build" ? priceLabel(item) : format(itemPrice(item).gold),
    rows = [],
    after = [];
  const abilities = abilityNames(item),
    abilityHtml = abilities.length
      ? `<div class="tip-abilities"><span>${t("Abilities")}</span>${abilities.map((n) => `<p><b>${esc(t(n))}</b>${abilityDesc(n, item) ? ` – ${valHtml(t(abilityDesc(n, item)))}` : ""}</p>`).join("")}</div>`
      : "";
  if (item.kind === "send") {
    // v0.17: Income and Profit (v0.18h, was Value) first (green), then Hitpoints, Speed, Abilities, Stock (current / max)
    const unit = catalog.byId[item.spawnIds?.[0]] || item,
      us = getStats(game, who, unit.id),
      ub = baseStats(game, who, unit.id), // v0.21x
      inc = incomeFor(item),
      cost = itemPrice(item).gold;
    rows.push([t("Income"), changed(item.income, inc, (v) => "+" + formatInc(v)), "inc"]); // v0.21x: base → current, no "base"
    rows.push([t("Profit"), cost > 0 ? `${num((inc / cost) * 100, { maximumFractionDigits: 1 })} %` : "–", "inc"]);
    rows.push([t("Hitpoints"), changed(ub.hp, us.hp)]);
    rows.push([t("Speed"), `${changed(ub.speed / game.grid.cellUnits, us.speed / game.grid.cellUnits)} ${t("fields/s")}`]);
    const classes = creepClasses(item);
    if (classes.length) rows.push([t("Classification"), classes.join(", ")]); // v0.17c
    after.push([t("Stock"), `${stockCount(item)}/${stockMaxOf(game.players[own], item)}`]);
  } else if (!item.attacks && item.woodIncome) {
    // v0.21n: EXP Generator: no attack values, just what it is
    return {
      html:
        (bare ? "" : `<div class="tip-head"><b>${esc(itemName(item))}</b><span class="tip-gold"><img src="${iconUrl("coin")}" alt="Gold">${esc(price)}</span></div>`) +
        `<div class="tip-text">${esc(t("A building that does not attack. It generates EXP for you every few seconds."))}</div>` +
        (a.ok || bare ? "" : `<div class="tip-warn">${esc(t(a.reason))}</div>`) +
        perkBuffRow(item, who),
    };
  } else {
    const s = getStats(game, who, item.id),
      b = baseStats(game, who, item.id), // v0.21x: "base → current"
      air = item.targets?.includes("air"),
      ground = item.targets?.includes("ground");
    // v0.17c: "10 → 12" when upgrades raise the damage
    const cu = game.grid.cellUnits,
      ai = attackInfo(game, item.id, game.players[who]); // v0.21u: Gunpowder
    rows.push([t("Damage"), changed(b.damage, s.damage)]);
    rows.push([t("Damage/second"), s.cooldown > 0 ? changed(b.cooldown > 0 ? b.damage / b.cooldown : NaN, s.damage / s.cooldown, dpsFormat) : "–"]); // v0.16e, v0.17g: right below Damage
    rows.push([t("Range"), isMeleeTower(item) ? t("Melee") : changed(b.range / cu, s.range / cu)]); // v0.17m: numbers only
    if (ai.splash) rows.push([t("Splash Radius"), changed(attackInfo(game, item.id, null).splash / cu, ai.splash / cu)]); // v0.17g, v0.17m: numbers only
    if (ai.splash && isMeleeTower(item) && item.splashMediumFactor > 0 && !(item.splashFull > 0)) rows.push([t("Splash Damage"), Math.round(item.splashMediumFactor * 100) + "%"]); // v0.22a
    if (ai.multi) rows.push([t("Multi Targets"), String(ai.multi)]);
    if (ai.bounce) rows.push([t("Bouncing Targets"), String(ai.bounce)]);
    rows.push([t("Attacks every"), `${changed(b.cooldown, s.cooldown)} s`]);
    rows.push([t("Targets"), ground && air ? t("ground & air") : air ? t("air only") : t("ground only")]);
    // v0.17g: towers without abilities show no Abilities line (like creeps)
  }
  const row = ([k, v, cls]) => `<div class="tip-row${cls ? " tip-" + cls : ""}"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
  return {
    html:
      (bare ? "" : `<div class="tip-head"><b>${esc(itemName(item))}</b><span class="tip-gold"><img src="${iconUrl("coin")}" alt="Gold">${esc(price)}</span></div>`) +
      rows.map(row).join("") +
      // v0.16f: creeps show Stock right above the abilities, abilities last
      (item.kind === "send" ? after.map(row).join("") + abilityHtml : abilityHtml + after.map(row).join("")) +
      (a.ok || bare ? "" : `<div class="tip-warn">${esc(t(a.reason))}</div>`) +
      (item.kind === "send" ? "" : perkBuffRow(item, who)),
  };
}
/** v0.18b: small icons of the perks that buff this tower, in a row at the bottom of its tooltip. */
function perkBuffRow(item, who) {
  const buffs = game ? towerPerkBuffs(game, who, item.id) : [];
  if (!buffs.length) return "";
  return `<div class="tip-icons tip-buffs">${buffs
    .map((b) => {
      const name = b.research ? itemName(catalog.byId[b.id]) : t(PERKS[b.id].name), // v0.19a1: research perks too
        img = b.research ? researchArt(catalog.byId[b.id]) : PERK_ART[b.id]();
      return `<span class="tip-icon" data-buff-name="${esc(name)}" data-buff-level="${b.level || 1}" data-buff-text="${esc(t(b.text))}"><img src="${img}" alt="${esc(name)}">${b.level > 1 ? `<b>${b.level}</b>` : ""}</span>`; // v0.21g: own hover tooltip
    })
    .join("")}</div>`;
}
/** v0.18b: tooltip of an enemy's info window: lives, gold, income, level and its elements as icons. */
function playerTip(q) {
  if (!q || !game) return "";
  const els = catalog.factions.filter((f) => q.research?.[f.unlock]);
  const row = (k, v, cls = "") => `<div class="tip-row${cls}"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
  return {
    html:
      `<div class="tip-head"><b>${esc(playerLabel(q))}</b>${q.out ? `<span class="tip-level">${esc(t("out"))}</span>` : ""}</div>` +
      row(t("Lives"), String(q.lives)) +
      row(t("Gold"), q.out ? "–" : resourceNumber(Math.floor(q.gold))) +
      row(t("Income"), q.out ? "–" : "+" + resourceNumber(Math.floor(q.income)), " tip-inc") +
      row(t("Level"), String(q.level || 1)) +
      row(t("Tier"), String(q.tier || 1)) + // v0.22u2
      row(t("Maze value"), resourceNumber(towerWorth(q)), " tip-gold") + // v0.19k: what the player's towers cost
      (els.length ? `<div class="tip-icons tip-elements">${els.map((f) => `<span class="tip-icon el-${f.id}" style="--el:${f.color}" title="${esc(t(f.name))}"><img src="${iconUrl(ELEMENT_ICON[f.id])}" alt="${esc(t(f.name))}"></span>`).join("")}</div>` : ""),
  };
}
/** v0.18b: a player's full name for tooltips: AI players as "AI Easy Green". */
function playerLabel(q) {
  if (!q) return "";
  if (q.ai && !q.missionName) return `${t("AI")} ${t(AI_NAMES[q.aiLevel || game.aiLevel] || "")} ${t(TEAM_COLORS[seatColors()[q.id]]?.name || "")}`.replace(/\s+/g, " ").trim();
  return seatName(q.id);
}
/** Tooltip: values for creep and tower cards, else an explicit help text or the button's label. */
/**
 * v0.17q: tooltip of an active ability button: a brief description, then Damage, Radius and
 * Cooldown (plus a line where the ability needs one), with the player's current values.
 */
function abilityTip(id) {
  const p = game?.players[own],
    lv = Math.max(1, p?.perks?.[id] || 1),
    i = Math.min(5, lv) - 1,
    fields = (n) => `${format(n)}`,
    tips = {
      volley: () => ["Arrows rain on an area", [["Damage", `${format(VOLLEY.bonus + getStats(game, own, "h003").damage)} per arrow`], ["Arrows", `${VOLLEY.perLevel * lv} + ${VOLLEY.perTower} per Archer-Line tower`], ["Radius", fields(VOLLEY.radius)], ["Cooldown", `${volleyCd(lv)} s`]]],
      burst: () => ["Deals damage split among creeps in a radius", [["Damage", format(burstDamage(p, lv))], ["Radius", fields(burstRadius(lv))], ["Cooldown", `${BURST.cooldown} s`]]],
      pillar: () => [`A pillar of fire burns an area for ${PILLAR.duration} s, up to 75% more in its centre`, [["Damage", `${format(pillarDamage(p, lv))} every ${PILLAR.interval} s`], ["Radius", fields(PILLAR.radius)], ["Cooldown", `${PILLAR.cooldown} s`]]],
      agolem: () => {
        const hp = golemHp(p, lv);
        return ["A golem walks your path upwards, knocks creeps back, then moves on to the next lane", [["Damage", `${format(hp * AGOLEM.loss[i] * AGOLEM.damage)} per hit`], ["Radius", fields(AGOLEM.reach)], ["Golem life", format(hp)], ["Cooldown", `${AGOLEM.cooldown} s`]]];
      },
      monsun: () => [`Storm winds push the creeps in your field back for ${MONSUN.duration[i]} s; lightning strikes flyers`, [["Damage", `${format(monsunDamage(p, lv))} every ${MONSUN.strike} s`], ["Radius", t("Whole field")], ["Cooldown", `${MONSUN.cooldown} s`]]],
    };
  if (!tips[id] || !game) return null;
  const [desc, rows] = tips[id]();
  return {
    html:
      `<div class="tip-head"><b>${esc(t(abilityName(id)))}</b>${p?.perks?.[id] ? `<span class="tip-level">${esc(t("Level {n}", { n: lv }))}</span>` : ""}</div>` +
      `<div class="tip-text">${esc(t(desc))}</div>` +
      rows.map(([k, v]) => `<div class="tip-row"><span>${esc(t(k))}</span><b>${lineHtml(esc(v))}</b></div>`).join(""),
  };
}
function helpText(el) {
  const abilityId = /^(volley|burst|pillar|agolem|monsun)-button$/.exec(el.id || "")?.[1];
  if (abilityId && game) return abilityTip(abilityId) || ""; // v0.17q: no use instructions, only the values
  // v0.18b: enemy info windows (4+ players: one cell per enemy; duel: the enemy plate)
  if (game && begun && el.dataset.seat !== undefined && el.classList.contains("enemy-cell")) return playerTip(game.players[Number(el.dataset.seat)]);
  if (game?.teams && begun && el.classList.contains("team-cell")) return teamTip(Number(el.dataset.team)); // v0.20c
  if (game && begun && el.classList.contains("rival") && !isFfa()) return playerTip(game.players[rivalIndex()]);
  if (game && begun && el.classList.contains("player-plate") && el.classList.contains("own")) return playerTip(game.players[own]); // v0.19k: own window too
  if (el.id === "auto-slot") return el.getAttribute("aria-label") || ""; // v0.19k: Eco / Tier Up / creep explained
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
  placeTip(el.getBoundingClientRect());
}
/** Puts the tooltip above (or below) a screen rectangle. */
function placeTip(r) {
  const w = helpTip.offsetWidth,
    h = helpTip.offsetHeight,
    left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)),
    top = r.top - h - 8 >= 6 ? r.top - h - 8 : Math.min(innerHeight - h - 6, r.bottom + 8);
  helpTip.style.left = left + "px";
  helpTip.style.top = top + "px";
}
/** v0.17c: a tower's tooltip over the tower itself (enemy towers can be inspected this way). */
let towerTipTimer = 0,
  towerTipOn = false;
function showTowerTip(tower, who) {
  const item = catalog.byId[tower.typeId],
    pt = arena?.cellCenter?.(tower.gridX ?? 0, tower.gridY ?? 0);
  if (!item || !pt) return;
  helpFor = null;
  helpTip.innerHTML = statTip(item, "info", tower.id, who).html;
  helpTip.classList.add("stats");
  helpTip.hidden = false;
  const box = $("arena").getBoundingClientRect(),
    cell = (arena.geometry?.().cw || 48) * 0.5;
  placeTip({ left: box.left + pt.x - cell, width: cell * 2, top: box.top + pt.y - cell * 1.4, bottom: box.top + pt.y + cell });
  towerTipOn = true;
  clearTimeout(towerTipTimer);
  towerTipTimer = setTimeout(hideTowerTip, 5000);
}
function hideTowerTip() {
  if (!towerTipOn) return;
  towerTipOn = false;
  clearTimeout(towerTipTimer);
  if (!helpFor) helpTip.hidden = true;
  buffTip.hidden = true; // v0.21g
}
document.addEventListener("pointerdown", hideTowerTip, true);
function hideHelp() {
  helpFor = null;
  helpTip.hidden = true;
  buffTip.hidden = true; // v0.21g
  clearTimeout(helpTimer);
}
// ---- v0.21g: the perk icons in a tower tooltip get their own small tooltip on hover --------------
// The main tooltip stays open while the pointer crosses the short gap to it and rests on its icons.
const buffTip = Object.assign(document.createElement("div"), { className: "help-tip stats buff-tip", hidden: true });
buffTip.setAttribute("role", "tooltip");
document.body.append(buffTip);
let tipGrace = 0;
const graceHide = () => {
  clearTimeout(tipGrace);
  tipGrace = setTimeout(() => {
    if (helpFor && !helpTip.matches(":hover") && !helpFor.matches?.(":hover")) hideHelp();
  }, 300);
};
helpTip.addEventListener("pointerover", (e) => {
  const icon = e.target.closest?.(".tip-buffs .tip-icon");
  clearTimeout(tipGrace);
  if (!icon) return;
  buffTip.innerHTML =
    `<div class="tip-head"><b>${icon.dataset.buffName}</b><span class="tip-level">${esc(t("Level {n}", { n: icon.dataset.buffLevel }))}</span></div>` +
    `<div class="tip-text">${valHtml(icon.dataset.buffText)}</div>`;
  buffTip.hidden = false;
  const r = icon.getBoundingClientRect(),
    w = buffTip.offsetWidth,
    h = buffTip.offsetHeight;
  buffTip.style.left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + "px";
  buffTip.style.top = (r.top - h - 6 >= 6 ? r.top - h - 6 : r.bottom + 6) + "px";
});
helpTip.addEventListener("pointerout", (e) => {
  if (e.target.closest?.(".tip-buffs .tip-icon") && !e.target.closest(".tip-icon").contains(e.relatedTarget)) buffTip.hidden = true;
  if (!helpTip.contains(e.relatedTarget) && !(helpFor && helpFor.contains(e.relatedTarget))) graceHide();
});
const helpTarget = (e) => (e.target.closest?.("dialog") ? null : e.target.closest?.("[data-help], button, [role=button], [data-card], [data-upgrade]"));
// v0.15: in the PC version, resting the mouse on a card shows its values without help mode
let pcTipTimer = 0;
document.addEventListener("pointerover", (e) => {
  if (e.pointerType === "touch") return;
  if (helpTip.contains(e.target) || buffTip.contains(e.target)) return; // v0.21g: resting on the tooltip's own icons
  if (!helpMode) {
    if (controlMode !== "pc") return;
    let card = e.target.closest?.("dialog") ? null : e.target.closest?.("[data-card], [data-upgrade], .enemy-cell, .player-plate.rival:not(.multi), .player-plate.own, #auto-slot"); // v0.18b: enemy info windows too; v0.19k: own window and the auto-spawn slot
    // v0.17g: creep cards show their tooltip only with tooltips switched on (the ? button)
    if (card?.dataset.card && catalog?.byId[card.dataset.card]?.kind === "send") card = null;
    clearTimeout(pcTipTimer);
    if (!card) return helpFor && graceHide(); // v0.21g: a short grace period to reach the tooltip's icons
    clearTimeout(tipGrace);
    if (card !== helpFor) pcTipTimer = setTimeout(() => card.isConnected && card.matches(":hover") && showHelp(card), 320);
    return;
  }
  const el = helpTarget(e);
  clearTimeout(tipGrace);
  if (el && el !== helpFor) showHelp(el);
  else if (!el) graceHide();
});
document.addEventListener("pointerout", (e) => {
  if ((helpMode || controlMode === "pc") && helpFor && !helpFor.contains(e.relatedTarget) && !helpTip.contains(e.relatedTarget)) graceHide(); // v0.21g
});
// Touch has no hover: in help mode a tap also shows the tip for a moment.
document.addEventListener("pointerdown", (e) => {
  // v0.18b: a tap on an enemy's info window shows its values for a moment (also without help mode)
  if (!helpMode && e.pointerType === "touch" && begun) {
    const plate = e.target.closest?.("dialog") ? null : e.target.closest?.(".enemy-cell, .player-plate.rival:not(.multi), .player-plate.own");
    if (!plate) return;
    showHelp(plate);
    clearTimeout(helpTimer);
    helpTimer = setTimeout(hideHelp, 2600);
    return;
  }
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
    (el.dataset.tipText ? `<div class="tip-text">${valHtml(el.dataset.tipText)}</div>` : "");
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
  if (performance.now() - queueCancelAt < 250) return; // v0.18a: the right click cancelled a pre-build; keep the picked card
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
/** v0.19d2: a player name in a notification, shown in that player's colour (see toast). */
const nameTag = (name, css) => "\u0001" + (css || "#ffffff") + "\u0002" + name + "\u0003";
const seatTag = (i) => nameTag(seatName(i), TEAM_COLORS[seatColors()[i]]?.css);
function toast(message, kind = "", force = false) {
  if (!popNotes && !force) return; // v0.13: notifications can be hidden (Options › Graphic)
  const el = $("toast"),
    text = t(message); // literal German messages and simulation reasons translate here
  if (text.includes("\u0001")) el.innerHTML = esc(text).replace(/\u0001([^\u0002]*)\u0002([^\u0003]*)\u0003/g, (_, css, name) => `<b class="toast-name" style="color:${css}">${name}</b>`);
  else el.textContent = text;
  el.dataset.kind = kind;
  el.classList.remove("show");
  placeToast(el);
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove("show"), 2200);
}
/** v0.16i: the bottom banner always sits on the bottom edge of the playing field, not over its lower third. */
function placeToast(el = $("toast")) {
  const z = arena?.geometry?.(),
    box = $("arena")?.getBoundingClientRect(),
    shell = el.offsetParent?.getBoundingClientRect();
  if (!z || !box || !shell || !(z.bh > 0)) {
    el.style.top = el.style.bottom = "";
    return;
  }
  // Mobile Max: the board runs under the cards, so the banner sits on the free space's lower edge
  const edge = box.top + (z.full ? z.clearBottom : z.top + z.bh) - shell.top;
  el.style.bottom = "auto";
  el.style.top = Math.round(edge - el.offsetHeight - 4) + "px";
}
/** Minor hints go to the bottom banner only while tips are switched on (v0.09). */
function note(message, kind = "") {
  if (tipsEnabled) toast(message, kind);
}
let lastToneAt = 0;
function tone(name = "tap") {
  lastToneAt = performance.now();
  sfx.play(name);
}
// v0.17g: every button in a menu or dialog clicks, unless its own handler already played a sound
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("dialog button, dialog [role=button], dialog [role=radio]");
  if (!b || b.disabled) return;
  if (performance.now() - lastToneAt > 60) tone("tap");
});
/** v0.13b: one match = one key (online guests replace the `game` object with every state). */
const gameKey = () => (game ? (room ? "net:" + room.code + ":" + game.seed : game) : null);
/**
 * v0.13b: smooth creeps on the online guest. States arrive 3–8 times per second; between them the
 * guest moves every creep on with the speed it had between the last two states (at most 0.5 s).
 */
const guestMotion = { at: 0, base: new Map(), vel: new Map() };
function guestReceived(next) {
  const now = performance.now(),
    gap = (now - guestMotion.at) / 1000,
    base = new Map(),
    vel = new Map();
  for (const p of next.players)
    for (const c of p.creeps) {
      const key = p.id + ":" + c.id,
        before = guestMotion.base.get(key);
      base.set(key, { x: c.x, y: c.y });
      if (before && gap > 0.04 && gap < 1.2) {
        const vx = (c.x - before.x) / gap,
          vy = (c.y - before.y) / gap;
        // no smoothing across jumps (knock-backs, teleports, a lane change)
        if (Math.hypot(vx, vy) < 1.5) vel.set(key, { vx, vy });
      }
    }
  guestMotion.at = now;
  guestMotion.base = base;
  guestMotion.vel = vel;
}
function guestExtrapolate() {
  if (!game || !isFollower() || !guestMotion.at) return;
  const tau = Math.min(0.5, (performance.now() - guestMotion.at) / 1000);
  for (const p of game.players)
    for (const c of p.creeps) {
      const key = p.id + ":" + c.id,
        b = guestMotion.base.get(key),
        v = guestMotion.vel.get(key);
      if (!b || !v || c.dead) continue;
      c.x = Math.max(0, Math.min(1, b.x + v.vx * tau));
      c.y = Math.max(-0.2, Math.min(1.2, b.y + v.vy * tau));
    }
}
let lastSentEvent = 0;
const r4 = (v) => (typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v);
function networkState() {
  // v0.13b: smaller states: rounded positions, no AI-internal data, only events not sent yet
  if ((game.eventId || 0) < lastSentEvent) lastSentEvent = 0; // a new match restarts the event numbers
  const fresh = game.events.filter((e) => (e.seq || e.id || 0) > lastSentEvent).slice(-60);
  if (fresh.length) lastSentEvent = fresh[fresh.length - 1].seq || fresh[fresh.length - 1].id || lastSentEvent;
  const { adaptation, ...rest } = game;
  return {
    ...rest,
    commands: [],
    pendingSpawns: [],
    events: fresh,
    effects: [],
    players: game.players.map(({ aiPersona, aiMaze, ...p }) => ({
      ...p,
      creeps: p.creeps.map((c) => ({
        id: c.id,
        typeId: c.typeId,
        x: r4(c.x),
        y: r4(c.y),
        hp: Math.round(c.hp * 10) / 10,
        maxHp: c.maxHp,
        owner: c.owner,
        defender: c.defender,
        flying: c.flying,
        progress: r4(c.progress),
        dead: c.dead,
        ...(c.guard ? { guard: { hp: Math.round(c.guard.hp), max: c.guard.max } } : {}), // v0.14: River Guardian shield
      })),
    })),
  };
}
function sendState() {
  if (transportBlocked) return false;
  // v0.20b: a host whose room holds only bots (or whose guests all left) has nobody to send to
  if (room?.role === "host" && !room.peers().length) {
    networkSendFailures = 0;
    return true;
  }
  const sent = room?.send({ kind: "state", epoch: netEpoch, game: networkState() });
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
  // v0.18g: a dialog opened from the main menu keeps the menu (its current page) underneath,
  // blurred, instead of showing an old board behind the dialog
  if (welcome || begun) clearMenuUnder();
  else if ($("modal").open && $("modal").classList.contains("welcome-modal")) keepMenuUnder();
  closeSheet();
  hideDialogTip();
  if (pauseGame && begun) setUiPause("modal", true);
  $("modal").classList.toggle("welcome-modal", welcome);
  $("modal").classList.remove("with-flag");
  $("modal-body").innerHTML = body;
  if (!$("modal").open) $("modal").showModal();
  document.getElementById("boot-screen")?.remove(); // v0.18b: the boot cover hides the board until the first dialog (main menu) is up
  $("modal-body")
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.onclick = closeModal));
}
function closeModal() {
  if (!begun && catalog) {
    const page = $("welcome-panel")?.dataset.view; // v0.18g: back to the menu page the dialog came from
    disconnectRoom();
    welcome();
    if (page && $("welcome-panel")) {
      $("welcome-panel").dataset.view = page;
      wolfEyes();
    }
    return;
  }
  clearMenuUnder();
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
/** v0.18g: the main menu moved under a dialog opened from it (see showModal). */
function keepMenuUnder() {
  let under = $("menu-under");
  if (!under) {
    under = document.createElement("div");
    under.id = "menu-under";
    under.className = "menu-under";
    under.setAttribute("aria-hidden", "true");
    under.inert = true;
    under.innerHTML = `<div class="menu-under-dialog welcome-modal"><div class="menu-under-body"></div></div>`;
    document.body.appendChild(under);
  }
  const box = under.querySelector(".menu-under-body"),
    scroll = $("modal-body").scrollTop;
  box.replaceChildren(...$("modal-body").childNodes);
  box.scrollTop = scroll;
  under.hidden = false;
  document.body.classList.add("menu-under-on");
}
function clearMenuUnder() {
  const under = $("menu-under");
  if (!under) return;
  under.remove();
  document.body.classList.remove("menu-under-on");
}
const pvpModal = (body) => (showModal(body), $("modal-body"));
const modalHeader = (title, extra = "") =>
  `<div class="modal-header"><h2>${esc(title)}</h2>${extra}<button class="close-modal" data-close aria-label="${t("Close")}">×</button></div>`;

/** v0.19c1: the icon frame wears your colour (grey while the colour is random). */
const iconColor = () => TEAM_COLORS[colorPick]?.css || "#8a96a3";
/** v0.19c1: a 5 × 3 grid of player icons. */
function iconModal() {
  const grid = () =>
    PLAYER_ICONS.filter((id) => id !== "hardo" || hardoIconEarned()).map((id) => {
      const locked = iconLocked(id),
        name = id === "player" ? t("Archer") : id === "hardo" ? "Hardo" : ICON_ART[id] ? t("Footman") : itemName(catalog.byId[id]);
      // v0.19g1: locked golems keep their hover / tap tooltip (a disabled button gets no pointer events)
      return `<button type="button" class="icon-cell${id === iconChoice ? " active" : ""}${locked ? " locked" : ""}" data-icon="${id}" style="--pc:${iconColor()}" aria-label="${esc(name)}"${locked ? ` aria-disabled="true" data-tip="${esc(name)}" data-tip-text="${esc(t("Finish campaign mission {n} to unlock", { n: ICON_UNLOCK[id] }))}" data-tip-level=""` : ""}><img src="${iconSrc(id)}" alt=""></button>`;
    }).join("");
  pvpModal(`${modalHeader(t("Player icon"))}<div class="icon-grid" id="icon-grid">${grid()}</div>`);
  const wire = () =>
    document.querySelectorAll("#icon-grid [data-icon]").forEach(
      (b) =>
        (b.onclick = () => {
          if (b.classList.contains("locked")) return; // v0.19g1: the tap shows the unlock tooltip instead
          iconChoice = b.dataset.icon;
          savePref(ICON_PREF, iconChoice);
          tone("select");
          closeModal();
        }),
    );
  wire();
  // the heads are cropped in the background: swap them in when ready
  let n = 0;
  const swap = setInterval(() => {
    if (!$("icon-grid") || ++n > 12) return clearInterval(swap);
    $("icon-grid").querySelectorAll("[data-icon]").forEach((b) => {
      const img = b.querySelector("img"),
        src = iconSrc(b.dataset.icon);
      if (img.getAttribute("src") !== src) img.setAttribute("src", src);
    });
  }, 250);
}
function welcome() {
  presenceState("idle"); // v0.14
  if (colorPick !== "random" && colorChoice !== colorPick) {
    colorChoice = colorPick; // v0.18a: back from an online match with an assigned colour
    applyColors();
  }
  const saved = unusableSave ? null : localStorage.getItem(SAVE);
  showModal(
    `<div class="welcome-eyes" aria-hidden="true"></div><div class="welcome-mood mood-easy" aria-hidden="true"></div><div class="welcome-mood mood-hard" aria-hidden="true"></div><div class="welcome-mood mood-hard-glow" aria-hidden="true"></div><div class="welcome-art" aria-hidden="true"></div><button class="welcome-options" id="welcome-options" type="button" aria-label="${t("Options")}"><img src="${iconUrl("gear")}" alt=""></button><button class="welcome-options welcome-mute" id="welcome-mute" type="button" aria-pressed="${muted}" aria-label="${t(muted ? "Sound off" : "Sound on")}">${speakerSvg(muted)}</button><span class="app-version">v${APP_VERSION} · ${APP_DATE}${APP_NOTE ? `<small class="app-version-note">${esc(APP_NOTE)}</small>` : ""}</span><img class="welcome-logo" src="assets/art/ui-logo.webp" alt="Felito Tower Wars"><div class="welcome-panel" id="welcome-panel" data-view="home"><div class="welcome-home"><span class="modal-label">${t("Your color")}: <b id="color-name">${colorLabel()}</b></span><div class="color-picker" role="radiogroup" aria-label="${t("Your color")}">${Object.entries(TEAM_COLORS).map(([id, c]) => `<button role="radio" data-color="${id}" aria-checked="${id === colorPick}" aria-label="${t(c.name)}" title="${t(c.name)}" class="${id === colorPick ? "active" : ""}" style="--c:${c.css}"></button>`).join("")}</div><div class="welcome-modes"><button class="primary-button big welcome-mode" data-open="ai">${t("Training")}</button><button class="primary-button big welcome-mode alt" data-open="player"><span class="keep-case">${t("PvP")}</span></button></div></div><section class="welcome-group" data-sub="ai" aria-label="${t("Training")}"><h3 class="welcome-group-title"><button class="welcome-back" type="button" data-back aria-label="${t("Back")}">${t("Back")}</button>${t("Training")}</h3><div class="segmented ai-levels${hardoUnlocked ? " hardo-mode" : ""}" role="radiogroup" aria-label="${t("Difficulty")}">${Object.entries(AI_NAMES).map(([id, name]) => `<button role="radio" data-ai="${id}" aria-checked="${id === aiChoice}" class="${id === aiChoice ? "active" : ""}${id === "insane" ? " hardo-level" : hardoUnlocked ? " hardo-gone" : ""}"${id === "insane" && !hardoUnlocked ? " hidden" : ""}${id !== "insane" && hardoUnlocked ? " disabled" : ""}>${t(name)}</button>`).join("")}<button type="button" class="ai-mixed${aiMixed ? " active" : ""}${hardoUnlocked ? " hardo-gone" : ""}" id="ai-mixed" aria-pressed="${aiMixed}"${hardoUnlocked ? " disabled" : ""} title="${t("Shuffles AI enemies of different difficulties into the match, up to the chosen one")}">${t("Mixed")}</button></div>${hardoUnlocked ? hardoNoteHtml() : ""}<div class="welcome-inline"><span class="modal-label">${t("Neutral waves")}</span><div class="segmented" role="radiogroup" aria-label="${t("Neutral waves")}">${[["on", "On"], ["off", "Off"]].map(([id, name]) => `<button role="radio" data-waves="${id}" aria-checked="${(id === "on") === wavesOn}" class="${(id === "on") === wavesOn ? "active" : ""}">${t(name)}</button>`).join("")}</div></div><span class="modal-label">${t("Number of AI enemies")}</span><div class="segmented ai-count" role="radiogroup" aria-label="${t("Number of AI enemies")}">${hardoUnlocked ? hardoJustHtml() : AI_COUNTS.map((n) => `<button role="radio" data-aicount="${n}" aria-checked="${n === aiCount}" class="${n === aiCount ? "active" : ""}">${n}</button>`).join("")}</div><button class="primary-button big" id="start-training">${t("Start")}</button><button class="secondary-button big campaign-open" id="start-campaign">${t("Campaign")} · ${campaignDone().size}/${MISSIONS.length}</button></section><section class="welcome-group" data-sub="player" aria-label="${t("PvP")}"><h3 class="welcome-group-title"><button class="welcome-back" type="button" data-back aria-label="${t("Back")}">${t("Back")}</button><span class="keep-case">${t("PvP")}</span></h3><label class="modal-label name-label pvp-name" for="player-name">${t("Player name")}</label><div class="name-row"><input id="player-name" class="name-input" maxlength="16" autocomplete="nickname" spellcheck="false" placeholder="${t("Your name")}" value="${esc(playerNameChoice)}"><button type="button" class="icon-pick" id="icon-pick" aria-label="${t("Choose your player icon")}" style="--pc:${iconColor()}"><img src="${iconSrc(iconChoice)}" alt=""></button></div><div class="welcome-row pvp-row"><button class="primary-button" id="start-quick">${t("Quick Match")}</button><button class="secondary-button" id="start-online">${t("Play a friend")}</button><button class="secondary-button" id="start-ranked" disabled aria-disabled="true" title="${t("Ranked matches are coming soon.")}">${t("Ranked match")}</button></div></section></div>`,
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
          if (b.dataset.ai === "insane" && hardoUnlocked && aiChoice === "insane") return hardoLeave(); // v0.22d: tap Hardo again: the levels come back
          pickAiLevel(b.dataset.ai);
          tone("tap");
          hardoCode(b.dataset.ai);
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
          // v0.18a: clicking the picked colour again deselects it ("Random")
          colorPick = b.dataset.color === colorPick ? "random" : b.dataset.color;
          if (colorPick !== "random") colorChoice = colorPick;
          savePref(COLOR_PREF, colorPick);
          applyColors();
          warmDialogArt();
          $("color-name").textContent = colorLabel();
          if ($("icon-pick")) $("icon-pick").style.setProperty("--pc", iconColor()); // v0.19c1
          $("modal-body")
            .querySelectorAll("[data-color]")
            .forEach((x) => {
              const on = x.dataset.color === colorPick;
              x.classList.toggle("active", on);
              x.setAttribute("aria-checked", String(on));
            });
          tone("tap");
        }),
    );
  wireAiCount();
  $("ai-mixed").onclick = () => {
    aiMixed = !aiMixed;
    savePref(AI_MIXED_PREF, aiMixed);
    $("ai-mixed").classList.toggle("active", aiMixed);
    $("ai-mixed").setAttribute("aria-pressed", String(aiMixed));
    wolfEyes();
    tone("tap");
    hardoCode(aiMixed ? "mixOn" : "mixOff");
  };
  $("icon-pick").onclick = () => iconModal(); // v0.19c1
  for (const id of PLAYER_ICONS) iconSrc(id); // crops the heads in the background
  $("player-name").oninput = () => {
    playerNameChoice = cleanName($("player-name").value);
    savePref(NAME_PREF, playerNameChoice);
  };
  $("player-name").onchange = () => ($("player-name").value = playerNameChoice);
  $("player-name").onkeydown = (e) => {
    if (e.key === "Enter") $("player-name").blur();
  };
  $("start-training").onclick = () => (aiCount === 1 ? startLocal() : startLocal({ ffa: true, seats: aiCount + 1 }));
  $("start-campaign").onclick = () => campaignMenu(); // v0.17
  $("welcome-options").onclick = optionsModal;
  $("welcome-mute").onclick = () => toggleMute($("welcome-mute"));
  wolfEyes();
  $("start-online").onclick = () => onlineMenu();
  $("start-quick").onclick = () => quickMatch();
  // Start menu pages (v0.10a): home with colour and the two mode buttons; Vs AI and Vs Player open
  // as their own pages with a back button.
  const welcomeView = (view) => {
    $("welcome-panel").dataset.view = view;
    wolfEyes();
    tone("tap");
  };
  $("modal-body").querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => welcomeView(b.dataset.open)));
  $("modal-body").querySelectorAll("[data-back]").forEach((b) => (b.onclick = () => (hardoUnlocked ? hardoReset() : welcomeView("home")))); // v0.22e: Back ends Hardo mode
  // Ranked matches (v0.09z): button is in place, matchmaking follows later.
  $("start-ranked").onclick = () => {
    tone("tap");
    toast(t("Ranked matches are coming soon."));
  };
  if (saved && $("resume-game"))
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
        if (sessionMode !== "hotseat") presenceState("pve");
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
  clearTimeout(lobbyTimer); // v0.18b: no lobby start after leaving
  lobbyTimer = 0;
  lobby = null;
  qmSlot?.close(); // v0.19: the Quick Match slot stops handing out this room
  qmSlot = null;
  netPeers.clear();
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
/**
 * v0.14: match summary for the victory, defeat and knock-out dialogs: creeps killed, creeps sent,
 * breaches, favourite creep (most gold spent on one send) and income; a tap on the income opens
 * a bar chart of the income per round with its absolute and percentage growth.
 */
/** v0.17g: lives the favourite creep stole (its own creeps; a send that spawns another unit counts that unit). */
const favStolen = (st, fav) => [...new Set([fav.id, ...(fav.spawnIds || [])])].reduce((sum, id) => sum + (st.stoleBy?.[id] || 0), 0);
/**
 * v0.18b: the place as the first tile of the summary: "Place", the number and a small "of N"; gold,
 * silver and bronze for the first three, a dirty, smelly number for the last place with 4+ players.
 */
function placeTile(place, of) {
  if (!place || !of) return "";
  place = Math.max(1, Math.min(of, place));
  const skin = place === 1 ? "gold" : place === 2 ? "silver" : place === 3 && of > 3 ? "bronze" : place === of && of >= 4 ? "stinky" : "plain";
  return `<span class="sum-place place-${skin}">${t("Place")}<b><em>${place}</em><small>${t("of {m}", { m: of })}</small></b>${skin === "stinky" ? `<i class="stink" aria-hidden="true"><s></s><s></s><s></s></i>` : ""}</span>`;
}
function matchSummary(me, place = 0) {
  const st = me.stats || {},
    spent = Object.entries(st.spent || {}).sort((a, b) => b[1] - a[1])[0],
    fav = spent && catalog.byId[spent[0]],
    log = [RULES_START_INCOME, ...(st.incomeLog || [])],
    first = log[0],
    last = Math.max(me.income, log[log.length - 1]),
    growth = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
  const favHtml = fav
    ? `<span class="sum-fav"><img src="${towerArtUrl(artFor(fav))}" alt=""><b>${esc(itemName(fav))}</b><span class="fav-nums"><small>${resourceNumber(spent[1])} ${t("gold")}</small><small class="fav-lives" title="${t("Lives stolen")}"><img src="${iconUrl("heart")}" alt="">${format(favStolen(st, fav))} ${t("lives stolen")}</small></span>${t("Favourite creep")}</span>`
    : `<span class="sum-fav"><b>–</b>${t("Favourite creep")}</span>`;
  const html = `<div class="result-stats sum-stats">${placeTile(place, game.players.length)}<span><b>${format(st.kills || 0)}</b>${t("Creeps killed")}</span><span><b>${format(st.creeps ?? st.sent ?? 0)}</b>${t("Creeps sent")}</span><span><b>${format(st.leaks || 0)}</b>${t("Breaches")}</span>${game.waves ? `<span><b>${game.wave}</b>${t("waves")}</span>` : ""}${favHtml}<button type="button" class="sum-income" id="sum-income" aria-expanded="false"><b>+${resourceNumber(last)}</b>${t("Income")}<i>${t("Tap for chart")}</i></button></div><div class="income-chart" id="income-chart" hidden></div>${nemesisHtml(me)}`;
  return {
    html,
    wire: () => {
      const b = $("sum-income");
      if (!b) return;
      b.onclick = () => {
        const box = $("income-chart"),
          open = box.hidden;
        if (open && !box.innerHTML) box.innerHTML = incomeChart(log);
        box.hidden = !open;
        b.setAttribute("aria-expanded", String(open));
        if (open) wireIncomeChart(box, log);
        tone("tap");
      };
    },
  };
}
/**
 * v0.17: Nemesis (matches with 3+ players): the opponent with the most lives taken from you and
 * by you together; the box wears that player's colour.
 */
function nemesisHtml(me) {
  if (!game || game.players.length < 3) return "";
  const st = me.stats || {};
  let best = null;
  for (const q of game.players) {
    if (q.id === me.id) continue;
    const lost = st.lostTo?.[q.id] || 0,
      stole = st.stoleFrom?.[q.id] || 0;
    if (lost + stole > 0 && (!best || lost + stole > best.sum)) best = { q, lost, stole, sum: lost + stole };
  }
  if (!best) return "";
  const color = TEAM_COLORS[seatColors()[best.q.id]]?.css || "#888";
  return `<div class="nemesis" style="--nc:${color}"><img class="portrait" src="${portraitFor(best.q)}" alt=""><div><p class="nem-head"><span>${t("Nemesis")}</span><b>${esc(best.q.ai && !best.q.missionName ? `${t(AI_NAMES[best.q.aiLevel || game.aiLevel] || "")} ${t("AI")} ${seatName(best.q.id)}`.trim() : seatName(best.q.id))}</b></p><small>${t("{a} lives taken from you · {b} taken by you", { a: `<em class="nem-lost">${best.lost}</em>`, b: `<em class="nem-won">${best.stole}</em>` })}</small></div></div>`;
}
const RULES_START_INCOME = 20;
/** Bar chart of income per round (single series, green bars, hover/tap tooltip). */
function incomeChart(log) {
  const n = log.length,
    W = 320,
    H = 150,
    L = 34,
    R = 6,
    T = 10,
    B = 22,
    max = Math.max(1, ...log),
    nice = Math.pow(10, Math.floor(Math.log10(max))),
    top = Math.ceil(max / nice) * nice,
    bw = (W - L - R) / n,
    y = (v) => T + (H - T - B) * (1 - v / top),
    ticks = [0, top / 2, top];
  const bars = log
    .map((v, i) => {
      const x = L + i * bw,
        w = Math.max(1, bw - (bw > 4 ? 2 : 0.5)),
        h = Math.max(1, H - B - y(v)),
        r = Math.min(4, w / 2);
      return `<path class="ic-bar" data-i="${i}" d="M${x.toFixed(1)} ${H - B}v${-(h - r).toFixed(1)}q0 ${-r} ${r} ${-r}h${(w - 2 * r).toFixed(1)}q${r} 0 ${r} ${r}v${(h - r).toFixed(1)}z"/>`;
    })
    .join("");
  const grid = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="ic-grid"/><text x="${L - 4}" y="${y(v) + 3}" class="ic-axis" text-anchor="end">${goldShort(v)}</text>`).join("");
  const every = Math.max(1, Math.ceil(n / 8)),
    labels = log.map((_, i) => (i % every === 0 || i === n - 1 ? `<text x="${L + i * bw + bw / 2}" y="${H - 6}" class="ic-axis" text-anchor="middle">${i}</text>` : "")).join("");
  return `<div class="ic-head"><b>${t("Income per round")}</b><span id="ic-readout">${t("Tap a bar")}</span></div><svg viewBox="0 0 ${W} ${H}" class="ic-svg" role="img" aria-label="${t("Income per round")}">${grid}${bars}${labels}<rect class="ic-hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></svg>`; // v0.17c: no caption below the chart
}
const goldShort = (v) => (v >= 1000 ? format(Math.round(v / 100) / 10) + "k" : format(Math.round(v)));
function wireIncomeChart(box, log) {
  const svg = box.querySelector(".ic-svg"),
    hit = box.querySelector(".ic-hit"),
    out = box.querySelector("#ic-readout");
  if (!svg || !hit) return;
  const show = (ev) => {
    const r = hit.getBoundingClientRect(),
      i = Math.max(0, Math.min(log.length - 1, Math.floor(((ev.clientX - r.left) / r.width) * log.length))),
      v = log[i],
      prev = i ? log[i - 1] : null,
      d = prev === null ? null : v - prev,
      pc = prev ? (d / prev) * 100 : null;
    svg.querySelectorAll(".ic-bar").forEach((b) => b.classList.toggle("on", Number(b.dataset.i) === i));
    out.innerHTML = `${i ? t("Round {n}", { n: i }) : t("Start")}: <b>+${format(v)}</b>${d === null ? "" : ` · ${d >= 0 ? "+" : "−"}${format(Math.abs(d))} (${pc >= 0 ? "+" : "−"}${format(Math.abs(Math.round(pc * 10) / 10))}%)`}`;
  };
  hit.onpointermove = show;
  hit.onpointerdown = show;
}
function ownKnockedOut(place) {
  if (shownResult) return;
  shownResult = true;
  try {
    localStorage.removeItem(SAVE);
  } catch {}
  tone("defeat");
  const me = game.players[own],
    summary = matchSummary(me, place);
  // v0.18b: place in the summary tiles; Keep watching and Play again side by side in blue, Main menu gold
  showModal(
    `<div class="result-banner lose">${t("Defeat")}</div><img class="modal-hero result-hero" src="${artUrl("creep-golem")}" alt="">${summary.html}<div class="result-pair"><button class="secondary-button" id="ko-watch">${t("Keep watching")}</button>${room ? "" : `<button class="secondary-button" id="ko-again">${t("Play again")}</button>`}</div><button class="primary-button" id="ko-menu">${t("Main menu")}</button>`,
    { pauseGame: false },
  );
  summary.wire();
  $("ko-watch").onclick = () => {
    if ($("modal").open) $("modal").close();
    // v0.18b: the match goes on between the AIs; show the board of a player still in it
    const lead = game.players.filter((q) => !q.out).sort((a, b) => b.lives - a.lives || b.income - a.income)[0];
    if (lead) showMaze(lead.id);
  };
  if ($("ko-again")) $("ko-again").onclick = () => {
    shownResult = false;
    if (sessionMode === "campaign") return startCampaign(campaignIndex); // v0.17
    startLocal({ ffa: true, seats: game.players.length });
  };
  $("ko-menu").onclick = () => {
    begun = false;
    shownResult = false;
    welcome();
  };
}
/**
 * v0.19b1: online play needs WebRTC (PeerJS). The claude.ai preview window blocks it, so Quick
 * Match and rooms failed there with a connection error; instead it now points to the game website.
 */
const GAME_SITE = "https://felitofelicis.github.io/felito-tower-wars/";
let webrtcOk = null;
function webrtcSupported() {
  if (webrtcOk !== null) return webrtcOk;
  try {
    const C = globalThis.RTCPeerConnection;
    if (typeof C !== "function") return (webrtcOk = false);
    const pc = new C();
    try {
      pc.createDataChannel("probe");
    } finally {
      pc.close();
    }
    webrtcOk = true;
  } catch {
    webrtcOk = false;
  }
  return webrtcOk;
}
function noWebrtcModal(title) {
  pvpModal(
    `${modalHeader(t(title))}<p class="modal-copy">${t("Online matches can't run in this window: it blocks the direct connection (WebRTC) that PvP needs. Open the game on its website to play online.")}</p><a class="primary-button" href="${GAME_SITE}" target="_blank" rel="noopener">${t("Open the game website")}</a>`,
  );
}
/** v0.19b1: Play again after a PvP match: a new Quick Match search, or the friend-room dialog again. */
function playAgainOnline() {
  const kind = roomKind;
  disconnectRoom();
  begun = false;
  welcome();
  document.querySelector('[data-open="player"]')?.click();
  if (kind === "friend") onlineMenu();
  else quickMatch();
}
/**
 * v0.14: levels for a mixed match. Each AI seat draws a level up to the chosen one; one seat
 * always gets the chosen level. With Hard chosen there are no very easy AIs and easy appears on
 * a seat with only 10 % chance (normal and hard share the rest).
 */
function mixedLevels(seats, top) {
  const order = ["veryEasy", "easy", "normal", "hard", "insane"],
    allowed = order.slice(0, order.indexOf(top) + 1),
    roll = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
    pick = () => {
      if (top === "hard") {
        const r = roll();
        return r < 0.1 ? "easy" : r < 0.55 ? "normal" : "hard";
      }
      if (top === "insane") {
        const r = roll();
        return r < 0.3 ? "normal" : r < 0.75 ? "hard" : "insane";
      }
      return allowed[Math.floor(roll() * allowed.length)];
    },
    out = [null];
  for (let i = 1; i < seats; i++) out.push(pick());
  if (seats > 1 && !out.includes(top)) out[1 + Math.floor(roll() * (seats - 1))] = top;
  return out;
}
/** Selects a Training difficulty in the open menu (buttons, saved choice, the picture's mood). */
function pickAiLevel(id) {
  aiChoice = id;
  savePref(AI_PREF, aiChoice);
  wolfEyes();
  document.querySelectorAll("#modal-body [data-ai]").forEach((x) => {
    x.classList.toggle("active", x.dataset.ai === id);
    x.setAttribute("aria-checked", String(x.dataset.ai === id));
  });
}
/** Number of AI enemies buttons in the Training menu. */
function wireAiCount() {
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
}
const hardoNoteHtml = () => `<p class="hardo-note">${t("You found Felito's secret sparring partner, Hardo never cheats but plays cunning and adaptive, good luck!")}</p>`;
const hardoJustHtml = () => `<div class="hardo-just"><button type="button" role="radio" aria-checked="true" disabled>1</button><span>${t("it's just you and Hardo")}</span></div>`; // v0.22g: the 1 stays a disabled, greyed-out button
let hardoPrevCount = null;
/** v0.22e: Back from the Training menu: everything returns to normal (levels, count, music). */
function hardoReset() {
  hardoUnlocked = false;
  hardoInput = [];
  if (hardoPrevCount != null) aiCount = hardoPrevCount;
  hardoPrevCount = null;
  aiChoice = "hard";
  savePref(AI_PREF, aiChoice);
  welcome();
  syncMusic();
}
/** v0.22b/d: the secret sequence: a sinister organ, purple eyes, the other levels fall out of the menu and Hardo slams in. */
/**
 * v0.22m2: falling, rising and slamming buttons briefly stick out of the menu; while they move the menu does not
 * scroll, so no scroll bar flashes up (a menu that already scrolls keeps its bar).
 */
function hardoHoldScroll(ms) {
  const mb = $("modal-body");
  if (!mb || mb.scrollHeight > mb.clientHeight + 1) return;
  mb.classList.add("hardo-still");
  clearTimeout(hardoHoldScroll.timer);
  hardoHoldScroll.timer = setTimeout(() => mb.classList.remove("hardo-still"), ms);
}
function hardoCode(step) {
  if (hardoUnlocked) return;
  hardoInput = [...hardoInput, step].slice(-HARDO_CODE.length);
  if (hardoInput.join() !== HARDO_CODE.join()) return;
  hardoUnlocked = true;
  hardoInput = [];
  hardoHoldScroll(2600);
  hardoPrevCount = aiCount;
  aiCount = 1; // v0.22e: Hardo is a 1v1 sparring partner
  document.querySelectorAll("#modal-body [data-aicount]").forEach((b) => {
    b.disabled = true;
    b.classList.remove("active"); // v0.22m2: greyed out like every disabled button, no highlight
  });
  tone("hardo");
  hardoMusicDelay = 5.2; // the organ theme starts after the signal and a moment of silence
  if (aiMixed) {
    aiMixed = false;
    savePref(AI_MIXED_PREF, aiMixed);
  }
  const row = document.querySelector("#modal-body .ai-levels"),
    others = [...(row?.querySelectorAll('[data-ai]:not([data-ai="insane"]), #ai-mixed') || [])],
    hardo = row?.querySelector('[data-ai="insane"]');
  pickAiLevel("insane");
  row?.classList.add("hardo-falling");
  others.forEach((b, i) => {
    b.disabled = true;
    b.classList.remove("active");
    b.style.setProperty("--d", (i * 0.09).toFixed(2) + "s");
    b.style.setProperty("--r", (i % 2 ? -1 : 1) * (18 + i * 7) + "deg");
    b.classList.add("hardo-fall");
  });
  setTimeout(() => {
    if (!row || !hardoUnlocked) return;
    others.forEach((b) => b.classList.replace("hardo-fall", "hardo-gone"));
    row.classList.remove("hardo-falling");
    row.classList.add("hardo-mode");
    if (hardo) {
      hardo.hidden = false;
      hardo.classList.add("hardo-impact");
      hardo.addEventListener("animationend", () => hardo.classList.remove("hardo-impact"), { once: true });
    }
    const panel = $("welcome-panel");
    panel?.classList.add("hardo-shake");
    setTimeout(() => panel?.classList.remove("hardo-shake"), 700);
    // v0.22e: the note appears and the AI count fades into "[1] it's just you and Hardo"
    if (!row.parentElement.querySelector(".hardo-note")) row.insertAdjacentHTML("afterend", hardoNoteHtml());
    const count = document.querySelector("#modal-body .ai-count");
    if (count) {
      count.classList.add("hardo-count-out");
      setTimeout(() => {
        if (!hardoUnlocked) return;
        count.innerHTML = hardoJustHtml();
        count.classList.replace("hardo-count-out", "hardo-count-in");
      }, 450);
    }
  }, 1300);
}
/** v0.22d: leave Hardo (tap it again): it vanishes, the other levels rise back in, Hard is selected. */
function hardoLeave() {
  hardoHoldScroll(1200);
  if (hardoPrevCount != null) aiCount = hardoPrevCount;
  hardoPrevCount = null;
  const count = document.querySelector("#modal-body .ai-count");
  if (count) {
    count.classList.remove("hardo-count-in", "hardo-count-out");
    count.innerHTML = AI_COUNTS.map((n) => `<button role="radio" data-aicount="${n}" aria-checked="${n === aiCount}" class="${n === aiCount ? "active" : ""}">${n}</button>`).join("");
    wireAiCount();
  }
  document.querySelector("#modal-body .hardo-note")?.remove();
  setTimeout(syncMusic, 0);
  hardoUnlocked = false;
  const row = document.querySelector("#modal-body .ai-levels");
  row?.classList.remove("hardo-mode");
  const hardo = row?.querySelector('[data-ai="insane"]');
  if (hardo) hardo.hidden = true;
  row?.querySelectorAll(".hardo-gone, .hardo-fall").forEach((b) => {
    b.disabled = false;
    b.classList.remove("hardo-gone", "hardo-fall");
    b.classList.add("hardo-rise");
    b.addEventListener("animationend", () => b.classList.remove("hardo-rise"), { once: true });
  });
  pickAiLevel("hard");
  tone("tap");
}
/** v0.14: the wolf in the main-menu picture lets its eyes glow while Hard is picked for Vs AI (v0.21z: all evil creeps, skull on the moon; Very Easy: everyone asleep). */
function wolfEyes() {
  const panel = $("welcome-panel");
  const dialog = document.querySelector("dialog.welcome-modal"),
    training = !!panel && panel.dataset.view === "ai";
  dialog?.classList.toggle("hard-eyes", training && aiChoice === "hard");
  dialog?.classList.toggle("insane-eyes", training && aiChoice === "insane"); // v0.22b: Hardo: every creep's eyes glow purple
  dialog?.classList.toggle("easy-eyes", training && aiChoice === "veryEasy"); // v0.21z: Very Easy: eyes closed, smileys on the banners
}
// ---- v0.17: single-player campaign ---------------------------------------------------------
let campaignIndex = 0;
/** Missions won so far (ids), kept in the browser. */
function campaignDone() {
  try {
    const v = JSON.parse(localStorage.getItem(CAMPAIGN_PREF) || "[]");
    return new Set(Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : []);
  } catch {
    return new Set();
  }
}
function campaignWon(id) {
  const done = campaignDone();
  done.add(id);
  try {
    localStorage.setItem(CAMPAIGN_PREF, JSON.stringify([...done].sort((a, b) => a - b)));
  } catch {}
}
/** A mission is open once the one before it is won (the first always is). */
const missionOpen = (i, done = campaignDone()) => i === 0 || done.has(MISSIONS[i - 1].id) || done.has(MISSIONS[i].id);
function campaignMenu() {
  const done = campaignDone();
  showModal(
    `${modalHeader(t("Campaign"))}<p class="modal-copy campaign-progress">${t("{n} of {m} missions won", { n: done.size, m: MISSIONS.length })}</p><div class="campaign-grid">${MISSIONS.map((m, i) => {
      const open = missionOpen(i, done),
        won = done.has(m.id);
      return `<button class="mission-tile${won ? " won" : ""}${open ? "" : " locked"}" data-mission="${i}" ${open ? "" : "disabled"} aria-label="${esc(t("Mission {n}", { n: i + 1 }) + ": " + (open ? t(m.title) : t("locked")))}"><span class="mission-num">${i + 1}</span><img src="${artUrl(m.art)}" alt=""><b>${open ? esc(t(m.title)) : "???"}</b>${won ? '<i class="mission-check">✓</i>' : open ? "" : '<i class="mission-lock">🔒</i>'}</button>`;
    }).join("")}</div><button class="primary-button" data-close>${t("Back")}</button>`,
  );
  $("modal-body")
    .querySelectorAll("[data-mission]")
    .forEach((b) => (b.onclick = () => missionScene(Number(b.dataset.mission))));
}
/** The short scene before a mission: the enemy and Pip talk, then the briefing and Fight! */
function missionScene(i, step = 0) {
  const m = MISSIONS[i];
  if (!m) return campaignMenu();
  const lines = m.scene || [],
    talking = step < lines.length,
    [who, line] = talking ? lines[step] : ["", ""],
    pip = who === "Pip";
  showModal(
    `<div class="mission-scene"><div class="scene-head"><span class="scene-kicker">${t("Mission {n}", { n: i + 1 })}</span><h2>${esc(t(m.title))}</h2></div><div class="scene-stage${pip ? " pip" : ""}"><img class="scene-enemy" src="${artUrl(m.art)}" alt="${esc(t(m.enemy))}"><img class="scene-pip" src="${artUrl("tower-archer")}" alt="Pip"></div>${
      talking
        ? `<div class="scene-bubble${pip ? " pip" : ""}"><b>${esc(t(who))}</b><p>${esc(t(line))}</p></div><div class="scene-actions"><button class="primary-button" id="scene-next">${t(step === lines.length - 1 ? "To the briefing" : "Next")}</button><button class="secondary-button" id="scene-skip">${t("Skip")}</button></div>`
        : `<div class="scene-brief"><p>${valHtml(t(m.briefing))}</p><p class="scene-weak"><b>${t("Pip's tip")}:</b> ${esc(t(m.weakness))}</p></div><div class="scene-actions"><button class="primary-button big" id="scene-fight">${t("Fight!")}</button><button class="primary-button" id="scene-back">${t("Back")}</button></div>`
    }</div>`,
  );
  if (talking) {
    $("scene-next").onclick = () => missionScene(i, step + 1);
    $("scene-skip").onclick = () => missionScene(i, lines.length);
  } else {
    $("scene-fight").onclick = () => startCampaign(i);
    $("scene-back").onclick = () => campaignMenu();
  }
}
function startCampaign(i) {
  const m = MISSIONS[i];
  if (!m) return;
  campaignIndex = i;
  const st = m.setup;
  startLocal({ ffa: (st.seats || 2) > 2, seats: st.seats || 2, mission: st });
  sessionMode = "campaign";
  toast(t(m.briefing), "level", true);
}
/** Result dialog buttons for a mission: next mission after a win, retry after a defeat. */
function campaignResult(won) {
  const m = MISSIONS[campaignIndex],
    next = MISSIONS[campaignIndex + 1];
  if (won && m) campaignWon(m.id);
  const again = $("play-again");
  again.textContent = won ? (next ? t("Next mission") : t("Campaign complete!")) : t("Retry mission");
  again.onclick = () => {
    shownResult = false;
    if (!won) return startCampaign(campaignIndex);
    if (next) missionScene(campaignIndex + 1);
    else campaignMenu();
  };
  $("play-harder")?.remove();
  const menu = document.createElement("button");
  menu.className = "secondary-button";
  menu.textContent = t("Campaign");
  menu.onclick = () => {
    shownResult = false;
    campaignMenu();
  };
  again.after(menu);
}
// ---- v0.22e: Hardo talks (0–2 times a match, only when something significant happens) ------
const hardoTalkState = new WeakMap();
const HARDO_LINES = {
  threat: ["Now THAT is a wave. My towers are sweating.", "You saved all that just to hurt me? Rude."],
  desperate: ["Only true elites come to my lair and defeat me like this. I am proud of you."],
  income: ["Income is key, you seem to have understood this."],
  nomatch: ["You are no match for me, get me Felito back you fool!"],
  tier: ["Felito would be in Tier {n} by now."],
};
function hardoTalk() {
  if (!game?.running || shownResult || isFfa() || !hardoGame()) return;
  const h = game.players.find((q) => q.ai && (q.aiLevel || game.aiLevel) === "insane"),
    me = game.players[own];
  if (!h || !me || h.out) return;
  let st = hardoTalkState.get(game);
  if (!st) hardoTalkState.set(game, (st = { said: 0, used: new Set(), last: -999, rich: 0, round: game.round }));
  if (game.round !== st.round) {
    st.round = game.round;
    st.rich = me.income >= h.income * 1.35 && me.income - h.income >= 40 ? st.rich + 1 : 0;
  }
  if (st.said >= 2 || game.time - st.last < 45 || game.round < 5) return;
  const boss = tierSends(me.tier).find((x) => x.bossTier),
    rush = h.creeps.filter((c) => !c.dead && c.hp > 0 && c.owner !== h.id && c.progress > 0.4),
    rushHp = rush.reduce((sum, c) => sum + c.hp, 0),
    checks = [
      ["desperate", h.lives <= 6 && me.lives > h.lives * 2],
      ["threat", rush.length >= Math.max(4, h.lives * 0.3) && rushHp > (h.aiDebug?.capG || 0) * 1.2],
      ["income", st.rich >= 3],
      ["nomatch", me.lives <= 10 && h.lives >= me.lives * 2],
      ["tier", !!boss && game.round >= 15 && me.income >= boss.cost * 0.75 && me.tier < 5],
    ];
  for (const [key, hit] of checks) {
    if (!hit || st.used.has(key)) continue;
    st.used.add(key);
    st.said++;
    st.last = game.time;
    const pool = HARDO_LINES[key];
    hardoSay(pool[Math.floor(Math.random() * pool.length)].replace("{n}", me.tier + 1));
    return;
  }
}
/** A small speech bubble from Hardo's portrait (the enemy plate at the top). */
function hardoSay(text) {
  const plate = document.querySelector(".player-plate.rival");
  if (!plate) return;
  plate.querySelector(".hardo-bubble")?.remove();
  const b = document.createElement("div");
  b.className = "hardo-bubble";
  b.setAttribute("role", "status");
  b.textContent = text;
  plate.appendChild(b);
  tone("select");
  setTimeout(() => b.classList.add("out"), 6500);
  setTimeout(() => b.remove(), 7200);
}
// ---- v0.22b: match recorder for Insane training matches ------------------------------------
// Every command of the human player (with its tick) plus a snapshot of all players each round go
// into the artifact's database (matches/<id>, chunks per round). The simulation is deterministic,
// so seed + commands replay the whole match headless for tuning the AI between games.
let rec = null,
  recDbPromise = null,
  hardoTalkTime = 0;
function recDb() {
  if (!recDbPromise)
    recDbPromise = (async () => {
      try {
        return (await window.claude?.use?.("db")) || null;
      } catch {
        return null;
      }
    })();
  return recDbPromise;
}
function recWrite(path, data) {
  if (!rec) return;
  const r = rec;
  r.queue = r.queue.then(async () => {
    const db = await recDb();
    if (!db) return;
    try {
      await db.doc(path).set(JSON.parse(JSON.stringify(data)));
    } catch (e) {
      r.errors = (r.errors || 0) + 1;
    }
  });
}
function recSnap() {
  return {
    round: game.round,
    tick: game.tick,
    rng: game.rng, // v0.22f: finds the first tick where a replay drifts
    time: Math.round(game.time * 10) / 10,
    players: game.players.map((q) => ({
      lives: q.lives,
      gold: Math.round(q.gold),
      income: Math.round(q.income * 10) / 10,
      level: q.level,
      tier: q.tier,
      faction: q.faction || null,
      perks: q.perks || {},
      towers: q.towers.length,
      towerGold: Math.round(q.towers.reduce((sum, t) => sum + (t.totalSpent || catalog.byId[t.typeId]?.cost || 0), 0)),
      creeps: q.creeps.length,
      sent: q.stats?.sent || 0,
      leaks: q.stats?.leaks || 0,
      kills: q.stats?.kills || 0,
      style: q.aiStyle || null,
      read: q.aiRead ? Object.fromEntries(Object.entries(q.aiRead).map(([k, v]) => [k, Math.round(v * 100) / 100])) : null,
      dbg: q.aiDebug || null,
      push: q.aiPush ? { id: q.aiPush.id, left: q.aiPush.left } : null,
      capScale: q.aiCapScale || null,
    })),
  };
}
function recStart() {
  rec = null;
  if (!game || !game.players.some((q) => q.ai && (q.aiLevel || game.aiLevel) === "insane")) return;
  const id = "m" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  rec = { id, game, cmds: [], snaps: [], chunk: 0, round: game.round, queue: Promise.resolve(), done: false, started: Date.now() };
  rec.meta = {
    id,
    version: APP_VERSION,
    startedAt: new Date().toISOString(),
    seed: game.seed,
    options: { mode: game.mode, faction: chosenFaction, aiLevel: game.aiLevel, aiLevels: game.players.map((q) => (q.ai ? q.aiLevel || game.aiLevel : null)), waves: game.waves, seats: game.players.length, training: !!game.training },
    status: "running",
    chunks: 0,
  };
  recWrite("matches/" + id, rec.meta);
}
function recFlush(final = false) {
  if (!rec || (!rec.cmds.length && !rec.snaps.length && !final)) return;
  recWrite("matches/" + rec.id + "/chunks/c" + String(rec.chunk).padStart(4, "0"), { n: rec.chunk, cmds: rec.cmds, snaps: rec.snaps });
  rec.chunk++;
  rec.cmds = [];
  rec.snaps = [];
  rec.meta.chunks = rec.chunk;
  rec.meta.lastRound = game.round;
  if (final) {
    rec.meta.status = "ended";
    rec.meta.result = { winner: game.winner, time: Math.round(game.time), round: game.round, lives: game.players.map((q) => q.lives), endTick: game.tick };
  }
  recWrite("matches/" + rec.id, rec.meta);
}
function recTick() {
  if (!rec || rec.done) return;
  if (rec.game !== game) {
    rec.meta.status = "abandoned";
    recFlush(true);
    rec.done = true;
    rec = null;
    return;
  }
  if (game.round !== rec.round) {
    rec.round = game.round;
    rec.snaps.push(recSnap());
    if (game.round % 2 === 0) recFlush();
  }
  if (!game.running) {
    rec.snaps.push(recSnap());
    rec.done = true;
    recFlush(true);
  }
}
setCommandHook((g, input, result) => {
  if (!rec || rec.done || g !== rec.game || input.type === "pause" || input.auto) return; // auto-sends come from the simulation itself
  // v0.22f: AI commands are logged too (marked "ai"; a replay skips them, they help the analysis)
  rec.cmds.push(g.players[input.player ?? 0]?.ai ? [g.tick, JSON.parse(JSON.stringify(input)), result?.ok ? 1 : 0, "ai"] : [g.tick, JSON.parse(JSON.stringify(input)), result?.ok ? 1 : 0]);
});
function startLocal({ hotseat = false, ffa = false, seats = 4, mission = null } = {}) {
  disconnectRoom();
  uiPauses.clear();
  sessionMode = hotseat ? "hotseat" : ffa ? "ffa" : "training";
  own = 0;
  view = 0;
  begun = true;
  setHelpMode(false); // v0.19a1
  shownResult = false;
  lastEvent = 0;
  game = createGame({
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
    mode: chosenMode,
    faction: chosenFaction,
    ai: !hotseat,
    aiLevel: mission?.level || aiChoice,
    aiLevels: !hotseat && aiMixed && !mission && aiChoice !== "insane" ? mixedLevels(ffa ? Math.min(8, Math.max(3, seats)) : 2, aiChoice) : null,
    waves: mission ? !!mission.waves : wavesOn,
    seats: ffa ? Math.min(8, Math.max(3, seats)) : 2,
    mission, // v0.17: campaign
  });
  if (!hotseat) game.players[0].icon = iconChoice; // v0.19c1
  game.training = !hotseat && !mission; // v0.19d2: smaller sell penalty against very easy / easy bots
  presenceState("pve");
  rollColor(); // v0.18a: picked colour or a random one
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
  recStart(); // v0.22b
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
  if (isFollower()) {
    if (!room.send({ kind: "command", command: { ...input, player: own } })) toast("The connection isn't ready yet.");
    else if (input.type === "send") sendFx(input.id, catalog.byId[input.id]?.spawnIds?.length || 1);
    return;
  }
  const result = command(game, { ...input, player: own });
  if (!result.ok) {
    if (!quiet) {
      toast(result.reason || "Not possible right now.", "", true);
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
    const order = ["h003", "h000", "h02R", "h03V", "h02Q", "h05L", "h01F", WALL_ID];
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
  return deckItems().map((i) => i.id).join(",") + "|" + JSON.stringify(game.players[own].research) + (burningTreant(game.players[own]) ? "|burn" : "");
}
/** Upgrades of the selected tower, shown in the bottom build dialog instead of a popup. */
/** Not enough gold/wood right now (the option itself is unlocked). */
const isPoor = (a) => !a.ok && /more gold/.test(a.reason || "");
/** Locked by a missing technology or rule: such buttons are not shown at all. */
const isLocked = (a) => !a.ok && !isPoor(a) && !/Still under construction|Restocking|Warm up|Duel over|duel is over/.test(a.reason || "");
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
  if (upHistoryGame !== gameKey()) {
    upHistory = [];
    upHistoryGame = gameKey();
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
function doubleUpgrade(tw, advanced = false) {
  // v0.13: the standard double tap queues only the next step, after the steps already queued
  const queuedSteps = upQueue.filter((q) => q.towerId === tw.id),
    from0 = !advanced && queuedSteps.length ? queuedSteps[queuedSteps.length - 1].id : tw.typeId;
  const options = (catalog.byId[from0]?.upgrades || []).filter(
    (id) => catalog.byId[id] && (from0 !== tw.typeId || !isLocked(available(game, own, "upgrade", id, tw.id))),
  );
  selectedTower = tw.id;
  if (!options.length) {
    note("Highest level reached");
    showTower(tw);
    return;
  }
  if (upHistoryGame !== gameKey()) upHistory = [];
  let chain = null;
  for (const target of upHistory) {
    const steps = upgradePath(from0, target);
    if (steps && options.includes(steps[0])) {
      chain = steps;
      break;
    }
  }
  if (!chain && options.length === 1) chain = options;
  if (chain && !advanced) chain = chain.slice(0, 1);
  if (!chain) {
    showTower(tw);
    note("Several upgrades: pick one in the menu once, then a double tap repeats your choice.");
    return;
  }
  let from = from0;
  upQueue = (advanced ? upQueue.filter((q) => q.towerId !== tw.id) : upQueue).concat(
    chain.map((id) => {
      const step = { towerId: tw.id, id, from };
      from = id;
      return step;
    }),
  );
  if (advanced || !upHistory.some((target) => upgradePath(chain[0], target) || target === chain[0])) rememberUpgrade(chain[chain.length - 1]);
  const goal = catalog.byId[chain[chain.length - 1]];
  runQueue();
  showTower(tw);
  renderCards();
  if (chain.length > 1) note(t("{n} upgrades queued up to {name}", { n: chain.length, name: `${itemName(goal)} Level ${goal.level || 1}` }));
  else if (upQueue.some((q) => q.towerId === tw.id)) note("Upgrade queued: starts as soon as you have enough gold.");
  tone("upgrade");
}
/**
 * v0.16k: element frame of a tower card: one element in its colour, a combination tower half and
 * half in the colours of the two elements it needs ("Magic City [Storm & Arcane]").
 */
function elementFrame(item) {
  const pair = String(item?.name || "").match(/\[\s*(Water|Fire|Earth|Storm|Arcane|Plague)\s*&\s*(Water|Fire|Earth|Storm|Arcane|Plague)\s*\]/i),
    ids = pair ? [pair[1], pair[2]].map((x) => x.toLowerCase()) : item?.element && item.element !== "neutral" ? [item.element] : [],
    cols = ids.map((id) => catalog.factions.find((f) => f.id === id)?.color).filter(Boolean);
  if (!cols.length) return "";
  return `<i class="el-frame${cols.length > 1 ? " combo" : ""}" style="--el1:${cols[0]};--el2:${cols[1] || cols[0]}" aria-hidden="true"></i>`;
}
/** v0.19h1: a sell value below the normal one (summoned, free, discounted) in red, the normal value in brackets. */
function sellText(value, base) {
  return base != null && value < base ? `<span class="sell-cut">+${format(value)}</span> <span class="sell-base">(${format(base)})</span>` : `+${format(value)}`;
}
function upgradeDeck(tw) {
  const item = catalog.byId[tw.typeId],
    ups = item.upgrades
      .map((id) => catalog.byId[id])
      .filter((u) => u && !isLocked(available(game, own, "upgrade", u.id, tw.id))),
    sell = getSellValue(game, own, tw.id),
    refund = typeof sell === "number" ? sell : sell?.gold || 0;
  $("deck-title").textContent = tw.quarry ? t(tw.stone === "large" ? "Large Stone" : "Stone") : `${t("Upgrade")} · ${itemName(item)}`; // v0.18h
  $("cards").classList.toggle("many", ups.length > 3);
  $("cards").innerHTML =
    ups
      .map((u) => {
        const a = available(game, own, "upgrade", u.id, tw.id),
          locked = false,
          waiting = upQueue.some((q) => q.towerId === tw.id && q.id === u.id),
          name = `${itemName(u)} Level ${u.level || 1}`;
        const afterBuild = /Still under construction/.test(a.reason || "");
        return `<button class="unit-card up-card ${a.ok || afterBuild ? "" : "unaffordable"} ${isPoor(a) ? "poor" : ""} ${waiting ? "queued" : ""}" data-upgrade="${u.id}" aria-label="${esc(t("Upgrade to {name}, {cost} gold", { name, cost: format(u.cost) }))}${a.ok ? "" : ", " + esc(t(a.reason))}" title="${esc(a.ok ? name : t(a.reason))}"><span class="up-title">${esc(name)}</span><span class="up-art"><img src="${towerArtUrl(artFor(u))}" alt=""></span><span class="up-cost"><span class="price">${format(u.cost)}</span>${u.woodCost ? `<span class="price wood-price">${format(u.woodCost)}</span>` : ""}</span><i class="up-arrow" aria-hidden="true"></i>${waiting ? '<span class="up-queued">⏳</span>' : ""}${locked ? `<span class="up-lock">${esc(t(a.reason))}</span>` : ""}${elementFrame(u)}</button>`;
      })
      .join("") +
    (ups.length ? "" : `<div class="up-empty">${tw.quarry ? t(tw.stone === "large" ? "A large stone from your Quarry. Demolish it for {exp} EXP. Remove every stone to get a random Earth perk" : "A stone from your Quarry. Demolish it for {exp} EXP. Remove every stone to get a random Earth perk", { exp: tw.stone === "large" ? 15 : 5 }) : t(tw.typeId === "hROK" ? "A rock: clear it for gold, or steal lives to crack it" : "Highest level reached")}</div>`) + // v0.22m2: stones give 5 / 15 EXP (v0.22o2: the "+" was inside the comment)
    (tw.quarry
      ? `<button class="unit-card up-card sell-card rock-card" id="up-sell" aria-label="${esc(t("Demolish the stone for {gold} gold", { gold: format(-refund) }))}"><span class="up-title">${t("Demolish")}</span><span class="up-art"><img src="${artUrl("deco-rock")}" alt=""></span><span class="up-cost"><span class="price">−${format(-refund)}</span></span></button>`
      : tw.typeId === "hROK"
      ? `<button class="unit-card up-card sell-card rock-card" id="up-sell" aria-label="${esc(t("Clear the rock for {gold} gold", { gold: format(-refund) }))}"><span class="up-title">${t("Clear")}</span><span class="up-art"><img src="${artUrl("deco-rock")}" alt=""></span><span class="up-cost"><span class="price">−${format(-refund)}</span></span></button>` // v0.17
      : `<button class="unit-card up-card sell-card" id="up-sell" aria-label="${esc(t("Sell {name} for {gold} gold", { name: itemName(item), gold: format(refund) }))}"><span class="up-title">${t("Sell")}</span><span class="up-art"><img src="${iconUrl("coin")}" alt=""></span><span class="up-cost"><span class="price">${sellText(refund, getSellBase(game, own, tw.id))}</span></span></button>`);
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
  // v0.17h: an own tower tapped outside Build switches to Build and selects it
  if (tab !== "build" && view === own) {
    setPage("build");
    lastTowerTap = { id: tower.id, at: 0 };
    deckClosed = { at: 0, towerId: null };
    showTower(tower);
    return;
  }
  const now = at || performance.now(),
    double = lastTowerTap.id === tower.id && now - lastTowerTap.at < (window.felitoTestDoubleTapMs || 380);
  lastTowerTap = { id: tower.id, at: double ? 0 : now };
  // v0.12: a double tap on a wall sells it
  if (view === own && double && tower.typeId === WALL_ID) {
    deckClosed = { at: 0, towerId: null };
    selectedTower = null;
    $("tower-panel").hidden = true;
    dispatch({ type: "sell", towerId: tower.id });
    renderCards();
    return;
  }
  if (view === own && double && (dblMode === "upgrade" || dblMode === "advanced")) {
    deckClosed = { at: 0, towerId: null };
    doubleUpgrade(tower, dblMode === "advanced");
    return;
  }
  if (view !== own) {
    // v0.17c: enemy towers can be selected; they show their tooltip
    selectedTower = tower.id;
    $("tower-panel").hidden = true;
    showTowerTip(tower, view);
    tone("select");
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
/** v0.13: a double right click on one of your towers sells it. */
let lastRightClick = { id: null, at: 0 };
function onTowerRightClick(tower, at = performance.now()) {
  if (!begun || view !== own || volleyAim) return;
  const double = lastRightClick.id === tower.id && at - lastRightClick.at < 420;
  lastRightClick = { id: tower.id, at: double ? 0 : at };
  if (!double) return;
  upQueue = upQueue.filter((q) => q.towerId !== tower.id);
  if (selectedTower === tower.id) selectedTower = null;
  deckClosed = { at: 0, towerId: null };
  $("tower-panel").hidden = true;
  dispatch({ type: "sell", towerId: tower.id });
  renderCards();
}
/** v0.17: creep gold costs one step larger where the card's foot has room for cost and income. */
function fitPrices(root) {
  if (tab !== "send") return;
  for (const card of root.querySelectorAll(".unit-card.card-send")) {
    const foot = card.querySelector(".card-foot");
    if (!foot) continue;
    card.classList.add("price-big");
    if (foot.scrollWidth > foot.clientWidth + 1) card.classList.remove("price-big");
    // v0.18b: gold cost and income up to 20 % larger where the card is wide enough
    for (const z of [1.2, 1.15, 1.1, 1.05, 1]) {
      foot.style.setProperty("--pz", z);
      if (z === 1 || (foot.scrollWidth <= foot.clientWidth + 1 && foot.scrollHeight <= foot.clientHeight + 1)) break;
    }
  }
}
/** v0.10zd: names that do not fit on one row in the larger size drop back to the small size. */
function fitCardNames(root) {
  if (tab !== "build") return;
  for (const el of root.querySelectorAll(".unit-card:not(.up-card) .unit-name"))
    if (el.scrollWidth > el.clientWidth + 1) el.classList.add("long-name");
}
function cardMarkup(item) {
  const a = available(game, own, cardAction(item), item.id),
    label = priceLabel(item),
    kindClass = item.kind === "send" ? "card-send" : item.kind === "research" ? "card-research" : "card-tower";
  return `<button class="unit-card ${kindClass}${item.id === "n00Y" && game && burningTreant(game.players[own]) ? " burning" : ""} ${item.kind === "send" && (item.bossTier || item.flying) ? "framed" : ""} ${selected === item.id && tab === "build" ? "selected" : ""} ${a.ok ? "" : "unaffordable"} ${isPoor(a) ? "poor" : ""}" data-kind="${item.kind}" data-card="${item.id}" aria-label="${esc(itemName(item))}, ${esc(label)} Gold, ${esc(cardHint(item))}${a.ok ? "" : ", " + esc(t(a.reason))}"><span class="unit-name">${esc(itemName(item))}</span><span class="card-art"><img src="${towerArtUrl(artFor(item))}" alt=""></span><span class="card-foot${item.kind === "send" && (label + formatInc(incomeFor(item))).length >= (item.bossTier || item.flying ? 6 : 7) ? " long" : ""}"><span class="price${item.kind === "research" && itemPrice(item).wood ? " wood-price" : ""}${isFreeLabel(label) ? " free" : ""}">${label}</span>${item.kind === "send" ? `<span class="card-note${incomeFor(item) > item.income + 0.004 ? " buffed" : ""}">+${formatInc(incomeFor(item))}</span>` : ""}</span><span class="card-status">${cardStatus(item)}</span>${item.kind === "send" ? `<span class="card-stock">${stockCount(item)}</span>${item.bossTier ? '<i class="frame-boss" aria-hidden="true"></i>' : item.flying ? '<i class="frame-air" aria-hidden="true"></i>' : ""}` : ""}</button>`;
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
  // v0.22n2: tiers with 10 creeps (two removed) get 5 slightly larger cards per row
  const tierSize = tab === "send" ? catalog.sends.filter((x) => x.playable && x.tier === game.players[own].tier).length : 0;
  $("cards").classList.toggle("five", tab === "send" && tierSize > 0 && tierSize <= 10);
  deckSignature = deckSig();
  $("cards").innerHTML =
    (list.map(cardMarkup).join("") || `<div class="empty-deck">${t("All available upgrades researched.")}</div>`);
  fitCardNames($("cards"));
  fitPrices($("cards")); // v0.17
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
  $("deck-expand").hidden = true; // v0.10j: the "All" handle is gone; swipe or use the arrows
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
  fitCardNames($("sheet-cards"));
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
const PERK_SVG = {"arrowhead": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n</defs><g filter=\"url(#drop)\"><g transform=\"rotate(40 128 128)\">\n<rect x=\"114\" y=\"176\" width=\"28\" height=\"74\" rx=\"9\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<rect x=\"114\" y=\"200\" width=\"28\" height=\"10\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"3\"/><rect x=\"114\" y=\"220\" width=\"28\" height=\"10\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"3\"/>\n<polygon points=\"128,8 196,150 160,138 148,166 108,166 96,138 60,150\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<polygon points=\"128,8 128,166 108,166 96,138 60,150\" fill=\"url(#steelL)\"/>\n<polygon points=\"128,8 196,150 160,138 148,166 108,166 96,138 60,150\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<line x1=\"128\" y1=\"14\" x2=\"128\" y2=\"160\" stroke=\"#ffffff\" stroke-width=\"2.5\" opacity=\".8\"/>\n<path d=\"M118 40 L84 128\" stroke=\"#fff\" stroke-width=\"9\" stroke-linecap=\"round\" filter=\"url(#soft)\" opacity=\".9\"/>\n<rect x=\"94\" y=\"156\" width=\"68\" height=\"30\" rx=\"10\" fill=\"url(#goldH)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<path d=\"M100 164 H156\" stroke=\"#fff6b0\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\".8\"/>\n</g><g transform=\"translate(97 154)\"><rect x=\"-17\" y=\"-17\" width=\"34\" height=\"34\" rx=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<path d=\"M-11 -11H11V11H-11Z\" fill=\"#0a2a80\" stroke=\"#161c33\" stroke-width=\"2.5\"/><path d=\"M-11 -11L0 0L11 -11Z\" fill=\"#7fd0ff\"/><path d=\"M-11 -11L0 0L-11 11Z\" fill=\"#3a8cff\"/><path d=\"M11 -11L0 0L11 11Z\" fill=\"#1450c8\"/><path d=\"M-11 11L0 0L11 11Z\" fill=\"#0c3494\"/><circle cx=\"-4.95\" cy=\"-6.050000000000001\" r=\"2.42\" fill=\"#fff\"/></g></g></svg>", "militia": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n</defs><g filter=\"url(#drop)\"><g><polygon points=\"93.3,185.3 226.1,52.5 236.0,20.0 203.5,29.9 70.7,162.7\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><polygon points=\"93.3,185.3 226.1,52.5 236.0,20.0 82.0,174.0\" fill=\"url(#steelL)\"/><polyline points=\"93.3,185.3 226.1,52.5 236.0,20.0 203.5,29.9 70.7,162.7\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><line x1=\"82.0\" y1=\"174.0\" x2=\"236.0\" y2=\"20.0\" stroke=\"#ffffff\" stroke-width=\"2\" opacity=\".7\"/>\n<g transform=\"rotate(45 78 178)\"><rect x=\"34\" y=\"166\" width=\"88\" height=\"22\" rx=\"9\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"5\"/><rect x=\"67\" y=\"186\" width=\"22\" height=\"44\" rx=\"6\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"4\"/><circle cx=\"78\" cy=\"240\" r=\"13\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/></g><g transform=\"translate(78 178)\"><rect x=\"-14\" y=\"-14\" width=\"28\" height=\"28\" rx=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<path d=\"M-8 -8H8V8H-8Z\" fill=\"#0a2a80\" stroke=\"#161c33\" stroke-width=\"2.5\"/><path d=\"M-8 -8L0 0L8 -8Z\" fill=\"#7fd0ff\"/><path d=\"M-8 -8L0 0L-8 8Z\" fill=\"#3a8cff\"/><path d=\"M8 -8L0 0L8 8Z\" fill=\"#1450c8\"/><path d=\"M-8 8L0 0L8 8Z\" fill=\"#0c3494\"/><circle cx=\"-3.6\" cy=\"-4.4\" r=\"1.76\" fill=\"#fff\"/></g></g>\n<g transform=\"translate(150 150) scale(.84) translate(-136 -140)\">\n<circle cx=\"136\" cy=\"140\" r=\"86\" fill=\"url(#shieldWood)\" stroke=\"#24170f\" stroke-width=\"6\"/>\n<clipPath id=\"sc\"><circle cx=\"136\" cy=\"140\" r=\"74\"/></clipPath>\n<g clip-path=\"url(#sc)\"><rect x=\"56\" y=\"50\" width=\"34\" height=\"190\" fill=\"#000\" opacity=\".12\"/><rect x=\"124\" y=\"50\" width=\"34\" height=\"190\" fill=\"#000\" opacity=\".12\"/><rect x=\"192\" y=\"50\" width=\"34\" height=\"190\" fill=\"#000\" opacity=\".12\"/>\n<path d=\"M90 50V240M124 50V240M158 50V240M192 50V240\" stroke=\"#4a220a\" stroke-width=\"3\" opacity=\".7\"/></g>\n<circle cx=\"136\" cy=\"140\" r=\"80\" fill=\"none\" stroke=\"url(#goldH)\" stroke-width=\"13\"/>\n<circle cx=\"136\" cy=\"140\" r=\"86\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"5\"/><circle cx=\"136\" cy=\"140\" r=\"73\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"3.5\"/>\n<path d=\"M76 104 A70 70 0 0 1 118 66\" stroke=\"#fff6b0\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\" opacity=\".8\"/>\n<circle cx=\"136\" cy=\"140\" r=\"27\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"5\"/><circle cx=\"136\" cy=\"140\" r=\"16\" fill=\"url(#gem)\" stroke=\"#161c33\" stroke-width=\"3\"/><circle cx=\"130\" cy=\"134\" r=\"5\" fill=\"#fff\"/>\n<path d=\"M96 96 Q110 82 132 78\" stroke=\"#fff\" stroke-width=\"10\" fill=\"none\" stroke-linecap=\"round\" filter=\"url(#soft2)\" opacity=\".55\"/></g></g></svg>", "novice": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n</defs><g filter=\"url(#drop)\"><path d=\"M44 52 H196 V212 H60 Z\" fill=\"url(#parch)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<rect x=\"30\" y=\"34\" width=\"180\" height=\"34\" rx=\"17\" fill=\"url(#roll)\" stroke=\"#24170f\" stroke-width=\"6\"/><circle cx=\"47\" cy=\"51\" r=\"11\" fill=\"#c08a46\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<rect x=\"44\" y=\"198\" width=\"180\" height=\"32\" rx=\"16\" fill=\"url(#roll)\" stroke=\"#24170f\" stroke-width=\"6\"/><circle cx=\"207\" cy=\"214\" r=\"10\" fill=\"#c08a46\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<g stroke=\"#8a5a2a\" stroke-width=\"7\" stroke-linecap=\"round\" opacity=\".55\"><path d=\"M70 98H170M70 124H178M70 150H150M70 176H130\"/></g>\n<path d=\"M60 84 Q56 140 66 196\" stroke=\"#fff\" stroke-width=\"8\" fill=\"none\" filter=\"url(#soft)\" opacity=\".7\"/>\n<circle cx=\"160\" cy=\"176\" r=\"18\" fill=\"url(#red)\" stroke=\"#24170f\" stroke-width=\"4\"/><circle cx=\"154\" cy=\"170\" r=\"5\" fill=\"#fff\" opacity=\".8\"/>\n<path d=\"M120 214 Q150 120 238 18 Q232 96 150 196 Z\" fill=\"url(#feather)\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M126 206 Q170 118 232 26\" stroke=\"#161c33\" stroke-width=\"4\" fill=\"none\"/>\n<path d=\"M150 168 Q186 110 222 54\" stroke=\"#fff\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\" opacity=\".9\"/>\n<path d=\"M170 140 l-14 -6 M186 116 l-14 -6 M202 92 l-14 -6\" stroke=\"#9cbbe6\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n<path d=\"M112 238 L120 206 L140 214 Z\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/></g></svg>", "volley": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n</defs><g filter=\"url(#drop)\"><g stroke=\"#ffffff\" stroke-linecap=\"round\" opacity=\".45\" filter=\"url(#soft)\" stroke-width=\"7\"><path d=\"M30 14 L44 56 M106 6 L118 40 M182 20 L194 56\"/></g>\n<g transform=\"translate(58 120) rotate(-18) scale(1.05)\">\n<path d=\"M-12 -86 L-28 -112 L-26 -76 L-10 -58 Z M12 -86 L28 -112 L26 -76 L10 -58 Z\" fill=\"url(#red)\" stroke=\"#24170f\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/>\n<rect x=\"-8\" y=\"-96\" width=\"16\" height=\"118\" rx=\"6\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"4.5\"/>\n<rect x=\"-10\" y=\"6\" width=\"20\" height=\"12\" rx=\"4\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3.5\"/>\n<polygon points=\"0,66 -22,14 22,14\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><polygon points=\"0,66 -22,14 0,14\" fill=\"url(#steelL)\"/>\n<polygon points=\"0,66 -22,14 22,14\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/></g><g transform=\"translate(196 108) rotate(-18) scale(1.05)\">\n<path d=\"M-12 -86 L-28 -112 L-26 -76 L-10 -58 Z M12 -86 L28 -112 L26 -76 L10 -58 Z\" fill=\"url(#red)\" stroke=\"#24170f\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/>\n<rect x=\"-8\" y=\"-96\" width=\"16\" height=\"118\" rx=\"6\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"4.5\"/>\n<rect x=\"-10\" y=\"6\" width=\"20\" height=\"12\" rx=\"4\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3.5\"/>\n<polygon points=\"0,66 -22,14 22,14\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><polygon points=\"0,66 -22,14 0,14\" fill=\"url(#steelL)\"/>\n<polygon points=\"0,66 -22,14 22,14\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/></g><g transform=\"translate(128 150) rotate(-18) scale(1.15)\">\n<path d=\"M-12 -86 L-28 -112 L-26 -76 L-10 -58 Z M12 -86 L28 -112 L26 -76 L10 -58 Z\" fill=\"url(#red)\" stroke=\"#24170f\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/>\n<rect x=\"-8\" y=\"-96\" width=\"16\" height=\"118\" rx=\"6\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"4.5\"/>\n<rect x=\"-10\" y=\"6\" width=\"20\" height=\"12\" rx=\"4\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3.5\"/>\n<polygon points=\"0,66 -22,14 22,14\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><polygon points=\"0,66 -22,14 0,14\" fill=\"url(#steelL)\"/>\n<polygon points=\"0,66 -22,14 22,14\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/></g></g></svg>", "evolution": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n</defs><g filter=\"url(#drop)\"><clipPath id=\"fl\"><circle cx=\"128\" cy=\"160\" r=\"76\"/></clipPath>\n<path d=\"M104 34 H152 V92 A78 78 0 1 1 104 92 Z\" fill=\"url(#glass)\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<g clip-path=\"url(#fl)\"><rect x=\"40\" y=\"128\" width=\"180\" height=\"120\" fill=\"url(#potion)\"/><ellipse cx=\"128\" cy=\"128\" rx=\"76\" ry=\"9\" fill=\"#f0b4ff\"/>\n<circle cx=\"96\" cy=\"196\" r=\"7\" fill=\"#f6c8ff\" opacity=\".7\"/><circle cx=\"160\" cy=\"214\" r=\"5\" fill=\"#f6c8ff\" opacity=\".7\"/><circle cx=\"148\" cy=\"176\" r=\"4\" fill=\"#f6c8ff\" opacity=\".7\"/></g>\n<path d=\"M104 34 H152 V92 A78 78 0 1 1 104 92 Z\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M76 140 Q80 112 104 100\" stroke=\"#fff\" stroke-width=\"12\" fill=\"none\" stroke-linecap=\"round\" filter=\"url(#soft)\" opacity=\".9\"/><circle cx=\"176\" cy=\"122\" r=\"7\" fill=\"#fff\" opacity=\".85\" filter=\"url(#soft)\"/>\n<rect x=\"96\" y=\"12\" width=\"64\" height=\"34\" rx=\"9\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"5\"/><rect x=\"98\" y=\"42\" width=\"60\" height=\"12\" rx=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<path d=\"M80 150 H176 L168 214 H88 Z\" fill=\"url(#parch)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M128 156 L160 188 H142 V208 H114 V188 H96 Z\" fill=\"url(#green)\" stroke=\"#0e3a08\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M124 166 L106 184\" stroke=\"#efffc8\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\".9\"/></g></svg>", "pillage": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n</defs>\n<g filter=\"url(#drop)\">\n<g transform=\"rotate(32 150 120)\">\n<rect x=\"118\" y=\"150\" width=\"20\" height=\"40\" rx=\"7\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<rect x=\"96\" y=\"140\" width=\"64\" height=\"16\" rx=\"6\" fill=\"url(#goldH)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<polygon points=\"128,6 152,140 104,140\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<polygon points=\"128,6 128,140 104,140\" fill=\"url(#steelL)\"/>\n<polygon points=\"128,6 152,140 104,140\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<circle cx=\"128\" cy=\"196\" r=\"9\" fill=\"url(#gem)\" stroke=\"#161c33\" stroke-width=\"3\"/>\n</g>\n<path d=\"M70 132 C40 170 46 236 128 238 C210 236 216 170 186 132 Z\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M84 146 C66 176 70 214 108 226\" stroke=\"#c98a52\" stroke-width=\"7\" stroke-linecap=\"round\" fill=\"none\" opacity=\".55\"/>\n<path d=\"M90 120 Q128 136 166 120 L172 140 Q128 156 84 140 Z\" fill=\"#6e3a16\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M92 132 Q128 146 164 132\" stroke=\"url(#red)\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\"/>\n<ellipse cx=\"108\" cy=\"112\" rx=\"16\" ry=\"12.8\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"108\" cy=\"110\" rx=\"9.6\" ry=\"7.2\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/><ellipse cx=\"146\" cy=\"106\" rx=\"16\" ry=\"12.8\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"146\" cy=\"104\" rx=\"9.6\" ry=\"7.2\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/><ellipse cx=\"128\" cy=\"92\" rx=\"15\" ry=\"12.0\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"128\" cy=\"90\" rx=\"9.0\" ry=\"6.8\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/><ellipse cx=\"176\" cy=\"196\" rx=\"14\" ry=\"11.2\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"176\" cy=\"194\" rx=\"8.4\" ry=\"6.3\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/><ellipse cx=\"196\" cy=\"218\" rx=\"13\" ry=\"10.4\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"196\" cy=\"216\" rx=\"7.8\" ry=\"5.9\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/><ellipse cx=\"64\" cy=\"214\" rx=\"12\" ry=\"9.6\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"64\" cy=\"212\" rx=\"7.2\" ry=\"5.4\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/>\n<path d=\"M112 102 l6 -8\" stroke=\"#fff\" stroke-width=\"4\" stroke-linecap=\"round\" filter=\"url(#soft)\"/>\n</g></svg>", "crowd": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n</defs>\n<g filter=\"url(#drop)\">\n<g transform=\"rotate(-20 128 128)\">\n<rect x=\"150\" y=\"30\" width=\"16\" height=\"210\" rx=\"7\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<rect x=\"148\" y=\"150\" width=\"20\" height=\"10\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"3\"/>\n<path d=\"M158 40 C120 22 66 30 30 70 C70 52 112 52 156 66 Z\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M150 46 C116 34 72 40 44 62 C78 50 112 50 150 58 Z\" fill=\"url(#steelL)\"/>\n<rect x=\"146\" y=\"38\" width=\"24\" height=\"30\" rx=\"5\" fill=\"url(#goldH)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n</g>\n<g transform=\"translate(70 196) scale(1.05)\"><path d=\"M-22 -4 C-22 -30 22 -30 22 -4 C22 8 14 12 12 16 L12 24 H-12 L-12 16 C-14 12 -22 8 -22 -4 Z\" fill=\"url(#parch)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<ellipse cx=\"-9\" cy=\"-2\" rx=\"6\" ry=\"7\" fill=\"#24170f\"/><ellipse cx=\"9\" cy=\"-2\" rx=\"6\" ry=\"7\" fill=\"#24170f\"/><path d=\"M0 6 L-4 13 H4 Z\" fill=\"#24170f\"/>\n<path d=\"M-6 24 V18 M0 24 V18 M6 24 V18\" stroke=\"#24170f\" stroke-width=\"3\"/><path d=\"M-14 -16 Q-6 -24 4 -24\" stroke=\"#fff\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\" opacity=\".8\"/></g><g transform=\"translate(124 214) scale(1.15)\"><path d=\"M-22 -4 C-22 -30 22 -30 22 -4 C22 8 14 12 12 16 L12 24 H-12 L-12 16 C-14 12 -22 8 -22 -4 Z\" fill=\"url(#parch)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<ellipse cx=\"-9\" cy=\"-2\" rx=\"6\" ry=\"7\" fill=\"#24170f\"/><ellipse cx=\"9\" cy=\"-2\" rx=\"6\" ry=\"7\" fill=\"#24170f\"/><path d=\"M0 6 L-4 13 H4 Z\" fill=\"#24170f\"/>\n<path d=\"M-6 24 V18 M0 24 V18 M6 24 V18\" stroke=\"#24170f\" stroke-width=\"3\"/><path d=\"M-14 -16 Q-6 -24 4 -24\" stroke=\"#fff\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\" opacity=\".8\"/></g><g transform=\"translate(184 198) scale(1.0)\"><path d=\"M-22 -4 C-22 -30 22 -30 22 -4 C22 8 14 12 12 16 L12 24 H-12 L-12 16 C-14 12 -22 8 -22 -4 Z\" fill=\"url(#parch)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<ellipse cx=\"-9\" cy=\"-2\" rx=\"6\" ry=\"7\" fill=\"#24170f\"/><ellipse cx=\"9\" cy=\"-2\" rx=\"6\" ry=\"7\" fill=\"#24170f\"/><path d=\"M0 6 L-4 13 H4 Z\" fill=\"#24170f\"/>\n<path d=\"M-6 24 V18 M0 24 V18 M6 24 V18\" stroke=\"#24170f\" stroke-width=\"3\"/><path d=\"M-14 -16 Q-6 -24 4 -24\" stroke=\"#fff\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\" opacity=\".8\"/></g>\n</g></svg>", "golem": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n</defs>\n<g filter=\"url(#drop)\">\n<path d=\"M52 92 C44 60 72 34 128 34 C184 34 212 60 204 92 L214 176 C218 214 182 236 128 236 C74 236 38 214 42 176 Z\" fill=\"#8a7a66\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M60 92 C56 66 80 46 128 46 C150 46 168 50 180 58 C150 54 92 58 76 96 L66 170 C62 190 70 206 84 214 C58 204 52 186 54 170 Z\" fill=\"#b8a68a\" opacity=\".85\"/>\n<path d=\"M86 64 L104 92 L92 120 M172 70 L156 100 L170 128 M120 196 L132 214 L124 232\" stroke=\"#3e2f22\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n<path d=\"M78 128 Q100 112 118 130 Q100 144 78 128 Z\" fill=\"#24170f\"/><path d=\"M138 130 Q156 112 178 128 Q156 144 138 130 Z\" fill=\"#24170f\"/>\n<path d=\"M70 112 L122 120 L118 104 L74 98 Z\" fill=\"#5e5040\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/><path d=\"M186 112 L134 120 L138 104 L182 98 Z\" fill=\"#5e5040\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/><ellipse cx=\"98\" cy=\"129\" rx=\"10\" ry=\"6\" fill=\"#ffb02e\"/><ellipse cx=\"158\" cy=\"129\" rx=\"10\" ry=\"6\" fill=\"#ffb02e\"/>\n<ellipse cx=\"98\" cy=\"129\" rx=\"4\" ry=\"3\" fill=\"#fff6c0\"/><ellipse cx=\"158\" cy=\"129\" rx=\"4\" ry=\"3\" fill=\"#fff6c0\"/>\n<path d=\"M94 184 Q128 172 162 184\" stroke=\"#24170f\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M30 118 C10 112 4 136 20 146 C34 154 44 140 42 128\" fill=\"#8a7a66\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M226 118 C246 112 252 136 236 146 C222 154 212 140 214 128\" fill=\"#8a7a66\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<g transform=\"translate(206 70)\"><path d=\"M0 -26 C12 -10 12 10 0 26 C-12 10 -12 -10 0 -26Z\" fill=\"url(#green)\" stroke=\"#0e3a08\" stroke-width=\"4\"/><path d=\"M0 -20 V20\" stroke=\"#efffc8\" stroke-width=\"3\" opacity=\".8\"/></g>\n<path d=\"M80 60 Q100 48 124 48\" stroke=\"#fff\" stroke-width=\"6\" fill=\"none\" stroke-linecap=\"round\" filter=\"url(#soft)\" opacity=\".7\"/>\n</g></svg>", "permafrost": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"ice\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".4\" stop-color=\"#bfeaff\"/><stop offset=\"1\" stop-color=\"#3fa0d8\"/></linearGradient>\n<linearGradient id=\"iceD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8fd4f4\"/><stop offset=\"1\" stop-color=\"#1d6aa8\"/></linearGradient></defs>\n<g filter=\"url(#drop)\">\n<ellipse cx=\"128\" cy=\"206\" rx=\"104\" ry=\"34\" fill=\"#6e4a2c\" stroke=\"#24170f\" stroke-width=\"6\"/>\n<ellipse cx=\"128\" cy=\"200\" rx=\"96\" ry=\"26\" fill=\"url(#ice)\" opacity=\".95\"/>\n<path d=\"M60 202 L92 196 L104 210 M150 192 L176 204 L198 198\" stroke=\"#3fa0d8\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/>\n<g transform=\"rotate(-14 70 206)\"><polygon points=\"48,206 70,116 92,206\" fill=\"url(#iceD)\" stroke=\"#0f2c4a\" stroke-width=\"5\" stroke-linejoin=\"round\"/><polygon points=\"48,206 70,116 70,206\" fill=\"url(#ice)\"/><polygon points=\"48,206 70,116 92,206\" fill=\"none\" stroke=\"#0f2c4a\" stroke-width=\"5\" stroke-linejoin=\"round\"/><line x1=\"62.3\" y1=\"183.5\" x2=\"67.8\" y2=\"134.0\" stroke=\"#fff\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\".9\"/></g><g transform=\"rotate(14 186 206)\"><polygon points=\"166,206 186,122 206,206\" fill=\"url(#iceD)\" stroke=\"#0f2c4a\" stroke-width=\"5\" stroke-linejoin=\"round\"/><polygon points=\"166,206 186,122 186,206\" fill=\"url(#ice)\"/><polygon points=\"166,206 186,122 206,206\" fill=\"none\" stroke=\"#0f2c4a\" stroke-width=\"5\" stroke-linejoin=\"round\"/><line x1=\"179.0\" y1=\"185.0\" x2=\"184.0\" y2=\"138.8\" stroke=\"#fff\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\".9\"/></g><g transform=\"rotate(0 128 210)\"><polygon points=\"98,210 128,60 158,210\" fill=\"url(#iceD)\" stroke=\"#0f2c4a\" stroke-width=\"5\" stroke-linejoin=\"round\"/><polygon points=\"98,210 128,60 128,210\" fill=\"url(#ice)\"/><polygon points=\"98,210 128,60 158,210\" fill=\"none\" stroke=\"#0f2c4a\" stroke-width=\"5\" stroke-linejoin=\"round\"/><line x1=\"117.5\" y1=\"172.5\" x2=\"125.0\" y2=\"90.0\" stroke=\"#fff\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\".9\"/></g>\n<g opacity=\".95\"><line x1=\"196\" y1=\"62\" x2=\"226.0\" y2=\"62.0\" stroke=\"#0f2c4a\" stroke-width=\"11\" stroke-linecap=\"round\"/><line x1=\"196\" y1=\"62\" x2=\"211.0\" y2=\"88.0\" stroke=\"#0f2c4a\" stroke-width=\"11\" stroke-linecap=\"round\"/><line x1=\"196\" y1=\"62\" x2=\"181.0\" y2=\"88.0\" stroke=\"#0f2c4a\" stroke-width=\"11\" stroke-linecap=\"round\"/><line x1=\"196\" y1=\"62\" x2=\"166.0\" y2=\"62.0\" stroke=\"#0f2c4a\" stroke-width=\"11\" stroke-linecap=\"round\"/><line x1=\"196\" y1=\"62\" x2=\"181.0\" y2=\"36.0\" stroke=\"#0f2c4a\" stroke-width=\"11\" stroke-linecap=\"round\"/><line x1=\"196\" y1=\"62\" x2=\"211.0\" y2=\"36.0\" stroke=\"#0f2c4a\" stroke-width=\"11\" stroke-linecap=\"round\"/><line x1=\"196\" y1=\"62\" x2=\"226.0\" y2=\"62.0\" stroke=\"#ffffff\" stroke-width=\"6\" stroke-linecap=\"round\"/><line x1=\"196\" y1=\"62\" x2=\"211.0\" y2=\"88.0\" stroke=\"#ffffff\" stroke-width=\"6\" stroke-linecap=\"round\"/><line x1=\"196\" y1=\"62\" x2=\"181.0\" y2=\"88.0\" stroke=\"#ffffff\" stroke-width=\"6\" stroke-linecap=\"round\"/><line x1=\"196\" y1=\"62\" x2=\"166.0\" y2=\"62.0\" stroke=\"#ffffff\" stroke-width=\"6\" stroke-linecap=\"round\"/><line x1=\"196\" y1=\"62\" x2=\"181.0\" y2=\"36.0\" stroke=\"#ffffff\" stroke-width=\"6\" stroke-linecap=\"round\"/><line x1=\"196\" y1=\"62\" x2=\"211.0\" y2=\"36.0\" stroke=\"#ffffff\" stroke-width=\"6\" stroke-linecap=\"round\"/><circle cx=\"196\" cy=\"62\" r=\"7\" fill=\"#bfeaff\" stroke=\"#0f2c4a\" stroke-width=\"3\"/></g>\n</g></svg>", "wings": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fire\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#a81804\"/><stop offset=\".45\" stop-color=\"#ff6a12\"/><stop offset=\".8\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".3\" stop-color=\"#f0d0ff\"/><stop offset=\".7\" stop-color=\"#b05cf0\"/><stop offset=\"1\" stop-color=\"#5a1a9a\"/></radialGradient>\n<linearGradient id=\"wing\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#dfe6ff\"/><stop offset=\"1\" stop-color=\"#8f9ad8\"/></linearGradient></defs>\n<g filter=\"url(#drop)\"><path d=\"M114 92 Q78 66 32 40 Q68 70 114 112 Z\" fill=\"url(#wing)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M114 107 Q82 81 44 66 Q74 96 114 127 Z\" fill=\"url(#wing)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M114 122 Q86 96 56 92 Q80 122 114 142 Z\" fill=\"url(#wing)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M114 137 Q90 111 68 118 Q86 148 114 157 Z\" fill=\"url(#wing)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M114 152 Q94 126 80 144 Q92 174 114 172 Z\" fill=\"url(#wing)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M142 92 Q178 66 224 40 Q188 70 142 112 Z\" fill=\"url(#wing)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M142 107 Q174 81 212 66 Q182 96 142 127 Z\" fill=\"url(#wing)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M142 122 Q170 96 200 92 Q176 122 142 142 Z\" fill=\"url(#wing)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M142 137 Q166 111 188 118 Q170 148 142 157 Z\" fill=\"url(#wing)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M142 152 Q162 126 176 144 Q164 174 142 172 Z\" fill=\"url(#wing)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/>\n<rect x=\"120\" y=\"30\" width=\"16\" height=\"150\" rx=\"3\" fill=\"url(#steelL)\" stroke=\"#161c33\" stroke-width=\"5\"/>\n<polygon points=\"120,30 128,12 136,30\" fill=\"url(#steelL)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<rect x=\"94\" y=\"176\" width=\"68\" height=\"16\" rx=\"6\" fill=\"url(#goldH)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<rect x=\"120\" y=\"190\" width=\"16\" height=\"40\" rx=\"6\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<circle cx=\"128\" cy=\"236\" r=\"10\" fill=\"url(#gem)\" stroke=\"#161c33\" stroke-width=\"4\"/>\n<path d=\"M150 70 L136 100 L150 100 L138 132\" stroke=\"#fff6a0\" stroke-width=\"6\" fill=\"none\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n</g></svg>", "hellfire": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fire\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#a81804\"/><stop offset=\".45\" stop-color=\"#ff6a12\"/><stop offset=\".8\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".3\" stop-color=\"#f0d0ff\"/><stop offset=\".7\" stop-color=\"#b05cf0\"/><stop offset=\"1\" stop-color=\"#5a1a9a\"/></radialGradient>\n<linearGradient id=\"wing\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#dfe6ff\"/><stop offset=\"1\" stop-color=\"#8f9ad8\"/></linearGradient></defs>\n<g filter=\"url(#drop)\">\n<path d=\"M40 196 Q40 176 70 170 L186 170 Q216 176 216 196 L216 226 Q216 240 196 240 L60 240 Q40 240 40 226 Z\" fill=\"#3a0c04\" stroke=\"#24170f\" stroke-width=\"6\"/>\n<path d=\"M58 206 Q90 186 128 204 Q166 222 198 200\" stroke=\"#ffb02e\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M70 226 Q100 214 126 226\" stroke=\"#ff6a12\" stroke-width=\"6\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M128 24 C150 64 196 84 186 140 C180 176 150 196 128 196 C100 196 70 176 70 138 C70 110 90 96 96 70 C108 90 112 100 120 104 C122 76 116 52 128 24 Z\" fill=\"url(#fire)\" stroke=\"#5a0e02\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M128 96 C140 120 160 132 154 160 C150 180 138 188 128 188 C114 188 100 178 102 158 C104 140 118 130 128 96 Z\" fill=\"#fff2a0\" opacity=\".9\"/>\n<path d=\"M100 120 C96 132 96 146 102 156\" stroke=\"#fff\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\" opacity=\".7\"/>\n</g></svg>", "burst": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fire\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#a81804\"/><stop offset=\".45\" stop-color=\"#ff6a12\"/><stop offset=\".8\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".3\" stop-color=\"#f0d0ff\"/><stop offset=\".7\" stop-color=\"#b05cf0\"/><stop offset=\"1\" stop-color=\"#5a1a9a\"/></radialGradient>\n<linearGradient id=\"wing\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#dfe6ff\"/><stop offset=\"1\" stop-color=\"#8f9ad8\"/></linearGradient></defs>\n<g filter=\"url(#drop)\">\n<circle cx=\"128\" cy=\"128\" r=\"96\" fill=\"none\" stroke=\"#5a1a9a\" stroke-width=\"14\"/>\n<circle cx=\"128\" cy=\"128\" r=\"96\" fill=\"none\" stroke=\"#d8a8ff\" stroke-width=\"6\" stroke-dasharray=\"20 12\"/>\n\n<polygon points=\"158.3,154.2 213.0,163.2 167.9,130.9\" fill=\"#e2c0ff\" stroke=\"#3a0c60\" stroke-width=\"4\" stroke-linejoin=\"round\"/><polygon points=\"130.9,167.9 163.2,213.0 154.2,158.3\" fill=\"#e2c0ff\" stroke=\"#3a0c60\" stroke-width=\"4\" stroke-linejoin=\"round\"/><polygon points=\"101.8,158.3 92.8,213.0 125.1,167.9\" fill=\"#e2c0ff\" stroke=\"#3a0c60\" stroke-width=\"4\" stroke-linejoin=\"round\"/><polygon points=\"88.1,130.9 43.0,163.2 97.7,154.2\" fill=\"#e2c0ff\" stroke=\"#3a0c60\" stroke-width=\"4\" stroke-linejoin=\"round\"/><polygon points=\"97.7,101.8 43.0,92.8 88.1,125.1\" fill=\"#e2c0ff\" stroke=\"#3a0c60\" stroke-width=\"4\" stroke-linejoin=\"round\"/><polygon points=\"125.1,88.1 92.8,43.0 101.8,97.7\" fill=\"#e2c0ff\" stroke=\"#3a0c60\" stroke-width=\"4\" stroke-linejoin=\"round\"/><polygon points=\"154.2,97.7 163.2,43.0 130.9,88.1\" fill=\"#e2c0ff\" stroke=\"#3a0c60\" stroke-width=\"4\" stroke-linejoin=\"round\"/><polygon points=\"167.9,125.1 213.0,92.8 158.3,101.8\" fill=\"#e2c0ff\" stroke=\"#3a0c60\" stroke-width=\"4\" stroke-linejoin=\"round\"/><circle cx=\"128\" cy=\"128\" r=\"46\" fill=\"url(#arc)\" stroke=\"#3a0c60\" stroke-width=\"6\"/>\n<path d=\"M128 100 L136 120 L156 128 L136 136 L128 156 L120 136 L100 128 L120 120 Z\" fill=\"#ffffff\" opacity=\".95\"/>\n<path d=\"M104 104 Q112 94 124 92\" stroke=\"#fff\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\" opacity=\".8\"/>\n</g></svg>", "pocks": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<radialGradient id=\"pus\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f4ffb0\"/><stop offset=\".35\" stop-color=\"#a8e83a\"/><stop offset=\".8\" stop-color=\"#4c8a10\"/><stop offset=\"1\" stop-color=\"#22420a\"/></radialGradient>\n<radialGradient id=\"skin\" cx=\".4\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#c8b48a\"/><stop offset=\".7\" stop-color=\"#8a6a48\"/><stop offset=\"1\" stop-color=\"#5a402a\"/></radialGradient></defs>\n<g filter=\"url(#drop)\">\n<path d=\"M40 150 C34 90 80 46 136 50 C196 54 228 104 216 158 C206 206 160 232 118 228 C70 224 44 196 40 150 Z\" fill=\"url(#skin)\" stroke=\"#24170f\" stroke-width=\"6\"/>\n<path d=\"M66 104 C80 76 108 64 136 64\" stroke=\"#e8d8b0\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\" opacity=\".7\"/>\n<circle cx=\"130\" cy=\"128\" r=\"40\" fill=\"url(#pus)\" stroke=\"#1c3406\" stroke-width=\"4\"/><circle cx=\"116.0\" cy=\"112.0\" r=\"10.0\" fill=\"#fff\" opacity=\".85\"/><circle cx=\"78\" cy=\"164\" r=\"22\" fill=\"url(#pus)\" stroke=\"#1c3406\" stroke-width=\"4\"/><circle cx=\"70.3\" cy=\"155.2\" r=\"5.5\" fill=\"#fff\" opacity=\".85\"/><circle cx=\"176\" cy=\"92\" r=\"20\" fill=\"url(#pus)\" stroke=\"#1c3406\" stroke-width=\"4\"/><circle cx=\"169.0\" cy=\"84.0\" r=\"5.0\" fill=\"#fff\" opacity=\".85\"/><circle cx=\"178\" cy=\"176\" r=\"16\" fill=\"url(#pus)\" stroke=\"#1c3406\" stroke-width=\"4\"/><circle cx=\"172.4\" cy=\"169.6\" r=\"4.0\" fill=\"#fff\" opacity=\".85\"/><circle cx=\"112\" cy=\"196\" r=\"12\" fill=\"url(#pus)\" stroke=\"#1c3406\" stroke-width=\"4\"/><circle cx=\"107.8\" cy=\"191.2\" r=\"3.0\" fill=\"#fff\" opacity=\".85\"/>\n<path d=\"M150 166 C152 186 146 204 156 218 C164 206 160 188 150 166 Z\" fill=\"#a8e83a\" stroke=\"#1c3406\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M70 70 q6 -10 0 -20 M200 140 q10 -4 14 -14\" stroke=\"#8ad82a\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\" opacity=\".8\"/>\n</g></svg>", "treasure": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"redb\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff8a6a\"/><stop offset=\".45\" stop-color=\"#d82a14\"/><stop offset=\"1\" stop-color=\"#6a0a04\"/></linearGradient>\n<linearGradient id=\"waterG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e4f8ff\"/><stop offset=\".4\" stop-color=\"#5ec8ff\"/><stop offset=\"1\" stop-color=\"#0a4a9a\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe23a\"/><stop offset=\"1\" stop-color=\"#e08a0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient></defs>\n<g filter=\"url(#drop)\">\n<path d=\"M44 120 L212 120 L204 222 Q128 236 52 222 Z\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<rect x=\"44\" y=\"140\" width=\"168\" height=\"16\" fill=\"url(#goldH)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<rect x=\"64\" y=\"120\" width=\"16\" height=\"104\" fill=\"url(#goldH)\" stroke=\"#24170f\" stroke-width=\"4\"/><rect x=\"176\" y=\"120\" width=\"16\" height=\"104\" fill=\"url(#goldH)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<ellipse cx=\"92\" cy=\"110\" rx=\"20\" ry=\"16.0\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"92\" cy=\"108\" rx=\"12.0\" ry=\"9.0\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/><ellipse cx=\"130\" cy=\"98\" rx=\"22\" ry=\"17.6\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"130\" cy=\"96\" rx=\"13.2\" ry=\"9.9\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/><ellipse cx=\"168\" cy=\"108\" rx=\"20\" ry=\"16.0\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"168\" cy=\"106\" rx=\"12.0\" ry=\"9.0\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/><ellipse cx=\"110\" cy=\"84\" rx=\"18\" ry=\"14.4\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"110\" cy=\"82\" rx=\"10.8\" ry=\"8.1\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/><ellipse cx=\"150\" cy=\"80\" rx=\"18\" ry=\"14.4\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"150\" cy=\"78\" rx=\"10.8\" ry=\"8.1\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/><ellipse cx=\"130\" cy=\"64\" rx=\"16\" ry=\"12.8\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"130\" cy=\"62\" rx=\"9.6\" ry=\"7.2\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".75\"/>\n<rect x=\"114\" y=\"150\" width=\"28\" height=\"34\" rx=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><circle cx=\"128\" cy=\"164\" r=\"5\" fill=\"#24170f\"/>\n<circle cx=\"128\" cy=\"40\" r=\"10\" fill=\"url(#gem)\" stroke=\"#161c33\" stroke-width=\"3\"/>\n<path d=\"M200 60 l6 -14 l6 14 l14 6 l-14 6 l-6 14 l-6 -14 l-14 -6 Z\" fill=\"#fff6c0\"/>\n</g></svg>", "voltage": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"redb\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff8a6a\"/><stop offset=\".45\" stop-color=\"#d82a14\"/><stop offset=\"1\" stop-color=\"#6a0a04\"/></linearGradient>\n<linearGradient id=\"waterG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e4f8ff\"/><stop offset=\".4\" stop-color=\"#5ec8ff\"/><stop offset=\"1\" stop-color=\"#0a4a9a\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe23a\"/><stop offset=\"1\" stop-color=\"#e08a0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient></defs>\n<g filter=\"url(#drop)\">\n<rect x=\"70\" y=\"150\" width=\"116\" height=\"80\" rx=\"10\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"6\"/>\n<rect x=\"86\" y=\"166\" width=\"84\" height=\"48\" rx=\"6\" fill=\"#1a2440\" stroke=\"#161c33\" stroke-width=\"4\"/>\n<path d=\"M92 190 h12 l8 -14 l10 28 l10 -24 l8 10 h14\" stroke=\"#7fe0ff\" stroke-width=\"5\" fill=\"none\" stroke-linejoin=\"round\"/>\n<rect x=\"92\" y=\"120\" width=\"16\" height=\"34\" rx=\"4\" fill=\"url(#goldH)\" stroke=\"#24170f\" stroke-width=\"4\"/><rect x=\"148\" y=\"120\" width=\"16\" height=\"34\" rx=\"4\" fill=\"url(#goldH)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<polygon points=\"142,16 92,112 128,112 108,170 176,74 140,74 160,16\" fill=\"url(#bolt)\" stroke=\"#5a3a04\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M136 30 L110 96\" stroke=\"#fff\" stroke-width=\"5\" stroke-linecap=\"round\" opacity=\".85\"/>\n<path d=\"M40 70 l14 10 M216 70 l-14 10 M44 110 l16 2 M212 110 l-16 2\" stroke=\"#ffe23a\" stroke-width=\"6\" stroke-linecap=\"round\"/>\n</g></svg>", "boots": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"redb\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff8a6a\"/><stop offset=\".45\" stop-color=\"#d82a14\"/><stop offset=\"1\" stop-color=\"#6a0a04\"/></linearGradient>\n<linearGradient id=\"waterG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e4f8ff\"/><stop offset=\".4\" stop-color=\"#5ec8ff\"/><stop offset=\"1\" stop-color=\"#0a4a9a\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe23a\"/><stop offset=\"1\" stop-color=\"#e08a0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient></defs>\n<g filter=\"url(#drop)\">\n<path d=\"M70 36 L130 36 L134 150 Q170 150 206 176 Q226 194 214 214 L58 214 Q50 150 70 36 Z\" fill=\"url(#redb)\" stroke=\"#2a0602\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M66 36 L134 36 L134 62 L66 62 Z\" fill=\"url(#leather)\" stroke=\"#2a0602\" stroke-width=\"5\"/>\n<rect x=\"56\" y=\"206\" width=\"164\" height=\"22\" rx=\"8\" fill=\"#3e1e0c\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<path d=\"M84 72 C80 110 80 150 84 190\" stroke=\"#ffb4a0\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\" opacity=\".7\"/>\n<circle cx=\"120\" cy=\"96\" r=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"2\"/><circle cx=\"120\" cy=\"120\" r=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"2\"/><circle cx=\"120\" cy=\"144\" r=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"2\"/>\n<path d=\"M22 120 h30 M14 150 h36 M24 180 h26\" stroke=\"#ffd27a\" stroke-width=\"6\" stroke-linecap=\"round\"/>\n</g></svg>", "exhume": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"redb\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff8a6a\"/><stop offset=\".45\" stop-color=\"#d82a14\"/><stop offset=\"1\" stop-color=\"#6a0a04\"/></linearGradient>\n<linearGradient id=\"waterG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e4f8ff\"/><stop offset=\".4\" stop-color=\"#5ec8ff\"/><stop offset=\"1\" stop-color=\"#0a4a9a\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe23a\"/><stop offset=\"1\" stop-color=\"#e08a0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient></defs>\n<g filter=\"url(#drop)\">\n<path d=\"M28 196 Q128 160 228 196 L228 236 L28 236 Z\" fill=\"url(#dirt)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M150 46 Q150 22 172 22 L208 22 Q230 22 230 46 L230 186 L150 186 Z\" fill=\"#9aa2a8\" stroke=\"#2a2e34\" stroke-width=\"6\"/>\n<path d=\"M176 50 v40 M162 66 h28\" stroke=\"#4a5058\" stroke-width=\"7\" stroke-linecap=\"round\"/>\n<g transform=\"rotate(-28 70 120)\"><rect x=\"62\" y=\"30\" width=\"16\" height=\"130\" rx=\"6\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<path d=\"M44 156 L96 156 L92 200 Q70 216 48 200 Z\" fill=\"url(#steelL)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><rect x=\"52\" y=\"22\" width=\"36\" height=\"14\" rx=\"6\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"5\"/></g>\n<path d=\"M112 200 L112 168 M112 168 l-12 -16 M112 168 l0 -22 M112 168 l12 -18 M112 168 l20 -6\" stroke=\"#f0e8d0\" stroke-width=\"9\" stroke-linecap=\"round\"/>\n<path d=\"M112 200 L112 168 M112 168 l-12 -16 M112 168 l0 -22 M112 168 l12 -18 M112 168 l20 -6\" stroke=\"#24170f\" stroke-width=\"3\" stroke-linecap=\"round\" opacity=\".45\"/>\n<path d=\"M60 100 q10 -16 0 -30 M200 196 q8 -8 18 -6\" stroke=\"#8ad82a\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\" opacity=\".8\"/>\n</g></svg>", "waterblock": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"redb\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff8a6a\"/><stop offset=\".45\" stop-color=\"#d82a14\"/><stop offset=\"1\" stop-color=\"#6a0a04\"/></linearGradient>\n<linearGradient id=\"waterG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e4f8ff\"/><stop offset=\".4\" stop-color=\"#5ec8ff\"/><stop offset=\"1\" stop-color=\"#0a4a9a\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe23a\"/><stop offset=\"1\" stop-color=\"#e08a0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient></defs>\n<g filter=\"url(#drop)\">\n<path d=\"M128 22 L210 52 L204 140 Q196 196 128 232 Q60 196 52 140 L46 52 Z\" fill=\"url(#waterG)\" stroke=\"#0a2a5a\" stroke-width=\"7\" stroke-linejoin=\"round\"/>\n<path d=\"M66 110 Q86 92 106 110 Q126 128 146 110 Q166 92 190 110\" stroke=\"#ffffff\" stroke-width=\"8\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M72 150 Q92 134 112 150 Q132 166 152 150 Q170 136 184 148\" stroke=\"#c8eeff\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M72 56 L120 40\" stroke=\"#fff\" stroke-width=\"7\" stroke-linecap=\"round\" opacity=\".8\"/>\n<path d=\"M128 176 l-16 -16 M128 176 l16 -16 M128 176 v-30\" stroke=\"#0a2a5a\" stroke-width=\"8\" stroke-linecap=\"round\" transform=\"rotate(180 128 166)\"/>\n</g></svg>", "lone": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"stone\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#d6d2c8\"/><stop offset=\".55\" stop-color=\"#9a958a\"/><stop offset=\"1\" stop-color=\"#5e5a52\"/></linearGradient>\n<linearGradient id=\"stoneH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#6a665e\"/><stop offset=\".4\" stop-color=\"#c8c4ba\"/><stop offset=\"1\" stop-color=\"#7a766c\"/></linearGradient>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<linearGradient id=\"violet\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c9a8ff\"/><stop offset=\".5\" stop-color=\"#7a4ad8\"/><stop offset=\"1\" stop-color=\"#3a1a80\"/></linearGradient>\n<linearGradient id=\"cloud\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8eef8\"/><stop offset=\".55\" stop-color=\"#8e9cb8\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe03a\"/><stop offset=\"1\" stop-color=\"#e09a0a\"/></linearGradient>\n<linearGradient id=\"brass\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffe2a0\"/><stop offset=\".4\" stop-color=\"#d8a04a\"/><stop offset=\".8\" stop-color=\"#9a6420\"/><stop offset=\"1\" stop-color=\"#5e3a10\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd8a0\"/><stop offset=\".4\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8f0ff\"/><stop offset=\".5\" stop-color=\"#8fa2bc\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"team\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#8cc4ff\"/><stop offset=\".5\" stop-color=\"#1c74e0\"/><stop offset=\"1\" stop-color=\"#0c3a80\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><polygon points=\"102.5,144.2 44.1,39.2 22.0,24.0 23.2,50.8 81.5,155.8\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><polygon points=\"102.5,144.2 44.1,39.2 22.0,24.0 92.0,150.0\" fill=\"url(#steelL)\"/><polyline points=\"102.5,144.2 44.1,39.2 22.0,24.0 23.2,50.8 81.5,155.8\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><line x1=\"92.0\" y1=\"150.0\" x2=\"22.0\" y2=\"24.0\" stroke=\"#ffffff\" stroke-width=\"2\" opacity=\".7\"/><g transform=\"rotate(-29 92 150)\"><rect x=\"62\" y=\"142\" width=\"60\" height=\"16\" rx=\"7\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4.5\"/>\n<rect x=\"84\" y=\"156\" width=\"16\" height=\"34\" rx=\"5\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"4\"/><circle cx=\"92\" cy=\"196\" r=\"10\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/></g><polygon points=\"174.5,155.8 232.8,50.8 234.0,24.0 211.9,39.2 153.5,144.2\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><polygon points=\"174.5,155.8 232.8,50.8 234.0,24.0 164.0,150.0\" fill=\"url(#steelL)\"/><polyline points=\"174.5,155.8 232.8,50.8 234.0,24.0 211.9,39.2 153.5,144.2\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><line x1=\"164.0\" y1=\"150.0\" x2=\"234.0\" y2=\"24.0\" stroke=\"#ffffff\" stroke-width=\"2\" opacity=\".7\"/><g transform=\"rotate(29 164 150)\"><rect x=\"134\" y=\"142\" width=\"60\" height=\"16\" rx=\"7\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4.5\"/>\n<rect x=\"156\" y=\"156\" width=\"16\" height=\"34\" rx=\"5\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"4\"/><circle cx=\"164\" cy=\"196\" r=\"10\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/></g>\n<g><circle cx=\"86\" cy=\"168\" r=\"62\" fill=\"url(#team)\" stroke=\"#24170f\" stroke-width=\"6\"/>\n<circle cx=\"86\" cy=\"168\" r=\"53\" fill=\"none\" stroke=\"url(#goldH)\" stroke-width=\"10\"/><circle cx=\"86\" cy=\"168\" r=\"62\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<circle cx=\"86\" cy=\"168\" r=\"47\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"3\"/>\n<circle cx=\"86\" cy=\"168\" r=\"18.6\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><circle cx=\"79.8\" cy=\"161.8\" r=\"5.0\" fill=\"#fff\"/>\n<path d=\"M47.6 149.4 A42.2 42.2 0 0 1 73.6 127.1\" stroke=\"#fff\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\" opacity=\".6\" filter=\"url(#soft)\"/></g><g><circle cx=\"170\" cy=\"168\" r=\"62\" fill=\"url(#team)\" stroke=\"#24170f\" stroke-width=\"6\"/>\n<circle cx=\"170\" cy=\"168\" r=\"53\" fill=\"none\" stroke=\"url(#goldH)\" stroke-width=\"10\"/><circle cx=\"170\" cy=\"168\" r=\"62\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<circle cx=\"170\" cy=\"168\" r=\"47\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"3\"/>\n<circle cx=\"170\" cy=\"168\" r=\"18.6\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><circle cx=\"163.8\" cy=\"161.8\" r=\"5.0\" fill=\"#fff\"/>\n<path d=\"M131.6 149.4 A42.2 42.2 0 0 1 157.6 127.1\" stroke=\"#fff\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\" opacity=\".6\" filter=\"url(#soft)\"/></g>\n<path d=\"M128 112 V230\" stroke=\"#24170f\" stroke-width=\"5\" opacity=\".5\"/></g></svg>", "manufacture": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"stone\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#d6d2c8\"/><stop offset=\".55\" stop-color=\"#9a958a\"/><stop offset=\"1\" stop-color=\"#5e5a52\"/></linearGradient>\n<linearGradient id=\"stoneH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#6a665e\"/><stop offset=\".4\" stop-color=\"#c8c4ba\"/><stop offset=\"1\" stop-color=\"#7a766c\"/></linearGradient>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<linearGradient id=\"violet\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c9a8ff\"/><stop offset=\".5\" stop-color=\"#7a4ad8\"/><stop offset=\"1\" stop-color=\"#3a1a80\"/></linearGradient>\n<linearGradient id=\"cloud\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8eef8\"/><stop offset=\".55\" stop-color=\"#8e9cb8\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe03a\"/><stop offset=\"1\" stop-color=\"#e09a0a\"/></linearGradient>\n<linearGradient id=\"brass\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffe2a0\"/><stop offset=\".4\" stop-color=\"#d8a04a\"/><stop offset=\".8\" stop-color=\"#9a6420\"/><stop offset=\"1\" stop-color=\"#5e3a10\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd8a0\"/><stop offset=\".4\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8f0ff\"/><stop offset=\".5\" stop-color=\"#8fa2bc\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"team\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#8cc4ff\"/><stop offset=\".5\" stop-color=\"#1c74e0\"/><stop offset=\"1\" stop-color=\"#0c3a80\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><path d=\"M150 22 h30 v70 h-30 Z\" fill=\"url(#stoneH)\" stroke=\"#24170f\" stroke-width=\"5\"/><rect x=\"144\" y=\"14\" width=\"42\" height=\"14\" rx=\"4\" fill=\"url(#stone)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<circle cx=\"176\" cy=\"8\" r=\"9\" fill=\"#dfe8f2\" opacity=\".8\" filter=\"url(#soft)\"/><circle cx=\"196\" cy=\"0\" r=\"12\" fill=\"#dfe8f2\" opacity=\".6\" filter=\"url(#soft)\"/>\n<path d=\"M28 108 L72 80 V108 L116 80 V108 L160 80 V108 L204 80 V214 H28 Z\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M28 108 L72 80 V108 L116 80 V108 L160 80 V108 L204 80\" fill=\"none\" stroke=\"url(#goldH)\" stroke-width=\"8\" stroke-linejoin=\"round\"/>\n<path d=\"M28 108 L72 80 V108 L116 80 V108 L160 80 V108 L204 80\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"3\" stroke-linejoin=\"round\" transform=\"translate(0 6)\" opacity=\".5\"/>\n<rect x=\"44\" y=\"128\" width=\"40\" height=\"30\" rx=\"5\" fill=\"#ffe680\" stroke=\"#24170f\" stroke-width=\"4\"/><rect x=\"100\" y=\"128\" width=\"40\" height=\"30\" rx=\"5\" fill=\"#ffe680\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<path d=\"M50 134 h12\" stroke=\"#fff\" stroke-width=\"4\" stroke-linecap=\"round\"/><path d=\"M106 134 h12\" stroke=\"#fff\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n<rect x=\"148\" y=\"150\" width=\"56\" height=\"64\" rx=\"4\" fill=\"#2a1a10\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<g transform=\"translate(170 76)\"><circle r=\"26\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"5\"/><rect x=\"-6\" y=\"-36\" width=\"12\" height=\"14\" rx=\"3\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"3\" transform=\"rotate(0)\"/><rect x=\"-6\" y=\"-36\" width=\"12\" height=\"14\" rx=\"3\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"3\" transform=\"rotate(45)\"/><rect x=\"-6\" y=\"-36\" width=\"12\" height=\"14\" rx=\"3\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"3\" transform=\"rotate(90)\"/><rect x=\"-6\" y=\"-36\" width=\"12\" height=\"14\" rx=\"3\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"3\" transform=\"rotate(135)\"/><rect x=\"-6\" y=\"-36\" width=\"12\" height=\"14\" rx=\"3\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"3\" transform=\"rotate(180)\"/><rect x=\"-6\" y=\"-36\" width=\"12\" height=\"14\" rx=\"3\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"3\" transform=\"rotate(225)\"/><rect x=\"-6\" y=\"-36\" width=\"12\" height=\"14\" rx=\"3\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"3\" transform=\"rotate(270)\"/><rect x=\"-6\" y=\"-36\" width=\"12\" height=\"14\" rx=\"3\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"3\" transform=\"rotate(315)\"/><circle r=\"9\" fill=\"url(#gem)\" stroke=\"#161c33\" stroke-width=\"3\"/></g>\n<g transform=\"translate(196 196)\"><rect x=\"-26\" y=\"-34\" width=\"52\" height=\"40\" rx=\"10\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"5\"/>\n<circle cx=\"-10\" cy=\"-16\" r=\"7\" fill=\"#7fe8ff\" stroke=\"#161c33\" stroke-width=\"3\"/><circle cx=\"12\" cy=\"-16\" r=\"7\" fill=\"#7fe8ff\" stroke=\"#161c33\" stroke-width=\"3\"/>\n<path d=\"M0 -34 V-48\" stroke=\"#161c33\" stroke-width=\"4\"/><circle cx=\"0\" cy=\"-52\" r=\"6\" fill=\"url(#red)\" stroke=\"#24170f\" stroke-width=\"3\"/>\n<rect x=\"-30\" y=\"4\" width=\"60\" height=\"22\" rx=\"8\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4.5\"/><circle cx=\"-16\" cy=\"28\" r=\"9\" fill=\"#3a3f4a\" stroke=\"#161c33\" stroke-width=\"3.5\"/><circle cx=\"16\" cy=\"28\" r=\"9\" fill=\"#3a3f4a\" stroke=\"#161c33\" stroke-width=\"3.5\"/>\n<path d=\"M-18 -28 h20\" stroke=\"#fff\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\".8\"/></g>\n<g transform=\"translate(86 226) scale(.7)\"><rect x=\"-26\" y=\"-34\" width=\"52\" height=\"40\" rx=\"10\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"6\"/>\n<circle cx=\"-10\" cy=\"-16\" r=\"7\" fill=\"#7fe8ff\" stroke=\"#161c33\" stroke-width=\"3\"/><circle cx=\"12\" cy=\"-16\" r=\"7\" fill=\"#7fe8ff\" stroke=\"#161c33\" stroke-width=\"3\"/><rect x=\"-30\" y=\"4\" width=\"60\" height=\"18\" rx=\"8\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"5\"/></g></g></svg>", "summon": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"stone\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#d6d2c8\"/><stop offset=\".55\" stop-color=\"#9a958a\"/><stop offset=\"1\" stop-color=\"#5e5a52\"/></linearGradient>\n<linearGradient id=\"stoneH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#6a665e\"/><stop offset=\".4\" stop-color=\"#c8c4ba\"/><stop offset=\"1\" stop-color=\"#7a766c\"/></linearGradient>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<linearGradient id=\"violet\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c9a8ff\"/><stop offset=\".5\" stop-color=\"#7a4ad8\"/><stop offset=\"1\" stop-color=\"#3a1a80\"/></linearGradient>\n<linearGradient id=\"cloud\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8eef8\"/><stop offset=\".55\" stop-color=\"#8e9cb8\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe03a\"/><stop offset=\"1\" stop-color=\"#e09a0a\"/></linearGradient>\n<linearGradient id=\"brass\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffe2a0\"/><stop offset=\".4\" stop-color=\"#d8a04a\"/><stop offset=\".8\" stop-color=\"#9a6420\"/><stop offset=\"1\" stop-color=\"#5e3a10\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd8a0\"/><stop offset=\".4\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8f0ff\"/><stop offset=\".5\" stop-color=\"#8fa2bc\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"team\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#8cc4ff\"/><stop offset=\".5\" stop-color=\"#1c74e0\"/><stop offset=\"1\" stop-color=\"#0c3a80\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><ellipse cx=\"128\" cy=\"204\" rx=\"112\" ry=\"40\" fill=\"url(#arc)\" opacity=\".9\"/>\n<ellipse cx=\"128\" cy=\"204\" rx=\"96\" ry=\"30\" fill=\"none\" stroke=\"#e8b8ff\" stroke-width=\"5\"/><ellipse cx=\"128\" cy=\"204\" rx=\"74\" ry=\"22\" fill=\"none\" stroke=\"#b46aff\" stroke-width=\"3\" stroke-dasharray=\"10 8\"/>\n<path d=\"M84 200 L92 70 H164 L172 200 Z\" fill=\"url(#stoneH)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M78 76 V44 H98 V58 H116 V44 H140 V58 H158 V44 H178 V76 Z\" fill=\"url(#stone)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<g stroke=\"#4a463e\" stroke-width=\"3\" opacity=\".6\"><path d=\"M90 110 H166 M88 150 H168 M110 76 V110 M146 110 V150 M118 150 V196\"/></g>\n<path d=\"M114 196 V164 A14 14 0 0 1 142 164 V196 Z\" fill=\"#22140a\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<rect x=\"116\" y=\"96\" width=\"24\" height=\"30\" rx=\"10\" fill=\"#c37aff\" stroke=\"#24170f\" stroke-width=\"4\"/><circle cx=\"124\" cy=\"104\" r=\"4\" fill=\"#fff\"/>\n<path d=\"M98 84 Q94 140 100 190\" stroke=\"#fff\" stroke-width=\"7\" fill=\"none\" opacity=\".45\" filter=\"url(#soft)\"/>\n<path d=\"M84 198 H172\" stroke=\"#f4d8ff\" stroke-width=\"10\" stroke-linecap=\"round\" opacity=\".8\" filter=\"url(#soft)\"/>\n<g fill=\"#fff\"><path d=\"M44 120 l5 12 12 5 -12 5 -5 12 -5 -12 -12 -5 12 -5 Z\"/><path d=\"M208 96 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4 Z\"/><path d=\"M196 168 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 Z\"/></g></g></svg>", "nobility": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"stone\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#d6d2c8\"/><stop offset=\".55\" stop-color=\"#9a958a\"/><stop offset=\"1\" stop-color=\"#5e5a52\"/></linearGradient>\n<linearGradient id=\"stoneH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#6a665e\"/><stop offset=\".4\" stop-color=\"#c8c4ba\"/><stop offset=\"1\" stop-color=\"#7a766c\"/></linearGradient>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<linearGradient id=\"violet\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c9a8ff\"/><stop offset=\".5\" stop-color=\"#7a4ad8\"/><stop offset=\"1\" stop-color=\"#3a1a80\"/></linearGradient>\n<linearGradient id=\"cloud\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8eef8\"/><stop offset=\".55\" stop-color=\"#8e9cb8\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe03a\"/><stop offset=\"1\" stop-color=\"#e09a0a\"/></linearGradient>\n<linearGradient id=\"brass\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffe2a0\"/><stop offset=\".4\" stop-color=\"#d8a04a\"/><stop offset=\".8\" stop-color=\"#9a6420\"/><stop offset=\"1\" stop-color=\"#5e3a10\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd8a0\"/><stop offset=\".4\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8f0ff\"/><stop offset=\".5\" stop-color=\"#8fa2bc\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"team\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#8cc4ff\"/><stop offset=\".5\" stop-color=\"#1c74e0\"/><stop offset=\"1\" stop-color=\"#0c3a80\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><ellipse cx=\"26.0\" cy=\"8.0\" rx=\"13\" ry=\"8\" transform=\"rotate(59 26.0 8.0)\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"10\"/><ellipse cx=\"26.0\" cy=\"8.0\" rx=\"13\" ry=\"8\" transform=\"rotate(59 26.0 8.0)\" fill=\"none\" stroke=\"url(#gold)\" stroke-width=\"5\"/><ellipse cx=\"44.5\" cy=\"35.8\" rx=\"13\" ry=\"8\" transform=\"rotate(143 44.5 35.8)\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"10\"/><ellipse cx=\"44.5\" cy=\"35.8\" rx=\"13\" ry=\"8\" transform=\"rotate(143 44.5 35.8)\" fill=\"none\" stroke=\"url(#gold)\" stroke-width=\"5\"/><ellipse cx=\"63.1\" cy=\"58.0\" rx=\"13\" ry=\"8\" transform=\"rotate(46 63.1 58.0)\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"10\"/><ellipse cx=\"63.1\" cy=\"58.0\" rx=\"13\" ry=\"8\" transform=\"rotate(46 63.1 58.0)\" fill=\"none\" stroke=\"url(#gold)\" stroke-width=\"5\"/><ellipse cx=\"81.6\" cy=\"74.6\" rx=\"13\" ry=\"8\" transform=\"rotate(127 81.6 74.6)\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"10\"/><ellipse cx=\"81.6\" cy=\"74.6\" rx=\"13\" ry=\"8\" transform=\"rotate(127 81.6 74.6)\" fill=\"none\" stroke=\"url(#gold)\" stroke-width=\"5\"/><ellipse cx=\"174.4\" cy=\"74.6\" rx=\"13\" ry=\"8\" transform=\"rotate(-37 174.4 74.6)\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"10\"/><ellipse cx=\"174.4\" cy=\"74.6\" rx=\"13\" ry=\"8\" transform=\"rotate(-37 174.4 74.6)\" fill=\"none\" stroke=\"url(#gold)\" stroke-width=\"5\"/><ellipse cx=\"192.9\" cy=\"58.0\" rx=\"13\" ry=\"8\" transform=\"rotate(44 192.9 58.0)\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"10\"/><ellipse cx=\"192.9\" cy=\"58.0\" rx=\"13\" ry=\"8\" transform=\"rotate(44 192.9 58.0)\" fill=\"none\" stroke=\"url(#gold)\" stroke-width=\"5\"/><ellipse cx=\"211.5\" cy=\"35.8\" rx=\"13\" ry=\"8\" transform=\"rotate(-53 211.5 35.8)\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"10\"/><ellipse cx=\"211.5\" cy=\"35.8\" rx=\"13\" ry=\"8\" transform=\"rotate(-53 211.5 35.8)\" fill=\"none\" stroke=\"url(#gold)\" stroke-width=\"5\"/><ellipse cx=\"230.0\" cy=\"8.0\" rx=\"13\" ry=\"8\" transform=\"rotate(31 230.0 8.0)\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"10\"/><ellipse cx=\"230.0\" cy=\"8.0\" rx=\"13\" ry=\"8\" transform=\"rotate(31 230.0 8.0)\" fill=\"none\" stroke=\"url(#gold)\" stroke-width=\"5\"/>\n<circle cx=\"128\" cy=\"160\" r=\"78\" fill=\"url(#brass)\" stroke=\"#24170f\" stroke-width=\"6\"/>\n<circle cx=\"128\" cy=\"160\" r=\"66\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"3.5\"/>\n<circle cx=\"200.0\" cy=\"160.0\" r=\"4.5\" fill=\"#fff2b0\" stroke=\"#24170f\" stroke-width=\"2\"/><circle cx=\"190.4\" cy=\"196.0\" r=\"4.5\" fill=\"#fff2b0\" stroke=\"#24170f\" stroke-width=\"2\"/><circle cx=\"164.0\" cy=\"222.4\" r=\"4.5\" fill=\"#fff2b0\" stroke=\"#24170f\" stroke-width=\"2\"/><circle cx=\"128.0\" cy=\"232.0\" r=\"4.5\" fill=\"#fff2b0\" stroke=\"#24170f\" stroke-width=\"2\"/><circle cx=\"92.0\" cy=\"222.4\" r=\"4.5\" fill=\"#fff2b0\" stroke=\"#24170f\" stroke-width=\"2\"/><circle cx=\"65.7\" cy=\"196.0\" r=\"4.5\" fill=\"#fff2b0\" stroke=\"#24170f\" stroke-width=\"2\"/><circle cx=\"56.0\" cy=\"160.0\" r=\"4.5\" fill=\"#fff2b0\" stroke=\"#24170f\" stroke-width=\"2\"/><circle cx=\"65.6\" cy=\"124.0\" r=\"4.5\" fill=\"#fff2b0\" stroke=\"#24170f\" stroke-width=\"2\"/><circle cx=\"92.0\" cy=\"97.7\" r=\"4.5\" fill=\"#fff2b0\" stroke=\"#24170f\" stroke-width=\"2\"/><circle cx=\"128.0\" cy=\"88.0\" r=\"4.5\" fill=\"#fff2b0\" stroke=\"#24170f\" stroke-width=\"2\"/><circle cx=\"164.0\" cy=\"97.6\" r=\"4.5\" fill=\"#fff2b0\" stroke=\"#24170f\" stroke-width=\"2\"/><circle cx=\"190.3\" cy=\"124.0\" r=\"4.5\" fill=\"#fff2b0\" stroke=\"#24170f\" stroke-width=\"2\"/>\n<circle cx=\"128\" cy=\"160\" r=\"54\" fill=\"url(#earthGem)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<path d=\"M84 186 L114 128 L130 152 L146 126 L176 186 Z\" fill=\"url(#brass)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M114 128 L104 150 L120 146 Z M146 126 L138 144 L152 142 Z\" fill=\"#fff6d0\" opacity=\".85\"/>\n<path d=\"M92 132 Q100 112 124 106\" stroke=\"#fff\" stroke-width=\"9\" fill=\"none\" stroke-linecap=\"round\" opacity=\".55\" filter=\"url(#soft)\"/>\n<rect x=\"114\" y=\"74\" width=\"28\" height=\"18\" rx=\"6\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4.5\"/></g></svg>", "breeding": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"stone\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#d6d2c8\"/><stop offset=\".55\" stop-color=\"#9a958a\"/><stop offset=\"1\" stop-color=\"#5e5a52\"/></linearGradient>\n<linearGradient id=\"stoneH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#6a665e\"/><stop offset=\".4\" stop-color=\"#c8c4ba\"/><stop offset=\"1\" stop-color=\"#7a766c\"/></linearGradient>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<linearGradient id=\"violet\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c9a8ff\"/><stop offset=\".5\" stop-color=\"#7a4ad8\"/><stop offset=\"1\" stop-color=\"#3a1a80\"/></linearGradient>\n<linearGradient id=\"cloud\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8eef8\"/><stop offset=\".55\" stop-color=\"#8e9cb8\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe03a\"/><stop offset=\"1\" stop-color=\"#e09a0a\"/></linearGradient>\n<linearGradient id=\"brass\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffe2a0\"/><stop offset=\".4\" stop-color=\"#d8a04a\"/><stop offset=\".8\" stop-color=\"#9a6420\"/><stop offset=\"1\" stop-color=\"#5e3a10\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd8a0\"/><stop offset=\".4\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8f0ff\"/><stop offset=\".5\" stop-color=\"#8fa2bc\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"team\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#8cc4ff\"/><stop offset=\".5\" stop-color=\"#1c74e0\"/><stop offset=\"1\" stop-color=\"#0c3a80\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><path d=\"M20 120 H236 L214 214 Q128 244 42 214 Z\" fill=\"url(#stone)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<ellipse cx=\"128\" cy=\"120\" rx=\"108\" ry=\"28\" fill=\"url(#ooze)\" stroke=\"#123a06\" stroke-width=\"5\"/>\n<ellipse cx=\"128\" cy=\"120\" rx=\"108\" ry=\"28\" fill=\"none\" stroke=\"url(#stoneH)\" stroke-width=\"12\"/><ellipse cx=\"128\" cy=\"120\" rx=\"114\" ry=\"33\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"128\" cy=\"120\" rx=\"101\" ry=\"23\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"3\"/>\n<g fill=\"#d8ff8a\" stroke=\"#123a06\" stroke-width=\"3\"><circle cx=\"104\" cy=\"118\" r=\"8\"/><circle cx=\"150\" cy=\"124\" r=\"6\"/><circle cx=\"128\" cy=\"112\" r=\"4\"/></g>\n<path d=\"M60 150 Q66 196 92 214\" stroke=\"#fff\" stroke-width=\"7\" fill=\"none\" opacity=\".4\" filter=\"url(#soft)\"/>\n<path d=\"M90 214 q4 16 -4 26 q14 -8 12 -26 Z M170 216 q2 12 -4 20 q12 -6 10 -20 Z\" fill=\"url(#ooze)\" stroke=\"#123a06\" stroke-width=\"3\"/>\n<g transform=\"translate(62 126) scale(1 1)\"><path d=\"M18 46 C22 20 30 0 26 -30 L52 -34 C58 -8 52 22 50 46 Z\" fill=\"url(#ooze)\" stroke=\"#123a06\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<ellipse cx=\"12\" cy=\"-34\" rx=\"34\" ry=\"16\" fill=\"url(#ooze)\" stroke=\"#123a06\" stroke-width=\"5\"/><rect x=\"-26\" y=\"-38\" width=\"12\" height=\"21\" rx=\"6\" fill=\"url(#ooze)\" stroke=\"#123a06\" stroke-width=\"4\"/><rect x=\"-13\" y=\"-38\" width=\"12\" height=\"27\" rx=\"6\" fill=\"url(#ooze)\" stroke=\"#123a06\" stroke-width=\"4\"/><rect x=\"0\" y=\"-38\" width=\"12\" height=\"27\" rx=\"6\" fill=\"url(#ooze)\" stroke=\"#123a06\" stroke-width=\"4\"/><rect x=\"13\" y=\"-38\" width=\"12\" height=\"21\" rx=\"6\" fill=\"url(#ooze)\" stroke=\"#123a06\" stroke-width=\"4\"/>\n<path d=\"M-24 -40 Q0 -50 30 -44\" stroke=\"#f4ffc0\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\" opacity=\".8\"/></g><g transform=\"translate(194 126) scale(-1 1)\"><path d=\"M18 46 C22 20 30 0 26 -30 L52 -34 C58 -8 52 22 50 46 Z\" fill=\"url(#ooze)\" stroke=\"#123a06\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<ellipse cx=\"12\" cy=\"-34\" rx=\"34\" ry=\"16\" fill=\"url(#ooze)\" stroke=\"#123a06\" stroke-width=\"5\"/><rect x=\"-26\" y=\"-38\" width=\"12\" height=\"21\" rx=\"6\" fill=\"url(#ooze)\" stroke=\"#123a06\" stroke-width=\"4\"/><rect x=\"-13\" y=\"-38\" width=\"12\" height=\"27\" rx=\"6\" fill=\"url(#ooze)\" stroke=\"#123a06\" stroke-width=\"4\"/><rect x=\"0\" y=\"-38\" width=\"12\" height=\"27\" rx=\"6\" fill=\"url(#ooze)\" stroke=\"#123a06\" stroke-width=\"4\"/><rect x=\"13\" y=\"-38\" width=\"12\" height=\"21\" rx=\"6\" fill=\"url(#ooze)\" stroke=\"#123a06\" stroke-width=\"4\"/>\n<path d=\"M-24 -40 Q0 -50 30 -44\" stroke=\"#f4ffc0\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\" opacity=\".8\"/></g></g></svg>", "pillar": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"stone\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#d6d2c8\"/><stop offset=\".55\" stop-color=\"#9a958a\"/><stop offset=\"1\" stop-color=\"#5e5a52\"/></linearGradient>\n<linearGradient id=\"stoneH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#6a665e\"/><stop offset=\".4\" stop-color=\"#c8c4ba\"/><stop offset=\"1\" stop-color=\"#7a766c\"/></linearGradient>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<linearGradient id=\"violet\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c9a8ff\"/><stop offset=\".5\" stop-color=\"#7a4ad8\"/><stop offset=\"1\" stop-color=\"#3a1a80\"/></linearGradient>\n<linearGradient id=\"cloud\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8eef8\"/><stop offset=\".55\" stop-color=\"#8e9cb8\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe03a\"/><stop offset=\"1\" stop-color=\"#e09a0a\"/></linearGradient>\n<linearGradient id=\"brass\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffe2a0\"/><stop offset=\".4\" stop-color=\"#d8a04a\"/><stop offset=\".8\" stop-color=\"#9a6420\"/><stop offset=\"1\" stop-color=\"#5e3a10\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd8a0\"/><stop offset=\".4\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8f0ff\"/><stop offset=\".5\" stop-color=\"#8fa2bc\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"team\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#8cc4ff\"/><stop offset=\".5\" stop-color=\"#1c74e0\"/><stop offset=\"1\" stop-color=\"#0c3a80\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><ellipse cx=\"128\" cy=\"214\" rx=\"106\" ry=\"30\" fill=\"#ff7a1a\" opacity=\".55\" filter=\"url(#soft2)\"/>\n<ellipse cx=\"128\" cy=\"214\" rx=\"96\" ry=\"24\" fill=\"#3a1206\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<path d=\"M68 214 C60 160 92 140 84 92 C104 112 104 70 118 20 C130 60 150 52 146 4 C178 52 168 96 184 98 C192 130 198 170 190 214 Z\" fill=\"url(#fireG)\" stroke=\"#5a0e04\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M96 212 C92 176 112 160 108 124 C122 136 124 104 132 74 C140 104 152 110 148 140 C162 150 164 180 160 212 Z\" fill=\"#ffd84a\"/>\n<path d=\"M114 212 C112 188 124 176 126 154 C134 170 144 184 142 212 Z\" fill=\"#fff7c8\"/>\n<g fill=\"url(#fireG)\" stroke=\"#5a0e04\" stroke-width=\"4\"><path d=\"M28 214 C26 196 40 186 38 170 C50 182 56 196 50 214 Z\"/><path d=\"M228 214 C230 196 216 186 218 170 C206 182 200 196 206 214 Z\"/></g>\n<g fill=\"#ffe680\"><circle cx=\"70\" cy=\"70\" r=\"5\"/><circle cx=\"196\" cy=\"58\" r=\"4\"/><circle cx=\"210\" cy=\"130\" r=\"5\"/><circle cx=\"52\" cy=\"130\" r=\"4\"/></g></g></svg>", "fort": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"stone\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#d6d2c8\"/><stop offset=\".55\" stop-color=\"#9a958a\"/><stop offset=\"1\" stop-color=\"#5e5a52\"/></linearGradient>\n<linearGradient id=\"stoneH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#6a665e\"/><stop offset=\".4\" stop-color=\"#c8c4ba\"/><stop offset=\"1\" stop-color=\"#7a766c\"/></linearGradient>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<linearGradient id=\"violet\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c9a8ff\"/><stop offset=\".5\" stop-color=\"#7a4ad8\"/><stop offset=\"1\" stop-color=\"#3a1a80\"/></linearGradient>\n<linearGradient id=\"cloud\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8eef8\"/><stop offset=\".55\" stop-color=\"#8e9cb8\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe03a\"/><stop offset=\"1\" stop-color=\"#e09a0a\"/></linearGradient>\n<linearGradient id=\"brass\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffe2a0\"/><stop offset=\".4\" stop-color=\"#d8a04a\"/><stop offset=\".8\" stop-color=\"#9a6420\"/><stop offset=\"1\" stop-color=\"#5e3a10\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd8a0\"/><stop offset=\".4\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8f0ff\"/><stop offset=\".5\" stop-color=\"#8fa2bc\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"team\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#8cc4ff\"/><stop offset=\".5\" stop-color=\"#1c74e0\"/><stop offset=\"1\" stop-color=\"#0c3a80\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><path d=\"M18 96 V66 H52 V82 H80 V66 H114 V82 H142 V66 H176 V82 H204 V66 H238 V96 Z\" fill=\"url(#stone)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<rect x=\"18\" y=\"94\" width=\"220\" height=\"132\" fill=\"url(#stoneH)\" stroke=\"#24170f\" stroke-width=\"6\"/>\n<g stroke=\"#3e3a32\" stroke-width=\"4\" opacity=\".75\"><path d=\"M18 138 H238 M18 182 H238 M64 94 V138 M128 94 V138 M192 94 V138 M36 138 V182 M96 138 V182 M160 138 V182 M220 138 V182 M64 182 V226 M128 182 V226 M192 182 V226\"/></g>\n<path d=\"M24 100 H232\" stroke=\"#fff\" stroke-width=\"5\" opacity=\".55\" stroke-linecap=\"round\"/>\n<path d=\"M108 182 V150 A20 20 0 0 1 148 150 V226 H108 Z\" fill=\"#24160c\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<rect x=\"104\" y=\"20\" width=\"8\" height=\"70\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"3\"/>\n<path d=\"M112 24 H170 L158 40 L170 56 H112 Z\" fill=\"url(#team)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/><circle cx=\"108\" cy=\"18\" r=\"7\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3\"/></g></svg>", "agolem": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"stone\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#d6d2c8\"/><stop offset=\".55\" stop-color=\"#9a958a\"/><stop offset=\"1\" stop-color=\"#5e5a52\"/></linearGradient>\n<linearGradient id=\"stoneH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#6a665e\"/><stop offset=\".4\" stop-color=\"#c8c4ba\"/><stop offset=\"1\" stop-color=\"#7a766c\"/></linearGradient>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<linearGradient id=\"violet\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c9a8ff\"/><stop offset=\".5\" stop-color=\"#7a4ad8\"/><stop offset=\"1\" stop-color=\"#3a1a80\"/></linearGradient>\n<linearGradient id=\"cloud\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8eef8\"/><stop offset=\".55\" stop-color=\"#8e9cb8\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe03a\"/><stop offset=\"1\" stop-color=\"#e09a0a\"/></linearGradient>\n<linearGradient id=\"brass\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffe2a0\"/><stop offset=\".4\" stop-color=\"#d8a04a\"/><stop offset=\".8\" stop-color=\"#9a6420\"/><stop offset=\"1\" stop-color=\"#5e3a10\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd8a0\"/><stop offset=\".4\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8f0ff\"/><stop offset=\".5\" stop-color=\"#8fa2bc\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"team\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#8cc4ff\"/><stop offset=\".5\" stop-color=\"#1c74e0\"/><stop offset=\"1\" stop-color=\"#0c3a80\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><circle cx=\"128\" cy=\"132\" r=\"104\" fill=\"#a04aff\" opacity=\".35\" filter=\"url(#soft2)\"/>\n<path d=\"M40 210 L52 70 L92 38 H164 L204 70 L216 210 Z\" fill=\"url(#stone)\" stroke=\"#24170f\" stroke-width=\"7\" stroke-linejoin=\"round\"/>\n<path d=\"M52 70 L92 38 H164 L204 70 L180 92 H76 Z\" fill=\"#cfcac0\" stroke=\"#24170f\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M66 116 L112 106 L108 134 L70 138 Z\" fill=\"#1a0a30\" stroke=\"#24170f\" stroke-width=\"4\"/><path d=\"M190 116 L144 106 L148 134 L186 138 Z\" fill=\"#1a0a30\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<ellipse cx=\"90\" cy=\"122\" rx=\"14\" ry=\"8\" fill=\"#f0c8ff\"/><ellipse cx=\"166\" cy=\"122\" rx=\"14\" ry=\"8\" fill=\"#f0c8ff\"/>\n<ellipse cx=\"90\" cy=\"122\" rx=\"26\" ry=\"16\" fill=\"#c06aff\" opacity=\".6\" filter=\"url(#soft)\"/><ellipse cx=\"166\" cy=\"122\" rx=\"26\" ry=\"16\" fill=\"#c06aff\" opacity=\".6\" filter=\"url(#soft)\"/>\n<path d=\"M88 172 H168 L156 196 H100 Z\" fill=\"#2a1a3a\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<path d=\"M128 46 V72 M118 58 H138\" stroke=\"#e6b8ff\" stroke-width=\"6\" stroke-linecap=\"round\"/>\n<g stroke=\"#c784ff\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"><path d=\"M56 150 l14 10 -6 16 M200 150 l-14 10 6 16 M118 150 l10 8 10 -8\"/></g>\n<path d=\"M60 96 Q56 150 62 200\" stroke=\"#fff\" stroke-width=\"8\" fill=\"none\" opacity=\".45\" filter=\"url(#soft)\"/></g></svg>", "monsun": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"stone\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#d6d2c8\"/><stop offset=\".55\" stop-color=\"#9a958a\"/><stop offset=\"1\" stop-color=\"#5e5a52\"/></linearGradient>\n<linearGradient id=\"stoneH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#6a665e\"/><stop offset=\".4\" stop-color=\"#c8c4ba\"/><stop offset=\"1\" stop-color=\"#7a766c\"/></linearGradient>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<linearGradient id=\"violet\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c9a8ff\"/><stop offset=\".5\" stop-color=\"#7a4ad8\"/><stop offset=\"1\" stop-color=\"#3a1a80\"/></linearGradient>\n<linearGradient id=\"cloud\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8eef8\"/><stop offset=\".55\" stop-color=\"#8e9cb8\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe03a\"/><stop offset=\"1\" stop-color=\"#e09a0a\"/></linearGradient>\n<linearGradient id=\"brass\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffe2a0\"/><stop offset=\".4\" stop-color=\"#d8a04a\"/><stop offset=\".8\" stop-color=\"#9a6420\"/><stop offset=\"1\" stop-color=\"#5e3a10\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd8a0\"/><stop offset=\".4\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8f0ff\"/><stop offset=\".5\" stop-color=\"#8fa2bc\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"team\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#8cc4ff\"/><stop offset=\".5\" stop-color=\"#1c74e0\"/><stop offset=\"1\" stop-color=\"#0c3a80\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><g stroke=\"#bfe6ff\" stroke-width=\"9\" fill=\"none\" stroke-linecap=\"round\" opacity=\".85\"><path d=\"M18 196 Q70 176 112 196 T200 190\"/><path d=\"M40 226 Q96 208 150 226 T238 220\"/></g>\n<path d=\"M46 118 A38 38 0 0 1 84 70 A50 50 0 0 1 176 62 A40 40 0 0 1 224 112 A30 30 0 0 1 206 148 H58 A30 30 0 0 1 46 118 Z\" fill=\"url(#cloud)\" stroke=\"#161c33\" stroke-width=\"7\" stroke-linejoin=\"round\"/>\n<path d=\"M88 78 Q110 54 150 62\" stroke=\"#fff\" stroke-width=\"10\" fill=\"none\" stroke-linecap=\"round\" opacity=\".75\" filter=\"url(#soft)\"/>\n<path d=\"M132 120 L100 182 H128 L108 246 L178 160 H148 L172 120 Z\" fill=\"url(#bolt)\" stroke=\"#5a3a06\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M140 128 L118 174\" stroke=\"#fff\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\".9\"/>\n<g fill=\"#9fd8ff\" stroke=\"#161c33\" stroke-width=\"3\"><path d=\"M66 160 q-6 12 0 18 q6 -6 0 -18 Z\"/><path d=\"M200 162 q-6 12 0 18 q6 -6 0 -18 Z\"/><path d=\"M84 176 q-5 10 0 15 q5 -5 0 -15 Z\"/></g></g></svg>", "owl": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><g stroke=\"#2a2e36\" stroke-width=\"3\" stroke-linejoin=\"round\">\n<circle cx=\"128\" cy=\"132\" r=\"112\" fill=\"url(#greyDisk)\"/>\n<g fill=\"url(#greyFeather)\" stroke-width=\"2.4\">\n<path d=\"M128 24 l14 40 -14 10 -14 -10z\"/><path d=\"M40 70 l40 22 -4 16 -16 2z\" transform=\"rotate(-4 128 132)\"/><path d=\"M216 70 l-40 22 4 16 16 2z\" transform=\"rotate(4 128 132)\"/>\n<path d=\"M22 140 l46 -6 6 14 -10 12z\"/><path d=\"M234 140 l-46 -6 -6 14 10 12z\"/><path d=\"M44 214 l36 -34 12 10 -6 16z\"/><path d=\"M212 214 l-36 -34 -12 10 6 16z\"/><path d=\"M128 246 l-12 -40 12 -8 12 8z\"/></g>\n<path d=\"M30 108 q22 -64 98 -70 q76 6 98 70\" fill=\"none\" stroke=\"#2a2e36\" stroke-width=\"5\"/>\n<path d=\"M40 104 q22 -54 88 -60 q66 6 88 60\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"3\" stroke-opacity=\".8\"/>\n</g>\n<g stroke=\"#2a2e36\" stroke-linejoin=\"round\"><circle cx=\"128\" cy=\"134\" r=\"76\" fill=\"url(#steelB)\" stroke-width=\"4\"/>\n<circle cx=\"128\" cy=\"134\" r=\"64\" fill=\"url(#greyIris)\" stroke-width=\"3\"/></g>\n<g fill=\"none\" stroke=\"#7a8290\" stroke-opacity=\".6\" stroke-width=\"2\"><path d=\"M128 72 v18 M170 92 l-12 12 M190 134 h-18 M170 176 l-12 -12 M128 196 v-18 M86 176 l12 -12 M66 134 h18 M86 92 l12 12\"/></g>\n<circle cx=\"128\" cy=\"134\" r=\"64\" fill=\"url(#shade)\"/>\n<ellipse cx=\"128\" cy=\"136\" rx=\"30\" ry=\"34\" fill=\"url(#pupil)\" stroke=\"#000\" stroke-width=\"2\"/>\n<ellipse cx=\"114\" cy=\"118\" rx=\"11\" ry=\"8\" fill=\"#fff\" transform=\"rotate(-30 114 118)\"/><circle cx=\"142\" cy=\"152\" r=\"4.5\" fill=\"#fff\" fill-opacity=\".75\"/>\n<path d=\"M82 104 q20 -26 52 -28\" fill=\"none\" stroke=\"#fff\" stroke-opacity=\".8\" stroke-width=\"5\" stroke-linecap=\"round\"/>\n<g transform=\"rotate(-34 128 128) translate(0 96)\">\n<rect x=\"-10\" y=\"120\" width=\"210\" height=\"14\" rx=\"6\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"4.5\"/>\n<path d=\"M190 104 L246 127 L190 150 L200 127 Z\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><path d=\"M190 104 L246 127 L200 127 Z\" fill=\"url(#steelL)\"/>\n<path d=\"M190 104 L246 127 L190 150 L200 127 Z\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M-6 120 L22 120 L10 100 L-18 100 Z M-6 134 L22 134 L10 154 L-18 154 Z\" fill=\"url(#red)\" stroke=\"#24170f\" stroke-width=\"4\" stroke-linejoin=\"round\"/></g></g></svg>", "slave": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"redb\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff8a6a\"/><stop offset=\".45\" stop-color=\"#d82a14\"/><stop offset=\"1\" stop-color=\"#6a0a04\"/></linearGradient>\n<linearGradient id=\"waterG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e4f8ff\"/><stop offset=\".4\" stop-color=\"#5ec8ff\"/><stop offset=\"1\" stop-color=\"#0a4a9a\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe23a\"/><stop offset=\"1\" stop-color=\"#e08a0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient><linearGradient id=\"iron\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#d6dde6\"/><stop offset=\".45\" stop-color=\"#7c8794\"/><stop offset=\"1\" stop-color=\"#333b46\"/></linearGradient>\n<radialGradient id=\"tox\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#eaffb0\"/><stop offset=\".35\" stop-color=\"#9fe83a\"/><stop offset=\".8\" stop-color=\"#3f8a10\"/><stop offset=\"1\" stop-color=\"#1c4206\"/></radialGradient>\n<radialGradient id=\"aqua\" cx=\".38\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#e6fbff\"/><stop offset=\".3\" stop-color=\"#7fdcff\"/><stop offset=\".75\" stop-color=\"#1f86d8\"/><stop offset=\"1\" stop-color=\"#0b3a7a\"/></radialGradient>\n</defs>\n<g filter=\"url(#drop)\">\n<path d=\"M52 206 L190 68 L204 82 L66 220 Z\" fill=\"url(#wood)\" stroke=\"#2a1608\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M120 52 Q186 22 238 92 L224 104 Q184 58 132 68 Z\" fill=\"url(#steelL)\" stroke=\"#1d2530\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M134 54 Q180 36 218 78\" stroke=\"#fff\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\" opacity=\".85\"/>\n<rect x=\"182\" y=\"62\" width=\"26\" height=\"26\" rx=\"5\" transform=\"rotate(45 195 75)\" fill=\"url(#iron)\" stroke=\"#1d2530\" stroke-width=\"5\"/>\n<circle cx=\"78\" cy=\"160\" r=\"34\" fill=\"none\" stroke=\"#1d2530\" stroke-width=\"22\"/>\n<circle cx=\"78\" cy=\"160\" r=\"34\" fill=\"none\" stroke=\"url(#iron)\" stroke-width=\"12\"/>\n<circle cx=\"178\" cy=\"182\" r=\"34\" fill=\"none\" stroke=\"#1d2530\" stroke-width=\"22\"/>\n<circle cx=\"178\" cy=\"182\" r=\"34\" fill=\"none\" stroke=\"url(#iron)\" stroke-width=\"12\"/>\n<ellipse cx=\"116\" cy=\"186\" rx=\"13\" ry=\"8\" transform=\"rotate(20 116 186)\" fill=\"none\" stroke=\"#1d2530\" stroke-width=\"11\"/>\n<ellipse cx=\"116\" cy=\"186\" rx=\"13\" ry=\"8\" transform=\"rotate(20 116 186)\" fill=\"none\" stroke=\"url(#iron)\" stroke-width=\"5\"/>\n<ellipse cx=\"138\" cy=\"194\" rx=\"13\" ry=\"8\" transform=\"rotate(-10 138 194)\" fill=\"none\" stroke=\"#1d2530\" stroke-width=\"11\"/>\n<ellipse cx=\"138\" cy=\"194\" rx=\"13\" ry=\"8\" transform=\"rotate(-10 138 194)\" fill=\"none\" stroke=\"url(#iron)\" stroke-width=\"5\"/>\n<path d=\"M54 138 Q70 124 92 128 M156 160 Q170 148 192 152\" stroke=\"#fff\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\" opacity=\".75\"/>\n<circle cx=\"78\" cy=\"196\" r=\"13\" fill=\"url(#tox)\" stroke=\"#173a04\" stroke-width=\"4\"/><circle cx=\"74\" cy=\"192\" r=\"4\" fill=\"#fff\" opacity=\".85\"/>\n<circle cx=\"178\" cy=\"218\" r=\"13\" fill=\"url(#tox)\" stroke=\"#173a04\" stroke-width=\"4\"/><circle cx=\"174\" cy=\"214\" r=\"4\" fill=\"#fff\" opacity=\".85\"/>\n</g></svg>", "guardian": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"redb\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff8a6a\"/><stop offset=\".45\" stop-color=\"#d82a14\"/><stop offset=\"1\" stop-color=\"#6a0a04\"/></linearGradient>\n<linearGradient id=\"waterG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e4f8ff\"/><stop offset=\".4\" stop-color=\"#5ec8ff\"/><stop offset=\"1\" stop-color=\"#0a4a9a\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe23a\"/><stop offset=\"1\" stop-color=\"#e08a0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient><linearGradient id=\"iron\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#d6dde6\"/><stop offset=\".45\" stop-color=\"#7c8794\"/><stop offset=\"1\" stop-color=\"#333b46\"/></linearGradient>\n<radialGradient id=\"tox\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#eaffb0\"/><stop offset=\".35\" stop-color=\"#9fe83a\"/><stop offset=\".8\" stop-color=\"#3f8a10\"/><stop offset=\"1\" stop-color=\"#1c4206\"/></radialGradient>\n<radialGradient id=\"aqua\" cx=\".38\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#e6fbff\"/><stop offset=\".3\" stop-color=\"#7fdcff\"/><stop offset=\".75\" stop-color=\"#1f86d8\"/><stop offset=\"1\" stop-color=\"#0b3a7a\"/></radialGradient>\n</defs>\n<g filter=\"url(#drop)\">\n<circle cx=\"128\" cy=\"132\" r=\"96\" fill=\"url(#aqua)\" stroke=\"#0a2a5a\" stroke-width=\"7\" opacity=\".95\"/>\n<path d=\"M50 120 Q70 100 92 118 Q114 136 136 118 Q158 100 180 118 Q196 130 208 120\" stroke=\"#ffffff\" stroke-width=\"8\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M56 160 Q76 144 98 160 Q120 176 142 160 Q164 144 186 160 Q196 166 202 162\" stroke=\"#c8f2ff\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M128 70 L170 86 L166 138 Q160 172 128 190 Q96 172 90 138 L86 86 Z\" fill=\"url(#gold)\" stroke=\"#5a3204\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M128 84 L158 96 L155 136 Q150 162 128 176 Q106 162 101 136 L98 96 Z\" fill=\"url(#aqua)\" stroke=\"#5a3204\" stroke-width=\"3\"/>\n<circle cx=\"128\" cy=\"126\" r=\"13\" fill=\"url(#gem)\" stroke=\"#0a2470\" stroke-width=\"3\"/>\n<circle cx=\"123\" cy=\"121\" r=\"4\" fill=\"#fff\" opacity=\".9\"/>\n<path d=\"M66 70 Q96 44 132 40\" stroke=\"#fff\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\" opacity=\".75\"/>\n</g></svg>", "quarry": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"stone\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#d6d2c8\"/><stop offset=\".55\" stop-color=\"#9a958a\"/><stop offset=\"1\" stop-color=\"#5e5a52\"/></linearGradient>\n<linearGradient id=\"stoneH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#6a665e\"/><stop offset=\".4\" stop-color=\"#c8c4ba\"/><stop offset=\"1\" stop-color=\"#7a766c\"/></linearGradient>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<linearGradient id=\"violet\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c9a8ff\"/><stop offset=\".5\" stop-color=\"#7a4ad8\"/><stop offset=\"1\" stop-color=\"#3a1a80\"/></linearGradient>\n<linearGradient id=\"cloud\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8eef8\"/><stop offset=\".55\" stop-color=\"#8e9cb8\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe03a\"/><stop offset=\"1\" stop-color=\"#e09a0a\"/></linearGradient>\n<linearGradient id=\"brass\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffe2a0\"/><stop offset=\".4\" stop-color=\"#d8a04a\"/><stop offset=\".8\" stop-color=\"#9a6420\"/><stop offset=\"1\" stop-color=\"#5e3a10\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd8a0\"/><stop offset=\".4\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8f0ff\"/><stop offset=\".5\" stop-color=\"#8fa2bc\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<linearGradient id=\"waterG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e4f8ff\"/><stop offset=\".4\" stop-color=\"#5ec8ff\"/><stop offset=\"1\" stop-color=\"#0a4a9a\"/></linearGradient>\n<radialGradient id=\"team\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#8cc4ff\"/><stop offset=\".5\" stop-color=\"#1c74e0\"/><stop offset=\"1\" stop-color=\"#0c3a80\"/></radialGradient>\n</defs><g filter=\"url(#drop)\">\n<path d=\"M28 226 C30 196 52 178 80 182 C96 160 128 158 142 176 C162 160 196 166 204 190 C226 192 236 212 230 228 Z\" fill=\"url(#stone)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M60 226 C62 206 78 196 96 200\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"3\" opacity=\".55\"/>\n<path d=\"M142 176 C150 190 150 206 140 226\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"3\" opacity=\".55\"/>\n<path d=\"M188 196 C196 206 200 216 198 228\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"3\" opacity=\".55\"/>\n<path d=\"M44 206 C52 194 66 188 80 190\" stroke=\"#fff\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\" opacity=\"0.7\" filter=\"url(#soft)\"/><path d=\"M150 180 C160 172 178 172 190 182\" stroke=\"#fff\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\" opacity=\"0.6\" filter=\"url(#soft)\"/>\n<polygon points=\"104,214 118,192 140,198 136,222 114,228\" fill=\"url(#earthGem)\" stroke=\"#24170f\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/>\n<polygon points=\"112,212 120,198 132,201\" fill=\"#fff\" opacity=\".55\"/>\n<g transform=\"rotate(-38 128 120)\">\n<rect x=\"118\" y=\"44\" width=\"20\" height=\"170\" rx=\"8\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<rect x=\"114\" y=\"176\" width=\"28\" height=\"16\" rx=\"5\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<path d=\"M26 78 C66 30 190 30 230 78 C192 70 156 72 140 78 L140 92 L116 92 L116 78 C100 72 64 70 26 78 Z\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M40 70 C80 40 176 40 216 70 C184 58 150 56 128 58 C106 56 72 58 40 70 Z\" fill=\"url(#steelL)\"/>\n<rect x=\"110\" y=\"52\" width=\"36\" height=\"40\" rx=\"6\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4.5\"/>\n<circle cx=\"128\" cy=\"72\" r=\"7\" fill=\"url(#gem)\" stroke=\"#24170f\" stroke-width=\"3\"/><circle cx=\"125.5\" cy=\"69.5\" r=\"2.4\" fill=\"#fff\"/>\n<path d=\"M60 56 C90 44 120 42 128 44\" stroke=\"#fff\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\" opacity=\"0.75\" filter=\"url(#soft)\"/>\n</g></g></svg>", "backup": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"stone\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#d6d2c8\"/><stop offset=\".55\" stop-color=\"#9a958a\"/><stop offset=\"1\" stop-color=\"#5e5a52\"/></linearGradient>\n<linearGradient id=\"stoneH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#6a665e\"/><stop offset=\".4\" stop-color=\"#c8c4ba\"/><stop offset=\"1\" stop-color=\"#7a766c\"/></linearGradient>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<linearGradient id=\"violet\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c9a8ff\"/><stop offset=\".5\" stop-color=\"#7a4ad8\"/><stop offset=\"1\" stop-color=\"#3a1a80\"/></linearGradient>\n<linearGradient id=\"cloud\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8eef8\"/><stop offset=\".55\" stop-color=\"#8e9cb8\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe03a\"/><stop offset=\"1\" stop-color=\"#e09a0a\"/></linearGradient>\n<linearGradient id=\"brass\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffe2a0\"/><stop offset=\".4\" stop-color=\"#d8a04a\"/><stop offset=\".8\" stop-color=\"#9a6420\"/><stop offset=\"1\" stop-color=\"#5e3a10\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd8a0\"/><stop offset=\".4\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8f0ff\"/><stop offset=\".5\" stop-color=\"#8fa2bc\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<linearGradient id=\"waterG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e4f8ff\"/><stop offset=\".4\" stop-color=\"#5ec8ff\"/><stop offset=\"1\" stop-color=\"#0a4a9a\"/></linearGradient>\n<radialGradient id=\"team\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#8cc4ff\"/><stop offset=\".5\" stop-color=\"#1c74e0\"/><stop offset=\"1\" stop-color=\"#0c3a80\"/></radialGradient>\n</defs><g filter=\"url(#drop)\">\n<path d=\"M14 100 C10 76 34 62 52 72 C58 42 98 36 112 60 C126 38 164 40 172 68 C190 52 230 62 228 88 C246 92 248 116 232 122 L24 122 C8 120 6 104 14 100 Z\" fill=\"url(#cloud)\" stroke=\"#2a3248\" stroke-width=\"5\" stroke-linejoin=\"round\" opacity=\".93\"/>\n<path d=\"M30 92 C34 78 48 74 58 80\" stroke=\"#fff\" stroke-width=\"6\" fill=\"none\" stroke-linecap=\"round\" opacity=\"0.8\" filter=\"url(#soft)\"/><path d=\"M70 60 C82 46 100 46 108 62\" stroke=\"#fff\" stroke-width=\"6\" fill=\"none\" stroke-linecap=\"round\" opacity=\"0.8\" filter=\"url(#soft)\"/><path d=\"M178 72 C192 64 210 68 216 80\" stroke=\"#fff\" stroke-width=\"6\" fill=\"none\" stroke-linecap=\"round\" opacity=\"0.7\" filter=\"url(#soft)\"/>\n<path d=\"M30 112 H226\" stroke=\"#fff\" stroke-width=\"4\" opacity=\".35\" filter=\"url(#soft)\"/>\n\n<g transform=\"rotate(-26 128 228)\"><rect x=\"121\" y=\"96\" width=\"14\" height=\"140\" rx=\"5\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"4.5\"/>\n<polygon points=\"128,58 146,104 128,96 110,104\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><polygon points=\"128,62 140,100 128,94\" fill=\"url(#steelL)\"/>\n<path d=\"M121 206 L106 232 L121 226 Z M135 206 L150 232 L135 226 Z\" fill=\"url(#feather)\" stroke=\"#24170f\" stroke-width=\"3.5\" stroke-linejoin=\"round\"/></g>\n<g transform=\"rotate(26 128 228)\"><rect x=\"121\" y=\"96\" width=\"14\" height=\"140\" rx=\"5\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"4.5\"/>\n<polygon points=\"128,58 146,104 128,96 110,104\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><polygon points=\"128,62 140,100 128,94\" fill=\"url(#steelL)\"/>\n<path d=\"M121 206 L106 232 L121 226 Z M135 206 L150 232 L135 226 Z\" fill=\"url(#feather)\" stroke=\"#24170f\" stroke-width=\"3.5\" stroke-linejoin=\"round\"/></g>\n<rect x=\"121\" y=\"90\" width=\"14\" height=\"146\" rx=\"5\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"4.5\"/>\n<polygon points=\"128,46 150,100 128,90 106,100\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/><polygon points=\"128,52 144,96 128,88\" fill=\"#fff\" opacity=\".45\"/>\n<path d=\"M121 204 L104 234 L121 226 Z M135 204 L152 234 L135 226 Z\" fill=\"url(#feather)\" stroke=\"#24170f\" stroke-width=\"3.5\" stroke-linejoin=\"round\"/>\n</g></svg>", "tides": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"stone\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#d6d2c8\"/><stop offset=\".55\" stop-color=\"#9a958a\"/><stop offset=\"1\" stop-color=\"#5e5a52\"/></linearGradient>\n<linearGradient id=\"stoneH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#6a665e\"/><stop offset=\".4\" stop-color=\"#c8c4ba\"/><stop offset=\"1\" stop-color=\"#7a766c\"/></linearGradient>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<linearGradient id=\"violet\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c9a8ff\"/><stop offset=\".5\" stop-color=\"#7a4ad8\"/><stop offset=\"1\" stop-color=\"#3a1a80\"/></linearGradient>\n<linearGradient id=\"cloud\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8eef8\"/><stop offset=\".55\" stop-color=\"#8e9cb8\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe03a\"/><stop offset=\"1\" stop-color=\"#e09a0a\"/></linearGradient>\n<linearGradient id=\"brass\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffe2a0\"/><stop offset=\".4\" stop-color=\"#d8a04a\"/><stop offset=\".8\" stop-color=\"#9a6420\"/><stop offset=\"1\" stop-color=\"#5e3a10\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd8a0\"/><stop offset=\".4\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8f0ff\"/><stop offset=\".5\" stop-color=\"#8fa2bc\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<linearGradient id=\"waterG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e4f8ff\"/><stop offset=\".4\" stop-color=\"#5ec8ff\"/><stop offset=\"1\" stop-color=\"#0a4a9a\"/></linearGradient>\n<radialGradient id=\"team\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#8cc4ff\"/><stop offset=\".5\" stop-color=\"#1c74e0\"/><stop offset=\"1\" stop-color=\"#0c3a80\"/></radialGradient>\n</defs><g filter=\"url(#drop)\">\n<g transform=\"translate(0 30) rotate(8 128 120)\">\n<polygon points=\"116,40 140,40 140,170 128,198 116,170\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<polygon points=\"128,40 140,40 140,170 128,198\" fill=\"url(#steelL)\"/>\n<line x1=\"128\" y1=\"44\" x2=\"128\" y2=\"190\" stroke=\"#161c33\" stroke-width=\"2.5\" opacity=\".5\"/>\n<rect x=\"84\" y=\"28\" width=\"88\" height=\"18\" rx=\"8\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4.5\"/>\n<rect x=\"119\" y=\"-6\" width=\"18\" height=\"36\" rx=\"6\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<circle cx=\"128\" cy=\"-12\" r=\"11\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<circle cx=\"128\" cy=\"37\" r=\"6\" fill=\"url(#red)\" stroke=\"#24170f\" stroke-width=\"2.5\"/>\n</g>\n<path d=\"M14 170 C34 150 54 150 72 166 C90 182 110 182 128 166 C146 150 166 150 184 166 C202 182 222 182 242 164 L242 240 L14 240 Z\" fill=\"url(#waterG)\" stroke=\"#0a2a5a\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M14 204 C34 190 54 190 72 202 C90 214 110 214 128 202 C146 190 166 190 184 202 C202 214 222 214 242 200\" fill=\"none\" stroke=\"#e4f8ff\" stroke-width=\"5\" opacity=\".6\"/>\n<path d=\"M24 166 C38 156 52 156 64 164\" stroke=\"#fff\" stroke-width=\"6\" fill=\"none\" stroke-linecap=\"round\" opacity=\"0.85\" filter=\"url(#soft)\"/><path d=\"M138 162 C152 154 166 154 178 162\" stroke=\"#fff\" stroke-width=\"6\" fill=\"none\" stroke-linecap=\"round\" opacity=\"0.8\" filter=\"url(#soft)\"/>\n<circle cx=\"96\" cy=\"150\" r=\"6\" fill=\"#e4f8ff\" stroke=\"#0a2a5a\" stroke-width=\"2.5\"/><circle cx=\"168\" cy=\"142\" r=\"4.5\" fill=\"#e4f8ff\" stroke=\"#0a2a5a\" stroke-width=\"2\"/>\n</g></svg>", "sanction": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"stone\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#d6d2c8\"/><stop offset=\".55\" stop-color=\"#9a958a\"/><stop offset=\"1\" stop-color=\"#5e5a52\"/></linearGradient>\n<linearGradient id=\"stoneH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#6a665e\"/><stop offset=\".4\" stop-color=\"#c8c4ba\"/><stop offset=\"1\" stop-color=\"#7a766c\"/></linearGradient>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<linearGradient id=\"violet\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c9a8ff\"/><stop offset=\".5\" stop-color=\"#7a4ad8\"/><stop offset=\"1\" stop-color=\"#3a1a80\"/></linearGradient>\n<linearGradient id=\"cloud\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8eef8\"/><stop offset=\".55\" stop-color=\"#8e9cb8\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe03a\"/><stop offset=\"1\" stop-color=\"#e09a0a\"/></linearGradient>\n<linearGradient id=\"brass\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffe2a0\"/><stop offset=\".4\" stop-color=\"#d8a04a\"/><stop offset=\".8\" stop-color=\"#9a6420\"/><stop offset=\"1\" stop-color=\"#5e3a10\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd8a0\"/><stop offset=\".4\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8f0ff\"/><stop offset=\".5\" stop-color=\"#8fa2bc\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<linearGradient id=\"waterG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e4f8ff\"/><stop offset=\".4\" stop-color=\"#5ec8ff\"/><stop offset=\"1\" stop-color=\"#0a4a9a\"/></linearGradient>\n<radialGradient id=\"team\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#8cc4ff\"/><stop offset=\".5\" stop-color=\"#1c74e0\"/><stop offset=\"1\" stop-color=\"#0c3a80\"/></radialGradient>\n</defs><g filter=\"url(#drop)\">\n<rect x=\"40\" y=\"40\" width=\"166\" height=\"150\" rx=\"10\" fill=\"url(#parch)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<rect x=\"30\" y=\"28\" width=\"186\" height=\"26\" rx=\"13\" fill=\"url(#roll)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<rect x=\"30\" y=\"178\" width=\"186\" height=\"26\" rx=\"13\" fill=\"url(#roll)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<path d=\"M62 78 H170 M62 98 H182 M62 118 H150\" stroke=\"#8a6a3a\" stroke-width=\"6\" stroke-linecap=\"round\" opacity=\".7\"/>\n<path d=\"M64 150 l14 -14 l14 14 l14 -14\" stroke=\"#7a2a1a\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\" opacity=\".7\"/>\n<path d=\"M44 34 H140\" stroke=\"#fff\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\" opacity=\"0.7\" filter=\"url(#soft)\"/>\n<circle cx=\"72\" cy=\"196\" r=\"20\" fill=\"url(#red)\" stroke=\"#24170f\" stroke-width=\"4.5\"/><circle cx=\"72\" cy=\"196\" r=\"11\" fill=\"none\" stroke=\"#5a0808\" stroke-width=\"3\" opacity=\".7\"/><circle cx=\"66\" cy=\"189\" r=\"4\" fill=\"#fff\" opacity=\".7\"/>\n<path d=\"M60 214 L54 240 L66 232 L72 244 L78 214\" fill=\"url(#red)\" stroke=\"#24170f\" stroke-width=\"3.5\" stroke-linejoin=\"round\"/>\n<path d=\"M156 150 V126 C156 96 210 96 210 126 V150\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"20\" stroke-linecap=\"round\"/>\n<path d=\"M156 150 V126 C156 96 210 96 210 126 V150\" fill=\"none\" stroke=\"url(#steelB)\" stroke-width=\"11\" stroke-linecap=\"round\"/>\n<rect x=\"138\" y=\"142\" width=\"90\" height=\"82\" rx=\"14\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<rect x=\"146\" y=\"150\" width=\"74\" height=\"66\" rx=\"10\" fill=\"none\" stroke=\"#fff2a0\" stroke-width=\"3\" opacity=\".6\"/>\n<circle cx=\"183\" cy=\"176\" r=\"10\" fill=\"#24170f\"/><rect x=\"178\" y=\"180\" width=\"10\" height=\"24\" rx=\"4\" fill=\"#24170f\"/>\n<circle cx=\"168\" cy=\"160\" r=\"5\" fill=\"#fff\" opacity=\".8\"/>\n</g></svg>", "firearrow": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><g transform=\"rotate(40 128 128)\">\n<g transform=\"translate(104 196) rotate(-10) scale(1.05)\"><path d=\"M0 0 C-22 -18 -26 -46 -8 -72 C-8 -52 4 -48 6 -64 C18 -44 26 -18 0 0 Z\" fill=\"url(#fireG)\" stroke=\"#5a1404\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M0 -6 C-10 -16 -10 -32 -2 -44 C0 -30 8 -30 8 -38 C14 -24 12 -12 0 -6 Z\" fill=\"url(#fireCore)\"/></g><g transform=\"translate(152 200) rotate(14) scale(0.95)\"><path d=\"M0 0 C-22 -18 -26 -46 -8 -72 C-8 -52 4 -48 6 -64 C18 -44 26 -18 0 0 Z\" fill=\"url(#fireG)\" stroke=\"#5a1404\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M0 -6 C-10 -16 -10 -32 -2 -44 C0 -30 8 -30 8 -38 C14 -24 12 -12 0 -6 Z\" fill=\"url(#fireCore)\"/></g><g transform=\"translate(128 230) rotate(0) scale(0.8)\"><path d=\"M0 0 C-22 -18 -26 -46 -8 -72 C-8 -52 4 -48 6 -64 C18 -44 26 -18 0 0 Z\" fill=\"url(#fireG)\" stroke=\"#5a1404\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M0 -6 C-10 -16 -10 -32 -2 -44 C0 -30 8 -30 8 -38 C14 -24 12 -12 0 -6 Z\" fill=\"url(#fireCore)\"/></g>\n<rect x=\"114\" y=\"176\" width=\"28\" height=\"74\" rx=\"9\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<rect x=\"114\" y=\"204\" width=\"28\" height=\"10\" fill=\"#2a1408\" opacity=\".55\"/>\n<path d=\"M128 0 C70 40 50 120 84 168 L172 168 C206 120 186 40 128 0 Z\" fill=\"url(#fireG)\" stroke=\"#5a1404\" stroke-width=\"5\" stroke-linejoin=\"round\" opacity=\".95\"/>\n<path d=\"M128 22 C92 56 82 116 104 158 L152 158 C174 116 164 56 128 22 Z\" fill=\"url(#fireCore)\"/>\n<polygon points=\"128,30 188,152 158,142 148,166 108,166 98,142 68,152\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<polygon points=\"128,30 128,166 108,166 98,142 68,152\" fill=\"url(#steelL)\"/>\n<polygon points=\"128,30 188,152 158,142 148,166 108,166 98,142 68,152\" fill=\"#ff8a2a\" opacity=\".22\"/>\n<polygon points=\"128,30 188,152 158,142 148,166 108,166 98,142 68,152\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<line x1=\"128\" y1=\"36\" x2=\"128\" y2=\"160\" stroke=\"#fff4d0\" stroke-width=\"2.5\" opacity=\".85\"/>\n<path d=\"M118 58 L90 132\" stroke=\"#fff\" stroke-width=\"8\" stroke-linecap=\"round\" filter=\"url(#soft)\" opacity=\".85\"/>\n<rect x=\"94\" y=\"156\" width=\"68\" height=\"30\" rx=\"10\" fill=\"url(#goldH)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<path d=\"M100 164 H156\" stroke=\"#fff6b0\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\".8\"/>\n</g><g transform=\"translate(70 70) rotate(-30) scale(0.55)\"><path d=\"M0 0 C-22 -18 -26 -46 -8 -72 C-8 -52 4 -48 6 -64 C18 -44 26 -18 0 0 Z\" fill=\"url(#fireG)\" stroke=\"#5a1404\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M0 -6 C-10 -16 -10 -32 -2 -44 C0 -30 8 -30 8 -38 C14 -24 12 -12 0 -6 Z\" fill=\"url(#fireCore)\"/></g><g transform=\"translate(200 110) rotate(40) scale(0.45)\"><path d=\"M0 0 C-22 -18 -26 -46 -8 -72 C-8 -52 4 -48 6 -64 C18 -44 26 -18 0 0 Z\" fill=\"url(#fireG)\" stroke=\"#5a1404\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M0 -6 C-10 -16 -10 -32 -2 -44 C0 -30 8 -30 8 -38 C14 -24 12 -12 0 -6 Z\" fill=\"url(#fireCore)\"/></g></g></svg>", "voodoo": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><path d=\"M128 6 V40\" stroke=\"#24170f\" stroke-width=\"7\"/><path d=\"M128 6 V40\" stroke=\"#c89a5a\" stroke-width=\"3\"/>\n<circle cx=\"128\" cy=\"14\" r=\"9\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<circle cx=\"128\" cy=\"32\" r=\"8\" fill=\"url(#ooze)\" stroke=\"#1e4a08\" stroke-width=\"3.5\"/>\n<g transform=\"rotate(-20 72 170)\"><path d=\"M72 120 C56 150 58 196 70 226 C82 196 86 150 72 120 Z\" fill=\"url(#feather)\" stroke=\"#161c33\" stroke-width=\"4.5\"/><path d=\"M72 128 V220\" stroke=\"#161c33\" stroke-width=\"3\"/><path d=\"M70 150 l-10 8 M70 172 l-10 8 M70 194 l-10 8\" stroke=\"#9cbbe6\" stroke-width=\"3\"/></g>\n<g transform=\"rotate(22 186 172)\"><path d=\"M186 122 C170 152 172 198 184 228 C196 198 200 152 186 122 Z\" fill=\"url(#green)\" stroke=\"#1e4a08\" stroke-width=\"4.5\"/><path d=\"M186 130 V222\" stroke=\"#1e4a08\" stroke-width=\"3\"/></g>\n<path d=\"M128 44 C162 44 176 70 168 96 C164 106 158 112 152 116 L188 128 C200 132 200 150 188 152 L156 150 L166 214 C168 226 152 232 146 222 L128 182 L110 222 C104 232 88 226 90 214 L100 150 L68 152 C56 150 56 132 68 128 L104 116 C98 112 92 106 88 96 C80 70 94 44 128 44 Z\" fill=\"url(#straw)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<g stroke=\"#7a5420\" stroke-width=\"2.5\" opacity=\".7\" fill=\"none\"><path d=\"M100 60 Q128 52 156 60 M96 80 Q128 72 160 80 M104 132 Q128 126 152 132 M106 160 Q128 154 150 160 M110 186 l10 22 M146 186 l-10 22\"/></g>\n<path d=\"M98 122 H158\" stroke=\"#4a2a10\" stroke-width=\"5\" stroke-dasharray=\"6 6\"/>\n<circle cx=\"112\" cy=\"80\" r=\"11\" fill=\"#2a1a10\" stroke=\"#24170f\" stroke-width=\"3\"/><path d=\"M107 75 l10 10 M117 75 l-10 10\" stroke=\"#e8d0a0\" stroke-width=\"2.5\"/>\n<circle cx=\"144\" cy=\"80\" r=\"11\" fill=\"url(#ooze)\" stroke=\"#1e4a08\" stroke-width=\"3\"/><circle cx=\"141\" cy=\"77\" r=\"3\" fill=\"#fff\"/>\n<path d=\"M114 100 H142\" stroke=\"#2a1408\" stroke-width=\"4\" stroke-linecap=\"round\"/><path d=\"M118 95 v10 M126 95 v10 M134 95 v10\" stroke=\"#2a1408\" stroke-width=\"3\"/>\n<g stroke=\"#161c33\" stroke-width=\"4\" stroke-linecap=\"round\"><path d=\"M150 140 L196 104\"/><path d=\"M110 154 L66 112\"/></g>\n<g stroke=\"#e8f0ff\" stroke-width=\"2\" stroke-linecap=\"round\"><path d=\"M154 136 L194 105\"/><path d=\"M106 150 L68 114\"/></g>\n<circle cx=\"198\" cy=\"102\" r=\"9\" fill=\"url(#red)\" stroke=\"#24170f\" stroke-width=\"3.5\"/><circle cx=\"64\" cy=\"110\" r=\"9\" fill=\"url(#ooze)\" stroke=\"#1e4a08\" stroke-width=\"3.5\"/>\n<path d=\"M96 56 Q90 90 104 112\" stroke=\"#fff\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\" filter=\"url(#soft)\" opacity=\".6\"/></g></svg>", "potion": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><path d=\"M100 22 H156 V70 C200 84 222 120 222 156 C222 210 180 244 128 244 C76 244 34 210 34 156 C34 120 56 84 100 70 Z\" fill=\"url(#glass)\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<clipPath id=\"pc\"><path d=\"M100 22 H156 V70 C200 84 222 120 222 156 C222 210 180 244 128 244 C76 244 34 210 34 156 C34 120 56 84 100 70 Z\"/></clipPath>\n<g clip-path=\"url(#pc)\"><path d=\"M20 128 C60 112 96 140 128 126 C162 112 196 136 236 122 V250 H20 Z\" fill=\"url(#water)\"/>\n<path d=\"M20 128 C60 112 96 140 128 126 C162 112 196 136 236 122\" fill=\"none\" stroke=\"#e8fbff\" stroke-width=\"5\" opacity=\".9\"/>\n<circle cx=\"70\" cy=\"190\" r=\"6\" fill=\"#e8fbff\" opacity=\".7\"/><circle cx=\"188\" cy=\"176\" r=\"4\" fill=\"#e8fbff\" opacity=\".7\"/><circle cx=\"170\" cy=\"214\" r=\"7\" fill=\"#e8fbff\" opacity=\".5\"/></g>\n<path d=\"M100 22 H156 V70 C200 84 222 120 222 156 C222 210 180 244 128 244 C76 244 34 210 34 156 C34 120 56 84 100 70 Z\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<rect x=\"92\" y=\"8\" width=\"72\" height=\"32\" rx=\"8\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<rect x=\"94\" y=\"40\" width=\"68\" height=\"12\" rx=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<path d=\"M70 110 Q58 150 72 196\" stroke=\"#fff\" stroke-width=\"10\" fill=\"none\" stroke-linecap=\"round\" filter=\"url(#soft)\" opacity=\".75\"/>\n<g transform=\"rotate(-6 132 176)\"><path d=\"M84 146 H184 L178 210 H90 Z\" fill=\"url(#parch)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M134 202 C110 186 98 174 98 162 C98 150 108 144 118 144 C126 144 132 150 134 156 C136 150 142 144 150 144 C160 144 170 150 170 162 C170 174 158 186 134 202 Z\" fill=\"url(#blueHeart)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/>\n<path d=\"M110 156 Q114 150 122 151\" stroke=\"#fff\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/></g></g></svg>", "vault": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><rect x=\"18\" y=\"14\" width=\"220\" height=\"210\" rx=\"22\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"6\"/>\n<rect x=\"30\" y=\"26\" width=\"196\" height=\"186\" rx=\"16\" fill=\"none\" stroke=\"#e8f0ff\" stroke-width=\"3\" opacity=\".6\"/>\n<circle cx=\"128\" cy=\"116\" r=\"104\" fill=\"url(#steelR)\" stroke=\"#161c33\" stroke-width=\"6\"/>\n<circle cx=\"128\" cy=\"116\" r=\"92\" fill=\"none\" stroke=\"url(#goldH)\" stroke-width=\"10\"/><circle cx=\"128\" cy=\"116\" r=\"104\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"5\"/>\n<circle cx=\"220.0\" cy=\"116.0\" r=\"8\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3.5\"/><circle cx=\"193.1\" cy=\"181.1\" r=\"8\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3.5\"/><circle cx=\"128.0\" cy=\"208.0\" r=\"8\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3.5\"/><circle cx=\"62.9\" cy=\"181.1\" r=\"8\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3.5\"/><circle cx=\"36.0\" cy=\"116.0\" r=\"8\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3.5\"/><circle cx=\"62.9\" cy=\"50.9\" r=\"8\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3.5\"/><circle cx=\"128.0\" cy=\"24.0\" r=\"8\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3.5\"/><circle cx=\"193.1\" cy=\"50.9\" r=\"8\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3.5\"/>\n<circle cx=\"128\" cy=\"116\" r=\"72\" fill=\"url(#arc)\" opacity=\".85\"/>\n<circle cx=\"128\" cy=\"116\" r=\"62\" fill=\"none\" stroke=\"#e8b8ff\" stroke-width=\"4\" stroke-dasharray=\"14 9\"/>\n<rect x=\"122\" y=\"54\" width=\"12\" height=\"40\" rx=\"5\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"3.5\" transform=\"rotate(0 128 116)\"/><rect x=\"122\" y=\"54\" width=\"12\" height=\"40\" rx=\"5\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"3.5\" transform=\"rotate(60 128 116)\"/><rect x=\"122\" y=\"54\" width=\"12\" height=\"40\" rx=\"5\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"3.5\" transform=\"rotate(120 128 116)\"/><rect x=\"122\" y=\"54\" width=\"12\" height=\"40\" rx=\"5\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"3.5\" transform=\"rotate(180 128 116)\"/><rect x=\"122\" y=\"54\" width=\"12\" height=\"40\" rx=\"5\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"3.5\" transform=\"rotate(240 128 116)\"/><rect x=\"122\" y=\"54\" width=\"12\" height=\"40\" rx=\"5\" fill=\"url(#steelB)\" stroke=\"#161c33\" stroke-width=\"3.5\" transform=\"rotate(300 128 116)\"/>\n<circle cx=\"128\" cy=\"116\" r=\"30\" fill=\"url(#arcGem)\" stroke=\"#161c33\" stroke-width=\"5\"/>\n<path d=\"M128 98 L136 116 L128 134 L120 116 Z\" fill=\"#fff\" opacity=\".85\"/><circle cx=\"118\" cy=\"106\" r=\"5\" fill=\"#fff\"/>\n<path d=\"M60 70 A80 80 0 0 1 112 32\" stroke=\"#fff\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\" opacity=\".7\" filter=\"url(#soft)\"/>\n<g><ellipse cx=\"70\" cy=\"228\" rx=\"30\" ry=\"12.6\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"70\" cy=\"226\" rx=\"18.6\" ry=\"7.2\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".8\"/></g><g><ellipse cx=\"104\" cy=\"214\" rx=\"26\" ry=\"10.9\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"104\" cy=\"212\" rx=\"16.1\" ry=\"6.2\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".8\"/></g><g><ellipse cx=\"186\" cy=\"228\" rx=\"32\" ry=\"13.4\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"186\" cy=\"226\" rx=\"19.8\" ry=\"7.7\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".8\"/></g><g><ellipse cx=\"150\" cy=\"236\" rx=\"24\" ry=\"10.1\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><ellipse cx=\"150\" cy=\"234\" rx=\"14.9\" ry=\"5.8\" fill=\"none\" stroke=\"#fff3a0\" stroke-width=\"2.5\" opacity=\".8\"/></g>\n<g fill=\"#fff\"><path d=\"M214 30 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4 Z\"/><path d=\"M40 168 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 Z\"/></g></g></svg>", "brain": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><circle cx=\"128\" cy=\"124\" r=\"118\" fill=\"url(#plagueGlow)\"/>\n<path d=\"M128 44 C108 30 78 34 68 56 C46 56 32 76 38 98 C22 112 24 140 42 152 C40 178 62 196 86 192 C96 210 118 212 128 200 C138 212 160 210 170 192 C194 196 216 178 214 152 C232 140 234 112 218 98 C224 76 210 56 188 56 C178 34 148 30 128 44 Z\" fill=\"url(#brainG)\" stroke=\"#4a1428\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M128 46 V198\" stroke=\"#7a2a48\" stroke-width=\"5\"/>\n<g fill=\"none\" stroke=\"#a04a68\" stroke-width=\"5\" stroke-linecap=\"round\"><path d=\"M70 78 C86 72 94 86 108 80\"/><path d=\"M52 118 C66 104 80 120 96 110 C104 104 112 112 116 120\"/><path d=\"M68 160 C80 150 96 162 110 152\"/><path d=\"M146 80 C160 72 170 88 186 78\"/><path d=\"M140 118 C152 108 166 122 180 110 C190 104 198 112 206 118\"/><path d=\"M148 158 C162 150 176 164 190 156\"/></g>\n<path d=\"M150 46 C176 40 204 60 200 86 C214 96 220 120 208 134 C200 120 196 104 186 98 C176 84 166 66 150 46 Z\" fill=\"url(#ooze)\" opacity=\".85\" stroke=\"#1e4a08\" stroke-width=\"4\"/>\n<path d=\"M150 150 C170 140 196 150 208 134 C214 156 202 180 182 186 C170 176 160 166 150 150 Z\" fill=\"url(#ooze)\" opacity=\".8\" stroke=\"#1e4a08\" stroke-width=\"4\"/>\n<g fill=\"url(#ooze)\" stroke=\"#1e4a08\" stroke-width=\"3.5\"><path d=\"M176 186 C176 204 168 214 170 226 C172 236 186 236 186 224 C186 212 180 204 176 186 Z\"/><path d=\"M196 172 C200 186 196 194 198 202 C200 210 210 208 210 200 C210 190 204 182 196 172 Z\"/><path d=\"M98 196 C96 210 90 218 92 228 C94 236 106 236 106 226 C106 216 102 208 98 196 Z\"/></g>\n<g fill=\"none\" stroke=\"#c8ff6a\" stroke-width=\"5\" stroke-linecap=\"round\" opacity=\".9\"><path d=\"M30 60 C14 90 24 128 50 136\"/><path d=\"M228 168 C246 140 240 100 214 88\"/><path d=\"M60 214 C84 236 120 240 150 228\"/></g>\n<g fill=\"#e0ff8a\"><circle cx=\"34\" cy=\"92\" r=\"5\"/><circle cx=\"234\" cy=\"140\" r=\"5\"/><circle cx=\"120\" cy=\"236\" r=\"4\"/><circle cx=\"58\" cy=\"44\" r=\"4\"/></g>\n<path d=\"M70 70 C80 56 100 52 112 58\" stroke=\"#fff\" stroke-width=\"8\" fill=\"none\" stroke-linecap=\"round\" opacity=\".7\" filter=\"url(#soft)\"/></g></svg>", "wing": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><g transform=\"translate(46 120) rotate(26)\"><path d=\"M0 0 C30 14.8 27.0 55.5 0 74 C-21.0 59.2 -27.0 18.5 0 0 Z\" fill=\"url(#wingD)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M0 8 V64\" stroke=\"#8aa4cc\" stroke-width=\"2.5\"/></g><g transform=\"translate(78 96) rotate(21)\"><path d=\"M0 0 C30 18.0 27.0 67.5 0 90 C-21.0 72.0 -27.0 22.5 0 0 Z\" fill=\"url(#wingD)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M0 8 V80\" stroke=\"#8aa4cc\" stroke-width=\"2.5\"/></g><g transform=\"translate(110 80) rotate(16)\"><path d=\"M0 0 C30 21.2 27.0 79.5 0 106 C-21.0 84.8 -27.0 26.5 0 0 Z\" fill=\"url(#wingD)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M0 8 V96\" stroke=\"#8aa4cc\" stroke-width=\"2.5\"/></g><g transform=\"translate(142 66) rotate(11)\"><path d=\"M0 0 C30 24.4 27.0 91.5 0 122 C-21.0 97.6 -27.0 30.5 0 0 Z\" fill=\"url(#wingD)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M0 8 V112\" stroke=\"#8aa4cc\" stroke-width=\"2.5\"/></g><g transform=\"translate(172 54) rotate(6)\"><path d=\"M0 0 C30 27.6 27.0 103.5 0 138 C-21.0 110.4 -27.0 34.5 0 0 Z\" fill=\"url(#wingD)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M0 8 V128\" stroke=\"#8aa4cc\" stroke-width=\"2.5\"/></g><g transform=\"translate(200 44) rotate(1)\"><path d=\"M0 0 C30 30.8 27.0 115.5 0 154 C-21.0 123.2 -27.0 38.5 0 0 Z\" fill=\"url(#wingD)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M0 8 V144\" stroke=\"#8aa4cc\" stroke-width=\"2.5\"/></g><g transform=\"translate(224 36) rotate(-4)\"><path d=\"M0 0 C30 34.0 27.0 127.5 0 170 C-21.0 136.0 -27.0 42.5 0 0 Z\" fill=\"url(#wingD)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M0 8 V160\" stroke=\"#8aa4cc\" stroke-width=\"2.5\"/></g><g transform=\"translate(42 128) rotate(20)\"><path d=\"M0 0 C26 10.0 23.4 37.5 0 50 C-18.2 40.0 -23.4 12.5 0 0 Z\" fill=\"url(#wingF)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M0 8 V40\" stroke=\"#8aa4cc\" stroke-width=\"2.5\"/></g><g transform=\"translate(74 104) rotate(16)\"><path d=\"M0 0 C26 11.4 23.4 42.8 0 57 C-18.2 45.6 -23.4 14.2 0 0 Z\" fill=\"url(#wingF)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M0 8 V47\" stroke=\"#8aa4cc\" stroke-width=\"2.5\"/></g><g transform=\"translate(106 88) rotate(12)\"><path d=\"M0 0 C26 12.8 23.4 48.0 0 64 C-18.2 51.2 -23.4 16.0 0 0 Z\" fill=\"url(#wingF)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M0 8 V54\" stroke=\"#8aa4cc\" stroke-width=\"2.5\"/></g><g transform=\"translate(138 74) rotate(8)\"><path d=\"M0 0 C26 14.2 23.4 53.2 0 71 C-18.2 56.8 -23.4 17.8 0 0 Z\" fill=\"url(#wingF)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M0 8 V61\" stroke=\"#8aa4cc\" stroke-width=\"2.5\"/></g><g transform=\"translate(168 62) rotate(4)\"><path d=\"M0 0 C26 15.6 23.4 58.5 0 78 C-18.2 62.4 -23.4 19.5 0 0 Z\" fill=\"url(#wingF)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M0 8 V68\" stroke=\"#8aa4cc\" stroke-width=\"2.5\"/></g><g transform=\"translate(196 52) rotate(0)\"><path d=\"M0 0 C26 17.0 23.4 63.8 0 85 C-18.2 68.0 -23.4 21.2 0 0 Z\" fill=\"url(#wingF)\" stroke=\"#161c33\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/><path d=\"M0 8 V75\" stroke=\"#8aa4cc\" stroke-width=\"2.5\"/></g>\n<path d=\"M30 132 C60 96 120 64 232 30 C236 46 226 56 212 62 C150 82 96 108 52 146 Z\" fill=\"url(#wingF)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M30 132 C60 96 120 64 232 30\" stroke=\"url(#goldH)\" stroke-width=\"12\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M30 132 C60 96 120 64 232 30\" stroke=\"#24170f\" stroke-width=\"3\" fill=\"none\" stroke-linecap=\"round\" opacity=\".55\" transform=\"translate(0 6)\"/>\n<circle cx=\"30\" cy=\"134\" r=\"13\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><circle cx=\"26\" cy=\"130\" r=\"4\" fill=\"#fff\"/>\n<path d=\"M70 120 C110 92 160 72 214 56\" stroke=\"#fff\" stroke-width=\"6\" fill=\"none\" stroke-linecap=\"round\" opacity=\".8\" filter=\"url(#soft)\"/>\n<g stroke=\"#bfe4ff\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\".85\"><path d=\"M8 200 H52\"/><path d=\"M20 226 H70\"/><path d=\"M4 176 H34\"/></g></g></svg>", "breastplate": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><path d=\"M56 34 C76 26 96 40 128 40 C160 40 180 26 200 34 L224 64 C210 82 206 104 210 126 C214 168 196 206 164 226 L128 240 L92 226 C60 206 42 168 46 126 C50 104 46 82 32 64 Z\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M128 40 C96 40 76 26 56 34 L32 64 C46 82 50 104 46 126 C42 168 60 206 92 226 L128 240 Z\" fill=\"url(#steelL)\"/>\n<path d=\"M56 34 C76 26 96 40 128 40 C160 40 180 26 200 34 L224 64 C210 82 206 104 210 126 C214 168 196 206 164 226 L128 240 L92 226 C60 206 42 168 46 126 C50 104 46 82 32 64 Z\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M84 30 C96 60 160 60 172 30\" fill=\"none\" stroke=\"url(#goldH)\" stroke-width=\"12\"/><path d=\"M84 30 C96 60 160 60 172 30\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"3\" opacity=\".6\"/>\n<path d=\"M128 46 V232\" stroke=\"#161c33\" stroke-width=\"3\" opacity=\".45\"/>\n<path d=\"M70 196 C96 214 160 214 186 196\" fill=\"none\" stroke=\"url(#goldH)\" stroke-width=\"9\"/><path d=\"M70 196 C96 214 160 214 186 196\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"2.5\" opacity=\".6\"/>\n<circle cx=\"128\" cy=\"124\" r=\"44\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<circle cx=\"128\" cy=\"124\" r=\"34\" fill=\"url(#earthGem)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<path d=\"M98 140 L118 108 L128 122 L140 100 L160 140 Z\" fill=\"#5a3410\" stroke=\"#2a1404\" stroke-width=\"3.5\" stroke-linejoin=\"round\"/>\n<path d=\"M118 108 L112 120 L122 118 Z M140 100 L134 114 L146 112 Z\" fill=\"#fff2d0\"/>\n<path d=\"M98 140 H160\" stroke=\"#2a1404\" stroke-width=\"4\"/>\n<circle cx=\"116\" cy=\"106\" r=\"4\" fill=\"#fff\" opacity=\".7\"/>\n<path d=\"M58 70 C62 110 56 150 76 190\" stroke=\"#fff\" stroke-width=\"9\" fill=\"none\" stroke-linecap=\"round\" opacity=\".7\" filter=\"url(#soft)\"/>\n<g fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3\"><circle cx=\"62\" cy=\"62\" r=\"6\"/><circle cx=\"194\" cy=\"62\" r=\"6\"/><circle cx=\"74\" cy=\"168\" r=\"5\"/><circle cx=\"182\" cy=\"168\" r=\"5\"/></g></g></svg>", "bloodcontract": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><path d=\"M52 40 H200 V214 H64 Z\" fill=\"url(#parch)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<rect x=\"36\" y=\"22\" width=\"180\" height=\"34\" rx=\"17\" fill=\"url(#roll)\" stroke=\"#24170f\" stroke-width=\"6\"/><circle cx=\"53\" cy=\"39\" r=\"11\" fill=\"#c08a46\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<rect x=\"48\" y=\"198\" width=\"176\" height=\"32\" rx=\"16\" fill=\"url(#roll)\" stroke=\"#24170f\" stroke-width=\"6\"/><circle cx=\"207\" cy=\"214\" r=\"10\" fill=\"#c08a46\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<g stroke=\"#8a5a2a\" stroke-width=\"6\" stroke-linecap=\"round\" opacity=\".55\"><path d=\"M76 82H176M76 104H182M76 126H140\"/></g>\n<path d=\"M78 172 C96 156 110 186 128 166 C140 154 150 170 166 160\" stroke=\"#3a1a0a\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M66 70 Q60 130 72 190\" stroke=\"#fff\" stroke-width=\"8\" fill=\"none\" filter=\"url(#soft)\" opacity=\".7\"/><path d=\"M176 140 C176 160 168 170 170 184 C172 192 182 192 182 184 C182 172 178 160 176 140 Z\" fill=\"url(#red)\" stroke=\"#24170f\" stroke-width=\"3\"/>\n<circle cx=\"170\" cy=\"142\" r=\"30\" fill=\"url(#red)\" stroke=\"#24170f\" stroke-width=\"5\"/><circle cx=\"170\" cy=\"142\" r=\"20\" fill=\"none\" stroke=\"#ffb0a0\" stroke-width=\"3\" opacity=\".8\"/>\n<path d=\"M170 128 C162 140 158 146 160 152 C162 158 178 158 180 152 C182 146 178 140 170 128 Z\" fill=\"#7a0606\"/><circle cx=\"160\" cy=\"132\" r=\"5\" fill=\"#fff\" opacity=\".8\"/></g></svg>", "unholycontract": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n</defs><g filter=\"url(#drop)\"><path d=\"M52 40 H200 V214 H64 Z\" fill=\"url(#parch)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<rect x=\"36\" y=\"22\" width=\"180\" height=\"34\" rx=\"17\" fill=\"url(#roll)\" stroke=\"#24170f\" stroke-width=\"6\"/><circle cx=\"53\" cy=\"39\" r=\"11\" fill=\"#c08a46\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<rect x=\"48\" y=\"198\" width=\"176\" height=\"32\" rx=\"16\" fill=\"url(#roll)\" stroke=\"#24170f\" stroke-width=\"6\"/><circle cx=\"207\" cy=\"214\" r=\"10\" fill=\"#c08a46\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<g stroke=\"#8a5a2a\" stroke-width=\"6\" stroke-linecap=\"round\" opacity=\".55\"><path d=\"M76 82H176M76 104H182M76 126H140\"/></g>\n<path d=\"M78 172 C96 156 110 186 128 166 C140 154 150 170 166 160\" stroke=\"#3a1a0a\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M66 70 Q60 130 72 190\" stroke=\"#fff\" stroke-width=\"8\" fill=\"none\" filter=\"url(#soft)\" opacity=\".7\"/><circle cx=\"170\" cy=\"142\" r=\"34\" fill=\"url(#plagueGlow)\"/>\n<circle cx=\"170\" cy=\"142\" r=\"30\" fill=\"url(#arcGem)\" stroke=\"#24170f\" stroke-width=\"5\"/><circle cx=\"170\" cy=\"142\" r=\"20\" fill=\"none\" stroke=\"#c8ff6a\" stroke-width=\"3\" opacity=\".9\"/>\n<path d=\"M158 140 C158 128 182 128 182 140 C182 148 178 150 176 152 V158 H164 V152 C162 150 158 148 158 140 Z\" fill=\"#f0f4e0\" stroke=\"#1e1430\" stroke-width=\"3\"/>\n<circle cx=\"165\" cy=\"140\" r=\"3.5\" fill=\"#3a8a10\"/><circle cx=\"175\" cy=\"140\" r=\"3.5\" fill=\"#3a8a10\"/><circle cx=\"160\" cy=\"130\" r=\"4\" fill=\"#fff\" opacity=\".8\"/></g></svg>", "leadership": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n<linearGradient id=\"lavaG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4a0\"/><stop offset=\".3\" stop-color=\"#ffb21a\"/><stop offset=\".65\" stop-color=\"#ff4a0a\"/><stop offset=\"1\" stop-color=\"#9a1002\"/></linearGradient>\n<linearGradient id=\"basalt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#6a5a58\"/><stop offset=\".5\" stop-color=\"#3a2e30\"/><stop offset=\"1\" stop-color=\"#1a1214\"/></linearGradient>\n<radialGradient id=\"heartR\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd0c8\"/><stop offset=\".35\" stop-color=\"#e8241a\"/><stop offset=\".8\" stop-color=\"#8a0606\"/><stop offset=\"1\" stop-color=\"#4a0202\"/></radialGradient>\n<linearGradient id=\"banner\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a0a0a\"/><stop offset=\".3\" stop-color=\"#b81c14\"/><stop offset=\".6\" stop-color=\"#d8301e\"/><stop offset=\"1\" stop-color=\"#6a0c0a\"/></linearGradient>\n<linearGradient id=\"iron\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ccd2\"/><stop offset=\".5\" stop-color=\"#7a808a\"/><stop offset=\"1\" stop-color=\"#3a3e46\"/></linearGradient>\n<linearGradient id=\"bronze\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#4a2408\"/><stop offset=\".35\" stop-color=\"#b8682a\"/><stop offset=\".55\" stop-color=\"#f0b070\"/><stop offset=\"1\" stop-color=\"#5a2c0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient>\n</defs><g filter=\"url(#drop)\"><rect x=\"34\" y=\"14\" width=\"188\" height=\"16\" rx=\"8\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<circle cx=\"34\" cy=\"22\" r=\"11\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><circle cx=\"222\" cy=\"22\" r=\"11\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<path d=\"M52 30 H204 V196 L178 176 L154 200 L128 178 L102 200 L78 176 L52 196 Z\" fill=\"url(#banner)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M62 40 H194\" stroke=\"url(#goldH)\" stroke-width=\"7\"/><path d=\"M62 40 V170 M194 40 V170\" stroke=\"#ffcf4a\" stroke-width=\"3\" opacity=\".7\"/>\n<g transform=\"translate(128 98)\">\n<path d=\"M0 -40 C22 -40 36 -24 36 -4 C36 18 20 34 0 38 C-20 34 -36 18 -36 -4 C-36 -24 -22 -40 0 -40 Z\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<g fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3.5\" stroke-linejoin=\"round\"><path d=\"M-36 -10 l-12 -6 6 14 -10 4 14 6 -8 10 14 -2z\"/><path d=\"M36 -10 l12 -6 -6 14 10 4 -14 6 8 10 -14 -2z\"/><path d=\"M-22 -36 l-6 -14 14 6 6 -8 6 12z\"/><path d=\"M22 -36 l6 -14 -14 6 -6 -8 -6 12z\"/></g>\n<path d=\"M-18 -12 L-6 -8 M18 -12 L6 -8\" stroke=\"#24170f\" stroke-width=\"4.5\" stroke-linecap=\"round\"/>\n<ellipse cx=\"0\" cy=\"12\" rx=\"15\" ry=\"12\" fill=\"#ffe7a0\" stroke=\"#24170f\" stroke-width=\"3\"/>\n<path d=\"M-7 3 H7 L0 11 Z\" fill=\"#24170f\"/><path d=\"M0 11 V16 M-9 19 Q0 25 9 19\" stroke=\"#24170f\" stroke-width=\"3.5\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M-22 -22 Q-14 -34 0 -34\" stroke=\"#fff6b0\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\" opacity=\".8\"/></g>\n<path d=\"M70 50 Q62 110 72 170\" stroke=\"#fff\" stroke-width=\"7\" fill=\"none\" filter=\"url(#soft)\" opacity=\".35\"/>\n<g transform=\"translate(78 238) rotate(-26) scale(1.35)\"><path d=\"M0 0 C-22 -18 -26 -46 -8 -72 C-8 -52 4 -48 6 -64 C18 -44 26 -18 0 0 Z\" fill=\"url(#fireG)\" stroke=\"#5a1404\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M0 -6 C-10 -16 -10 -32 -2 -44 C0 -30 8 -30 8 -38 C14 -24 12 -12 0 -6 Z\" fill=\"url(#fireCore)\"/></g><g transform=\"translate(178 238) rotate(26) scale(1.35)\"><path d=\"M0 0 C-22 -18 -26 -46 -8 -72 C-8 -52 4 -48 6 -64 C18 -44 26 -18 0 0 Z\" fill=\"url(#fireG)\" stroke=\"#5a1404\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M0 -6 C-10 -16 -10 -32 -2 -44 C0 -30 8 -30 8 -38 C14 -24 12 -12 0 -6 Z\" fill=\"url(#fireCore)\"/></g><g transform=\"translate(110 246) rotate(-6) scale(1.5)\"><path d=\"M0 0 C-22 -18 -26 -46 -8 -72 C-8 -52 4 -48 6 -64 C18 -44 26 -18 0 0 Z\" fill=\"url(#fireG)\" stroke=\"#5a1404\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M0 -6 C-10 -16 -10 -32 -2 -44 C0 -30 8 -30 8 -38 C14 -24 12 -12 0 -6 Z\" fill=\"url(#fireCore)\"/></g><g transform=\"translate(146 246) rotate(6) scale(1.5)\"><path d=\"M0 0 C-22 -18 -26 -46 -8 -72 C-8 -52 4 -48 6 -64 C18 -44 26 -18 0 0 Z\" fill=\"url(#fireG)\" stroke=\"#5a1404\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M0 -6 C-10 -16 -10 -32 -2 -44 C0 -30 8 -30 8 -38 C14 -24 12 -12 0 -6 Z\" fill=\"url(#fireCore)\"/></g>\n<path d=\"M128 244 C88 218 72 196 72 174 C72 152 90 142 106 142 C118 142 126 150 128 160 C130 150 138 142 150 142 C166 142 184 152 184 174 C184 196 168 218 128 244 Z\" fill=\"url(#heartR)\" stroke=\"#2a0404\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M92 166 Q96 154 110 154\" stroke=\"#fff\" stroke-width=\"6\" fill=\"none\" stroke-linecap=\"round\" opacity=\".85\"/>\n<path d=\"M150 206 C146 214 146 222 150 226 C154 222 154 214 150 206 Z\" fill=\"#ff8a7a\" opacity=\".6\"/></g></svg>", "lavafloor": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n<linearGradient id=\"lavaG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4a0\"/><stop offset=\".3\" stop-color=\"#ffb21a\"/><stop offset=\".65\" stop-color=\"#ff4a0a\"/><stop offset=\"1\" stop-color=\"#9a1002\"/></linearGradient>\n<linearGradient id=\"basalt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#6a5a58\"/><stop offset=\".5\" stop-color=\"#3a2e30\"/><stop offset=\"1\" stop-color=\"#1a1214\"/></linearGradient>\n<radialGradient id=\"heartR\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd0c8\"/><stop offset=\".35\" stop-color=\"#e8241a\"/><stop offset=\".8\" stop-color=\"#8a0606\"/><stop offset=\"1\" stop-color=\"#4a0202\"/></radialGradient>\n<linearGradient id=\"banner\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a0a0a\"/><stop offset=\".3\" stop-color=\"#b81c14\"/><stop offset=\".6\" stop-color=\"#d8301e\"/><stop offset=\"1\" stop-color=\"#6a0c0a\"/></linearGradient>\n<linearGradient id=\"iron\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ccd2\"/><stop offset=\".5\" stop-color=\"#7a808a\"/><stop offset=\"1\" stop-color=\"#3a3e46\"/></linearGradient>\n<linearGradient id=\"bronze\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#4a2408\"/><stop offset=\".35\" stop-color=\"#b8682a\"/><stop offset=\".55\" stop-color=\"#f0b070\"/><stop offset=\"1\" stop-color=\"#5a2c0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient>\n</defs><g filter=\"url(#drop)\"><path d=\"M128 40 L232 108 L128 176 L24 108 Z\" fill=\"url(#lavaG)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M24 108 L128 176 L128 214 L24 146 Z\" fill=\"#5a1a0a\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M232 108 L128 176 L128 214 L232 146 Z\" fill=\"#3a0e06\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M24 120 L128 188 L232 120\" stroke=\"#ff7a1a\" stroke-width=\"4\" fill=\"none\" opacity=\".8\"/>\n<g fill=\"url(#basalt)\" stroke=\"#24170f\" stroke-width=\"4\" stroke-linejoin=\"round\">\n<path d=\"M128 50 L170 78 L150 98 L118 92 L104 66 Z\"/><path d=\"M180 86 L220 110 L190 130 L162 118 L160 98 Z\"/>\n<path d=\"M92 72 L108 98 L84 120 L46 108 Z\"/><path d=\"M122 104 L154 108 L170 130 L140 156 L106 138 L100 120 Z\"/>\n<path d=\"M82 132 L98 146 L118 164 L84 154 L56 132 L72 124 Z\"/><path d=\"M180 140 L160 158 L148 162 L172 134 Z\"/></g>\n<g fill=\"none\" stroke=\"#fff\" stroke-width=\"2.5\" opacity=\".35\"><path d=\"M110 70 L128 56 L160 76\"/><path d=\"M168 98 L184 92 L208 108\"/><path d=\"M58 106 L90 80\"/><path d=\"M110 124 L126 110 L150 112\"/></g>\n<circle cx=\"140\" cy=\"166\" r=\"9\" fill=\"#fff2a0\" stroke=\"#b81c04\" stroke-width=\"3\"/><circle cx=\"137\" cy=\"163\" r=\"3\" fill=\"#fff\"/>\n<circle cx=\"70\" cy=\"124\" r=\"5\" fill=\"#fff2a0\" stroke=\"#b81c04\" stroke-width=\"2.5\"/>\n<g transform=\"translate(196 98) rotate(12) scale(0.45)\"><path d=\"M0 0 C-22 -18 -26 -46 -8 -72 C-8 -52 4 -48 6 -64 C18 -44 26 -18 0 0 Z\" fill=\"url(#fireG)\" stroke=\"#5a1404\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M0 -6 C-10 -16 -10 -32 -2 -44 C0 -30 8 -30 8 -38 C14 -24 12 -12 0 -6 Z\" fill=\"url(#fireCore)\"/></g><g transform=\"translate(60 96) rotate(-14) scale(0.38)\"><path d=\"M0 0 C-22 -18 -26 -46 -8 -72 C-8 -52 4 -48 6 -64 C18 -44 26 -18 0 0 Z\" fill=\"url(#fireG)\" stroke=\"#5a1404\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M0 -6 C-10 -16 -10 -32 -2 -44 C0 -30 8 -30 8 -38 C14 -24 12 -12 0 -6 Z\" fill=\"url(#fireCore)\"/></g>\n<path d=\"M54 98 L118 56\" stroke=\"#fff\" stroke-width=\"7\" stroke-linecap=\"round\" filter=\"url(#soft)\" opacity=\".55\"/></g></svg>", "fireblock": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n<linearGradient id=\"lavaG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4a0\"/><stop offset=\".3\" stop-color=\"#ffb21a\"/><stop offset=\".65\" stop-color=\"#ff4a0a\"/><stop offset=\"1\" stop-color=\"#9a1002\"/></linearGradient>\n<linearGradient id=\"basalt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#6a5a58\"/><stop offset=\".5\" stop-color=\"#3a2e30\"/><stop offset=\"1\" stop-color=\"#1a1214\"/></linearGradient>\n<radialGradient id=\"heartR\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd0c8\"/><stop offset=\".35\" stop-color=\"#e8241a\"/><stop offset=\".8\" stop-color=\"#8a0606\"/><stop offset=\"1\" stop-color=\"#4a0202\"/></radialGradient>\n<linearGradient id=\"banner\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a0a0a\"/><stop offset=\".3\" stop-color=\"#b81c14\"/><stop offset=\".6\" stop-color=\"#d8301e\"/><stop offset=\"1\" stop-color=\"#6a0c0a\"/></linearGradient>\n<linearGradient id=\"iron\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ccd2\"/><stop offset=\".5\" stop-color=\"#7a808a\"/><stop offset=\"1\" stop-color=\"#3a3e46\"/></linearGradient>\n<linearGradient id=\"bronze\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#4a2408\"/><stop offset=\".35\" stop-color=\"#b8682a\"/><stop offset=\".55\" stop-color=\"#f0b070\"/><stop offset=\"1\" stop-color=\"#5a2c0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient>\n</defs><g filter=\"url(#drop)\"><path d=\"M128 22 L210 52 L204 140 Q196 196 128 232 Q60 196 52 140 L46 52 Z\" fill=\"url(#fireG)\" stroke=\"#5a1404\" stroke-width=\"7\" stroke-linejoin=\"round\"/>\n<path d=\"M128 40 L194 64 L190 138 Q182 182 128 212 Q74 182 66 138 L62 64 Z\" fill=\"none\" stroke=\"#fff2a0\" stroke-width=\"4\" opacity=\".55\"/>\n<g transform=\"translate(128 182) scale(1.25)\"><path d=\"M0 0 C-22 -18 -26 -46 -8 -72 C-8 -52 4 -48 6 -64 C18 -44 26 -18 0 0 Z\" fill=\"#fff2a0\" stroke=\"#7a1e04\" stroke-width=\"4\" stroke-linejoin=\"round\"/>\n<path d=\"M0 -6 C-10 -16 -10 -32 -2 -44 C0 -30 8 -30 8 -38 C14 -24 12 -12 0 -6 Z\" fill=\"#ff8a1a\"/></g>\n<path d=\"M72 56 L120 40\" stroke=\"#fff\" stroke-width=\"7\" stroke-linecap=\"round\" opacity=\".8\"/></g></svg>", "meleeprotocol": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n<linearGradient id=\"lavaG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4a0\"/><stop offset=\".3\" stop-color=\"#ffb21a\"/><stop offset=\".65\" stop-color=\"#ff4a0a\"/><stop offset=\"1\" stop-color=\"#9a1002\"/></linearGradient>\n<linearGradient id=\"basalt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#6a5a58\"/><stop offset=\".5\" stop-color=\"#3a2e30\"/><stop offset=\"1\" stop-color=\"#1a1214\"/></linearGradient>\n<radialGradient id=\"heartR\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd0c8\"/><stop offset=\".35\" stop-color=\"#e8241a\"/><stop offset=\".8\" stop-color=\"#8a0606\"/><stop offset=\"1\" stop-color=\"#4a0202\"/></radialGradient>\n<linearGradient id=\"banner\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a0a0a\"/><stop offset=\".3\" stop-color=\"#b81c14\"/><stop offset=\".6\" stop-color=\"#d8301e\"/><stop offset=\"1\" stop-color=\"#6a0c0a\"/></linearGradient>\n<linearGradient id=\"iron\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ccd2\"/><stop offset=\".5\" stop-color=\"#7a808a\"/><stop offset=\"1\" stop-color=\"#3a3e46\"/></linearGradient>\n<linearGradient id=\"bronze\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#4a2408\"/><stop offset=\".35\" stop-color=\"#b8682a\"/><stop offset=\".55\" stop-color=\"#f0b070\"/><stop offset=\"1\" stop-color=\"#5a2c0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient>\n</defs><g filter=\"url(#drop)\"><g transform=\"rotate(-12 128 128)\">\n<path d=\"M84 214 C60 196 68 170 172 180 C196 160 176 140 84 146 C60 128 68 106 172 112 C196 92 176 72 96 78 C80 64 92 46 140 44\" stroke=\"#0c4aa0\" stroke-width=\"18\" fill=\"none\" stroke-linecap=\"round\" opacity=\".6\"/>\n<polygon points=\"145.0,196.0 145.0,36.0 128.0,6.0 111.0,36.0 111.0,196.0\" fill=\"url(#steelD)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><polygon points=\"145.0,196.0 145.0,36.0 128.0,6.0 128.0,196.0\" fill=\"url(#steelL)\"/><polyline points=\"145.0,196.0 145.0,36.0 128.0,6.0 111.0,36.0 111.0,196.0\" fill=\"none\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/><line x1=\"128.0\" y1=\"196.0\" x2=\"128.0\" y2=\"6.0\" stroke=\"#ffffff\" stroke-width=\"2\" opacity=\".7\"/>\n<path d=\"M84 214 C60 196 68 170 172 180 C196 160 176 140 84 146 C60 128 68 106 172 112 C196 92 176 72 96 78 C80 64 92 46 140 44\" stroke=\"url(#water)\" stroke-width=\"10\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M84 214 C60 196 68 170 172 180\" stroke=\"#e8fbff\" stroke-width=\"3\" fill=\"none\" stroke-linecap=\"round\" opacity=\".9\"/>\n<path d=\"M84 146 C60 128 68 106 172 112\" stroke=\"#e8fbff\" stroke-width=\"3\" fill=\"none\" stroke-linecap=\"round\" opacity=\".9\"/>\n<path d=\"M120 160 L120 30\" stroke=\"#fff\" stroke-width=\"4\" opacity=\".4\"/>\n<rect x=\"74\" y=\"190\" width=\"108\" height=\"20\" rx=\"8\" fill=\"url(#iron)\" stroke=\"#161c33\" stroke-width=\"5\"/>\n<rect x=\"116\" y=\"206\" width=\"24\" height=\"36\" rx=\"6\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<circle cx=\"128\" cy=\"246\" r=\"11\" fill=\"url(#iron)\" stroke=\"#161c33\" stroke-width=\"4\"/>\n<g fill=\"#bff0ff\"><circle cx=\"190\" cy=\"150\" r=\"5\"/><circle cx=\"64\" cy=\"96\" r=\"4\"/><circle cx=\"182\" cy=\"66\" r=\"3.5\"/></g></g></g></svg>", "heavyweapons": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n<linearGradient id=\"lavaG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4a0\"/><stop offset=\".3\" stop-color=\"#ffb21a\"/><stop offset=\".65\" stop-color=\"#ff4a0a\"/><stop offset=\"1\" stop-color=\"#9a1002\"/></linearGradient>\n<linearGradient id=\"basalt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#6a5a58\"/><stop offset=\".5\" stop-color=\"#3a2e30\"/><stop offset=\"1\" stop-color=\"#1a1214\"/></linearGradient>\n<radialGradient id=\"heartR\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd0c8\"/><stop offset=\".35\" stop-color=\"#e8241a\"/><stop offset=\".8\" stop-color=\"#8a0606\"/><stop offset=\"1\" stop-color=\"#4a0202\"/></radialGradient>\n<linearGradient id=\"banner\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a0a0a\"/><stop offset=\".3\" stop-color=\"#b81c14\"/><stop offset=\".6\" stop-color=\"#d8301e\"/><stop offset=\"1\" stop-color=\"#6a0c0a\"/></linearGradient>\n<linearGradient id=\"iron\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ccd2\"/><stop offset=\".5\" stop-color=\"#7a808a\"/><stop offset=\"1\" stop-color=\"#3a3e46\"/></linearGradient>\n<linearGradient id=\"bronze\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#4a2408\"/><stop offset=\".35\" stop-color=\"#b8682a\"/><stop offset=\".55\" stop-color=\"#f0b070\"/><stop offset=\"1\" stop-color=\"#5a2c0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient>\n</defs><g filter=\"url(#drop)\"><circle cx=\"128\" cy=\"128\" r=\"104\" fill=\"url(#dirt)\" stroke=\"#24170f\" stroke-width=\"6\"/>\n<g fill=\"#6a4426\" stroke=\"#24170f\" stroke-width=\"3.5\" stroke-linejoin=\"round\" opacity=\".9\"><path d=\"M40 112 l20 -30 34 -8 -6 24 -26 22z\"/><path d=\"M164 52 l32 10 18 30 -30 -6z\"/><path d=\"M60 186 l30 -10 20 22 -10 22 -30 -10z\"/><path d=\"M190 168 l22 -14 4 30 -20 16z\"/></g>\n<circle cx=\"128\" cy=\"128\" r=\"104\" fill=\"none\" stroke=\"url(#goldH)\" stroke-width=\"8\"/><circle cx=\"128\" cy=\"128\" r=\"110\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<g transform=\"rotate(40 128 128)\">\n<rect x=\"118\" y=\"20\" width=\"20\" height=\"200\" rx=\"7\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<rect x=\"118\" y=\"180\" width=\"20\" height=\"30\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"3\"/>\n<rect x=\"74\" y=\"16\" width=\"108\" height=\"56\" rx=\"8\" fill=\"url(#iron)\" stroke=\"#161c33\" stroke-width=\"6\"/>\n<rect x=\"74\" y=\"16\" width=\"54\" height=\"56\" rx=\"8\" fill=\"#e4e8ee\" opacity=\".35\"/>\n<path d=\"M82 26 H174\" stroke=\"#fff\" stroke-width=\"4\" opacity=\".6\"/><path d=\"M128 16 V72\" stroke=\"#161c33\" stroke-width=\"3\" opacity=\".6\"/></g>\n<g transform=\"rotate(-40 128 128)\">\n<path d=\"M100 44 H156 L150 192 H106 Z\" fill=\"url(#bronze)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<rect x=\"88\" y=\"22\" width=\"80\" height=\"28\" rx=\"10\" fill=\"url(#bronze)\" stroke=\"#24170f\" stroke-width=\"6\"/>\n<ellipse cx=\"128\" cy=\"26\" rx=\"26\" ry=\"9\" fill=\"#120802\" stroke=\"#24170f\" stroke-width=\"3\"/>\n<rect x=\"96\" y=\"92\" width=\"64\" height=\"14\" rx=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<rect x=\"100\" y=\"150\" width=\"56\" height=\"14\" rx=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<rect x=\"80\" y=\"120\" width=\"96\" height=\"16\" rx=\"6\" fill=\"url(#iron)\" stroke=\"#161c33\" stroke-width=\"4\"/>\n<circle cx=\"128\" cy=\"206\" r=\"18\" fill=\"url(#bronze)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n<path d=\"M112 52 L115 184\" stroke=\"#ffe0b0\" stroke-width=\"5\" stroke-linecap=\"round\" opacity=\".6\"/></g>\n<circle cx=\"128\" cy=\"128\" r=\"24\" fill=\"url(#earthGem)\" stroke=\"#24170f\" stroke-width=\"5\"/><circle cx=\"120\" cy=\"120\" r=\"6\" fill=\"#fff\" opacity=\".85\"/>\n<g transform=\"translate(128 236)\"><circle r=\"16\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><path d=\"M-9 5 L-2 -7 L3 0 L6 -4 L11 5 Z\" fill=\"#6a4426\" stroke=\"#24170f\" stroke-width=\"2\"/></g></g></svg>", "airblock": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"redb\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff8a6a\"/><stop offset=\".45\" stop-color=\"#d82a14\"/><stop offset=\"1\" stop-color=\"#6a0a04\"/></linearGradient>\n<linearGradient id=\"waterG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e4f8ff\"/><stop offset=\".4\" stop-color=\"#5ec8ff\"/><stop offset=\"1\" stop-color=\"#0a4a9a\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe23a\"/><stop offset=\"1\" stop-color=\"#e08a0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient>\n<linearGradient id=\"windG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".4\" stop-color=\"#bff0f4\"/><stop offset=\"1\" stop-color=\"#3a9aa8\"/></linearGradient>\n<linearGradient id=\"leafG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8ffa0\"/><stop offset=\".45\" stop-color=\"#5ccf2c\"/><stop offset=\"1\" stop-color=\"#1a6a0e\"/></linearGradient>\n<linearGradient id=\"soilG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#b07a42\"/><stop offset=\".5\" stop-color=\"#7a4a20\"/><stop offset=\"1\" stop-color=\"#3e220c\"/></linearGradient>\n</defs>\n<g filter=\"url(#drop)\">\n<path d=\"M128 22 L210 52 L204 140 Q196 196 128 232 Q60 196 52 140 L46 52 Z\" fill=\"url(#windG)\" stroke=\"#123a44\" stroke-width=\"7\" stroke-linejoin=\"round\"/>\n<path d=\"M128 22 L210 52 L204 140 Q196 196 128 232\" fill=\"none\" stroke=\"url(#goldH)\" stroke-width=\"5\" opacity=\".55\"/>\n<path d=\"M66 96 Q110 76 150 92 Q176 104 168 124 Q160 140 142 132\" stroke=\"#ffffff\" stroke-width=\"9\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M70 132 Q104 118 132 130\" stroke=\"#ffffff\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\" opacity=\".9\"/>\n<path d=\"M78 168 Q120 150 162 166 Q184 176 176 194\" stroke=\"#e4fbff\" stroke-width=\"7\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M150 60 L120 118 L144 118 L116 186 L176 106 L150 106 L170 60 Z\" fill=\"url(#bolt)\" stroke=\"#6a4a00\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M72 56 L120 40\" stroke=\"#fff\" stroke-width=\"7\" stroke-linecap=\"round\" opacity=\".8\"/>\n</g></svg>", "supergrowth": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"redb\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff8a6a\"/><stop offset=\".45\" stop-color=\"#d82a14\"/><stop offset=\"1\" stop-color=\"#6a0a04\"/></linearGradient>\n<linearGradient id=\"waterG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e4f8ff\"/><stop offset=\".4\" stop-color=\"#5ec8ff\"/><stop offset=\"1\" stop-color=\"#0a4a9a\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe23a\"/><stop offset=\"1\" stop-color=\"#e08a0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient>\n<linearGradient id=\"windG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".4\" stop-color=\"#bff0f4\"/><stop offset=\"1\" stop-color=\"#3a9aa8\"/></linearGradient>\n<linearGradient id=\"leafG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e8ffa0\"/><stop offset=\".45\" stop-color=\"#5ccf2c\"/><stop offset=\"1\" stop-color=\"#1a6a0e\"/></linearGradient>\n<linearGradient id=\"soilG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#b07a42\"/><stop offset=\".5\" stop-color=\"#7a4a20\"/><stop offset=\"1\" stop-color=\"#3e220c\"/></linearGradient>\n</defs>\n<g filter=\"url(#drop)\">\n<path d=\"M34 214 Q128 170 222 214 Q226 236 128 238 Q30 236 34 214 Z\" fill=\"url(#soilG)\" stroke=\"#24140a\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M128 214 C126 170 120 130 132 82\" stroke=\"#2f6a14\" stroke-width=\"14\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M128 214 C126 170 120 130 132 82\" stroke=\"#8ae04a\" stroke-width=\"6\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M126 150 C96 150 64 136 54 104 C90 100 118 116 126 150 Z\" fill=\"url(#leafG)\" stroke=\"#0e3a08\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M130 120 C158 116 190 96 198 66 C162 64 136 86 130 120 Z\" fill=\"url(#leafG)\" stroke=\"#0e3a08\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M66 108 Q96 120 122 146 M188 72 Q158 92 134 116\" stroke=\"#efffc8\" stroke-width=\"3\" fill=\"none\" opacity=\".8\"/>\n<path d=\"M132 24 L170 70 L148 70 L148 96 L116 96 L116 70 L94 70 Z\" fill=\"url(#gold)\" stroke=\"#5a3204\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M124 40 L108 60\" stroke=\"#fff6c0\" stroke-width=\"5\" stroke-linecap=\"round\" opacity=\".9\"/>\n<ellipse cx=\"84\" cy=\"204\" rx=\"16\" ry=\"5\" fill=\"#d8a066\" opacity=\".6\"/>\n</g></svg>", "synthesizer": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"redb\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff8a6a\"/><stop offset=\".45\" stop-color=\"#d82a14\"/><stop offset=\"1\" stop-color=\"#6a0a04\"/></linearGradient>\n<linearGradient id=\"waterG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e4f8ff\"/><stop offset=\".4\" stop-color=\"#5ec8ff\"/><stop offset=\"1\" stop-color=\"#0a4a9a\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe23a\"/><stop offset=\"1\" stop-color=\"#e08a0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient>\n<linearGradient id=\"tankG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#0a4a9a\"/><stop offset=\".35\" stop-color=\"#5ec8ff\"/><stop offset=\".6\" stop-color=\"#bff0ff\"/><stop offset=\"1\" stop-color=\"#1a6ac0\"/></linearGradient>\n<linearGradient id=\"arcG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f5d0ff\"/><stop offset=\".5\" stop-color=\"#c06aff\"/><stop offset=\"1\" stop-color=\"#5a1a9a\"/></linearGradient>\n<linearGradient id=\"capG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a4f66\"/><stop offset=\".5\" stop-color=\"#23263a\"/><stop offset=\"1\" stop-color=\"#0c0e18\"/></linearGradient>\n</defs>\n<g filter=\"url(#drop)\">\n<rect x=\"40\" y=\"150\" width=\"176\" height=\"66\" rx=\"12\" fill=\"url(#steelD)\" stroke=\"#1a2230\" stroke-width=\"6\"/>\n<rect x=\"52\" y=\"160\" width=\"152\" height=\"12\" rx=\"6\" fill=\"url(#goldH)\" stroke=\"#5a3204\" stroke-width=\"3\"/>\n<circle cx=\"80\" cy=\"196\" r=\"9\" fill=\"url(#gem)\" stroke=\"#0a2470\" stroke-width=\"3\"/><circle cx=\"176\" cy=\"196\" r=\"9\" fill=\"url(#gem)\" stroke=\"#0a2470\" stroke-width=\"3\"/>\n<rect x=\"34\" y=\"52\" width=\"46\" height=\"98\" rx=\"20\" fill=\"url(#tankG)\" stroke=\"#0a2a5a\" stroke-width=\"6\"/>\n<rect x=\"176\" y=\"52\" width=\"46\" height=\"98\" rx=\"20\" fill=\"url(#tankG)\" stroke=\"#0a2a5a\" stroke-width=\"6\"/>\n<path d=\"M44 92 Q57 86 70 92 M186 92 Q199 86 212 92\" stroke=\"#ffffff\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\"/>\n<rect x=\"34\" y=\"46\" width=\"46\" height=\"12\" rx=\"4\" fill=\"url(#gold)\" stroke=\"#5a3204\" stroke-width=\"3\"/><rect x=\"176\" y=\"46\" width=\"46\" height=\"12\" rx=\"4\" fill=\"url(#gold)\" stroke=\"#5a3204\" stroke-width=\"3\"/>\n<path d=\"M80 128 H108 V150 M176 128 H148 V150\" stroke=\"#5e6b82\" stroke-width=\"12\" fill=\"none\" stroke-linejoin=\"round\"/>\n<rect x=\"112\" y=\"128\" width=\"32\" height=\"26\" rx=\"5\" fill=\"url(#steelL)\" stroke=\"#1a2230\" stroke-width=\"5\"/>\n<path d=\"M128 128 C104 116 100 92 112 76 C104 62 112 40 128 34 C144 40 152 62 144 76 C156 92 152 116 128 128 Z\" fill=\"url(#waterG)\" stroke=\"#0a2a5a\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M112 92 C96 88 92 76 96 66 M144 92 C160 88 164 76 160 66\" stroke=\"#0a2a5a\" stroke-width=\"9\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M112 92 C96 88 92 76 96 66 M144 92 C160 88 164 76 160 66\" stroke=\"#7fd8ff\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/>\n<ellipse cx=\"120\" cy=\"62\" rx=\"4\" ry=\"5\" fill=\"#ffffff\"/><ellipse cx=\"136\" cy=\"62\" rx=\"4\" ry=\"5\" fill=\"#ffffff\"/>\n<path d=\"M118 46 Q124 40 132 42\" stroke=\"#fff\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\" opacity=\".85\"/>\n</g></svg>", "scholar": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"redb\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff8a6a\"/><stop offset=\".45\" stop-color=\"#d82a14\"/><stop offset=\"1\" stop-color=\"#6a0a04\"/></linearGradient>\n<linearGradient id=\"waterG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e4f8ff\"/><stop offset=\".4\" stop-color=\"#5ec8ff\"/><stop offset=\"1\" stop-color=\"#0a4a9a\"/></linearGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe23a\"/><stop offset=\"1\" stop-color=\"#e08a0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient>\n<linearGradient id=\"tankG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#0a4a9a\"/><stop offset=\".35\" stop-color=\"#5ec8ff\"/><stop offset=\".6\" stop-color=\"#bff0ff\"/><stop offset=\"1\" stop-color=\"#1a6ac0\"/></linearGradient>\n<linearGradient id=\"arcG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f5d0ff\"/><stop offset=\".5\" stop-color=\"#c06aff\"/><stop offset=\"1\" stop-color=\"#5a1a9a\"/></linearGradient>\n<linearGradient id=\"capG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4a4f66\"/><stop offset=\".5\" stop-color=\"#23263a\"/><stop offset=\"1\" stop-color=\"#0c0e18\"/></linearGradient>\n</defs>\n<g filter=\"url(#drop)\">\n<path d=\"M58 40 H190 Q206 40 206 56 V188 Q206 204 190 204 H58 Z\" fill=\"url(#parch)\" stroke=\"#5a3a14\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M50 32 H70 V216 H50 Q36 216 36 202 V46 Q36 32 50 32 Z\" fill=\"url(#roll)\" stroke=\"#5a3a14\" stroke-width=\"6\"/>\n<path d=\"M190 40 Q214 40 214 62 V182 Q214 204 190 204\" fill=\"none\" stroke=\"url(#arcG)\" stroke-width=\"6\" opacity=\".7\"/>\n<g stroke=\"#a04ae0\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\" opacity=\".85\"><path d=\"M88 66 h84 M88 86 h64\"/><circle cx=\"160\" cy=\"128\" r=\"22\"/><path d=\"M160 106 L166 122 L182 128 L166 134 L160 150 L154 134 L138 128 L154 122 Z\" fill=\"#d79aff\" stroke=\"none\"/></g>\n<g transform=\"translate(0 4)\">\n<circle cx=\"86\" cy=\"128\" r=\"18\" fill=\"url(#glass)\" stroke=\"#2a1a0a\" stroke-width=\"5\"/><circle cx=\"130\" cy=\"128\" r=\"18\" fill=\"url(#glass)\" stroke=\"#2a1a0a\" stroke-width=\"5\"/>\n<path d=\"M104 126 Q108 120 112 126\" stroke=\"#2a1a0a\" stroke-width=\"5\" fill=\"none\"/>\n<path d=\"M80 120 Q84 116 90 118\" stroke=\"#fff\" stroke-width=\"3\" fill=\"none\" stroke-linecap=\"round\"/>\n</g>\n<path d=\"M60 186 L128 162 L196 186 L128 210 Z\" fill=\"url(#capG)\" stroke=\"#05060c\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M90 198 V222 Q128 238 166 222 V198 L128 212 Z\" fill=\"url(#capG)\" stroke=\"#05060c\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<circle cx=\"128\" cy=\"186\" r=\"6\" fill=\"url(#gold)\" stroke=\"#5a3204\" stroke-width=\"2\"/>\n<path d=\"M128 186 Q170 192 182 214\" stroke=\"url(#gold)\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M176 210 l12 0 l-2 22 l-8 0 Z\" fill=\"url(#gold)\" stroke=\"#5a3204\" stroke-width=\"3\"/>\n<path d=\"M96 180 L126 170\" stroke=\"#8a90b0\" stroke-width=\"4\" stroke-linecap=\"round\" opacity=\".8\"/>\n</g></svg>", "forge": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n<linearGradient id=\"lavaG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4a0\"/><stop offset=\".3\" stop-color=\"#ffb21a\"/><stop offset=\".65\" stop-color=\"#ff4a0a\"/><stop offset=\"1\" stop-color=\"#9a1002\"/></linearGradient>\n<linearGradient id=\"basalt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#6a5a58\"/><stop offset=\".5\" stop-color=\"#3a2e30\"/><stop offset=\"1\" stop-color=\"#1a1214\"/></linearGradient>\n<radialGradient id=\"heartR\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd0c8\"/><stop offset=\".35\" stop-color=\"#e8241a\"/><stop offset=\".8\" stop-color=\"#8a0606\"/><stop offset=\"1\" stop-color=\"#4a0202\"/></radialGradient>\n<linearGradient id=\"banner\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a0a0a\"/><stop offset=\".3\" stop-color=\"#b81c14\"/><stop offset=\".6\" stop-color=\"#d8301e\"/><stop offset=\"1\" stop-color=\"#6a0c0a\"/></linearGradient>\n<linearGradient id=\"iron\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ccd2\"/><stop offset=\".5\" stop-color=\"#7a808a\"/><stop offset=\"1\" stop-color=\"#3a3e46\"/></linearGradient>\n<linearGradient id=\"bronze\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#4a2408\"/><stop offset=\".35\" stop-color=\"#b8682a\"/><stop offset=\".55\" stop-color=\"#f0b070\"/><stop offset=\"1\" stop-color=\"#5a2c0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient>\n<linearGradient id=\"redb\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff8a6a\"/><stop offset=\".45\" stop-color=\"#d82a14\"/><stop offset=\"1\" stop-color=\"#6a0a04\"/></linearGradient>\n</defs><g filter=\"url(#drop)\">\n<path d=\"M128 18 C150 48 186 50 196 92 C204 70 222 72 228 60 C240 104 226 150 200 170 L56 170 C30 150 16 104 28 60 C34 72 52 70 60 92 C70 50 106 48 128 18 Z\" fill=\"url(#fireG)\" stroke=\"#5a1404\" stroke-width=\"6\" stroke-linejoin=\"round\" opacity=\".95\"/>\n<path d=\"M128 56 C142 78 162 82 168 110 C174 128 160 152 128 160 C96 152 82 128 88 110 C94 82 114 78 128 56 Z\" fill=\"url(#fireCore)\"/>\n<path d=\"M150 188 L232 188 L226 200 L206 202 L212 232 L168 232 L174 202 L150 200 Z\" fill=\"url(#iron)\" stroke=\"#14161e\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M118 176 L238 176 Q246 176 244 184 L242 192 L130 192 Q108 190 96 180 Q108 176 118 176 Z\" fill=\"url(#steelD)\" stroke=\"#14161e\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M124 180 L232 180\" stroke=\"#e6ecf4\" stroke-width=\"3\" stroke-linecap=\"round\" opacity=\".8\"/>\n<path d=\"M160 176 L160 160 C160 130 216 130 216 160 L216 176 Z\" fill=\"url(#steelL)\" stroke=\"#14161e\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M186 136 L190 136 L190 150 L186 150 Z\" fill=\"#8a96a8\"/><path d=\"M164 156 L184 156 L184 162 L164 162 Z M192 156 L212 156 L212 162 L192 162 Z\" fill=\"#14161e\"/><path d=\"M184 150 L192 150 L192 174 L184 174 Z\" fill=\"url(#steelD)\" stroke=\"#14161e\" stroke-width=\"3\"/><circle cx=\"168\" cy=\"172\" r=\"2.5\" fill=\"#5e6b82\"/><circle cx=\"208\" cy=\"172\" r=\"2.5\" fill=\"#5e6b82\"/>\n<path d=\"M162 176 L214 176\" stroke=\"#ff7a1a\" stroke-width=\"5\" opacity=\".9\"/>\n<path d=\"M168 150 Q176 140 190 140\" stroke=\"#fff\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\" opacity=\".9\"/>\n<circle cx=\"188\" cy=\"128\" r=\"5\" fill=\"#fff2a0\"/><circle cx=\"206\" cy=\"118\" r=\"4\" fill=\"#ffc23a\"/><circle cx=\"172\" cy=\"114\" r=\"3.5\" fill=\"#fff2a0\"/><circle cx=\"220\" cy=\"136\" r=\"3\" fill=\"#ffc23a\"/>\n<path d=\"M52 232 C50 200 56 178 72 168 L104 168 C116 180 118 206 114 232 Z\" fill=\"url(#redb)\" stroke=\"#3a0604\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M60 200 L108 200 L106 232 L58 232 Z\" fill=\"url(#leather)\" stroke=\"#1e0e04\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<circle cx=\"86\" cy=\"140\" r=\"30\" fill=\"url(#redb)\" stroke=\"#3a0604\" stroke-width=\"6\"/>\n<path d=\"M64 124 C52 112 50 96 58 84 C62 100 70 108 76 114 Z\" fill=\"url(#steelL)\" stroke=\"#14161e\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M104 116 C112 104 126 100 134 104 C122 108 116 116 112 126 Z\" fill=\"url(#steelL)\" stroke=\"#14161e\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M76 136 L90 140 M102 132 L92 140\" stroke=\"#3a0604\" stroke-width=\"5\" stroke-linecap=\"round\"/>\n<ellipse cx=\"84\" cy=\"144\" rx=\"5\" ry=\"4\" fill=\"#fff2a0\"/><ellipse cx=\"100\" cy=\"140\" rx=\"5\" ry=\"4\" fill=\"#fff2a0\"/>\n<path d=\"M82 158 Q92 164 104 156\" stroke=\"#3a0604\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M92 158 L94 164 M100 156 L101 162\" stroke=\"#fff\" stroke-width=\"3\" stroke-linecap=\"round\"/>\n<path d=\"M106 176 C122 168 134 150 138 128\" stroke=\"#3a0604\" stroke-width=\"16\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M106 176 C122 168 134 150 138 128\" stroke=\"#e8401e\" stroke-width=\"8\" fill=\"none\" stroke-linecap=\"round\"/>\n<path d=\"M138 128 L172 92\" stroke=\"#3e1e0c\" stroke-width=\"12\" stroke-linecap=\"round\"/>\n<path d=\"M138 128 L172 92\" stroke=\"url(#wood)\" stroke-width=\"6\" stroke-linecap=\"round\"/>\n<path d=\"M158 70 L190 100 L176 114 L144 84 Z\" fill=\"url(#iron)\" stroke=\"#14161e\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M156 76 L170 90\" stroke=\"#e6ecf4\" stroke-width=\"3\" stroke-linecap=\"round\" opacity=\".8\"/>\n<path d=\"M66 128 Q72 120 82 120\" stroke=\"#fff\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\" opacity=\".7\"/>\n</g></svg>", "frenzy": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n<linearGradient id=\"lavaG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4a0\"/><stop offset=\".3\" stop-color=\"#ffb21a\"/><stop offset=\".65\" stop-color=\"#ff4a0a\"/><stop offset=\"1\" stop-color=\"#9a1002\"/></linearGradient>\n<linearGradient id=\"basalt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#6a5a58\"/><stop offset=\".5\" stop-color=\"#3a2e30\"/><stop offset=\"1\" stop-color=\"#1a1214\"/></linearGradient>\n<radialGradient id=\"heartR\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd0c8\"/><stop offset=\".35\" stop-color=\"#e8241a\"/><stop offset=\".8\" stop-color=\"#8a0606\"/><stop offset=\"1\" stop-color=\"#4a0202\"/></radialGradient>\n<linearGradient id=\"banner\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a0a0a\"/><stop offset=\".3\" stop-color=\"#b81c14\"/><stop offset=\".6\" stop-color=\"#d8301e\"/><stop offset=\"1\" stop-color=\"#6a0c0a\"/></linearGradient>\n<linearGradient id=\"iron\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ccd2\"/><stop offset=\".5\" stop-color=\"#7a808a\"/><stop offset=\"1\" stop-color=\"#3a3e46\"/></linearGradient>\n<linearGradient id=\"bronze\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#4a2408\"/><stop offset=\".35\" stop-color=\"#b8682a\"/><stop offset=\".55\" stop-color=\"#f0b070\"/><stop offset=\"1\" stop-color=\"#5a2c0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient>\n<linearGradient id=\"fzG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eaffb0\"/><stop offset=\".45\" stop-color=\"#5cf03a\"/><stop offset=\"1\" stop-color=\"#127a1a\"/></linearGradient>\n<radialGradient id=\"fzCore\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#c8ff7a\" stop-opacity=\".75\"/><stop offset=\".6\" stop-color=\"#3ad02a\" stop-opacity=\".3\"/><stop offset=\"1\" stop-color=\"#0a5a10\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"fzBlade\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#dfe6ee\"/><stop offset=\"1\" stop-color=\"#8a96a8\"/></linearGradient>\n<filter id=\"fzGlow\" x=\"-30%\" y=\"-30%\" width=\"160%\" height=\"160%\"><feGaussianBlur stdDeviation=\"6\"/></filter>\n<linearGradient id=\"gunmetal\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#1c1f26\"/><stop offset=\".35\" stop-color=\"#4a4f5a\"/><stop offset=\".6\" stop-color=\"#6a707c\"/><stop offset=\"1\" stop-color=\"#23262e\"/></linearGradient>\n</defs>\n<circle cx=\"128\" cy=\"128\" r=\"108\" fill=\"url(#fzCore)\"/>\n<g fill=\"none\" stroke-linecap=\"round\">\n<path d=\"M128 22 C200 22 238 82 230 136 C222 196 168 232 112 228\" stroke=\"#5cf03a\" stroke-width=\"24\" filter=\"url(#fzGlow)\" opacity=\".75\"/>\n<path d=\"M128 234 C56 234 18 174 26 120 C34 60 88 24 144 28\" stroke=\"#5cf03a\" stroke-width=\"24\" filter=\"url(#fzGlow)\" opacity=\".75\"/>\n<path d=\"M128 22 C200 22 238 82 230 136 C222 196 168 232 112 228\" stroke=\"#0e4a12\" stroke-width=\"15\"/>\n<path d=\"M128 22 C200 22 238 82 230 136 C222 196 168 232 112 228\" stroke=\"url(#fzG)\" stroke-width=\"9\"/>\n<path d=\"M128 234 C56 234 18 174 26 120 C34 60 88 24 144 28\" stroke=\"#0e4a12\" stroke-width=\"15\"/>\n<path d=\"M128 234 C56 234 18 174 26 120 C34 60 88 24 144 28\" stroke=\"url(#fzG)\" stroke-width=\"9\"/>\n<path d=\"M150 56 C188 66 206 100 202 130\" stroke=\"#0e4a12\" stroke-width=\"10\"/>\n<path d=\"M150 56 C188 66 206 100 202 130\" stroke=\"#9cff6a\" stroke-width=\"5\"/>\n<path d=\"M106 200 C68 190 50 156 54 126\" stroke=\"#0e4a12\" stroke-width=\"10\"/>\n<path d=\"M106 200 C68 190 50 156 54 126\" stroke=\"#9cff6a\" stroke-width=\"5\"/>\n<path d=\"M160 34 C190 42 212 62 222 90\" stroke=\"#fff\" stroke-width=\"3.5\" opacity=\".75\"/>\n</g>\n<g filter=\"url(#drop)\">\n\n<g transform=\"rotate(42 128 128)\">\n<rect x=\"122\" y=\"58\" width=\"12\" height=\"150\" rx=\"4\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<path d=\"M128 8 L156 60 L128 50 L100 60 Z\" fill=\"url(#steelL)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M128 18 L128 48\" stroke=\"#8a96a8\" stroke-width=\"3\"/>\n<path d=\"M122 178 L104 208 L110 222 L122 204 Z M134 178 L152 208 L146 222 L134 204 Z\" fill=\"#e8f0e0\" stroke=\"#24170f\" stroke-width=\"3.5\" stroke-linejoin=\"round\"/>\n</g>\n<g transform=\"translate(128 128) scale(.86) translate(-128 -128)\"><path d=\"M112 150 L106 214 Q106 226 118 226 L138 226 Q150 226 150 214 L144 150 Z\" fill=\"url(#wood)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M100 54 Q100 46 108 46 H148 Q156 46 156 54 L150 158 H106 Z\" fill=\"url(#gunmetal)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<rect x=\"90\" y=\"30\" width=\"76\" height=\"26\" rx=\"10\" fill=\"url(#gunmetal)\" stroke=\"#24170f\" stroke-width=\"6\"/>\n<ellipse cx=\"128\" cy=\"34\" rx=\"26\" ry=\"8\" fill=\"#120802\" stroke=\"#24170f\" stroke-width=\"3\"/>\n<rect x=\"98\" y=\"88\" width=\"60\" height=\"13\" rx=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<rect x=\"102\" y=\"134\" width=\"52\" height=\"13\" rx=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<circle cx=\"138\" cy=\"118\" r=\"4\" fill=\"#24170f\"/><path d=\"M141 116 Q150 106 160 108\" stroke=\"#24170f\" stroke-width=\"3\" fill=\"none\"/><circle cx=\"162\" cy=\"107\" r=\"5\" fill=\"#ffe36e\"/>\n<path d=\"M112 60 L115 150\" stroke=\"#c8ccd4\" stroke-width=\"5\" stroke-linecap=\"round\" opacity=\".6\"/>\n</g>\n<g transform=\"rotate(-42 128 128)\">\n<path d=\"M114 38 L128 12 L142 38 L140 150 H116 Z\" fill=\"url(#fzBlade)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M128 22 V146\" stroke=\"#8a96a8\" stroke-width=\"3\"/>\n<rect x=\"92\" y=\"148\" width=\"72\" height=\"15\" rx=\"7\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<rect x=\"120\" y=\"162\" width=\"16\" height=\"40\" rx=\"4\" fill=\"url(#leather)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<circle cx=\"128\" cy=\"208\" r=\"11\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n</g>\n</g>\n<circle cx=\"206\" cy=\"58\" r=\"5\" fill=\"#c8ff7a\"/><circle cx=\"46\" cy=\"196\" r=\"4\" fill=\"#c8ff7a\"/><circle cx=\"222\" cy=\"180\" r=\"3.5\" fill=\"#eaffb0\"/><circle cx=\"36\" cy=\"80\" r=\"3.5\" fill=\"#eaffb0\"/>\n</svg>", "autoloader": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n<linearGradient id=\"lavaG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4a0\"/><stop offset=\".3\" stop-color=\"#ffb21a\"/><stop offset=\".65\" stop-color=\"#ff4a0a\"/><stop offset=\"1\" stop-color=\"#9a1002\"/></linearGradient>\n<linearGradient id=\"basalt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#6a5a58\"/><stop offset=\".5\" stop-color=\"#3a2e30\"/><stop offset=\"1\" stop-color=\"#1a1214\"/></linearGradient>\n<radialGradient id=\"heartR\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd0c8\"/><stop offset=\".35\" stop-color=\"#e8241a\"/><stop offset=\".8\" stop-color=\"#8a0606\"/><stop offset=\"1\" stop-color=\"#4a0202\"/></radialGradient>\n<linearGradient id=\"banner\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a0a0a\"/><stop offset=\".3\" stop-color=\"#b81c14\"/><stop offset=\".6\" stop-color=\"#d8301e\"/><stop offset=\"1\" stop-color=\"#6a0c0a\"/></linearGradient>\n<linearGradient id=\"iron\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ccd2\"/><stop offset=\".5\" stop-color=\"#7a808a\"/><stop offset=\"1\" stop-color=\"#3a3e46\"/></linearGradient>\n<linearGradient id=\"bronze\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#4a2408\"/><stop offset=\".35\" stop-color=\"#b8682a\"/><stop offset=\".55\" stop-color=\"#f0b070\"/><stop offset=\"1\" stop-color=\"#5a2c0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient>\n</defs><g filter=\"url(#drop)\"><circle cx=\"128\" cy=\"128\" r=\"104\" fill=\"url(#dirt)\" stroke=\"#24170f\" stroke-width=\"6\"/>\n<g fill=\"#6a4426\" stroke=\"#24170f\" stroke-width=\"3.5\" stroke-linejoin=\"round\" opacity=\".9\"><path d=\"M40 112 l20 -30 34 -8 -6 24 -26 22z\"/><path d=\"M60 186 l30 -10 20 22 -10 22 -30 -10z\"/><path d=\"M190 168 l22 -14 4 30 -20 16z\"/></g>\n<circle cx=\"128\" cy=\"128\" r=\"104\" fill=\"none\" stroke=\"url(#goldH)\" stroke-width=\"8\"/><circle cx=\"128\" cy=\"128\" r=\"110\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<path d=\"M219.8 87.3 L219.8 96.7 L207.4 98.8 L205.6 105.8 L215.2 113.8 L210.5 121.9 L198.7 117.6 L193.6 122.7 L197.9 134.5 L189.8 139.2 L181.8 129.6 L174.8 131.4 L172.7 143.8 L163.3 143.8 L161.2 131.4 L154.2 129.6 L146.2 139.2 L138.1 134.5 L142.4 122.7 L137.3 117.6 L125.5 121.9 L120.8 113.8 L130.4 105.8 L128.6 98.8 L116.2 96.7 L116.2 87.3 L128.6 85.2 L130.4 78.2 L120.8 70.2 L125.5 62.1 L137.3 66.4 L142.4 61.3 L138.1 49.5 L146.2 44.8 L154.2 54.4 L161.2 52.6 L163.3 40.2 L172.7 40.2 L174.8 52.6 L181.8 54.4 L189.8 44.8 L197.9 49.5 L193.6 61.3 L198.7 66.4 L210.5 62.1 L215.2 70.2 L205.6 78.2 L207.4 85.2Z\" fill=\"url(#iron)\" stroke=\"#161c33\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<circle cx=\"168\" cy=\"92\" r=\"22\" fill=\"#5e6b82\" stroke=\"#161c33\" stroke-width=\"5\"/><circle cx=\"168\" cy=\"92\" r=\"9\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"3\"/>\n<path d=\"M140 62 A40 40 0 0 1 200 70\" fill=\"none\" stroke=\"#fff\" stroke-width=\"4\" opacity=\".45\" stroke-linecap=\"round\"/>\n<g transform=\"rotate(-38 118 150)\">\n<path d=\"M70 132 H184 L190 140 L190 160 L184 168 H70 Z\" fill=\"url(#bronze)\" stroke=\"#24170f\" stroke-width=\"6\" stroke-linejoin=\"round\"/>\n<path d=\"M76 140 H180\" stroke=\"#ffe0b0\" stroke-width=\"5\" stroke-linecap=\"round\" opacity=\".6\"/>\n<rect x=\"176\" y=\"126\" width=\"26\" height=\"48\" rx=\"9\" fill=\"url(#bronze)\" stroke=\"#24170f\" stroke-width=\"6\"/>\n<ellipse cx=\"202\" cy=\"150\" rx=\"7\" ry=\"18\" fill=\"#120802\" stroke=\"#24170f\" stroke-width=\"3\"/>\n<rect x=\"104\" y=\"128\" width=\"14\" height=\"44\" rx=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<rect x=\"148\" y=\"129\" width=\"12\" height=\"42\" rx=\"5\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<rect x=\"44\" y=\"124\" width=\"34\" height=\"52\" rx=\"8\" fill=\"url(#iron)\" stroke=\"#161c33\" stroke-width=\"6\"/>\n<path d=\"M50 132 V168\" stroke=\"#fff\" stroke-width=\"4\" opacity=\".5\" stroke-linecap=\"round\"/>\n<circle cx=\"34\" cy=\"150\" r=\"13\" fill=\"url(#bronze)\" stroke=\"#24170f\" stroke-width=\"5\"/>\n</g>\n<path d=\"M44 100 C42 132 54 156 76 172\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"30\" stroke-linecap=\"round\"/>\n<path d=\"M44 100 C42 132 54 156 76 172\" fill=\"none\" stroke=\"url(#wood)\" stroke-width=\"22\" stroke-linecap=\"round\"/>\n<g stroke=\"#161c33\" stroke-width=\"4\"><circle cx=\"44\" cy=\"102\" r=\"13\" fill=\"#3a4152\"/><circle cx=\"46\" cy=\"128\" r=\"13\" fill=\"#3a4152\"/><circle cx=\"58\" cy=\"152\" r=\"13\" fill=\"#3a4152\"/></g>\n<g fill=\"#fff\" opacity=\".75\"><circle cx=\"40\" cy=\"98\" r=\"4\"/><circle cx=\"42\" cy=\"124\" r=\"4\"/><circle cx=\"54\" cy=\"148\" r=\"4\"/></g>\n<g stroke=\"#fff6c0\" stroke-width=\"6\" stroke-linecap=\"round\" opacity=\".85\"><path d=\"M206 70 L222 58\"/><path d=\"M212 90 L232 86\"/><path d=\"M194 54 L202 38\"/></g>\n<g transform=\"translate(128 236)\"><circle r=\"16\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><path d=\"M-9 5 L-2 -7 L3 0 L6 -4 L11 5 Z\" fill=\"#6a4426\" stroke=\"#24170f\" stroke-width=\"2\"/></g></g></svg>", "hills": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n<linearGradient id=\"lavaG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4a0\"/><stop offset=\".3\" stop-color=\"#ffb21a\"/><stop offset=\".65\" stop-color=\"#ff4a0a\"/><stop offset=\"1\" stop-color=\"#9a1002\"/></linearGradient>\n<linearGradient id=\"basalt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#6a5a58\"/><stop offset=\".5\" stop-color=\"#3a2e30\"/><stop offset=\"1\" stop-color=\"#1a1214\"/></linearGradient>\n<radialGradient id=\"heartR\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd0c8\"/><stop offset=\".35\" stop-color=\"#e8241a\"/><stop offset=\".8\" stop-color=\"#8a0606\"/><stop offset=\"1\" stop-color=\"#4a0202\"/></radialGradient>\n<linearGradient id=\"banner\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a0a0a\"/><stop offset=\".3\" stop-color=\"#b81c14\"/><stop offset=\".6\" stop-color=\"#d8301e\"/><stop offset=\"1\" stop-color=\"#6a0c0a\"/></linearGradient>\n<linearGradient id=\"iron\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ccd2\"/><stop offset=\".5\" stop-color=\"#7a808a\"/><stop offset=\"1\" stop-color=\"#3a3e46\"/></linearGradient>\n<linearGradient id=\"bronze\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#4a2408\"/><stop offset=\".35\" stop-color=\"#b8682a\"/><stop offset=\".55\" stop-color=\"#f0b070\"/><stop offset=\"1\" stop-color=\"#5a2c0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient>\n<linearGradient id=\"hillG\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#9ccf6a\"/><stop offset=\"1\" stop-color=\"#4e7f2c\"/></linearGradient>\n<linearGradient id=\"trail\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#d9a868\"/><stop offset=\"1\" stop-color=\"#a87440\"/></linearGradient>\n<radialGradient id=\"rock\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d6d0c4\"/><stop offset=\".6\" stop-color=\"#8f877a\"/><stop offset=\"1\" stop-color=\"#4f483e\"/></radialGradient></defs><g filter=\"url(#drop)\"><circle cx=\"128\" cy=\"128\" r=\"104\" fill=\"url(#dirt)\" stroke=\"#24170f\" stroke-width=\"6\"/>\n<path d=\"M30 150 L80 70 L118 110 L160 46 L226 150 Q128 200 30 150 Z\" fill=\"url(#hillG)\" stroke=\"#24170f\" stroke-width=\"5\" stroke-linejoin=\"round\" opacity=\".95\"/>\n<path d=\"M80 70 L92 84 M160 46 L172 62\" stroke=\"#fff\" stroke-width=\"5\" stroke-linecap=\"round\" opacity=\".7\"/>\n<path d=\"M128 236 C70 214 190 178 128 150 C80 128 176 108 132 72\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"34\" stroke-linecap=\"round\"/>\n<path d=\"M128 236 C70 214 190 178 128 150 C80 128 176 108 132 72\" fill=\"none\" stroke=\"url(#trail)\" stroke-width=\"26\" stroke-linecap=\"round\"/>\n<path d=\"M118 228 C72 210 176 180 122 156\" fill=\"none\" stroke=\"#fff3d0\" stroke-width=\"5\" opacity=\".5\" stroke-linecap=\"round\"/>\n<ellipse cx=\"96\" cy=\"186\" rx=\"8\" ry=\"4.4\" fill=\"#5a3518\" stroke=\"#24170f\" stroke-width=\"2.5\"/><ellipse cx=\"160\" cy=\"176\" rx=\"7\" ry=\"3.9\" fill=\"#5a3518\" stroke=\"#24170f\" stroke-width=\"2.5\"/><ellipse cx=\"84\" cy=\"128\" rx=\"6\" ry=\"3.3\" fill=\"#5a3518\" stroke=\"#24170f\" stroke-width=\"2.5\"/><ellipse cx=\"176\" cy=\"124\" rx=\"6\" ry=\"3.3\" fill=\"#5a3518\" stroke=\"#24170f\" stroke-width=\"2.5\"/><ellipse cx=\"132\" cy=\"92\" rx=\"5\" ry=\"2.8\" fill=\"#5a3518\" stroke=\"#24170f\" stroke-width=\"2.5\"/><ellipse cx=\"70\" cy=\"196\" rx=\"14\" ry=\"11.2\" fill=\"url(#rock)\" stroke=\"#24170f\" stroke-width=\"3.5\"/><ellipse cx=\"65.1\" cy=\"191.8\" rx=\"4.2\" ry=\"2.8\" fill=\"#fff\" opacity=\".6\"/><ellipse cx=\"178\" cy=\"200\" rx=\"12\" ry=\"9.6\" fill=\"url(#rock)\" stroke=\"#24170f\" stroke-width=\"3.5\"/><ellipse cx=\"173.8\" cy=\"196.4\" rx=\"3.6\" ry=\"2.4\" fill=\"#fff\" opacity=\".6\"/><ellipse cx=\"88\" cy=\"150\" rx=\"10\" ry=\"8.0\" fill=\"url(#rock)\" stroke=\"#24170f\" stroke-width=\"3.5\"/><ellipse cx=\"84.5\" cy=\"147.0\" rx=\"3.0\" ry=\"2.0\" fill=\"#fff\" opacity=\".6\"/><ellipse cx=\"170\" cy=\"150\" rx=\"11\" ry=\"8.8\" fill=\"url(#rock)\" stroke=\"#24170f\" stroke-width=\"3.5\"/><ellipse cx=\"166.2\" cy=\"146.7\" rx=\"3.3\" ry=\"2.2\" fill=\"#fff\" opacity=\".6\"/><ellipse cx=\"108\" cy=\"108\" rx=\"9\" ry=\"7.2\" fill=\"url(#rock)\" stroke=\"#24170f\" stroke-width=\"3.5\"/><ellipse cx=\"104.8\" cy=\"105.3\" rx=\"2.7\" ry=\"1.8\" fill=\"#fff\" opacity=\".6\"/><ellipse cx=\"150\" cy=\"104\" rx=\"8\" ry=\"6.4\" fill=\"url(#rock)\" stroke=\"#24170f\" stroke-width=\"3.5\"/><ellipse cx=\"147.2\" cy=\"101.6\" rx=\"2.4\" ry=\"1.6\" fill=\"#fff\" opacity=\".6\"/><ellipse cx=\"122\" cy=\"74\" rx=\"7\" ry=\"5.6\" fill=\"url(#rock)\" stroke=\"#24170f\" stroke-width=\"3.5\"/><ellipse cx=\"119.5\" cy=\"71.9\" rx=\"2.1\" ry=\"1.4\" fill=\"#fff\" opacity=\".6\"/>\n<g fill=\"none\" stroke=\"#ffe08a\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M114 132 L128 118 L142 132\"/><path d=\"M114 158 L128 144 L142 158\" opacity=\".7\"/></g>\n<circle cx=\"128\" cy=\"128\" r=\"104\" fill=\"none\" stroke=\"url(#goldH)\" stroke-width=\"8\"/><circle cx=\"128\" cy=\"128\" r=\"110\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<g transform=\"translate(128 236)\"><circle r=\"16\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><path d=\"M-9 5 L-2 -7 L3 0 L6 -4 L11 5 Z\" fill=\"#6a4426\" stroke=\"#24170f\" stroke-width=\"2\"/></g></g></svg>", "stormfeathers": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><defs>\n<linearGradient id=\"gold\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff07a\"/><stop offset=\".35\" stop-color=\"#ffc928\"/><stop offset=\".75\" stop-color=\"#e08a0c\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"goldH\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b86a08\"/><stop offset=\".3\" stop-color=\"#ffd23a\"/><stop offset=\".55\" stop-color=\"#fff2a0\"/><stop offset=\".8\" stop-color=\"#f0a818\"/><stop offset=\"1\" stop-color=\"#9a5206\"/></linearGradient>\n<linearGradient id=\"steelL\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#c3cedc\"/></linearGradient>\n<linearGradient id=\"steelD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a9b6c8\"/><stop offset=\"1\" stop-color=\"#5e6b82\"/></linearGradient>\n<linearGradient id=\"wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a2e12\"/><stop offset=\".35\" stop-color=\"#b8743a\"/><stop offset=\".6\" stop-color=\"#d9995a\"/><stop offset=\"1\" stop-color=\"#6e3a16\"/></linearGradient>\n<linearGradient id=\"leather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#3e1e0c\"/><stop offset=\".5\" stop-color=\"#8a4a22\"/><stop offset=\"1\" stop-color=\"#3e1e0c\"/></linearGradient>\n<radialGradient id=\"gem\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".3\" stop-color=\"#4fb4ff\"/><stop offset=\".75\" stop-color=\"#1450c8\"/><stop offset=\"1\" stop-color=\"#0a2470\"/></radialGradient>\n<radialGradient id=\"red\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ff9a8a\"/><stop offset=\".4\" stop-color=\"#ee2a22\"/><stop offset=\"1\" stop-color=\"#8a0a0a\"/></radialGradient>\n<radialGradient id=\"shieldWood\" cx=\".38\" cy=\".32\" r=\".75\"><stop offset=\"0\" stop-color=\"#f0b06a\"/><stop offset=\".55\" stop-color=\"#b8692e\"/><stop offset=\"1\" stop-color=\"#6a3412\"/></radialGradient>\n<linearGradient id=\"parch\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff8e2\"/><stop offset=\".55\" stop-color=\"#f3dca4\"/><stop offset=\"1\" stop-color=\"#c99a52\"/></linearGradient>\n<linearGradient id=\"roll\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4d6\"/><stop offset=\".45\" stop-color=\"#e8c47e\"/><stop offset=\"1\" stop-color=\"#9a6a2c\"/></linearGradient>\n<linearGradient id=\"feather\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".6\" stop-color=\"#dcebff\"/><stop offset=\"1\" stop-color=\"#7fa8e0\"/></linearGradient>\n<radialGradient id=\"glass\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\".9\"/><stop offset=\".35\" stop-color=\"#bfe8ff\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#3a7ab8\" stop-opacity=\".65\"/></radialGradient>\n<linearGradient id=\"potion\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e48cff\"/><stop offset=\".5\" stop-color=\"#a03ee8\"/><stop offset=\"1\" stop-color=\"#4a128a\"/></linearGradient>\n<linearGradient id=\"green\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ff7a\"/><stop offset=\".5\" stop-color=\"#4fd62a\"/><stop offset=\"1\" stop-color=\"#1e7a10\"/></linearGradient>\n<filter id=\"soft\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"2.4\"/></filter>\n<filter id=\"soft2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"5\"/></filter>\n<filter id=\"drop\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"4\" stdDeviation=\"3\" flood-color=\"#000\" flood-opacity=\".35\"/></filter>\n<linearGradient id=\"fireG\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0\" stop-color=\"#b8140a\"/><stop offset=\".35\" stop-color=\"#ff5a12\"/><stop offset=\".7\" stop-color=\"#ffb62a\"/><stop offset=\"1\" stop-color=\"#fff2a0\"/></linearGradient>\n<radialGradient id=\"fireCore\" cx=\".5\" cy=\".7\" r=\".6\"><stop offset=\"0\" stop-color=\"#fff6c0\"/><stop offset=\".5\" stop-color=\"#ffc23a\"/><stop offset=\"1\" stop-color=\"#ff6a12\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"water\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#bff0ff\"/><stop offset=\".45\" stop-color=\"#3fb4f0\"/><stop offset=\"1\" stop-color=\"#0c4aa0\"/></linearGradient>\n<radialGradient id=\"blueHeart\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#d8f2ff\"/><stop offset=\".4\" stop-color=\"#2f8cff\"/><stop offset=\"1\" stop-color=\"#0a2a90\"/></radialGradient>\n<linearGradient id=\"steelB\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef4ff\"/><stop offset=\".5\" stop-color=\"#9aabc4\"/><stop offset=\"1\" stop-color=\"#4a5872\"/></linearGradient>\n<radialGradient id=\"steelR\" cx=\".38\" cy=\".32\" r=\".8\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\".45\" stop-color=\"#a8b6cc\"/><stop offset=\"1\" stop-color=\"#4a5670\"/></radialGradient>\n<radialGradient id=\"arc\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#ffe6ff\"/><stop offset=\".45\" stop-color=\"#d36bff\"/><stop offset=\"1\" stop-color=\"#5a1aa8\" stop-opacity=\"0\"/></radialGradient>\n<radialGradient id=\"arcGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0ff\"/><stop offset=\".4\" stop-color=\"#c25aff\"/><stop offset=\"1\" stop-color=\"#4a0e8a\"/></radialGradient>\n<radialGradient id=\"brainG\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#ffe2ea\"/><stop offset=\".5\" stop-color=\"#f0a0b8\"/><stop offset=\"1\" stop-color=\"#a04a68\"/></radialGradient>\n<linearGradient id=\"ooze\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e0ff8a\"/><stop offset=\".45\" stop-color=\"#7ed62a\"/><stop offset=\"1\" stop-color=\"#2e7a0e\"/></linearGradient>\n<radialGradient id=\"plagueGlow\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\"0\" stop-color=\"#d8ff8a\" stop-opacity=\".9\"/><stop offset=\".6\" stop-color=\"#6ed62a\" stop-opacity=\".35\"/><stop offset=\"1\" stop-color=\"#2e7a0e\" stop-opacity=\"0\"/></radialGradient>\n<linearGradient id=\"straw\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#7a5420\"/><stop offset=\".4\" stop-color=\"#d8b060\"/><stop offset=\".7\" stop-color=\"#f0d088\"/><stop offset=\"1\" stop-color=\"#8a6024\"/></linearGradient>\n<radialGradient id=\"earthGem\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffe0b0\"/><stop offset=\".4\" stop-color=\"#c07a34\"/><stop offset=\"1\" stop-color=\"#4a2208\"/></radialGradient>\n<linearGradient id=\"wingF\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#e6eefc\"/><stop offset=\"1\" stop-color=\"#9ab4dc\"/></linearGradient>\n<linearGradient id=\"wingD\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f8ff\"/><stop offset=\"1\" stop-color=\"#7f9cc8\"/></linearGradient>\n<radialGradient id=\"greyIris\" cx=\".42\" cy=\".38\" r=\".7\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".35\" stop-color=\"#e8ecf2\"/><stop offset=\".7\" stop-color=\"#b4bcc8\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></radialGradient>\n<radialGradient id=\"greyDisk\" cx=\".5\" cy=\".5\" r=\".55\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".45\" stop-color=\"#d6dbe2\"/><stop offset=\".8\" stop-color=\"#8a929e\"/><stop offset=\"1\" stop-color=\"#3c424c\"/></radialGradient>\n<linearGradient id=\"greyFeather\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".5\" stop-color=\"#c4cad4\"/><stop offset=\"1\" stop-color=\"#6a7280\"/></linearGradient>\n<radialGradient id=\"pupil\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#3a3a4a\"/><stop offset=\".6\" stop-color=\"#0c0c14\"/><stop offset=\"1\" stop-color=\"#000\"/></radialGradient>\n<radialGradient id=\"shade\" cx=\".5\" cy=\".5\" r=\".5\"><stop offset=\".72\" stop-color=\"#000\" stop-opacity=\"0\"/><stop offset=\"1\" stop-color=\"#000\" stop-opacity=\".4\"/></radialGradient>\n<linearGradient id=\"lavaG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff4a0\"/><stop offset=\".3\" stop-color=\"#ffb21a\"/><stop offset=\".65\" stop-color=\"#ff4a0a\"/><stop offset=\"1\" stop-color=\"#9a1002\"/></linearGradient>\n<linearGradient id=\"basalt\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#6a5a58\"/><stop offset=\".5\" stop-color=\"#3a2e30\"/><stop offset=\"1\" stop-color=\"#1a1214\"/></linearGradient>\n<radialGradient id=\"heartR\" cx=\".35\" cy=\".3\" r=\".85\"><stop offset=\"0\" stop-color=\"#ffd0c8\"/><stop offset=\".35\" stop-color=\"#e8241a\"/><stop offset=\".8\" stop-color=\"#8a0606\"/><stop offset=\"1\" stop-color=\"#4a0202\"/></radialGradient>\n<linearGradient id=\"banner\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#5a0a0a\"/><stop offset=\".3\" stop-color=\"#b81c14\"/><stop offset=\".6\" stop-color=\"#d8301e\"/><stop offset=\"1\" stop-color=\"#6a0c0a\"/></linearGradient>\n<linearGradient id=\"iron\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#c8ccd2\"/><stop offset=\".5\" stop-color=\"#7a808a\"/><stop offset=\"1\" stop-color=\"#3a3e46\"/></linearGradient>\n<linearGradient id=\"bronze\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" stop-color=\"#4a2408\"/><stop offset=\".35\" stop-color=\"#b8682a\"/><stop offset=\".55\" stop-color=\"#f0b070\"/><stop offset=\"1\" stop-color=\"#5a2c0c\"/></linearGradient>\n<linearGradient id=\"dirt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#8a5a32\"/><stop offset=\"1\" stop-color=\"#3e220e\"/></linearGradient>\n<radialGradient id=\"stormDisk\" cx=\".4\" cy=\".35\" r=\".8\"><stop offset=\"0\" stop-color=\"#8fa6c8\"/><stop offset=\".55\" stop-color=\"#4a5a82\"/><stop offset=\"1\" stop-color=\"#232a48\"/></radialGradient>\n<linearGradient id=\"bolt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fffbd0\"/><stop offset=\".5\" stop-color=\"#ffe14a\"/><stop offset=\"1\" stop-color=\"#f0a010\"/></linearGradient>\n<linearGradient id=\"featherB\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#cfefff\"/><stop offset=\"1\" stop-color=\"#5fb8f0\"/></linearGradient></defs><g filter=\"url(#drop)\"><circle cx=\"128\" cy=\"128\" r=\"104\" fill=\"url(#stormDisk)\" stroke=\"#24170f\" stroke-width=\"6\"/>\n<g fill=\"#2e3758\" opacity=\".85\"><ellipse cx=\"86\" cy=\"70\" rx=\"44\" ry=\"20\"/><ellipse cx=\"166\" cy=\"62\" rx=\"40\" ry=\"18\"/><ellipse cx=\"126\" cy=\"54\" rx=\"34\" ry=\"18\"/></g>\n<g fill=\"#5d6c96\" opacity=\".7\"><ellipse cx=\"96\" cy=\"64\" rx=\"30\" ry=\"11\"/><ellipse cx=\"160\" cy=\"56\" rx=\"26\" ry=\"10\"/></g>\n<circle cx=\"128\" cy=\"128\" r=\"104\" fill=\"none\" stroke=\"url(#goldH)\" stroke-width=\"8\"/><circle cx=\"128\" cy=\"128\" r=\"110\" fill=\"none\" stroke=\"#24170f\" stroke-width=\"4\"/>\n<circle cx=\"128\" cy=\"140\" r=\"70\" fill=\"#7fd4ff\" opacity=\".22\" filter=\"url(#soft2)\"/>\n<g transform=\"translate(92 142) rotate(-28) scale(0.95)\">\n<path d=\"M0 -70 C26 -50 30 10 4 66 L-4 66 C-30 10 -26 -50 0 -70 Z\" fill=\"url(#featherB)\" stroke=\"#1d2a4a\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M0 -62 L0 78\" stroke=\"#1d2a4a\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n<g stroke=\"#5fa8dc\" stroke-width=\"2.5\" stroke-linecap=\"round\" opacity=\".8\"><path d=\"M0 -40 L-14 -30 M0 -20 L-17 -8 M0 0 L-17 12 M0 20 L-14 32 M0 -40 L14 -30 M0 -20 L17 -8 M0 0 L17 12 M0 20 L14 32\"/></g>\n<path d=\"M-8 -50 C-18 -20 -16 20 -6 50\" fill=\"none\" stroke=\"#fff\" stroke-width=\"4\" opacity=\".7\" stroke-linecap=\"round\"/></g><g transform=\"translate(164 142) rotate(28) scale(0.95)\">\n<path d=\"M0 -70 C26 -50 30 10 4 66 L-4 66 C-30 10 -26 -50 0 -70 Z\" fill=\"url(#featherB)\" stroke=\"#1d2a4a\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M0 -62 L0 78\" stroke=\"#1d2a4a\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n<g stroke=\"#5fa8dc\" stroke-width=\"2.5\" stroke-linecap=\"round\" opacity=\".8\"><path d=\"M0 -40 L-14 -30 M0 -20 L-17 -8 M0 0 L-17 12 M0 20 L-14 32 M0 -40 L14 -30 M0 -20 L17 -8 M0 0 L17 12 M0 20 L14 32\"/></g>\n<path d=\"M-8 -50 C-18 -20 -16 20 -6 50\" fill=\"none\" stroke=\"#fff\" stroke-width=\"4\" opacity=\".7\" stroke-linecap=\"round\"/></g><g transform=\"translate(128 132) rotate(0) scale(1.08)\">\n<path d=\"M0 -70 C26 -50 30 10 4 66 L-4 66 C-30 10 -26 -50 0 -70 Z\" fill=\"url(#featherB)\" stroke=\"#1d2a4a\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M0 -62 L0 78\" stroke=\"#1d2a4a\" stroke-width=\"4\" stroke-linecap=\"round\"/>\n<g stroke=\"#5fa8dc\" stroke-width=\"2.5\" stroke-linecap=\"round\" opacity=\".8\"><path d=\"M0 -40 L-14 -30 M0 -20 L-17 -8 M0 0 L-17 12 M0 20 L-14 32 M0 -40 L14 -30 M0 -20 L17 -8 M0 0 L17 12 M0 20 L14 32\"/></g>\n<path d=\"M-8 -50 C-18 -20 -16 20 -6 50\" fill=\"none\" stroke=\"#fff\" stroke-width=\"4\" opacity=\".7\" stroke-linecap=\"round\"/></g>\n<path d=\"M138 62 L104 132 L128 132 L112 196 L160 112 L134 112 L152 62 Z\" fill=\"url(#bolt)\" stroke=\"#5a3200\" stroke-width=\"5\" stroke-linejoin=\"round\"/>\n<path d=\"M140 70 L116 122\" stroke=\"#fff\" stroke-width=\"4\" opacity=\".8\" stroke-linecap=\"round\"/>\n<g transform=\"translate(128 236)\"><circle r=\"16\" fill=\"url(#gold)\" stroke=\"#24170f\" stroke-width=\"4\"/><path d=\"M3 -10 L-6 2 L0 2 L-4 11 L7 -2 L1 -2 Z\" fill=\"#ffe14a\" stroke=\"#24170f\" stroke-width=\"2\" stroke-linejoin=\"round\"/></g></g></svg>"};
const svgUrl = (name) => "data:image/svg+xml," + encodeURIComponent(PERK_SVG[name]);
/** v0.13: research with its own painted icon (Watcher Owl: an owl's eye). */
const RESEARCH_SVG = { R00V: "leadership", R002: "meleeprotocol", R005: "heavyweapons", R00K: "owl", R00J: "firearrow", R00C: "frenzy", R001: "potion", R006: "vault", R00X: "brain", R00W: "wing", R00U: "breastplate" }; // v0.19a1: painted icons for the reworked perks (dev/art/perk-icons-v019.py)
const researchArt = (item) => (RESEARCH_SVG[item.id] ? svgUrl(RESEARCH_SVG[item.id]) : artUrl(artFor(item)));
const PERK_ART = {
  recruit: () => iconUrl("attack"),
  feudal: () => iconUrl("crown"),
  gunpowder: () => "assets/art/perk-gunpowder.webp?v=v021u", // v0.21u: powder keg and cannonballs
  archery: () => "assets/art/perk-archery.webp?v=v021t", // v0.21t: painted target
  militia: () => "assets/art/perk-militia.webp?v=v021t", // v0.21t: painted sword
  evolution: () => "assets/art/perk-upgrade-tower.webp?v=v022q2", // v0.22q2: Upgrade Tower: tower with a green arrow
  gold: () => iconUrl("coin"),
  novice: () => "assets/art/perk-novice-v2.webp?v=v022p2", // v0.22p2: scroll, quill and candle (v0.21t: painted scroll and quill)
  volley: () => "assets/art/perk-volley.webp?v=v022q2", // v0.22q2: painted arrows (was an svg)
  pillage: (lv = 1) => `assets/art/perk-pillage-${Math.max(1, Math.min(3, lv || 1))}.webp?v=v022q2`, // v0.22q2: loot bag with dagger / two daggers / axe per level
  crowd: () => svgUrl("crowd"),
  golem: () => svgUrl("golem"),
  permafrost: () => svgUrl("permafrost"),
  wings: () => svgUrl("wings"),
  hellfire: () => svgUrl("lavafloor"), // v0.19j: a lava tile
  fireblock: () => svgUrl("fireblock"), // v0.19j
  burst: () => svgUrl("burst"),
  pocks: () => svgUrl("pocks"),
  treasure: () => "assets/art/perk-treasure.webp?v=v022q2", // v0.22q2: treasure chest
  voltage: () => svgUrl("voltage"),
  boots: () => svgUrl("boots"),
  exhume: () => svgUrl("exhume"),
  waterblock: () => svgUrl("waterblock"),
  airblock: () => svgUrl("airblock"), // v0.20c
  supergrowth: () => svgUrl("supergrowth"), // v0.20c
  // v0.12
  lone: () => "assets/art/perk-lone.webp?v=v022h1", // v0.21u: painted shield and sword; v0.22h1: zoomed in further, brighter glow
  autoloader: () => svgUrl("autoloader"), // v0.22g1: cannon, feed chute and gear
  hills: () => svgUrl("hills"), // v0.22h1: an uphill trail with mud and boulders
  stormfeathers: () => svgUrl("stormfeathers"), // v0.22h1: three feathers and a lightning bolt
  manufacture: () => svgUrl("manufacture"),
  // v0.21: the former level-up upgrades keep their painted icons
  owl: () => svgUrl("owl"),
  carmor: () => svgUrl("breastplate"),
  leadership: () => svgUrl("leadership"),
  tailwind: () => svgUrl("wing"),
  mind: () => svgUrl("brain"),
  medicine: () => svgUrl("potion"),
  melee: () => svgUrl("meleeprotocol"),
  heavy: () => svgUrl("heavyweapons"),
  bank: () => svgUrl("vault"),
  frenzy: () => svgUrl("frenzy"), // v0.21e: arrow head, sword and hand cannon in a green whirl
  wolves: () => researchArt(catalog.byId.R00D || { id: "R00D" }),
  firearrows: () => svgUrl("firearrow"),
  synthesizer: () => svgUrl("synthesizer"), // v0.20d
  forge: () => svgUrl("forge"), // v0.21c: Creep Forge
  scholar: () => svgUrl("scholar"), // v0.20d
  summon: () => svgUrl("summon"),
  nobility: () => svgUrl("nobility"),
  breeding: () => svgUrl("breeding"),
  pillar: () => svgUrl("pillar"),
  fort: () => "assets/art/perk-fort.webp?v=v022q2", // v0.22q2: wall of stone and stakes
  agolem: () => svgUrl("agolem"),
  monsun: () => svgUrl("monsun"),
  slave: () => svgUrl("slave"), // v0.14
  guardian: () => svgUrl("guardian"), // v0.14
  quarry: () => svgUrl("quarry"), // v0.18h
  backup: () => svgUrl("backup"),
  tides: () => svgUrl("tides"),
  sanction: () => svgUrl("sanction"),
};
// v0.22h1: the perk icons load a moment after a match starts, so a reward dialog never waits for them
let perkArtLoaded = false;
const perkArtKeep = [];
function preloadPerkArt() {
  if (perkArtLoaded) return;
  perkArtLoaded = true;
  // v0.22u2: every level picture too (Pillage 1–3), and research art
  const urls = new Set();
  for (const id of Object.keys(PERK_ART))
    for (let lv = 1; lv <= 3; lv++)
      try {
        urls.add(PERK_ART[id](lv));
      } catch {}
  for (const el of Object.values(ELEMENT_ICON)) urls.add(iconUrl(el));
  for (const u of urls) {
    if (!u) continue;
    const img = new Image();
    img.decoding = "async";
    img.src = u;
    img.decode?.().catch(() => {});
    perkArtKeep.push(img);
  }
}
// v0.22u2: also loads without a match (the card book opens from the main menu) – a moment after start-up
setInterval(() => {
  if (!perkArtLoaded && ((game && (game.time || 0) > 1.5) || performance.now() > 2500)) preloadPerkArt();
}, 1000);
/** Perk text with its numbers filled in (the gold perk shows the amount, not the formula). */
/** v0.12: `q` is the player and `next` true when the perk is offered (its values at the next level). */
const perkText = (id, level, q = game?.players[own], next = false) => {
  const pct = (x) => Math.round(x * 100) + "%",
    lv = Math.max(1, Math.min(PERKS[id]?.max || 1, (q?.perks?.[id] || 0) + (next ? 1 : 0))),
    l3 = Math.min(3, lv) - 1;
  return t(PERKS[id].text, {
    gold: format(perkGold(level, q, game)),
    treasure: format(treasureGold(game)),
    treasureInc: format(treasureIncome(game, q)), // v0.19e2
    manufacture: pct(MANUFACTURE.discount[l3]),
    // v0.21: the former level-up upgrades
    owl: format(OWL.range[Math.min(OWL.range.length, lv) - 1]),
    carmorHp: pctOf(CREEP_ARMOR.hp * lv),
    carmorInc: pctOf(CREEP_ARMOR.income * lv),
    leadership: pctOf(LEADERSHIP * lv),
    tailwind: pctOf(TAILWIND.speed * lv),
    mindHp: pctOf(MIND.hp * lv),
    mindSpeed: pctOf(MIND.speed * lv),
    medHp: pctOf(HEALING.hp * lv),
    medInc: pctOf(HEALING.income * lv),
    melee: pctOf(MELEE_PROTOCOL * lv),
    autoloader: num(AUTOLOADER * 100 * lv, { maximumFractionDigits: 1 }) + "%", // v0.22g1
    lone: pctOf(loneSpeed(Math.min(4, lv))), // v0.22g1: 75 / 125 / 150 / 166 %
    loneTowers: loneTowers(Math.min(4, lv)),
    heavy: pctOf(HEAVY_WEAPONS * lv),
    bank: pctOf(BANK.rate * lv),
    frenzy: pctOf(FRENZY * lv),
    wolves: lv,
    firearrows: pctOf(FIRE_ARROWS * lv),
    synthesizer: pct(SYNTHESIZER.discount[l3]), // v0.20d
    forge: pct(FORGE.discount[l3]), // v0.21c
    scholar: pct(SCHOLAR.exp * Math.min(10, lv)), // v0.21e
    nobility: pct(NOBILITY.discount[l3]),
    nobilityHp: pct(NOBILITY.hp * Math.min(3, lv)),
    breeding: pct(BREEDING.chance[l3]),
    breedingHp: pct(BREEDING.hp * Math.min(3, lv)),
    pillar: format(pillarDamage(q, lv)),
    monsun: MONSUN.duration[Math.min(5, lv) - 1],
    // v0.16g: values of the current (or offered) level instead of "a / b / c" lists
    hellfire: format(Math.round(hellfireDps(q, lv) * hellfireRound(game?.round || 0))), // v0.21n: the value of this round
    burst: format(burstDamage(q, lv)),
    boots: num(BOOTS.slow[Math.min(BOOTS.slow.length, lv) - 1] * 100, { maximumFractionDigits: 1 }) + "%", // v0.22: 25 / 35 / 45 / 52.5 / 60 %
    bootsInc: num(BOOTS.income * Math.min(BOOTS.slow.length, lv) * 100, { maximumFractionDigits: 1 }) + "%",
    exhume: pct(EXHUME.discount[l3]),
    blockCd: WATERBLOCK.cooldown[l3],
    fireBlockCd: FIREBLOCK.cooldown[l3], // v0.19j
    fireBlock: format(fireBlockDamage(q, Math.min(3, lv))),
    fireBlockBack: format(fireBlockBack(Math.min(3, lv))), // v0.21y
    blockBack: WATERBLOCK.back[l3],
    blockBackAir: WATERBLOCK.backAir[l3], // v0.22h1
    blockSlow: pct(WATERBLOCK.slow[l3]),
    airBlockCd: AIRBLOCK.cooldown[l3], // v0.20c
    airBlockBack: AIRBLOCK.back[l3],
    airBlockStun: AIRBLOCK.stun[l3],
    airBlockMonsun: AIRBLOCK.monsun[l3],
    airBlock: format(airBlockDamage(q, l3 + 1)),
    growth: format(Math.round(SUPERGROWTH[l3 + 1] * 1000) / 10) + "%",
    slaveStock: SLAVE.stock * Math.min(3, lv),
    slaveSpeed: pct(slaveSpeed(lv)),
    guardCd: GUARDIAN.cooldown,
    guardShield: format(guardShieldHp(q, game, Math.min(10, lv))), // v0.20c: from level, tier and round
    guardMagic: pct(guardMagic(Math.min(10, lv))),
    feudal: format(Math.round(feudalBonus(lv) * 1000) / 10) + "%", // v0.18b; v0.20b: up to level 10
    // v0.19b1: every "per level" value shows the amount of the current (or offered) level; cooldowns include Sanction Policy
    recruit: pct(0.1 * lv),
    archery: pct(0.05 * lv),
    gunpowder: format(gunpowderTiles(lv)), // v0.21u: table per level
    archeryFree: next && lv === 1 ? ". " + t("Next 2 Archer Towers are free") : "", // v0.19h1: only when first offered
    novice: pct(NOVICE[Math.min(5, lv)]), // v0.19g1
    volleyArrows: VOLLEY.perLevel * lv,
    volleyDmg: format(Math.round((VOLLEY.bonus + (game ? getStats(game, q?.id ?? own, "h003").damage : 0)) * (1 + VOLLEY.perRound * Math.max(0, game?.round || 0)))), // v0.19l: damage per arrow
    volleyCd: format(abilityCd(q, volleyCd(lv))), // v0.21c: by level
    wingsHp: pct(WINGS.hp * lv),
    wingsSpeed: pct(WINGS.speed * lv),
    wingsInc: pct(WINGS.income * lv),
    burstCd: format(abilityCd(q, BURST.cooldown)),
    voltage: pct(VOLTAGE.bonus * lv),
    pocks: pct(POCKS.hpShare * lv),
    permafrost: pct(FROZEN_GROUND * lv), // v0.22h1: Frozen Ground 5 % per level
    hills: pct(HILLS[Math.min(5, lv)]), // v0.22h1
    stormfeathers: pctOf(STORMFEATHERS * lv), // v0.22h1
    crowdMax: CROWD.threshold[l3], // v0.20d
    pillage: pct(PILLAGE.shares[Math.min(PILLAGE.max, lv)] || 0), // v0.19h1; v0.22m2: 14 / 24 / 30 %
    pillarCd: format(abilityCd(q, PILLAR.cooldown)),
    golemCd: format(abilityCd(q, AGOLEM.cooldown)),
    monsunCd: format(abilityCd(q, MONSUN.cooldown)),
  });
};
/** v0.19l: cooldown of an active-ability perk ("45 s"), shown in its own line instead of inside the text. */
const PERK_CD = { volley: (q, next) => volleyCd((q?.perks?.volley || 0) + (next ? 1 : 0) || 1), // v0.21c: 1 s less per level
  burst: () => BURST.cooldown, pillar: () => PILLAR.cooldown, agolem: () => AGOLEM.cooldown, monsun: () => MONSUN.cooldown };
const perkCd = (id, q = game?.players[own], next = false) => (PERK_CD[id] ? t("Cooldown {s} s", { s: format(abilityCd(q, PERK_CD[id](q, next))) }) : "");
const elementOf = (id) => catalog.factions.find((f) => f.id === id);
function pickCard(o, i, p) {
  if (o.type === "element") {
    const f = elementOf(o.id);
    return `<button class="pick-card pick-element el-${f.id}" data-pick="${i}" style="--el:${f.color}"><img src="${iconUrl(ELEMENT_ICON[f.id])}" alt=""><b>${esc(t(f.name))}</b><span>${t("Unlocks {name} towers and perks", { name: esc(t(f.name)) })}</span></button>`;
  }
  if (o.type === "perk") {
    const d = PERKS[o.id],
      level = p.perks?.[o.id] || 0,
      els = perkLook(o.id), // v0.21: frame also for "look" perks
      pel = els.length ? elementOf(els.find((e) => p.research[elementOf(e)?.unlock]) || els[0]) : null; // v0.10n: element perks get the element frame
    return `<button class="pick-card pick-perk perk-${o.id}${pel ? " pick-element el-" + pel.id : ""}" data-pick="${i}"${pel ? ` style="--el:${pel.color}"` : ""}><img src="${PERK_ART[o.id](level + 1)}" alt="" decoding="sync"><b>${esc(t(d.name))}</b><span>${valHtml(perkText(o.id, p.picks[0]?.level || p.level, p, true))}</span>${perkCd(o.id, p, true) ? `<small class="pick-cd">${valHtml(perkCd(o.id, p, true))}</small>` : ""}<small>${t("Level {a} → {b}", { a: level, b: level + 1 })}</small></button>`;
  }
  if (o.type === "quest") {
    const q = QUESTS[o.id];
    return `<button class="pick-card pick-quest quest-${q.kind}" data-pick="${i}"><i class="quest-ribbon">${t("Quest")}</i><img src="${questArt(o.id)}" alt=""><b>${esc(t(q.name))}</b><span>${valHtml(questText(o.id))}</span></button>`;
  }
  const [icon, title, note] =
    o.type === "gold"
      ? ["coin", `+${format(o.amount)} Gold`, t("Instant")]
      : o.type === "income"
        ? ["income", t("+{n} income", { n: format(o.amount) }), t("Every round")]
        : ["heart", t("+{n} lives", { n: o.amount }), t("Instant")];
  return `<button class="pick-card pick-generic" data-pick="${i}"><img src="${iconUrl(icon)}" alt=""><b>${title}</b><span>${note}</span></button>`;
}
// ---- v0.15: quests in the level dialog and in the list of chosen rewards ----------------------
const QUEST_SHIELD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff07a"/><stop offset=".35" stop-color="#ffc928"/><stop offset=".75" stop-color="#e08a0c"/><stop offset="1" stop-color="#9a5206"/></linearGradient><linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#c3cedc"/><stop offset="1" stop-color="#5e6b82"/></linearGradient><radialGradient id="r" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#ff9a8a"/><stop offset=".4" stop-color="#ee2a22"/><stop offset="1" stop-color="#8a0a0a"/></radialGradient></defs><path d="M128 20 216 52v62c0 62-38 102-88 122C78 216 40 176 40 114V52z" fill="#1a1208"/><path d="M128 30 206 58v56c0 55-33 92-78 111-45-19-78-56-78-111V58z" fill="url(#s)" stroke="#2b3240" stroke-width="5"/><path d="M128 50 188 72v42c0 44-25 74-60 91-35-17-60-47-60-91V72z" fill="url(#g)" stroke="#6b3a06" stroke-width="4"/><path d="M128 76l14 30 32 3-24 21 7 32-29-17-29 17 7-32-24-21 32-3z" fill="url(#r)" stroke="#5a0606" stroke-width="4" stroke-linejoin="round"/><path d="M70 74c20-8 40-12 58-14" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".6"/></svg>`;
const questArt = (id) => {
  const q = QUESTS[id];
  if (q.kind === "contract" && PERK_SVG[id + "contract"]) return svgUrl(id + "contract"); // v0.19a1
  if (q.kind === "banter") {
    const item = catalog.byId[q.model];
    if (item) return artUrl(artFor(item));
  }
  return "data:image/svg+xml," + encodeURIComponent(QUEST_SHIELD);
};
const share = (x) => Math.round(x * 100) + "%";
/** v0.19d2: contract text from its bonuses, plus the EXP it pays at the current round. */
function contractText(q) {
  // v0.19l: short: the condition, the reward ("N Gold & N EXP"), then what the n-th creep gets
  const s = share(q.share),
    gives = q.gives || ["hp", "income", "discount"],
    nth = q.place + (["st", "nd", "rd"][q.place - 1] || "th"),
    exp = contractExp(game?.round || 0),
    gold = contractGold(game?.round || 0),
    perks = [gives.includes("hp") && `+${s} HP`, gives.includes("income") && `+${s} Income`, gives.includes("restock") && t("recruit {s} faster", { s }), gives.includes("discount") && t("cost {s} less", { s })].filter(Boolean),
    list = perks.length > 1 ? perks.slice(0, -1).join(", ") + " " + t("and") + " " + perks[perks.length - 1] : perks[0] || "";
  return t("Breach within {n} rounds: {reward}. {nth} creep {list}", { n: q.rounds, reward: (gold ? `${format(gold)} Gold & ` : "") + `${format(exp)} EXP`, nth, list });
}
// v0.17: one short line per quest, the size of the other reward cards
function questText(id) {
  const q = QUESTS[id];
  if (q.kind === "untouchable") return t("No breach for {a}–{b} rounds. Reward: EXP and 2 rewards", { a: UNTOUCHABLE.min, b: UNTOUCHABLE.max });
  if (q.kind === "contract")
    return contractText(q); // v0.19d2: Blood Contract restocks faster instead of a discount, EXP by round
  return t("Kill {n} waves of {creeps}. Reward: {exp} EXP, {pair} cost {d} less", { n: BANTER.waves, creeps: t(q.plural), exp: BANTER.exp, pair: t(q.pair), d: share(BANTER.discount) });
}
/** Progress of the running quest, for its tile. */
function questProgress(p) {
  const st = p.quest;
  if (!st) return "";
  const q = QUESTS[st.id];
  if (q.kind === "untouchable") return t("{a} of {b} rounds without a breach", { a: st.clean, b: st.need });
  if (q.kind === "contract") {
    const left = Math.max(0, st.until - game.round + 1); // v0.19a1
    return left === 1 ? t("Last round to score a breach") : t("{n} rounds left to score a breach", { n: left });
  }
  if (!st.wave) {
    const n = Math.max(0, st.next - game.round) || 1;
    return n === 1 ? t("The first wave comes next round.") : t("The first wave comes in {n} rounds.", { n });
  }
  return t("Wave {a} of {b}", { a: st.wave, b: BANTER.waves });
}
function questEvent(e) {
  const name = t(QUESTS[e.id].name);
  if (e.state === "start") {
    toast(QUESTS[e.id].kind === "contract" ? t("{name}: score a breach within {n} rounds!", { name, n: e.need }) : QUESTS[e.id].kind === "untouchable" ? t("{name}: no breach for {n} rounds!", { name, n: e.need }) : (BANTER.delay === 1 ? t("{name} accepted: the first wave comes next round.", { name }) : t("{name} accepted: the first wave comes in {n} rounds.", { name, n: BANTER.delay })), "level");
    return;
  }
  if (e.state === "won") {
    const extra = (e.granted || []).map(optionName).filter(Boolean);
    questSplat(true, e);
    toast(t("Quest completed: {name}", { name }) + (e.exp ? ` · +${format(e.exp)} EXP` : "") + (extra.length ? ` · ${extra.join(", ")}` : ""), "tier");
    if (e.exp) hudPop("#own-level", `+${format(e.exp)} EXP`, "exp");
    tone("tier");
    if (game.players[own].picks.length && QUESTS[e.id].kind === "untouchable") {
      pickChain = performance.now() + 5000; // v0.19b1: the rewards open at once
      pickChainFrom = "";
    }
    return;
  }
  questSplat(false);
  toast(t("Quest failed: {name}", { name }), "boss");
  tone("error");
}
/** v0.17b: a parchment scroll over the board, 35 % transparent: "Quest finished" (green) or "Quest failed" (red). */
const QUEST_SCROLL = `<svg viewBox="0 0 320 120" aria-hidden="true"><defs><linearGradient id="qsP" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7e7bd"/><stop offset=".5" stop-color="#ecd49a"/><stop offset="1" stop-color="#d6b571"/></linearGradient><linearGradient id="qsR" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a5a24"/><stop offset=".45" stop-color="#e2bd7a"/><stop offset="1" stop-color="#7a4c1c"/></linearGradient></defs><path d="M34 18 Q160 6 286 18 L286 102 Q160 114 34 102 Z" fill="url(#qsP)" stroke="#6b4518" stroke-width="3"/><path d="M48 30 Q160 22 272 30 M48 92 Q160 100 272 92" fill="none" stroke="#b8925a" stroke-width="1.5" opacity=".6"/><rect x="14" y="10" width="24" height="100" rx="12" fill="url(#qsR)" stroke="#5a3510" stroke-width="3"/><rect x="282" y="10" width="24" height="100" rx="12" fill="url(#qsR)" stroke="#5a3510" stroke-width="3"/><circle cx="26" cy="10" r="6" fill="#5a3510"/><circle cx="26" cy="110" r="6" fill="#5a3510"/><circle cx="294" cy="10" r="6" fill="#5a3510"/><circle cx="294" cy="110" r="6" fill="#5a3510"/></svg>`;
function questSplat(won, e) {
  const host = $("arena") || document.body,
    el = document.createElement("div");
  // v0.17m: a won quest lists its EXP, gold and income rewards as numbers in their colours
  const rewards = won && e
    ? [
        e.exp > 0.004 ? `<span class="qs-exp">+${format(e.exp)} EXP</span>` : "",
        e.gold > 0.004 ? `<span class="qs-gold"><img src="${iconUrl("coin")}" alt="">+${format(e.gold)}</span>` : "",
        e.income > 0.004 ? `<span class="qs-inc">+${formatInc(e.income)} ${t("income")}</span>` : "",
      ].join("")
    : "";
  el.className = `quest-splat ${won ? "won" : "lost"}${rewards ? " has-rewards" : ""}`;
  el.setAttribute("role", "status");
  el.innerHTML = `${QUEST_SCROLL}<b>${won ? t("Quest finished") : t("Quest failed")}</b>${rewards ? `<span class="qs-rewards">${rewards}</span>` : ""}`;
  host.querySelector(".quest-splat")?.remove();
  host.append(el);
  setTimeout(() => el.remove(), 1900);
}
/** v0.15: a reward option's display name (for granted quest rewards). */
function optionName(o) {
  if (o.type === "perk") return t(PERKS[o.id]?.name || "");
  if (o.type === "element") return t(elementOf(o.id)?.name || "");
  return "";
}
/** Rewards taken so far, as small tiles with their level (v0.08b). */
/** v0.08c: with no reward waiting, the level button shows what every player has chosen so far. */
function playerName(q) {
  if (q.id === own) return myName();
  if (isFfa()) return seatName(q.id);
  if (sessionMode === "training") return `${t("AI")} · ${t(AI_NAMES[q.aiLevel || game.aiLevel] || "Normal")}`;
  if (sessionMode === "online") return onlineName(q) || t("Enemy");
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
/** v0.17q: tooltip text of an element: what it unlocks (its perks by name). */
function elementTip(f) {
  const perks = Object.keys(PERKS).filter((id) => perkElements(id).includes(f.id)).map((id) => t(PERKS[id].name));
  return t("Unlocks {name} towers and perks", { name: t(f.name) }) + (perks.length ? ". " + t("Perks") + ": " + perks.join(", ") : "");
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
    if (p.research[f.unlock]) tiles.push(tile(` el-${f.id}`, ` style="--el:${f.color}"`, t(f.name), iconUrl(ELEMENT_ICON[f.id]), 0, elementTip(f))); // v0.17q: element tooltip with what it unlocks
  for (const r of catalog.research) {
    const level = p.research[r.id] || 0;
    if (!level || !r.playerResearch || !r.playable || catalog.factions.some((f) => f.research === r.id)) continue;
    const el = elementOf(RESEARCH_ELEMENT[r.id]);
    tiles.push(tile(el ? " el-" + el.id : "", el ? ` style="--el:${el.color}"` : "", itemName(r), researchArt(r), level, cardHint(r, true)));
  }
  for (const [id, level] of Object.entries(p.perks || {}))
    if (level && PERKS[id] && !PERKS[id].powerup) {
      // v0.17q: element perks carry their element frame here too (like in the level dialog)
      const els = perkLook(id),
        pel = els.length ? elementOf(els.find((e) => p.research[elementOf(e)?.unlock]) || els[0]) : null;
      tiles.push(tile(` perk-${id}${pel ? " el-" + pel.id : ""}`, pel ? ` style="--el:${pel.color}"` : "", t(PERKS[id].name), PERK_ART[id](level), level, perkText(id, p.level, p) + (perkCd(id, p) ? ". " + perkCd(id, p) : "")));
    }
  // v0.15: quests: "?" while running, a green tick when won, a red cross when failed
  const questTile = (id, state) => {
    const mark = { run: "?", won: "✓", lost: "✗" }[state],
      note = state === "run" ? questProgress(p) : t(state === "won" ? "Quest completed" : "Quest failed"),
      tip = ` data-tip="${esc(t(QUESTS[id].name))}" data-tip-text="${esc(note + " · " + questText(id))}" data-tip-level=""`,
      inner = `<img src="${questArt(id)}" alt=""><b class="quest-mark">${mark}</b>`;
    return names
      ? `<span class="owned-chip"${tip}><span class="owned-tile quest-tile quest-${state}">${inner}</span><span>${esc(t(QUESTS[id].name))}</span></span>`
      : `<span class="owned-tile quest-tile quest-${state}"${tip}>${inner}</span>`;
  };
  if (p.quest && QUESTS[p.quest.id]) tiles.push(questTile(p.quest.id, "run"));
  for (const [id, result] of Object.entries(p.questLog || {})) if (QUESTS[id]) tiles.push(questTile(id, result));
  return tiles.length ? `<div class="owned-row">${label ? `<span class="modal-label">${t("Already chosen")}</span>` : ""}<div class="owned-tiles${names ? " named" : ""}">${tiles.join("")}</div></div>` : "";
}
/** The level reward dialog: three choices, an element on the opening pick and at levels 10 and 25. */
/** v0.19b1: after a pick (or a quest that grants rewards) the next open reward dialog follows at once. */
let pickChain = 0,
  pickChainFrom = ""; // the reward just taken: online it stays in the list until the host's state arrives
const pickKey = (k) => (k ? k.kind + ":" + k.level + ":" + k.options.map((o) => o.type + (o.id || o.amount || "")).join(",") : "");
function pickModal() {
  const p = game?.players[own],
    pick = p?.picks[0];
  if (!pick) return abilitiesModal();
  const title = pick.kind === "element" ? (pick.level <= 1 ? t("Choose your first element") : t("Level {n}: new element", { n: pick.level })) : t("Level {n}: choose a reward", { n: pick.level });
  showModal(
    `${modalHeader(title)}<div class="pick-grid">${pick.options.map((o, i) => pickCard(o, i, p)).join("")}</div>${ownedTiles(p)}${p.picks.length > 2 ? `<p class="modal-note">${t("{n} more rewards after this.", { n: p.picks.length - 1 })}</p>` : p.picks.length > 1 ? `<p class="modal-note">${t("One more reward after this.")}</p>` : pick.kind === "element" && pick.level <= 1 ? "" : `<p class="modal-note">${t("EXP comes from breakthroughs, boss creeps and achievements.")}</p>`}`,
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
          pickChain = performance.now() + 5000; // v0.19b1: online the next reward arrives with the host's state
          pickChainFrom = isFollower() ? pickKey(game.players[own].picks[0]) : "";
          if (game.players[own].picks.length && !isFollower()) pickModal();
          else closeModal();
        }),
    );
}
/**
 * v0.17q: the level halo turns by the wall clock (one turn in 6 s), never by a CSS animation that a
 * phone could restart or rush: the angle comes from the time, capped at 2 turns per second.
 */
const HALO_TURN_MS = 6000,
  HALO_MAX_TURNS_PER_S = 2;
let haloFrame = 0,
  haloLast = 0,
  haloAngle = 0;
function haloTick(now) {
  haloFrame = 0;
  const btn = $("level-button");
  if (!btn || btn.hidden || !btn.classList.contains("ready")) return;
  const dt = haloLast ? Math.min(250, Math.max(0, now - haloLast)) : 0;
  haloLast = now;
  haloAngle = (haloAngle + Math.min((dt / HALO_TURN_MS) * 360, (dt / 1000) * 360 * HALO_MAX_TURNS_PER_S)) % 360;
  btn.style.setProperty("--halo", haloAngle.toFixed(1) + "deg");
  haloFrame = requestAnimationFrame(haloTick);
}
function ensureHalo() {
  if (haloFrame) return;
  haloLast = 0;
  haloFrame = requestAnimationFrame(haloTick);
}
function refreshLevelButton(p) {
  const btn = $("level-button");
  btn.hidden = !begun || !!p.out; // v0.18c: no level button once you are out
  if (btn.hidden) return;
  // v0.17i: only touch the DOM when something changed (constant rewrites made the glow flicker on phones)
  if ($("level-number").textContent !== String(p.level)) $("level-number").textContent = p.level;
  if ($("level-pending").hidden !== !p.picks.length) $("level-pending").hidden = !p.picks.length;
  const unspent = String(p.picks.length);
  if ($("level-pending").textContent !== unspent) $("level-pending").textContent = unspent;
  // v0.09t: the button fills with experience from the bottom up
  const fill = Math.round(Math.max(0, Math.min(1, p.exp / Math.max(1, p.expNext))) * 1000) / 10 + "%";
  if (btn.style.getPropertyValue("--xp") !== fill) btn.style.setProperty("--xp", fill);
  if (btn.classList.contains("ready") !== p.picks.length > 0) btn.classList.toggle("ready", p.picks.length > 0);
  if (p.picks.length > 0) ensureHalo(); // v0.17q
  // Left of the board: the level button on top, the auto-spawn slot at the bottom edge.
  const z = arena?.geometry?.();
  if (z?.side) {
    const dock = $("side-dock"),
      size = Math.round(z.side.w),
      x = Math.round(z.side.x) + "px",
      // v0.17c: never under the send buttons, which overlap the board's lower edge on phones
      cardsTop = $("cards").getBoundingClientRect().top - $("arena").getBoundingClientRect().top,
      bottom = Math.min(z.top + z.bh, cardsTop > 0 ? cardsTop - 6 : Infinity), // v0.09: no exit strip
      dockTop = Math.round(bottom - (dock.offsetHeight || size + 34)) + "px",
      top = Math.round(z.side.y + 14) + "px";
    if (z.col) placeColumn(z, dock, size);
    else if (z.full) {
      // Mobile Max: the auto slot floats in the bottom-left corner, right above the cards
      const fullTop = Math.round(cardsTopInArena() - 8 - (dock.offsetHeight || size + 34)) + "px";
      if (dock.style.left !== x || dock.style.top !== fullTop) Object.assign(dock.style, { left: x, top: fullTop, width: size + "px" });
    } else if (dock.style.left !== x || dock.style.top !== dockTop) Object.assign(dock.style, { left: x, top: dockTop, width: size + "px" });
    if (dock.style.getPropertyValue("--slot") !== size + "px") dock.style.setProperty("--slot", size + "px");
    if (btn.style.left !== x) btn.style.left = x;
    if (btn.style.top !== top) btn.style.top = top;
    if (btn.style.getPropertyValue("--slot") !== size + "px") btn.style.setProperty("--slot", size + "px");
  }
  // v0.19b1: more rewards waiting after a pick (or from a quest): offer the next one at once
  if (pickChain) {
    if (performance.now() > pickChain) pickChain = 0;
    else if (p.picks.length && pickKey(p.picks[0]) !== pickChainFrom && !$("modal").open && game.running && !shownResult) {
      pickChain = 0;
      pickModal();
    }
  }
  // the opening element choice opens by itself
  const key = `${game.seed}:${own}`;
  if (p.picks[0]?.kind === "element" && p.picks[0].level <= 1 && openingShown !== key && !$("modal").open && game.running) {
    openingShown = key;
    pickModal();
  }
}
/** v0.17d, mobile layout B: the bottom bar becomes the button column right of the board — help and
 * options on top, Build and Send at the bottom (above the send buttons, which reach over the board's
 * lower edge), the auto slot right above them. */
function placeColumn(z, dock, size) {
  const nav = document.querySelector(".bottom-nav"),
    shell = document.querySelector(".game-shell"),
    arenaBox = $("arena").getBoundingClientRect(),
    deck = document.querySelector(".command-deck")?.getBoundingClientRect(),
    rise = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--send-h")) || 0,
    offset = arenaBox.top - (shell?.getBoundingClientRect().top || 0),
    cardsTop = $("cards").getBoundingClientRect().top - arenaBox.top,
    // v0.17i: in Send the column ends above the tall send buttons; in Build it drops down to the (lower) tower cards
    sendTop = shell?.dataset.page === "send" ? (deck ? deck.bottom - rise - arenaBox.top : Infinity) : cardsTop > 0 ? cardsTop - 2 : Infinity,
    bottom = Math.min(z.top + z.bh, sendTop - 4),
    { x, y, w, sq } = z.col;
  if (nav) {
    const st = { left: Math.round(x) + "px", top: Math.round(y + offset) + "px", width: Math.round(w) + "px", height: Math.round(bottom - y) + "px" };
    if (Object.entries(st).some(([k, v]) => nav.style[k] !== v)) Object.assign(nav.style, st);
    if (nav.style.getPropertyValue("--sq") !== sq + "px") nav.style.setProperty("--sq", sq + "px");
  }
  const left = Math.round(z.side.x) + "px",
    big = 2 * sq + 4, // v0.17h: Send above Build, both twice as big (one column wide)
    dockTop = Math.round(bottom - 2 * big - 4 - 8 - (dock.offsetHeight || size + 34)) + "px";
  if (dock.style.left !== left || dock.style.top !== dockTop) Object.assign(dock.style, { left, top: dockTop, width: size + "px" });
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
  // v0.10q: no wave chip over the board any more; the round timer glows red when the next
  // round brings a neutral wave and names it underneath ("Neutral 4 · Air").
  const chip = $("wave-chip"),
    next = game.waves && game.running ? nextWave(game) : null,
    plate = document.querySelector(".round-plate"),
    note = $("wave-note");
  chip.hidden = true;
  const coming = !!next && next.seconds <= game.incomeRemaining + 0.01;
  plate?.classList.toggle("wave-next", coming);
  if (note) {
    note.hidden = !coming;
    const text = coming ? `${t("Neutral {n}", { n: next.number })} · ${t(next.label)}` : "";
    if (note.textContent !== text) note.textContent = text;
  }
  if (!next) return;
  const seconds = Math.max(0, Math.ceil(next.seconds)),
    hitsAir = p.towers.some((t) => catalog.byId[t.typeId]?.targets?.includes("air")),
    airRisk = (next.flying || next.mixed) && !hitsAir;
  if (plate) plate.title = coming ? t(next.tip) : "";
  if (airRisk && seconds <= 12 && warnedWave !== next.number && begun) {
    warnedWave = next.number;
    toast("Flyers incoming! Only archers, magic and halls hit air.");
  }
}
/** v0.14: the player with the single highest income gets a soft golden glitter on their income. */
function markTopIncome(p, enemy) {
  const live = game.players.filter((q) => !q.out),
    value = (q) => q.income + (q.incomeDecimal || 0) / 100,
    best = Math.max(...live.map(value)),
    top = live.filter((q) => value(q) === best),
    lead = top.length === 1 ? top[0].id : -1;
  $("own-income").classList.toggle("top-income", lead === p.id);
  $("rival-income").classList.toggle("top-income", !isFfa() && lead === enemy.id);
  for (const cell of document.querySelectorAll("#enemy-stack [data-seat]")) cell.querySelector(".ec-inc")?.classList.toggle("top-income", lead === Number(cell.dataset.seat));
}
const matchClock = () =>
  game ? `${String(Math.floor(game.time / 60)).padStart(2, "0")}:${String(Math.floor(game.time % 60)).padStart(2, "0")}` : "00:00";
// v0.21l: write to the page only what changed (refreshUI runs every 150 ms)
let uiRefreshCount = 0;
function setText(el, value) {
  const v = String(value);
  if (el && el.textContent !== v) el.textContent = v;
}
function setProp(el, name, value) {
  const v = String(value);
  if (el && el.getAttribute(name) !== v) el.setAttribute(name, v);
}
function setStyle(el, name, value) {
  if (el && el.style[name] !== value) el.style[name] = value;
}
function refreshUI() {
  if (!game) return;
  uiRefreshCount++;
  const p = game.players[own],
    enemy = game.players[rivalIndex()];
  if (enemy.id !== shownRival) {
    shownRival = enemy.id;
    applyColors();
  }
  setText($("gold"), resourceNumber(Math.floor(p.gold)));
  setProp($("gold"), "title", format(Math.floor(p.gold)) + " Gold");
  setText($("income"), "+" + resourceNumber(p.income + (p.incomeDecimal || 0) / 100));
  setProp($("income"), "title", t("+{n} income", { n: format(p.income + (p.incomeDecimal || 0) / 100) }));
  bumpNumber("own-lives", p.lives);
  // whole numbers only (v0.07j); v0.20: in team games what the player gets each round from the shared team income
  const incomeOf = (pl) => "+" + resourceNumber(Math.floor(!game.teams ? pl.income : game.teams.gold === "shared" ? teamIncome(game, pl) : teamIncome(game, pl) / Math.max(1, teamMates(game, pl).length)));
  setText($("gold-income"), incomeOf(p));
  setText($("own-gold"), resourceNumber(Math.floor(p.gold)));
  setText($("own-income"), incomeOf(p));
  setText($("rival-gold"), resourceNumber(Math.floor(enemy.gold)));
  setText($("rival-income"), incomeOf(enemy));
  for (const [prefix, pl] of [["own", p], ["rival", enemy]]) {
    setStyle($(prefix + "-exp"), "width", `${Math.min(100, (100 * pl.exp) / Math.max(1, pl.expNext))}%`); // v0.21l: only on change
    setText($(prefix + "-level"), pl.level);
    setText($(prefix + "-tier"), pl.tier || 1); // v0.22u2: tier next to the level
  }
  refreshLevelButton(p);
  refreshVolley(p);
  refreshBurst(p, p.perks?.volley > 0 ? 2 : 1);
  refreshAbilities(p); // v0.12
  layoutAbilities(p); // v0.17k
  bumpNumber("rival-lives", enemy.lives);
  renderEnemyStack();
  markTopIncome(p, enemy);
  setPortrait(document.querySelector(".player-plate.rival .plate-face .portrait"), enemy);
  {
    // v0.19c1: your own plate wears your player icon
    const oi = document.querySelector(".player-plate.own .plate-face .portrait"),
      src = ownPortrait();
    if (oi && oi.getAttribute("src") !== src) {
      oi.setAttribute("src", src);
      oi.classList.toggle("creep-portrait", src !== "assets/art/portrait-player.webp");
    }
  }
  document.querySelector(".player-plate.own").classList.toggle("out", !!p.out);
  document.querySelector(".game-shell").classList.toggle("knocked-out", !!p.out && begun); // v0.18c: cards greyed out and disabled
  document.querySelector(".player-plate.rival").classList.toggle("out", !isFfa() && !!enemy.out);
  updateNudge(p);
  const secs = Math.max(0, Math.ceil(game.incomeRemaining));
  const manualPause = uiPauses.has("manual") && game.paused; // v0.18h
  setText($("income-time"), manualPause ? "II" : secs);
  $("income-time").classList.toggle("soon", secs <= 3 && !game.paused && game.running);
  document.querySelector(".round-plate")?.classList.toggle("manual-pause", manualPause);
  if ($("menu-clock")) setText($("menu-clock"), matchClock());
  setStyle($("income-ring"), "strokeDashoffset", String(106.82 * (1 - Math.min(1, game.incomeRemaining / (game.warmup ? 12 : 15)))));
  setText($("match-clock"), matchClock());
  setText($("speed-label"), game.paused ? "PAUSE" : game.warmup ? t("WARM UP") : "LIVE");
  $("speed-button").hidden = !!room || !begun;
  if (room || !begun) gameSpeed = 1;
  setText($("speed-button"), gameSpeed + "×");
  $("speed-button").classList.toggle("fast", gameSpeed > 1);
  const ownPlate = document.querySelector(".player-plate.own .plate-name");
  if (ownPlate && ownPlate.textContent !== myName()) ownPlate.textContent = myName();
  $("rival-name").textContent =
    sessionMode === "campaign"
      ? seatName(enemy.id)
      : sessionMode === "ffa"
      ? `${seatName(enemy.id)} · ${t(AI_NAMES[enemy.aiLevel || game.aiLevel] || "Normal")}`
      : sessionMode === "training"
        ? `${t("AI")} · ${t(AI_NAMES[enemy.aiLevel || game.aiLevel] || "Normal")}`
        : sessionMode === "online"
          ? onlineName(enemy) || seatName(enemy.id) || t("Enemy")
          : t(own === 0 ? "Player 2" : "Player 1");
  setText($("rival-sub"), t(sessionMode === "training" || sessionMode === "ffa" ? "AI" : sessionMode === "hotseat" ? "Local" : connected ? "Connected" : "Connecting …"));
  setText($("arena-label"), view === own ? t("Your arena") : isFfa() || sessionMode === "online" ? seatName(view) : t("Enemy")); // v0.14
  setText($("view-button"), t(tab !== "build" ? "Back" : view === own ? "Enemy" : "Back"));
  $("view-button").classList.toggle("active", view !== own);
  const goal = game.mission?.goal; // v0.17: survive N rounds / win by round N
  setText($("round-label"), game.warmup
    ? t("Warm up")
    : goal?.survive
      ? t("Round {n}/{m}", { n: game.round, m: goal.survive })
      : goal?.deadline
        ? t("Round {n}/{m}", { n: game.round, m: goal.deadline })
        : t("Round {n}", { n: game.round }));
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
    setText(b.querySelector(".price"), label); // v0.21l: DOM writes only on change
    b.querySelector(".price").classList.toggle("free", isFreeLabel(label));
    const note = item.kind === "send" ? b.querySelector(".card-note") : null;
    if (note) {
      const inc = incomeFor(item),
        text = "+" + formatInc(inc);
      if (note.textContent !== text) note.textContent = text;
      note.classList.toggle("buffed", inc > item.income + 0.004);
    }
    setText(b.querySelector(".card-status"), cardStatus(item));
    if (item.kind === "send" && !game.players[own].out) cardLock(b, Math.max(game.warmup ? 1 : 0, lockRoundsLeft(game, game.players[own].stock[item.id]))); // v0.15/v0.17
    const stock = b.querySelector(".card-stock");
    if (stock) setText(stock, stockCount(item));
    // v0.21l: the spoken label needs the card text, which is costly: rebuilt when price or state change, else every 4th refresh
    const ariaKey = label + "|" + a.ok + "|" + (a.reason || "");
    if (b.dataset.ariaKey !== ariaKey || uiRefreshCount % 4 === 0) {
      b.dataset.ariaKey = ariaKey;
      setProp(b, "aria-label", `${itemName(item)}, ${label}, ${cardHint(item)}${a.ok ? "" : ", " + t(a.reason)}`);
    }
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
  // v0.18a: tapping a pre-build cancels it, with or without a tower card picked
  if (cancelQueuedAt(tapped)) return;
  if (!selected) {
    note("Pick a tower first.");
    return;
  }
  selectedTower = null;
  $("tower-panel").hidden = true;
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
/** v0.18a: cancels the pre-build on that field (tap, click or right click); true if there was one. */
let queueCancelAt = 0;
function cancelQueuedAt(cell) {
  if (!game || view !== own || !cell) return false;
  const hit = queued.find((q) => {
    const n = footprintOf(q.id);
    return cell.gridX >= q.gridX && cell.gridX < q.gridX + n && cell.gridY >= q.gridY && cell.gridY < q.gridY + n;
  });
  if (!hit) return false;
  queued = queued.filter((q) => q !== hit);
  queueCancelAt = performance.now();
  pending = null;
  note("Pre-build cancelled.");
  tone("tap");
  syncAutoHold();
  refreshUI();
  return true;
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
  if (queuedFor !== gameKey()) {
    queued = [];
    upQueue = [];
    queuedFor = gameKey();
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
      if (result?.ok || isFollower()) continue;
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
let lastSlotTap = 0; // v0.18h
let slotSwitchAt = -1e9; // v0.22m2: the tap that switched an empty slot's mode, so a quick second tap is not a double tap
/** v0.22m2: Default → Eco → Tier Up → Default; the slot's creep is cleared. */
function nextAutoMode() {
  const p = game.players[own],
    cur = AUTO_MODES.includes(p.autoMode) ? p.autoMode : "default",
    next = AUTO_MODES[(AUTO_MODES.indexOf(cur) + 1) % AUTO_MODES.length];
  dispatch({ type: "autoSend", id: null, mode: next, active: next !== "default" });
  tone("select");
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
      ghost.src = towerArtUrl(artFor(catalog.byId[sp.id]));
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
        const p = game.players[own],
          now = performance.now();
        if (now - slotSwitchAt < 380) slotSwitchAt = -1e9; // the second tap of a double tap on the empty slot
        else if (!p.autoSend && !(AUTO_MODES.includes(p.autoMode) && p.autoMode !== "default")) {
          // v0.22m2: the empty slot switches the mode on a single tap
          lastSlotTap = 0;
          slotSwitchAt = now;
          nextAutoMode();
        } else if (now - lastSlotTap < 380) {
          // v0.18h: a double tap switches Default → Eco → Tier Up and clears the slot's creep
          lastSlotTap = 0;
          nextAutoMode();
        } else {
          lastSlotTap = now;
          if (p.autoSend || (p.autoMode && p.autoMode !== "default")) dispatch({ type: "autoSend", active: p.autoSendActive === false });
        }
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
        ghost.src = towerArtUrl(artFor(catalog.byId[drag.id]));
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
/** v0.09w: First Blood — a short bloody pop-up for everyone (v0.14: once per match, no voice line). */
const firstBloodShown = new Set();
function firstBlood(e) {
  const key = game.seed + ":" + (e.kind || "first"); // v0.19j: Bloodthirst and Bloodrage use the same splat
  if (firstBloodShown.has(key)) return;
  firstBloodShown.add(key);
  const mine = e.player === own;
  if (mine) hudPop("#own-level", `+${e.exp ?? 50} EXP`, "exp");
  const pop = document.createElement("div");
  pop.className = "first-blood ach-splat" + (e.kind ? " " + e.kind : "");
  pop.innerHTML = `<svg viewBox="0 0 200 120" aria-hidden="true"><path d="M100 8c14 0 18 14 30 10s22-6 26 6-8 18 4 24 30 4 28 18-20 10-26 18 6 22-8 26-20-8-30-2-10 12-24 10-14-12-26-14-24 10-34 0 4-18-6-26-28-6-30-20 16-14 20-22-10-18 2-26 22 4 30-2S86 8 100 8Z" fill="#9e0b0b"/><circle cx="18" cy="30" r="5" fill="#9e0b0b"/><circle cx="186" cy="92" r="6" fill="#9e0b0b"/><circle cx="168" cy="14" r="3.5" fill="#9e0b0b"/><circle cx="34" cy="104" r="4" fill="#9e0b0b"/><path d="M60 100q2 14 0 18M128 104q3 10 1 14" stroke="#9e0b0b" stroke-width="5" stroke-linecap="round"/></svg><b>${t(e.name ? e.name + "!" : "First Blood!")}</b><small><span class="fb-name" style="--fb:${TEAM_COLORS[seatColors()[e.player]]?.css || "#ffd2c4"}">${esc(playerName(game.players[e.player]))}</span><span class="fb-exp">+${e.exp ?? 50} EXP</span></small>`; // v0.17: name larger, in the player's colour
  $("app")?.appendChild(pop) || document.body.appendChild(pop);
  setTimeout(() => pop.remove(), 2100); // v0.17g: splats fade out after 1.5 s; v0.21g: achievement splats 0.2 s longer
  sfx.play("firstBlood");
  haptic([60, 40, 90]);
}
/**
 * v0.19j: Constructor / Highrise / Tycoon — the achiever's most valuable tower in a bronze, silver or gold
 * frame, the title and "<name> +EXP" below like First Blood; 30 % see-through and fading like every splat.
 */
/** v0.19k: medieval tower pictogram for the builder splats: bronze a plain keep, silver a tall tower, gold a castle tower with a banner. */
function towerPictogram(frame = "bronze") {
  const tall = frame === "gold" ? 3 : frame === "silver" ? 2 : 1,
    top = tall === 3 ? 20 : 96 - tall * 22, // v0.19l: Tycoon: a taller main tower instead of the banner
    merlons = (x0, w, y) => Array.from({ length: Math.round(w / 16) }, (_, i) => `<rect x="${x0 + i * 16}" y="${y - 12}" width="10" height="13"/>`).join(""),
    side = tall >= 2 ? `<path d="M14 120V86h28v34z"/>${merlons(14, 28, 86)}<path d="M86 120V86h28v34z"/>${merlons(86, 28, 86)}` : "",
    flag = "",
    windows = Array.from({ length: tall }, (_, i) => `<rect x="58" y="${top + 14 + i * 22}" width="12" height="15" rx="6" fill="#120a04"/>`).join("");
  return `<svg class="ts-picto" viewBox="0 0 128 128" aria-hidden="true"><defs><linearGradient id="tpM-${frame}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--m1)"/><stop offset=".55" style="stop-color:var(--m2)"/><stop offset="1" style="stop-color:var(--m3)"/></linearGradient></defs>
<g fill="url(#tpM-${frame})" stroke="#1a0f06" stroke-width="2.5" stroke-linejoin="round">${side}<path d="M36 120V${top}h56v${120 - top}z"/>${merlons(34, 60, top)}</g>
<path d="M54 120v-16a10 10 0 0 1 20 0v16z" fill="#120a04"/>${windows}
<path d="M40 ${top + 4}v${112 - top}" stroke="#fff" stroke-opacity=".35" stroke-width="3"/>
<path d="M8 121h112" stroke="#1a0f06" stroke-width="3"/>${flag}</svg>`;
}
const towerSplatShown = new Set();
function towerSplat(e) {
  const key = game.seed + ":" + e.achievement;
  if (towerSplatShown.has(key)) return;
  towerSplatShown.add(key);
  if (e.player === own) hudPop("#own-level", `+${e.exp} EXP`, "exp");
  const color = TEAM_COLORS[seatColors()[e.player]]?.css || "#ffd2c4",
    pop = document.createElement("div");
  pop.className = `tower-splat ach-splat ts-${e.frame || "bronze"}`;
  // v0.19k: a drawn pictogram of a medieval tower (taller and grander from Constructor to Tycoon), not a unit picture
  pop.innerHTML = `<span class="ts-frame">${towerPictogram(e.frame)}</span><b>${esc(t(e.name))}!</b><small><span class="fb-name" style="--fb:${color}">${esc(playerName(game.players[e.player]))}</span><span class="fb-exp">+${e.exp} EXP</span></small>`;
  $("app")?.appendChild(pop) || document.body.appendChild(pop);
  setTimeout(() => pop.remove(), 2100); // v0.21g
  sfx.play(e.frame === "gold" ? "victory" : "tier");
}
/**
 * v0.17q: 3+ player matches: a torn, sagging banner in the player's colour when a player is out,
 * "<name> defeated" with the name in their colour, their portrait below. Fades like every splat.
 */
const DEFEAT_BANNER = `<svg viewBox="0 0 240 150" aria-hidden="true" preserveAspectRatio="none"><path d="M8 14 L232 10 L226 40 L234 72 L222 104 L206 98 L196 128 L178 112 L160 138 L140 116 L122 132 L104 112 L84 136 L66 114 L48 130 L36 102 L16 108 L22 74 L6 44 Z" fill="var(--dc)" stroke="#1a0f0a" stroke-width="4" stroke-linejoin="round"/><path d="M8 14 L232 10 L230 24 L10 28 Z" fill="#000" opacity=".22"/><path d="M58 40 l10 14 -6 12 M170 44 l-8 16 10 10 M120 92 l-6 10 8 8" fill="none" stroke="#1a0f0a" stroke-width="3" stroke-linecap="round" opacity=".55"/><circle cx="196" cy="58" r="6" fill="#1a0f0a" opacity=".6"/><circle cx="40" cy="80" r="4" fill="#1a0f0a" opacity=".6"/><path d="M0 12 Q120 2 240 8" fill="none" stroke="#5a3a1c" stroke-width="7" stroke-linecap="round"/></svg>`;
function defeatSplat(id) {
  const q = game.players[id];
  if (!q) return;
  const color = TEAM_COLORS[seatColors()[id]]?.css || "#a8a8a8",
    face = id === own ? ownPortrait() : portraitFor(q),
    pop = document.createElement("div");
  pop.className = "defeat-splat";
  pop.style.setProperty("--pc", color);
  pop.innerHTML = `<div class="ds-banner" style="--dc:color-mix(in srgb, ${color} 62%, #1a0f0a)">${DEFEAT_BANNER}<b><span class="ds-name">${esc(playerName(q))}</span> ${t("defeated")}</b></div><img class="ds-face" src="${face}" alt="">`;
  $("app")?.appendChild(pop) || document.body.appendChild(pop);
  setTimeout(() => pop.remove(), 1900);
  if (id !== own) tone("defeat");
}
function hudPop(anchorSelector, text, kind = "gold") {
  if (!popNumbers) return; // v0.13
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
  const can = !game.warmup && game.running && tab !== "send",
    on = tabButton.classList.contains("nudge"),
    // v0.17i: hysteresis, so gold hovering around the threshold no longer switches the marker on and off
    idle = on ? can && sinceAction > 25 && p.gold >= cheapest : can && sinceAction > 25 && p.gold >= cheapest * 2;
  if (idle !== on) tabButton.classList.toggle("nudge", idle);
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
    text: "After the warm-up round: under <b>Send</b>, send creeps to your enemy. Every group raises your income for good. Whoever never sends loses the arms race.",
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
  // v0.10x: own class, so the idle check (updateNudge) no longer switches it off and on every frame
  if (step.tab) document.querySelector(`[data-tab="${step.tab}"]`)?.classList.add("coach-nudge");
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
  if (view !== own) {
    // v0.17e: enemy towers show their tooltip (showTowerTip) instead of the old panel
    $("tower-panel").hidden = true;
    return;
  }
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
    `<div class="tower-panel-top"><img src="${towerArtUrl(artFor(item))}" alt=""><div><h3>${esc(itemName(item))} <small>· ${item.level}</small></h3><div class="tower-stats">${t("{n} damage", { n: format(stats.damage) })} · ${format(stats.cooldown)} s · ${isMeleeTower(item) ? t("Melee · adjacent fields") : t("{n} fields range", { n: format(stats.range / game.grid.cellUnits) })}</div></div><button class="close-tower" aria-label="${t("Close tower info")}">×</button></div>${tower.buildRemaining > 0 ? `<div class="modal-note">${t("Building · {n} s", { n: Math.ceil(tower.buildRemaining) })}</div>` : ""}${
      view === own
        ? `<div class="tower-buttons${upgrades.length > 3 ? " many" : ""}">${upgrades
            .map((u) => {
              const a = available(game, own, "upgrade", u.id, id),
                locked = !a.ok && !/more gold/.test(a.reason || "");
              return `<button data-upgrade="${u.id}" class="upgrade-card ${a.ok ? "" : "unaffordable"} ${locked ? "locked" : ""}" title="${esc(a.ok ? itemName(u) : t(a.reason))}"><img src="${artUrl(artFor(u))}" alt=""><span class="up-name">${esc(itemName(u))}</span>${u.level > 1 ? `<small>Lv ${u.level}</small>` : ""}<span class="cost"><img src="${iconUrl("coin")}" alt="Gold">${format(u.cost)}</span>${locked ? `<span class="up-lock">${esc(t(a.reason))}</span>` : ""}</button>`;
            })
            .join(
              "",
            )}<button class="sell" id="sell-tower">${t("Sell")}<br>${sellText(typeof sell === "number" ? sell : sell?.gold || 0, getSellBase(game, view, id))} Gold</button></div>`
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
    owned = researchLevel(game.players[own], id) > 0; // v0.21k
  showModal(
    `${modalHeader(itemName(item))}<img class="modal-hero" src="${researchArt(item)}" alt=""><p class="modal-copy">${valHtml(cardHint(item))}</p><div class="rule-row"><strong>${t(owned ? "Already unlocked" : "Level reward")}</strong>${t(owned ? "Active in this match." : "Upgrades come with level-ups: collect EXP from breakthroughs, creeps and EXP generators.")}</div><details class="info-disclosure"><summary>${t("Exact values")}</summary><p class="modal-copy">${esc(item.description).replace(/\n/g, "<br>")}</p></details><button class="primary-button" data-close>${t("Back")}</button>`,
  );
}
/** `back` (v0.22): opened from the card book, a Back button returns there. */
/** v0.22n2: the info dialog's picture with the elements the tower needs as symbols in its upper left corner. */
function heroWithElements(item) {
  const els = item.kind === "tower" || item.isBuildable ? catalog.factions.filter((f) => (item.requires || []).some((r) => r.id === f.unlock || r.id === f.research)) : [];
  const img = `<img class="modal-hero" src="${towerArtUrl(artFor(item))}" alt="">`;
  if (!els.length) return img;
  return `<div class="modal-hero-wrap">${img}<div class="hero-elements">${els.map((f) => `<span class="hero-el" style="--el:${f.color}" title="${esc(t(f.name))}"><img src="${iconUrl(ELEMENT_ICON[f.id])}" alt="${esc(t(f.name))}"></span>`).join("")}</div></div>`;
}
function itemDetail(id, towerId, detailPlayer = own, back = null) {
  const item = catalog.byId[id],
    stats = item.kind === "research" ? null : getStats(game, detailPlayer, id),
    canAct = detailPlayer === own;
  showModal(
    `${back ? subHeader(itemName(item)) : modalHeader(itemName(item))}${heroWithElements(item)}${stats ? `<div class="help-tip stats detail-tip">${statTip(item, "info", towerId, detailPlayer, true).html}</div>` : `<p class="modal-copy">${esc(cardHint(item))}</p>`}${
      // v0.18b: a placed tower shows no upgrade buttons here, but a way to its place in the tech tree
      towerId
        ? `<button class="secondary-button" id="detail-techtree">${t("Techtree")}</button>`
        : item.upgrades?.length && !back // v0.22n2: opened from the card book: no upgrade buttons
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
          } else itemDetail(b.dataset.detailUpgrade, undefined, detailPlayer, back);
        }),
    );
  if (back && $("sub-back")) $("sub-back").onclick = back; // v0.22
  if ($("detail-techtree")) $("detail-techtree").onclick = () => catalogModal({ filter: "tower", focus: id, back: () => itemDetail(id, towerId, detailPlayer, back) }); // v0.22n2: Back to the tower
  if (!towerId && canAct && (item.kind === "research" || item.isRoot)) { // v0.17h: no "Send creep" button for creeps
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
/**
 * v0.15: the card book as a tech tree. Towers grow from their base tower: straight upgrade lines
 * run left to right, branches open below with a guide line; a tower reached from several halls
 * shows once in full and as a small link elsewhere. Creeps run tier by tier, the boss leading to
 * the next tier; upgrades are grouped by element.
 */
const TREE_ROOTS = ["h003", "h000", "h02R", "h03V", "h01F", "h05L", "hWAL"];
function techTree(kind) {
  const elColor = (item) => elementOf(item?.element)?.color || "",
    node = (item, ref = false) => {
      const el = elColor(item),
        price = item.kind === "research" ? "" : format(item.cost || 0);
      return `<button class="tt-node${ref ? " tt-ref" : ""}${el ? " tt-el" : ""}" type="button" data-card="${item.id}"${el ? ` style="--el:${el}"` : ""}>${item.kind === "send" && item.bossTier ? `<span class="tt-boss-art"><img src="${towerArtUrl(artFor(item))}" alt=""><span class="frame-boss" aria-hidden="true"></span></span>` : `<img src="${item.kind === "research" ? researchArt(item) : towerArtUrl(artFor(item))}" alt="">`}<b>${esc(itemName(item))}</b>${item.level > 1 && item.kind !== "send" && item.kind !== "research" ? `<i>Lv ${item.level}</i>` : ""}${price ? `<small><img src="${iconUrl("coin")}" alt="">${price}</small>` : ""}</button>`;
    },
    arrow = '<span class="tt-arrow" aria-hidden="true">›</span>';
  if (kind === "tower") {
    const seen = new Set();
    const kids = (item) => (item.upgrades || []).map((id) => catalog.byId[id]).filter(Boolean);
    const branch = (item) => {
      const chain = [item];
      seen.add(item.id);
      let last = item;
      for (;;) {
        const next = kids(last);
        if (next.length !== 1 || seen.has(next[0].id)) break;
        last = next[0];
        seen.add(last.id);
        chain.push(last);
      }
      const children = kids(last),
        sub = children.map((c) => (seen.has(c.id) ? `<div class="tt-branch">${node(c, true)}</div>` : branch(c))).join("");
      return `<div class="tt-branch"><div class="tt-chain">${chain.map((c) => node(c)).join(arrow)}</div>${sub ? `<div class="tt-children">${sub}</div>` : ""}</div>`;
    };
    return TREE_ROOTS.map((id) => catalog.byId[id])
      .filter(Boolean)
      .map((root) => `<section class="tt-tree"><h3>${esc(itemName(root))}</h3>${branch(root)}</section>`)
      .join("");
  }
  if (kind === "send")
    return [1, 2, 3, 4, 5]
      .map((tier) => {
        const list = tierSends(tier);
        if (!list.length) return "";
        return `<section class="tt-tree"><h3>${t("Tier {n}", { n: tier })}</h3><div class="tt-chain tt-wrap">${list.map((c) => node(c)).join(arrow)}</div></section>`;
      })
      .join("");
  const groups = new Map();
  for (const r of bookResearch()) {
    const key = catalog.factions.find((f) => f.research === r.id || f.unlock === r.id)?.id || RESEARCH_ELEMENT[r.id] || "general";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const order = ["general", ...catalog.factions.map((f) => f.id)];
  return order
    .filter((k) => groups.has(k))
    .map((k) => {
      const f = elementOf(k);
      return `<section class="tt-tree"${f ? ` style="--el:${f.color}"` : ""}><h3>${esc(f ? t(f.name) : t("General"))}</h3><div class="tt-chain tt-wrap">${groups
        .get(k)
        .sort((a, b) => (a.cost || 0) - (b.cost || 0) || itemName(a).localeCompare(itemName(b)))
        .map((r) => node(r))
        .join("")}</div></section>`;
    })
    .join("");
}
/** v0.17b: the Upgrades tab lists only research a player can pick at a level-up (elements have their own section under Perks). */
const bookResearch = () => catalog.research.filter((r) => r.playable && !RESEARCH_PERKS[r.id] && !catalog.factions.some((f) => f.research === r.id || f.unlock === r.id)); // v0.21: the upgrades are perks now
// ---- v0.17b: perks, active abilities, powerups, quests and elements in the card book ----------
const ACTIVE_PERKS = new Set(["volley", "burst", "pillar", "agolem", "monsun"]);
/**
 * v0.19a1: the Perks tab is sorted by element: Neutral first, then one section per element (with the
 * element frame), Quests last. Inside a section: the element itself, perks, active abilities, powerups.
 */
const BOOK_RANK = { element: 0, perk: 1, active: 2, powerup: 3, quest: 4 };
/** v0.20d: the earliest level a card-book entry can be offered on ("6,9" → 6, "15+" → 15). */
const bookFirstLevel = (e) => {
  const spec = e.type === "quest" ? QUESTS[e.id]?.avail : PERK_AVAILABILITY[e.id];
  return Number(/\d+/.exec(String(spec ?? "1"))?.[0] || 1);
};
function perkBookEntries() {
  const out = [],
    groupsOf = (els) => (els.length ? els : ["neutral"]);
  for (const id of Object.keys(PERKS)) out.push({ kind: PERKS[id].powerup ? "powerup" : ACTIVE_PERKS.has(id) ? "active" : "perk", groups: groupsOf(perkLook(id)), type: "perk", id, name: t(PERKS[id].name) });
  // v0.17h: the level-up upgrades (research) are perks too; the card book has no Upgrades tab any more
  for (const r of bookResearch()) out.push({ kind: "perk", groups: groupsOf([RESEARCH_ELEMENT[r.id]].filter(Boolean)), type: "research", id: r.id, name: itemName(r) });
  for (const id of Object.keys(QUESTS)) out.push({ kind: "quest", groups: ["quests"], type: "quest", id, name: t(QUESTS[id].name) });
  for (const f of catalog.factions) out.push({ kind: "element", groups: [f.id], type: "element", id: f.id, name: t(f.name) });
  return out;
}
const levelsText = (spec) => t("Levels {l}", { l: String(spec ?? "1+").replace(/-/g, "–") });
/**
 * v0.19e2: bottom lines of a perk card in the card book, in white: "Max Level 3" (not for powerups or
 * single-level perks) and "Available in Lv 2-5", then the element(s) as before.
 */
const bookMeta = (max, spec, extra = "", cd = "", cont = false) => // v0.22j1: cont = ContinousPick
  `<small class="book-meta">${cd ? `<span class="meta-line">${cd}</span>` : ""}${max > 1 ? `<span class="meta-line">${t("Max Level {n}", { n: max })}</span>` : ""}<span class="meta-line">${t("Available in Lv {l}", { l: String(spec ?? "1+") })}</span>${cont ? `<span class="meta-line meta-cont">${t("Continous Pick")}</span>` : ""}${extra ? `<span class="meta-extra">${extra}</span>` : ""}</small>`;
function perkBookCard(e, p, section = null) {
  if (e.type === "element") {
    const f = elementOf(e.id);
    return `<div class="pick-card book-card pick-element el-${f.id}" style="--el:${f.color}"><img src="${iconUrl(ELEMENT_ICON[f.id])}" alt=""><b>${esc(e.name)}</b><span>${t("Unlocks {name} towers and perks", { name: esc(e.name) })}</span><small>${t("Opening pick, levels 10 and 25")}</small></div>`;
  }
  if (e.type === "quest") {
    const q = QUESTS[e.id];
    return `<div class="pick-card book-card pick-quest quest-${q.kind}"><i class="quest-ribbon">${t("Quest")}</i><img src="${questArt(e.id)}" alt=""><b>${esc(e.name)}</b><span>${valHtml(questText(e.id))}</span>${bookMeta(1, q.avail)}</div>`;
  }
  if (e.type === "research") {
    const r = catalog.byId[e.id],
      el = elementOf(RESEARCH_ELEMENT[e.id]);
    return `<div class="pick-card book-card${el ? " pick-element el-" + el.id : ""}"${el ? ` style="--el:${el.color}"` : ""}><img src="${researchArt(r)}" alt=""><b>${esc(e.name)}</b><span>${valHtml(cardHint(r))}</span>${bookMeta(researchMax(r), PERK_AVAILABILITY[e.id], "", "", PERK_CONTINUOUS.has(e.id))}</div>`;
  }
  const d = PERKS[e.id],
    els = perkLook(e.id),
    pel = els.length ? elementOf(els.includes(section) ? section : els[0]) : null; // v0.19a1: a two-element perk wears the frame of the section it sits in
  return `<div class="pick-card book-card pick-perk perk-${e.id}${pel ? " pick-element el-" + pel.id : ""}${section === "lab" ? "" : " book-open"}"${pel ? ` style="--el:${pel.color}"` : ""}${section === "lab" ? "" : ` data-perk="${e.id}" role="button" tabindex="0"`}><img src="${PERK_ART[e.id]()}" alt="" decoding="sync"><b>${esc(e.name)}</b><span>${valHtml(perkText(e.id, p.level || 1, p, false))}</span>${bookMeta(d.powerup ? 1 : d.max, PERK_AVAILABILITY[e.id], "", perkCd(e.id, p), PERK_CONTINUOUS.has(e.id))}</div>`;
}
/**
 * v0.21y: perk values under made-up conditions (card book submenu). A blank player with only this
 * perk, the chosen player level and tier, in a stand-in match at the chosen round; the real match
 * is put back right away.
 */
function perkSim(id, s) {
  const real = game,
    q = { id: 0, perks: { [id]: s.perk, ...(s.sanction ? { sanction: 1 } : {}) }, research: {}, level: s.level, tier: s.tier, towers: [], creeps: [], picks: [], stock: {}, stats: {}, questLog: {}, gold: 0, income: 0, incomeDecimal: 0, lives: 30 },
    stand = { round: s.round, time: s.round * 15, tick: 0, running: true, warmup: false, teams: null, grid: real?.grid || { cols: 6, rows: 14, cellUnits: 128 }, players: [q] };
  game = stand;
  try {
    return { text: perkText(id, s.level, q, false), cd: perkCd(id, q) };
  } catch {
    return null;
  } finally {
    game = real;
  }
}
/** v0.21y: the factors a perk's numbers can depend on; only those that change something get a control. */
const LAB_FACTORS = [
  { key: "perk", label: "Perk level", min: 1 },
  { key: "level", label: "Player level", min: 1, max: 100 },
  { key: "tier", label: "Tier", min: 1, max: 5 },
  { key: "round", label: "Round", min: 0, max: 100 },
];
function perkLab(id, back) {
  const d = PERKS[id],
    p = game?.players?.[own],
    max = d.powerup ? 1 : d.max || 1,
    first = Math.max(1, bookFirstLevel({ type: "perk", id }) || 1),
    s = {
      perk: Math.max(1, Math.min(max, p?.perks?.[id] || 1)),
      level: Math.max(first, p?.level || first),
      tier: p?.tier || 1,
      round: Math.max(0, game?.round || 10),
      sanction: false,
    },
    bounds = (f) => [f.min, f.key === "perk" ? max : f.max],
    sig = (v) => { const r = perkSim(id, v); return r ? r.text + "|" + r.cd : ""; },
    // a factor counts when its smallest and largest value give different numbers
    useful = LAB_FACTORS.filter((f) => {
      const [lo, hi] = bounds(f);
      return hi > lo && sig({ ...s, [f.key]: lo }) !== sig({ ...s, [f.key]: hi });
    }),
    sanctionUseful = !!PERK_CD[id] && sig({ ...s, sanction: true }) !== sig(s),
    entry = perkBookEntries().find((e) => e.type === "perk" && e.id === id),
    grid = $("catalog-grid");
  const card = () => {
    const r = perkSim(id, s) || { text: "", cd: "" };
    const els = perkLook(id),
      pel = els.length ? elementOf(els[0]) : null;
    return `<div class="pick-card book-card pick-perk lab-card perk-${id}${pel ? " pick-element el-" + pel.id : ""}"${pel ? ` style="--el:${pel.color}"` : ""}><img src="${PERK_ART[id](s.perk)}" alt="" decoding="sync"><b>${esc(entry?.name || t(d.name))}</b><span>${valHtml(r.text)}</span>${bookMeta(max, PERK_AVAILABILITY[id], "", r.cd, PERK_CONTINUOUS.has(id))}</div>`;
  };
  const control = (f) => {
    const [lo, hi] = bounds(f);
    return `<div class="lab-row" data-key="${f.key}"><span>${t(f.label)}</span><button type="button" class="lab-step" data-step="-1" aria-label="${t("Less")}">−</button><input type="range" min="${lo}" max="${hi}" step="1" value="${s[f.key]}" aria-label="${t(f.label)}"><button type="button" class="lab-step" data-step="1" aria-label="${t("More")}">+</button><b>${s[f.key]}</b></div>`;
  };
  grid.classList.add("techtree");
  grid.innerHTML = `<section class="tt-tree perk-lab"><h3 class="lab-head">${$("sub-back") ? "" : `<button class="welcome-back modal-back" type="button" id="lab-back">${t("Back")}</button>`}<span>${esc(entry?.name || t(d.name))}</span></h3><div class="lab-body"><div class="lab-card-wrap" id="lab-card">${card()}</div><div class="lab-controls">${useful.map(control).join("")}${sanctionUseful ? `<label class="lab-row lab-toggle"><span>${t("Sanction Policy")}</span><input type="checkbox" id="lab-sanction"></label>` : ""}${useful.length || sanctionUseful ? "" : `<p class="lab-none">${t("Nothing changes the values of this perk.")}</p>`}</div></div></section>`;
  const refresh = () => ($("lab-card").innerHTML = card());
  grid.querySelectorAll(".lab-row[data-key]").forEach((row) => {
    const key = row.dataset.key,
      range = row.querySelector("input"),
      out = row.querySelector("b"),
      set = (v) => {
        s[key] = Math.max(Number(range.min), Math.min(Number(range.max), v));
        range.value = s[key];
        out.textContent = s[key];
        refresh();
      };
    range.oninput = () => set(Number(range.value));
    row.querySelectorAll("[data-step]").forEach((b) => (b.onclick = () => set(s[key] + Number(b.dataset.step))));
  });
  if ($("lab-sanction")) $("lab-sanction").onchange = (e) => ((s.sanction = e.target.checked), refresh());
  // v0.22r2: the headline's Back leads back to the perk list (no second Back button)
  if ($("lab-back")) $("lab-back").onclick = back;
  else $("sub-back").onclick = back;
  grid.scrollTop = 0;
}
function perkBook(query = "") {
  const p = game?.players?.[own] || { perks: {}, research: {}, picks: [], level: 1, tier: 1 },
    entries = perkBookEntries().filter((e) => !query || [e.name, e.id].join(" ").toLowerCase().includes(query));
  return ["neutral", ...catalog.factions.map((f) => f.id), "quests"]
    .map((g) => {
      const list = entries.filter((e) => e.groups.includes(g) && e.type !== "element").sort((a, b) => (b.kind === "element") - (a.kind === "element") || bookFirstLevel(a) - bookFirstLevel(b) || BOOK_RANK[a.kind] - BOOK_RANK[b.kind] || a.name.localeCompare(b.name)), // v0.20d: by earliest level
        f = elementOf(g);
      if (!list.length) return "";
      return `<section class="tt-tree perk-book${f ? " book-el el-" + f.id : g === "quests" ? "" : " book-neutral"}"${f ? ` style="--el:${f.color}"` : ""}><h3>${f ? `<img class="book-el-icon" src="${iconUrl(ELEMENT_ICON[f.id])}" alt="">` : ""}${esc(f ? t(f.name) : t(g === "quests" ? "Quests" : "Neutral"))}</h3><div class="pick-grid book-grid">${list.map((e) => perkBookCard(e, p, g)).join("")}</div></section>`; // v0.22h1: element icon before the heading instead of an element card
    })
    .join("");
}
/** v0.21z: achievements for the card book: what each one asks for and the EXP it gives. */
function achievementGroups() {
  const R = ["I", "II", "III", "IV", "V"],
    lab = GLOBAL_ACHIEVEMENTS.labyrinth;
  return [
    {
      id: "personal",
      title: "Personal",
      note: "Every player can earn these once per match.",
      list: [
        { name: TOWER_ACHIEVEMENTS.element.name, text: "Build or upgrade your first element tower", exp: TOWER_ACHIEVEMENTS.element.exp, icon: "upgrade" },
        { name: TOWER_ACHIEVEMENTS.maxed.name, text: "Upgrade a tower to its highest level for the first time", exp: TOWER_ACHIEVEMENTS.maxed.exp, icon: "upgrade" },
      ],
    },
    {
      id: "global",
      title: "Global",
      note: "Only the first player in a match gets these.",
      list: [
        { name: "Hall Builder", text: "Build one of the first two Element Halls of the match", exp: 75, exp2: 50, icon: "build" },
        { name: "First Blood", text: "The first creep of the match that breaks through", exp: RULES.firstBloodWood, icon: "first-blood" },
        ...BLOOD_ACHIEVEMENTS.map((b) => ({ name: b.name, text: `Take ${b.lives} lives from your enemies`, exp: RULES.firstBloodWood * b.mult, icon: b.key })),
        { name: lab.name, text: `Make the creeps' path ${lab.fields} fields long or longer`, exp: lab.exp, icon: "hourglass" },
        ...R.map((r, i) => ({ name: "Creep Collector " + r, text: `Buy every creep of tier ${i + 1} at least once (the boss excepted)`, exp: collectorExp(i + 1), icon: "crown" })),
        ...RECRUITER_ACHIEVEMENTS.map((x, i) => ({ name: "Recruiter " + R[i], text: `Spend ${num(x.gold)} gold on creeps (bosses don't count)`, exp: x.exp, icon: "coin" })),
        ...BUILDER_ACHIEVEMENTS.map((b) => ({ name: b.name, text: `Own towers worth ${num(b.gold)} gold`, exp: b.exp, icon: "build" })),
      ],
    },
  ];
}
function achievementBook(query = "") {
  return achievementGroups()
    .map((g) => {
      const list = g.list.filter((a) => !query || [a.name, a.text].join(" ").toLowerCase().includes(query));
      if (!list.length) return "";
      return `<section class="tt-tree perk-book achievement-book book-neutral"><h3>${esc(t(g.title))}</h3><p class="achievement-note">${esc(t(g.note))}</p><div class="pick-grid book-grid">${list
        .map((a) => `<div class="pick-card book-card achievement-card"><img src="${iconUrl(a.icon)}" alt=""><b>${esc(t(a.name))}</b><span>${valHtml(t(a.text))}</span><em class="achievement-exp">+${format(a.exp)}${a.exp2 ? ` / +${format(a.exp2)}` : ""} EXP</em></div>`)
        .join("")}</div></section>`;
    })
    .join("");
}
let bookBack = null; // v0.22n2: where the card book's Back button leads (the menu it was opened from)
function catalogModal({ filter: startFilter = "tower", focus = null, back } = {}) {
  preloadPerkArt(); // v0.22u2: the icons are ready before the book shows them
  if (back !== undefined) bookBack = back;
  showModal(
    `${bookBack ? subHeader(t("All cards")) : modalHeader(t("All cards"))}<input class="catalog-search" id="catalog-search" placeholder="${t("Name or original ID …")}" aria-label="${t("Search the catalog")}"><div class="pills">${[["tower", "Towers"], ["send", "Creeps"], ["perk", "Perks"], ["achievement", "Achievements"]].map(([f, n]) => `<button${f === startFilter ? ' class="active"' : ""} data-filter="${f}">${t(n)}</button>`).join("")}</div><div id="catalog-grid" class="catalog-grid"></div>`,
  );
  if (bookBack && $("sub-back")) $("sub-back").onclick = bookBack; // v0.22n2
  let filter = startFilter;
  const draw = () => {
    if (bookBack && $("sub-back")) $("sub-back").onclick = bookBack; // v0.22r2: back to the menu again after a perk's details
    const q = $("catalog-search").value.toLowerCase();
    if (filter === "achievement") {
      // v0.21z: achievements submenu
      $("catalog-grid").classList.add("techtree");
      $("catalog-grid").innerHTML = achievementBook(q) || `<p class="book-empty">${t("Nothing found.")}</p>`;
      return;
    }
    if (filter === "perk") {
      // v0.17b: perks, active abilities, powerups, quests and elements (display only)
      $("catalog-grid").classList.add("techtree");
      $("catalog-grid").innerHTML = perkBook(q) || `<p class="book-empty">${t("Nothing found.")}</p>`;
      // v0.21y: a perk opens its submenu with the factors behind its values
      $("catalog-grid")
        .querySelectorAll("[data-perk]")
        .forEach((b) => {
          b.onclick = () => perkLab(b.dataset.perk, draw);
          b.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), perkLab(b.dataset.perk, draw));
        });
      return;
    }
    // v0.15: without a search the card book is a tech tree; a search lists the matching cards
    if (!q) {
      $("catalog-grid").classList.add("techtree");
      $("catalog-grid").innerHTML = techTree(filter);
      $("catalog-grid")
        .querySelectorAll("[data-card]")
        .forEach((b) => (b.onclick = () => itemDetail(b.dataset.card, undefined, own, () => catalogModal({ filter, focus: b.dataset.card }))));
      return;
    }
    $("catalog-grid").classList.remove("techtree");
    const list = (filter === "tower" ? catalog.towers : filter === "send" ? catalog.sends : bookResearch()).filter(
      (u) => [u.name, u.id, itemName(u)].join(" ").toLowerCase().includes(q),
    );
    $("catalog-grid").innerHTML = list.map(cardMarkup).join("");
    $("catalog-grid")
      .querySelectorAll(".unaffordable")
      .forEach((el) => el.classList.remove("unaffordable"));
    $("catalog-grid")
      .querySelectorAll("[data-card]")
      .forEach((b) => (b.onclick = () => itemDetail(b.dataset.card, undefined, own, () => catalogModal({ filter, focus: b.dataset.card }))));
  };
  $("catalog-search").oninput = draw;
  // v0.18b: opened from a tower's info: jump to that tower in the tech tree and mark it
  const showFocus = () => {
    const node = focus && $("catalog-grid").querySelector(`.tt-node[data-card="${focus}"]:not(.tt-ref)`);
    if (!node) return;
    node.classList.add("tt-focus");
    node.scrollIntoView({ block: "center", inline: "center" });
  };
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
  if (focus) requestAnimationFrame(showFocus);
}
const RULES_DE = [
  ["Your goal", "Bring your enemy's lives to zero (30 each with 2-3 players, 25 with 4-5, 20 with 6-8). Creeps you send run through the enemy's defence. Survivors cost a life and then run on through the next player's field (in a duel, the same one again)."],
  ["The economy", "30 gold and a free archer to start. After 10 seconds of warm-up: 20 income, then every 15 seconds. Buying creeps raises your income."],
  ["Experience & levels", "The purple bar shows your EXP. Breakthroughs, some creeps and EXP generators give experience. With every level-up you choose one of three rewards from the level button beside the board."],
  ["No juggling", "A new tower may lengthen the way of walking creeps but never force them to turn back. Sold towers open shortcuts only for the next creeps."],
  ["Building & upgrading", "Pick a tower card and tap a field: you see the new path and how many fields longer it gets, a second tap builds. Faster: drag the card straight onto the board. Every row can be built on. Creeps appear at the purple portal strip at the top and break through as soon as they leave the board at the bottom. Towers shape the path; blocking it completely is not allowed. Tap towers to upgrade or sell them. Without enough gold an upgrade is queued and starts by itself."],
  ["Auto-spawn", "Drag a creep card into the frame left of the board: that creep is sent automatically. Tap to switch it off and on, drag it out to clear it."],
  ["Six elements", "Water, fire, storm, earth, arcane and plague. At the start you choose one of three elements; levels 10 and 25 add one more each. All other levels offer upgrades."],
  ["Neutral waves", "From round 3, every two rounds a neutral wave runs through both lanes on top of the creeps sent. Every wave has a trait: swarm, fast, armored, flyers (only anti-air hits), regeneration, magic immune, splitting, mixed, and every tenth is a boss that costs 3 lives. Waves keep getting stronger. A breakthrough costs lives but gives nobody a life. Can be switched on and off in the main menu."],
  ["Stronger creeps", "Buying a boss unlocks the next tier. Armor, damage types, flyers, restocking and groups shape the duel."],
  ["Current port status", "This is a playable 1v1 development build with extracted original data. The mobile board, the AI and some missing Warcraft base values are new. Not every special spell and JASS trigger works exactly like the original yet. Details are on every card and in the project documentation."],
];
function rulesModal(back = null) {
  showModal(
    `${back ? subHeader(t("The rulebook")) : modalHeader(t("The rulebook"))}<div class="rules-credits"><b>${t("Created by Stevito and Felito in October 2026")}</b><div class="credits-team"><b>${t("Team")}</b><span>Uschi · ${t("Head of In-Game AI Development")}</span><span>Aldi · ${t("Diversity, Equity and Inclusion Manager and Makeup")}</span><span>Clarence · ${t("Human Resources")}</span><span>Jette · ${t("Animal Welfare Officer")}</span><span>Daddy Trash · ${t("Head of Audio Design and Vice Animal Welfare Officer")}</span><span>Heini · Heini</span></div><div class="credits-team"><b>${t("Obituary")}</b><span style="font-style:italic">${t("In loving memory of our friend Kos, who was terrible at Line Tower Wars but excelled at being a good-hearted and patient version of himself.")}</span></div></div>${RULES_DE.filter(([h]) => h !== "Neutral waves" || !game || game.waves).map(([h, text]) => `<div class="rule-row"><strong>${t(h)}</strong>${t(text)}</div>`).join("")}<button class="primary-button" data-close>${t("Back to the arena")}</button>`,
  );
  if (back && $("sub-back")) $("sub-back").onclick = back; // v0.22n2
}
/** Shared settings, used by the in-game menu and the main-menu options. */
const onOff = (v) => t(v ? "On" : "Off");
// v0.13: Audio and Graphic open as sub-menus; music and sound are volume sliders now.
function settingsButtons() {
  // v0.15: Tips, preview and double tap moved into the Gameplay sub-menu (below Graphic)
  return `<button class="secondary-button submenu-button" id="menu-audio">${t("Audio")}<i aria-hidden="true">›</i></button><button class="secondary-button submenu-button" id="menu-graphic">${t("Graphic")}<i aria-hidden="true">›</i></button><button class="secondary-button submenu-button" id="menu-gameplay">${t("Gameplay")}<i aria-hidden="true">›</i></button>`;
}
const DBL_LABELS = { upgrade: "Upgrade", advanced: "Advanced Upgrade", info: "Tower info", off: "Off" };
const dblText = () => `${t("Double tap on a tower")}: ${t(DBL_LABELS[dblMode])}`;
const DBL_NOTES = {
  upgrade: "Double tap queues the next upgrade of a tower.",
  advanced: "Double tap queues every upgrade up to the one you picked last time.",
  info: "Double tap shows the tower info.",
  off: "Double tap does nothing.",
};
/** Header of a sub-menu: Back to the options, title, red ×. */
const subHeader = (title) =>
  `<div class="modal-header sub-header"><button class="welcome-back modal-back" type="button" id="sub-back" aria-label="${t("Back")}">${t("Back")}</button><h2>${esc(title)}</h2><button class="close-modal" data-close aria-label="${t("Close")}">×</button></div>`;
/** v0.18e: mute switch shared by the main menu and the in-game menu. */
function toggleMute(b) {
  muted = !muted;
  savePref(MUTE_PREF, muted);
  applyVolume();
  if (b) {
    b.innerHTML = speakerSvg(muted);
    b.setAttribute("aria-pressed", String(muted));
    b.setAttribute("aria-label", t(muted ? "Sound off" : "Sound on"));
  }
  if (!muted) tone("select");
}
/** v0.17: speaker symbol, crossed out when muted. */
const speakerSvg = (off) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 9.5h4l5-4v13l-5-4H3z" fill="#ffe27a" stroke="#3a2404" stroke-width="1.4" stroke-linejoin="round"/>${off ? '<path d="M16 9l5 6M21 9l-5 6" stroke="#ff7a6e" stroke-width="2.4" stroke-linecap="round"/>' : '<path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.8a7.4 7.4 0 0 1 0 10.4" fill="none" stroke="#ffe27a" stroke-width="2" stroke-linecap="round"/>'}</svg>`;
function applyVolume() {
  const master = muted ? 0 : volume.master; // v0.17: speaker button in the main menu
  musicEnabled = master > 0 && volume.music > 0;
  soundEnabled = master > 0 && volume.effects > 0;
  music.setVolume((master / 100) * (volume.music / 100));
  music.setEnabled(musicEnabled);
  if (musicEnabled) music.unlock();
  sfx.setVolume((master / 100) * (volume.effects / 100));
  sfx.setEnabled(soundEnabled);
}
function audioModal(back) {
  const row = (key, label) =>
    `<label class="volume-row" for="vol-${key}"><span>${t(label)}</span><input type="range" id="vol-${key}" min="0" max="100" step="5" value="${volume[key]}"><b id="vol-${key}-v">${volume[key]}%</b></label>`;
  showModal(`${subHeader(t("Audio"))}<div class="volume-list">${row("master", "Master volume")}${row("effects", "Effect volume")}${row("music", "Music volume")}</div>`);
  $("sub-back").onclick = back;
  for (const key of Object.keys(volume)) {
    const input = $("vol-" + key);
    input.oninput = () => {
      volume[key] = Number(input.value) || 0;
      $("vol-" + key + "-v").textContent = volume[key] + "%";
      savePref(VOL_PREFS[key], volume[key]);
      applyVolume();
    };
    input.onchange = () => tone("select");
  }
}
function graphicModal(back) {
  showModal(
    `${subHeader(t("Graphic"))}<div id="menu-controls">${controlsRow()}</div><div id="menu-minimap">${minimapRow()}</div><button class="secondary-button" id="menu-popnum">${t("Pop-up numbers")}: ${onOff(popNumbers)}</button><button class="secondary-button" id="menu-popnote">${t("Pop-up notifications")}: ${onOff(popNotes)}</button>`,
  );
  $("sub-back").onclick = back;
  $("menu-controls").onclick = (e) => {
    const m = e.target.closest?.("[data-ctl]")?.dataset.ctl;
    if (!m || m === layoutChoice()) return;
    controlMode = m === "pc" ? "pc" : "mobile";
    if (m !== "pc") {
      mobileLayout = m === "zoomed" ? "B" : m === "full" ? "F" : "A";
      savePref(MOBILE_LAYOUT_PREF, mobileLayout);
    }
    savePref(CONTROL_PREF, controlMode);
    applyControlMode();
    $("menu-controls").innerHTML = controlsRow();
    toast(controlMode === "pc" ? "PC version: mouse hover shows tips, mouse wheel and arrow keys switch fields, B / S switch Build and Send." : "Mobile version: touch controls, tips only in help mode.");
    tone("select");
  };
  $("menu-minimap").onclick = (e) => {
    const m = e.target.closest?.("[data-mini]")?.dataset.mini;
    if (!m || m === minimapMode) return;
    minimapMode = m;
    savePref(MINIMAP_PREF, m);
    $("menu-minimap").innerHTML = minimapRow();
    arena?.refresh?.();
    tone("select");
  };
  $("menu-popnum").onclick = () => {
    popNumbers = !popNumbers;
    savePref(POPNUM_PREF, popNumbers);
    arena?.setPopups?.({ numbers: popNumbers, notes: popNotes });
    $("menu-popnum").textContent = `${t("Pop-up numbers")}: ${onOff(popNumbers)}`;
    tone("select");
  };
  $("menu-popnote").onclick = () => {
    popNotes = !popNotes;
    savePref(POPNOTE_PREF, popNotes);
    arena?.setPopups?.({ numbers: popNumbers, notes: popNotes });
    if (!popNotes) $("toast").classList.remove("show");
    $("menu-popnote").textContent = `${t("Pop-up notifications")}: ${onOff(popNotes)}`;
    tone("select");
  };
}
/** v0.15: Gameplay sub-menu: tips, build preview, double tap and Predator view. */
const predatorText = () => `${t("Predator view")}: ${onOff(predatorView)}`;
function gameplayModal(back) {
  showModal(
    `${subHeader(t("Gameplay"))}<button class="secondary-button" id="menu-tips">${t("Tips")}: ${onOff(tipsEnabled)}</button><button class="secondary-button" id="menu-preview">${t("Build with preview")}: ${onOff(buildPreview)}</button><button class="secondary-button" id="menu-dbl">${dblText()}</button><button class="secondary-button" id="menu-predator">${predatorText()}</button>`,
  );
  $("sub-back").onclick = back;
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
    toast(DBL_NOTES[dblMode]);
    tone("select");
  };
  $("menu-predator").onclick = () => {
    predatorView = !predatorView;
    savePref(PREDATOR_PREF, predatorView);
    $("menu-predator").textContent = predatorText();
    toast(predatorView ? "While you send and watch your target, the view follows when your target changes." : "The view stays where you put it.");
    tone("select");
  };
}
function wireSettings(reopen) {
  $("menu-gameplay").onclick = () => gameplayModal(reopen);
  $("menu-audio").onclick = () => audioModal(reopen);
  $("menu-graphic").onclick = () => graphicModal(reopen);
  $("menu-rules").onclick = () => rulesModal(reopen); // v0.22n2: Back returns to the menu
}
/** In-game menu: settings only, rulebook at the bottom. */
const FLAG_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 4v25" stroke="#c9b48a" stroke-width="2.6" stroke-linecap="round"/><path d="M9 5.5c4-2 7 1.5 11 0s5-1.5 7-.5v11c-2-1-3.5-1-7 .5s-7-2-11 0z" fill="#fff" stroke="#9aa6ae" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
/** v0.17o: AI training matches (1 or more AI enemies) get a yellow Restart button beside Surrender. */
const canRestart = () => sessionMode === "training" || sessionMode === "ffa";
const RESTART_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M25 16a9 9 0 1 1-2.64-6.36" fill="none" stroke="#3a2a00" stroke-width="3.4" stroke-linecap="round"/><path d="M24.5 4.5v6.5H18" fill="none" stroke="#3a2a00" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
/** v0.09: you can give up from the pause menu (1v1: the other side wins, four players: you are out). */
/** v0.18c: you are out of a match that goes on (Keep watching). */
const watchingOut = () => begun && !!game?.players[own]?.out && !!game?.running;
const canSurrender = () => begun && !shownResult && game?.running && !game.players[own]?.out;
function surrender() {
  const early = (game?.round || 0) <= 1; // v0.16: giving up in the first round goes straight back to the menu
  const result = dispatch({ type: "surrender" });
  if (result && result.ok === false) return;
  closeModal();
  if (!early) return;
  shownResult = true;
  try {
    localStorage.removeItem(SAVE);
  } catch {}
  setTimeout(() => {
    begun = false;
    shownResult = false;
    disconnectRoom();
    welcome();
  }, room ? 400 : 0);
}
/** In-game menu: settings only, rulebook at the bottom. The red × closes it. */
function menu() {
  showModal(
    `${modalHeader(t(room ? "Menu" : "Paused"), `<div class="menu-clock" title="${t("Match time")}"><img src="${iconUrl("hourglass")}" alt=""><b id="menu-clock">${matchClock()}</b></div>`).replace('<div class="modal-header">', `<div class="modal-header menu-header"><button class="welcome-options header-mute" id="menu-mute" type="button" aria-pressed="${muted}" aria-label="${t(muted ? "Sound off" : "Sound on")}">${speakerSvg(muted)}</button>`)}${sessionMode === "hotseat" ? `<button class="secondary-button" id="switch-player">${t("Switch player")}</button>` : ""}${settingsButtons()}<button class="secondary-button" id="menu-catalog">${t("Card book")}</button><button class="secondary-button" id="menu-rules">${t("Rules & development status")}</button>${canSurrender() ? `<div id="surrender-confirm" class="surrender-confirm" hidden><b>${t("Really surrender?")}</b><span>${t(isFfa() ? "You drop out of this match." : "Your opponent wins the duel.")}</span><div class="surrender-row"><button class="danger-button" id="surrender-yes" type="button">${t("Surrender")}</button><button class="secondary-button" id="surrender-no" type="button">${t("Resume")}</button></div></div>${canRestart() ? `<div class="surrender-pair" id="surrender-pair">` : ""}<button class="danger-button menu-surrender" id="menu-surrender" type="button">${FLAG_SVG}${t("Surrender")}</button>${canRestart() ? `<button class="primary-button restart-button" id="menu-restart" type="button">${RESTART_SVG}${t("Restart")}</button></div>` : ""}` : ""}${watchingOut() ? `<button class="primary-button" id="menu-main" type="button">${t("Main menu")}</button>` : ""}`,
  );
  $("modal").classList.remove("with-flag");
  $("menu-mute").onclick = () => toggleMute($("menu-mute")); // v0.18e
  // v0.18c: watching on after a defeat: back to the main menu from the in-game menu
  if ($("menu-main"))
    $("menu-main").onclick = () => {
      tone("tap");
      closeModal();
      begun = false;
      shownResult = false;
      welcome();
    };
  if ($("menu-surrender")) {
    $("menu-surrender").onclick = () => {
      if (canRestart()) return surrender(); // v0.18c: AI training: surrender at once, no question
      $("surrender-confirm").hidden = false;
      $("menu-surrender").hidden = true;
      if ($("surrender-pair")) $("surrender-pair").hidden = true;
      $("surrender-confirm").scrollIntoView({ block: "nearest", behavior: "smooth" });
      tone("tap");
    };
    $("surrender-no").onclick = () => {
      $("surrender-confirm").hidden = true;
      $("menu-surrender").hidden = false;
      if ($("surrender-pair")) $("surrender-pair").hidden = false;
    };
    // v0.17o: Training against the AI: Restart starts the same kind of match again at once
    if ($("menu-restart"))
      $("menu-restart").onclick = () => {
        tone("tap");
        shownResult = false;
        startLocal({ ffa: sessionMode === "ffa", seats: game.players.length });
      };
    $("surrender-yes").onclick = surrender;
  }
  wireSettings(menu);
  $("menu-catalog").onclick = () => catalogModal({ back: menu }); // v0.22n2: Back returns to the menu
  if ($("switch-player"))
    $("switch-player").onclick = () => {
      own = 1 - own;
      selectedTower = null;
      closeModal();
      setPage(tab);
      toast(nameTag(t("Player {n}", { n: own + 1 }), TEAM_COLORS[seatColors()[own]]?.css)); // v0.19d2: in the player colour
    };
}
/** Options from the main menu; closing returns to the main menu. */
function optionsModal() {
  showModal(
    `${modalHeader(t("Options"))}${settingsButtons()}<button class="secondary-button" id="menu-catalog">${t("Card book")}</button><button class="secondary-button" id="menu-rules">${t("Rules & development status")}</button>`,
  );
  wireSettings(optionsModal);
  $("menu-catalog").onclick = () => catalogModal({ back: optionsModal }); // v0.21z: the card book from the main menu too; v0.22n2: with Back
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

// ---- v0.14: presence — anonymous counts of players searching a Quick Match and playing vs AI ----
let presence = null,
  presenceWanted = "idle",
  presenceBase = "idle",
  qmSearch = null; // v0.18a: the running Quick Match search
function presenceState(state) {
  presenceBase = state;
  presenceWanted = qmSearch && state !== "pvp" ? "queue" : state; // v0.18a: a running search counts as "in the queue"
  if (presence) return presence.set(state);
  if (state === "idle") return;
  import("./multiplayer.js")
    .then(({ createPresence }) => {
      presence ||= createPresence();
      presence.set(presenceWanted);
    })
    .catch(() => {});
}
// Quick Match (v0.10i): automatic 1v1 against the next searching player, no room code.
// v0.18a: the search runs on its own. The dialog can be minimised to a small bar, and training
// matches can be played meanwhile; a found match ends the training match and connects.
const qmOnline = (c) => Math.max(1, (c.queue || 0) + (c.pve || 0) + (c.pvp || 0));
function qmDialog() {
  const q = qmSearch;
  if (!q) return;
  q.minimized = false;
  const host = pvpModal(
    `${modalHeader(t("Quick Match"))}<p class="modal-copy">${t("You'll be paired with the next player who is searching. Minimize this window to play a training match while you wait.")}</p><div id="network-status" class="network-status">${esc(q.status)}</div><div class="qm-presence" id="qm-presence"><span><b id="qm-queue">${q.counts ? Math.max(1, q.counts.queue) : "…"}</b>${t("in the queue")}</span><span><b id="qm-online">${q.counts ? qmOnline(q.counts) : "…"}</b>${t("Players online")}</span></div><div class="qm-actions"><button class="primary-button" id="qm-min">${t("Minimize")}</button><button class="secondary-button" id="qm-cancel">${t("Cancel")}</button></div>`,
  );
  // v0.18g: from the main menu, cancel and minimize return to the PvP page underneath
  const leave = closeModal;
  const cancel = () => {
    cancelQuickMatch();
    closeModal();
  };
  $("qm-cancel").onclick = cancel;
  const x = host.querySelector(".close-modal");
  if (x) x.onclick = cancel;
  $("qm-min").onclick = () => {
    q.minimized = true;
    leave();
    // v0.19c1: from the menu, minimizing leads to the Training page (play while you wait)
    if (!begun && $("welcome-panel")) {
      $("welcome-panel").dataset.view = "ai";
      wolfEyes();
    }
    refreshQmPill();
  };
  refreshQmPill();
}
function cancelQuickMatch() {
  const q = qmSearch;
  if (!q) return;
  qmSearch = null;
  q.abort.abort();
  clearInterval(q.timer);
  q.stopWatch?.();
  presenceState(presenceBase);
  refreshQmPill();
}
/** The small "searching" bar while the Quick Match dialog is not on screen. */
function refreshQmPill() {
  let pill = $("qm-pill");
  if (!qmSearch || $("qm-cancel")) {
    pill?.remove();
    return;
  }
  if (!pill) {
    pill = document.createElement("div");
    pill.id = "qm-pill";
    pill.className = "qm-pill";
    pill.innerHTML = `<button type="button" class="qm-pill-open" aria-label="${t("Show the Quick Match search")}"><i class="qm-pill-dot" aria-hidden="true"></i><span class="qm-pill-text"></span></button><button type="button" class="qm-pill-x" aria-label="${t("Cancel the search")}">×</button>`;
    pill.querySelector(".qm-pill-open").onclick = () => qmDialog();
    pill.querySelector(".qm-pill-x").onclick = () => cancelQuickMatch();
  }
  const host = $("modal").open ? $("modal") : document.body;
  if (pill.parentNode !== host) host.appendChild(pill);
  const c = qmSearch.counts,
    text = `${t("Quick Match")} · ${t("searching …")}${c ? ` · ${t("{n} online", { n: qmOnline(c) })}` : ""}`;
  const span = pill.querySelector(".qm-pill-text");
  if (span.textContent !== text) span.textContent = text;
}
async function quickMatch() {
  if (qmSearch) return qmDialog();
  if (!webrtcSupported()) return noWebrtcModal("Quick Match"); // v0.19b1
  roomKind = "quick"; // v0.19b1
  if (!begun) disconnectRoom();
  const abort = new AbortController(),
    signal = abort.signal;
  const q = (qmSearch = { abort, status: t("Searching for an opponent …"), counts: null, minimized: false, timer: 0, stopWatch: null });
  presenceState(presenceBase); // counts as "in the queue" while the search runs
  qmDialog();
  const status = (message) => {
    q.status = message;
    if ($("qm-cancel") && $("network-status")) $("network-status").textContent = message;
  };
  // v0.14: who else is online right now (you are counted in the queue)
  const showCounts = (c) => {
    q.counts = c;
    if ($("qm-queue")) $("qm-queue").textContent = String(Math.max(1, c.queue));
    if ($("qm-online")) $("qm-online").textContent = String(qmOnline(c));
    refreshQmPill();
  };
  import("./multiplayer.js")
    .then(({ createPresence }) => {
      if (signal.aborted) return;
      presence ||= createPresence();
      presence.set(presenceWanted);
      q.stopWatch = presence.watch(showCounts);
    })
    .catch(() => {});
  q.timer = setInterval(refreshQmPill, 400);
  try {
    const { findQuickMatch } = await import("./multiplayer.js");
    const match = await findQuickMatch({ signal, onStatus: (s) => status(t(s.message)) });
    if (signal.aborted || qmSearch !== q) return;
    qmSearch = null;
    clearInterval(q.timer);
    q.stopWatch?.();
    refreshQmPill();
    presenceState("pvp");
    sfx.play("matchFound"); // v0.15: notification sound when a Quick Match finds a player
    haptic([60, 40, 60]);
    if (begun) {
      // a training match played while waiting ends here
      begun = false;
      if (game) game.paused = true;
      uiPauses.clear();
      $("tower-panel").hidden = true;
    }
    pvpModal(`${modalHeader(t("Quick Match"))}<div id="network-status" class="network-status">${t("Opponent found! Connecting …")}</div>`); // v0.18f
    if (match.role === "host") {
      connectOnline(undefined, match.code); // (closes any old room first)
      qmSlot = match.slot || null; // v0.19: more searchers can join this room until it starts or is full
    } else connectOnline(match.code, true);
  } catch (error) {
    if (signal.aborted || qmSearch !== q) return;
    cancelQuickMatch();
    if (error.code === "browser-incompatible") return noWebrtcModal("Quick Match"); // v0.19b1
    const msg = t("Connection failed:") + " " + error.message;
    if ($("network-status")) $("network-status").textContent = msg;
    else toast(msg);
  }
}
function onlineMenu() {
  cancelQuickMatch(); // v0.18a: a room with a friend replaces a running Quick Match search
  if (!webrtcSupported()) return noWebrtcModal("Play with a friend"); // v0.19b1
  showModal(
    `${modalHeader(t("Play with a friend"))}<p class="modal-copy">${t("One player opens a room. Up to five friends enter the same code. Each defends their own arena.")}</p><button class="primary-button" id="create-room">${t("Open a room →")}</button><button class="danger-button" id="cancel-room" type="button" hidden>${t("Cancel room")}</button><label for="room-input" class="modal-label">${t("ROOM CODE")}</label><input id="room-input" maxlength="4" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="0000"><button class="secondary-button" id="join-room">${t("Join room")}</button><div id="network-status" class="network-status">${t("Ready for a direct duel.")}</div><p class="modal-note">${t("Internet required. The connection runs directly over WebRTC; PeerJS brokers the contact. If a network blocks direct connections, the game switches to a relay server after a few seconds.")}</p>`,
  );
  // v0.19b1: while you host a room, joining is hidden; cancelling the room shows it again
  const hosting = (on) => {
    for (const id of ["join-room", "room-input"]) if ($(id)) $(id).hidden = on;
    const label = document.querySelector('#modal label[for="room-input"]');
    if (label) label.hidden = on;
    if ($("create-room")) $("create-room").hidden = on;
    if ($("cancel-room")) $("cancel-room").hidden = !on;
  };
  $("create-room").onclick = () => {
    roomKind = "friend";
    hosting(true);
    connectOnline();
  };
  $("cancel-room").onclick = () => {
    disconnectRoom();
    roomKind = null;
    hosting(false);
    if ($("create-room")) $("create-room").disabled = false;
    if ($("join-room")) $("join-room").disabled = false;
    if ($("network-status")) $("network-status").textContent = t("Room closed.");
    tone("tap");
  };
  $("join-room").onclick = () => {
    const code = $("room-input").value.replace(/\D/g, "");
    if (code.length !== 4) {
      toast("Enter the four-digit room code."); // v0.19c1
      return;
    }
    roomKind = "friend";
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
        if (s.error?.code === "browser-incompatible" && !begun) return noWebrtcModal(roomKind === "quick" ? "Quick Match" : "Play with a friend"); // v0.19b1
        status(t(s.message));
        if (s.state === "error" && !begun) {
          if ($("create-room")) $("create-room").disabled = false;
          if ($("join-room")) $("join-room").disabled = false;
        }
      },
      onConnect: (r, peerId) => {
        room = r;
        const first = !connected;
        connected = true;
        if (r.role === "host") netPeers.set(peerId, { seat: null, hidden: false, hiddenSince: 0, at: performance.now() }); // v0.19: one entry per guest
        if (first) {
          // v0.19: the host sits in seat 0; a guest learns its seat from the lobby (1 until then)
          own = r.role === "host" ? 0 : 1;
          lobbySeat = 1;
          simRole = r.role; // v0.16: who simulates can change later (takeover, duels only)
          netEpoch = 0;
          lastSnap = null;
          lastStateAt = lastPeerAt = performance.now();
          view = own;
          ensureBackgroundTicker(); // v0.16
        }
        if (r.role === "guest") r.send({ kind: "ready", faction: chosenFaction, name: playerNameChoice, color: colorPick === "random" ? null : colorPick, icon: iconChoice }); // v0.18a: the picked colour; v0.19c1: icon
      },
      onData: receiveNetwork,
      // v0.19 (host): one guest left; the room and the match go on for the others
      onPeerLeave: (info) => {
        if (signal.aborted) return;
        const peer = netPeers.get(info.id);
        netPeers.delete(info.id);
        if (!begun) return lobbyPeerLeft(info.id);
        if (shownResult || game?.winner != null || peer?.seat == null) return;
        if (!room?.peers().length) {
          connected = false;
          playerLeft(peer.seat);
        } else seatLeft(peer.seat);
      },
      onDisconnect: () => {
        if (signal.aborted) return;
        connected = false;
        if (!begun) {
          // v0.18b: the other player left the lobby: no start, back to the menu with a note
          if (lobby) {
            clearTimeout(lobbyTimer);
            lobbyTimer = 0;
            lobby = null;
            disconnectRoom();
            welcome();
            toast(kickedNote || (room?.role === "host" || simRole === "host" ? "The other player left." : "The host left. The match was cancelled."));
            kickedNote = "";
            return;
          }
          if ($("create-room")) $("create-room").disabled = false;
          if ($("join-room")) $("join-room").disabled = false;
          return;
        }
        if (shownResult || (game && game.winner != null)) return;
        playerLeft(game && game.players.length > 2 ? 0 : 1 - own); // v0.16; v0.19: in larger matches the host (seat 0) left
      },
    };
    let r;
    if (code && preset) {
      // Quick Match guest: the host registers its room a moment later, so retry briefly.
      for (let tries = 0; ; tries++) {
        await new Promise((ok) => setTimeout(ok, 1200));
        if (signal.aborted) return;
        try {
          r = await joinRoom(code, callbacks, { retryUnavailable: 8 }); // v0.19b1: waits for the host's room
          break;
        } catch (error) {
          if (tries >= 4 || error.code !== "peer-unavailable") throw error;
        }
      }
    } else if (code) r = await joinRoom(code, callbacks);
    else if (preset) r = await createRoom(callbacks, {}, preset);
    else
      // v0.19c1: Play a friend: four-digit codes; a code already in use draws a new one
      for (let tries = 0; ; tries++) {
        try {
          r = await createRoom(callbacks, { digits: true });
          break;
        } catch (error) {
          if (tries >= 5 || error.code !== "unavailable-id" || signal.aborted) throw error;
        }
      }
    if (signal.aborted) {
      r.close();
      return;
    }
    room = r;
    if (!code && !preset) lobbyOpen(); // v0.19c1: the host sees the room at once (code, players, bots)
  } catch (error) {
    if (signal.aborted) return;
    status(t("Connection failed:") + " " + error.message);
    if ($("create-room")) $("create-room").disabled = false;
    if ($("join-room")) $("join-room").disabled = false;
  }
}
/** v0.19: the seat a message comes from (host: the guest's seat; duel takeover: the other seat). */
function seatOfPeer(peerId) {
  if (room?.role === "host") return netPeers.get(peerId)?.seat ?? null;
  return game && game.players.length === 2 ? 1 - own : null;
}
/** v0.19: replies go back only to the player who asked. */
const replyTo = (peerId, data) => (room?.role === "host" ? room.sendTo(peerId, data) : room?.send(data));
function receiveNetwork(message, r, peerId) {
  if (!message || typeof message !== "object" || !room) return;
  const now = performance.now();
  lastPeerAt = now; // v0.16
  const peer = room.role === "host" ? netPeers.get(peerId) : null;
  if (peer) peer.at = now;
  if (message.kind === "presence") {
    const box = peer || away; // v0.19: every guest has its own away state on the host
    const key = peer ? "hidden" : "remoteHidden",
      since = peer ? "hiddenSince" : "remoteHiddenSince";
    box[key] = !!message.hidden;
    if (message.hidden && !box[since]) box[since] = now;
    if (!message.hidden) box[since] = 0;
    return;
  }
  if (message.kind === "takeover" && Number(message.epoch) > netEpoch) {
    // v0.16: the other side carries the match on (our tab stalled); from now on we follow
    netEpoch = Number(message.epoch);
    simRole = "guest";
    lastStateAt = performance.now();
    toast("Your game stalled – the match continues on the other side.");
    return;
  }
  if (message.kind === "snap" && isFollower() && message.game) {
    lastSnap = message.game;
    return;
  }
  if (message.kind === "state" && simRole === "host" && Number(message.epoch) > netEpoch) {
    netEpoch = Number(message.epoch);
    simRole = "guest";
  }
  if (message.kind === "transport-pause" && isFollower()) {
    game.paused = true;
    toast("Transfer paused. The host is restoring the connection.");
    return;
  }
  if (simRole === "host") {
    if (message.kind === "ready" && !begun && room.role === "host") lobbyJoin(peerId, message); // v0.19: up to six players
    if (message.kind === "kicked" && !begun && room.role === "guest") kickedNote = message.reason === "full" ? "The room is full." : "The host removed you from the room."; // v0.19c1
    if (message.kind === "lobby-start" && !begun && lobby?.go && peer) lobby.go(); // v0.18b: a guest pressed Start
    if (message.kind === "team" && !begun && lobby && !lobby.done && lobbyTeams()) lobbyMoveTeam(lobby.entries.findIndex((e) => e.peer === peerId), Number(message.team)); // v0.20: a guest changed its own team
    if (
      message.kind === "command" &&
      begun &&
      message.command &&
      ["build", "send", "upgrade", "sell", "autoSend", "autoHold", "pick", "surrender", "volley", "burst", "pillar", "agolem", "monsun"].includes(message.command.type)
    ) {
      const c = message.command,
        id = typeof c.id === "string" ? c.id : c.id === null ? null : undefined,
        seat = seatOfPeer(peerId); // v0.19: the sender's seat, never what the message claims
      if (seat == null || !game.players[seat]) return;
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
              mode: AUTO_MODES.includes(c.mode) ? c.mode : undefined, // v0.18h
              hold: typeof c.hold === "boolean" ? c.hold : undefined,
              x: typeof c.x === "number" ? c.x : undefined,
              y: typeof c.y === "number" ? c.y : undefined,
              player: seat,
            });
      replyTo(peerId, { kind: "result", result });
      sendState();
    }
    if (message.kind === "pause" && typeof message.paused === "boolean") {
      // v0.10h: no pauses in PvP; a pause request from the guest is ignored
      networkPauses.clear();
      game.paused = transportBlocked || networkPauses.size > 0;
      sendState();
    }
  } else if (message.kind === "lobby" && !begun && isFollower()) {
    // v0.19: the host tells every guest its seat
    if (Number.isInteger(message.you) && message.you > 0 && message.you < LOBBY_MAX) lobbySeat = message.you;
    if (message.room === "friend" || message.room === "quick") roomKind = message.room; // v0.19b1
    if (message.opts && typeof message.opts === "object") roomOpts = { waves: message.opts.waves !== false, rotation: message.opts.rotation !== false, mode: message.opts.mode === "teams" ? "teams" : "ffa", gold: message.opts.gold === "own" ? "own" : "shared" }; // v0.20
    if (ROOM_LIVES.includes(message.lives) || TEAM_LIVES.includes(message.lives)) roomLives = message.lives;
    showLobby(message.players, Number(message.left) || lobbyWait(), message.timed !== false); // v0.18a, v0.18b: with Start button and wait time
  } else if (message.kind === "lobby-go" && !begun && isFollower()) {
    lobbyStarting(); // v0.18b
  } else if (
    message.kind === "state" &&
    message.game?.version === SAVE_VERSION &&
    message.game.players?.length >= 2 &&
    message.game.players.length <= LOBBY_MAX &&
    lobbySeat < message.game.players.length &&
    isCompatibleGameGrid(message.game)
  ) {
    if (!isFollower()) return; // v0.16: a stale state from the old host
    lastStateAt = performance.now();
    if (!begun) own = view = lobbySeat; // v0.19: the seat from the lobby, taken with the first state
    guestReceived(message.game);
    game = message.game;
    if (!begun) {
      if (TEAM_COLORS[game.players[own]?.color]) colorChoice = game.players[own].color; // v0.18a: the colour the host assigned
      applyColors();
      begun = true;
      setHelpMode(false); // v0.19a1
      shownResult = false;
      uiPauses.clear();
      selected = null;
      lastEvent = 0;
      closeModal();
      setPage("build");
      refreshUI();
    }
    // v0.13b: the regular UI refresh (every 0.15 s) shows the new state; no extra pass per packet
  } else if (message.kind === "result") {
    if (!message.result?.ok) toast(message.result?.reason || "Not possible");
    else tone("tap");
    renderCards();
  }
}
// ---- v0.18a: online lobby: who plays which colour, shown for a moment before the match ----
// v0.18b: the lobby waits up to 45 s for more players and has a Start button for everyone.
// v0.19: up to six players per room (Quick Match and Play a friend).
const LOBBY_WAIT = 45000,
  FRIEND_WAIT = 240000, // v0.19b1: a room with friends waits up to 4 minutes before it starts on its own
  LOBBY_MAX = 6,
  ROOM_LIVES = [10, 25, 40]; // v0.19b1: start lives the host of a friend room can choose
let kickedNote = "", // v0.19c1: why the host closed our link
  roomKind = null, // v0.19b1: "quick" (Quick Match) or "friend" (Play a friend)
  roomLives = 25,
  // v0.20: the host's room options: neutral waves, target rotation, free-for-all or teams, shared or own gold
  roomOpts = { waves: true, rotation: true, mode: "ffa", gold: "shared" };
const roomLivesList = () => (roomOpts.mode === "teams" ? TEAM_LIVES : ROOM_LIVES);
const lobbyTeams = () => roomKind === "friend" && roomOpts.mode === "teams";
/** v0.20: the room options of a friend room: switches for the host, a short line for guests. */
function roomOptions(host) {
  if (roomKind !== "friend") return "";
  const o = roomOpts,
    seg = (key, label, items) =>
      `<div class="welcome-inline room-opt"><span class="modal-label">${t(label)}</span><div class="segmented" role="radiogroup" aria-label="${t(label)}">${items
        .map(([v, name]) => `<button type="button" role="radio" data-roomopt="${key}" data-val="${v}" aria-checked="${String(o[key]) === v}" class="${String(o[key]) === v ? "active" : ""}">${t(name)}</button>`)
        .join("")}</div></div>`;
  if (!host) {
    const parts = [t(o.mode === "teams" ? "Teams" : "Free for all"), t("Lives") + ": " + roomLives, t("Neutral waves") + ": " + t(o.waves ? "On" : "Off"), o.mode === "teams" ? t("Gold") + ": " + t(o.gold === "shared" ? "Shared" : "Own") : t("Rotation") + ": " + t(o.rotation ? "On" : "Off")];
    return `<p class="modal-note room-opts">${parts.map(esc).join(" · ")}</p>`;
  }
  return `<div class="room-opts">${seg("mode", "Mode", [["ffa", "FFA"], ["teams", "Teams"]])}${livesPicker(host)}${seg("waves", "Neutral waves", [["true", "On"], ["false", "Off"]])}${
    o.mode === "teams" ? seg("gold", "Gold", [["shared", "Shared"], ["own", "Own"]]) : seg("rotation", "Rotation", [["true", "On"], ["false", "Off"]])
  }</div>`;
}
function wireRoomOptions() {
  document.querySelectorAll("#modal [data-roomopt]").forEach(
    (b) =>
      (b.onclick = () => {
        const key = b.dataset.roomopt,
          v = b.dataset.val;
        roomOpts[key] = key === "waves" || key === "rotation" ? v === "true" : v;
        if (!roomLivesList().includes(roomLives)) roomLives = roomLivesList()[1]; // v0.21d: the middle option (25 free for all, 40 teams)
        tone("select");
        if (lobby && !lobby.done) {
          if (key === "mode") lobbyColors();
          lobbyBroadcast();
        }
      }),
  );
}
const lobbyWait = () => (roomKind === "friend" ? FRIEND_WAIT : LOBBY_WAIT);
/** v0.19b1: start lives picker for the host of a friend room (guests see the value). */
function livesPicker(host) {
  if (roomKind !== "friend") return "";
  if (!host) return ""; // v0.20c: guests read it in the room options line
  return `<div class="welcome-inline lobby-lives room-opt"><span class="modal-label">${t("Lives")}</span><div class="segmented" role="radiogroup" aria-label="${t("Lives")}">${roomLivesList().map((n) => `<button type="button" role="radio" data-lives="${n}" aria-checked="${n === roomLives}" class="${n === roomLives ? "active" : ""}">${n}</button>`).join("")}</div></div>`;
}
function wireLivesPicker() {
  document.querySelectorAll("#modal [data-lives]").forEach(
    (b) =>
      (b.onclick = () => {
        roomLives = Number(b.dataset.lives) || 25;
        document.querySelectorAll("#modal [data-lives]").forEach((x) => {
          const on = Number(x.dataset.lives) === roomLives;
          x.classList.toggle("active", on);
          x.setAttribute("aria-checked", String(on));
        });
        tone("select");
        if (lobby && !lobby.done) lobbyBroadcast();
      }),
  );
}
let lobbyTimer = 0,
  lobby = null,
  lobbyTick = 0,
  qmSlot = null, // v0.19: Quick Match host: the lobby slot that hands out this room's code
  lobbySeat = 1; // v0.19, guest: the seat the host gave us
/** v0.19, host: guests by peer id: their seat (from the start of the match) and away state. */
const netPeers = new Map();
/** v0.19, host: a guest joined the lobby (or sent its choices again). */
/** v0.19c1, host: a new lobby with the host's own entry (Quick Match: at the first guest; friend room: at once). */
function newLobby() {
  return {
    until: performance.now() + lobbyWait(),
    done: false,
    timed: false,
    go: lobbyGo,
    entries: [{ peer: null, key: "host", name: playerNameChoice, pick: colorPick === "random" ? null : colorPick, faction: chosenFaction, icon: iconChoice, team: 0 }],
    players: [],
  };
}
/** v0.19c1: a friend room's host sees the lobby (code, players, bots) as soon as the room is open. */
function lobbyOpen() {
  if (lobby || !room) return;
  own = 0;
  simRole = "host";
  lobby = newLobby();
  lobbyColors();
  lobbyBroadcast();
}
/** v0.19c1: the wait time starts with the first guest. */
function lobbyStartTimer() {
  if (!lobby || lobby.timed) return;
  lobby.timed = true;
  lobby.until = performance.now() + lobbyWait();
  clearTimeout(lobbyTimer);
  lobbyTimer = setTimeout(lobbyGo, lobbyWait());
}
const lobbyHumans = () => (lobby?.entries || []).filter((e) => e.peer != null).length;
let botSeq = 0;
const botLevels = () => Object.keys(AI_NAMES).filter((id) => id !== "insane"); // veryEasy … hard (Hardo is Training only)
/** v0.19c1, host: a bot takes a free seat of the friend room (difficulty Normal). */
function lobbyAddBot() {
  if (!lobby || lobby.done || lobby.entries.length >= LOBBY_MAX) return;
  const factions = catalog.factions.map((f) => f.id);
  lobby.entries.push({ peer: null, bot: true, level: "normal", key: "bot" + ++botSeq, name: "", pick: null, faction: factions[Math.floor(Math.random() * factions.length)], icon: null, team: smallerTeam() });
  lobbyColors();
  lobbyBroadcast();
  tone("select");
}
/** v0.19c1, host: the next difficulty for a bot. */
function lobbyBotLevel(i) {
  const e = lobby?.entries[i];
  if (!e?.bot || lobby.done) return;
  const levels = botLevels();
  e.level = levels[(levels.indexOf(e.level) + 1) % levels.length];
  lobbyColors();
  lobbyBroadcast();
  tone("tap");
}
/** v0.19c1, host: removes a bot or a player from the room. */
function lobbyKick(i) {
  const e = lobby?.entries[i];
  if (!e || i === 0 || lobby.done) return;
  lobby.entries.splice(i, 1);
  if (e.peer != null && room) {
    room.sendTo(e.peer, { kind: "kicked" });
    const id = e.peer;
    setTimeout(() => room?.kick(id), 250);
    netPeers.delete(id);
  }
  if (!lobbyHumans()) {
    // nobody waiting any more: no automatic start
    clearTimeout(lobbyTimer);
    lobbyTimer = 0;
    lobby.timed = false;
  }
  lobbyColors();
  lobbyBroadcast();
  tone("tap");
}
function lobbyJoin(peerId, message) {
  if (lobby?.done || !room) return;
  const entry = {
    peer: peerId,
    key: "p" + peerId,
    name: cleanName(message.name),
    pick: TEAM_COLORS[message.color] ? message.color : null,
    faction: catalog.factions.some((f) => f.id === message.faction) ? message.faction : "fire",
    icon: PLAYER_ICONS.includes(message.icon) ? message.icon : "player", // v0.19c1
  };
  if (!lobby) lobby = newLobby();
  const i = lobby.entries.findIndex((e) => e.peer === peerId);
  entry.team = i >= 0 ? lobby.entries[i].team : smallerTeam(); // v0.20
  if (i >= 0) lobby.entries[i] = entry;
  else if (lobby.entries.length >= LOBBY_MAX) {
    // v0.19c1: every seat taken (bots included)
    room.sendTo(peerId, { kind: "kicked", reason: "full" });
    setTimeout(() => room?.kick(peerId), 250);
    return;
  } else lobby.entries.push(entry);
  lobbyStartTimer();
  lobbyColors();
  lobbyBroadcast();
  if (lobby.entries.length >= Math.min(LOBBY_MAX, room.maxPlayers || LOBBY_MAX) && !lobby.entries.some((e) => e.bot)) {
    // full: start soon
    qmSlot?.close();
    qmSlot = null;
    clearTimeout(lobbyTimer);
    lobbyTimer = setTimeout(lobbyGo, 400);
  }
}
/** v0.20: the team with fewer players (blue first). */
function smallerTeam() {
  const n = [0, 1].map((t) => (lobby?.entries || []).filter((e) => (e.team | 0) === t).length);
  return n[1] < n[0] ? 1 : 0;
}
/** v0.20, host: a player or bot changes team (the host drags anyone, a guest only itself). */
function lobbyMoveTeam(i, team) {
  const e = lobby?.entries[i];
  if (!e || lobby.done || (team !== 0 && team !== 1) || (e.team | 0) === team) return;
  e.team = team;
  lobbyColors();
  lobbyBroadcast();
  tone("select");
}
/** v0.18a colours in join order; settled again only when someone joins or leaves. */
function lobbyColors() {
  // v0.20b: stable colours: honoured picks first, then everyone (bots, "Random") keeps the colour
  // they already had while it is free, so a team move or a bot's difficulty no longer recolours anyone
  const base = assignColors(lobby.entries.map((e) => e.pick)),
    colors = [],
    used = new Set();
  lobby.entries.forEach((e, i) => {
    if (e.pick && base[i] === e.pick) used.add((colors[i] = base[i]));
  });
  lobby.entries.forEach((e, i) => {
    if (colors[i] == null && TEAM_COLORS[e.color] && !used.has(e.color)) used.add((colors[i] = e.color));
  });
  lobby.entries.forEach((e, i) => {
    if (colors[i] == null) used.add((colors[i] = !used.has(base[i]) ? base[i] : randomColor([...used])));
    e.color = colors[i];
  });
  // v0.20c: in a team game everyone wears the colour of their team's first player
  if (lobbyTeams())
    for (const tm of [0, 1]) {
      const lead = lobby.entries.findIndex((e) => (e.team | 0) === tm);
      if (lead >= 0) lobby.entries.forEach((e, i) => (e.team | 0) === tm && (colors[i] = colors[lead]));
    }
  lobby.players = lobby.entries.map((e, i) => ({
    name: e.bot ? `${t("AI")} ${t(AI_NAMES[e.level] || "Normal")}` : e.name || `Player ${i + 1}`,
    color: colors[i],
    picked: e.pick,
    icon: e.icon || null, // v0.19c1
    team: e.team | 0, // v0.20
    ...(e.bot ? { bot: true, level: e.level } : {}),
  }));
}
function lobbyBroadcast() {
  if (!lobby || !room) return;
  const left = Math.max(0, lobby.until - performance.now());
  lobby.entries.forEach((e, i) => {
    if (e.peer != null) room.sendTo(e.peer, { kind: "lobby", players: lobby.players, left, you: i, room: roomKind, lives: roomLives, opts: roomOpts, timed: lobby.timed });
  });
  showLobby(lobby.players, left, lobby.timed);
}
/** v0.19, host: a guest left before the start. */
function lobbyPeerLeft(peerId) {
  if (!lobby || lobby.done) return;
  const i = lobby.entries.findIndex((e) => e.peer === peerId);
  if (i < 0) return;
  const [gone] = lobby.entries.splice(i, 1);
  if (roomKind === "friend") {
    // v0.19c1: a friend room stays open for others; without guests it no longer starts by itself
    if (!lobbyHumans()) {
      clearTimeout(lobbyTimer);
      lobbyTimer = 0;
      lobby.timed = false;
    }
  } else if (lobby.entries.length < 2) {
    // nobody left to play with: back to the menu, as before
    clearTimeout(lobbyTimer);
    lobbyTimer = 0;
    lobby = null;
    disconnectRoom();
    welcome();
    toast("The other player left.");
    return;
  }
  lobbyColors();
  lobbyBroadcast();
  toast(t("{name} left the lobby.", { name: gone.name ? nameTag(gone.name, TEAM_COLORS[gone.color]?.css) : t("A player") }));
}
/** v0.19, host: Start pressed, room full or wait time over. */
function lobbyGo() {
  if (!lobby || lobby.done) return;
  if (lobby.entries.length < 2) {
    toast(t("Add a bot or wait for another player.")); // v0.19c1: never a match alone
    return;
  }
  clearTimeout(lobbyTimer);
  lobbyTimer = 0;
  lobby.done = true;
  qmSlot?.close();
  qmSlot = null;
  if (!room || begun || simRole !== "host") return;
  room.lock(); // no new players once the match runs
  const seated = new Set(lobby.entries.map((e) => e.peer));
  for (const id of room.peers()) if (!seated.has(id)) room.kick(id); // connected, but never sent its choices
  room.send({ kind: "lobby-go" });
  startHostedMatch(lobby.entries, lobby.players);
}
const inkFor = (css) => {
  const n = parseInt(String(css).slice(1), 16),
    lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? "#14181c" : "#fff";
};
/** v0.20: drag a player card into the other team's column (mouse and touch). */
function wireTeamDrag(host, me) {
  const moveTo = (seat, team) => {
    if (host) lobbyMoveTeam(seat, team);
    else if (seat === me) room?.send({ kind: "team", team });
  };
  document.querySelectorAll("#modal [data-jointeam]").forEach((b) => (b.onclick = () => moveTo(me, Number(b.dataset.jointeam))));
  document.querySelectorAll("#modal .qm-player.team-drag").forEach((card) => {
    card.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      e.preventDefault(); // no native image drag, which would cancel the pointer
      const seat = Number(card.dataset.seat),
        from = Number(card.closest(".team-col")?.dataset.team),
        r = card.getBoundingClientRect(),
        ghost = card.cloneNode(true),
        dx = e.clientX - r.left,
        dy = e.clientY - r.top;
      let moved = false;
      ghost.classList.add("team-ghost");
      Object.assign(ghost.style, { position: "fixed", left: r.left + "px", top: r.top + "px", width: r.width + "px", zIndex: 2147483647, pointerEvents: "none" });
      card.setPointerCapture?.(e.pointerId);
      const over = (x, y) => document.elementsFromPoint(x, y).find((el) => el.classList?.contains("team-col"));
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) return;
        if (!moved) {
          moved = true;
          card.closest("dialog")?.append(ghost);
          card.classList.add("dragging");
        }
        ghost.style.left = ev.clientX - dx + "px";
        ghost.style.top = ev.clientY - dy + "px";
        document.querySelectorAll("#modal .team-col").forEach((c) => c.classList.toggle("drop", c === over(ev.clientX, ev.clientY)));
      };
      const up = (ev) => {
        card.removeEventListener("pointermove", move);
        card.removeEventListener("pointerup", up);
        card.removeEventListener("pointercancel", up);
        ghost.remove();
        card.classList.remove("dragging");
        document.querySelectorAll("#modal .team-col").forEach((c) => c.classList.remove("drop"));
        if (!moved) return;
        const col = over(ev.clientX, ev.clientY),
          to = col ? Number(col.dataset.team) : from;
        if (to !== from) moveTo(seat, to);
      };
      card.addEventListener("pointermove", move);
      card.addEventListener("pointerup", up);
      card.addEventListener("pointercancel", up);
    });
  });
}
function showLobby(players, left = lobbyWait(), timed = true) {
  if (!Array.isArray(players)) return;
  const until = performance.now() + Math.max(0, Math.min(lobbyWait(), left));
  if (!lobby || lobby.done) lobby = { ...(lobby || {}), done: false };
  const me = room?.role === "guest" ? lobbySeat : own; // v0.19
  const host = simRole === "host" && room?.role !== "guest",
    friend = roomKind === "friend";
  lobby.until = until;
  if (!host) lobby.timed = timed;
  // v0.19c1: player and bot cards with icon; bots carry a difficulty button (host only), the host can kick
  const cardList = players
    .slice(0, 8)
    .map((p, i) => {
      const c = TEAM_COLORS[p?.color] ? p.color : "blue",
        css = TEAM_COLORS[c].css,
        face = p?.bot ? portraitFor({ ai: true, aiLevel: p.level }) : i === me ? iconSrc(iconChoice) : iconSrc(p?.icon),
        level = p?.bot ? `<button type="button" class="bot-level" data-botlevel="${i}"${host ? "" : " disabled"}>${esc(t(AI_NAMES[p.level] || "Normal"))}</button>` : "",
        kick = host && i > 0 ? `<button type="button" class="kick-x" data-kick="${i}" aria-label="${t("Remove")}" title="${t("Remove")}">×</button>` : "";
      const drag = lobbyTeams() && (host || i === me) ? " team-drag" : ""; // v0.20: the host drags anyone, a guest only itself
      return `<div class="qm-player${i === me ? " me" : ""}${p?.bot ? " bot" : ""}${drag}" data-seat="${i}" style="--pc:${css};--ink:${inkFor(css)}"><img class="qm-icon portrait" src="${face}" alt=""><b>${esc(p?.bot ? p.name : cleanName(p?.name) || t("Player {n}", { n: i + 1 }))}${i === me ? ` <small>(${t("You")})</small>` : ""}</b>${level}${kick}</div>`;
    })
    ;

  // v0.20: in a team game two columns, each headed by its leader's colour (blue and red while empty)
  let cards = cardList.join("");
  if (lobbyTeams()) {
    cards = [0, 1]
      .map((team) => {
        const seats = players.map((p, i) => i).filter((i) => (players[i]?.team | 0) === team),
          lead = seats.length ? players[seats[0]].color : team ? "red" : "blue",
          css = TEAM_COLORS[lead]?.css || "#3f9fff",
          join = !host && (players[me]?.team | 0) !== team ? `<button type="button" class="team-join" data-jointeam="${team}">${t("Join")}</button>` : "";
        return `<div class="team-col" data-team="${team}" style="--tc:${css}"><div class="team-head"><b>${t("Team {name}", { name: t(TEAM_COLORS[lead]?.name || "Blue") })}</b><small>${seats.length}</small>${join}</div>${seats.map((i) => cardList[i]).join("") || `<p class="team-empty">${t("Drag players here")}</p>`}</div>`;
      })
      .join("");
  }
  const code = friend && room?.code ? `<div class="lobby-code"><span>${t("Room code")}</span><b>${esc(room.code)}</b></div>` : "",
    addBot = host && friend && players.length < LOBBY_MAX ? `<button class="secondary-button" id="lobby-add-bot" type="button">${t("+ Add bot")}</button>` : "",
    cancel = ""; // v0.20a: the red × in the corner closes the room
  pvpModal(
    `${modalHeader(t(friend ? "Room" : "Match found"))}${code}<div class="qm-lobby${players.length > 3 ? " many" : ""}${lobbyTeams() ? " teams" : ""}">${cards}</div>${addBot}${roomOptions(host)}<p class="modal-note qm-wait" id="qm-wait"></p><button class="primary-button" id="lobby-start" type="button">${t("Start match")}</button>${cancel}`,
  );
  wireLivesPicker(); // v0.19b1
  wireRoomOptions(); // v0.20
  wireTeamDrag(host, me);
  if (host) {
    $("lobby-add-bot") && ($("lobby-add-bot").onclick = lobbyAddBot);
    document.querySelectorAll("#modal [data-botlevel]").forEach((b) => (b.onclick = () => lobbyBotLevel(Number(b.dataset.botlevel))));
    document.querySelectorAll("#modal [data-kick]").forEach((b) => (b.onclick = () => lobbyKick(Number(b.dataset.kick))));
    if ($("lobby-cancel"))
      $("lobby-cancel").onclick = () => {
        tone("tap");
        disconnectRoom();
        roomKind = null;
        onlineMenu();
      };
  }
  const wait = () => {
    const el = $("qm-wait");
    if (!el) return clearInterval(lobbyTick);
    const sec = Math.max(0, Math.ceil((lobby.until - performance.now()) / 1000));
    el.textContent = lobby.done
      ? t("The match starts …")
      : lobby.timed === false
        ? t("Waiting for players ({n}/{m})", { n: players.length, m: LOBBY_MAX })
        : t("Waiting for players ({n}/{m}) · starts in {s} s", { n: players.length, m: LOBBY_MAX, s: sec });
  };
  clearInterval(lobbyTick);
  lobbyTick = setInterval(wait, 250);
  wait();
  $("lobby-start").onclick = () => {
    tone("select");
    if (simRole === "host") lobby?.go?.();
    else room?.send({ kind: "lobby-start" });
    lobbyStarting();
  };
}
/** v0.18b: Start was pressed (here or on the other side): the button waits for the match. */
function lobbyStarting() {
  if (lobby) lobby.done = true;
  const b = $("lobby-start");
  if (b) {
    b.disabled = true;
    b.textContent = t("Starting …");
  }
  if ($("qm-wait")) $("qm-wait").textContent = t("The match starts …");
}
function startHostedMatch(entries, players) {
  // v0.19: one seat per lobby entry in join order (host = seat 0), up to six players
  game = createGame({
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
    mode: chosenMode,
    factions: entries.map((e) => e.faction),
    ai: false,
    waves: roomKind === "friend" ? roomOpts.waves : wavesOn, // v0.20: the friend room's switch
    rotation: roomKind === "friend" ? roomOpts.rotation : true,
    teams: lobbyTeams() ? { members: entries.map((e) => e.team | 0), gold: roomOpts.gold } : null,
    seats: entries.length,
    lives: roomKind === "friend" ? roomLives : null, // v0.19b1: the host's choice in a friend room
  });
  entries.forEach((e, i) => {
    // v0.13: names and v0.18a: colours travel in the game state
    game.players[i].name = players[i].name || `Player ${i + 1}`;
    game.players[i].color = players[i].color;
    game.players[i].icon = e.icon || "player"; // v0.19c1
    if (e.bot) {
      // v0.19c1: a bot the host added in the friend room
      game.players[i].ai = true;
      game.players[i].aiLevel = e.level || "normal";
    }
    const peer = e.peer != null ? netPeers.get(e.peer) : null;
    if (peer) {
      peer.seat = i;
      peer.at = performance.now();
    }
  });
  warnedWave = 0;
  own = 0;
  view = 0;
  colorChoice = players[0].color;
  applyColors();
  begun = true;
  setHelpMode(false); // v0.19a1
  shownResult = false;
  game.paused = false;
  uiPauses.clear();
  selected = null;
  lastEvent = 0;
  closeModal();
  setPage("build");
  sendState();
}
// ---- v0.16: online duels without stutter -----------------------------------------------------
// The side that simulates (simRole "host") steps the match by the wall clock, also while its tab
// is hidden (a small worker keeps ticking), and sends a full snapshot every 3 s. If the
// simulating side stalls (a phone app in the background freezes the page), the other side takes
// over from the last snapshot. Whoever is away for 20 s is played by the AI until they return.
let simRole = null,
  netEpoch = 0,
  lastSnap = null,
  lastStateAt = 0,
  lastPeerAt = 0,
  simClock = 0,
  netSentAt = 0,
  snapSentAt = 0,
  presenceSentAt = 0,
  absenceAt = 0;
const away = { remoteHidden: false, remoteHiddenSince: 0, ownHiddenSince: 0 };
const AWAY_MS = 20000,
  STALL_MS = 3000;
const isFollower = () => !!room && simRole === "guest";
const isAuthority = () => !room || simRole === "host";
function netPulse(now) {
  if (!room || !game) return;
  // v0.20a: a friend room with only bots runs without any guest connected
  if (begun && isAuthority() && (connected || game.players.every((q) => q.id === own || q.ai))) {
    // catch up on real time in fixed slices (at most 5 s at once)
    let due = simClock ? Math.min(5, (now - simClock) / 1000) : 0;
    simClock = now;
    while (due > 1e-4) {
      const slice = Math.min(0.1, due);
      step(game, slice);
      due -= slice;
    }
    absenceCheck(now);
    if (now - netSentAt >= (room.isRelay?.() ? 200 : 120)) {
      netSentAt = now;
      sendState();
    }
    if (now - snapSentAt >= (room.isRelay?.() ? 6000 : 3000)) {
      snapSentAt = now;
      try {
        room.send({ kind: "snap", epoch: netEpoch, game: { ...JSON.parse(serializeGame(game)), events: [] } });
      } catch {}
    }
  } else {
    simClock = 0;
    if (begun && isFollower()) {
      guestExtrapolate();
      // v0.19: only duels can move the simulation to the guest (larger rooms are a star around the host)
      if (lastSnap && now - lastStateAt > STALL_MS && game.players.length === 2) takeOver(now);
    }
  }
  if (now - presenceSentAt >= 2000) {
    presenceSentAt = now;
    room.send({ kind: "presence", hidden: document.hidden });
  }
}
/** The simulating side went silent: carry the match on from the last snapshot. */
function takeOver(now) {
  let restored;
  try {
    restored = restoreGame(lastSnap);
  } catch {
    return;
  }
  game = restored;
  netEpoch++;
  simRole = "host";
  simClock = now;
  game.paused = false;
  const other = game.players[1 - own];
  if (other && !other.ai) {
    other.ai = true;
    other.aiTakeover = true;
  }
  room?.send({ kind: "takeover", epoch: netEpoch });
  sendState();
  toast(t("{name} stalled – you carry the match on, the AI plays for them.", { name: seatTag(1 - own) }));
}
/** On the simulating side: a player away for 20 s is played by the AI until they return. */
function absenceCheck(now) {
  if (now - absenceAt < 500 || !begun || game.winner != null) return;
  absenceAt = now;
  const gone = { [own]: document.hidden && away.ownHiddenSince && now - away.ownHiddenSince > AWAY_MS };
  if (room?.role === "host") {
    // v0.19: every guest on its own
    for (const peer of netPeers.values())
      if (peer.seat != null) gone[peer.seat] = (peer.hidden && peer.hiddenSince && now - peer.hiddenSince > AWAY_MS) || now - peer.at > AWAY_MS;
  } else gone[1 - own] = (away.remoteHidden && away.remoteHiddenSince && now - away.remoteHiddenSince > AWAY_MS) || now - lastPeerAt > AWAY_MS;
  for (const [seat, isAway] of Object.entries(gone)) {
    const p = game.players[seat];
    if (!p || p.out || p.netLeft) continue;
    if (isAway && !p.ai) {
      p.ai = true;
      p.aiTakeover = true;
    } else if (!isAway && p.aiTakeover) {
      p.ai = false;
      delete p.aiTakeover;
    }
  }
}
/** v0.19, host: a guest left a match with other humans still in it: the AI takes the seat for good. */
function seatLeft(seat) {
  const p = game?.players[seat];
  if (!p) return;
  const name = seatName(seat);
  if (!p.out) {
    p.ai = true;
    p.aiLevel ||= "normal";
    p.netLeft = true;
    delete p.aiTakeover;
  }
  toast(t("{name} left – the AI plays for them.", { name: seatTag(seat) }), "level");
  sendState();
}
/** v0.16: the other player left mid-match: leave too, or play on against the AI in their seat. */
function playerLeft(seat = 1 - own) {
  const name = seatName(seat);
  let local = null;
  try {
    local = isFollower() ? (lastSnap ? restoreGame(lastSnap) : null) : game;
  } catch {
    local = null;
  }
  if (game) game.paused = true;
  showModal(
    `${modalHeader(t("{name} left the game", { name }))}<p class="modal-copy">${t("{name} left the game.", { name })}</p>${local ? `<button class="primary-button" id="left-ai">${t("Continue with AI")}</button>` : ""}<button class="secondary-button" id="left-leave">${t("Leave the match")}</button>`,
    { pauseGame: false },
  );
  if ($("left-ai"))
    $("left-ai").onclick = () => {
      game = local;
      disconnectRoom();
      simRole = null;
      sessionMode = game.players.length > 2 ? "ffa" : "training";
      // v0.19: every other seat is played by the AI from now on
      for (const q of game.players) {
        if (q.id === own) continue;
        q.ai = true;
        q.aiLevel ||= "normal";
        delete q.aiTakeover;
      }
      delete game.players[own].aiTakeover;
      game.players[own].ai = false;
      game.paused = false;
      uiPauses.clear();
      closeModal();
      refreshUI();
      arena?.refresh();
    };
  $("left-leave").onclick = () => {
    begun = false;
    shownResult = false;
    disconnectRoom();
    welcome();
  };
}
/** Tells both players when the AI starts or stops playing for someone. */
const takeoverShown = {};
function takeoverNotes() {
  if (!room || !game) return;
  for (const p of game.players) {
    const on = !!p.aiTakeover;
    if (!!takeoverShown[p.id] === on) continue;
    takeoverShown[p.id] = on;
    if (p.id === own) toast(on ? "You were away – the AI plays for you until you're back." : "Welcome back – you're in control again.", "level");
    else toast(t(on ? "{name} is away – the AI plays for them." : "{name} is back.", { name: seatTag(p.id) }), "level");
  }
}
// a worker tick keeps a hidden host running (timers in hidden tabs are slowed down a lot)
let bgTicker = null;
function ensureBackgroundTicker() {
  if (bgTicker) return;
  const run = () => {
    if (document.hidden && room) netPulse(performance.now());
  };
  try {
    const url = URL.createObjectURL(new Blob(["setInterval(function(){postMessage(0)},50)"], { type: "text/javascript" }));
    bgTicker = new Worker(url);
    bgTicker.onmessage = run;
  } catch {
    bgTicker = setInterval(run, 50);
  }
}
document.addEventListener("visibilitychange", () => {
  away.ownHiddenSince = document.hidden ? performance.now() : 0;
  if (room) {
    room.send({ kind: "presence", hidden: document.hidden });
    presenceSentAt = performance.now();
    if (!document.hidden) lastStateAt = Math.max(lastStateAt, performance.now() - 1000); // no takeover right after waking up
  }
});
/** v0.16: cartoon countdown of the first round (setup), one pop per second. */
let warmupShown = 0;
function warmupCountdown() {
  const n = game && begun && game.warmup && game.running !== false ? Math.ceil(game.incomeRemaining - 1e-6) : 0;
  if (n === warmupShown) return;
  warmupShown = n;
  let el = $("warmup-count");
  if (!n || n > 10) return el?.remove();
  if (!el) {
    el = Object.assign(document.createElement("div"), { id: "warmup-count", className: "warmup-count" });
    el.setAttribute("aria-hidden", "true");
    $("arena").append(el);
  }
  el.textContent = n;
  // v0.18d: every number in your own player colour (each player sees their own)
  const css = TEAM_COLORS[seatColors()[own]]?.css || "#ffe27a",
    rgb = parseInt(css.slice(1), 16),
    lum = 0.299 * ((rgb >> 16) & 255) + 0.587 * ((rgb >> 8) & 255) + 0.114 * (rgb & 255);
  el.style.setProperty("--wc", css);
  el.style.setProperty("--ws", lum < 70 ? "#e8eef4" : "#1c1408");
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
}
function tick(dt) {
  syncMusic();
  warmupCountdown();
  if (!game) return;
  // v0.16: online games run on the wall clock (netPulse), so a slow or hidden tab never stalls the duel
  if (room) netPulse(performance.now());
  else if (begun) step(game, dt * gameSpeed);
  if (rec) recTick(); // v0.22b
  hardoTalkTime += dt;
  if (hardoTalkTime >= 1) {
    hardoTalkTime = 0;
    hardoTalk(); // v0.22e
  }
  uiTime += dt;
  queueTime += dt;
  if (queueTime >= 0.25) {
    queueTime = 0;
    runQueue();
    predatorCheck(); // v0.15
  }
  saveTime += dt;
  networkTime += dt;
  if (uiTime >= 0.15) {
    uiTime = 0;
    refreshUI();
    takeoverNotes(); // v0.16
    if (selectedTower) showTower(selectedTower);
    for (const e of game.events || []) {
      const seq = e.seq || e.id;
      if (typeof seq !== "number" || seq <= lastEvent) continue;
      lastEvent = seq;
      if (e.type === "volleyStart" && e.player === view) tone("volley");
      if (e.type === "burst" && e.player === view) tone("built");
      // v0.12
      if (e.type === "pillar" && e.player === view) tone("pillar");
      if (e.type === "monsun" && e.player === view) tone("monsun");
      if (e.type === "lightning" && e.player === view) tone("thunder");
      if ((e.type === "golem" || e.type === "golemPortal") && e.player === view) tone("golem");
      if (e.type === "skill" && e.kind === "enrage" && e.player === view) tone("growl"); // v0.21z: Meat Golem
      // v0.17q: a perk summons towers: first show the own field, the towers arrive 0.3 s later
      if (e.type === "summonStart" && e.player === own && view !== own) showMaze(own, true);
      if (e.type === "summon" && e.player === own) {
        tone("upgrade");
        note(t("Summoned: {name}", { name: itemName(catalog.byId[e.id]) }));
      }
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
      if (e.type === "interest" && e.player === own) hudPop("#own-gold", `+${resourceNumber(e.gold)}`); // v0.19a1: Magic Bank
      if (e.type === "pillage" && e.player === own) hudPop("#own-gold", `−${resourceNumber(e.gold)}`);
      if (e.type === "send" && e.player === own && e.auto) sendFx(e.id, e.count || 1, true);
      if (e.type === "kill" && e.player === own && view === own) tone("kill");
      if (e.type === "built" && e.player === own) tone("built");
      if (e.type === "income" && e.player === own) {
        tone("bell"); // v0.08c: a new round starts
        hudPop("#own-gold", `+${resourceNumber(e.gold)}`);
        if (e.exp > 0) hudPop("#own-level", `+${resourceNumber(e.exp)} EXP`, "exp");
      }
      if (e.type === "expGen" && e.player === own && e.exp > 0) hudPop("#own-level", `+${resourceNumber(e.exp)} EXP`, "exp"); // v0.19d2: EXP generators every 5 s
      if (e.type === "achievement" && e.player === own && e.exp) hudPop("#own-level", `+${e.exp} EXP`, "exp");
      // v0.19d2: every achievement of another player, minor ones too: "Name achieved Labyrinth +100 EXP"
      if (e.type === "achievement" && e.player !== own && e.exp) toast(t("{who} achieved {name} +{exp} EXP", { who: seatTag(e.player), name: t(e.name || e.achievement), exp: format(e.exp) }), "level");
      if (e.type === "achievement" && e.player === own && e.name) toast(t("Achievement: {name}", { name: t(e.name) }) + ` · +${e.exp} EXP`, "tier"); // v0.15
      if (e.type === "firstBlood") firstBlood(e);
      if (e.type === "towerSplat") {
        towerSplat(e); // v0.19j
        if (e.player !== own) toast(t("{who} achieved {name} +{exp} EXP", { who: seatTag(e.player), name: t(e.name), exp: format(e.exp) }), "level");
      }
      if (e.type === "rock" && e.player === own) {
        toast(e.cracked ? "A rock cracked!" : e.stone ? "Stone demolished" : "Rock cleared", "level", true); // v0.17
        if (e.exp > 0) hudPop("#own-level", `+${format(e.exp)} EXP`, "exp"); // v0.22m2: Quarry stones give EXP
      }
      // v0.18h: all Quarry stones gone: the Earth perk it brought
      if (e.type === "quarryPerk" && e.player === own) {
        if (e.id) {
          toast(t("Quarry cleared: {name}!", { name: t(PERKS[e.id]?.name || e.id) }), "level", true);
          sfx.play("evolve");
        } else toast("Quarry cleared: no Earth perk left to give", "level", true);
      }
      if (e.type === "upgrade" && e.evolution && e.player === own) sfx.play("evolve"); // v0.16
      // v0.20e: Scholar: which perks went up a level
      if (e.type === "scholar" && e.player === own && e.upgrades?.length)
        banner(t("Scholar") + ":", e.upgrades.map((u) => `${t(PERKS[u.id]?.name || u.id)} ${t("Lv")} ${u.level}`).join(" · "), "level");
      // v0.15: quests
      if (e.type === "quest" && e.player === own) questEvent(e);
      if (e.type === "questWave" && e.player === own) toast(t("{name}: wave {a} of {b}", { name: t(QUESTS[e.id].name), a: e.wave, b: e.of }), e.wave === e.of ? "boss" : "level");
      if (e.type === "levelUp" && e.player === own) {
        note(t(e.kind === "element" ? "Level {n}: a new element awaits" : "Level {n}: choose a reward", { n: e.level }), "level");
        tone("tier");
      }
      if (e.type === "rotate" && isFfa() && !game.players[own].out) {
        note(t("New target: {name}", { name: seatTag(rivalIndex()) }), "level");
        applyColors();
      }
      if (e.type === "eliminated") {
        // v0.09: an eliminated player's field leaves the rotation; whoever looks at it moves on
        if (view === e.player) {
          const next = game.players.find((q) => q.id === own && !q.out) || game.players.find((q) => !q.out);
          if (next) showMaze(next.id);
        }
        renderEnemyStack(true);
        if (isFfa()) defeatSplat(e.player); // v0.17q
        if (e.player === own) ownKnockedOut(e.place);
        else toast(t("{name} is out · place {n}", { name: seatTag(e.player), n: e.place }));
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
  // v0.13a: through the relay servers the state goes out less often (data volume)
  // v0.16: states, snapshots and presence are sent from netPulse
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
    const won = game.teams ? game.players[own].team === game.winnerTeam : game.winner === own, // v0.20: team games
      beatHardo = won && sessionMode === "training" && hardoGame(),
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
    const summary = matchSummary(me, isFfa() ? (won ? 1 : me.place || 2) : 0);
    if (sessionMode !== "online") presenceState("idle");
    showModal(
      `<div class="result-banner ${won ? "win" : "lose"}">${t(won ? "Victory" : "Defeat")}</div><img class="modal-hero result-hero" src="${artUrl(won ? "tower-archer" : "creep-golem")}" alt=""><h2 class="welcome-title">${won ? t("Your line.<br><span>Your victory.</span>") : t("Well fought.<br><span>Another round?</span>")}</h2>${summary.html}<p class="modal-copy" style="text-align:center">${t("Match time")} ${$("match-clock").textContent}${sessionMode === "training" ? ` · ${t("AI")} ${t(AI_NAMES[game.aiLevel] || "Normal")}` : ""}</p>${tip ? `<p class="modal-note result-tip">${tip}</p>` : ""}<div class="result-pair"><button class="secondary-button" id="play-again">${t("Play again")}</button>${sessionMode === "training" && game.aiLevel !== (hardoUnlocked ? "insane" : "hard") && won ? `<button class="secondary-button" id="play-harder">${t("Harder AI")}</button>` : ""}</div><button class="primary-button" id="to-menu">${t("Main menu")}</button>`,
      { pauseGame: false },
    );
    summary.wire();
    $("play-again").onclick = () => {
      shownResult = false;
      if (sessionMode === "online") return playAgainOnline(); // v0.19b1: PvP: the same kind of match again
      startLocal({ hotseat: sessionMode === "hotseat", ffa: sessionMode === "ffa", seats: game.players.length });
    };
    if (sessionMode === "campaign") campaignResult(won); // v0.17
    // v0.22e: beating Hardo once gives you his goblin as your player icon (until you pick another)
    if (beatHardo) {
      const first = !hardoIconEarned();
      savePref(HARDO_ICON_PREF, true);
      if (first || iconChoice !== "hardo") {
        iconChoice = "hardo";
        savePref(ICON_PREF, iconChoice);
        toast(t("You beat Hardo! His goblin is now your player icon."), "level", true);
      }
    }
    if ($("play-harder"))
      $("play-harder").onclick = () => {
        aiChoice = { veryEasy: "easy", easy: "normal", normal: "hard", hard: hardoUnlocked ? "insane" : "hard" }[game.aiLevel] || "hard";
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
const preloadedUrls = new Set();
function preloadImage(url, priority = "high") {
  if (preloadedUrls.has(url)) return Promise.resolve();
  preloadedUrls.add(url);
  const img = new Image();
  img.fetchPriority = priority;
  img.decoding = "async";
  img.src = url;
  preloadedArt.push(img);
  return (img.decode?.() || Promise.resolve()).catch(() => {});
}
function preloadDialogArt() {
  for (const k of [...Object.values(ELEMENT_ICON), "coin", "income", "heart", "crown", "attack", "hourglass", "gear", "build", "upgrade", "wood"])
    preloadImage(iconUrl(k));
  // v0.17: pictures of the result dialogs and portraits
  for (const url of ["assets/art/portrait-enemy.webp", "assets/art/portrait-player.webp", artUrl("creep-golem"), "assets/art/ui-logo.webp"]) preloadImage(url, "low");
}
preloadDialogArt();
/**
 * v0.17: the web fonts load at start-up, so a dialog's smaller texts (the note under the element
 * pick, tooltips, the match summary) never appear late or swap their font while you read them.
 */
function preloadFonts() {
  if (!document.fonts?.load) return;
  const faces = [
    ...["400", "500", "600", "700"].map((w) => `${w} 14px "DM Sans"`),
    ...["600", "700", "800"].map((w) => `${w} 14px "Barlow Condensed"`),
    `400 14px "Lilita One"`,
  ];
  for (const f of faces) document.fonts.load(f).catch(() => {});
}
preloadFonts();
/**
 * v0.10y1: all card and dialog art (towers, creeps, upgrades, rewards) is fetched and decoded in
 * the background after start-up, a few at a time, and tower art is recoloured to the player's
 * colour ahead of time – so opening a tower's upgrade buttons or a dialog shows it at once.
 */
let artWarmColor = null;
function warmDialogArt() {
  if (artWarmColor === colorChoice) return;
  artWarmColor = colorChoice;
  const color = colorChoice,
    keys = Object.keys(ART_MANIFEST).filter((k) => /^(tower|creep)-/.test(k));
  let next = 0;
  const step = () => {
    if (color !== colorChoice) return;
    const batch = keys.slice(next, next + 4);
    next += 4;
    if (!batch.length) return;
    Promise.all(
      batch.map((k) =>
        preloadImage(artUrl(k), "low").then(() => {
          if (k.startsWith("tower-") || k.startsWith("creep-")) towerArtUrl(k, true);
        }),
      ),
    ).then(() => (window.requestIdleCallback ? requestIdleCallback(step, { timeout: 400 }) : setTimeout(step, 30)));
  };
  setTimeout(step, 800);
}
async function init() {
  try {
    catalog = await loadContent();
    registerTowerArt(catalog.towers);
    warmDialogArt();
    game = createGame({ seed: 42, faction: chosenFaction, mode: chosenMode });
    game.paused = true;
    arena = mountArena({
      container: $("arena"),
      getState: () => game,
      getCatalog: () => catalog,
      getViewPlayer: () => view,
      getMode: () => tab,
      getSelection: () =>
        selectedTower && (tab === "build" || view !== own) // v0.17h: an enemy tower stays marked in Send too
          ? { towerId: selectedTower, player: view }
          : tab !== "build"
            ? null
            : selected
              ? { id: selected, player: own }
              : null,
      getOwnPlayer: () => own,
      getColors: seatColors,
      getPipPlayer: () => (view === own ? rivalIndex() : own),
      // v0.18c: Minimap option; with "All" every other field still in the match (yours too while you watch another)
      getMinimapMode: () => minimapMode,
      getMiniPlayers: () => game.players.filter((q) => q.id !== view && !q.out).map((q) => q.id),
      // v0.21d: team games: your allies (you too while you watch an ally's field)
      getAllyPlayers: () => (game?.teams ? game.players.filter((q) => !q.out && q.team === game.players[own]?.team && q.id !== view).map((q) => q.id) : []),
      getPreview: currentPreview,
      getQueued: () => (queuedFor === gameKey() ? queued : []),
      getUpQueued: () => (queuedFor === gameKey() ? upQueue : []),
      onPip: (player) => {
        // v0.18c: a tap on one of the "All" mini maps shows that field
        if (typeof player === "number") {
          showMaze(player, tab === "send");
          tone("tap");
          return;
        }
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
      onCellRight: (pos) => cancelQueuedAt(pos), // v0.18a: right click on a pre-build cancels it
      onTower: onTowerTap,
      onTowerRight: onTowerRightClick,
      popups: { numbers: popNumbers, notes: popNotes },
      onSwipe: swipeView,
      peekLane: (step) => laneInfo(laneAt(step)),
      getAim: () =>
        volleyAim && view === own
          ? aimKind === "burst"
            ? { radius: burstRadius(game.players[own].perks?.burst || 1), arcane: true }
            : aimKind === "pillar"
              ? { radius: PILLAR.radius, fire: true }
              : { radius: VOLLEY.radius }
          : null,
      onHover: (cell) => {
        hoverCell = cell && tab === "build" && selected && view === own ? cell : null;
      },
      onTick: tick,
    });
    // v0.15: a double tap on Send opens the send cards but keeps your own field in view; the
    // first tap waits a moment before it rolls over to the target's field.
    let sendTapAt = 0,
      sendRollTimer = 0;
    document.querySelectorAll("[data-tab]").forEach(
      (b) =>
        (b.onclick = () => {
          if (b.dataset.tab !== "send") {
            clearTimeout(sendRollTimer);
            return setPage(b.dataset.tab);
          }
          // v0.17: one tap switches to the target's field at once (no roll); a second tap
          // right after brings your own field back while the send cards stay open
          const now = performance.now(),
            double = now - sendTapAt < 380;
          sendTapAt = double ? 0 : now;
          clearTimeout(sendRollTimer);
          if (double) {
            setPage("send", { stayOwn: true, scroll: false });
            toast("Send cards, your own field in view.");
            return;
          }
          setPage("send", { scroll: tab !== "send" });
        }),
    );
    // v0.15: PC version — arrow keys switch fields, B / S switch Build and Send, Esc drops a blueprint
    document.addEventListener("keydown", (e) => {
      if (controlMode !== "pc" || !game || !begun || $("modal").open) return;
      if (e.target.closest?.("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (k === "arrowleft" || k === "arrowright") {
        const id = laneAt(k === "arrowright" ? 1 : -1);
        if (id !== null) arena.roll(k === "arrowright" ? 1 : -1, laneInfo(id), () => swipeView(k === "arrowright" ? 1 : -1));
        e.preventDefault();
      } else if (k === "b") document.querySelector('[data-tab="build"]')?.click();
      else if (k === "s") document.querySelector('[data-tab="send"]')?.click();
      else if (k === "escape" && tab === "build" && selected) {
        selected = null;
        pending = null;
        hoverCell = null;
        renderCards();
        refreshUI();
      }
    });
    // v0.15: PC version — the mouse wheel over the board rolls to the neighbouring field
    let wheelAt = 0;
    $("arena").addEventListener(
      "wheel",
      (e) => {
        if (controlMode !== "pc" || !game || !begun) return;
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (Math.abs(d) < 8) return;
        e.preventDefault();
        if (performance.now() - wheelAt < 450) return;
        wheelAt = performance.now();
        const step = d > 0 ? 1 : -1,
          id = laneAt(step);
        if (id !== null) arena.roll(step, laneInfo(id), () => swipeView(step));
      },
      { passive: false },
    );
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
    // v0.19k: on touch, holding the slot shows its tooltip (Eco / Tier Up explained) until the finger lifts
    let slotTipTimer = 0;
    $("auto-slot").addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      clearTimeout(slotTipTimer);
      slotTipTimer = setTimeout(() => showHelp($("auto-slot")), 420);
    });
    for (const ev of ["pointerup", "pointercancel", "pointerleave"])
      $("auto-slot").addEventListener(ev, (e) => {
        if (e.pointerType !== "touch") return;
        clearTimeout(slotTipTimer);
        if (helpFor === $("auto-slot") && !helpMode) setTimeout(hideHelp, 900);
      });
    $("auto-slot").onclick = (e) => {
      // keyboard activation; pointer taps are handled on release
      if (performance.now() < suppressClickUntil || e.detail) return; // v0.22m2: a pointer click never toggles a second time
      const p = game.players[own];
      if (p.autoSend || (p.autoMode && p.autoMode !== "default")) dispatch({ type: "autoSend", active: p.autoSendActive === false });
      else nextAutoMode(); // v0.22m2: the empty slot switches the mode
    };
    $("level-button").onclick = () => pickModal();
    // v0.18h: in AI matches a tap on the round timer pauses the game without a menu ("II"), a second tap resumes
    document.querySelector(".round-plate")?.addEventListener("click", (e) => {
      if (!game || room || !begun || !game.running || sessionMode === "online") return;
      e.stopPropagation();
      setUiPause("manual", !uiPauses.has("manual"));
      sfx.play("tap");
      refreshUI();
    });
    $("volley-button").innerHTML = `<img src="${PERK_ART.volley()}" alt=""><i class="volley-cd" aria-hidden="true"></i><b id="volley-time"></b>`;
    $("volley-button").onclick = volleyPress;
    $("burst-button").innerHTML = `<img src="${svgUrl("burst")}" alt=""><i class="volley-cd" aria-hidden="true"></i><b id="burst-time"></b>`;
    $("burst-button").onclick = burstPress;
    ensureAbilityButtons(); // v0.12
    for (const id of ABILITY_IDS) bindAbilityButton(id); // v0.17k
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
    document.querySelector(".player-plate.own").onclick = (e) => {
      // v0.21d: the allies' window inside your plate: a portrait opens that maze, the rest the first ally's
      const seat = e.target.closest?.("#ally-stack [data-seat]");
      if (seat) {
        if (!game.players[Number(seat.dataset.seat)]?.out) showMaze(Number(seat.dataset.seat));
        return;
      }
      if (e.target.closest?.("#ally-stack")) {
        const q = game.players.find((x) => game.teams && x.team === game.players[own]?.team && x.id !== own && !x.out);
        if (q) return showMaze(q.id);
      }
      showMaze(own);
    };
    document.querySelector(".player-plate.rival").onclick = (e) => {
      const cell = e.target.closest?.("[data-seat]");
      if (cell) {
        const seat = Number(cell.dataset.seat);
        if (!game.players[seat]?.out) showMaze(seat);
        return;
      }
      // v0.20c: a team window outside the portraits: the first member still in the game
      const team = e.target.closest?.(".team-cell");
      if (team) {
        const q = game.players.find((x) => x.team === Number(team.dataset.team) && x.id !== own && !x.out);
        if (q) showMaze(q.id);
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
          hardoTalk: () => hardoTalk(),
          hardoSay: (text) => hardoSay(text),
          showTower: (id) => showTower(id), // v0.22o2: test hook
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
          get queued() {
            return queued;
          },
          get colors() {
            return { pick: colorPick, choice: colorChoice };
          },
          assignColors, // v0.18a
          showLobby,
          get qm() {
            return qmSearch && { status: qmSearch.status, minimized: qmSearch.minimized };
          },
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
