/** Deterministic, renderer-independent 1v1 simulation. Time is in seconds. */
import { getCatalog, getResearchCost, FACTIONS, RULES, field, splitIds, cleanText } from "./content.js";

export const TICK = 0.05;
export const SAVE_VERSION = 5;
export const ARENA_MOVEMENT_MULTIPLIER = 0.45;
export const GAME_GRIDS = Object.freeze({
  arena: Object.freeze({ cols: 6, rows: 9, cellUnits: 128 }),
  source: Object.freeze({ cols: 7, rows: 21, cellUnits: 128 }),
});
/** The added right-hand column must not move the original entrance/exit lane. */
export function getEntranceColumn(game) {
  return Math.floor((game.grid.cols - 1) / 2);
}
// ---- Board edges (v0.06) ---------------------------------------------------------------
// Every field is buildable. Above the first row runs a quarter-field spawn strip (row -1, the
// portal fields) and below the last row a quarter-field exit strip (row `rows`). Creeps appear
// above a random column, may walk sideways along the spawn strip, and break through the moment
// they touch the exit strip.
export const STRIP = 0.25; // strip height in fields
export function spawnColumn(game) {
  return Math.floor(random(game) * game.grid.cols);
}
const movementMultiplier = (game) => (game.mode === "arena" ? ARENA_MOVEMENT_MULTIPLIER : 1);
/** Shared by local restore and the network snapshot gate; never remaps old cells. */
export function isCompatibleGameGrid(game) {
  if (typeof game?.mode !== "string" || !Object.hasOwn(GAME_GRIDS, game.mode)) return false;
  const expected = GAME_GRIDS[game?.mode];
  return (
    !!expected &&
    game.version === SAVE_VERSION &&
    ["cols", "rows", "cellUnits"].every((key) => game.grid?.[key] === expected[key]) &&
    game.gridSize?.cols === expected.cols &&
    game.gridSize?.rows === expected.rows
  );
}
const EPS = 1e-8,
  VERSION = SAVE_VERSION;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const obj = (id) => getCatalog().byId[id];
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const fval = (ability, key, level = 1, fallback = 0) => num(field(ability?.fields, key, level), fallback);
const SUPPORTED_BASES = new Set(["AOae", "AHad", "AEar", "Aspo", "ACct", "Aslo"]);
const SOURCE_REFS = {
  income: "war3map.j:6966-7040",
  decimal: "war3map.j:7258-7316",
  send: "war3map.j:12189-12230",
  touchdown: "war3map.j:21362-21503",
  sell: "war3map.j:9719-10125",
  research: "war3map.j:11645-11653",
};

function emit(game, type, data = {}) {
  const seq = ++game.eventId;
  const event = { id: seq, tick: game.tick, time: game.time, type, ...data, seq };
  game.events.push(event);
  if (game.events.length > 160) game.events.splice(0, game.events.length - 160);
  return event;
}
export function random(game) {
  let t = (game.rng += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  game.rng >>>= 0;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function diceRoll(game, base, dice, sides) {
  let value = base;
  for (let i = 0; i < Math.max(0, dice); i++) value += 1 + Math.floor(random(game) * Math.max(1, sides));
  return value;
}
const pos = (game, x, y) => {
  const rows = game.grid.rows,
    cy = y < 0 ? -STRIP / 2 : y >= rows ? rows + STRIP * 0.2 : y + 0.5;
  return { x: (x + 0.5) / game.grid.cols, y: cy / rows, gridX: x, gridY: y };
};
const square = (game, x, y) => (y + 1) * game.grid.cols + x;
const dist = (game, a, b) =>
  Math.hypot((a.x - b.x) * game.grid.cols, (a.y - b.y) * game.grid.rows) * game.grid.cellUnits;
const gridAt = (game, p) => ({
  x: clamp(Math.floor(p.x * game.grid.cols), 0, game.grid.cols - 1),
  y: p.y < 0 ? -1 : Math.min(game.grid.rows, Math.floor(p.y * game.grid.rows)),
});
/** Element halls stand on 2×2 fields; every other tower on one. */
export function footprintOf(id) {
  return obj(id)?.isHall ? 2 : 1;
}
export function towerSize(t) {
  return t.size || footprintOf(t.typeId);
}
export function towerCells(t) {
  const n = towerSize(t),
    out = [];
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) out.push({ x: t.gridX + dx, y: t.gridY + dy });
  return out;
}
export function towerAt(player, x, y) {
  return player?.towers.find((t) => {
    const n = towerSize(t);
    return x >= t.gridX && x < t.gridX + n && y >= t.gridY && y < t.gridY + n;
  });
}
function footprintCells(gridX, gridY, size) {
  const out = [];
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) out.push({ x: gridX + dx, y: gridY + dy });
  return out;
}
function blocked(game, player, extra = null) {
  const s = new Set();
  for (const t of player.towers) for (const c of towerCells(t)) s.add(square(game, c.x, c.y));
  for (const e of Array.isArray(extra) ? extra : extra ? [extra] : []) s.add(square(game, e.x, e.y));
  return s;
}

/**
 * Breadth-first path from the spawn strip (or `start`) to the exit strip; deterministic tie
 * order; never permits a closed maze. Without `start` it searches from every spawn field and
 * returns the shortest route, which is what the maze length and the route display use.
 */
export function findPath(game, playerIndex = 0, start = null, extra = null) {
  const player = game.players[playerIndex],
    { cols, rows } = game.grid;
  const walls = blocked(game, player, extra),
    keyOf = (x, y) => square(game, x, y),
    starts = start ? [{ x: start.x, y: start.y }] : Array.from({ length: cols }, (_, x) => ({ x, y: -1 }));
  const queue = [],
    previous = new Map();
  for (const a of starts) {
    if (a.y >= rows) return [pos(game, a.x, rows)];
    const k = keyOf(a.x, a.y);
    if (walls.has(k) || previous.has(k)) continue;
    previous.set(k, -1);
    queue.push(k);
  }
  let endKey = null;
  for (let i = 0; i < queue.length && endKey === null; i++) {
    const key = queue[i],
      x = key % cols,
      y = Math.floor(key / cols) - 1;
    for (const [dx, dy] of [
      [0, 1],
      [-1, 0],
      [1, 0],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || nx >= cols || ny < -1 || ny > rows) continue;
      // The exit strip is touched from the last row only; the spawn strip runs sideways.
      if (ny === rows && dy !== 1) continue;
      const k = keyOf(nx, ny);
      if (walls.has(k) || previous.has(k)) continue;
      previous.set(k, key);
      if (ny === rows) {
        endKey = k;
        break;
      }
      queue.push(k);
    }
  }
  if (endKey === null) return null;
  const path = [];
  let k = endKey;
  while (k !== -1) {
    path.push(pos(game, k % cols, Math.floor(k / cols) - 1));
    k = previous.get(k);
  }
  return path.reverse();
}
export function getPath(game, playerIndex = 0) {
  return game.players[playerIndex].path;
}
/** Steps to the exit from every node (spawn strip included); -1 = no way out. */
function exitDistances(game, player, extra = null) {
  const { cols, rows } = game.grid,
    walls = blocked(game, player, extra),
    d = new Int16Array((rows + 1) * cols).fill(-1),
    queue = [];
  for (let x = 0; x < cols; x++) {
    const k = square(game, x, rows - 1);
    if (!walls.has(k)) {
      d[k] = 1;
      queue.push(k);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i],
      x = k % cols,
      y = Math.floor(k / cols) - 1;
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || nx >= cols || ny < -1 || ny > rows - 1) continue;
      const nk = square(game, nx, ny);
      if (walls.has(nk) || d[nk] >= 0) continue;
      d[nk] = d[k] + 1;
      queue.push(nk);
    }
  }
  return d;
}
/** The route node a ground creep last passed (kept across re-routes). */
const behindOf = (c) => (c.pathIndex > 0 ? c.path[c.pathIndex - 1] : c.prevNode) || null;
function repath(game, player) {
  player.path = findPath(game, player.id) || [];
  for (const creep of player.creeps) {
    if (creep.flying) continue;
    creep.prevNode = behindOf(creep);
    creep.path = creepPathFrom(game, player.id, creep);
    creep.pathIndex = 0;
  }
}
/**
 * New route for a ground creep after the maze changed. The creep keeps walking toward the node it was
 * already heading to (no snap back to the centre of its current cell, which stalled/pushed back creeps
 * whenever a tower was built or sold). Only when that node was just blocked does it re-route from its cell,
 * and then it skips that cell's centre if it has already passed it.
 */
function creepPathFrom(game, playerId, creep) {
  const heading = creep.path?.[creep.pathIndex];
  if (heading && Number.isInteger(heading.gridX)) {
    const tail = findPath(game, playerId, { x: heading.gridX, y: heading.gridY });
    if (tail && tail.length) return tail;
  }
  const path = findPath(game, playerId, gridAt(game, creep)) || [];
  if (path.length > 1) {
    const { cols, rows } = game.grid,
      a = path[0],
      b = path[1],
      cx = (creep.x - a.x) * cols,
      cy = (creep.y - a.y) * rows,
      dx = (b.x - a.x) * cols,
      dy = (b.y - a.y) * rows;
    if (cx * dx + cy * dy > 0 && Math.abs(cx * dy - cy * dx) < 0.15) path.shift();
  }
  return path;
}
function initialPlayer(id, faction, ai, seats = 2) {
  return {
    id,
    name: id === 0 ? "You" : ai ? (seats > 2 ? "AI " + id : "Felito AI") : "Player " + (id + 1),
    ai,
    faction: null, // first element, chosen in the opening pick
    gold: RULES.initialGold,
    exp: 0,
    level: 1,
    expNext: expNeeded(1),
    picks: [],
    income: RULES.initialIncome,
    incomeDecimal: 0,
    woodIncome: 0, // EXP per income tick from EXP generators
    lives: RULES.initialLives,
    tier: 1,
    research: { Rhpm: 1, R009: 1 },
    researchQueue: [],
    towers: [],
    creeps: [],
    stock: {},
    path: [],
    stats: { sent: 0, kills: 0, leaks: 0, goldEarned: 0, expEarned: 0, built: 0 },
    treantCount: 0,
    ghoulCount: 0,
    nextAiTick: 0,
    autoSend: null,
    infernalBossCount: 0,
    bossBought: {},
    paybackRemaining: 0, // v0.09k: no bonus any more; kept for saves
    elementsPurchased: 0,
    freeArchers: 1, // v0.08c: the first archer is free
  };
}

export function createGame({
  seed = 1,
  mode = "arena",
  faction = "water",
  factions,
  ai = true,
  aiLevel = "normal",
  waves = false,
  lives = RULES.initialLives,
  incomeInterval = RULES.incomeInterval,
  seats = 2,
} = {}) {
  getCatalog();
  // v0.10c/f: 2 to 8 seats (you plus up to 7 AIs)
  seats = Math.min(8, Math.max(2, Math.round(Number(seats)) || 2));
  for (const u of getCatalog().allUnits) {
    u.implementedAbilities = u.abilities.filter((id) => {
      const a = getCatalog().abilities[id];
      return a && (SUPPORTED_BASES.has(a.baseId) || COVERED_BASES.has(a.baseId) || VISUAL_ONLY(a));
    });
    u.unimplementedAbilities = u.abilities.filter((id) => !u.implementedAbilities.includes(id));
  }
  const normalizedMode = mode === "source" ? "source" : "arena";
  const game = {
    version: VERSION,
    seed: Number(seed) >>> 0,
    rng: Number(seed) >>> 0,
    mode: normalizedMode,
    aiLevel: Object.hasOwn(AI_LEVELS, aiLevel) ? aiLevel : "normal",
    waves: !!waves,
    wave: 0,
    waveQueue: [],
    clouds: [],
    tick: 0,
    time: 0,
    accumulator: 0,
    eventId: 0,
    nextId: 1,
    running: true,
    paused: false,
    winner: null,
    round: 0,
    incomeCounter: 1,
    incomeRemaining: RULES.warmup,
    incomeInterval,
    warmup: true,
    firstBlood: false,
    suddenDeath: false,
    events: [],
    effects: [],
    commands: [],
    pendingSpawns: [],
    achievements: { tiers: [], halls: 0, hallNextTime: 0 },
    grid: { ...GAME_GRIDS[normalizedMode] },
    rules: { ...RULES },
    seats,
    players: Array.from({ length: seats }, (_, i) => initialPlayer(i, factions?.[i] || (i ? "fire" : faction), i > 0 && ai, seats)),
    adaptation: {
      geometry: "Mobile grid; not the exact Warcraft path area",
      ai: "Deterministic mobile AI of its own; no Zeus script interpreter",
      mode:
        normalizedMode === "source"
          ? "Original values on 7×21 fields"
          : "Mobile 6×9 arena; 128 world units per cell",
      movement:
        normalizedMode === "source"
          ? "Originalgeschwindigkeiten"
          : "45 % of the original speed incl. spread, research, auras and movement limits; attack cooldowns and income unchanged",
      recirculation: "Surviving creeps run on through the next lane.",
    },
    sources: SOURCE_REFS,
  };
  game.gridSize = { cols: game.grid.cols, rows: game.grid.rows };
  for (const p of game.players) {
    p.lives = lives;
    p.picks.push(makePick(game, p, "element"));
    p.path = findPath(game, p.id);
    for (const s of getCatalog().sends) p.stock[s.id] = { count: s.stockStart > 0 ? 0 : s.stockMax, next: s.stockStart };
    stockTier(game, p, 1, 0);
  }
  emit(game, "start", { message: "Defend your lane. Send creeps, raise your income." });
  return game;
}

function meetRequirements(player, requirements) {
  for (const req of requirements) {
    const count =
      player.research[req.id] || player.towers.filter((t) => t.typeId === req.id && t.buildRemaining <= 0).length;
    if (count < req.level)
      return { ok: false, reason: `Needs ${obj(req.id)?.shortName || obj(req.id)?.name || req.id} ${req.level}` };
  }
  return { ok: true };
}
export function getPurchaseCost(game, playerIndex, id) {
  const p = game.players[playerIndex],
    item = obj(id);
  if (!p || !item) return null;
  if (item.kind !== "research") return { gold: bossDiscount(p, item, item.cost), wood: item.woodCost, time: item.buildTime };
  return getResearchCost(id, FACTIONS.some((f) => f.research === id) ? p.elementsPurchased : p.research[id] || 0);
}
/** Element upgrades locked until that element is owned (war3map.j SETUP + ELEMENT dialog). */
const ELEMENT_UPGRADES = {
  R002: { unlock: "R01D", name: "Water" },
  R000: { unlock: "R01G", name: "Fire" },
  R005: { unlock: "R01I", name: "Earth" },
  R006: { unlock: "R01H", name: "Arcane" },
  R00K: { unlock: "R01E", name: "Storm" },
  R00C: { unlock: "R01F", name: "Plague" },
};
const UNIQUE_TOWERS = new Set(["h010", "h03W", "h00G", "h046", "h00I", "h00J", "h020", "h01Z", "h043", "h022"]);
export function available(game, playerIndex, type, id, towerId = null, viaPick = false) {
  const p = game.players[playerIndex];
  if (!p) return { ok: false, reason: "Invalid player" };
  if (!game.running) return { ok: false, reason: "The duel is over." };
  const item = obj(id);
  if (!item) return { ok: false, reason: "Unknown original ID" };
  if (!item.playable)
    return { ok: false, reason: item.unavailableReason || "This research can't be bought directly." };
  let cost = { gold: item.cost, wood: 0 },
    requirements = item.requires || [];
  if (type === "research") {
    if (item.kind !== "research" || !item.playerResearch) return { ok: false, reason: "Internal research" };
    if (!viaPick) return { ok: false, reason: "Upgrades come with level-ups" };
    const level = p.research[id] || 0;
    if (level >= Math.min(item.maxLevel, 11)) return { ok: false, reason: "Maximum level reached" };
    if (p.researchQueue.some((q) => q.id === id)) return { ok: false, reason: "Research already running" };
    const element = FACTIONS.find((f) => f.research === id);
    if (element && p.research[element.unlock]) return { ok: false, reason: "Element already discovered" };
    cost = { gold: 0, wood: 0 };
    // Explicit empty requirements at later levels must not fall back to a
    // different level's sentinel such as Rhfc (the source's level-11 lock).
    const reqIds = item.fields.greq?.[level + 1] ?? "",
      reqLevels = item.fields.grqc?.[level + 1] ?? "";
    requirements = splitIds(reqIds).map((id, i) => ({ id, level: num(splitIds(reqLevels)[i], 1) }));
    if (id === "R013" && !p.towers.some((t) => t.typeId === "h01F" && t.completed))
      return { ok: false, reason: "Needs an EXP Generator" };
    if (id === "R00J" && !p.research.R01G)
      return { ok: false, reason: "Needs the fire element" };
    // Each element unlocks its own upgrade (SETUP locks them, the element pick frees them).
    const elementUpgrade = ELEMENT_UPGRADES[id];
    if (elementUpgrade && !p.research[elementUpgrade.unlock])
      return { ok: false, reason: `Needs the ${elementUpgrade.name} element` };
  } else if (type === "send") {
    if (!item.isSend) return { ok: false, reason: "Not a send card" };
    if (item.tier > p.tier) return { ok: false, reason: `Send the tier ${item.tier - 1} boss` };
    if (item.tier < p.tier) return { ok: false, reason: "Replaced by the next tier" };
    if (item.inactiveInSource) return { ok: false, reason: "Disabled in the source map (tier 6 off)" };
    if (item.bossTier && (p.bossBought?.[id] || p.tier >= item.bossTier)) return { ok: false, reason: "Boss already bought" };
    if (game.warmup) return { ok: false, reason: `Setup · ${Math.ceil(game.incomeRemaining)} s` };
    if ((p.stock[id]?.count ?? 0) < 1) return { ok: false, reason: "Restocking" };
    cost = { gold: bossDiscount(p, item, item.cost), wood: 0 };
  } else if (type === "build") {
    if (!item.isBuildable) return { ok: false, reason: "Not a building" };
    if (!item.isRoot) return { ok: false, reason: "Upgrade from the previous tower" };
    if (item.support === "farm") return { ok: false, reason: "Farm not available for now" };
    if (id === "h003" && (p.freeArchers || 0) > 0) cost = { gold: 0, wood: 0 }; // Forest Patrol
  } else if (type === "upgrade") {
    const tower = p.towers.find((t) => t.id === towerId);
    if (!tower) return { ok: false, reason: "Tower not found" };
    if (tower.buildRemaining > EPS) return { ok: false, reason: "Still under construction" };
    if (!obj(tower.typeId).upgrades.includes(id)) return { ok: false, reason: "Not a valid upgrade" };
    // Ultimate elementals are limited to one per player (SETUP: SetPlayerTechMaxAllowed 1).
    if (UNIQUE_TOWERS.has(id) && p.towers.some((t) => t.typeId === id))
      return { ok: false, reason: "Only once per player" };
  }
  const req = meetRequirements(p, requirements);
  if (!req.ok) return req;
  if (p.gold + EPS < cost.gold) return { ok: false, reason: `Need ${Math.ceil(cost.gold - p.gold)} more gold`, cost };
  return { ok: true, cost };
}
export const getAvailability = available;
export const canUse = available;

export function canBuild(game, playerIndex, gridX, gridY, id = null) {
  const p = game.players[playerIndex],
    { cols, rows } = game.grid,
    size = id ? footprintOf(id) : 1;
  if (
    !p ||
    !Number.isInteger(gridX) ||
    !Number.isInteger(gridY) ||
    gridX < 0 ||
    gridX + size - 1 >= cols ||
    gridY < 0 ||
    gridY + size - 1 > rows - 1
  )
    return { ok: false, reason: size > 1 ? "The hall needs 2×2 free fields" : "Outside the board" };
  const cells = footprintCells(gridX, gridY, size);
  if (cells.some((c) => towerAt(p, c.x, c.y))) return { ok: false, reason: "This field is taken" };
  if (
    p.creeps.some((c) => {
      const a = gridAt(game, c);
      return !c.flying && cells.some((cell) => cell.x === a.x && cell.y === a.y);
    })
  )
    return { ok: false, reason: "A creep is standing here" };
  const extra = cells;
  if (!findPath(game, playerIndex, null, extra)) return { ok: false, reason: "A path to the exit must stay open" };
  const d = exitDistances(game, p, extra),
    onCells = (n) => cells.some((cell) => cell.x === n.gridX && cell.y === n.gridY);
  for (const c of p.creeps) {
    if (c.flying) continue;
    const g = gridAt(game, c);
    if (g.y < rows && d[square(game, g.x, g.y)] < 0) return { ok: false, reason: "A creep would be trapped" };
    // No juggling (v0.07n): a tower may lengthen the way ahead of a walking creep, but never
    // make it turn back — not on the field it walks into, not by turning its way around.
    const a = behindOf(c),
      b = c.path?.[c.pathIndex];
    if (!a || !b || !Number.isInteger(a.gridX) || !Number.isInteger(b.gridX) || a.gridY >= rows || b.gridY >= rows) continue;
    if (a.gridX === b.gridX && a.gridY === b.gridY) continue;
    if (onCells(b)) return { ok: false, reason: "No juggling: a creep would have to turn back" };
    const da = d[square(game, a.gridX, a.gridY)],
      db = d[square(game, b.gridX, b.gridY)];
    if (da >= 0 && db >= 0 && da < db) return { ok: false, reason: "No juggling: a creep would have to turn back" };
  }
  return { ok: true };
}

/** Read-only placement query for the build preview: validity plus the resulting maze. */
export function previewBuild(game, playerIndex, gridX, gridY, id = null) {
  const p = game.players[playerIndex],
    current = Math.max(0, (p?.path?.length || 1) - 1);
  const check = canBuild(game, playerIndex, gridX, gridY, id);
  if (!check.ok) return { ...check, gridX, gridY, path: null, length: current, delta: 0 };
  const path = findPath(game, playerIndex, null, footprintCells(gridX, gridY, id ? footprintOf(id) : 1)) || [];
  const length = Math.max(0, path.length - 1);
  return { ok: true, gridX, gridY, path, length, delta: length - current };
}

function statsFor(game, player, item) {
  // Explicit map ranges remain authoritative: Footman 150, Archer 600, etc.
  // The adapter's inherited weapon='normal' fallback is not a melee classifier.
  const stats = {
    hp: item.hp,
    damage: item.damage,
    damageBonus: 0,
    damageMultiplier: 1,
    cooldown: item.cooldown,
    range: item.range,
    armor: item.armor,
    speed: item.speed,
    regen: item.regen,
    mana: item.mana,
  };
  let attackSpeed = 0,
    hpPercent = 0,
    damagePercent = 0;
  for (const id of item.researchAffected) {
    const r = obj(id),
      level = player.research[id] || 0;
    if (!r || !level) continue;
    for (const effect of r.effects || []) {
      const amount = effect.base + (level - 1) * effect.increment;
      switch (effect.type) {
        case "ratx":
          stats.damageBonus += amount;
          break;
        case "ratt":
          damagePercent += amount;
          break;
        case "rats":
          attackSpeed += amount;
          break;
        case "rarm":
          stats.armor += item.armorUpgrade * level;
          break;
        case "rhpo":
          hpPercent += amount;
          break;
        case "rhpx":
          stats.hp += amount;
          break;
        case "rhpr":
          stats.regen += amount;
          break;
        case "ratr":
          stats.range += amount;
          break;
        case "rmov":
          stats.speed *= 1 + amount;
          break;
        case "rman":
          stats.mana += item.mana * amount;
          break;
      }
    }
  }
  stats.hp *= 1 + hpPercent;
  if (item.isSend && item.bossTier && perkLevel(player, "golem")) stats.hp *= 1 + GOLEM.hp; // v0.10n
  stats.damageMultiplier *= 1 + damagePercent;
  if (perkLevel(player, "archery") && archerLine().has(item.id)) stats.damageMultiplier *= 1 + 0.05 * perkLevel(player, "archery");
  stats.damage = (stats.damage + stats.damageBonus) * stats.damageMultiplier;
  stats.cooldown /= Math.max(0.1, 1 + attackSpeed);
  stats.speed *= movementMultiplier(game);
  if (item.isBuildable && item.attacks) stats.range = rangedReach(game, stats.range);
  return stats;
}
const INCOME_EXCLUDED = new Set(["n00Y", "n01H", "n01D", "n01R", "n01T", "n02P", "n02Q", "n02R"]);
/** Income one purchase of a creep adds: whole part and hundredths (research R006, Feudality). */
function sendIncomeParts(p, item) {
  const base = INCOME_EXCLUDED.has(item.id) ? 0 : item.pointValue;
  let decimal = item.incomeHundredths || 0;
  const interest = (p.research.R006 || 0) * 250;
  if (item.decimalEligible && interest > 0) decimal += Math.trunc((item.pointValue * interest) / 100);
  if (!item.decimalEligible) decimal = 0;
  // Feudality: +1.5 % per level of the income this creep brings, in hundredths
  const feudal = perkLevel(p, "feudal");
  if (feudal) decimal += Math.round((base * 100 + (item.incomeHundredths || 0)) * 0.015 * feudal);
  return { base, decimal };
}
/** v0.08d: the income a purchase really adds for this player, buffs included (for the cards). */
export function sendIncome(game, playerIndex, id) {
  const item = obj(id);
  if (!item) return 0;
  const { base, decimal } = sendIncomeParts(game.players[playerIndex], item);
  return Math.round(base * 100 + decimal) / 100;
}
export function getStats(game, playerIndex, id) {
  return statsFor(game, game.players[playerIndex], obj(id));
}
function newTower(game, p, id, gx, gy) {
  const item = obj(id),
    s = statsFor(game, p, item),
    size = footprintOf(id),
    at = pos(game, gx, gy);
  if (size > 1) {
    at.x = (gx + size / 2) / game.grid.cols;
    at.y = (gy + size / 2) / game.grid.rows;
  }
  return {
    id: "t" + game.nextId++,
    typeId: id,
    owner: p.id,
    name: item.shortName,
    ...at,
    size,
    hp: s.hp,
    maxHp: s.hp,
    mana: isMagicTower(item) ? 0 : s.mana,
    buildRemaining: item.buildTime,
    buildTotal: item.buildTime,
    cooldown: 0,
    spellCooldowns: {},
    kills: 0,
    totalSpent: item.cost,
    woodSpent: item.woodCost,
    completed: false,
  };
}
// ---- Level perks (v0.08b): extra rewards with five levels each; every level-up dialog may
// offer them, and the dialogs up to level 3 always hold at least one ----------------------
export const PERKS = Object.freeze({
  // v0.09q: perk rework (availability in PERK_AVAILABILITY)
  recruit: { name: "Recruitment", max: 5, text: "+1 max stock and 8% faster recruitment for the first 3 creeps of each tier" },
  feudal: { name: "Feudality", max: 5, text: "+1.5% income for creeps" },
  archery: { name: "Archery", max: 5, text: "+5% damage for all archer-line towers" },
  patrol: { name: "Forest Patrol", max: 5, text: "Next 2 archers are free" },
  militia: { name: "Militia", max: 5, text: "2 instant footmen on random fields" },
  evolution: { name: "Evolution", max: 5, text: "Instantly upgrades a random level 2 tower to level 3" },
  gold: { name: "Gold", max: 5, text: "Instantly +{gold} gold" },
  novice: { name: "Novice", max: 5, text: "Gain experience 20% faster" },
  volley: { name: "Arrow Volley", max: 5, text: "Active ability: arrows rain on an area (20 s cooldown)" },
  permafrost: { name: "Permafrost", max: 5, element: "water", text: "Ground creeps in your field are 4% slower per level" }, // v0.10o
  golem: { name: "Golem Whisperer", max: 1, element: "earth", text: "Boss creeps cost 25% less and have +10% hit points" }, // v0.10n
  crowd: { name: "Crowd Control", max: 3, text: "Above 50 creeps in your field: every 5 s the 3 weakest die per level" }, // v0.10l: 3 per level
  pillage: { name: "Pillage", max: 5, text: "Steal 1% of a player's gold on each breakthrough" }, // v0.10k: 1 % per level
});
/** v0.09q: Arrow Volley: cooldown, area radius in fields, arrows per perk level, extra base damage. */
export const VOLLEY = { cooldown: 20, radius: 1.5, perLevel: 3, bonus: 3, spread: 0.9 };
/** Research that only an element unlocks: its element (for colour and frame in the dialog). */
export const RESEARCH_ELEMENT = Object.freeze({ R002: "water", R000: "fire", R005: "earth", R006: "arcane", R00K: "storm", R00C: "plague", R00J: "fire", R00U: "earth", R00V: "fire", R00W: "storm", R00X: "plague", R001: "water", R00D: "arcane" });
const perkLevel = (p, id) => p?.perks?.[id] || 0;
/** v0.10n: Golem Whisperer (Earth): boss creeps 25 % cheaper and 10 % more hit points. */
export const GOLEM = { discount: 0.25, hp: 0.1 };
function bossDiscount(p, item, gold) {
  return item?.isSend && item.bossTier && perkLevel(p, "golem") ? Math.round(gold * (1 - GOLEM.discount)) : gold;
}
/** Archer (h003) and every tower that grows out of it. */
let ARCHER_LINE = null;
function archerLine() {
  if (!ARCHER_LINE) {
    ARCHER_LINE = new Set(["h003"]);
    const queue = ["h003"];
    while (queue.length) for (const u of obj(queue.shift())?.upgrades || []) if (!ARCHER_LINE.has(u)) ARCHER_LINE.add(u) && queue.push(u);
  }
  return ARCHER_LINE;
}
/** Seconds per recruit (v0.09q: Recruitment refills the first three of a tier 8 % faster per level). */
export function stockRegenOf(p, s) {
  const level = perkLevel(p, "recruit"),
    first = level && !s.bossTier && tierSends(s.tier).slice(0, 3).some((x) => x.id === s.id);
  return (s.stockRegen || 0) / (first ? 1 + 0.08 * level : 1);
}
/** Highest stock of a send for this player (Recruitment adds to the first three of a tier). */
export function stockMaxOf(p, s) {
  if (!s) return 0;
  const extra = perkLevel(p, "recruit");
  return s.stockMax + (extra && !s.bossTier && tierSends(s.tier).slice(0, 3).some((x) => x.id === s.id) ? extra : 0);
}
// ---- Experience and level picks (v0.06, replaces wood) --------------------------------
// EXP comes from everything that used to give wood: breakthroughs, creeps crossing the enemy
// lane, EXP generators (former lumbermills), boss sends and achievements. Each level offers a
// choice of three upgrades; the opening pick and levels 10 and 25 offer an element instead.
export const ELEMENT_LEVELS = [10, 25];
/**
 * v0.09p: EXP to rise from `level` to the next one. Level 1 is the start; level 2 needs 60,
 * level 3 125, level 4 200, level 5 300; from level 6 on: previous step × 1.05 + 50 × the new
 * level − 150 (rounded). The game ends at level 100.
 */
export const MAX_LEVEL = 100;
const EXP_STEPS = [60, 125, 200, 300]; // EXP_STEPS[i]: EXP to reach level i + 2
while (EXP_STEPS.length < MAX_LEVEL - 1) {
  const next = EXP_STEPS.length + 2;
  EXP_STEPS.push(Math.round(EXP_STEPS[EXP_STEPS.length - 1] * 1.05 + 25 * next - 150));
}
export function expNeeded(level) {
  return EXP_STEPS[Math.max(1, Math.min(MAX_LEVEL - 1, level)) - 1];
}
function gainExp(game, p, amount) {
  if (!(amount > 0)) return;
  amount *= 1 + 0.2 * perkLevel(p, "novice"); // v0.09q: Novice, 20 % per level
  p.exp += amount;
  p.stats.expEarned += amount;
  while (p.level < MAX_LEVEL && p.exp >= p.expNext) {
    p.exp -= p.expNext;
    p.level++;
    p.expNext = expNeeded(p.level);
    if (game) {
      const kind = ELEMENT_LEVELS.includes(p.level) && FACTIONS.some((f) => !p.research[f.unlock]) ? "element" : "upgrade";
      p.picks.push(makePick(game, p, kind));
      emit(game, "levelUp", { player: p.id, level: p.level, kind });
    }
  }
  if (p.level >= MAX_LEVEL) p.exp = Math.min(p.exp, p.expNext); // full bar at the top level
}
/** Test hook (local debug only): grant EXP as if earned in play. */
export function grantExp(game, playerIndex, amount) {
  gainExp(game, game.players[playerIndex], amount);
}
/** Research never offered as a perk (v0.10o: Forged Arrows removed). */
const REMOVED_PERKS = new Set(["R013", "R000"]);
const ELEMENT_RESEARCH = new Set(FACTIONS.map((f) => f.research));
/** Research levels a player may take as a level reward right now. */
function upgradeOptions(game, p) {
  return getCatalog()
    .research.filter((r) => r.playable && r.playerResearch && !ELEMENT_RESEARCH.has(r.id) && !REMOVED_PERKS.has(r.id))
    .filter((r) => available(game, p.id, "research", r.id, null, true).ok)
    .map((r) => ({ type: "research", id: r.id }));
}
/**
 * v0.09i: perk availability. Every reward of the level-up dialog (a "perk") may appear only on
 * the levels listed here: "1-3" = levels 1 to 3, "2,6,9-12" = 2, 6, 9, 10, 11, 12, "15+" = from
 * level 15 on. Perks missing from the table are available on every level. Elements stay on
 * their fixed levels (opening pick, 10 and 25).
 */
export const PERK_AVAILABILITY = {
  // perks
  recruit: "2-5",
  feudal: "2-5",
  archery: "2-5",
  patrol: "2",
  militia: "2-3",
  evolution: "2-3",
  gold: "3-5",
  novice: "3-6",
  volley: "2-5",
  pillage: "6+",
  crowd: "6+",
  golem: "3+",
  permafrost: "3+",
  // research (needs the matching element)
  R00K: "1+", // Watcher Owl
  R00U: "1+", // Creep Armor
  R00V: "1+", // Leadership
  R00W: "1+", // Tailwind
  R00X: "1+", // Willpower
  R001: "1+", // Healing Power
  R002: "1+", // Sparring Lessons
  R005: "1+", // Heavy Weapons
  R006: "1+", // Magic Library
  R00C: "1+", // Unholy Frenzy
  R00D: "1+", // Spirit Wolves
  R00J: "1+", // Fire Arrows
};
const availabilityCache = new Map();
/** Parses "1-3", "2,6,9-12" or "15+" into a test for a level. */
export function parseAvailability(spec) {
  const key = String(spec ?? "1+");
  if (!availabilityCache.has(key)) {
    const parts = key.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
      let m;
      if ((m = x.match(/^(\d+)\+$/))) return [Number(m[1]), Infinity];
      if ((m = x.match(/^(\d+)\s*-\s*(\d+)$/))) return [Number(m[1]), Number(m[2])];
      if ((m = x.match(/^(\d+)$/))) return [Number(m[1]), Number(m[1])];
      return null;
    }).filter(Boolean);
    availabilityCache.set(key, (level) => parts.some(([a, b]) => level >= a && level <= b));
  }
  return availabilityCache.get(key);
}
const perkAvailable = (o, level) => {
  const id = o.type === "perk" || o.type === "research" ? o.id : o.type;
  return parseAvailability(PERK_AVAILABILITY[id] ?? "1+")(level);
};
function makePick(game, p, kind) {
  const draw = (list, n) => {
    const pool = list.slice(),
      out = [];
    while (pool.length && out.length < n) out.push(pool.splice(Math.floor(random(game) * pool.length), 1)[0]);
    return out;
  };
  if (kind === "element")
    return { kind, level: p.level, options: draw(FACTIONS.filter((f) => !p.research[f.unlock]).map((f) => ({ type: "element", id: f.id })), 3) };
  // v0.09q: no general rewards any more; perks and research, each on its own levels
  const open = (o) => perkAvailable(o, p.level) && optionValid(game, p, o);
  const perks = Object.keys(PERKS)
    .map((id) => ({ type: "perk", id }))
    .filter(open);
  // through level 3 one perk is always among the options
  const early = p.level <= 3 && perks.length ? draw(perks, 1) : [];
  const rest = upgradeOptions(game, p).filter(open).concat(perks.filter((x) => !early.some((e) => e.id === x.id)));
  const options = draw(early.concat(draw(rest, 3 - early.length)), 3);
  return { kind, level: p.level, options };
}
/** Open picks were rolled at level-up; after a choice, options that are no longer possible
 *  (an element already owned, an upgrade at its last level) are swapped for fresh ones. */
function optionKey(o) {
  return o.type + ":" + (o.id || "");
}
function optionValid(game, p, o) {
  if (o.type === "element") {
    const f = FACTIONS.find((x) => x.id === o.id);
    return !!f && !p.research[f.unlock];
  }
  if (o.type === "research") return available(game, p.id, "research", o.id, null, true).ok;
  if (o.type === "perk" && PERKS[o.id]?.element && !p.research[FACTIONS.find((f) => f.id === PERKS[o.id].element)?.unlock]) return false;
  if (o.type === "perk") return perkLevel(p, o.id) < (PERKS[o.id]?.max || 0) && (o.id !== "evolution" || evolutionTargets(game, p).length > 0);
  return true;
}
function refreshPicks(game, p) {
  for (const pick of p.picks) {
    const seen = new Set(),
      keep = pick.options.filter((o) => optionValid(game, p, o) && !seen.has(optionKey(o)) && seen.add(optionKey(o)));
    if (keep.length === pick.options.length) continue;
    const fresh = makePick(game, p, pick.kind).options.filter((o) => !seen.has(optionKey(o)));
    while (keep.length < 3 && fresh.length) keep.push(fresh.shift());
    pick.options = keep;
  }
}
/** Applies option `index` of the oldest open pick. */
function resolvePick(game, p, index) {
  const pick = p.picks[0];
  if (!pick) return { ok: false, reason: "No choice open" };
  const option = pick.options[index];
  if (!option) return { ok: false, reason: "Invalid choice" };
  p.picks.shift();
  if (option.type === "element") {
    const f = FACTIONS.find((x) => x.id === option.id);
    finishResearch(game, p, f.research);
    if (!p.faction) p.faction = f.id;
  } else if (option.type === "research") finishResearch(game, p, option.id);
  else if (option.type === "gold") p.gold += option.amount;
  else if (option.type === "income") p.income += option.amount;
  else if (option.type === "lives") p.lives += option.amount;
  else if (option.type === "perk") {
    p.perks = { ...(p.perks || {}), [option.id]: perkLevel(p, option.id) + 1 };
    if (option.id === "patrol") p.freeArchers = (p.freeArchers || 0) + 2;
    if (option.id === "militia") placeMilitia(game, p, 2);
    if (option.id === "evolution") evolveTower(game, p);
    if (option.id === "gold") {
      const gold = perkGold(pick.level);
      p.gold += gold;
      p.stats.goldEarned += gold;
    }
    if (option.id === "volley" && !(p.volleyReady > game.time)) p.volleyReady = game.time;
    if (option.id === "recruit")
      for (const s of tierSends(p.tier).slice(0, 3)) if (p.stock[s.id]) p.stock[s.id].count = Math.min(stockMaxOf(p, s), p.stock[s.id].count + 1);
  }
  refreshPicks(game, p);
  emit(game, "picked", { player: p.id, option, level: pick.level });
  return { ok: true, option };
}
/** Gold perk: 40 + 20 × the level of the dialog it was offered in. */
export const perkGold = (level) => 40 + 20 * level;
/** Militia: footmen that stand at once on random free fields (never blocking the path). */
function placeMilitia(game, p, count) {
  for (let k = 0; k < count; k++) {
    const cells = [];
    for (let y = 0; y < game.grid.rows; y++)
      for (let x = 0; x < game.grid.cols; x++) if (canBuild(game, p.id, x, y, "h000").ok) cells.push([x, y]);
    if (!cells.length) return;
    const [x, y] = cells[Math.floor(random(game) * cells.length)],
      tower = newTower(game, p, "h000", x, y);
    tower.buildRemaining = 0;
    tower.militia = true;
    p.towers.push(tower);
    p.stats.built++;
    repath(game, p);
    emit(game, "build", { player: p.id, id: "h000", towerId: tower.id, x: tower.x, y: tower.y });
    completeTower(game, p, tower);
  }
}
/** Level 2 towers with a level 3 upgrade the player could take (gold aside). */
function evolutionTargets(game, p) {
  const out = [];
  for (const t of p.towers) {
    const item = obj(t.typeId);
    if (!item || (item.level || 1) !== 2 || t.buildRemaining > 0) continue;
    const ups = item.upgrades.filter((id) => {
      const u = obj(id);
      if (!u?.playable || (u.level || 1) !== 3) return false;
      const a = available(game, p.id, "upgrade", id, t.id);
      return a.ok || /more gold/.test(a.reason || "");
    });
    if (ups.length) out.push({ t, ups });
  }
  return out;
}
/** Evolution: a random level 2 tower becomes one of its level 3 upgrades at once, free. */
function evolveTower(game, p) {
  const list = evolutionTargets(game, p);
  if (!list.length) return;
  const { t, ups } = list[Math.floor(random(game) * list.length)],
    id = ups[Math.floor(random(game) * ups.length)],
    item = obj(id),
    old = obj(t.typeId),
    ratio = t.hp / t.maxHp;
  if (t.completed && old.woodIncome) p.woodIncome -= old.woodIncome;
  t.previousTypeId = t.typeId;
  t.typeId = id;
  t.name = item.shortName;
  t.completed = false;
  t.upgrading = true;
  const stats = statsFor(game, p, item);
  t.hp = stats.hp * ratio;
  t.maxHp = stats.hp;
  t.mana = isMagicTower(item) ? Math.min(stats.mana, t.mana || 0) : stats.mana;
  t.buildRemaining = 0;
  t.buildTotal = item.buildTime;
  emit(game, "upgrade", { player: p.id, id, towerId: t.id, evolution: true });
  completeTower(game, p, t);
}
/** Arrow Volley: arrows of the perk (as level 1 archers) plus one per archer-line tower, spread over a moment. */
function launchVolley(game, p, x, y) {
  const level = perkLevel(p, "volley"),
    base = obj("h003"),
    arrows = [];
  const baseDamage = VOLLEY.bonus + statsFor(game, p, base).damage;
  for (let i = 0; i < VOLLEY.perLevel * level; i++) arrows.push({ damage: baseDamage, attackType: base.attackType });
  for (const t of p.towers) {
    if (t.buildRemaining > 0 || !archerLine().has(t.typeId)) continue;
    const item = obj(t.typeId);
    arrows.push({ damage: VOLLEY.bonus + statsFor(game, p, item).damage, attackType: item.attackType });
  }
  const n = arrows.length;
  arrows.forEach((a, i) => (game.volleys ||= []).push({ player: p.id, x, y, time: game.time + (VOLLEY.spread * i) / Math.max(1, n), ...a }));
  p.volleyReady = game.time + VOLLEY.cooldown;
  emit(game, "volleyStart", { player: p.id, x, y, arrows: n });
}
function tickVolleys(game) {
  if (!game.volleys?.length) return;
  const due = game.volleys.filter((v) => v.time <= game.time + EPS);
  if (!due.length) return;
  game.volleys = game.volleys.filter((v) => v.time > game.time + EPS);
  const r = VOLLEY.radius * game.grid.cellUnits;
  for (const v of due) {
    const p = game.players[v.player];
    if (!p || p.out) continue;
    const centre = { x: v.x, y: v.y },
      inside = p.creeps.filter((c) => !c.dead && c.hp > 0 && dist(game, c, centre) <= r);
    let hit = null;
    if (inside.length) {
      hit = inside[Math.floor(random(game) * inside.length)];
      strike(game, p, null, hit, v.damage, v.attackType);
    }
    // a miss lands somewhere in the area
    const a = random(game) * Math.PI * 2,
      d = random(game) * VOLLEY.radius,
      at = hit ? { x: hit.x, y: hit.y } : { x: v.x + (Math.cos(a) * d) / game.grid.cols, y: v.y + (Math.sin(a) * d) / game.grid.rows };
    emit(game, "volley", { player: p.id, x: at.x, y: at.y, targetId: hit?.id ?? null });
  }
}
function completeTower(game, p, t) {
  if (t.completed) return;
  t.completed = true;
  const item = obj(t.typeId);
  // v0.09k: the gold bonus for the first towers (payback) is gone
  if (
    !t.upgrading &&
    !t.fromSale &&
    t.typeId === "h05L" &&
    game.achievements.halls < 2 &&
    game.time >= game.achievements.hallNextTime
  ) {
    const wood = [75, 50][game.achievements.halls++];
    game.achievements.hallNextTime = game.time + 0.01;
    gainExp(game, p, wood);
    emit(game, "achievement", { player: p.id, achievement: "hall", exp: wood });
  }
  if (item.support === "farm" && !t.fromSale) {
    p.income += 1;
    for (const threshold of [6, 5]) {
      const c = spawnCreep(game, p.id, "n02C");
      if (c && game.incomeCounter <= threshold)
        c.speed = statsFor(game, p, obj("n02C")).speed * (0.5 + random(game) * 0.17);
    }
  }
  if (item.woodIncome) p.woodIncome += item.woodIncome;
  emit(game, "built", { player: p.id, towerId: t.id, id: item.id });
}
function pay(p, cost) {
  p.gold -= cost.gold;
}

/** All human and AI actions use this same validated command entry point. */
export function command(game, input) {
  const type = input.type,
    playerIndex = input.player ?? 0,
    p = game.players[playerIndex];
  if (!p) return { ok: false, reason: "Invalid player" };
  if (p.out && type !== "pause") return { ok: false, reason: "Knocked out" };
  if (type === "pause") {
    game.paused = input.paused ?? !game.paused;
    return { ok: true };
  }
  if (type === "autoSend") {
    // Auto-spawn slot: a creep id (or null to clear) and whether it is switched on.
    p.autoSend = input.id === undefined ? p.autoSend : input.id || null;
    p.autoSendActive = input.active ?? true;
    return { ok: true };
  }
  if (type === "autoHold") {
    // v0.08b: the player has pre-builds or upgrades waiting for gold: auto-spawn pauses.
    p.autoHold = !!input.hold;
    return { ok: true };
  }
  if (!game.running) return { ok: false, reason: "Duel over" };
  if (type === "surrender") {
    // v0.09: white flag. 1v1: the other side wins; four players: this player drops out.
    p.lives = 0;
    emit(game, "surrender", { player: p.id });
    defeat(game, p, null);
    return { ok: true };
  }
  if (type === "pick") return resolvePick(game, p, input.index | 0);
  if (game.paused) return { ok: false, reason: "Game paused" };
  if (type === "sell") return sellTower(game, p, input.towerId);
  if (type === "volley") {
    if (!perkLevel(p, "volley")) return { ok: false, reason: "Arrow Volley not learned" };
    if (p.volleyReady > game.time + EPS) return { ok: false, reason: `Arrow Volley ready in ${Math.ceil(p.volleyReady - game.time)} s` };
    const x = Number(input.x),
      y = Number(input.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < -0.1 || y > 1.1) return { ok: false, reason: "Outside the board" };
    launchVolley(game, p, x, y);
    return { ok: true };
  }
  const id = input.id || input.unitId || input.upgradeId;
  const check = available(game, playerIndex, type, id, input.towerId);
  if (!check.ok) return check;
  const item = obj(id);
  if (type === "build") {
    const gx = input.gridX ?? Math.floor(input.x * game.grid.cols),
      gy = input.gridY ?? Math.floor(input.y * game.grid.rows);
    const placement = canBuild(game, playerIndex, gx, gy, id);
    if (!placement.ok) return placement;
    const free = id === "h003" && (p.freeArchers || 0) > 0;
    if (free) p.freeArchers--;
    else pay(p, check.cost);
    const tower = newTower(game, p, id, gx, gy);
    if (free) tower.free = true;
    p.towers.push(tower);
    p.stats.built++;
    repath(game, p);
    emit(game, "build", { player: p.id, id, towerId: tower.id, x: tower.x, y: tower.y });
    return { ok: true, towerId: tower.id };
  }
  if (type === "upgrade") {
    const t = p.towers.find((t) => t.id === input.towerId),
      old = obj(t.typeId),
      ratio = t.hp / t.maxHp;
    pay(p, check.cost);
    if (t.completed && old.woodIncome) p.woodIncome -= old.woodIncome;
    t.previousTypeId = t.typeId;
    t.typeId = id;
    t.name = item.shortName;
    t.totalSpent += item.cost;
    t.woodSpent += item.woodCost;
    t.completed = false;
    t.fromSale = false;
    t.upgrading = true;
    const stats = statsFor(game, p, item);
    t.hp = stats.hp * ratio;
    t.maxHp = stats.hp;
    t.mana = isMagicTower(item) ? Math.min(stats.mana, t.mana || 0) : stats.mana;
    t.buildRemaining = item.buildTime;
    t.buildTotal = item.buildTime;
    emit(game, "upgrade", { player: p.id, id, towerId: t.id });
    return { ok: true, towerId: t.id };
  }
  if (type === "send") {
    pay(p, check.cost);
    p.stock[id].count--;
    if (p.stock[id].next <= game.time) p.stock[id].next = game.time + Math.max(0.05, stockRegenOf(p, item));
    // Integer JASS arithmetic: fractional income accumulates in hundredths.
    const { base, decimal } = sendIncomeParts(p, item);
    p.income += base;
    p.incomeDecimal += decimal;
    p.income += Math.trunc(p.incomeDecimal / 100);
    p.incomeDecimal %= 100;
    if (id === "n00Y" && p.treantCount <= 20) {
      p.treantCount++;
      gainExp(game, p, 20);
    }
    if (id === "n01D") {
      if (p.ghoulCount <= 25) {
        p.ghoulCount++;
        p.woodIncome++;
      }
      gainExp(game, p, 1);
    }
    for (const spawnId of item.spawnIds) spawnCreep(game, p.id, spawnId);
    p.stats.sent++;
    emit(game, "send", { player: p.id, id, count: item.spawnIds.length, income: base + decimal / 100, auto: !!input.auto });
    if (item.bossTier) {
      const reward = { n00T: 250, n015: 375, n01H: 500, n01T: 250, n02R: 300 }[id];
      if (reward) gainExp(game, p, reward);
      // Each tier boss can be bought once; buying it unlocks the next tier (tier 6 is off in the source).
      p.bossBought = { ...(p.bossBought || {}), [id]: true };
      if (id === "n01T") p.infernalBossCount++;
      if (id !== "n02R") advanceTier(game, p, item.bossTier);
    }
    return { ok: true, count: item.spawnIds.length };
  }
  if (type === "research") {
    // WISP Instant Tech has no condition: every RESEARCH_START grants the
    // researched level immediately (war3map.j:11374,11526-11530).
    pay(p, check.cost);
    finishResearch(game, p, id);
    emit(game, "research", { player: p.id, id });
    return { ok: true };
  }
  return { ok: false, reason: "Unknown command" };
}

function finishResearch(game, p, id) {
  p.research[id] = (p.research[id] || 0) + 1;
  const element = FACTIONS.find((f) => f.research === id);
  if (element) {
    p.research[element.unlock] = 1;
    p.elementsPurchased++;
    p.research.Rhfs = FACTIONS.filter((f) => p.research[f.unlock]).length;
  }
  if (id === "R00D") p.research.R00E = Math.max(0, p.research.R00D - 1);
  if (id === "R00W") {
    p.research.R00A = (p.research.R00A || 0) + 1;
    p.research.R007 = (p.research.R007 || 0) + 5;
  }
  if (id === "R001")
    for (const regenId of ["R00B", "R00Y", "R00F", "R011"]) p.research[regenId] = p.research.R001 * p.tier;
  if (id === "R006") {
    p.research.Rhra = (p.research.Rhra || 0) + 1;
    p.research.Robk = p.research.R006;
  }
  if (id === "R013") p.research.R017 = (p.research.R017 || 0) + 5;
  if (id === "R00J") p.research.R01P = (p.research.R01P || 0) + 1;
  // R00R replaces the ordinary arrow route with the arcane route.
  if (id === "R00R")
    for (const t of p.towers) {
      const replacement = { h03G: "h00F", h03H: "h04Q", h03L: "h04R" }[t.typeId];
      if (replacement && obj(replacement)) {
        t.typeId = replacement;
        t.name = obj(replacement).shortName;
      }
    }
  for (const t of p.towers) {
    const s = statsFor(game, p, obj(t.typeId)),
      ratio = t.hp / t.maxHp;
    t.maxHp = s.hp;
    t.hp = s.hp * ratio;
  }
  for (const defender of game.players)
    for (const c of defender.creeps)
      if (c.owner === p.id) {
        const s = statsFor(game, p, obj(c.typeId)),
          ratio = c.hp / c.maxHp,
          oldSpeed = c.baseSpeed || obj(c.typeId).speed * movementMultiplier(game);
        c.maxHp = s.hp;
        c.hp = s.hp * ratio;
        c.armor = s.armor;
        c.regen = s.regen;
        c.speed *= s.speed / oldSpeed;
        c.baseSpeed = s.speed;
      }
  emit(game, "researched", { player: p.id, id, level: p.research[id] });
}
// ---- Send stock (v0.06) ------------------------------------------------------------------
/** The 12 sends of a tier in deck order: cheapest first, boss last. */
export function tierSends(tier) {
  return getCatalog()
    .sends.filter((s) => s.playable && s.tier === tier)
    .sort((a, b) => Number(!!a.bossTier) - Number(!!b.bossTier) || a.cost - b.cost);
}
/**
 * Opening stock of a tier: the first three sends are ready at once and half full; in tiers 2-5 the
 * start delay of the first row (6 sends) is halved and that of the second row cut by a third.
 */
function stockTier(game, p, tier, now) {
  tierSends(tier).forEach((s, i) => {
    if (i < 3) {
      p.stock[s.id] = { count: Math.max(1, Math.ceil(stockMaxOf(p, s) / 2)), next: now + Math.max(0.05, s.stockRegen) };
      return;
    }
    // Tier 2+: first six creeps wait half as long, the rest a third less; tier 1: a third less.
    const delay = s.stockStart * (tier >= 2 && i < 6 ? 0.5 : 2 / 3);
    p.stock[s.id] = { count: delay > 0 ? 0 : stockMaxOf(p, s), next: now + delay };
  });
}
function advanceTier(game, p, tier) {
  if (tier <= p.tier) return;
  const oldFirst = tierSends(p.tier)[0]?.id;
  p.tier = tier;
  p.research.R009 = tier;
  p.research.R012 = tier - 1;
  p.research.Rhri = tier - 1;
  stockTier(game, p, tier, game.time);
  // Auto-spawn slot: the old tier's first creep moves up to the new tier's first; anything else is cleared.
  if (p.autoSend) p.autoSend = p.autoSend === oldFirst ? tierSends(tier)[0]?.id || null : null;
  if (tier >= 2 && tier <= 5 && !game.achievements.tiers.includes(tier)) {
    game.achievements.tiers.push(tier);
    gainExp(game, p, 75);
    emit(game, "achievement", { player: p.id, achievement: "tier", tier, exp: 75 });
  }
  emit(game, "tier", { player: p.id, tier, message: `Tier ${tier} unlocked` });
}
export function getSellValue(game, playerIndex, towerId) {
  const t = game.players[playerIndex]?.towers.find((t) => t.id === towerId);
  if (!t) return 0;
  const item = obj(t.typeId);
  if (t.free && t.typeId === "h003") return 0; // a Forest Patrol archer was free
  return item.support === "farm" ? 0 : Math.trunc(item.pointValue * item.sellRate);
}
function sellTower(game, p, towerId) {
  const i = p.towers.findIndex((t) => t.id === towerId);
  if (i < 0) return { ok: false, reason: "Tower not found" };
  const t = p.towers[i],
    item = obj(t.typeId);
  if (t.buildRemaining > EPS) return { ok: false, reason: "Still under construction" };
  const refund = getSellValue(game, p.id, towerId);
  p.gold += refund;
  if (item.woodIncome) p.woodIncome -= item.woodIncome;
  if (item.support === "farm") {
    // Farm's zero-value demolition/explosion is distinct from selling a tower.
    const explosion = getCatalog().abilities.A04M;
    for (const c of p.creeps) {
      const d = dist(game, t, c),
        damage =
          d <= fval(explosion, "Dda1")
            ? fval(explosion, "Dda2")
            : d <= fval(explosion, "Dda3")
              ? fval(explosion, "Dda4")
              : 0;
      c.hp -= damage;
    }
    p.towers.splice(i, 1);
  } else p.towers.splice(i, 1); // selling clears the field completely
  // No juggling (v0.07n): creeps already walking keep their route; a field opened by a sale
  // is a shortcut for the next creeps only.
  p.path = findPath(game, p.id) || [];
  emit(game, "sell", { player: p.id, towerId, refund });
  return { ok: true, refund };
}

// ---- v0.08b: seats, targets and knock-outs (1v1 and 4 players) ---------------------------
// With four players everybody sends to the player on their right in rounds 1–3; every three
// rounds the target moves one seat further right (players already out are skipped).
export const ROTATE_ROUNDS = 3;
export function targetOf(game, index) {
  const n = game.players.length;
  if (n <= 2) return game.players[1 - index];
  const others = [];
  for (let k = 1; k < n; k++) {
    const q = game.players[(index + k) % n];
    if (!q.out) others.push(q);
  }
  if (!others.length) return game.players[(index + 1) % n];
  return others[Math.floor(Math.max(0, game.round - 1) / ROTATE_ROUNDS) % others.length];
}
/** Players whose creeps currently run into this player's lane. */
export function attackersOf(game, index) {
  return game.players.filter((q) => q.id !== index && !q.out && targetOf(game, q.id).id === index);
}
export const aliveCount = (game) => game.players.filter((q) => !q.out).length;
/** A player has no lives left: the duel ends, or with four players that player drops out. */
function defeat(game, p, by = null) {
  if (game.players.length <= 2) {
    const winner = by && by.id !== p.id ? by : game.players[1 - p.id];
    game.running = false;
    game.winner = winner.id;
    emit(game, "victory", { player: winner.id });
    return;
  }
  p.place = aliveCount(game);
  p.out = true;
  p.lives = 0;
  for (const c of p.creeps) c.dead = true;
  p.autoSend = null;
  p.aiPush = null;
  emit(game, "eliminated", { player: p.id, place: p.place, by: by?.id ?? -1 });
  const left = game.players.filter((q) => !q.out);
  if (left.length <= 1) {
    const winner = left[0] || by || p;
    winner.place = 1;
    game.running = false;
    game.winner = winner.id;
    emit(game, "victory", { player: winner.id });
  }
}
function spawnCreep(game, ownerIndex, id, at = null, lane = null) {
  const item = obj(id);
  if (!item || !item.hp) return null;
  const owner = game.players[ownerIndex],
    target = lane !== null && lane !== undefined && game.players[lane] ? game.players[lane] : targetOf(game, ownerIndex),
    s = statsFor(game, owner, item);
  if (target.out || target.id === ownerIndex) return null;
  const column = at ? gridAt(game, at).x : spawnColumn(game),
    position = at || pos(game, column, -1);
  const creep = {
    id: "c" + game.nextId++,
    typeId: id,
    name: item.shortName,
    owner: ownerIndex,
    defender: target.id,
    x: position.x,
    y: position.y,
    hp: s.hp,
    maxHp: s.hp,
    armor: s.armor,
    speed: s.speed * (0.88 + random(game) * 0.24),
    baseSpeed: s.speed,
    regen: s.regen,
    flying: item.flying,
    invisible: (item.abilities || []).some((id) => getCatalog().abilities[id]?.baseId === "Apiv"),
    defenseType: item.defenseType,
    path: item.flying ? [position, pos(game, column, game.grid.rows)] : findPath(game, target.id, gridAt(game, position)) || [],
    pathIndex: 0,
    statuses: [],
    cooldown: 0,
    progress: 0,
    maxProgress: 0,
    crossed: 0,
    laps: 0,
    bornTick: game.tick,
    dead: false,
  };
  if (item.mana) creep.mana = item.mana;
  target.creeps.push(creep);
  // BOSS Mob T1-T3: every boss arrives with three escorts (speed +12 / 0 / -12).
  const escort = BOSS_MOBS[id];
  if (escort && obj(escort))
    [12, 0, -12].forEach((delta, i) =>
      game.pendingSpawns.push({ owner: ownerIndex, lane: target.id, id: escort, time: game.time + 0.1 * (i + 1), x: creep.x, y: creep.y, health: 1, speedDelta: delta }),
    );
  return creep;
}
const BOSS_MOBS = { n00T: "n01U", n015: "n01W", n01H: "n01X" };
/** Divine Shield cycle (Divine Timer): 10 s invulnerable, 20 s open, starting 10 s after arrival. */
const DIVINE = new Set(["n01G", "n015", "n02M", "n02I"]);
export function divineShield(game, c) {
  if (c.wave || !DIVINE.has(c.typeId)) return false;
  const age = game.time - c.bornTick * TICK;
  return age >= 10 && (age - 10) % 30 < 10;
}

export function damageMultiplier(attackType, defenseType, armor = 0) {
  const type = RULES.damageMatrix[attackType] || RULES.damageMatrix.normal,
    index = RULES.defenseOrder.indexOf(defenseType);
  const typeBonus = type[index < 0 ? 1 : index];
  const mitigation = armor >= 0 ? 1 / (1 + RULES.armorFactor * armor) : 2 - Math.pow(1 - RULES.armorFactor, -armor);
  return typeBonus * mitigation;
}
/** Damage type matrix plus the wave "immune" trait (magic and spells barely hurt). */
function hitMultiplier(attackType, creep, armor = 0) {
  const base = damageMultiplier(attackType, creep.defenseType, armor);
  return creep.immune && (attackType === "magic" || attackType === "spells") ? base * WAVE_IMMUNE_FACTOR : base;
}
function abilityLevel(player, tower, ability) {
  const item = obj(tower.typeId),
    max = fval(ability, "alev", 0, 1);
  return Math.min(max, Math.max(1, item.level || 1));
}
function unitAbilities(unit) {
  if (unit.wave) return [];
  return obj(unit.typeId)
    .abilities.map((id) => getCatalog().abilities[id])
    .filter(Boolean);
}
// Aura sources never change per unit type, so their fields are read once and cached.
const AURA_KINDS = new Set(["AOae", "AHad", "AEar", "ACat", "AUau"]);
const AURA_CACHE = new Map();
let auraCatalog = null;
function aurasOf(unit) {
  if (unit.wave) return [];
  const catalog = getCatalog();
  if (auraCatalog !== catalog) {
    AURA_CACHE.clear();
    auraCatalog = catalog;
  }
  let list = AURA_CACHE.get(unit.typeId);
  if (!list) {
    list = unitAbilities(unit)
      .filter((a) => AURA_KINDS.has(a.baseId))
      .map((a) => {
        const level = abilityLevel(null, unit, a),
          targets = splitIds(field(a.fields, "atar", level));
        return {
          baseId: a.baseId,
          friend: targets.includes("friend"),
          self: targets.includes("self"),
          enemies: targets.includes("enemies"),
          radius: fval(a, "aare", level),
          oae1: a.baseId === "AOae" ? fval(a, "Oae1", level) : 0,
          oae2: a.baseId === "AOae" ? fval(a, "Oae2", level) : 0,
          had1: a.baseId === "AHad" ? fval(a, "Had1", level) : 0,
          ear1: a.baseId === "AEar" || a.baseId === "ACat" ? fval(a, "Ear1", level) : 0,
          uau1: a.baseId === "AUau" ? fval(a, "Uau1", level) : 0,
          uau2: a.baseId === "AUau" ? fval(a, "Uau2", level) : 0,
        };
      });
    AURA_CACHE.set(unit.typeId, list);
  }
  return list;
}
function auraAt(game, target, owner, units) {
  let speedUp = 0,
    speedDown = 0,
    attackUp = 0,
    attackDown = 0,
    armorUp = 0,
    armorDown = 0,
    damage = 0,
    regen = 0;
  for (const source of units) {
    if (source.dead || source.buildRemaining > EPS) continue;
    const auras = aurasOf(source);
    if (!auras.length) continue;
    const sourceOwner = source.owner ?? owner.id;
    for (const a of auras) {
      const friendly = sourceOwner === (target.owner ?? owner.id);
      if (friendly && !a.friend && !a.self) continue;
      if (!friendly && !a.enemies) continue;
      if (target === source && !a.self) continue;
      if (a.radius <= 0 || dist(game, source, target) > a.radius) continue;
      if (a.baseId === "AOae") {
        speedUp = Math.max(speedUp, a.oae1);
        speedDown = Math.min(speedDown, a.oae1);
        attackUp = Math.max(attackUp, a.oae2);
        attackDown = Math.min(attackDown, a.oae2);
      }
      if (a.baseId === "AHad") {
        armorUp = Math.max(armorUp, a.had1);
        armorDown = Math.min(armorDown, a.had1);
      }
      if (a.baseId === "AEar" || a.baseId === "ACat") damage = Math.max(damage, a.ear1);
      if (a.baseId === "AUau") {
        speedUp = Math.max(speedUp, a.uau1);
        regen = Math.max(regen, a.uau2);
      }
    }
  }
  return {
    speed: Math.max(0.1, 1 + speedUp + speedDown),
    attack: Math.max(0.1, 1 + attackUp + attackDown),
    armor: armorUp + armorDown,
    damage: 1 + damage,
    regen,
  };
}
// ---- Passive tower and creep skills (pass 3) -----------------------------------------
// The map runs most specials through JASS triggers on "unit is attacked" plus dummy
// passives. Numbers come from the ability fields and tooltips; chances and resist
// rules follow the triggers (Nerf Resistance A02U / boss A05F lower procs and
// shorten negative effects to 25 %).
const tipText = (a, level) => cleanText(field(a?.fields, "aub1", level) || "");
const tipNum = (a, level, re, fallback = 0) => {
  const m = tipText(a, level).match(re);
  return m ? Number(m[1]) : fallback;
};
const EXECUTE_DAMAGE = { h01Y: 140, h00M: 450, h04I: 1250, h050: 3250 };
const STOMP_LEVEL = { h02T: 3, h01T: 4, h01U: 5, h01V: 6 };
const STOMP_DAMAGE = { 3: 50, 4: 200, 5: 575, 6: 1200 };
const PROC_SCALE = { normal: 1, resist: 0.4, boss: 0.2 };
const SKILL_CACHE = new Map();
function skillOf(a, level = 1) {
  if (!a) return null;
  const key = a.id + ":" + level;
  if (SKILL_CACHE.has(key)) return SKILL_CACHE.get(key);
  const name = String(field(a.fields, "anam", 0) || "");
  let sk = null;
  switch (a.baseId) {
    case "ANca":
      sk = { type: "cleave", fraction: fval(a, "nca1", level), radius: fval(a, "aare", level, 180) };
      break;
    case "Aroc":
      sk = { type: "multishot", count: tipNum(a, level, /(\d+) arrows/, 3) };
      break;
    case "Afra":
      sk = { type: "frost", slow: tipNum(a, level, /speed by (\d+)%/, 40) / 100, duration: fval(a, "adur", level, 3), bossDuration: fval(a, "ahdu", level, 1) };
      break;
    case "AIcf": {
      const t = tipText(a, level),
        fly = t.match(/Flying creeps take (\d+)%/i);
      sk = { type: "immolation", dps: tipNum(a, level, /Deals (\d+) damage per second/, 0), radius: fval(a, "aare", level, 192), airOnly: /Air only/i.test(t), flyFactor: fly ? Number(fly[1]) / 100 : 1 };
      break;
    }
    case "Afbt":
      sk = { type: "feedback", bonus: tipNum(a, level, /Deals (\d+) extra damage/, 0) };
      break;
    case "AHbh":
      sk = { type: "bash", chance: tipNum(a, level, /Chance of (\d+)%/, 20) / 100, duration: fval(a, "adur", level, 2), bossDuration: fval(a, "ahdu", level, 1), bonus: fval(a, "Hbh3", level, tipNum(a, level, /deal (\d+) extra/, 0)) };
      break;
    case "AHab":
      sk = { type: "manaAura", regen: fval(a, "Hab1", level), radius: fval(a, "aare", level, 525) };
      break;
    case "Adtg":
      sk = { type: "detect", radius: fval(a, "aran", level, tipNum(a, level, /Range (\d+)/, 300)) };
      break;
    case "Abof":
      sk = { type: "disease", dps: fval(a, "Hfs1", level), radius: fval(a, "aare", level, 225), duration: fval(a, "adur", level, 3) };
      break;
    case "Amgl":
    case "Aro1":
      if (a.id === "A006") sk = { type: "execute" };
      else if (a.id === "A04W") sk = { type: "stomp" };
      else if (a.id === "A0BG") sk = { type: "disrupt" };
      else if (/entangle/i.test(name)) sk = { type: "entangle", chance: tipNum(a, level, /Chance of (\d+)%/, 15) / 100, requires: splitIds(field(a.fields, "areq", 0)) };
      else sk = { type: "passive" };
      break;
    case "ACes":
      sk = { type: "evasion", chance: fval(a, "Eev1", level, 0.2) };
      break;
    case "Ansk":
      sk = { type: "scales", ignore: fval(a, "Ssk3", level, 0), min: fval(a, "Ssk2", level, 1) };
      break;
    case "AIsr":
      sk = { type: "magicResist", reduce: fval(a, "isr2", level, tipNum(a, level, /by (\d+)%/, 30) / 100) };
      break;
    case "Apiv":
      sk = { type: "invisible" };
      break;
    case "Arsk":
      sk = { type: "nerfResist" };
      break;
    case "Aspt": {
      // Spawned dummies that cast Inferno (AUin) stand for the infernal they summon.
      let id = field(a.fields, "Sod2", level);
      const inferno = (obj(id)?.abilities || []).map((x) => getCatalog().abilities[x]).find((x) => x?.baseId === "AUin");
      if (inferno && field(inferno.fields, "Uin4", 1)) id = field(inferno.fields, "Uin4", 1);
      sk = { type: "spawnOnDeath", id, count: fval(a, "Sod1", level, 1) };
      break;
    }
    case "Aslo":
      // Only meaningful on sends: the Witch Doctor curses towers (rate of fire -30 % for 90 s).
      if (/structure/.test(field(a.fields, "atar", level) || ""))
        sk = { type: "curse", amount: fval(a, "Slo2", level, 0.3), duration: fval(a, "adur", level, 90), cooldown: fval(a, "acdn", level, 3.33), range: Math.max(192, fval(a, "aran", level, 64)) };
      break;
  }
  SKILL_CACHE.set(key, sk);
  return sk;
}
/** Abilities whose effect the port now covers (shown as implemented in the card details). */
const COVERED_BASES = new Set(["AHfa", "Afae", "Ablo", "ACpa", "Arai", "Avul", "Aslo", "ANca", "Aroc", "Afra", "AIcf", "Afbt", "AHbh", "AHab", "Adtg", "Abof", "Amgl", "ACat", "AUau", "ACes", "Ansk", "AIsr", "Apiv", "Arsk", "Aspt", "Asal", "Aimp"]);
const VISUAL_ONLY = (a) => (a.baseId === "Aasl" && fval(a, "Slo1", 1) === 0) || ["Aroa", "Aeth"].includes(a.baseId) || a.id === "A06Z";
function towerSkills(player, tower) {
  return unitAbilities(tower)
    .map((a) => skillOf(a, abilityLevel(player, tower, a)))
    .filter((sk) => sk && sk.type !== "passive" && (!sk.requires?.length || meetRequirements(player, sk.requires.map((id) => ({ id, level: 1 }))).ok));
}
const CREEP_SKILLS = new Map();
function creepSkills(c) {
  if (c.wave) return [];
  if (!CREEP_SKILLS.has(c.typeId)) CREEP_SKILLS.set(c.typeId, unitAbilities(c).map((a) => skillOf(a, 1)).filter(Boolean));
  return CREEP_SKILLS.get(c.typeId);
}
function nerfClass(c) {
  if (c.waveBoss) return "boss";
  if (c.wave) return "normal";
  const ids = obj(c.typeId)?.abilities || [];
  if (ids.includes("A05F")) return "boss";
  if (ids.includes("A02U") || c.typeId === "n01G" || c.typeId === "n02N") return "resist";
  return "normal";
}
/** Nerf Resistance shortens negative effects by 75 % (A02U, bosses). */
function negativeDuration(c, normal) {
  return nerfClass(c) === "normal" ? normal : normal * 0.25;
}
function detected(game, p, c) {
  return p.towers.some((t) => !(t.buildRemaining > 0) && towerSkills(p, t).some((sk) => sk.type === "detect" && dist(game, t, c) <= sk.radius));
}
/** One damage instance against a creep, with creep-side skills applied. */
function strike(game, p, tower, c, damage, attackType, spell = false, extraArmor = 0) {
  if (c.dead || damage <= 0 || divineShield(game, c)) return 0;
  const cs = creepSkills(c);
  if (!spell) {
    const evade = cs.find((sk) => sk.type === "evasion");
    if (evade && random(game) < evade.chance) {
      if (random(game) < 0.25) emit(game, "skill", { player: p.id, kind: "miss", x: c.x, y: c.y });
      return 0;
    }
  }
  const armor = c.armor + extraArmor - (c.shred || 0) + c.statuses.reduce((sum, st) => sum + (st.armor || 0), 0);
  let dealt = damage * hitMultiplier(spell ? "spells" : attackType, c, armor);
  if (!spell) {
    const scales = cs.find((sk) => sk.type === "scales");
    if (scales) dealt = Math.max(scales.min, dealt - scales.ignore);
  }
  if (spell || attackType === "magic") {
    const resist = cs.find((sk) => sk.type === "magicResist");
    if (resist) dealt *= 1 - resist.reduce;
  }
  c.hp -= dealt;
  if (tower) c.lastHit = tower.id;
  return dealt;
}
/** On-attack procs of a tower against its primary target. */
function applySkills(game, p, tower, item, target, damage, skills) {
  const cls = nerfClass(target);
  for (const sk of skills) {
    if (target.dead) return;
    if (sk.type === "frost") {
      // Frost never stacks: one frost slow per creep, a new hit only refreshes it.
      const duration = negativeDuration(target, sk.duration || 3),
        frost = target.statuses.find((st) => st.abilityId === "frost");
      if (frost) {
        frost.remaining = Math.max(frost.remaining, duration);
        frost.slow = Math.max(frost.slow, sk.slow);
      } else target.statuses.push({ abilityId: "frost", remaining: duration, slow: sk.slow, dps: 0, owner: p.id });
    } else if (sk.type === "bash" && random(game) < sk.chance) {
      target.statuses.push({ abilityId: "stun", remaining: negativeDuration(target, sk.duration, sk.bossDuration), slow: 0, dps: 0, stun: true, owner: p.id });
      strike(game, p, tower, target, sk.bonus, item.attackType);
      emit(game, "skill", { player: p.id, kind: "stun", x: target.x, y: target.y });
    } else if (sk.type === "execute" && EXECUTE_DAMAGE[tower.typeId] && target.hp > 0 && target.hp <= target.maxHp * 0.25) {
      if (random(game) < { normal: 1, resist: 1 / 3, boss: 1 / 5 }[cls]) {
        const amount = EXECUTE_DAMAGE[tower.typeId];
        strike(game, p, tower, target, amount, "normal");
        emit(game, "skill", { player: p.id, kind: "execute", x: target.x, y: target.y, amount });
      }
    } else if (sk.type === "disrupt" && random(game) < 0.25 * PROC_SCALE[cls]) {
      const max = Math.min(25, obj(tower.typeId).level || 1);
      if ((target.shred || 0) < max) target.shred = (target.shred || 0) + 1;
    } else if (sk.type === "disease") {
      const mine = game.clouds.filter((cl) => cl.towerId === tower.id);
      if (mine.length >= 3) game.clouds.splice(game.clouds.indexOf(mine[0]), 1);
      game.clouds.push({ lane: p.id, towerId: tower.id, x: target.x, y: target.y, radius: sk.radius, dps: sk.dps, remaining: sk.duration });
    } else if (sk.type === "stomp") {
      const near = p.towers.some((o) => o !== tower && STOMP_LEVEL[o.typeId] && dist(game, o, tower) <= game.grid.cellUnits * 1.5);
      tower.stomp = (tower.stomp || 0) + 1 + Math.floor(random(game) * (near ? 5 : 20));
      if (tower.stomp >= 50) {
        tower.stomp = 0;
        const level = STOMP_LEVEL[tower.typeId] || 3;
        for (const c of p.creeps)
          if (!c.dead && !c.flying && dist(game, tower, c) <= 256) {
            strike(game, p, tower, c, STOMP_DAMAGE[level] || 0, "spells", true);
            c.statuses = c.statuses.filter((st) => st.abilityId !== "stomp");
            c.statuses.push({ abilityId: "stomp", remaining: negativeDuration(c, 4, 2), slow: 0.25, dps: 0, owner: p.id });
          }
        emit(game, "skill", { player: p.id, kind: "stomp", x: tower.x, y: tower.y, radius: 256 });
      }
    }
  }
}
// ---- Tower specials, v0.00 rules ------------------------------------------------------
// Cannon: tiny core takes full damage, a wider ring 50 %. Magic: mana charges slowly, a full
// bar fires an empowered bolt. Poison: every hit adds a stack (damage + a little slow, stacks
// add up). Frost: one slow, never stacks.
const CANNON_CORE = 0.35, // cells
  CANNON_RING = 1.15, // cells
  CANNON_RING_FACTOR = 0.5;
export const MAGIC_CHARGE_SECONDS = 8;
export const MAGIC_EMPOWER = 4;
const POISON_MAX_STACKS = 8,
  POISON_SLOW_PER_STACK = 0.03,
  POISON_SLOW_CAP = 0.18;
const nameOf = (item) => String(item?.shortName || item?.name || "");
// Ranges: ranged towers reach about one field less than in the map; melee towers hit exactly
// the 8 fields around their own field (a square, not a circle).
export const MELEE_RANGE_MAX = 200;
const RANGE_CUT_CELLS = 1,
  RANGE_MIN_CELLS = 1.5;
export const isMeleeTower = (item) => !!item?.isBuildable && item.attacks && item.range > 0 && item.range <= MELEE_RANGE_MAX;
function rangedReach(game, range) {
  const cu = game.grid.cellUnits;
  return range > MELEE_RANGE_MAX ? Math.max(RANGE_MIN_CELLS * cu, range - RANGE_CUT_CELLS * cu) : range;
}
/** Melee reach: the creep stands on the tower's field or one of the 8 around it. */
function inMeleeReach(game, tower, c) {
  const a = gridAt(game, c);
  return Math.abs(a.x - tower.gridX) <= 1 && Math.abs(a.y - tower.gridY) <= 1;
}
export const isCannonTower = (item) => /^Bombard/.test(nameOf(item));
export const isMagicTower = (item) => /^Magic Tower/.test(nameOf(item)) && (item?.mana || 0) > 0;
/** Slow from all statuses: frost and other slows never stack, poison stacks add up to a cap. */
export function statusSlow(statuses) {
  let other = 0,
    poison = 0;
  for (const st of statuses) {
    if (st.poison) poison += st.slow || 0;
    else other = Math.max(other, st.slow || 0);
  }
  return Math.max(other, 0) + Math.min(POISON_SLOW_CAP, poison);
}
// ---- Charged specials ("ULTIMATE ... N" triggers) --------------------------------------
// Every attack adds 1-10 charge; at N the tower casts its special and resets. Values come
// from the dummy casters (o002 Flamestrike, o003 Chain Lightning, o004 Blizzard, o005
// Tsunami, o006 Swarm Rockets, n00H Entangle) and the trigger bodies.
const ULTIMATES = {
  h01L: { charge: 40, kind: "entangle", level: 1 },
  h00B: { charge: 40, kind: "entangle", level: 2 },
  h037: { charge: 40, kind: "entangle", level: 3 },
  h00G: { charge: 40, kind: "entangle", level: 4 },
  h021: { charge: 45, kind: "decay", pct: 8 },
  h009: { charge: 45, kind: "decay", pct: 12 },
  h038: { charge: 45, kind: "decay", pct: 18 },
  h01Z: { charge: 45, kind: "decay", pct: 30 },
  h00J: { charge: 60, kind: "shrink" },
  h046: { charge: 75, kind: "rockets" },
  h00I: { charge: 80, kind: "flamestrike" },
  h020: { charge: 80, kind: "chain" },
  h010: { charge: 100, kind: "blizzard" },
  h03W: { charge: 140, kind: "tsunami" },
  h043: { charge: 160, kind: "raise" },
};
const ENTANGLE = { 1: { dps: 30, dur: 6, min: 300 }, 2: { dps: 90, dur: 9, min: 600 }, 3: { dps: 270, dur: 12, min: 1200 }, 4: { dps: 840, dur: 15, min: 2400 } };
/** SKILL Chain Light Hall: 1 in 7 attacks (A0BY levels 2-5; level 3 is missing in the data). */
const HALL_CHAIN = { h01I: 64, h007: 190, h039: 550, h00J: 1600 };
function chainLightning(game, p, tower, first, damage, count, falloff, radius = 500) {
  const hit = new Set();
  let from = first,
    prev = tower,
    amount = damage;
  for (let k = 0; k < count && from; k++) {
    strike(game, p, tower, from, amount, "spells", true);
    emit(game, "shot", { player: p.id, towerId: tower.id, targetId: from.id, from: { x: prev.x, y: prev.y }, to: { x: from.x, y: from.y }, damage: amount, element: "storm", bounce: k > 0, chain: true });
    hit.add(from);
    prev = from;
    amount *= 1 - falloff;
    from = p.creeps
      .filter((c) => !hit.has(c) && !c.dead && c.hp > 0 && dist(game, prev, c) <= radius)
      .sort((a, b) => dist(game, prev, a) - dist(game, prev, b))[0];
  }
}
function areaStrike(game, p, tower, at, radius, damage, air = true) {
  for (const c of p.creeps) if (!c.dead && c.hp > 0 && (air || !c.flying) && dist(game, at, c) <= radius) strike(game, p, tower, c, damage, "spells", true);
}
function chargedSpecial(game, p, tower, target) {
  const hall = HALL_CHAIN[tower.typeId];
  if (hall && random(game) < 1 / 7) chainLightning(game, p, tower, target, hall, 6, 0.1);
  const u = ULTIMATES[tower.typeId];
  if (!u || target.dead) return;
  tower.charge = Math.min(u.charge * 3, (tower.charge || 0) + 1 + Math.floor(random(game) * 10));
  if (tower.charge < u.charge) return;
  const at = { x: target.x, y: target.y };
  switch (u.kind) {
    case "entangle": {
      const e = ENTANGLE[u.level];
      if (target.hp < e.min || target.statuses.some((st) => st.abilityId === "entangle")) return;
      target.statuses.push({ abilityId: "entangle", remaining: negativeDuration(target, e.dur), slow: 0, dps: e.dps, stun: true, owner: p.id });
      break;
    }
    case "decay": {
      if (divineShield(game, target)) return;
      const pct = (u.pct / 100) * (nerfClass(target) === "boss" ? 0.25 : 1);
      target.hp -= target.maxHp * pct;
      target.lastHit = tower.id;
      break;
    }
    case "shrink": {
      const pool = p.creeps.filter((c) => !c.dead && c.hp > 0 && dist(game, tower, c) <= 896);
      for (let i = 0; i < 5 && pool.length; i++) {
        const c = pool.splice(Math.floor(random(game) * pool.length), 1)[0];
        c.speed *= 0.85;
        c.shrink = Math.min(3, (c.shrink || 0) + 1);
      }
      break;
    }
    case "rockets":
      for (let i = 0; i < 3; i++) areaStrike(game, p, tower, at, 325, 900);
      break;
    case "flamestrike":
      game.clouds.push({ lane: p.id, towerId: tower.id, x: at.x, y: at.y, radius: 320, dps: 600, remaining: 2.67, kind: "fire" });
      game.clouds.push({ lane: p.id, towerId: tower.id, x: at.x, y: at.y, radius: 320, dps: 300, remaining: 6, kind: "fire" });
      break;
    case "chain":
      chainLightning(game, p, tower, target, 4000, 10, 0.1);
      break;
    case "blizzard":
      game.clouds.push({ lane: p.id, towerId: tower.id, x: at.x, y: at.y, radius: 256, pulse: 1250, interval: 0.75, next: 0, waves: 12, remaining: 9.5, kind: "ice", air: true });
      break;
    case "tsunami": {
      // Three carrion-swarm waves along the line from the tower through the target.
      const dx = (target.x - tower.x) * game.grid.cols,
        dy = (target.y - tower.y) * game.grid.rows,
        len = Math.hypot(dx, dy) || 1;
      for (const c of p.creeps) {
        if (c.dead || c.hp <= 0 || c.flying) continue;
        const cx = (c.x - tower.x) * game.grid.cols,
          cy = (c.y - tower.y) * game.grid.rows,
          along = (cx * dx + cy * dy) / len,
          off = Math.abs(cx * dy - cy * dx) / len;
        if (along >= 0 && along * game.grid.cellUnits <= 1600 && off * game.grid.cellUnits <= 170)
          for (let i = 0; i < 3; i++) strike(game, p, tower, c, 1800, "spells", true);
      }
      break;
    }
    case "raise":
      // Kel'Thuzad raises an Abomination and two flesh minions that march on the opponent.
      for (const id of ["n009", "n01X", "n01X"]) if (obj(id)) spawnCreep(game, p.id, id);
      break;
  }
  tower.charge = 0;
  emit(game, "skill", { player: p.id, kind: "ultimate", name: u.kind, x: at.x, y: at.y, towerId: tower.id });
}
// ---- Magic Tower autocasts (ARCANE triggers) -------------------------------------------
// Spell level = tower level (ARCANE Construct/Upgrade Magic). Arcane Missile and Frost Ring
// always; Bloodlust needs Fire, Chain Lightning Storm and Raise Dead Plague.
const MAGIC_CHAIN = { 1: 22, 2: 64, 3: 190, 4: 550, 5: 1600, 6: 3000 };
function castSpells(game, p, tower, target) {
  for (const a of unitAbilities(tower)) {
    if (!["AHfa", "Afae", "Ablo", "ACpa", "Arai"].includes(a.baseId)) continue;
    const level = abilityLevel(p, tower, a),
      cost = fval(a, "amcs", level),
      ready = !(tower.spellCooldowns[a.id] > game.time);
    if (!ready || tower.mana < cost) continue;
    const req = splitIds(field(a.fields, "areq", 0));
    if (req.length && !meetRequirements(p, req.map((id) => ({ id, level: 1 }))).ok) continue;
    let cast = false;
    if (a.baseId === "AHfa") {
      const bonus = fval(a, "Hfa1", level, 0) || tipNum(a, level, /Damage (\d+)/, 10);
      strike(game, p, tower, target, level === 1 ? tipNum(a, 1, /Damage (\d+)/, 10) : bonus, "spells", true);
      cast = true;
    } else if (a.baseId === "Afae") {
      if (!target.statuses.some((st) => st.abilityId === a.id)) {
        target.statuses.push({ abilityId: a.id, remaining: negativeDuration(target, fval(a, "adur", level, 15)), slow: 0, dps: 0, armor: -fval(a, "Fae1", level, 2), owner: p.id });
        cast = true;
      }
    } else if (a.baseId === "Ablo") {
      const range = Math.max(500, fval(a, "aran", level, 500)),
        ally = p.towers.find((t) => !(t.buildRemaining > 0) && !(t.bloodlust && t.bloodlust.until > game.time) && dist(game, tower, t) <= range);
      if (ally) {
        ally.bloodlust = { amount: fval(a, "Blo1", level, 0.1), until: game.time + fval(a, "adur", level, 15) };
        emit(game, "skill", { player: p.id, kind: "bloodlust", x: ally.x, y: ally.y, towerId: ally.id });
        cast = true;
      }
    } else if (a.baseId === "ACpa") {
      if (p.research.R01E) {
        chainLightning(game, p, tower, target, MAGIC_CHAIN[level] || 22, 6, 0.1);
        cast = true;
      }
    } else if (a.baseId === "Arai") {
      p.income += level * (level <= 2 ? 1 : level <= 4 ? 2 : 3);
      emit(game, "skill", { player: p.id, kind: "raise", x: tower.x, y: tower.y, towerId: tower.id, amount: level * (level <= 2 ? 1 : level <= 4 ? 2 : 3) });
      cast = true;
    }
    if (cast) {
      tower.mana -= cost;
      tower.spellCooldowns[a.id] = game.time + Math.max(TICK, fval(a, "acdn", level, 3));
    }
  }
}
/** Auras that tick every simulation step: immolation and disease clouds. */
function tickAreaDamage(game, p, tower, skills) {
  for (const sk of skills) {
    if (sk.type !== "immolation" || sk.dps <= 0) continue;
    for (const c of p.creeps) {
      if (c.dead || c.hp <= 0 || (sk.airOnly && !c.flying) || dist(game, tower, c) > sk.radius) continue;
      strike(game, p, tower, c, sk.dps * TICK * (c.flying ? sk.flyFactor : 1), "spells", true);
    }
  }
}
function tickClouds(game, p) {
  if (!game.clouds?.length) return;
  for (const cl of game.clouds) {
    if (cl.lane !== p.id) continue;
    cl.remaining -= TICK;
    const tower = p.towers.find((t) => t.id === cl.towerId) || null;
    if (cl.pulse) {
      cl.next -= TICK;
      if (cl.next <= 0 && cl.waves > 0) {
        cl.next += cl.interval;
        cl.waves--;
        for (const c of p.creeps) if (!c.dead && c.hp > 0 && dist(game, cl, c) <= cl.radius) strike(game, p, tower, c, cl.pulse, "spells", true);
      }
      if (cl.waves <= 0) cl.remaining = 0;
      continue;
    }
    for (const c of p.creeps)
      if (!c.dead && c.hp > 0 && (cl.air || !c.flying) && dist(game, cl, c) <= cl.radius) strike(game, p, tower, c, cl.dps * TICK, "spells", true);
  }
  game.clouds = game.clouds.filter((cl) => cl.remaining > 0);
}
function applyOnHit(game, player, tower, target) {
  for (const ability of unitAbilities(tower)) {
    const level = abilityLevel(player, tower, ability),
      a = ability.fields;
    if (
      !meetRequirements(
        player,
        splitIds(field(a, "areq", 0)).map((id) => ({ id, level: 1 })),
      ).ok
    )
      continue;
    if (ability.baseId === "Aspo") {
      // Poison stacks: each hit adds damage over time and a little slow; the oldest stack drops at the cap.
      const duration = negativeDuration(target, fval(ability, "adur", level) || 6),
        dps = Math.max(1, fval(ability, "Spo1", level));
      const mine = target.statuses.filter((s) => s.poison && s.abilityId === ability.id);
      if (mine.length >= POISON_MAX_STACKS) {
        const oldest = mine.reduce((a, b) => (b.remaining < a.remaining ? b : a));
        target.statuses.splice(target.statuses.indexOf(oldest), 1);
      }
      target.statuses.push({
        abilityId: ability.id,
        poison: true,
        remaining: duration,
        slow: POISON_SLOW_PER_STACK,
        dps,
        owner: player.id,
      });
    }
    if (
      ability.baseId === "Aslo" &&
      !isMagicTower(obj(tower.typeId)) &&
      tower.mana >= fval(ability, "amcs", level) &&
      !(tower.spellCooldowns[ability.id] > game.time)
    ) {
      tower.mana -= fval(ability, "amcs", level);
      tower.spellCooldowns[ability.id] = game.time + Math.max(TICK, fval(ability, "acdn", level));
      target.statuses = target.statuses.filter((s) => s.abilityId !== ability.id);
      target.statuses.push({
        abilityId: ability.id,
        remaining: fval(ability, "adur", level),
        slow: fval(ability, "Slo1", level),
        dps: 0,
        owner: player.id,
      });
    }
  }
}
function attack(game, p, tower, dt) {
  const item = obj(tower.typeId);
  if (!item.attacks) return;
  const stats = statsFor(game, p, item),
    aura = auraAt(game, tower, p, p.towers.concat(p.creeps));
  const cursed = (tower.curse && tower.curse.until > game.time ? tower.curse.amount : 0) - (tower.bloodlust && tower.bloodlust.until > game.time ? tower.bloodlust.amount : 0);
  if (item.weapon2) secondWeapon(game, p, tower, item, stats, aura, dt, cursed);
  tower.cooldown -= dt;
  if (tower.cooldown > 0) return;
  const canHit = (c) => (c.flying ? item.targets.includes("air") : item.targets.includes("ground")) && (!c.invisible || detected(game, p, c));
  const melee = isMeleeTower(item) && towerSize(tower) === 1,
    inReach = (c) => (melee ? inMeleeReach(game, tower, c) : dist(game, tower, c) <= stats.range);
  const targets = p.creeps.filter((c) => !c.dead && c.hp > 0 && inReach(c) && canHit(c));
  if (!targets.length) {
    tower.cooldown = 0;
    return;
  }
  targets.sort((a, b) => b.progress - a.progress || a.id.localeCompare(b.id));
  const target = targets[0],
    skills = towerSkills(p, tower);
  let damage =
    (diceRoll(game, item.damageBase, item.dice, item.sides) + stats.damageBonus) * stats.damageMultiplier * aura.damage;
  for (const ability of unitAbilities(tower))
    if (ability.baseId === "ACct") {
      const level = abilityLevel(p, tower, ability),
        chance = fval(ability, "Ocr1", level),
        multiplier = fval(ability, "Ocr2", level);
      if (multiplier > 1 && random(game) < chance) damage *= multiplier;
    }
  // Magic towers: a full mana bar turns the next attack into an empowered bolt.
  const magic = isMagicTower(item);
  let empowered = false;
  if (magic && tower.mana >= stats.mana - EPS && stats.mana > 0) {
    damage *= MAGIC_EMPOWER;
    tower.mana = 0;
    empowered = true;
    emit(game, "skill", { player: p.id, kind: "empower", x: target.x, y: target.y, towerId: tower.id });
  }
  const feedback = skills.find((sk) => sk.type === "feedback");
  const victimAura = auraAt(game, target, game.players[target.owner], p.creeps.concat(p.towers));
  // Corrosive auras (AHad) lower armor; strike() adds the creep's own shred and statuses.
  const dealt = strike(game, p, tower, target, damage + (feedback && target.summoned ? feedback.bonus : 0), item.attackType, false, victimAura.armor);
  applyOnHit(game, p, tower, target);
  applySkills(game, p, tower, item, target, damage, skills);
  chargedSpecial(game, p, tower, target);
  if (!magic) castSpells(game, p, tower, target);
  const shots = [target];
  // Multi Shot: extra arrows at the next creeps in range.
  const multi = skills.find((sk) => sk.type === "multishot");
  if (multi)
    for (const other of targets.slice(1, multi.count)) {
      strike(game, p, tower, other, damage, item.attackType);
      shots.push(other);
    }
  if (item.weapon === "mbounce") {
    // Bouncing missiles (Glaive): utc1 targets, udl1 damage loss per bounce, ua1f bounce area.
    const count = num(item.fields?.utc1, 1),
      loss = num(item.fields?.udl1, 0.33),
      area = item.splashFull || 312,
      hit = new Set([target]);
    let from = target,
      bounceDamage = damage;
    for (let k = 1; k < count; k++) {
      bounceDamage *= 1 - loss;
      const next = p.creeps
        .filter((c) => !hit.has(c) && !c.dead && c.hp > 0 && canHit(c) && dist(game, from, c) <= area)
        .sort((a, b) => dist(game, from, a) - dist(game, from, b))[0];
      if (!next) break;
      strike(game, p, tower, next, bounceDamage, item.attackType);
      emit(game, "shot", { player: p.id, towerId: tower.id, targetId: next.id, from: { x: from.x, y: from.y }, to: { x: next.x, y: next.y }, damage: bounceDamage, element: item.element, bounce: true });
      hit.add(next);
      from = next;
    }
  } else if (isCannonTower(item)) {
    // Cannon: full damage in a tiny core around the impact, 50 % in the wider ring.
    const core = Math.max(item.splashFull, CANNON_CORE * game.grid.cellUnits),
      ring = Math.max(item.splashSmall, item.splashMedium, CANNON_RING * game.grid.cellUnits);
    for (const other of p.creeps) {
      if (other === target || other.dead || other.hp <= 0 || !canHit(other)) continue;
      const d = dist(game, target, other),
        rate = d <= core ? 1 : d <= ring ? CANNON_RING_FACTOR : 0;
      if (rate) strike(game, p, tower, other, damage * rate, item.attackType);
    }
    emit(game, "skill", { player: p.id, kind: "splash", x: target.x, y: target.y, radius: ring, core });
  } else if (item.splashFull > 0 || item.splashMedium > 0 || item.splashSmall > 0) {
    for (const other of p.creeps) {
      if (other === target || other.dead || other.hp <= 0) continue;
      const d = dist(game, target, other);
      let rate =
        d <= item.splashFull
          ? 1
          : d <= item.splashMedium
            ? item.splashMediumFactor
            : d <= item.splashSmall
              ? item.splashSmallFactor
              : 0;
      if (rate) strike(game, p, tower, other, damage * rate, item.attackType);
    }
  }
  // Cleaving / splash attack skill (Ogre, Pit Lord, Robogoblin).
  const cleave = skills.find((sk) => sk.type === "cleave");
  if (cleave)
    for (const other of p.creeps)
      if (other !== target && !other.dead && other.hp > 0 && !other.flying && dist(game, target, other) <= cleave.radius)
        strike(game, p, tower, other, damage * cleave.fraction, item.attackType);
  tower.cooldown += Math.max(0.08, stats.cooldown / aura.attack / Math.max(0.1, 1 - cursed));
  for (const victim of shots)
    emit(game, "shot", {
      player: p.id,
      towerId: tower.id,
      targetId: victim.id,
      from: { x: tower.x, y: tower.y },
      to: { x: victim.x, y: victim.y },
      damage: victim === target ? dealt : damage,
      element: item.element,
      empowered: empowered && victim === target,
    });
}
/** Bash towers carry an extra anti-air weapon (ua2*): own cooldown, range and damage. */
function secondWeapon(game, p, tower, item, stats, aura, dt, cursed) {
  const w = item.weapon2;
  tower.cooldown2 = (tower.cooldown2 || 0) - dt;
  if (tower.cooldown2 > 0) return;
  const target = p.creeps
    .filter((c) => !c.dead && c.hp > 0 && c.flying && w.targets.includes("air") && dist(game, tower, c) <= rangedReach(game, w.range) && (!c.invisible || detected(game, p, c)))
    .sort((a, b) => b.progress - a.progress || a.id.localeCompare(b.id))[0];
  if (!target) {
    tower.cooldown2 = 0;
    return;
  }
  const damage = (diceRoll(game, w.damageBase, w.dice, w.sides) + stats.damageBonus) * (stats.damageMultiplier || 1) * aura.damage;
  const dealt = strike(game, p, tower, target, damage, w.attackType);
  tower.cooldown2 += Math.max(0.08, w.cooldown / aura.attack / Math.max(0.1, 1 - cursed));
  emit(game, "shot", { player: p.id, towerId: tower.id, targetId: target.id, from: { x: tower.x, y: tower.y }, to: { x: target.x, y: target.y }, damage: dealt, element: item.element, air: true });
}
/** v0.10l: Crowd Control: every 5 s, above 50 creeps in the field, the 3 (per level) with the least health die. */
export const CROWD = { interval: 5, threshold: 50, perLevel: 3 };
function crowdControl(game, p) {
  const level = perkLevel(p, "crowd");
  if (!level) return;
  if (!(p.crowdNext > 0)) p.crowdNext = game.time + CROWD.interval;
  if (game.time + EPS < p.crowdNext) return;
  p.crowdNext = game.time + CROWD.interval;
  const alive = p.creeps.filter((c) => !c.dead && c.hp > 0);
  if (alive.length <= CROWD.threshold) return;
  const victims = alive.sort((a, b) => a.hp - b.hp || a.id.localeCompare(b.id)).slice(0, CROWD.perLevel * level);
  for (const c of victims) {
    emit(game, "skill", { player: p.id, kind: "crowd", x: c.x, y: c.y });
    c.hp = 0;
    killCreep(game, p, c);
  }
}
function killCreep(game, p, c) {
  if (c.dead) return;
  c.dead = true;
  const item = obj(c.typeId),
    tower = p.towers.find((t) => t.id === c.lastHit);
  let bounty = c.wave ? c.bounty : diceRoll(game, item.bountyBase, item.bountyDice, item.bountySides);
  if (tower && (obj(tower.typeId).abilities.includes("A00O") || tower.typeId === "h02U") && random(game) < 0.5) {
    const level = abilityLevel(p, tower, getCatalog().abilities.A00O);
    bounty +=
      tower.typeId === "h000" && item.pointValue <= 1 ? 1 : Math.trunc((item.pointValue * (level * 25 + 50)) / 100);
  }
  if (tower && obj(tower.typeId).abilities.includes("A072") && random(game) < 0.5) {
    const level = abilityLevel(p, tower, getCatalog().abilities.A072);
    bounty += item.pointValue <= 1 ? 1 : Math.trunc((item.pointValue * (level * 20 + 40)) / 100);
  }
  p.gold += bounty;
  p.stats.goldEarned += bounty;
  p.stats.kills++;
  if (tower) tower.kills++;
  emit(game, "kill", { player: p.id, id: c.typeId, creepId: c.id, x: c.x, y: c.y, bounty, wave: c.wave || 0, boss: !!c.waveBoss });
  if (c.wave) waveDeath(game, p, c);
  else deathrattle(game, c);
}

function deathrattle(game, c) {
  const plans = {
    n00N: [
      ["n00R", 0],
      ["n00R", 0.33],
      ["n00R", 0.66],
    ],
    n00Y: [["n006", 0]],
    n02V: [
      ["n02W", 0],
      ["n02W", 0.25],
      ["n02X", 0.5],
    ],
    n01F: [["n004", 0]],
    n01H: [["n008", 0, 0.9]],
    n02E: [
      ["n038", 0],
      ["n038", 0.3],
      ["n038", 0.6],
      ["n038", 0.9],
    ],
  };
  let plan = (plans[c.typeId] || []).slice();
  if (c.typeId === "n03A" || c.typeId === "n037") {
    const roll = 1 + Math.floor(random(game) * 5),
      first = { 1: "n02Z", 2: "n034", 3: "n02Y", 4: "n036", 5: "n02Z" }[roll];
    plan = [[first, 0]];
    if (c.typeId === "n03A") plan.push([["n02Z", "n034", "n02Y", "n036", "n037"][Math.floor(random(game) * 5)], 0.4]);
  }
  for (const sk of creepSkills(c))
    if (sk.type === "spawnOnDeath" && obj(sk.id)) for (let i = 0; i < sk.count; i++) plan.push([sk.id, i * 0.3]);
  for (const [id, delay, health = 1] of plan)
    game.pendingSpawns.push({ owner: c.owner, lane: c.defender, id, time: game.time + delay, x: c.x, y: c.y, health });
}
/** The next lane a leaked creep runs on: the next seat to the right that is still in, not the sender's. */
function laneAfter(game, p, sender) {
  const n = game.players.length;
  for (let k = 1; k < n; k++) {
    const q = game.players[(p.id + k) % n];
    if (!q.out && q.id !== sender.id) return q;
  }
  return p;
}
function touchdown(game, p, c) {
  if (c.owner < 0) return waveTouchdown(game, p, c);
  const sender = game.players[c.owner];
  p.lives = Math.max(0, p.lives - 1);
  if (!sender.out) sender.lives++;
  sender.stats.leaks++;
  // v0.10k: Pillage, 1 % of the leaked player's gold per perk level
  const pillage = perkLevel(sender, "pillage");
  if (pillage && !sender.out) {
    const loot = Math.floor((p.gold * pillage) / 100);
    if (loot > 0) {
      p.gold -= loot;
      sender.gold += loot;
      emit(game, "pillage", { player: p.id, owner: sender.id, gold: loot, x: c.x, y: c.y });
    }
  }
  gainExp(game, sender, ["n00S", "n01C"].includes(c.typeId) ? 30 : RULES.touchdownWood);
  if (["n01R", "n02P"].includes(c.typeId)) {
    const stolen = Math.trunc(p.income / 100);
    p.income -= stolen;
    sender.income += stolen;
  }
  if (!game.firstBlood) {
    game.firstBlood = true;
    gainExp(game, sender, RULES.firstBloodWood);
    emit(game, "firstBlood", { player: sender.id, exp: RULES.firstBloodWood });
  }
  emit(game, "leak", { player: p.id, owner: sender.id, creepId: c.id, lives: p.lives, x: c.x, y: c.y });
  if (p.lives <= 0) {
    gainExp(game, sender, RULES.defeatWood);
    defeat(game, p, sender);
    return;
  }
  c.laps++;
  // Survivors re-enter at a new random portal field. v0.09b: on the lane of the next player
  // (seat order to the right, skipping players who are out and the sender); 1v1 stays put.
  const lane = laneAfter(game, p, sender),
    column = spawnColumn(game),
    start = pos(game, column, -1);
  if (lane !== p) {
    c.moveTo = lane.id;
    c.defender = lane.id;
  }
  c.x = start.x;
  c.y = start.y;
  c.progress = 0;
  c.maxProgress = 0;
  c.path = c.flying ? [start, pos(game, column, game.grid.rows)] : findPath(game, lane.id, { x: column, y: -1 }) || [];
  c.pathIndex = 0;
  c.prevNode = null;
}
function moveCreep(game, p, c, dt) {
  if (c.dead) return;
  const shielded = divineShield(game, c);
  for (const s of c.statuses) {
    s.remaining -= dt;
    if (!shielded) c.hp -= s.dps * dt * hitMultiplier("spells", c, 0);
  }
  c.statuses = c.statuses.filter((s) => s.remaining > 0);
  if (c.hp <= 0) {
    killCreep(game, p, c);
    return;
  }
  const slow = statusSlow(c.statuses),
    stunned = c.statuses.some((s) => s.stun),
    aura = auraAt(game, c, game.players[c.owner], p.creeps.concat(p.towers));
  c.hp = Math.min(c.maxHp, c.hp + (c.regen + (aura.regen || 0)) * dt);
  const curse = creepSkills(c).find((sk) => sk.type === "curse");
  if (curse && !stunned) {
    c.cooldown = (c.cooldown || 0) - dt;
    if (c.cooldown <= 0) {
      const tower = p.towers
        .filter((t) => !(t.buildRemaining > 0) && !(t.curse && t.curse.until > game.time) && dist(game, c, t) <= curse.range)
        .sort((a, b) => dist(game, c, a) - dist(game, c, b))[0];
      if (tower) {
        tower.curse = { amount: curse.amount, until: game.time + curse.duration };
        c.cooldown = curse.cooldown;
        emit(game, "skill", { player: p.id, kind: "curse", x: tower.x, y: tower.y, towerId: tower.id });
      }
    }
  }
  if (stunned) {
    c.progress = clamp((c.y - 0.5 / game.grid.rows) / (1 - 1 / game.grid.rows), 0, 1);
    return;
  }
  // c.speed is already scaled once by statsFor; scale both clamp limits too.
  // This equals clamp(original speed with modifiers,24,1000)*modeMultiplier.
  const mobility = movementMultiplier(game);
  const frozen = c.flying ? 1 : 1 - 0.04 * perkLevel(p, "permafrost"); // v0.10o: Permafrost of the defender
  let remaining = clamp(c.speed * (1 - clamp(slow, 0, 0.9)) * aura.speed * frozen, 24 * mobility, 1000 * mobility) * dt;
  while (remaining > EPS && game.running) {
    const next = c.path[c.pathIndex];
    if (!next) {
      touchdown(game, p, c);
      break;
    }
    const distance = dist(game, c, next);
    if (distance <= remaining + EPS) {
      c.x = next.x;
      c.y = next.y;
      c.pathIndex++;
      remaining -= distance;
    } else {
      const factor = remaining / distance;
      c.x += (next.x - c.x) * factor;
      c.y += (next.y - c.y) * factor;
      remaining = 0;
    }
  }
  c.progress = clamp((c.y - 0.5 / game.grid.rows) / (1 - 1 / game.grid.rows), 0, 1);
  c.maxProgress = Math.max(c.maxProgress, c.progress);
  const reached = c.flying ? 0 : Math.min(5, Math.floor(c.maxProgress * 6));
  while (c.crossed < reached) {
    c.crossed++;
    if (c.owner >= 0) gainExp(game, game.players[c.owner], 1);
  }
}

function incomeTick(game) {
  game.warmup = false;
  game.round++;
  if (game.waves && game.round >= WAVE_FIRST_ROUND && (game.round - WAVE_FIRST_ROUND) % WAVE_EVERY_ROUNDS === 0)
    launchWave(game, (game.round - WAVE_FIRST_ROUND) / WAVE_EVERY_ROUNDS + 1);
  game.incomeCounter++;
  game.incomeRemaining += game.incomeInterval;
  if (game.players.length > 2 && game.round > 1 && (game.round - 1) % ROTATE_ROUNDS === 0)
    emit(game, "rotate", { targets: game.players.map((q) => (q.out ? -1 : targetOf(game, q.id).id)) });
  for (const p of game.players) {
    if (p.out) continue;
    const wolfLevel = p.research.R00D || 0;
    if (game.incomeCounter > 10 && wolfLevel > 0) {
      p.income += RULES.spiritIncome[wolfLevel] || 0;
      const wolf = spawnCreep(game, p.id, ["n01Z", "n020", "n024", "n035", "n02T", "n01K"][p.tier - 1]);
      if (wolf) wolf.summoned = true;
    }
    p.gold += p.income;
    p.stats.goldEarned += p.income;
    gainExp(game, p, p.woodIncome);
    emit(game, "income", { player: p.id, gold: p.income, exp: p.woodIncome });
  }
  if (game.round >= RULES.suddenDeathRound) {
    if (!game.suddenDeath) {
      game.suddenDeath = true;
      emit(game, "suddenDeath");
    }
    for (const p of game.players) {
      if (p.out) continue;
      if (p.lives > 5) {
        p.lives--;
        gainExp(game, p, 25);
      }
      for (const [threshold, wood] of [
        [60, 23],
        [90, 21],
        [120, 19],
        [150, 17],
        [180, 15],
        [210, 12],
      ])
        if (p.lives > threshold) {
          p.lives--;
          gainExp(game, p, wood);
        }
    }
  }
}
/**
 * Training opponents. "normal" is the original mobile AI unchanged. The other
 * levels only change how often the bot acts and how it splits gold between
 * defence and sends; every action still goes through the same paid commands.
 */
export const AI_LEVELS = Object.freeze({
  veryEasy: Object.freeze({ interval: 60 }),
  easy: Object.freeze({
    interval: 40,
    firstSendRound: 4,
    sendsPerRound: (r) => (r < 10 ? 1 : 1 + Math.floor((r - 10) / 8)),
    minTowers: 4,
    towerGrowth: 0.25,
    maxTowers: 10,
    reserve: 0.8,
    bossDelay: 10,
    lazyUpgrades: true,
  }),
  normal: Object.freeze({ interval: 20 }),
  hard: Object.freeze({ interval: 10, minTowers: 4, towerGrowth: 0.34, upgradeEager: true }),
});
function aiLevel(game, p) {
  const level = p?.aiLevel || game.aiLevel;
  return Object.hasOwn(AI_LEVELS, level) ? level : "normal";
}
/**
 * How far the bot's towers fall short of the next neutral wave. Kill capacity is
 * tower DPS times the time a creep needs to cross the lane, with a margin for
 * overkill and spread. Positive gap = build or upgrade before sending.
 */
const AI_WAVE_SAFETY = { veryEasy: 0.9, easy: 0.6, normal: 1, hard: 1.35 };
function waveDefense(game, p) {
  if (!game.waves) return { gap: 0, flying: false, airTowers: true };
  const level = aiLevel(game, p),
    info = nextWave(game),
    alive = p.creeps.filter((c) => c.owner < 0);
  if (!info) return { gap: 0, flying: false, airTowers: true };
  const spec = WAVE_TYPES[info.type],
    defenseType = spec.defense || (info.flying ? "small" : "medium"),
    armor = 1 + RULES.armorFactor * info.armor;
  const total = info.hp * info.count * (spec.split ? 1.76 : 1) * armor + alive.reduce((sum, c) => sum + c.hp, 0);
  const speed = 240 * (spec.speed || 1) * movementMultiplier(game),
    cells = info.flying ? game.grid.rows : Math.max(game.grid.rows, p.path.length),
    crossing = (cells * game.grid.cellUnits) / speed;
  let ground = 0,
    air = 0,
    airDps = 0;
  for (const t of p.towers) {
    const item = obj(t.typeId);
    if (!item?.attacks) continue;
    const dps =
      (item.damage / Math.max(0.1, item.cooldown)) *
      damageMultiplier(item.attackType, defenseType, 0) *
      (spec.immune && item.attackType === "magic" ? WAVE_IMMUNE_FACTOR : 1);
    // Time a creep spends in this tower's range; a winding maze passes it more than once.
    const exposure = (s) => Math.min(crossing, ((2 * item.range + game.grid.cellUnits) / speed) * (s ? 1 : 1.6));
    if (item.targets.includes("ground")) ground += dps * exposure(false);
    if (item.targets.includes("air")) {
      air += dps * exposure(true);
      airDps += dps;
    }
  }
  const flyingShare = info.flying ? 1 : info.mixed ? 0.5 : 0,
    need = total * (AI_WAVE_SAFETY[level] || 1),
    groundGap = need * (1 - flyingShare) - ground * 0.5,
    airGap = need * flyingShare - air * 0.5;
  return { gap: Math.max(groundGap, airGap), groundGap, airGap, flying: flyingShare > 0, airTowers: airDps > 0, total, flyingShare, seconds: info.seconds };
}
// ---- AI (v0.06) ---------------------------------------------------------------------------
// Economy first: the bot keeps as few towers as it can, spends on defence only while the
// creeps the opponent actually sends (plus the next neutral wave) outgrow its kill capacity,
// and otherwise invests in income sends. It saves for pushes now and then, prefers flyers
// when the opponent has little anti-air, and plays every match a little differently: each
// AI player rolls a personality from the game seed. Everything goes through `command`.
const AI_SAFETY = { veryEasy: 1.45, easy: 0.85, normal: 1.2, hard: 1.45 };
// How the difficulty plays: share of decisions that follow the maze plan, how noisy tower
// placement is, and persona multipliers. Very easy turtles: it overbuilds, sends little and late.
const AI_STYLE = {
  veryEasy: { strict: 0.45, noise: 0.6, turtle: 0.6, maxSends: 1, persona: { greed: 0.35, push: 0, bossRound: 1.8, expGen: 0, upgradeBias: 0.7 } },
  easy: { strict: 0.75, noise: 0.35, persona: { greed: 0.85, push: 0.5, bossRound: 1.3 } },
  normal: { strict: 1, noise: 0.1 },
  // Hard (v0.07m): its own ranges from about 1,000 hard-vs-hard games (two random searches over
  // every trait, then checks: 70 % wins against the old ranges, 54 % against the first draft).
  // Area damage pays on the long template routes; the bot keeps a slim safety margin, sends
  // more, pushes rarely and briefly, reads the opponent's saved gold as a coming push, holds
  // more of each neutral wave and goes for the kill when the opponent runs low on lives.
  hard: {
    strict: 1,
    noise: 0,
    ranges: {
      greed: [1.7, 2.3],
      splash: [1.4, 2.0],
      push: [0, 0.05],
      expGen: [0.5, 1.2],
      caution: [0.9, 1.1],
      rateShare: [0.3, 0.45],
      waveShare: [0.7, 0.9],
      airThreshold: [0.1, 0.25],
      pushSize: [1, 1.5],
      researchBias: [1.0, 1.4],
      pushMargin: [1.4, 1.6],
      flyerBias: [1.2, 1.4],
      mazeRush: [0.1, 0.3],
      mazeValue: [1.0, 1.3],
      bankWatch: [0.3, 0.6],
      killShot: [5, 10],
      sendPick: [1, 2.99],
    },
  },
};
// Ranges found by self-play (v0.07f: about 1,500 bot-vs-bot games). Income wins: the bot keeps
// sending, saves only for short pushes that should break through, buys its tier boss early,
// and every match still rolls its own values inside these ranges.
export const AI_DEFAULTS = {
  greed: [1.0, 1.7], // how readily surplus gold goes into sends
  splash: [0.8, 1.5], // preference for area damage
  push: [0, 0.12], // chance to plan a saved-up push when the economy is healthy
  bossRound: [3.5, 7], // earliest round for a tier boss, per tier
  expGen: [0, 1.2], // appetite for EXP generators
  upgradeBias: [1.0, 1.9], // upgrading existing towers instead of placing new ones
  caution: [1.0, 1.35], // extra defence margin on top of the difficulty's safety factor
  rateShare: [0.25, 0.42], // share of the opponent's whole round the lane must hold at once
  waveShare: [0.4, 0.62], // share of the next neutral wave the lane must hold at once
  airThreshold: [0.12, 0.3], // enemy anti-air below this share of ground power invites flyers
  pushSize: [1.5, 3], // push size in income rounds
  researchBias: [0.6, 1.1], // level picks: upgrades versus gold, income and lives
  smartPush: [1, 1], // 1 = size pushes against the opponent's kill capacity
  pushMargin: [1.3, 1.7], // how far a smart push must exceed that capacity
  smartElements: [1, 1], // 1 = lean towards the elements that win most (storm, arcane)
  flyerBias: [1.15, 1.5], // how much flyers are preferred against thin anti-air
  mazeV2: [1, 1], // 1 = template maze on the arena (v0.07k), 0 = the older wall maze
  mazeValue: [1, 1], // weight of the route a template tower still promises
  mazeRush: [0.1, 0.35], // chance per decision to lay the next template tower before it is needed
  mazeRank: [0.5, 0.8], // how strictly the template's build order is kept (1 = only the next cell)
  armorAware: [0, 0], // 1 = size pushes against the opponent's towers versus the creep's armour
  armorBias: [0, 0], // income sends favour creeps whose armour the opponent's towers handle badly
  bankWatch: [0, 0], // share of the opponent's banked gold the lane must hold (expected push)
  waveTiming: [0, 0], // seconds: a ready push waits this long for the next neutral wave
  killShot: [0, 0], // opponent lives at or below which the bot plans a finishing push
  sendPick: [3, 3], // income sends pick at random among this many of the best (1 = always the best)
};
let aiTuning = AI_DEFAULTS;
/** Self-play hook: override personality ranges for balance and training runs. */
export function tuneAi(values = null) {
  aiTuning = values ? { ...AI_DEFAULTS, ...values } : AI_DEFAULTS;
}
function aiPersonality(game, p) {
  if (p.aiPersona) return p.aiPersona;
  const roll = ([a, b]) => a + (b - a) * random(game);
  // the hard bot rolls inside its own ranges (v0.07m, from hard-vs-hard self-play)
  const ranges = aiTuning === AI_DEFAULTS && AI_STYLE[aiLevel(game, p)]?.ranges ? { ...aiTuning, ...AI_STYLE[aiLevel(game, p)].ranges } : aiTuning;
  p.aiPersona = Object.fromEntries(Object.entries(ranges).map(([k, range]) => [k, roll(range)]));
  p.aiPersona.elementOrder = FACTIONS.map((f) => f.id).sort(() => random(game) - 0.5);
  for (const [k, f] of Object.entries(AI_STYLE[aiLevel(game, p)]?.persona || {})) p.aiPersona[k] *= f;
  return p.aiPersona;
}
const HP_PER_GOLD = new Map();
/** Average creep HP a player buys per gold in a tier (prior for what the opponent will send). */
function hpPerGold(tier) {
  if (!HP_PER_GOLD.has(tier)) {
    const list = tierSends(tier).filter((s) => !s.bossTier && s.cost > 0);
    const ratio = list.reduce((sum, s) => sum + s.spawnIds.reduce((h, id) => h + (obj(id)?.hp || 0), 0) / s.cost, 0) / Math.max(1, list.length);
    HP_PER_GOLD.set(tier, ratio || 1);
  }
  return HP_PER_GOLD.get(tier);
}
/** Path nodes inside a tower's reach (melee: the 8 neighbours, ranged: its range). */
function reachOn(game, item, stats, x, y, size, path) {
  const cu = game.grid.cellUnits,
    centre = { x: (x + size / 2) / game.grid.cols, y: (y + size / 2) / game.grid.rows };
  let n = 0;
  for (const node of path) {
    if (isMeleeTower(item) && size === 1) {
      if (Math.abs(node.gridX - x) <= 1 && Math.abs(node.gridY - y) <= 1) n++;
    } else if (dist(game, centre, node) <= stats.range + cu * 0.15) n++;
  }
  return n;
}
/** Damage one creep takes while it passes this tower once (ground or air). */
function towerPassDamage(game, p, item, x, y, size, path, air = false) {
  if (!item?.attacks || !item.targets.includes(air ? "air" : "ground")) return 0;
  const stats = statsFor(game, p, item),
    dps = stats.damage / Math.max(0.1, stats.cooldown),
    splash = isCannonTower(item) || item.splashFull > 0 || item.splashSmall > 0 ? 1.8 : 1,
    secs = (reachOn(game, item, stats, x, y, size, path) * game.grid.cellUnits) / (240 * movementMultiplier(game));
  return dps * splash * secs;
}
/** Flyers cross straight down the column they spawn in; any column is equally likely. */
const airPathOf = (game) => Array.from({ length: game.grid.rows }, (_, y) => pos(game, Math.floor(game.grid.cols / 2), y));
function airPass(game, p, item, x, y, size) {
  const { cols, rows } = game.grid;
  let sum = 0;
  for (let c = 0; c < cols; c++)
    sum += towerPassDamage(game, p, item, x, y, size, Array.from({ length: rows }, (_, r) => pos(game, c, r)), true);
  return sum / cols;
}
/** Ground kill capacity of the existing towers along a route. */
function groundCapacity(game, p, path) {
  let ground = 0;
  for (const t of p.towers) ground += towerPassDamage(game, p, obj(t.typeId), t.gridX, t.gridY, towerSize(t), path);
  return ground;
}
/**
 * Routes from every portal field (v0.07k). Creeps appear above a random column, so the template
 * bot rates towers by the average of these routes, not only by the shortest one.
 */
function spawnRoutes(game, p, extra = null) {
  const out = [];
  for (let c = 0; c < game.grid.cols; c++) {
    const path = findPath(game, p.id, { x: c, y: -1 }, extra);
    if (path) out.push(path);
  }
  return out.length ? out : [p.path];
}
function routesPass(game, p, item, x, y, size, routes) {
  let sum = 0;
  for (const r of routes) sum += towerPassDamage(game, p, item, x, y, size, r);
  return sum / routes.length;
}
function routesCapacity(game, p, routes) {
  let ground = 0;
  for (const t of p.towers) ground += routesPass(game, p, obj(t.typeId), t.gridX, t.gridY, towerSize(t), routes);
  return ground;
}
/** Kill capacity of a lane: ground along its route(s), air along a straight column. */
function laneCapacity(game, p, path = p.path, routes = null) {
  let ground = 0,
    air = 0;
  for (const t of p.towers) {
    const item = obj(t.typeId),
      size = towerSize(t);
    ground += routes ? routesPass(game, p, item, t.gridX, t.gridY, size, routes) : towerPassDamage(game, p, item, t.gridX, t.gridY, size, path);
    if (item?.targets?.includes("air")) air += airPass(game, p, item, t.gridX, t.gridY, size);
  }
  return { ground, air };
}
/**
 * Tracks what the opponent really sends: HP per income round (moving average) and the biggest
 * recent burst, because towers work through a group one creep at a time.
 */
function observeEnemy(game, p) {
  const seen = (p.aiSeen ||= { hp: 0, air: 0, rate: 0, airRate: 0, burst: 0, airBurst: 0, roundStart: game.tick });
  let fresh = 0,
    freshAir = 0;
  for (const c of p.creeps)
    if (c.owner >= 0 && c.owner !== p.id && !c.aiSeen) {
      c.aiSeen = true;
      if (c.laps) continue;
      seen.hp += c.maxHp;
      fresh += c.flying ? 0 : c.maxHp;
      if (c.flying) {
        seen.air += c.maxHp;
        freshAir += c.maxHp;
      }
    }
  seen.burst = Math.max(seen.burst * 0.97, fresh);
  seen.airBurst = Math.max(seen.airBurst * 0.97, freshAir);
  const roundTicks = Math.round(game.incomeInterval / TICK);
  if (game.tick - seen.roundStart >= roundTicks) {
    seen.rate = seen.rate * 0.55 + seen.hp * 0.45;
    seen.airRate = seen.airRate * 0.55 + seen.air * 0.45;
    seen.hp = 0;
    seen.air = 0;
    seen.roundStart = game.tick;
  }
  return seen;
}
function aiPick(game, p, persona) {
  const pick = p.picks[0],
    score = (o) => {
      // Self-play: storm and arcane win most often for the bot; the order still varies per match.
      if (o.type === "element") return 10 - persona.elementOrder.indexOf(o.id) + (persona.smartElements ? ELEMENT_BONUS[o.id] || 0 : 0);
      if (o.type === "income") return (game.round < 30 ? 6 : 2) * o.amount + random(game);
      if (o.type === "gold") return o.amount / 40 + random(game);
      if (o.type === "lives") return p.lives < 12 ? 9 : 1 + random(game);
      const r = obj(o.id),
        effects = (r?.effects || []).map((e) => e.type);
      return ((effects.some((e) => ["ratt", "rats", "ratx", "ratr"].includes(e)) ? 6 : 4) + random(game) * 2) * (persona.researchBias ?? 1);
    };
  const best =
    aiLevel(game, p) === "veryEasy"
      ? Math.floor(random(game) * pick.options.length)
      : pick.options.map((o, i) => [score(o), i]).sort((a, b) => b[0] - a[0])[0][1];
  command(game, { type: "pick", player: p.id, index: best });
}
/**
 * Maze templates for the 6×9 arena (v0.07k). Found offline: simulated annealing over all tower
 * layouts for the longest average route from a random portal field, then a beam search for the
 * build order with the most route at every step. A needs 20 towers for a 33.8-field route (the
 * old wall maze: 25 towers for 32.5, 20 for 27.5) and every tower in its order lengthens the
 * route. The others reach 32.8–33.5 and keep matches varied; every match also rolls a mirror
 * side. `curve` is the average route after each step of the order.
 */
const MAZE_TEMPLATES = {
  "6x9": [
    // A: 20 towers, route 33.8 (also the best build curve)
    {
      weight: 2,
      order: "4,0 5,0 3,0 2,1 1,2 0,4 1,4 2,4 3,3 4,2 5,8 4,8 3,8 2,7 1,6 3,5 4,6 5,4 0,8 0,0",
      curve: [10.2, 10.5, 11, 11.7, 12.5, 13.5, 14.5, 15.5, 18.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 28.5, 30.5, 32.5, 33.5, 33.8],
    },
    // B: zig-zag ladder, 20 towers, route 32.8 (and its upside-down twin)
    {
      weight: 1,
      order: "4,0 5,0 3,0 2,1 1,2 0,8 1,8 2,8 3,7 4,6 1,3 1,4 2,5 4,5 4,4 3,3 4,2 1,6 5,8 0,0",
      curve: [10.2, 10.5, 11, 11.7, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 17.5, 17.5, 19.5, 21.5, 23.5, 27.5, 29.5, 31.5, 32.5, 32.8],
    },
    {
      weight: 1,
      order: "0,0 1,0 2,0 3,1 4,2 5,8 4,8 3,8 2,7 1,6 2,3 1,4 1,5 4,3 4,4 3,5 1,2 4,6 0,8 5,0",
      curve: [10.2, 10.5, 11, 11.7, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 17.5, 17.5, 19.5, 21.5, 23.5, 27.5, 29.5, 31.5, 32.5, 32.8],
    },
    // C: double ladder, 22 towers, route 33.5
    {
      weight: 1,
      order: "0,0 1,0 2,0 3,1 4,0 5,8 4,8 3,8 2,7 1,8 3,2 5,2 3,3 4,4 2,5 2,6 1,4 1,3 1,2 4,5 0,6 4,6",
      curve: [10.2, 10.5, 11, 11.7, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 17.5, 17.5, 17.5, 19.5, 19.5, 21.5, 23.5, 25.5, 27.5, 29.5, 31.5, 33.5],
    },
    // D: crossbar in the middle, 21 towers, route 33.5
    {
      weight: 1,
      order: "4,3 5,3 3,3 2,4 1,8 0,8 2,8 3,7 4,6 2,5 1,6 4,5 0,0 1,0 2,0 3,1 4,0 1,2 2,3 0,4 5,8",
      curve: [10.2, 10.5, 11, 11.7, 12.5, 12.8, 13.8, 14.8, 15.8, 17.8, 21.5, 23.5, 23.8, 24.5, 25.5, 26.8, 28.5, 28.5, 30.5, 32.5, 33.5],
    },
    // E: a full top wall, then diagonals, 22 towers, route 33.5
    {
      weight: 1,
      order: "0,2 1,2 2,2 3,3 4,2 5,8 4,8 3,8 2,7 1,6 1,4 1,5 3,4 3,5 4,6 5,4 0,8 5,0 4,0 3,0 2,0 1,0",
      curve: [10.2, 10.5, 11, 11.7, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 17.5, 19.5, 21.5, 23.5, 25.5, 27.5, 28.5, 28.8, 29.5, 30.5, 31.8, 33.5],
    },
    // F: offset crossbar, 21 towers, route 33.5
    {
      weight: 1,
      order: "0,3 1,3 2,3 3,4 4,8 5,8 3,8 2,7 1,6 3,5 4,6 1,5 5,0 4,0 3,0 2,1 1,1 4,2 3,3 5,4 0,8",
      curve: [10.2, 10.5, 11, 11.7, 12.5, 12.8, 13.8, 14.8, 15.8, 17.8, 21.5, 23.5, 23.8, 24.5, 25.5, 26.8, 28.5, 28.5, 30.5, 32.5, 33.5],
    },
  ],
};
/** Average route over all portal fields (creeps appear above a random column), optional extra cells. */
function expectedRoute(game, p, extra = null) {
  let sum = 0;
  for (let c = 0; c < game.grid.cols; c++) {
    const path = findPath(game, p.id, { x: c, y: -1 }, extra);
    if (!path) return 0;
    sum += path.length - 1;
  }
  return sum / game.grid.cols;
}
function templatePlan(game, forced = null) {
  const list = MAZE_TEMPLATES[game.grid.cols + "x" + game.grid.rows];
  if (!list) return null;
  let roll = random(game) * list.reduce((s, t) => s + t.weight, 0),
    tpl = list[list.length - 1];
  for (const t of list) if ((roll -= t.weight) < 0) { tpl = t; break; }
  if (forced !== null && list[forced]) tpl = list[forced]; // self-play hook (persona.mazeTpl)
  const mirror = random(game) < 0.5,
    order = tpl.order.split(" ").map((k) => {
      let [x, y] = k.split(",").map(Number);
      if (mirror) x = game.grid.cols - 1 - x;
      return { x, y, key: x + "," + y };
    });
  return { cols: game.grid.cols, rows: game.grid.rows, template: true, order, keys: new Set(order.map((c) => c.key)), curve: tpl.curve, gaps: [], wallOf: {}, cellsOf: [], extra: new Set(), size: order.length };
}
/**
 * The bot's maze. On the arena a template (see above); elsewhere, and for very easy, horizontal
 * walls whose single gap alternates sides, so creeps snake across the whole lane. Each match
 * rolls its template and mirror side, or where the first wall sits and which side its gap is on.
 */
function mazePlan(game, p, level) {
  if (p.aiMaze && p.aiMaze.cols === game.grid.cols && p.aiMaze.rows === game.grid.rows) return p.aiMaze;
  if (level !== "veryEasy" && (p.aiPersona?.mazeV2 ?? 1) > 0.5) {
    const plan = templatePlan(game, p.aiPersona?.mazeTpl ?? null);
    if (plan) return (p.aiMaze = plan);
  }
  const { cols, rows } = game.grid,
    weak = level === "veryEasy",
    spacing = weak ? 3 : 2,
    start = weak ? 2 : random(game) < 0.65 ? 1 : 2,
    rightFirst = random(game) < 0.5,
    walls = [],
    wallOf = {},
    cellsOf = [],
    gaps = [];
  for (let y = start; y <= rows - 2; y += spacing) walls.push(y);
  walls.forEach((y, i) => {
    const gap = (i % 2 === 0) === rightFirst ? cols - 1 : 0;
    gaps.push(gap + "," + y);
    cellsOf.push([]);
    for (let x = 0; x < cols; x++)
      if (x !== gap) {
        wallOf[x + "," + y] = i;
        cellsOf[i].push(x + "," + y);
      }
  });
  // Above the first wall creeps walk the portal strip to its gap, below the last wall they drop
  // straight to the exit: everything there except the gap columns is free for extra towers.
  const extra = new Set(),
    firstGap = Number(gaps[0]?.split(",")[0]),
    lastGap = Number(gaps[gaps.length - 1]?.split(",")[0]);
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < (walls[0] ?? 0); y++) if (x !== firstGap) extra.add(x + "," + y);
    for (let y = (walls[walls.length - 1] ?? rows) + 1; y < rows; y++) if (x !== lastGap) extra.add(x + "," + y);
  }
  return (p.aiMaze = { cols, rows, walls, wallOf, cellsOf, gaps, extra, size: cols - 1 });
}
/**
 * Best place for `item`. Ground value is the capacity the whole lane gains (the new tower plus
 * what a longer route adds to every other tower). Following the maze plan, only wall cells and
 * cells off the route are used; walls already begun are finished first; area damage pays most
 * near the spawn. Weaker levels add noise and stray from the plan.
 */
function takenCells(p) {
  const taken = new Set();
  for (const t of p.towers) {
    const n = towerSize(t);
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) taken.add(t.gridX + dx + "," + (t.gridY + dy));
  }
  return taken;
}
/**
 * Template maze (v0.07k): the next free cells of the build order, in that order, while the
 * template is unfinished; then dead-end cells that leave the average route as long as it is.
 * Plan cells carry the route the template still promises (lookahead over flat steps).
 */
function templateCandidates(game, p, maze, ctx) {
  if (ctx.tplCandidates) return ctx.tplCandidates;
  const taken = takenCells(p),
    open = maze.order.filter((c) => !taken.has(c.key)),
    built = maze.order.length - open.length,
    out = [];
  if (open.length) {
    const before = built ? maze.curve[built - 1] : maze.curve[0] - 0.3;
    let j = built;
    while (j < maze.curve.length - 1 && maze.curve[j] <= before) j++;
    const promise = Math.max(0, (maze.curve[j] - before) / (j - built + 1)) / Math.max(1, before);
    open.slice(0, 3).forEach((c, i) => out.push({ x: c.x, y: c.y, key: c.key, plan: true, rank: i, promise }));
  }
  if (open.length <= 1) {
    const now = ctx.expRoute ?? (ctx.expRoute = expectedRoute(game, p));
    for (let y = 0; y < game.grid.rows; y++)
      for (let x = 0; x < game.grid.cols; x++) {
        const key = x + "," + y;
        if (taken.has(key) || maze.keys.has(key)) continue;
        if (expectedRoute(game, p, [{ x, y }]) + 1e-6 < now) continue;
        out.push({ x, y, key, plan: false, rank: 0, promise: 0 });
      }
  }
  return (ctx.tplCandidates = out);
}
function templateSpot(game, p, item, persona, air, ctx) {
  const maze = ctx.maze,
    capNow = ctx.cap ? ctx.cap.ground : routesCapacity(game, p, spawnRoutes(game, p)),
    routeCache = (ctx.routeCache ||= new Map());
  let best = null;
  for (const c of templateCandidates(game, p, maze, ctx)) {
    const preview = previewBuild(game, p.id, c.x, c.y, item.id);
    if (!preview.ok || !preview.path) continue;
    let value;
    if (air) value = airPass(game, p, item, c.x, c.y, 1);
    else {
      if (!routeCache.has(c.key)) routeCache.set(c.key, spawnRoutes(game, p, [{ x: c.x, y: c.y }]));
      const routes = routeCache.get(c.key),
        own = routesPass(game, p, item, c.x, c.y, 1, routes);
      let others = ctx.cellCache?.get(c.key);
      if (others === undefined) {
        others = routesCapacity(game, p, routes);
        ctx.cellCache?.set(c.key, others);
      }
      // the route a plan tower still promises is worth a share of the lane, even before
      // the first tower stands
      value = Math.max(own * 0.25, own + others - capNow) + (persona.mazeValue ?? 1) * Math.max(capNow, ctx.need || 0) * c.promise;
      if (value <= 0) continue;
      if (isCannonTower(item)) value *= persona.splash * (1 + 0.6 * (1 - c.y / game.grid.rows));
    }
    if (value <= 0) continue;
    value *= Math.max(0, 1 - (persona.mazeRank ?? 0.15) * c.rank); // keep to the build order
    if (value <= 0) continue;
    if (ctx.noise) value *= 1 + ctx.noise * (random(game) - 0.5) * 2;
    if (!best || value > best.value) best = { x: c.x, y: c.y, value, plan: c.plan };
  }
  return best;
}
function bestSpot(game, p, item, persona, air = false, ctx = {}) {
  const { cols, rows } = game.grid,
    size = footprintOf(item.id),
    maze = ctx.maze || null;
  if (maze?.template && size === 1 && ctx.strict) return templateSpot(game, p, item, persona, air, ctx);
  if (maze?.template && size > 1 && ctx.strict) return null; // halls do not fit the template
  const capNow = ctx.cap && !maze?.template ? ctx.cap.ground : groundCapacity(game, p, p.path),
    gaps = new Set(maze ? maze.gaps : []),
    taken = new Set();
  for (const t of p.towers) {
    const n = towerSize(t);
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) taken.add(t.gridX + dx + "," + (t.gridY + dy));
  }
  const scan = (restrict) => {
    let best = null;
    for (let y = 0; y <= rows - size; y++)
      for (let x = 0; x <= cols - size; x++) {
        const key = x + "," + y,
          wall = maze && size === 1 ? maze.wallOf[key] : undefined;
        if (gaps.has(key)) continue; // the gaps are the maze; never close one
        if (restrict && wall === undefined && !maze.extra.has(key)) continue;
        const preview = previewBuild(game, p.id, x, y, item.id);
        if (!preview.ok || !preview.path) continue;
        let value,
          filled = 0;
        if (wall !== undefined) filled = maze.cellsOf[wall].filter((k) => taken.has(k)).length;
        if (air) value = airPass(game, p, item, x, y, size);
        else {
          const own = towerPassDamage(game, p, item, x, y, size, preview.path);
          // never a tower that cannot reach the route, unless it closes a maze wall: once the
          // wall stands, creeps walk along it
          if (own <= 0 && wall === undefined) continue;
          let others = size === 1 ? ctx.cellCache?.get(key) : undefined;
          if (others === undefined) {
            others = groundCapacity(game, p, preview.path);
            if (size === 1) ctx.cellCache?.set(key, others);
          }
          value = Math.max(own * 0.25, own + others - capNow);
          // a finished wall adds about a lane width to the route; share that among its gaps
          if (wall !== undefined) value += (0.8 * capNow * (cols / Math.max(cols, p.path.length))) / Math.max(1, maze.size - filled);
        }
        if (value <= 0) continue;
        if (isCannonTower(item)) value *= persona.splash * (1 + 0.6 * (1 - y / rows)); // area damage pays near the spawn
        if (wall !== undefined) value *= 1 + 0.6 * (filled / maze.size) + 0.1 * (maze.walls.length - wall);
        if (maze?.template && maze.keys.has(key)) value *= 1.6;
        if (ctx.noise) value *= 1 + ctx.noise * (random(game) - 0.5) * 2;
        if (!best || value > best.value) best = { x, y, value };
      }
    return best;
  };
  // Following the plan, a finished maze means upgrades instead of new towers.
  return ctx.strict && maze ? scan(true) : scan(false);
}
/** Upgrades and new towers that add kill capacity, best value per gold first. */
function defenceOptions(game, p, persona, level, style, cap, wantAir, onlyBuild = false, need = 0) {
  const options = [],
    maze = mazePlan(game, p, level),
    routes = maze.template ? cap.routes || spawnRoutes(game, p) : null,
    pass = (item, t) => (routes ? routesPass(game, p, item, t.gridX, t.gridY, towerSize(t), routes) : towerPassDamage(game, p, item, t.gridX, t.gridY, towerSize(t), p.path));
  // upgrades of existing towers: capacity gained per gold
  if (!onlyBuild)
    for (const t of p.towers)
      for (const id of obj(t.typeId).upgrades) {
        const item = obj(id);
        if (!item?.attacks || !available(game, p.id, "upgrade", id, t.id).ok) continue;
        if (wantAir ? !item.targets.includes("air") : !item.targets.includes("ground")) continue;
        const before = wantAir ? airPass(game, p, obj(t.typeId), t.gridX, t.gridY, towerSize(t)) : pass(obj(t.typeId), t),
          after = wantAir ? airPass(game, p, item, t.gridX, t.gridY, towerSize(t)) : pass(item, t);
        const gain = (after - before) * persona.upgradeBias;
        if (gain > 0) options.push({ value: gain / item.cost, cost: item.cost, run: () => command(game, { type: "upgrade", player: p.id, id, towerId: t.id }) });
      }
  // new towers on the best spot, following the maze plan
  const ctx = { maze, strict: random(game) < style.strict, noise: style.noise, cap, need, cellCache: new Map() };
  for (const item of getCatalog().towers) {
    if (!item.isRoot || !item.attacks || !item.playable) continue;
    if (wantAir ? !item.targets.includes("air") : !item.targets.includes("ground")) continue;
    if (!available(game, p.id, "build", item.id).ok && !(p.gold < item.cost && available(game, p.id, "build", item.id).reason?.includes("more gold"))) continue;
    const spot = bestSpot(game, p, item, persona, wantAir, ctx);
    if (spot) options.push({ value: spot.value / item.cost, cost: item.cost, plan: spot.plan, run: () => command(game, { type: "build", player: p.id, id: item.id, gridX: spot.x, gridY: spot.y }) });
  }
  return options.sort((a, b) => b.value - a.value);
}
function think(game, p) {
  if (game.tick < p.nextAiTick) return;
  const level = aiLevel(game, p),
    interval = { veryEasy: 60, easy: 40, normal: 20, hard: 10 }[level] || 20,
    style = AI_STYLE[level] || AI_STYLE.normal;
  p.nextAiTick = game.tick + interval;
  const persona = aiPersonality(game, p),
    enemy = targetOf(game, p.id), // the player this bot sends to
    attackers = attackersOf(game, p.id), // the players sending into this bot's lane
    seen = observeEnemy(game, p);
  while (p.picks.length) aiPick(game, p, persona);
  // v0.09q: Arrow Volley where the most creeps stand, or on a creep about to break through
  if (perkLevel(p, "volley") && !(p.volleyReady > game.time) && p.creeps.length) {
    const r = VOLLEY.radius * game.grid.cellUnits,
      live = p.creeps.filter((c) => !c.dead && c.hp > 0 && c.owner !== p.id);
    let best = null;
    for (const c of live) {
      const n = live.filter((o) => dist(game, c, o) <= r).length;
      if (!best || n > best.n) best = { c, n };
    }
    if (best && (best.n >= 4 || best.c.progress > 0.75)) command(game, { type: "volley", player: p.id, x: best.c.x, y: best.c.y });
  }
  // ---- how much defence is needed right now
  // Need: the biggest group the opponent sends (towers chew through a group creep by creep),
  // a share of their whole round, the next neutral wave when it is close, and fresh leaks.
  const safety = (AI_SAFETY[level] || 1.2) * (persona.caution ?? 1),
    wave = waveDefense(game, p),
    waveSoon = game.waves && wave.total && wave.seconds < 25,
    prior = game.round < 4 ? attackers.reduce((sum, a) => sum + a.income * hpPerGold(a.tier), 0) * 0.35 : 0,
    // v0.07l: gold the opponent banks is a push in the making (a human watches that number)
    bank = (persona.bankWatch ?? 0) > 0 && !game.warmup ? attackers.reduce((sum, a) => sum + a.gold * hpPerGold(a.tier), 0) * persona.bankWatch : 0,
    groundNeed =
      Math.max(seen.burst, (seen.rate - seen.airRate) * (persona.rateShare ?? 0.33), prior, bank, waveSoon ? wave.total * (1 - wave.flyingShare) * (persona.waveShare ?? 0.62) : 0) * safety,
    airNeed = Math.max(seen.airBurst, seen.airRate * (persona.rateShare ?? 0.33), waveSoon ? wave.total * wave.flyingShare * (persona.waveShare ?? 0.62) : 0) * safety,
    planNow = mazePlan(game, p, level),
    routesNow = planNow.template ? spawnRoutes(game, p) : null,
    cap = { ...laneCapacity(game, p, p.path, routesNow), routes: routesNow },
    pressure = p.creeps.filter((c) => c.owner !== p.id && c.progress > 0.6).reduce((s, c) => s + c.hp, 0),
    lost = (p.aiLives ?? p.lives) > p.lives;
  p.aiLives = p.lives;
  if (lost) p.aiAlarm = game.tick + Math.round(20 / TICK);
  const alarm = (p.aiAlarm || 0) > game.tick;
  const groundGap = groundNeed - cap.ground + (alarm ? pressure + 40 : 0),
    airGap = airNeed - cap.air,
    // a turtling bot keeps spending on defence it does not need yet
    defend = groundGap > 0 || airGap > 0 || random(game) < (style.turtle || 0);
  p.aiDebug = { round: game.round, rate: Math.round(seen.rate), burst: Math.round(seen.burst), airBurst: Math.round(seen.airBurst), wave: waveSoon ? Math.round(wave.total) : 0, capG: Math.round(cap.ground), capA: Math.round(cap.air), gapG: Math.round(groundGap), gapA: Math.round(airGap), alarm };
  if (defend) {
    const wantAir = airGap > 0 && airGap >= groundGap;
    const options = defenceOptions(game, p, persona, level, style, cap, wantAir, false, wantAir ? airNeed : groundNeed);
    const choice = options[0];
    if (choice && p.gold >= choice.cost) {
      if (choice.run().ok) return;
    }
    // can't afford the best fix yet: save, unless the shortfall is small
    if (choice && groundGap + airGap > 40) return;
  }
  // ---- economy: income sends, saved-up pushes, the tier boss, EXP generators
  if (game.warmup) return;
  const sends = tierSends(p.tier).filter((s) => available(game, p.id, "send", s.id).ok),
    reserve = p.income * (0.4 / persona.greed);
  if (p.aiPush) {
    const plan = p.aiPush,
      item = obj(plan.id);
    if (game.round > plan.until || !item) p.aiPush = null;
    else if (plan.smart && !plan.sending && p.gold >= item.cost * plan.left) {
      // v0.07l: with a neutral wave close, launch together with it: their towers are busy then
      const next = (persona.waveTiming ?? 0) > 0 ? nextWave(game) : null;
      if (next && next.seconds > 0.6 && next.seconds < persona.waveTiming && game.round < plan.until - 1) return;
      // Gold is ready: check the opponent again before committing.
      const now = breakthroughPlan(game, p, enemy, persona, plan.id);
      if (now && p.gold >= item.cost * now.left) {
        plan.left = now.left;
        plan.sending = true;
      } else p.aiPush = null;
      return;
    } else if (p.gold >= item.cost * plan.left || plan.sending) {
      plan.sending = true;
      for (let i = 0; i < 4 && plan.left > 0; i++) {
        if (!command(game, { type: "send", player: p.id, id: plan.id }).ok) break;
        plan.left--;
      }
      if (plan.left <= 0) p.aiPush = null;
      return;
    } else return; // saving
  }
  const boss = sends.find((s) => s.bossTier);
  if (boss && game.round >= persona.bossRound * p.tier && p.gold >= boss.cost + p.income) {
    command(game, { type: "send", player: p.id, id: boss.id });
    return;
  }
  if (game.round >= 8 && !p.towers.some((t) => obj(t.typeId)?.support === "lumber") && random(game) < persona.expGen * 0.1) {
    const gen = obj("h01F"),
      maze = mazePlan(game, p, aiLevel(game, p));
    if (gen && p.gold >= gen.cost + reserve && maze.template) {
      // a generator is a maze piece too: a dead end if there is one, else the plan cell the
      // route touches least
      const near = (c) => p.path.filter((n) => Math.abs(n.gridX - c.x) <= 1 && Math.abs(n.gridY - c.y) <= 1).length;
      const spots = templateCandidates(game, p, maze, {}).sort((a, b) => Number(a.plan) - Number(b.plan) || near(a) - near(b));
      for (const c of spots) if (previewBuild(game, p.id, c.x, c.y, gen.id).ok && command(game, { type: "build", player: p.id, id: gen.id, gridX: c.x, gridY: c.y }).ok) return;
    } else if (gen && p.gold >= gen.cost + reserve) {
      for (let y = game.grid.rows - 1; y >= 0; y--)
        for (const x of [0, game.grid.cols - 1]) {
          const pv = previewBuild(game, p.id, x, y, gen.id);
          if (pv.ok && pv.path?.length >= p.path.length && command(game, { type: "build", player: p.id, id: gen.id, gridX: x, gridY: y }).ok) return;
        }
    }
  }
  // Maze rush: with spare gold, lay the next template tower before it is needed.
  if ((persona.mazeRush ?? 0) > 0 && random(game) < persona.mazeRush) {
    const maze = mazePlan(game, p, level);
    if (maze.template && maze.order.some((c) => !towerAt(p, c.x, c.y))) {
      const opt = defenceOptions(game, p, persona, level, style, cap, false, true, groundNeed).find((o) => o.plan);
      if (opt && p.gold - opt.cost >= reserve && opt.run().ok) return;
    }
  }
  // v0.07l: a low opponent gets a finishing push as soon as one can break through
  if (!p.aiPush && (persona.killShot ?? 0) > 0 && enemy.lives <= persona.killShot && game.round >= 4) {
    const plan = breakthroughPlan(game, p, enemy, persona);
    if (plan) {
      p.aiPush = plan;
      return;
    }
  }
  // A push: saved-up gold for one wave big enough to break through. The smart planner sizes it
  // against the opponent's real kill capacity (flyers win when their anti-air is thin); the
  // legacy planner just buys the toughest creep per gold.
  if (!p.aiPush && game.round >= (persona.smartPush ? 4 : 6) && random(game) < persona.push * 0.12) {
    const plan = persona.smartPush ? breakthroughPlan(game, p, enemy, persona) : legacyPushPlan(game, p, enemy, persona);
    if (plan) {
      p.aiPush = plan;
      return;
    }
  }
  // Income sends: best income per gold first, a few per decision when gold piles up. Against
  // thin anti-air, flyers rank higher: they pay income and break through at the same time.
  const burst = Math.min(style.maxSends || 3, p.gold > p.income * 2 ? 3 : 1),
    flyerBias = (persona.flyerBias ?? 1) > 1 && weakAirOf(game, p, enemy, persona) ? persona.flyerBias : 1,
    pool = tierSends(p.tier).filter((s) => !s.bossTier && s.income > 0),
    tough = (s) => ((persona.armorBias ?? 0) > 0 ? toughnessOf(game, p, enemy, pool, s) ** persona.armorBias : 1),
    worth = (s) => (s.income / s.cost) * (s.flying ? flyerBias : 1) * tough(s);
  for (let k = 0; k < burst; k++) {
    const economical = pool.filter((s) => available(game, p.id, "send", s.id).ok).sort((a, b) => worth(b) - worth(a));
    if (!economical.length) return;
    const chosen = economical[Math.floor(random(game) * Math.min(Math.max(1, Math.floor(persona.sendPick ?? 3)), economical.length))];
    if (p.gold - chosen.cost < reserve || !command(game, { type: "send", player: p.id, id: chosen.id }).ok) return;
  }
}
const hpOf = (s) => s.spawnIds.reduce((h, id) => h + (obj(id)?.hp || 0), 0);
/**
 * The opponent's kill capacity against one armour (v0.07l): pass damage of each tower times its
 * attack type against that armour type and value. Cached for a few seconds per bot.
 */
function capacityVs(game, p, enemy, s) {
  const unit = obj(s.spawnIds[0]) || s,
    key = (s.flying ? "a:" : "g:") + (unit.defenseType || "medium") + ":" + (unit.armor || 0);
  if (!p.aiArmorCache || game.tick - p.aiArmorCache.tick > 100) p.aiArmorCache = { tick: game.tick, map: new Map() };
  const map = p.aiArmorCache.map;
  if (!map.has(key)) {
    let sum = 0;
    for (const t of enemy.towers) {
      const item = obj(t.typeId);
      if (!item?.attacks) continue;
      const pass = s.flying ? airPass(game, enemy, item, t.gridX, t.gridY, towerSize(t)) : towerPassDamage(game, enemy, item, t.gridX, t.gridY, towerSize(t), enemy.path);
      sum += pass * damageMultiplier(item.attackType, unit.defenseType || "medium", unit.armor || 0);
    }
    map.set(key, sum);
  }
  return map.get(key);
}
/** How much tougher a send is against the opponent's towers than the average send of its tier. */
function toughnessOf(game, p, enemy, list, s) {
  const caps = list.map((x) => capacityVs(game, p, enemy, x)),
    mean = caps.reduce((a, b) => a + b, 0) / Math.max(1, caps.length);
  return clamp(mean / Math.max(1, capacityVs(game, p, enemy, s)), 0.5, 3);
}
const ELEMENT_BONUS = { storm: 2.5, arcane: 1.8, plague: 0.8 };
/** Is the opponent's anti-air thin? Re-checked every few seconds (it scans every flyer column). */
function weakAirOf(game, p, enemy, persona) {
  if (!p.aiAirCheck || game.tick - p.aiAirCheck.tick > 100) {
    const theirs = laneCapacity(game, enemy);
    p.aiAirCheck = { tick: game.tick, weak: theirs.air < theirs.ground * (persona.airThreshold ?? 0.25) };
  }
  return p.aiAirCheck.weak;
}
function legacyPushPlan(game, p, enemy, persona) {
  const theirs = laneCapacity(game, enemy),
    flyers = tierSends(p.tier).filter((s) => s.flying && !s.bossTier && s.income >= 0),
    weakAir = theirs.air < theirs.ground * (persona.airThreshold ?? 0.25);
  const pool = weakAir && flyers.length ? flyers : tierSends(p.tier).filter((s) => !s.bossTier);
  const pickSend = pool.sort((a, b) => hpOf(b) / b.cost - hpOf(a) / a.cost)[0];
  if (!pickSend) return null;
  const count = Math.max(3, Math.min(14, Math.floor((p.income * (persona.pushSize ?? 3)) / Math.max(1, pickSend.cost))));
  return { id: pickSend.id, left: count, until: game.round + 6 };
}
/**
 * The cheapest wave that should break through the opponent's lane: enough creep HP in one go
 * to beat their kill capacity (air capacity for flyers) with a margin, within what the stock
 * and a few rounds of income allow. Income the creeps bring back makes a send cheaper.
 */
function breakthroughPlan(game, p, enemy, persona, onlyId = null) {
  const theirs = laneCapacity(game, enemy),
    rounds = persona.pushSize ?? 3,
    budget = p.gold + p.income * rounds;
  let best = null;
  for (const s of tierSends(p.tier)) {
    if (s.bossTier || !s.playable || s.cost <= 0 || (onlyId && s.id !== onlyId)) continue;
    const stock = p.stock[s.id];
    if (!stock) continue;
    const hp = hpOf(s),
      cap = persona.armorAware ? capacityVs(game, p, enemy, s) : s.flying ? theirs.air : theirs.ground,
      n = Math.max(2, Math.ceil((cap * (persona.pushMargin ?? 1.35) + 1) / Math.max(1, hp))),
      reachable = Math.min(stockMaxOf(p, s), stock.count + Math.floor((rounds * game.incomeInterval) / Math.max(0.5, s.stockRegen || 1)));
    if (n > reachable || n * s.cost > budget) continue;
    const price = n * (s.cost - s.income * 2);
    if (!best || price < best.price) best = { id: s.id, left: n, price };
  }
  return best && { id: best.id, left: best.left, until: game.round + Math.ceil(rounds) + 2, smart: true };
}

// ---- Neutral waves (mobile addition; the Felito map itself has none) -----------------
/**
 * Classic WC3 tower-defense style waves that run in both lanes at once, on top
 * of player and AI sends. Every wave has one trait; every tenth is a boss.
 * Models reuse catalog units for art only; stats come from the wave formula.
 */
export const WAVE_IMMUNE_FACTOR = 0.15;
export const WAVE_EVERY_ROUNDS = 2;
export const WAVE_FIRST_ROUND = 3;
/**
 * Total wave HP follows the typical economy of a match (headless AI games):
 * total(n) = base + scale * n^2 * growth^n. Wave 10 is about 640 HP in total,
 * wave 20 about 4k, wave 30 about 15k, wave 40 about 47k. Tuned so the training
 * bots survive into the high twenties when they balance defence and sends.
 */
const WAVE_CURVE = { base: 40, scale: 3.5, growth: 1.055 };
/** Test hook for balance simulations. */
export function tuneWaves(values = {}) {
  Object.assign(WAVE_CURVE, values);
}
export function waveTotalHp(number) {
  return WAVE_CURVE.base + WAVE_CURVE.scale * number * number * Math.pow(WAVE_CURVE.growth, number);
}
export function waveRound(number) {
  return WAVE_FIRST_ROUND + (number - 1) * WAVE_EVERY_ROUNDS;
}
export const WAVE_TYPES = Object.freeze({
  normal: { label: "Normal", tip: "A balanced wave.", count: 10, hp: 1, speed: 1, bounty: 1 },
  swarm: { label: "Swarm", tip: "Many weak foes. Splash damage helps.", count: 18, hp: 0.42, speed: 1.05, bounty: 0.5 },
  fast: { label: "Fast", tip: "They rush through. Slow them or build a long path.", count: 10, hp: 0.7, speed: 1.65, bounty: 1 },
  armored: { label: "Armored", tip: "High armor. Magic and siege work well.", count: 8, hp: 1.15, speed: 0.85, armor: 6, defense: "large", bounty: 1.3 },
  air: { label: "Flyers", tip: "They fly over the path. Only anti-air hits them.", count: 8, hp: 0.55, speed: 0.8, flying: true, bounty: 1.2 },
  regen: { label: "Regeneration", tip: "They heal. Focused damage needed.", count: 9, hp: 0.95, speed: 1, regen: 0.03, bounty: 1.1 },
  immune: { label: "Magic immune", tip: "Magic barely works. Arrows and cannons!", count: 8, hp: 1, speed: 0.95, immune: true, bounty: 1.2 },
  split: { label: "Splitting", tip: "They split into two smaller ones on death.", count: 7, hp: 0.85, speed: 0.95, split: 2, bounty: 0.8 },
  mixed: { label: "Mixed", tip: "Ground and air at once.", count: 12, hp: 0.7, speed: 0.9, mixed: true, bounty: 1 },
  boss: { label: "Boss", tip: "A giant foe. A breakthrough costs 3 lives.", count: 1, hp: 12, speed: 0.72, armor: 8, defense: "hero", boss: true, bounty: 20, leak: 3 },
});
const WAVE_ORDER = ["normal", "swarm", "fast", "armored", "air", "regen", "immune", "split", "mixed", "boss"];
/** Visual models per tier band (10 waves each). */
const WAVE_MODELS = [
  { normal: "n00M", swarm: "n00L", fast: "n007", armored: "n00Q", air: "n00P", regen: "n00K", immune: "n00N", split: "n00R", boss: "n00T" },
  { normal: "n010", swarm: "n00U", fast: "n00W", armored: "n011", air: "n00V", regen: "n00Y", immune: "n002", split: "n02V", boss: "n015" },
  { normal: "n00O", swarm: "n016", fast: "n01C", armored: "n018", air: "n019", regen: "n01G", immune: "n01A", split: "n03A", boss: "n01H" },
  { normal: "n02L", swarm: "n013", fast: "n02L", armored: "n02M", air: "n01L", regen: "n039", immune: "n01R", split: "n02E", boss: "n01T" },
  { normal: "n01Y", swarm: "n01S", fast: "n02J", armored: "n02I", air: "n025", regen: "n023", immune: "n02P", split: "n02E", boss: "n02R" },
];
export function waveInfo(number) {
  const type = WAVE_ORDER[(number - 1) % WAVE_ORDER.length],
    spec = WAVE_TYPES[type],
    count = spec.count + (spec.boss ? 0 : Math.min(6, Math.floor(number / 10)));
  // spec.hp is relative to a ten-creep normal wave; extra creeps split the same total.
  const perCreep = (waveTotalHp(number) / 10) * spec.hp * (spec.count / count);
  return {
    number,
    type,
    label: spec.label,
    tip: spec.tip,
    count,
    hp: Math.max(4, Math.round(perCreep)),
    armor: Math.floor(number / 4) + (spec.armor || 0),
    bounty: Math.max(1, Math.round((1 + number * 0.55) * spec.bounty)),
    boss: !!spec.boss,
    flying: !!spec.flying,
    mixed: !!spec.mixed,
    round: waveRound(number),
  };
}
export function nextWave(game) {
  if (!game.waves) return null;
  let number = 1;
  while (waveRound(number) <= game.round) number++;
  const inRounds = waveRound(number) - game.round;
  return { ...waveInfo(number), seconds: game.incomeRemaining + (inRounds - 1) * game.incomeInterval };
}
function launchWave(game, number) {
  const info = waveInfo(number),
    spec = WAVE_TYPES[info.type],
    band = WAVE_MODELS[Math.min(WAVE_MODELS.length - 1, Math.floor((number - 1) / 10))];
  game.wave = number;
  emit(game, "wave", { wave: number, kind: info.type, label: info.label, tip: info.tip, boss: info.boss, flying: info.flying, mixed: info.mixed });
  for (let i = 0; i < info.count; i++) {
    const flying = spec.flying || (spec.mixed && i % 2 === 1);
    const model = spec.mixed ? (flying ? band.air : band.normal) : band[info.type];
    for (const defender of game.players.filter((q) => !q.out))
      game.waveQueue.push({ time: game.time + 0.55 * i * (spec.boss ? 1 : spec.count > 12 ? 0.6 : 1), defender: defender.id, number, type: info.type, model, flying, index: i });
  }
}
function spawnWaveCreep(game, entry, at = null, hpScale = 1, child = false) {
  const info = waveInfo(entry.number),
    spec = WAVE_TYPES[entry.type],
    item = obj(entry.model);
  if (!item) return null;
  const target = game.players[entry.defender];
  if (!target || target.out) return null;
  const column = at ? gridAt(game, at).x : spawnColumn(game),
    position = at || pos(game, column, -1),
    speed = 240 * (spec.speed || 1) * movementMultiplier(game),
    hp = info.hp * hpScale;
  const creep = {
    id: "w" + game.nextId++,
    typeId: entry.model,
    name: item.shortName,
    owner: -1,
    defender: target.id,
    wave: entry.number,
    waveType: entry.type,
    waveBoss: !!spec.boss,
    x: position.x,
    y: position.y,
    hp,
    maxHp: hp,
    armor: info.armor,
    speed: speed * (0.92 + random(game) * 0.16),
    baseSpeed: speed,
    regen: spec.regen ? hp * spec.regen : 0,
    flying: !!entry.flying,
    immune: !!spec.immune,
    split: child ? 0 : spec.split || 0,
    bounty: child ? Math.max(1, Math.round(info.bounty * 0.4)) : info.bounty,
    leakLives: spec.leak || 1,
    defenseType: spec.defense || (entry.flying ? "small" : "medium"),
    path: entry.flying ? [position, pos(game, column, game.grid.rows)] : findPath(game, target.id, gridAt(game, position)) || [],
    pathIndex: 0,
    statuses: [],
    cooldown: 0,
    progress: 0,
    maxProgress: 0,
    crossed: 0,
    laps: 0,
    bornTick: game.tick,
    dead: false,
  };
  target.creeps.push(creep);
  return creep;
}
function waveDeath(game, p, c) {
  if (!c.split) return;
  for (let i = 0; i < c.split; i++) {
    const child = spawnWaveCreep(
      game,
      { number: c.wave, type: c.waveType, model: c.typeId, defender: p.id, flying: c.flying },
      { x: c.x + (i ? 0.02 : -0.02), y: c.y },
      0.38,
      true,
    );
    if (!child) continue;
    child.summoned = true;
    // Children continue along the parent's remaining route.
    if (!c.flying && c.path.length) child.path = c.path.slice(c.pathIndex).map((n) => ({ ...n }));
    child.pathIndex = 0;
    child.prevNode = behindOf(c);
  }
}
function waveTouchdown(game, p, c) {
  p.lives = Math.max(0, p.lives - c.leakLives);
  p.stats.waveLeaks = (p.stats.waveLeaks || 0) + 1;
  c.dead = true;
  emit(game, "leak", { player: p.id, owner: -1, creepId: c.id, lives: p.lives, x: c.x, y: c.y, wave: c.wave, amount: c.leakLives });
  if (p.lives <= 0) defeat(game, p);
}

function fixedTick(game) {
  game.tick++;
  game.time = game.tick * TICK;
  game.incomeRemaining -= TICK;
  if (game.incomeRemaining <= EPS) incomeTick(game);
  tickVolleys(game); // v0.09q
  const pending = game.pendingSpawns.filter((s) => s.time <= game.time + EPS);
  game.pendingSpawns = game.pendingSpawns.filter((s) => s.time > game.time + EPS);
  for (const s of pending) {
    const c = spawnCreep(game, s.owner, s.id, s, s.lane ?? null);
    if (c) {
      c.hp = c.maxHp * s.health;
      c.summoned = true;
      if (s.speedDelta) c.speed = Math.max(1, c.speed + s.speedDelta * movementMultiplier(game));
    }
  }
  game.clouds ||= [];
  if (game.waveQueue?.length) {
    const due = game.waveQueue.filter((w) => w.time <= game.time + EPS);
    if (due.length) {
      game.waveQueue = game.waveQueue.filter((w) => w.time > game.time + EPS);
      for (const w of due) spawnWaveCreep(game, w);
    }
  }
  for (const p of game.players) {
    if (p.out) continue;
    for (const [id, stock] of Object.entries(p.stock)) {
      const item = obj(id);
      if (item.tier !== p.tier || stock.count >= stockMaxOf(p, item)) continue;
      if (game.time + EPS >= stock.next) {
        stock.count++;
        stock.next = game.time + Math.max(TICK, stockRegenOf(p, item));
      }
    }
    crowdControl(game, p); // v0.10l
    for (const q of p.researchQueue) {
      q.remaining -= TICK;
      if (q.remaining <= EPS) finishResearch(game, p, q.id);
    }
    p.researchQueue = p.researchQueue.filter((q) => q.remaining > EPS);
    const manaAuras = [];
    for (const t of p.towers)
      if (!(t.buildRemaining > 0)) for (const sk of towerSkills(p, t)) if (sk.type === "manaAura") manaAuras.push({ t, sk });
    for (const t of p.towers) {
      if (t.buildRemaining > 0) {
        t.buildRemaining = Math.max(0, t.buildRemaining - TICK);
        if (t.buildRemaining <= EPS) completeTower(game, p, t);
        continue;
      }
      if (!t.completed) completeTower(game, p, t);
      const item = obj(t.typeId),
        stats = statsFor(game, p, item);
      t.hp = Math.min(t.maxHp, t.hp + stats.regen * TICK);
      const manaBonus = Math.max(0, ...manaAuras.filter((m) => dist(game, m.t, t) <= m.sk.radius).map((m) => m.sk.regen));
      const regen = isMagicTower(item) ? stats.mana / MAGIC_CHARGE_SECONDS : item.manaRegen;
      t.mana = Math.min(stats.mana, t.mana + (regen + manaBonus) * TICK);
      attack(game, p, t, TICK);
      tickAreaDamage(game, p, t, towerSkills(p, t));
    }
    tickClouds(game, p);
    // BOSS T2 Clockwork: every 8.25 s a Siege Golem with 50 mana calls two clockwork escorts.
    const clockwork = Math.floor(game.time / 8.25) !== Math.floor((game.time - TICK) / 8.25);
    for (const c of p.creeps) {
      if (c.mana !== undefined) c.mana = Math.min(obj(c.typeId).mana, c.mana + (obj(c.typeId).manaRegen || 0) * TICK);
      if (clockwork && c.typeId === "n015" && !c.dead && c.mana >= 50 && obj("n01W")) {
        c.mana -= 50;
        for (let i = 0; i < 2; i++) game.pendingSpawns.push({ owner: c.owner, lane: p.id, id: "n01W", time: game.time + 0.1 * (i + 1), x: c.x, y: c.y, health: 1 });
      }
    }
    for (const c of p.creeps) {
      if (c.moveTo != null) continue; // already left for the next lane this tick
      moveCreep(game, p, c, TICK);
      if (!game.running) break;
    }
    // v0.09b: leaked creeps move on to the next player's lane
    const moving = p.creeps.filter((c) => !c.dead && c.moveTo != null);
    p.creeps = p.creeps.filter((c) => !c.dead && c.moveTo == null);
    for (const c of moving) {
      const q = game.players[c.moveTo];
      delete c.moveTo;
      if (q && !q.out) q.creeps.push(c);
    }
    if (!game.running) break;
    // v0.08b: auto-spawn uses the creep's current price (no fixed table) and pauses while
    // the player waits for gold for queued pre-builds or upgrades
    if (p.autoSend && p.autoSendActive !== false && !p.autoHold && game.tick % 5 === 0 && p.gold >= (obj(p.autoSend)?.cost ?? Infinity))
      command(game, { type: "send", player: p.id, id: p.autoSend, auto: true });
    if (p.ai) think(game, p);
  }
  game.effects = game.events.filter(
    (e) => game.time - e.time < 0.35 && ["shot", "kill", "leak", "build"].includes(e.type),
  );
}
export function step(game, dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new TypeError("dt must be a finite, positive number of seconds.");
  if (!game.running || game.paused) return game;
  game.accumulator += dt;
  while (game.accumulator + EPS >= TICK && game.running) {
    game.accumulator -= TICK;
    if (Math.abs(game.accumulator) < EPS) game.accumulator = 0;
    fixedTick(game);
  }
  return game;
}
export function serializeGame(game) {
  return JSON.stringify(game);
}
export function restoreGame(serialized) {
  const game = typeof serialized === "string" ? JSON.parse(serialized) : structuredClone(serialized);
  if (!isCompatibleGameGrid(game)) {
    const error = new Error(
      "This save belongs to another game version or board size. Its positions can't be used as they are.",
    );
    error.code = "incompatible-save";
    throw error;
  }
  if (
    !Array.isArray(game.players) ||
    ![2, 4].includes(game.players.length) ||
    !Number.isFinite(game.rng) ||
    !game.achievements ||
    ["events", "effects", "commands", "pendingSpawns"].some((key) => !Array.isArray(game[key])) ||
    game.players.some(
      (p, id) =>
        !p ||
        p.id !== id ||
        !Number.isFinite(p.paybackRemaining) ||
        !Number.isFinite(p.elementsPurchased) ||
        ["towers", "creeps", "path", "researchQueue"].some((key) => !Array.isArray(p[key])),
    )
  )
    throw new Error("Invalid save");
  for (const p of game.players) {
    const occupied = new Set();
    for (const tower of p.towers) {
      // Saves from before 2×2 halls keep their towers on one field.
      if (!tower.size) tower.size = 1;
      const { gridX: x, gridY: y } = tower,
        n = tower.size,
        expected = { x: (x + n / 2) / game.grid.cols, y: (y + n / 2) / game.grid.rows },
        keys = towerCells(tower).map((c) => square(game, c.x, c.y));
      if (
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        ![1, 2].includes(n) ||
        x < 0 ||
        x + n - 1 >= game.grid.cols ||
        y < 0 ||
        y + n - 1 > game.grid.rows - 1 ||
        keys.some((k) => occupied.has(k)) ||
        !Number.isFinite(tower.x) ||
        !Number.isFinite(tower.y) ||
        Math.abs(tower.x - expected.x) > EPS ||
        Math.abs(tower.y - expected.y) > EPS
      )
        throw new Error("Save contains invalid tower positions");
      for (const k of keys) occupied.add(k);
    }
    for (const unit of [...p.towers, ...p.creeps])
      if (!obj(unit.typeId)) throw new Error("Save contains an unknown unit " + unit.typeId);
    if (
      !findPath(game, p.id) ||
      p.creeps.some(
        (c) =>
          !Number.isFinite(c.x) ||
          !Number.isFinite(c.y) ||
          c.x < 0 ||
          c.x > 1 ||
          c.y < -0.2 ||
          c.y > 1.2 ||
          (!c.flying && !findPath(game, p.id, gridAt(game, c))),
      )
    )
      throw new Error("Save contains a blocked or invalid path");
  }
  return game;
}
export const saveGame = serializeGame;
export const loadGame = restoreGame;
