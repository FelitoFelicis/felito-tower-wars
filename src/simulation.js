/** Deterministic, renderer-independent 1v1 simulation. Time is in seconds. */
import { getCatalog, getResearchCost, FACTIONS, RULES, field, splitIds, cleanText, WALL_ID, GOLEM_ID, MUD_GOLEM_ID } from "./content.js";

export const TICK = 0.05;
export const SAVE_VERSION = 6; // v0.24r: growing mazes
export const ARENA_MOVEMENT_MULTIPLIER = 0.45;
export const GAME_GRIDS = Object.freeze({
  // v0.24r: the arena grid holds the largest maze (21 rows); a player starts with baseRows and every tier
  // upgrade adds rowsPerTier rows
  arena: Object.freeze({ cols: 6, rows: 21, cellUnits: 128, baseRows: 9, rowsPerTier: 3 }),
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
// v0.24r: maze rows per player. baseRows = rows of a fresh maze, laneRows = rows of this player's maze,
// rowsForTier = rows a maze has at the given tier.
export const baseRows = (game) => Math.min(game.grid.rows, game.grid.baseRows || game.grid.rows);
export const laneRows = (game, player) => Math.max(1, Math.min(game.grid.rows, player?.rows || baseRows(game)));
export const rowsForTier = (game, tier) =>
  Math.min(game.grid.rows, baseRows(game) + (game.grid.rowsPerTier || 0) * Math.max(0, (tier || 1) - 1));
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
// v0.24r: `exitRow` is the row of the exit strip (the player's lane length); y stays relative to the full grid
const pos = (game, x, y, exitRow = game.grid.rows) => {
  const rows = game.grid.rows,
    cy = y < 0 ? -STRIP / 2 : y >= exitRow ? exitRow + STRIP * 0.2 : y + 0.5;
  return { x: (x + 0.5) / game.grid.cols, y: cy / rows, gridX: x, gridY: y };
};
// v0.24r: path progress 0..1 along the player's own lane
const laneProgress = (game, player, p) =>
  clamp((p.y * game.grid.rows - 0.5) / Math.max(1, laneRows(game, player) - 1), 0, 1);
// v0.24r: the exit-strip point below column x of the player's lane
const exitPos = (game, player, x) => pos(game, x, laneRows(game, player), laneRows(game, player));
const square = (game, x, y) => (y + 1) * game.grid.cols + x;
const dist = (game, a, b) =>
  Math.hypot((a.x - b.x) * game.grid.cols, (a.y - b.y) * game.grid.rows) * game.grid.cellUnits;
// v0.23: exactly `dist(game, a, b) <= r`, but without Math.hypot unless the squared distance lies within a
// relative 1e-9 of the boundary (Math.hypot is off by an ulp at most): the answer is always the same
const DIST_SLACK = 1e-9;
const inRange = (game, a, b, r) => {
  const fx = (a.x - b.x) * game.grid.cols,
    fy = (a.y - b.y) * game.grid.rows,
    s = fx * fx + fy * fy,
    q = r / game.grid.cellUnits,
    q2 = q * q;
  if (q > 1e-140 && q < 1e140) {
    // positive and in the normal floating-point range (no underflow / overflow in the squares)
    if (s < q2 * (1 - DIST_SLACK)) return true;
    if (s > q2 * (1 + DIST_SLACK)) return false;
  }
  return dist(game, a, b) <= r;
};
/** v0.23: exactly `dist(game, a, b) > r` (NaN positions included), the same way as inRange. */
const outOfRange = (game, a, b, r) => {
  const fx = (a.x - b.x) * game.grid.cols,
    fy = (a.y - b.y) * game.grid.rows,
    s = fx * fx + fy * fy,
    q = r / game.grid.cellUnits,
    q2 = q * q;
  if (q > 1e-140 && q < 1e140) {
    if (s < q2 * (1 - DIST_SLACK)) return false;
    if (s > q2 * (1 + DIST_SLACK)) return true;
  }
  return dist(game, a, b) > r;
};
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
// v0.23: findPath works on integer cell keys (square()) in reused typed arrays: no Set/Map, no direction
// arrays per node; same search order (down, left, right, up), so the very same path comes out
const PATH_DX = [0, -1, 1, 0],
  PATH_DY = [1, 0, 0, -1];
let pathWalls = new Uint8Array(0),
  pathPrev = new Int32Array(0),
  pathQueue = new Int32Array(0);
export function findPath(game, playerIndex = 0, start = null, extra = null, withPlanks = false) {
  const player = game.players[playerIndex],
    { cols } = game.grid,
    rows = laneRows(game, player), // v0.24r: the player's own maze length
    size = (game.grid.rows + 2) * cols; // keys of rows -1 … grid rows
  if (pathWalls.length < size) {
    pathWalls = new Uint8Array(size);
    pathPrev = new Int32Array(size);
    pathQueue = new Int32Array(size);
  }
  const walls = pathWalls,
    previous = pathPrev, // -2: not reached, -1: a start field
    queue = pathQueue;
  walls.fill(0, 0, size);
  previous.fill(-2, 0, size);
  const wall = (x, y) => {
    const k = square(game, x, y);
    if (k >= 0 && k < size && Number.isInteger(k)) walls[k] = 1;
  };
  // v0.23zb: Siege Planks open their tower for walking (never for build checks); v0.24h: only for routes that ask for
  // them (creeps next to a plank), so the field path and every other creep keep their way
  const planks = !withPlanks || extra ? null : Array.isArray(withPlanks) ? withPlanks : player.planks?.length ? player.planks : null; // an array: only these planks
  for (const t of player.towers) {
    const n = towerSize(t);
    if (planks && n === 1 && planks.some((pl) => pl.x === t.gridX && pl.y === t.gridY)) continue;
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) wall(t.gridX + dx, t.gridY + dy);
  }
  for (const e of Array.isArray(extra) ? extra : extra ? [extra] : []) wall(e.x, e.y);
  let tail = 0;
  const begin = (x, y) => {
    if (y >= rows) return true;
    const k = square(game, x, y);
    if (walls[k] || previous[k] !== -2) return false;
    previous[k] = -1;
    queue[tail++] = k;
    return false;
  };
  if (start) {
    if (begin(start.x, start.y)) return [pos(game, start.x, rows, rows)];
  } else for (let x = 0; x < cols; x++) begin(x, -1);
  let endKey = -1;
  for (let i = 0; i < tail && endKey < 0; i++) {
    const key = queue[i],
      x = key % cols,
      y = Math.floor(key / cols) - 1;
    for (let d = 0; d < 4; d++) {
      const dy = PATH_DY[d],
        nx = x + PATH_DX[d],
        ny = y + dy;
      if (nx < 0 || nx >= cols || ny < -1 || ny > rows) continue;
      // The exit strip is touched from the last row only; the spawn strip runs sideways.
      if (ny === rows && dy !== 1) continue;
      const k = (ny + 1) * cols + nx;
      if (walls[k] || previous[k] !== -2) continue;
      previous[k] = key;
      if (ny === rows) {
        endKey = k;
        break;
      }
      queue[tail++] = k;
    }
  }
  if (endKey < 0) return null;
  const path = [];
  let k = endKey;
  while (k !== -1) {
    path.push(pos(game, k % cols, Math.floor(k / cols) - 1, rows));
    k = previous[k];
  }
  return path.reverse();
}
export function getPath(game, playerIndex = 0) {
  return game.players[playerIndex].path;
}
/** Steps to the exit from every node (spawn strip included); -1 = no way out. */
function exitDistances(game, player, extra = null) {
  const { cols } = game.grid,
    rows = laneRows(game, player),
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
  labyrinthCheck(game, player); // v0.16
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
  const heading = creep.path?.[creep.pathIndex],
    own = creep.plankRoute ? game.players[playerId]?.planks?.find((pl) => plankKey(pl) === creep.plankRoute) : null,
    planks = own ? [own] : false; // v0.24h: a creep on its way over a plank keeps that one plank (only that one)
  if (heading && Number.isInteger(heading.gridX)) {
    const tail = findPath(game, playerId, { x: heading.gridX, y: heading.gridY }, null, planks);
    if (tail && tail.length) return tail;
  }
  const path = findPath(game, playerId, gridAt(game, creep), null, planks) || [];
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
/** v0.14: starting lives by player count: 2-3 players 30, 4-5 players 25, 6-8 players 20. */
export const startLives = (seats) => (seats <= 3 ? 30 : seats <= 5 ? 25 : 20);
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
    lives: startLives(seats),
    tier: 1,
    research: { Rhpm: 1, R009: 1 },
    researchQueue: [],
    towers: [],
    creeps: [],
    stock: {},
    path: [],
    // v0.14: creeps = single creeps sent, spent = gold per send type, incomeLog = income per round
    stats: { sent: 0, kills: 0, leaks: 0, goldEarned: 0, expEarned: 0, built: 0, creeps: 0, spent: {}, incomeLog: [] },
    treantCount: 0,
    ghoulCount: 0,
    nextAiTick: id * 3, // v0.23h: bots think on different ticks (no spike when all of them think at once)
    autoSend: null,
    autoMode: "default", // v0.18h
    infernalBossCount: 0,
    bossBought: {},
    paybackRemaining: 0, // v0.09k: no bonus any more; kept for saves
    elementsPurchased: 0,
    freeArchers: 0, // v0.23b: no free first archer any more (was 1 since v0.08c); Archery perk picks still give one
    starterArchers: 0,
    basicBought: 0, // v0.23b: basic towers bought so far (the first two are cheaper)
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
  lives = null,
  aiLevels = null,
  incomeInterval = RULES.incomeInterval,
  seats = 2,
  mission = null, // v0.17: campaign mission (see src/campaign.js)
  rotation = true, // v0.20: friend rooms can switch the target rotation off
  teams = null, // v0.20: { members: [team of every seat (0 / 1)], gold: "shared" | "own" }
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
    rotation: rotation !== false,
    wave: 0,
    waveQueue: [],
    clouds: [],
    missiles: [], // v0.27lF: Missile Barrage
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
    sendQueue: [], // v0.23p: sent creeps waiting for their lane's spawn slot (see SPAWN_SMOOTH)
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
    p.lives = Number.isFinite(lives) && lives > 0 ? lives : startLives(seats);
    // v0.14: mixed difficulty: one level per AI seat
    if (p.ai && aiLevels?.[p.id] && Object.hasOwn(AI_LEVELS, aiLevels[p.id])) p.aiLevel = aiLevels[p.id];
    p.picks.push(makePick(game, p, "element"));
    p.path = findPath(game, p.id);
    for (const s of getCatalog().sends) p.stock[s.id] = { count: s.stockStart > 0 ? 0 : s.stockMax, next: s.stockStart * (game.incomeInterval || RULES.incomeInterval) }; // v0.27iF: stockStart in rounds
    stockTier(game, p, 1, 0);
  }
  if (mission) applyMission(game, mission);
  if (teams && !mission) setupTeams(game, teams, lives); // v0.20
  emit(game, "start", { message: "Defend your lane. Send creeps, raise your income." });
  return game;
}
// ---- v0.20: team games (friend rooms) -----------------------------------------------------------
// Two teams. Lives are always shared, income is always shared (paid out evenly), gold is shared or
// each player's own (host's choice). A smaller team gets the same start gold and income in total.
// Creeps a team sends go to the players of the other team in turn (one creep each); a creep that
// breaks through runs on in the lane of the next player of that team.
export const TEAM_LIVES = [20, 40, 60]; // v0.20c: 60 instead of 50; v0.21d: 20 / 40 / 60
export const teamOf = (game, p) => (game?.teams ? (p?.team ?? 0) : p?.id);
export const teamMates = (game, p) => (game?.teams ? game.players.filter((q) => !q.out && q.team === p.team) : [p]);
const teamEnemies = (game, p) => game.players.filter((q) => !q.out && q.id !== p.id && (!game.teams || q.team !== p.team));
function setupTeams(game, teams, lives) {
  const members = game.players.map((p, i) => (teams.members?.[i] === 1 ? 1 : 0));
  // both teams need a player: otherwise it is an ordinary free-for-all
  if (!members.includes(0) || !members.includes(1)) return;
  game.teams = { gold: teams.gold === "own" ? "own" : "shared" };
  game.players.forEach((p, i) => (p.team = members[i]));
  const size = [0, 1].map((t) => members.filter((m) => m === t).length),
    big = Math.max(...size),
    start = TEAM_LIVES.includes(lives) ? lives : TEAM_LIVES[1]; // v0.21d: 40 when the choice is missing
  game.teamState = {};
  for (const t of [0, 1]) {
    const list = game.players.filter((p) => p.team === t),
      factor = big / size[t];
    for (const p of list) {
      p.gold = Math.round(p.gold * factor);
      p.income = Math.round(p.income * factor);
      p.lives = start;
    }
    const pool = list.reduce((sum, p) => sum + p.gold, 0);
    if (game.teams.gold === "shared") for (const p of list) p.gold = pool;
    game.teamState[t] = { lives: start, gold: list[0].gold };
  }
}
/**
 * v0.20: after every tick and every command: what any team member gained or lost (lives always,
 * gold when it is shared) is added up and given to the whole team, so the team has one value.
 */
export function teamSync(game) {
  if (!game.teams || !game.teamState) return;
  for (const t of [0, 1]) {
    const list = game.players.filter((p) => !p.out && p.team === t),
      st = game.teamState[t];
    if (!list.length || !st) continue;
    let lives = st.lives;
    for (const p of list) lives += p.lives - st.lives;
    st.lives = Math.max(0, lives);
    for (const p of list) p.lives = st.lives;
    if (game.teams.gold === "shared") {
      let gold = st.gold;
      for (const p of list) gold += p.gold - st.gold;
      st.gold = gold;
      for (const p of list) p.gold = gold;
    }
    if (st.lives <= 0 && game.running) teamDefeat(game, t, null);
  }
}
/** v0.20: what a player is paid each round in a team game: the team's income shared evenly. */
function incomeShare(game, p) {
  if (!game.teams) return p.income;
  const list = teamMates(game, p);
  return list.reduce((sum, q) => sum + q.income, 0) / Math.max(1, list.length);
}
export const teamIncome = (game, p) => (game?.teams ? teamMates(game, p).reduce((sum, q) => sum + q.income, 0) : p.income);
/** v0.20: the next player of the other team for a creep (one creep each, in turn). */
function nextTeamTarget(game, owner) {
  const list = teamEnemies(game, owner);
  if (!list.length) return null;
  owner.teamTurn = ((owner.teamTurn ?? -1) + 1) % list.length;
  return list[owner.teamTurn];
}
function teamDefeat(game, t, by) {
  const left = game.players.filter((p) => !p.out && p.team === t);
  for (const p of left) {
    p.out = true;
    p.lives = 0;
    p.place = 2;
    for (const c of p.creeps) c.dead = true;
    p.autoSend = null;
    p.aiPush = null;
    emit(game, "eliminated", { player: p.id, place: 2, by: by?.id ?? -1 });
  }
  const winners = game.players.filter((p) => !p.out && p.team !== t);
  if (!winners.length || !game.running) return;
  for (const p of game.players) if (p.team !== t) p.place = 1;
  game.running = false;
  game.winner = winners[0].id;
  game.winnerTeam = 1 - t;
  emit(game, "victory", { player: winners[0].id, team: 1 - t });
}
// ---- v0.17: campaign missions ----------------------------------------------------------------
export const ROCK_ID = "hROK";
/** All tower ids of the lines that start at `roots` (the root and every upgrade after it). */
function lineIds(roots) {
  const out = new Set(),
    todo = [...roots];
  while (todo.length) {
    const id = todo.pop();
    if (out.has(id) || !obj(id)) continue;
    out.add(id);
    todo.push(...(obj(id).upgrades || []));
  }
  return [...out];
}
const LINE_SETS = new Map();
/** v0.17b: cached set of all tower ids in the line that starts at `root`. */
/** v0.21u: Gunpowder perk, extra outer splash radius of the Bombard line in game units. */
export const GUNPOWDER = [0, 0.15, 0.25, 0.34]; // v0.22g1: tiles per perk level 1–3, then +(0.08 − 0.01 × level) per level (never less)
for (let lv = 4; lv <= 10; lv++) GUNPOWDER[lv] = Math.round((GUNPOWDER[lv - 1] + (lv >= 8 ? 0.01 : Math.max(0, 0.08 - 0.01 * lv))) * 100) / 100; // v0.22h1: levels 8–10 +0.01 each
export const gunpowderTiles = (lv) => GUNPOWDER[Math.max(0, Math.min(GUNPOWDER.length - 1, lv | 0))];
function gunpowderBonus(game, p) {
  return p?.perks ? gunpowderTiles(perkLevel(p, "gunpowder")) * game.grid.cellUnits : 0;
}
function lineSet(root) {
  if (!LINE_SETS.has(root)) LINE_SETS.set(root, new Set(lineIds([root])));
  return LINE_SETS.get(root);
}
const cellList = (text) =>
  String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((k) => k.split(",").map(Number));
/** A tower placed for free at the start (pre-built maze, rocks); skipped if it would block the path. */
function placeFree(game, p, id, x, y) {
  if (!canBuild(game, p.id, x, y, id).ok) return null;
  const t = newTower(game, p, id, x, y);
  t.buildRemaining = 0;
  t.preset = true;
  markSummoned(t); // v0.26fF: placed for free
  p.towers.push(t);
  p.path = findPath(game, p.id) || [];
  completeTower(game, p, t);
  return t;
}
/**
 * Mission rules, kept on the game and the players as plain data (saves and replays carry them):
 * start lives, gold and income; rocks in a maze (cleared for gold, or cracked by stealing lives);
 * pre-built towers; allowed sends and towers; no anti-air; a tower limit; a sleeping start; the
 * bot's maze shape and personality; and the goal (destroy, survive N rounds, or win by round N).
 */
function applyMission(game, m) {
  game.mission = { id: m.id, goal: m.goal || null, rockCost: m.rockCost ?? 40, rocksOnSteal: !!m.rocksOnSteal };
  // v0.26: Neutral Auxiliaries (see missionAux): copied as plain data, their gold banks live in game.mission.auxBank
  if (m.aux?.length) {
    game.mission.aux = m.aux.map((a) => ({ ...a }));
    game.mission.auxScale = m.auxScale || 1;
    game.mission.auxBank = {};
  }
  const setup = (p, r = {}) => {
    if (r.lives) p.lives = r.lives;
    p.gold += r.gold || 0;
    p.income += r.income || 0;
    if (r.name) p.missionName = r.name;
    if (r.art) p.missionArt = r.art;
    if (r.level && p.ai && Object.hasOwn(AI_LEVELS, r.level)) p.aiLevel = r.level;
    const rules = {};
    if (r.sends) rules.sends = r.sends;
    if (r.towers) rules.towers = lineIds(r.towers);
    if (r.noAir) rules.noAir = true;
    if (r.maxTowers) rules.maxTowers = r.maxTowers;
    if (r.sleep) rules.sleep = r.sleep;
    if (r.maze) rules.maze = r.maze;
    if (r.persona) rules.persona = r.persona;
    if (r.noDefensePerks) rules.noDefense = true; // v0.26: no defensive perks in the level-up rewards
    if (r.noBounty) rules.noBounty = true; // v0.26bF: no gold from creep kills
    if (r.noStartDelay) rules.noStartDelay = true; // v0.26bF: every creep ready from the start
    if (r.archers) rules.archers = { ...r.archers }; // v0.26bF: { total, early, by }: minimum Archer-Line towers
    if (Object.keys(rules).length) p.rules = rules;
    if (rules.noStartDelay) stockTier(game, p, 1, game.time || 0);
    for (const pre of r.prebuild || []) for (const [x, y] of cellList(pre.cells)) placeFree(game, p, pre.id, x, y);
    for (const [x, y] of cellList(r.rocks)) placeFree(game, p, ROCK_ID, x, y);
    p.path = findPath(game, p.id) || [];
  };
  setup(game.players[0], m.player);
  game.players.slice(1).forEach((p, i) => setup(p, m.enemies?.[i] || m.enemies?.[0]));
}
/**
 * v0.26: campaign "Neutral Auxiliaries": neutral creeps that join the enemy, in the local player's lane only (seat 0).
 * A mission lists them as { unit, from, until, tier, share, group, variant }: active from round `from` to round
 * `until`, once the first enemy has reached tier `tier`. Each round the active ones share a budget of hit points
 * (AUX.share of the neutral wave curve, times the mission's auxScale); each banks its part and sends as many creeps
 * as the bank pays for (in packs of `group`), so a big creep comes every few rounds instead of never.
 */
export const AUX = Object.freeze({ share: 0.3, max: 16, gap: 0.6, delay: 1.2 });
/** v0.26: the Lesser Skeleton: a Skeleton 20 % smaller, with 6 HP and 20 % slower (auxiliaries only). */
export const LESSER = Object.freeze({ model: "n00R", hp: 6, speed: 0.8, scale: 0.8, name: "Lesser Skeleton" });
const auxHp = (a) => (a.variant === "lesser" ? LESSER.hp : obj(a.unit)?.hp || 1);
function missionAux(game) {
  const list = game.mission?.aux,
    me = game.players[0];
  if (!list?.length || !game.running || !me || me.out) return;
  const foeTier = game.players[1]?.tier || 1,
    r = game.round,
    active = list.map((a, i) => [a, i]).filter(([a]) => r >= (a.from || 1) && r <= (a.until ?? Infinity) && (!a.tier || foeTier >= a.tier));
  if (!active.length) return;
  const number = Math.max(1, (r - WAVE_FIRST_ROUND) / WAVE_EVERY_ROUNDS + 1),
    budget = (AUX.share * (game.mission.auxScale || 1) * waveTotalHp(number)) / active.length,
    bank = (game.mission.auxBank ||= {});
  let k = 0;
  for (const [a, i] of active) {
    const item = obj(a.unit);
    if (!item) continue;
    const hp = auxHp(a),
      group = a.group || 1;
    bank[i] = (bank[i] || 0) + budget * (a.share || 1);
    let count = Math.floor(bank[i] / hp);
    count -= count % group;
    if (count <= 0) continue;
    if (count >= AUX.max) {
      count = AUX.max - (AUX.max % group);
      bank[i] = 0; // the rest is dropped: the bank never piles up
    } else bank[i] -= count * hp;
    for (let j = 0; j < count; j++)
      game.waveQueue.push({ time: game.time + AUX.delay + AUX.gap * k++, defender: 0, number: Math.round(number), type: "normal", model: a.unit, flying: !!item.flying, real: true, aux: a.variant || true });
  }
}
/** v0.26: a queued auxiliary enters the player's lane: the creep's own values and bounty, drawn as a neutral. */
function spawnAuxCreep(game, entry) {
  const c = spawnWaveCreep(game, entry),
    item = obj(entry.model);
  if (!c || !item) return c;
  c.aux = true;
  c.bounty = Math.max(1, Math.round((item.bountyBase || 0) + ((item.bountyDice || 0) * ((item.bountySides || 0) + 1)) / 2));
  if (entry.aux === "lesser") {
    c.hp = c.maxHp = LESSER.hp;
    c.speed *= LESSER.speed;
    c.baseSpeed *= LESSER.speed;
    c.scale = LESSER.scale;
    c.name = LESSER.name;
    c.bounty = 1;
  }
  return c;
}
/**
 * v0.27F: tier 1 opens with five cards: the four cheapest creeps and the Mud Golem (mini boss) in the fifth slot.
 * Recruiting the Mud Golem swaps it for the fifth creep and unlocks the upper half of tier 1 (creeps 6–10 and the
 * Rock Golem). Mini Boss: half of the Rock Golem's Tier Boss resistances. Missions with their own send list keep tier 1 whole.
 */
export const MINI_BOSS = Object.freeze({ id: MUD_GOLEM_ID, slot: 4, share: 0.5, exp: 125, aiRound: { veryEasy: 8, easy: 5, normal: 3, hard: 3, insane: 3 }, aiIncome: 50, aiSave: 9 }); // exp: half the Rock Golem's 250
export const tierOneLocked = (p) => !!p && p.tier === 1 && !p.mudGolem && !p.rules?.sends;
/** v0.27F: send cards not offered right now (tier 1 before the Mud Golem, or the Mud Golem afterwards). */
export function sendHidden(p, s) {
  if (!s?.isSend) return false;
  if (s.id === MINI_BOSS.id) return !tierOneLocked(p);
  if (s.tier !== 1 || !tierOneLocked(p)) return false;
  return !!s.bossTier || tierSends(1).filter((x) => !x.bossTier).indexOf(s) >= MINI_BOSS.slot;
}
/** v0.17: is this send allowed for the player (mission rules)? Bosses always are. v0.27F: hidden tier 1 cards are not. */
const sendAllowed = (p, s) => !sendHidden(p, s) && (!p.rules?.sends || s.bossTier || p.rules.sends.includes(s.id));
/** v0.17: goal checks after every new round: survive N rounds, or win before round N. */
function missionRound(game) {
  const goal = game.mission?.goal;
  if (!goal || !game.running) return;
  const me = game.players[0];
  if (goal.survive && game.round >= goal.survive && me.lives > 0) {
    game.running = false;
    game.winner = 0;
    me.place = 1;
    emit(game, "victory", { player: 0, survived: true });
  } else if (goal.deadline && game.round > goal.deadline) {
    const rival = game.players.find((q) => q.id !== 0 && !q.out) || game.players[1];
    game.running = false;
    game.winner = rival.id;
    emit(game, "victory", { player: rival.id, deadline: true });
  }
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
/** v0.19d2: the first EXP generator costs 50 % less while the player owns none. */
export const FIRST_GEN_DISCOUNT = 0.5;
/** v0.23b: no free first archer any more; the first basic tower (Archer, Footman, Bombard) costs 10 gold less, the second 5 gold less. */
export const BASIC_TOWERS = new Set(["h003", "h000", "h02R"]);
export const BASIC_DISCOUNTS = [10, 5];
export const firstGenPrice = (p, item) =>
  item?.id === "h01F" && !p.towers.some((t) => obj(t.typeId)?.support === "lumber")
    ? Math.ceil(item.cost * (1 - FIRST_GEN_DISCOUNT))
    : BASIC_TOWERS.has(item?.id) && (p.basicBought || 0) < BASIC_DISCOUNTS.length
      ? Math.max(0, item.cost - BASIC_DISCOUNTS[p.basicBought || 0])
      : item?.cost;
export function getPurchaseCost(game, playerIndex, id) {
  const p = game.players[playerIndex],
    item = obj(id);
  if (!p || !item) return null;
  const root = item.kind !== "research" && !item.isRoot ? directRootOf(p, id) : null; // v0.27zzdF: level-2 blueprint
  if (root) return { gold: firstGenPrice(p, root) + (item.cost || 0), wood: 0, time: item.buildTime };
  if (item.kind !== "research") return { gold: bossDiscount(p, item, firstGenPrice(p, item)), wood: item.woodCost, time: item.buildTime };
  return getResearchCost(id, FACTIONS.some((f) => f.research === id) ? p.elementsPurchased : p.research[id] || 0);
}
/**
 * v0.27zzdF: from tier 2 on the basic blueprints (Archer, Footman, Bombard) build level 2 directly, as long as level 2 is
 * the only upgrade their level 1 offers. Returns the level-1 root of such a level-2 id for this player, else null.
 */
export function directRootOf(p, id) {
  if (!p || (p.tier || 1) < 2) return null;
  for (const rootId of BASIC_TOWERS) {
    const root = obj(rootId),
      ups = (root?.upgrades || []).map(obj).filter((u) => u?.playable && meetRequirements(p, u.requires || []).ok);
    if (ups.length === 1 && ups[0].id === id && (ups[0].level || 1) === 2) return root;
  }
  return null;
}
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
    return { ok: false, reason: "Upgrades are perks now" }; // v0.21: the separate upgrade (research) protocol is gone
  } else if (type === "send") {
    if (!item.isSend) return { ok: false, reason: "Not a send card" };
    if (item.tier > p.tier) return { ok: false, reason: `Send the tier ${item.tier - 1} boss` };
    if (item.tier < p.tier) return { ok: false, reason: "Replaced by the next tier" };
    if (item.inactiveInSource) return { ok: false, reason: "Disabled in the source map (tier 6 off)" };
    if (item.bossTier && id !== MOUNTAIN_GOLEM.id && (p.bossBought?.[id] || p.tier >= item.bossTier)) return { ok: false, reason: "Boss already bought" }; // v0.26cF: the Mountain Golem can be recruited again
    if (sendHidden(p, item)) return { ok: false, reason: item.id === MINI_BOSS.id ? "Mud Golem already recruited" : "Recruit the Mud Golem first" }; // v0.27F
    if (!sendAllowed(p, item)) return { ok: false, reason: "Not allowed in this mission" }; // v0.17
    if (game.warmup) return { ok: false, reason: `Warm up · ${Math.ceil(game.incomeRemaining)} s` };
    if (lockRoundsLeft(game, p.stock[id]) > 0) return { ok: false, reason: lockRoundsLeft(game, p.stock[id]) === 1 ? "Locked for 1 more round" : `Locked for ${lockRoundsLeft(game, p.stock[id])} more rounds` }; // v0.15
    if ((p.stock[id]?.count ?? 0) < 1) return { ok: false, reason: "Restocking" };
    cost = { gold: bossDiscount(p, item, item.cost), wood: 0 };
  } else if (type === "build") {
    const root = !item.isRoot ? directRootOf(p, id) : null; // v0.27zzdF: level-2 blueprint
    if (!item.isBuildable && !root) return { ok: false, reason: "Not a building" };
    if (!item.isRoot && !root) return { ok: false, reason: "Upgrade from the previous tower" };
    if (root) cost = { gold: firstGenPrice(p, root) + (item.cost || 0), wood: 0 };
    if (item.support === "farm") return { ok: false, reason: "Farm not available for now" };
    if (id === WALL_ID && !perkLevel(p, "fort")) return { ok: false, reason: "Needs the Fortifications perk" }; // v0.12
    // v0.17g: one Hall of Elements per player (any of its levels); selling it frees the blueprint again
    if (item.isHall && p.towers.some((t) => obj(t.typeId)?.isHall)) return { ok: false, reason: "Only one Hall of Elements" };
    if (root);
    else if (id === "h003" && (p.freeArchers || 0) > 0) cost = { gold: 0, wood: 0 }; // Forest Patrol
    else if (id === "h01F" && (p.freeGens || 0) > 0) cost = { gold: 0, wood: 0 }; // v0.19g1: Novice
    else if (id === "h01F") cost = { gold: firstGenPrice(p, item), wood: 0 }; // v0.19d2: the first EXP generator at half price
    else if (BASIC_TOWERS.has(id)) cost = { gold: firstGenPrice(p, item), wood: 0 }; // v0.23b: first two basic towers cheaper
  } else if (type === "upgrade") {
    const tower = p.towers.find((t) => t.id === towerId);
    if (!tower) return { ok: false, reason: "Tower not found" };
    if (!obj(tower.typeId).upgrades.includes(id)) return { ok: false, reason: "Not a valid upgrade" };
    // Ultimate elementals are limited to one per player (SETUP: SetPlayerTechMaxAllowed 1).
    if (UNIQUE_TOWERS.has(id) && p.towers.some((t) => t.typeId === id))
      return { ok: false, reason: "Only once per player" };
    // v0.10q: missing technology wins over "under construction", so locked upgrades stay hidden
    if (tower.buildRemaining > EPS) {
      const req = meetRequirements(p, requirements);
      return req.ok ? { ok: false, reason: "Still under construction" } : req;
    }
  }
  // v0.17: mission rules for towers: allowed lines, no anti-air, a tower limit
  if ((type === "build" || type === "upgrade") && p.rules && item.attacks) {
    if (p.rules.towers && !p.rules.towers.includes(id)) return { ok: false, reason: "Not allowed in this mission" };
    if (p.rules.noAir && item.targets?.includes("air")) return { ok: false, reason: "Not allowed in this mission" };
  }
  if (type === "build" && p.rules?.maxTowers && p.towers.filter((t) => t.typeId !== ROCK_ID).length >= p.rules.maxTowers)
    return { ok: false, reason: `Tower limit: ${p.rules.maxTowers}` };
  const req = meetRequirements(p, requirements);
  if (!req.ok) return req;
  if (p.gold + EPS < cost.gold) return { ok: false, reason: `Need ${Math.ceil(cost.gold - p.gold)} more gold`, cost };
  return { ok: true, cost };
}
export const getAvailability = available;
export const canUse = available;

export function canBuild(game, playerIndex, gridX, gridY, id = null) {
  const p = game.players[playerIndex],
    { cols } = game.grid,
    rows = laneRows(game, p), // v0.24r: only the player's own maze rows
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
  let check = canBuild(game, playerIndex, gridX, gridY, id);
  if (check.ok && aiCondBlocks(game, p, gridX, gridY, id)) check = { ok: false, reason: "Conditional perk" }; // v0.23b: bots keep the condition
  if (!check.ok) return { ...check, gridX, gridY, path: null, length: current, delta: 0 };
  const path = findPath(game, playerIndex, null, footprintCells(gridX, gridY, id ? footprintOf(id) : 1)) || [];
  const length = Math.max(0, path.length - 1);
  return { ok: true, gridX, gridY, path, length, delta: length - current };
}

const ARCHER_RANGE_CUT = 0.15, // fields (v0.17c)
  BOMBARD_RANGE_CUT = 0.1,
  RANGE_KEEP = /^(Bird Hunter|Water Elemental)/;
// v0.23: statsFor is asked for every tower every tick and many times by the bots: the result is kept per player
// and unit type (WeakMap, never saved or sent) and handed out again while every input it reads has the same
// value: the game, the levels of the perks it reads (STATS_PERKS), the research levels of item.researchAffected,
// Supergrowth of this unit, the contract share (quest log), Last Guardians on/off, Backup Line and Low Tides
// on/off. Values are compared, not objects, so even a perk or research level changed in place is seen.
// Auras, curses and other timed effects are not part of statsFor (attack() applies them).
// The returned object is shared: callers only read it.
const STATS_CACHE = new WeakMap();
const STATS_PERKS = ["archery", "autoloader", "backup", "carmor", "firearrows", "frenzy", "golem", "heavy", "leadership", "lone", "medicine", "melee", "militia", "mind", "nobility", "owl", "ring", "stormfeathers", "tailwind", "tides", "wings"]; // v0.26cF: Ring of Life
function statsInputs(player, item) {
  const research = player.research || {},
    affected = item.researchAffected || [],
    out = [
      player.growth?.[item.id] || 0,
      contractShare(player, item, "hp"),
      item.isBuildable && item.attacks ? loneActive(player) : false,
      !!player.backupOn,
      !!player.tidesOn,
      player.mountainGolems || 0, // v0.26cF: Mountain Golems recruited (tier-5 HP)
    ];
  for (const id of STATS_PERKS) out.push(perkLevel(player, id));
  for (const id of affected) out.push(research[id] || 0);
  return out;
}
function statsFor(game, player, item) {
  if (!game || !player || !item || typeof player !== "object") return statsForRaw(game, player, item);
  let byItem = STATS_CACHE.get(player);
  if (!byItem) STATS_CACHE.set(player, (byItem = new Map()));
  const hit = byItem.get(item);
  // v0.23h: within one tick (and between two commands) the inputs cannot change: skip building the input list
  if (hit && hit.game === game && hit.epoch === skillEpoch) return hit.stats;
  const inputs = statsInputs(player, item);
  if (hit && hit.game === game && sameList(hit.inputs, inputs)) {
    hit.epoch = skillEpoch;
    return hit.stats;
  }
  const stats = statsForRaw(game, player, item);
  byItem.set(item, { game, inputs, stats, epoch: skillEpoch });
  return stats;
}
function statsForRaw(game, player, item) {
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
  // v0.16h: Lone Guardians back to v0.13: +125 % attack speed for all towers while you own 5 or fewer
  let attackSpeed = item.isBuildable && item.attacks && loneActive(player) ? loneSpeed(perkLevel(player, "lone")) : 0, // v0.22g1: by perk level
    hpPercent = 0,
    damagePercent = 0;
  for (const id of item.researchAffected) {
    const r = obj(id),
      level = player.research[id] || 0;
    if (!r || !level || id === "R005") continue; // v0.19j: Heavy Weapons is applied below (whole Footman and Bombard lines)
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
  // v0.19a1 / v0.21: the former level-up upgrades, now perks (towers: Melee Protocol, Unholy Frenzy, Fire Arrows;
  // creeps: Creep Medicine, Mind Control, Tailwind, Creep Armor, Leadership, contracts)
  const pk = (id) => perkLevel(player, id);
  let speedPercent = 0;
  if (item.isBuildable && item.attacks) {
    if (pk("melee") && isMeleeTower(item)) attackSpeed += MELEE_PROTOCOL * pk("melee");
    if (pk("autoloader") && isBombardLine(item)) attackSpeed += AUTOLOADER * pk("autoloader"); // v0.22g1
    if (pk("stormfeathers") && archerLine().has(item.id)) attackSpeed += STORMFEATHERS * pk("stormfeathers"); // v0.22h1
    // v0.24q: Backup Line: Archer-Line attack speed while the top rows stay free of towers
    if (player.backupOn && pk("backup") && archerLine().has(item.id)) attackSpeed += backupSpeed(pk("backup"));
    if (pk("militia") && footmanLine().has(item.id)) stats.damageBonus += MILITIA_DAMAGE; // v0.22g1
    if (pk("frenzy")) attackSpeed += FRENZY * pk("frenzy");
    if (pk("firearrows") && isArrowUnit(item)) damagePercent += FIRE_ARROWS * pk("firearrows");
  }
  if (isCreepUnit(item)) {
    const air = item.flying ? MIND.air : 1;
    hpPercent += (player?.growth?.[item.id] || 0); // v0.20c: Supergrowth
    hpPercent += HEALING.hp * pk("medicine") + MIND.hp * pk("mind") * air + creepArmorHp(pk("carmor")) + LEADERSHIP * pk("leadership") + contractShare(player, item, "hp");
    if (item.isSend && pk("breeding") >= 2 && hasDeathrattle(item.id)) hpPercent += breedingHp(pk("breeding")); // v0.27aF: Breeding Pools spawners
    if (item.isSend && item.tier && !item.bossTier) stats.armor += creepArmorBonus(pk("carmor"), item); // v0.27oF: Creep Armor from level 2
    speedPercent += MIND.speed * pk("mind") * air + TAILWIND.speed * pk("tailwind");
  }
  stats.speed *= 1 + speedPercent;
  stats.hp *= 1 + hpPercent;
  // v0.13: Watcher Owl: archer-line towers reach +0.5 / +0.33 / +0.25 fields further per level
  if (item.isBuildable && item.attacks && perkLevel(player, "owl") && archerLine().has(item.id)) stats.range += owlRange(perkLevel(player, "owl")) * (game?.grid?.cellUnits || 128);
  // v0.12: Heavy Nobility: heavy creeps get more hit points
  if (perkLevel(player, "nobility") && isHeavy(item)) stats.hp *= 1 + NOBILITY.hp * perkLevel(player, "nobility");
  if (item.isSend && (item.bossTier || item.id === MINI_BOSS.id) && perkLevel(player, "golem")) stats.hp *= 1 + GOLEM.hp; // v0.10n; v0.27kF: also mini bosses
  // v0.26cF: every Mountain Golem recruited: tier-5 creeps +5 % HP for good
  if (item.isSend && item.tier === 5 && !item.bossTier && player?.mountainGolems) stats.hp *= 1 + MOUNTAIN_GOLEM.hp * player.mountainGolems;
  // v0.26cF: Ring of Life: flat HP by the creep's tier, times the perk level
  if (item.isSend && item.tier && perkLevel(player, "ring")) stats.hp += ringHp(item.tier, perkLevel(player, "ring"));
  if (item.isSend && item.flying && perkLevel(player, "wings")) {
    // v0.10p: Wings of War
    stats.hp *= 1 + WINGS.hp * perkLevel(player, "wings");
    stats.speed *= 1 + WINGS.speed * perkLevel(player, "wings");
  }
  // v0.19j: Heavy Weapons: Footman and Bombard lines +5 % damage per level (up to 20 levels)
  if (pk("heavy") && item.isBuildable && item.attacks && (footmanLine().has(item.id) || lineSet("h02R").has(item.id))) damagePercent += HEAVY_WEAPONS * pk("heavy");
  stats.damageMultiplier *= 1 + damagePercent;
  if (perkLevel(player, "archery") && archerLine().has(item.id)) stats.damageMultiplier *= 1 + 0.05 * perkLevel(player, "archery");
  // v0.18h: Low Tides (melee) while its rows stay free of towers; v0.24q: damage by level
  if (item.isBuildable && item.attacks && player.tidesOn && perkLevel(player, "tides") && isMeleeTower(item))
    stats.damageMultiplier *= 1 + tidesDamage(perkLevel(player, "tides"));
  stats.damage = (stats.damage + stats.damageBonus) * stats.damageMultiplier;
  stats.cooldown /= Math.max(0.1, 1 + attackSpeed);
  // v0.27xF: Footman-Line base attack speed +5 % (part of the base value, so tooltips show no buff arrow)
  if (item.isBuildable && item.attacks && footmanLine().has(item.id)) stats.cooldown /= 1 + FOOTMAN_LINE_SPEED;
  stats.speed *= movementMultiplier(game);
  if (item.isBuildable && item.attacks) stats.range = rangedReach(game, stats.range);
  if (item.isBuildable && item.attacks && stats.range > MELEE_RANGE_MAX) {
    // v0.17c: Archer line −0.15 fields (not Bird Hunter, not Water Elemental), Bombard line −0.10 fields
    const cu = game.grid.cellUnits;
    if (archerLine().has(item.id)) {
      if (!RANGE_KEEP.test(nameOf(item))) stats.range -= ARCHER_RANGE_CUT * cu;
    } else if (lineSet("h02R").has(item.id)) stats.range -= BOMBARD_RANGE_CUT * cu;
    // v0.23b: the Archer tower itself (levels 1–6) reaches 3.5 fields (Watcher Owl still adds on top)
    if (item.shortName === "Archer" && (item.level || 1) <= 6)
      stats.range = ARCHER_RANGE * cu + (perkLevel(player, "owl") ? owlRange(perkLevel(player, "owl")) * cu : 0);
  }
  return stats;
}
const INCOME_EXCLUDED = new Set(["n00Y", "n01H", "n01R", "n01T", "n02P", "n02Q", "n02R"]); // v0.21p: Ghoul has income now
/** Income one purchase of a creep adds: whole part and hundredths (research R006, Feudality). */
/** v0.10w: Treant: dies for 30 − (treants bought) EXP (v0.21z: 20 → 30); after 20 purchases it burns (+10 % speed, income). */
export const TREANT = { exp: 30, burnAfter: 20, income: 20, speed: 0.1 };
export const burningTreant = (p) => (p?.treantCount || 0) >= TREANT.burnAfter;
function sendIncomeParts(p, item) {
  const base = item.id === "n00Y" && burningTreant(p) ? TREANT.income : INCOME_EXCLUDED.has(item.id) ? 0 : item.pointValue;
  let decimal = item.incomeHundredths || 0;
  if (!item.decimalEligible) decimal = 0; // v0.19a1: the old Magic Library income bonus is gone (Magic Bank pays interest instead)
  // Feudality (v0.18b): +2 / 3.5 / 5 / 6 / 7 % of the income this creep brings, in hundredths
  const feudal = feudalBonus(perkLevel(p, "feudal"));
  if (feudal) decimal += Math.round((base * 100 + (item.incomeHundredths || 0)) * feudal);
  // v0.18h: Sanction Policy: +15 % (first creep +7.5 %) for the creeps it did not lock
  const sanction = p.sanction?.bonus?.[item.id];
  if (sanction) decimal += Math.round((base * 100 + (item.incomeHundredths || 0)) * sanction);
  // v0.19a1: Healing Power (+2 %), Creep Armor (+1.5 %) per level, Blood / Unholy Contract
  const tail = perkLevel(p, "tailwind"),
    creepInc = HEALING.income * perkLevel(p, "medicine") + CREEP_ARMOR.income * perkLevel(p, "carmor") + LEADERSHIP_INCOME * perkLevel(p, "leadership") + contractShare(p, item, "income") + (tail ? TAILWIND.income + TAILWIND.incomePer * tail : 0); // v0.27aF: Leadership; v0.28.004F: Tailwind
  if (creepInc) decimal += Math.round((base * 100 + (item.incomeHundredths || 0)) * creepInc);
  // v0.10p: Wings of War: +10 % income per level for flying creeps
  const wings = item.flying ? perkLevel(p, "wings") : 0;
  if (wings) decimal += Math.round((base * 100 + (item.incomeHundredths || 0)) * WINGS.income * wings);
  // v0.10r: Red Boots: +1.5 % income per level for ground creeps (v0.22, was 1 %)
  const boots = item.flying ? 0 : Math.min(BOOTS.slow.length, perkLevel(p, "boots"));
  if (boots) decimal += Math.round((base * 100 + (item.incomeHundredths || 0)) * BOOTS.income * boots);
  // v0.26cF: Ring of Life: the 1st creep of every tier +5 / 7.5 / 10 % income
  const ring = perkLevel(p, "ring") && firstOfTier(item) ? RING.income[Math.min(3, perkLevel(p, "ring")) - 1] : 0;
  if (ring) decimal += Math.round((base * 100 + (item.incomeHundredths || 0)) * ring);
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
/** v0.21x: the same stats without perks, upgrades or growth (tooltips show "base → current"). */
export function baseStats(game, playerIndex, id) {
  const p = game.players[playerIndex];
  return statsFor(game, { id: p?.id ?? playerIndex, team: p?.team, tier: p?.tier || 1, perks: {}, research: {}, growth: {}, towers: [], creeps: [], contracts: [] }, obj(id));
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
    value: item.cost || 0, // v0.26fF: tower value (full price of every level)
    woodSpent: item.woodCost,
    completed: false,
  };
}
// ---- Level perks (v0.08b): extra rewards with five levels each; every level-up dialog may
// offer them, and the dialogs up to level 3 always hold at least one ----------------------
export const PERKS = Object.freeze({
  // v0.22za2: "text" is the short tooltip everywhere, "detail" the longer text of the card book's detail view
  // v0.09q: perk rework (availability in PERK_AVAILABILITY)
  recruit: { name: "Recruitment", max: 10, text: "Creeps recruit {recruit} faster" },
  recruitflow: { name: "Flow of Duty", // v0.27zziF: was Recruitment Flow
    max: 5, element: "water", text: "Creeps recruit {recruitflow} faster", detail: "Every creep (bosses excepted) recruits {recruitflow} faster; at level 5 twice as fast" }, // v0.27zzcF // v0.19h1: tooltip // v0.10i (artifact line), merged in v0.11c
  feudal: { name: "Feudality", max: 10, text: "Creep income +{feudal}" }, // v0.18b: 2 / 3.5 / 5 / 6 / 7 %
  gunpowder: { name: "Blast Expert", max: 10, element: "fire", text: "Bombard-Line outer splash +{gunpowder} tiles" }, // v0.23y: Fire, renamed Blast Expert (was the neutral Gunpowder) // v0.22g1: only the low-damage outer ring // v0.21u: outer splash radius +0.25/0.45/0.60/0.72/0.82/0.90/0.96/1.00/1.03/1.05 tiles
  archery: { name: "Archery", max: 10, text: "Archer-Line +{archery} damage. Next Archer free", detail: "Archer-Line +{archery} damage. Next Archer is free" }, // v0.19h1: 5 / 10 / 15 / 20 / 25 %; v0.20a: every pick makes the next archer free
  militia: { name: "Militia", max: 1, powerup: true, text: "2 free Footman. Footman-Line +1 damage", detail: "Spawn 2 Footman on random fields. Footman-Line +1 damage" }, // v0.22g1: +1 damage // v0.17h: once per player; v0.19e2: powerup
  evolution: { name: "Upgrade Tower", max: 1, powerup: true, text: "Upgrades a random level 1–2 tower and copies it", detail: "Upgrades a random level 1 or 2 tower and summons a copy to a random field" }, // v0.22o2: renamed from Evolution; v0.19g1: level 2 towers first, the copy sells for 10 %
  gold: { name: "Gold", max: 1, powerup: true, text: "Instantly +{gold} gold" }, // v0.10u: powerup = instant reward, no tile once taken
  novice: { name: "Novice", max: 3, text: "EXP +{novice}. Next EXP generator free", detail: "Increases EXP gain +{novice}. Next EXP generator is free" }, // v0.22m2: 15 / 30 / 45 / 60 / 75 %, every level one free level 1 EXP generator
  volley: { name: "Arrow Volley", max: 5, text: "Arrows rain on an area dealing {volleyDmg} Arrow damage each. Kills give 300% EXP" }, // v0.27aF: Arrow damage, triple kill EXP // v0.20e: shorter tooltip
  wings: { name: "Wings of War", max: 10, element: "storm", text: "Flyers +{wingsHp} HP, +{wingsSpeed} speed, +{wingsInc} income", detail: "Flying creeps +{wingsHp} HP, +{wingsSpeed} speed, +{wingsInc} income" }, // v0.10p
  hellfire: { name: "Lava Floor", max: 10, element: "fire", text: "Ground creeps on lava burn for {hellfire} damage/s", detail: "6 lava tiles appear on random fields of your board (2 in the upper half, 2 in the lower half, 2 anywhere), one more for each level from 2 on. Ground creeps on lava burn for {hellfire} damage per second" }, // v0.23k: random tiles instead of the 6th row // v0.10p, v0.16g
  frostbolt: { name: "Frost Strike", max: 10, element: "water", text: "Active: one field freezes, then icicles erupt: {frostbolt} damage, slows 50% for {frostboltSlow} s", detail: "Active ability: the chosen field freezes for 0.25 s, then icicles erupt and hit every creep on it for {frostbolt} damage and slow them by 50% for {frostboltSlow} s" }, // v0.23w
  infested: { name: "Infested Ground", max: 10, element: "plague", text: "Active: infest a field; it strikes a creep on it for {infested} damage every {infestedEvery} s, {infestedCharges} times", detail: "Active ability: a field of your board becomes infested ground. Every {infestedEvery} s it strikes one ground creep on it for {infested} damage and slows it for 1 s, {infestedCharges} times. At most 6 infested fields; a new one replaces the one with the fewest strikes left" }, // v0.23x
  clones: { name: "Clones", max: 10, element: "arcane", text: "{clones} chance to clone a sent creep{clonesExtra}", detail: "Every creep you send has {clones} chance to bring a clone with 50% HP. Clones give their share of income{clonesExtra}" }, // v0.23w
  burst: { name: "Arcane Burst", max: 5, element: "arcane", text: "Active: {burst} damage split in an area", detail: "Active ability: {burst} damage, split among the creeps in an area" }, // v0.10p
  treasure: { name: "Gold Treasure", max: 1, powerup: true, text: "Now +{treasure} gold and +{treasureInc} income", detail: "Instantly +{treasure} gold and +{treasureInc} income" }, // v0.10r; v0.19e2: +20 % gold, +60 income (doubled when far behind)
  voltage: { name: "High Voltage", max: 20, element: "storm", unpopular: 0.5, text: "EXP generators are {voltage} more efficient" }, // v0.10r; v0.19j: tooltip
  boots: { name: "Red Boots", max: 5, element: "fire", text: "Ground creeps {boots} slow resistance and +{bootsInc} creep income" }, // v0.10r; v0.22: max level 5
  exhume: { name: "Exhumination", max: 3, element: "plague", text: "Undead creeps cost {exhume} less and recruit {exhumeSpeed} faster" }, // v0.26cF: recruit 10 % faster per level // v0.20c: 10 % faster instead of 20 % slower // v0.10r; v0.19j: tooltip (they still restock 20% slower)
  fireblock: { name: "Fire Block", max: 3, element: "fire", text: "Every {fireBlockCd} s first breach is pushed back {fireBlockBack} fields and explodes 3× for {fireBlock}", detail: "Every {fireBlockCd} s the first breach is pushed back {fireBlockBack} fields and explodes at once: {fireBlock} damage 3 times" }, // v0.19j
  airblock: { name: "Air Block", max: 3, element: "storm", text: "Every {airBlockCd} s first flying breach is pushed back {airBlockBack} fields, struck for {airBlock} and stunned {airBlockStun} s", detail: "Every {airBlockCd} s the first flying breach is pushed back {airBlockBack} fields, struck by lightning for {airBlock} damage and stunned {airBlockStun} s. Each block cuts your Monsun cooldown by {airBlockMonsun} s" }, // v0.20c; v0.24s: Monsun cooldown per block
  supergrowth: { name: "Supergrowth", max: 3, element: "earth", text: "Buying strong ground creeps gives their type up to +{growth} HP", detail: "Each purchase of a ground creep from the stronger half of its tier gives that creep type +{growth} HP, less for weaker ones" }, // v0.20f
  waterblock: { name: "Water Block", max: 3, element: "water", text: "Every {blockCd} s first breach is pushed back {blockBack} fields and frozen {blockSlow} slower", detail: "Every {blockCd} s the first breach is pushed back {blockBack} fields (flyers {blockBackAir}) and frozen {blockSlow} slower" }, // v0.10r
  pocks: { name: "Giant's Pocks", max: 5, element: "plague", text: "Every 4 s the strongest creep loses {pocks} HP and is poisoned", detail: "Every 4 s the strongest creep in your field loses {pocks} HP and is poisoned" }, // v0.10q
  permafrost: { name: "Frozen Ground", max: 10, element: "water", text: "Ground creeps {permafrost} slower", detail: "Ground creeps in your field {permafrost} slower" }, // v0.10o; v0.22h1: was Permafrost, 5 % per level
  hills: { name: "Hill Paths", max: 5, element: "earth", weight: 0.75, text: "Uphill ground creeps {hills} slower", detail: "Ground creeps walking upwards in your field {hills} slower" }, // v0.22h1
  stormfeathers: { name: "Stormfeathers", max: 10, element: "storm", text: "Archer-Line attack speed +{stormfeathers}" }, // v0.22h1: +8 % per level
  golem: { name: "Golem Whisperer", max: 1, element: "earth", text: "Boss and mini boss creeps 25% cheaper, +10% HP" }, // v0.10n; v0.27kF: also mini bosses
  crowd: { name: "Crowd Control", max: 3, element: "plague", text: "When {crowdMax}+ creeps in field, weakest 3 are culled. Triggers every 5 seconds.", detail: "When {crowdMax} or more creeps are in your field, the 3 weakest are culled, never shielded ones. Triggers every 5 seconds. Each culled creep goes back to its owner as an undead creep of its tier, worth a little income" }, // v0.23: 50 or more, Divine Shield spared, one undead per culled creep // v0.20d: Plague, fewer creeps per level, an undead creep goes back
  pillage: { name: "Pillage", max: 3, text: "Steal {pillage} gold on breakthrough" }, // v0.22m2: 14 / 24 / 30 % of the breached player's gold
  // v0.12: nine new perks
  lone: { name: "Spartans", max: 5, element: "storm", // v0.24p: Storm; v0.23zi: Last Guardians → Spartans; v0.23v: 5 levels
    text: "Towers attack {lone} faster with {loneTowers} towers or fewer", detail: "All towers attack {lone} faster while you own {loneTowers} towers or fewer. Towers that do not fight count as 1/4, Walls as 1/10." }, // v0.22g1: 4 levels // v0.20c: no bracket note; v0.16h: back to the v0.13 effect; v0.19g1: was Lone Guardians
  manufacture: { name: "Creep Manufacture", max: 3, element: "earth", text: "8th creep {manufacture} cheaper, recruits 15% faster", detail: "8th creep of every tier {manufacture} cheaper, recruits 15% faster" }, // v0.20d: Earth, 8th creep
  synthesizer: { name: "Creep Synthesizer", max: 3, element: "water", text: "3rd creep {synthesizer} cheaper, recruits 12% faster", detail: "3rd creep of every tier {synthesizer} cheaper, recruits 12% faster" }, // v0.20d; v0.28.004F: 3rd creep (was 4th)
  scholar: { name: "Scholar", max: 10, element: "arcane", text: "Upgrades 2 non-Arcane perks. EXP +{scholar}", detail: "Upgrades 2 of your non-Arcane perks. EXP gain +{scholar}" }, // v0.20d
  summon: { name: "Summon Tower", max: 1, element: "arcane", powerup: true, text: "Summons a random level 1–3 tower", detail: "Summons a random level 1-3 tower on a free field" }, // v0.20c: no bracket note
  nobility: { name: "Heavy Nobility", max: 3, element: "earth", text: "Heavy creeps {nobility} cheaper, +{nobilityHp} HP", detail: "Heavy creeps {nobility} cheaper, +{nobilityHp} HP, restock 10% faster" },
  breeding: { name: "Breeding Pools", max: 3, element: "plague", text: "Spawner creeps {breedingCost} cheaper, +1 spawn, +{breedingHp} HP", textLv1: "Spawner creeps {breedingCost} cheaper, +1 spawn", // v0.27eF: level 1 tooltip without the level 2 HP bonus
     detail: "Spawner creeps (creeps that spawn others on death) cost {breedingCost} less and spawn one more creep. From level 2 spawners and their spawns get +25% HP per level" }, // v0.27aF: reworked // v0.19j: tooltip
  pillar: { name: "Pillar of Fire", max: 5, element: "fire", text: "Active: fire pillar, {pillar} damage every 0.3 s", detail: "Active ability: a pillar of fire burns an area, {pillar} damage every 0.3 s" }, // v0.19j: shorter tooltip
  fort: { name: "Fortifications", max: 1, text: "Builds a row of Walls with one gap. Unlocks the Wall: 4 gold", detail: "Builds a full row of Walls with one free field at its left or right end, on the free row farthest from your towers. Unlocks the Wall: 4 gold, no attack. Double-tap sells it for 1 gold" }, // v0.26fF: a row of walls
  agolem: { name: "Arcane Golem", max: 5, element: "arcane", text: "Active: a golem knocks creeps back up your path", detail: "Active ability: a golem walks up your path, knocks creeps back, then runs on to the next lane" },
  // v0.14: two new perks
  slave: { name: "Slave Labour", max: 5, element: "plague", text: "1st creep: +{slaveStock} stock, recruits {slaveSpeed} faster", detail: "1st creep of every tier: +{slaveStock} max stock, recruits {slaveSpeed} faster" },
  guardian: { name: "Water Shield", max: 10, element: "water", text: "Every {guardCd} s your strongest new creep gets a {guardShield} HP shield", detail: "Every {guardCd} s your strongest new creep gets a water shield of {guardShield} HP, magic damage −{guardMagic} while it holds" },
  // v0.18h: four new perks; "unpopular" = the share by which the offer chance drops after each refusal
  quarry: { name: "Quarry", max: 1, element: "earth", powerup: true, unpopular: 0.5, text: "+{quarryGold} gold and 8 stones. Clear them for an Earth perk", detail: "Instantly +{quarryGold} gold and 8 stones on your field. Clear them all for a random Earth perk" }, // v0.24s: gold by round
  backup: { name: "Backup Line", max: 3, element: "storm", unpopular: 0.5, text: "Archer-Line +{backup} attack speed while top {backupRows} rows are empty", detail: "Archer-Line towers +{backup} attack speed while your top {backupRows} rows hold no tower. Lv. 3: one mist row less" }, // v0.24q
  tides: { name: "Low Tides", max: 3, element: "water", unpopular: 0.5, text: "Melee towers +{tides} damage while bottom {tidesRows} rows are empty", detail: "Melee towers +{tides} damage while your bottom {tidesRows} rows hold no tower. Lv. 3: one water row less" }, // v0.24q
  sanction: { name: "Sanction Policy", max: 1, element: "arcane", text: "Every 2nd creep locked, others +15% income, cooldowns −15%", detail: "Every 2nd creep locked for 20 rounds, the other creeps +15% income. Abilities cooldown 15% faster permanently" }, // v0.23: the 1st creep's +7.5 % named // v0.19h1: no gold, cooldown 15 % (the tier boss is still locked)
  monsun: { name: "Monsun", max: 5, element: "storm", text: "Active: pushes creeps back for {monsun} s", detail: "Active ability: Push creeps back for {monsun} s, lightning strikes flyers" },
  // v0.21: the former level-up upgrades (Warcraft researches) are ordinary perks now. "element" = needs that
  // element. v0.21g: every one of them needs its element now (before, six only wore the element's frame).
  owl: { name: "Watcher Owl", max: 5, element: "storm", text: "Archer-Line +{owl} range" },
  carmor: { name: "Creep Armor", max: 20, element: "earth", text: "Creep HP +{carmorHp}, income +{carmorInc}. Lv 2+: 4th+ creeps +{carmorArmor} armor", detail: "Creep HP +{carmorHp} and income +{carmorInc}. From level 2 the creeps from the 4th place of every tier on get armor: {carmorArmor}" }, // v0.27oF
  leadership: { name: "Leadership", max: 20, element: "fire", text: "Creeps +{leadership} HP, creep income +{leadershipInc}" }, // v0.27aF: +1 % creep income per level
  alchemist: { name: "Poison Alchemist", max: 10, element: "plague", text: "Your poisons last {alchemistDur} longer, max stacks +{alchemistStacks}" }, // v0.27aF
  tailwind: { name: "Tailwind", max: 10, element: "storm", text: "Creep Speed +{tailwind}, creep income +{tailwindInc}" }, // v0.28.004F: income
  mind: { name: "Obsession", max: 10, element: "plague", text: "Creep HP +{mindHp}, speed +{mindSpeed} (flyers half)" }, // v0.23: flyers get half (MIND.air); v0.26cF: Mind Control → Obsession
  medicine: { name: "Creep Medicine", max: 20, element: "water", text: "Creep HP +{medHp}, creep income +{medInc}" },
  melee: { name: "Melee Protocol", max: 20, element: "water", text: "Melee attack speed +{melee}" },
  heavy: { name: "Heavy Weapons", max: 20, element: "earth", text: "Footman-Line and Bombard-Line +{heavy} damage" },
  bank: { name: "Magic Bank", max: 3, element: "arcane", text: "{bank} interest per round", detail: "{bank} interest on your gold at the start of each round" },
  frenzy: { name: "Unholy Frenzy", max: 20, element: "plague", text: "All towers attack speed +{frenzy}" },
  wolves: { name: "Spirit Wolves", max: 10, element: "arcane", text: "1 Spirit Wolf per round, stronger every level. It gives income" }, // v0.21k: one wolf per round
  firearrows: { name: "Fire Arrows", max: 20, element: "fire", text: "Archer-Line +{firearrows} damage" }, // v0.21c: tooltip
  forge: { name: "Creep Forge", max: 3, element: "fire", text: "6th creep {forge} cheaper, recruits 12% faster", detail: "6th creep of every tier {forge} cheaper, recruits 12% faster" }, // v0.21c
  autoloader: { name: "Autoloader", max: 10, element: "earth", text: "Bombard-Line attack speed +{autoloader}" }, // v0.22g1: +7.5 % per level
  // v0.26cF: two new perks. Ring of Life: neutral, never offered to a player who owns Plague, Fire or Arcane ("x" elements), drawn 25 % less often
  ring: { name: "Ring of Life", max: 3, weight: 0.75, element: ["xplague", "xfire", "xarcane"], text: "Creep HP +{ringHp}. 1st creep of each tier +{ringInc} income", detail: "Every creep gets more HP by its tier: +{ringHpTiers} (T1 / T2 / T3 / T4 / T5). The 1st creep of every tier gives +{ringInc} income" },
  // v0.26eF: Amnesia: forget one of 3 owned perks for good, get 1 + its level extra reward dialogs
  amnesia: { name: "Amnesia", max: 1, powerup: true, unpopular: 0.5, text: "Forget a perk and get reward points according to perk level.", detail: "Choose 1 of 3 random perks you own and forget it. It is never offered again this match. You get 1 + its level extra level-up rewards" },
  scouting: { name: "Scouting", max: 3, element: "storm", text: "Scouting EXP +{scouting}", detail: "Increases the EXP your creeps earn while crossing the lines of an enemy maze (Scouting) by {scouting}" }, // v0.27bF
  revenge: { name: "Revenge", max: 3, element: "fire", text: "Enemy breach: a Fire Wolf ({revengeHp} HP) runs onto its sender's field", detail: "Whenever an enemy creep breaches through your field, a Fire Wolf with {revengeHp} HP runs onto the field of the player who sent it. Each Fire Wolf gives +{revengeInc} income" },
});
/** v0.09q: Arrow Volley: cooldown, area radius in fields, arrows per perk level, extra base damage. */
export const VOLLEY = { cooldown: 20, cdStep: 1, radius: 1.5, perLevel: 3, bonus: 3, spread: 0.9, archer: 1.5, perRound: 0.005, perTower: 2, perTowerLevel: 0.15, killExp: 3 }; // v0.27aF: kills by the volley give 300 % EXP // v0.19g1: archer-tower arrows +50 %, all arrows +0.5 % per round
/** v0.21c: Arrow Volley cooldown by perk level: 20 s at level 1, 1 s less per further level. */
export const volleyCd = (level) => VOLLEY.cooldown - VOLLEY.cdStep * Math.max(0, (level | 0) - 1);
/** v0.19g1: Novice: EXP gain per perk level (1–5). */
export const NOVICE = [0, 0.12, 0.24, 0.36]; // v0.26fF: +12 % per level, max level 3; // v0.22m2: 15 / 30 / 45 / 60 / 75 % (was 20 / 35 / 50 / 60 / 70)
/** v0.19h1: Pillage: share of the breached player's gold per level. */
export const PILLAGE = { shares: [0, 0.14, 0.24, 0.3], max: 3 }; // v0.22m2: 14 / 24 / 30 % (was 12 % per level)
/** Research that only an element unlocks: its element (for colour and frame in the dialog). */
export const RESEARCH_ELEMENT = Object.freeze({ R002: "water", R005: "earth", R006: "arcane", R00K: "storm", R00C: "plague", R00J: "fire", R00U: "earth", R00V: "fire", R00W: "storm", R00X: "plague", R001: "water", R00D: "arcane" });
const perkLevel = (p, id) => p?.perks?.[id] || 0;
/** v0.12: element(s) a perk needs; Fortifications takes Earth or Water. */
/** v0.21: the former researches and the perks that replace them (old saves are converted in restoreGame). */
export const RESEARCH_PERKS = Object.freeze({ R00K: "owl", R00U: "carmor", R00V: "leadership", R00W: "tailwind", R00X: "mind", R001: "medicine", R002: "melee", R005: "heavy", R006: "bank", R00C: "frenzy", R00D: "wolves", R00J: "firearrows" });
/** v0.21: element(s) a perk shows (frame, card-book section): its required element, else its "look". */
export const perkLook = (id) => (perkElements(id).length ? perkElements(id) : [].concat(PERKS[id]?.look || []));
/** v0.21: Fire Arrows: +10 % damage per level for the arrow towers (the units of the original arrow upgrade R01P). */
export const FIRE_ARROWS = 0.1;

const isArrowUnit = (item) => archerLine().has(item.id); // v0.22j1: Fire Arrows works on the whole Archer-Line (was the R01P list, without Headhunter and Naga Archer)
export const perkElements = (id) => [].concat(PERKS[id]?.element || []).filter((el) => !/^x/i.test(el));
/** v0.18h: elements written with an X in front ("xwater"): the perk is never offered to a player who owns that element. */
export const perkExcluded = (id) => [].concat(PERKS[id]?.element || []).filter((el) => /^x/i.test(el)).map((el) => el.slice(1).toLowerCase());
const ownsElement = (p, el) => !!p.research[FACTIONS.find((f) => f.id === el)?.unlock];
// ---- v0.12: new perks -------------------------------------------------------------------
/** Lone Guardians: tower limit and attack speed bonus. */
export const LONE = { towers: [0, 5, 6, 7, 8, 9], // v0.23u: one more tower from level 2 on (5 / 6 / 7 / 8 / 9)
  speed: [0, 0.75, 1.0, 1.2, 1.33, 1.5], // v0.23v: 5 levels, 75 / 100 / 120 / 133 / 150 %
  wall: 0.1, support: 0.25 }; // v0.23j: non-fighting towers count 0.25 // v0.22g1: 4 levels, 75 / 125 / 150 / 166 %, 6 towers on level 3, 7 on level 4; v0.17n: a Wall counts as 0.1 tower
const loneLv = (lv) => Math.max(0, Math.min(LONE.speed.length - 1, lv | 0));
/** v0.22g1: Last Guardians: tower limit and attack speed bonus of a perk level. */
export const loneTowers = (lv) => LONE.towers[loneLv(lv)];
export const loneSpeed = (lv) => LONE.speed[loneLv(lv)];
/** v0.22g1: Last Guardians active: the player owns the perk and no more towers than its level allows. */
export const loneActive = (p) => perkLevel(p, "lone") > 0 && loneCount(p) <= loneTowers(perkLevel(p, "lone")) + 1e-6;
/** v0.17n: towers counted for Lone Guardians (Walls 0.1, everything else 1). */
/** v0.18b: Feudality: creep income bonus per level (1–5). */
export const FEUDAL = [0, 0.02, 0.035, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12]; // v0.20b: levels 6–10 +1 % each
export const feudalBonus = (level) => FEUDAL[Math.max(0, Math.min(FEUDAL.length - 1, level | 0))] || 0;
/**
 * v0.18b: perks that buff this tower right now (for the tooltip): Archery (archer line),
 * Lone Guardians (while you own 5 towers or fewer), High Voltage (EXP generators).
 */
export function towerPerkBuffs(game, index, id) {
  const p = game?.players?.[index],
    item = obj(id);
  if (!p || !item) return [];
  const out = [],
    rs = p.research || {};
  // v0.21: Melee Protocol, Heavy Weapons, Unholy Frenzy and Fire Arrows are perks now
  const lv = (id) => perkLevel(p, id);
  if (lv("melee") && isMeleeTower(item)) out.push({ id: "melee", level: lv("melee"), text: `+${Math.round(MELEE_PROTOCOL * 100 * lv("melee"))}% attack speed` });
  if (lv("heavy") && item.isBuildable && item.attacks && (footmanLine().has(item.id) || lineSet("h02R").has(item.id))) out.push({ id: "heavy", level: lv("heavy"), text: `+${Math.round(HEAVY_WEAPONS * 100 * lv("heavy"))}% damage` });
  if (lv("frenzy") && item.isBuildable && item.attacks) out.push({ id: "frenzy", level: lv("frenzy"), text: `+${Math.round(FRENZY * 100 * lv("frenzy"))}% attack speed` });
  if (lv("firearrows") && item.isBuildable && item.attacks && isArrowUnit(item)) out.push({ id: "firearrows", level: lv("firearrows"), text: `+${Math.round(FIRE_ARROWS * 100 * lv("firearrows"))}% damage` });
  if (!p.perks) return out;
  if (lv("autoloader") && item.isBuildable && item.attacks && isBombardLine(item)) out.push({ id: "autoloader", level: lv("autoloader"), text: `+${Math.round(AUTOLOADER * 1000 * lv("autoloader")) / 10}% attack speed` }); // v0.22g1
  if (lv("stormfeathers") && item.isBuildable && item.attacks && archerLine().has(item.id)) out.push({ id: "stormfeathers", level: lv("stormfeathers"), text: `+${Math.round(STORMFEATHERS * 100 * lv("stormfeathers"))}% attack speed` }); // v0.22h1
  if (lv("militia") && item.isBuildable && item.attacks && footmanLine().has(item.id)) out.push({ id: "militia", level: 1, text: `+${MILITIA_DAMAGE} damage` }); // v0.22g1
  if (perkLevel(p, "gunpowder") && item.isBuildable && item.attacks && (isCannonTower(item) || lineSet("h02R").has(item.id))) out.push({ id: "gunpowder", level: perkLevel(p, "gunpowder"), text: `+${gunpowderTiles(perkLevel(p, "gunpowder"))} tiles splash` });
  if (perkLevel(p, "archery") && archerLine().has(item.id)) out.push({ id: "archery", level: perkLevel(p, "archery"), text: `+${5 * perkLevel(p, "archery")}% damage` });
  if (lv("owl") && item.isBuildable && item.attacks && archerLine().has(item.id)) out.push({ id: "owl", level: lv("owl"), text: `+${Math.round(owlRange(lv("owl")) * 100) / 100} fields range` }); // v0.27zzlF: Watcher Owl was missing
  if (loneActive(p) && item.isBuildable && item.attacks) out.push({ id: "lone", level: perkLevel(p, "lone"), text: `+${Math.round(loneSpeed(perkLevel(p, "lone")) * 100)}% attack speed` });
  if (item.isBuildable && item.attacks && p.backupOn && perkLevel(p, "backup") && archerLine().has(item.id)) out.push({ id: "backup", level: perkLevel(p, "backup"), text: `+${Math.round(backupSpeed(perkLevel(p, "backup")) * 100)}% attack speed` }); // v0.18h; v0.24q: Archer-Line attack speed
  if (item.isBuildable && item.attacks && p.tidesOn && perkLevel(p, "tides") && isMeleeTower(item)) out.push({ id: "tides", level: perkLevel(p, "tides"), text: `+${Math.round(tidesDamage(perkLevel(p, "tides")) * 100)}% damage` });
  if (perkLevel(p, "voltage") && item.woodIncome) out.push({ id: "voltage", level: perkLevel(p, "voltage"), text: `+${Math.round(VOLTAGE.bonus * 100 * perkLevel(p, "voltage"))}% EXP` });
  return out;
}
/** v0.23j: what a tower counts for Last Guardians: a Wall 0.1, a tower that does not fight 0.25, every other tower 1. */
export const loneWeight = (id) => (id === WALL_ID ? LONE.wall : obj(id)?.attacks ? 1 : LONE.support);
export const loneCount = (p) => (p?.towers || []).reduce((n, t) => n + loneWeight(t.typeId), 0);
/** v0.13: Watcher Owl (research R00K): extra range of archer-line towers per level, in fields. */
export const OWL = { range: [0.5, 0.33, 0.25, 0.2, 0.17] }; // v0.19a1: five levels
export const owlRange = (level) => OWL.range.slice(0, Math.max(0, Math.min(OWL.range.length, level))).reduce((a, b) => a + b, 0);
/** Creep Manufacture (Water): discount of the 4th creep of each tier by level, restock bonus. */
export const MANUFACTURE = { discount: [0.15, 0.25, 0.33], restock: 1.15 }; // v0.20d: 8th creep, recruits 15 % faster
/** v0.20d: Creep Synthesizer (Water): the 4th creep of every tier. */
export const SYNTHESIZER = { discount: [0.12, 0.2, 0.26], restock: 1.12 };
/** v0.21c: Creep Forge (Fire): the 6th creep of every tier. */
export const FORGE = { discount: [0.12, 0.2, 0.26], restock: 1.12 };
/** v0.20d: Scholar (Arcane): EXP gain per level. */
export const SCHOLAR = { exp: 0.1, upgrades: 2 };
/** Heavy Nobility (Earth): discount by level, hit points per level, restock bonus. */
export const NOBILITY = { discount: [0.1, 0.18, 0.24], hp: 0.12, restock: 1.1 };
/** Breeding Pools (Plague): chance of an extra death spawn by level, hit points per level. */
export const BREEDING = { discount: 0.1, extra: 1, hp: 0.25 }; // v0.27aF: level 1: spawners 10 % cheaper, +1 spawn; from level 2 +25 % HP per level
export const breedingHp = (level) => BREEDING.hp * Math.max(0, Math.min(3, level | 0) - 1);
/** v0.27aF: Poison Alchemist (Plague): +25 % poison duration and +1 max poison stack per level. */
export const ALCHEMIST = { duration: 0.25, stacks: 1 };
export const LEADERSHIP_INCOME = 0.01; // v0.27aF: Leadership +1 % creep income per level
/** Pillar of Fire (Fire): cooldown, radius in fields, delay, burn time, damage interval, scorch time. */
export const PILLAR = { cooldown: 75, radius: 2.2, core: 0.75, delay: 0.5, duration: 1.5, interval: 0.3, scorch: 15, air: 0.5, budget: 1.5 };
// v0.19b1: grows steeply with the send tier (like creep hit points) and +5 % per player level
export const PILLAR_TIER = [1, 4, 10, 25, 60, 120];
export const PILLAR_DAMAGE_TIER = [1, 5, 12.5, 31, 75, 150]; // v0.22: Pillar of Fire +25 % from tier 2 (Fire Block and Air Block keep PILLAR_TIER)
export const pillarDamage = (p, level = perkLevel(p, "pillar")) =>
  Math.round((12 + 10 * level) * PILLAR_DAMAGE_TIER[Math.max(1, Math.min(PILLAR_TIER.length, p?.tier || 1)) - 1] * (1 + 0.05 * (p?.level || 1)));
/** Arcane Golem (Arcane): cooldown, knock-back in fields and hit point loss per collision by level. */
// v0.24i: 2 % of its hit points per creep pushed back at every level (was 1 % → 0.7 %); the creep takes the matching damage
// (10 × that loss, as before); knock-back at level 1 −10 % (1 → 0.9 fields)
export const AGOLEM = { cooldown: 50, knock: [0.9, 1.25, 1.5, 1.75, 2], loss: [0.02, 0.02, 0.02, 0.02, 0.02], heavy: 3, damage: 10, reach: 0.45 };
export const golemHp = (p, level = perkLevel(p, "agolem")) => Math.round(level * (p?.tier || 1) * (400 * ((p?.level || 1) * 0.2) + 1));
/** Monsun (Storm): cooldown, duration by level, lightning interval; push in fields per second (before the arena's 45 %). */
export const MONSUN = { cooldown: 50, // v0.19j: +5 s; v0.24j: 45 → 50 s
  duration: [5, 6, 7, 8, 9], strike: 0.5, groundShare: 0.5, walk: 0.25 }; // v0.24j: levels 2+ 6 / 7 / 8 / 9 s (was 7 / 9 / 11 / 13); v0.19k: ground creeps walk at 25 % in the storm // v0.16g: +1 s per level
export const monsunForce = (p, level = perkLevel(p, "monsun")) => 0.48 + level * 0.23 + (p?.tier || 1) * 0.02; // v0.16g: +0.10 per level; v0.19j: a little stronger
export const monsunDamage = (p, level = perkLevel(p, "monsun")) => 30 + 20 * level * (p?.tier || 1);
/** Perks that skip the next level once taken. */
/** v0.20c: perks that sit out more than one level after a pick (Supergrowth: two). */
/** v0.26dF: levels a perk sits out after a pick when PERK_SKIP_LEVELS has no value for it. */
const PERK_SKIP_DEFAULT = 2;
const PERK_SKIP_LEVELS = { carmor: 3, breeding: 3, novice: 3, wolves: 3, mind: 3, exhume: 3, ring: 3, revenge: 3, backup: 3, tides: 3, supergrowth: 2, hellfire: 2, frostbolt: 2, clones: 2, infested: 2, lone: 2, bank: 3, monsun: 2 }; // v0.28.004F: Ring of Life skips 3 (was 2); v0.26cF: Spirit Wolves, Obsession, Exhumination, Revenge skip 3 // v0.24q: Backup Line, Low Tides skip 3 // v0.24j: Monsun skips 2 // v0.24i: Magic Bank skips 3 // v0.23zi: Spartans skip 2 // v0.23w: Frost Bolt, Clones // v0.21x: Lava Floor skips 2
const PERK_SKIP = new Set(["pillar", "agolem", "monsun", "slave", "guardian", "mind", "tailwind", "carmor", "owl", "autoloader", "hills"]); // v0.22g1: Autoloader // v0.19a1: Mind Control, Tailwind, Creep Armor, Watcher Owl
/**
 * v0.19a1: reworked level-up upgrades (research perks). Their effects live here instead of the map
 * data: max level, Melee Protocol (+10 % melee attack speed, v0.22g1), Unholy Frenzy (+2 % for all towers),
 * Healing Power, Magic Bank (interest on idle gold), Mind Control, Tailwind, Creep Armor, Spirit Wolves.
 */
export const researchMax = (item) => Math.min(item?.maxLevel || 1, 11);
export const MELEE_PROTOCOL = 0.1; // v0.22g1: 10 % per level (was 8 %)
/** v0.22g1: Autoloader: Bombard-Line attack speed per level. */
export const AUTOLOADER = 0.06; // v0.22i1: 6 % per level (was 7.5 %)
/** v0.22h1: Stormfeathers: Archer-line attack speed per level. */
export const STORMFEATHERS = 0.08;
/** v0.22h1: Frozen Ground (was Permafrost): ground creep slow per level. */
export const FROZEN_GROUND = 0.05;
/** v0.22h1: Hill Paths: slow of ground creeps on upward path steps, by level. */
export const HILLS = [0, 0.1, 0.19, 0.27, 0.34, 0.4]; // v0.24q: +(11 − level) % per level
/** v0.22g1: Militia: Footman-Line damage once taken. */
export const MILITIA_DAMAGE = 1;
/** v0.22j1: Bounty Bonus (towers with the ability): extra bounty per kill. */
export const BOUNTY_BONUS = 0.2;
export const HEAVY_WEAPONS = 0.05; // v0.19j: per level, Footman and Bombard lines
export const FRENZY = 0.02;
export const LEADERSHIP = 0.1;
export const HEALING = { hp: 0.05, income: 0.02 };
export const BANK = { rate: 0.05, cap: 50000 };
/** v0.24i: Magic Bank interest by perk level: 5 % at level 1, each further level adds 5 % − level × 1 % (8 %, 10 %). */
export const bankRate = (level) => {
  let r = level > 0 ? BANK.rate : 0;
  for (let k = 2; k <= level; k++) r += Math.max(0, 0.05 - 0.01 * k);
  return r;
};
export const MIND = { hp: 0.1, speed: 0.1, air: 0.5 };
export const TAILWIND = { speed: 0.1, income: 0.02, incomePer: 0.01 }; // v0.28.004F: + (2 + 1 per level) % creep income
export const CREEP_ARMOR = { hp: 0.08, hpLater: 0.06, income: 0.015, armorFrom: 2, place: 4, armorMax: 20, step: 0.2 }; // v0.27oF; v0.27pF: armorMax, step
/** v0.27oF: Creep Armor HP: 8 % at level 1, +6 % per level after it. */
export const creepArmorHp = (level) => (level > 0 ? CREEP_ARMOR.hp + CREEP_ARMOR.hpLater * (level - 1) : 0);
/**
 * v0.27oF: from level 2, the creeps from the 4th place of their tier on get armor. v0.27pF: a smooth line instead of
 * the jump from 0 to 2: level 2 gives 1.0, then evenly up to 20 at level 20, in steps of 0.2 (1.0, 2.2, 3.2, 4.2, 5.2 …).
 */
export const creepArmorValue = (level) =>
  level >= CREEP_ARMOR.armorFrom ? Math.round(((level - 1) * CREEP_ARMOR.armorMax) / (CREEP_ARMOR.armorMax - 1) / CREEP_ARMOR.step) / Math.round(1 / CREEP_ARMOR.step) : 0; // whole fifths: no float tails
export const creepArmorBonus = (level, item) => (level >= CREEP_ARMOR.armorFrom && item && tierSends(item.tier).findIndex((s) => s.id === item.id) >= CREEP_ARMOR.place - 1 ? creepArmorValue(level) : 0);
/** Spirit Wolves: one wolf per level and round; -25 % income in the first 15 rounds; buffs by perk level, player level and tier; 300 % more magic damage taken. */
/** v0.19d2: Spirit Wolf HP by round: 40 % before round 5, 60 % in 5–10, 80 % in 11–15, full from 16, +0.2 % per round from round 40. */
export const wolfRoundHp = (round) => (round < 5 ? 0.4 : round <= 10 ? 0.6 : round <= 15 ? 0.8 : round >= 40 ? 1 + 0.002 * (round - 39) : 1);
export const WOLVES = { hpScale: 0.75, ids: ["n01Z", "n020", "n024", "n035", "n02T", "n01K"], early: 15, earlyIncome: 0.75, hp: 4, hpPerLevel: 0.4, hpPerTier: 200, speed: 0.02, speedPerLevel: 0.004, speedPerTier: 0.03, magic: 3, tierIncome: [0, 2, 4, 8, 16, 32] };
/** v0.19b1: income of one Spirit Wolf: tier part (0 / 2 / 4 / 8 / 16 / 32) plus perk level part (2, 4, 8 … 1024). */
// v0.21i: halved (WOLVES_INCOME); the night test showed Spirit Wolves far ahead of every other perk
export const WOLVES_INCOME = 0.5;
export const wolfIncome = (tier, level) => ((WOLVES.tierIncome[Math.max(1, Math.min(6, tier || 1)) - 1] || 0) + 2 ** Math.max(1, level || 1)) * WOLVES_INCOME;
/** Units the creep perks act on: every send plus what they summon (the creep list of Leadership in the map data). */
let CREEP_UNITS = null;
const isCreepUnit = (item) => {
  if (!item || item.isBuildable) return false;
  if (!CREEP_UNITS) CREEP_UNITS = new Set(getCatalog().byId.R00V?.affectedUnits || []);
  return !!item.isSend || CREEP_UNITS.has(item.id);
};
/** v0.19a1: Blood / Unholy Contract: bonus share of the 9th / 7th creep of each tier once won (v0.19d2: per kind of bonus). */
function contractShare(p, item, kind = "hp") {
  if (!item?.isSend || item.bossTier || !p?.questLog) return 0;
  let share = 0;
  for (const [id, result] of Object.entries(p.questLog)) {
    const q = QUESTS[id];
    if (q?.kind === "contract" && result === "won" && (q.gives || ["hp", "income", "discount"]).includes(kind) && tierSends(item.tier)[q.place - 1]?.id === item.id) share += q.share;
  }
  return share;
}
/** v0.14: Slave Labour (Plague): first creep of every tier gets more stock and faster restock. v0.27dF: +1 stock per level, 20 / 35 / 45 / 50 / 55 % faster, max level 5. */
export const SLAVE = { stock: 1, speed: [0.2, 0.15, 0.1, 0.05, 0.05], max: 5 };
export const slaveSpeed = (level) => SLAVE.speed.slice(0, Math.max(0, Math.min(SLAVE.max, level))).reduce((a, b) => a + b, 0);
const firstOfTier = (item) => !!item?.isSend && !item.bossTier && tierSends(item.tier)[0]?.id === item.id;
/**
 * v0.14: River Guardian (Water): every 15 s the strongest creep among those sent in the next
 * 1.2 s gets a water shield. Shield = maxHp × (12 % + 4 % × level), i.e. 16 % … 32 %; while it
 * holds, magic damage is cut by 15 % + 5 % × level (20 % … 40 %). Damage hits the shield first.
 */
export const GUARDIAN = { cooldown: 15, window: 1.2, shield: 0.12, shieldPerLevel: 0.04, magic: 0.15, magicPerLevel: 0.05 };
export const guardShare = (level) => GUARDIAN.shield + GUARDIAN.shieldPerLevel * level; // (before v0.20c)
/** v0.20c: River Guardian shield HP from perk level, the player's tier and the round (no longer from the creep's HP). */
export const GUARD_TIER = [100, 600, 2400, 6000, 12000, 24000];
export const guardShieldHp = (p, game, level = Math.min(10, perkLevel(p, "guardian"))) => // v0.21e: up to level 10
  Math.round(GUARD_TIER[Math.max(1, Math.min(GUARD_TIER.length, p?.tier || 1)) - 1] * (1 + 0.5 * (Math.max(1, level) - 1)) * (1 + 0.005 * Math.max(0, game?.round || 0))); // v0.20d: +0.5 % per round
export const guardMagic = (level) => GUARDIAN.magic + GUARDIAN.magicPerLevel * level;
function guardianSend(game, p) {
  if (!perkLevel(p, "guardian") || p.guardWindow || (p.guardReady || 0) > game.time + EPS) return;
  p.guardWindow = { fromTick: game.tick, until: game.time + GUARDIAN.window };
}
function tickGuardian(game, p) {
  const w = p.guardWindow;
  if (!w || game.time + EPS < w.until) return;
  p.guardWindow = null;
  let best = null;
  for (const q of game.players)
    for (const c of q.creeps)
      if (c.owner === p.id && !c.dead && c.hp > 0 && !c.wave && !c.guard && c.bornTick >= w.fromTick && (!best || c.maxHp > best.maxHp)) best = c;
  if (!best) return; // nothing left to buff: the next send opens a new window
  const level = Math.min(10, perkLevel(p, "guardian")), // v0.21e
    hp = guardShieldHp(p, game, level); // v0.20c
  best.guard = { hp, max: hp, magic: guardMagic(level) };
  p.guardReady = game.time + GUARDIAN.cooldown;
  emit(game, "skill", { player: best.defender, kind: "guardOn", creepId: best.id, x: best.x, y: best.y });
}
/** v0.23: Magic Resistance also cuts perk spell damage (Arcane Burst, Pillar of Fire, Fire Block, Monsun, Air Block, Arcane Golem); applied before the shield, like tower magic. */
function spellResist(c) {
  const resist = creepSkills(c).find((sk) => sk.type === "magicResist");
  return resist ? 1 - resist.reduce : 1;
}
/** Damage after a River Guardian shield took its share (magic is reduced first). */
function guardCut(game, c, damage, magic = false) {
  const g = c.guard;
  if (!g || !(damage > 0)) return damage;
  if (magic) damage *= 1 - g.magic;
  const take = Math.min(g.hp, damage);
  g.hp -= take;
  if (g.hp <= 0.5) {
    c.guard = null;
    emit(game, "skill", { player: c.defender, kind: "guardBreak", creepId: c.id, x: c.x, y: c.y });
  }
  return damage - take;
}
/** Creep ids with a death spawn (Breeding Pools; never "heavy"). */
const DEATH_PLANS = {
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
  n02E: [
    ["n038", 0],
    ["n038", 0.3],
    ["n038", 0.6],
    ["n038", 0.9],
  ],
};
/** v0.24s: every creep type that can spawn from the death of `id` (death plans, Spawn Spider & co, spawnOnDeath skills). */
export function deathSpawnTypes(id) {
  const out = [],
    add = (t) => obj(t) && !out.includes(t) && out.push(t);
  for (const [t] of DEATH_PLANS[id] || []) add(t);
  if (id === "n03A" || id === "n037") ["n02Z", "n034", "n02Y", "n036", "n037"].forEach(add);
  for (const sk of creepSkills({ typeId: id })) if (sk.type === "spawnOnDeath") add(sk.id);
  return out;
}
export function hasDeathrattle(id) {
  if (DEATH_PLANS[id] || id === "n03A" || id === "n037") return true;
  return !!obj(id) && creepSkills({ typeId: id }).some((sk) => sk.type === "spawnOnDeath");
}
/** Heavy creeps: one creep per purchase, no boss, no death spawn. */
const HEAVY = new Map();
/** v0.21x: heavy despite a death spawn (Cairne Bloodhoof). */
const HEAVY_ALWAYS = new Set(["n01F"]);
export function isHeavy(item) {
  if (!item?.isSend) return false;
  if (!HEAVY.has(item.id)) HEAVY.set(item.id, HEAVY_ALWAYS.has(item.id) || (!item.bossTier && (item.spawnIds?.length || 0) === 1 && !hasDeathrattle(item.id)));
  return HEAVY.get(item.id);
}
/** v0.21v: towers spare heavy creeps only above this share of the field (self-play: the Orc broke through 44 % of the time). */
export const HEAVY_SHY = 0.5;
const heavyCreep = (c) => c.heavy || isHeavy(obj(c.typeId)) || !!obj(c.typeId)?.bossTier || !!c.waveBoss;
/** The 4th creep of a tier (Creep Manufacture). */
const fourthOf = (item) => !!item?.isSend && !item.bossTier && tierSends(item.tier)[3]?.id === item.id;
/** v0.28.004F: Creep Synthesizer works on the 3rd creep of every tier (was the 4th). */
const thirdOf = (item) => !!item?.isSend && !item.bossTier && tierSends(item.tier)[2]?.id === item.id;
const sixthOf = (item) => !!item?.isSend && !item.bossTier && tierSends(item.tier)[5]?.id === item.id; // v0.21c: Creep Forge
const eighthOf = (item) => !!item?.isSend && !item.bossTier && tierSends(item.tier)[7]?.id === item.id; // v0.20d: Creep Manufacture
/** Budget creeps: the first three of a tier and what they bring along (Pillar of Fire). */
let BUDGET = null;
function isBudget(id) {
  if (!BUDGET) {
    BUDGET = new Set();
    for (let tier = 1; tier <= 6; tier++) for (const s of tierSends(tier).slice(0, 3)) [s.id, ...(s.spawnIds || [])].forEach((x) => BUDGET.add(x));
  }
  return BUDGET.has(id);
}
/** Moves a creep back along the way it came (ground: its path; flyers: straight up). */
function pushBack(game, c, units, p = null) {
  if (!(units > 0) || c.dead) return;
  if (creepSkills(c).some((sk) => sk.type === "tierBoss")) units *= TIER_BOSS.push; // v0.22u2: Tier Boss: push-backs 50 % shorter
  else if (creepSkills(c).some((sk) => sk.type === "miniBoss")) units *= 1 - (1 - TIER_BOSS.push) * MINI_BOSS.share; // v0.27F: 25 % shorter
  if (c.flying) {
    const top = c.path?.[0]?.y ?? -0.02;
    c.y = Math.max(top, c.y - units / game.grid.cellUnits / game.grid.rows);
    return;
  }
  let d = units;
  while (d > EPS && c.path?.length) {
    const prev = c.path[c.pathIndex - 1] || (c.pathIndex === 0 ? c.prevNode : null);
    if (!prev) break;
    const seg = dist(game, c, prev);
    if (seg > d) {
      const f = d / seg;
      c.x += (prev.x - c.x) * f;
      c.y += (prev.y - c.y) * f;
      return;
    }
    c.x = prev.x;
    c.y = prev.y;
    d -= seg;
    if (c.pathIndex > 0) c.pathIndex--;
    else {
      c.prevNode = null; // standing on the node it came from: go further back below
      break;
    }
  }
  // v0.19k: the creep's path only reaches back to the last node it passed (paths are rebuilt on every build),
  // so further back it walks up the maze: to the neighbouring field farthest from the exit, which becomes its next way back
  const owner = p || game.players[c.defender ?? -1];
  if (!owner) return;
  let guard = 0;
  while (d > EPS && guard++ < 8) {
    const g = gridAt(game, c);
    if (g.y < 0) return;
    const field = exitField(game, owner),
      here = field[square(game, g.x, g.y)];
    let best = null;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const nx = g.x + dx,
        ny = g.y + dy;
      if (nx < 0 || nx >= game.grid.cols || ny < -1 || ny > laneRows(game, owner) - 1) continue;
      const v = field[square(game, nx, ny)];
      if (v > here && (!best || v > best.v)) best = { x: nx, y: ny, v };
    }
    if (!best) return;
    const to = pos(game, best.x, best.y),
      seg = dist(game, c, to);
    if (seg > d) {
      const f = d / seg;
      c.x += (to.x - c.x) * f;
      c.y += (to.y - c.y) * f;
    } else {
      c.x = to.x;
      c.y = to.y;
    }
    d -= Math.min(d, seg);
    // walk on from here: back through the field it was pushed out of
    c.path = [pos(game, g.x, g.y), ...(c.path || []).slice(c.pathIndex)];
    c.pathIndex = 0;
    c.prevNode = null;
    if (seg <= EPS) return;
  }
}
/** v0.19k: exit distances of a player's maze, cached until the maze changes (a new path array). */
const EXIT_FIELDS = new WeakMap(); // outside the game state, so saves and online sync never carry it
function exitField(game, p) {
  if (!EXIT_FIELDS.has(game)) EXIT_FIELDS.set(game, {});
  const cache = EXIT_FIELDS.get(game),
    hit = cache[p.id];
  if (hit && hit.path === p.path) return hit.d;
  const d = exitDistances(game, p);
  cache[p.id] = { path: p.path, d };
  return d;
}
/** v0.19k: knock-backs glide: the creep slides back over 0.35 s instead of jumping. */
const KNOCK_TIME = 0.35;
function knockBack(game, c, units, p = null) {
  if (!(units > 0) || c.dead) return;
  const left = (c.knock?.left || 0) + units;
  c.knock = { left, rate: left / KNOCK_TIME, p: p?.id ?? c.knock?.p ?? null };
}
/**
 * v0.17q: towers from perks (Summon Tower, Militia) appear 0.3 s after the pick, so the app can
 * first move the player's view to their own field ("summonStart") and then show the arrival.
 */
export const SUMMON_DELAY = 0.3;
function queueSummon(game, p, kind, extra = {}) {
  p.pendingSummons = [...(p.pendingSummons || []), { kind, at: game.time + SUMMON_DELAY, ...extra }];
  emit(game, "summonStart", { player: p.id, kind });
}
function tickSummons(game, p) {
  if (!p.pendingSummons?.length) return;
  const due = p.pendingSummons.filter((s) => s.at <= game.time + EPS);
  if (!due.length) return;
  p.pendingSummons = p.pendingSummons.filter((s) => s.at > game.time + EPS);
  for (const s of due) {
    if (s.kind === "summon") summonTower(game, p);
    else if (s.kind === "militia") placeMilitia(game, p, 2);
    else if (s.kind === "quarry") placeQuarry(game, p, s.left ?? null, s.large ?? null, s.tries || 0); // v0.18h; v0.22o2: retries
    else if (s.kind === "copy") placeCopy(game, p, s.id); // v0.19g1: Evolution
    else if (s.kind === "frost") frostStrike(game, p, s); // v0.27zzaF: Frost Strike
    else if (s.kind === "fort") placeWallRow(game, p); // v0.26fF
  }
}
// ---- v0.18h: Quarry, Backup Line, Low Tides, Sanction Policy ----------------------------------
/** Quarry (Earth): gold, stones (1-3 large, the rest small), demolition prices. */
// v0.19c1: 2–4 large stones (55 % two, 35 % three, 10 % four), demolishing a large stone costs 250
export const QUARRY = { gold: 100, stones: 8, large: [2, 4], largeOdds: [0.55, 0.35, 0.1], price: { small: 50, large: 250 }, exp: { small: 5, large: 15 } }; // v0.22m2: demolishing gives 5 / 15 EXP
/** Free fields where a stone could stand right now (path stays open), at most `limit`. */
function freeCells(game, p, limit = Infinity) {
  const out = [];
  for (let y = 0; y < laneRows(game, p) && out.length < limit; y++)
    for (let x = 0; x < game.grid.cols && out.length < limit; x++) if (canBuild(game, p.id, x, y, ROCK_ID).ok) out.push([x, y]);
  return out;
}
/**
 * v0.22o2: stones that find no field right now (creeps walking there, no juggling, the path must stay open)
 * come a second later instead of never: `left` and `large` carry over in the queued summon.
 */
function placeQuarry(game, p, left = null, largeLeft = null, tries = 0) {
  let large = largeLeft;
  if (large == null) {
    const roll = random(game);
    large = QUARRY.large[0];
    for (let i = 0, acc = 0; i < QUARRY.largeOdds.length; i++) if (roll >= (acc += QUARRY.largeOdds[i])) large = QUARRY.large[0] + i + 1;
    large = Math.min(QUARRY.large[1], large);
  }
  const count = left ?? QUARRY.stones;
  let placed = 0;
  for (let k = 0; k < count; k++) {
    const cells = freeCells(game, p);
    if (!cells.length) break;
    const [x, y] = cells[Math.floor(random(game) * cells.length)],
      t = newTower(game, p, ROCK_ID, x, y),
      kind = k < large ? "large" : "small"; // the large ones first
    t.buildRemaining = 0;
    t.preset = true;
    t.quarry = true;
    t.stone = kind;
    t.stonePrice = QUARRY.price[kind];
    p.towers.push(t);
    p.path = findPath(game, p.id) || [];
    completeTower(game, p, t);
    placed++;
    emit(game, "build", { player: p.id, towerId: t.id, x: t.x, y: t.y, stone: kind });
  }
  if (placed) p.quarryOpen = true;
  const rest = count - placed;
  if (rest > 0 && tries < 600) p.pendingSummons = [...(p.pendingSummons || []), { kind: "quarry", at: game.time + 1, left: rest, large: Math.max(0, large - placed), tries: tries + 1 }];
}
/** All Quarry stones gone: a random Earth perk the player could take (its level window first). */
function finishQuarry(game, p) {
  if (!p.quarryOpen || p.towers.some((t) => t.quarry) || p.pendingSummons?.some((s) => s.kind === "quarry")) return; // v0.22o2: stones still to come
  p.quarryOpen = false;
  const valid = Object.keys(PERKS).filter((id) => id !== "quarry" && perkElements(id).includes("earth") && optionValid(game, p, { type: "perk", id })),
    now = valid.filter((id) => perkAvailable({ type: "perk", id }, p.level, p)),
    pool = now.length ? now : valid;
  if (!pool.length) return emit(game, "quarryPerk", { player: p.id, id: null });
  const id = pool[Math.floor(random(game) * pool.length)];
  applyOption(game, p, { type: "perk", id }, p.level);
  refreshPicks(game, p);
  emit(game, "quarryPerk", { player: p.id, id });
}
/** v0.19b3: the very easy bot takes Quarry 50 % more often than other rewards (it never demolishes stones). */
const STONE_LOVE = 1.5;
/** Backup Line (Storm): top rows; Low Tides (Water): bottom rows. Damage bonus and creep speed in the zone. */
// v0.24q: both up to level 3; Backup Line gives Archer-Line attack speed, Low Tides melee damage (by level); at
// level 3 the zone is one row smaller
export const BACKUP = { rows: 3, speed: [0, 0.25, 0.33, 0.4], slow: 0.1 }; // v0.27mF: no haste while broken
export const TIDES = { rows: 3, damage: [0, 0.4, 0.6, 0.7], slow: 0.25 }; // v0.27mF: no haste while broken; // v0.23zn: Low Tides water rows 4 → 3
export const backupSpeed = (level) => BACKUP.speed[Math.max(0, Math.min(3, level))];
export const tidesDamage = (level) => TIDES.damage[Math.max(0, Math.min(3, level))];
export const backupRows = (p) => BACKUP.rows - (perkLevel(p, "backup") >= 3 ? 1 : 0);
export const tidesRows = (p) => TIDES.rows - (perkLevel(p, "tides") >= 3 ? 1 : 0);
const towerInRows = (p, from, to) => p.towers.some((t) => t.typeId !== ROCK_ID && t.gridY < to && t.gridY + towerSize(t) > from);
/** Rows of a zone and whether its bonus is on (null = the player has no such perk). */
export function zoneOf(game, p, id) {
  const rows = laneRows(game, p);
  if (id === "backup") return perkLevel(p, "backup") ? { from: 0, to: backupRows(p), on: !towerInRows(p, 0, backupRows(p)) } : null;
  if (id === "tides") return perkLevel(p, "tides") ? { from: rows - tidesRows(p), to: rows, on: !towerInRows(p, rows - tidesRows(p), rows) } : null;
  return null;
}
/**
 * v0.23b: conditionalPerk (internal, never shown in the game): perks whose bonus only holds while a condition is
 * kept – Last Guardians (few towers), Backup Line (top rows free), Low Tides (bottom rows free). `cost` is how many
 * towers break the condition (for the next level: `next`), `blocks` whether a new tower there would break it.
 */
export const CONDITIONAL_PERKS = {
  lone: {
    cost: (game, p, next = 0) => Math.max(0, Math.ceil(loneCount(p) - loneTowers(perkLevel(p, "lone") + next) - 1e-6)),
    blocks: (game, p, x, y, id) => loneCount(p) + loneWeight(id) > loneTowers(perkLevel(p, "lone")) + 1e-6,
    offenders: (game, p) => p.towers.filter((t) => t.typeId !== ROCK_ID),
  },
  backup: {
    cost: (game, p) => p.towers.filter((t) => t.typeId !== ROCK_ID && t.gridY < backupRows(p)).length,
    blocks: (game, p, x, y) => y < backupRows(p),
    offenders: (game, p) => p.towers.filter((t) => t.typeId !== ROCK_ID && t.gridY < backupRows(p)),
  },
  tides: {
    cost: (game, p) => p.towers.filter((t) => t.typeId !== ROCK_ID && t.gridY + towerSize(t) > laneRows(game, p) - tidesRows(p)).length,
    blocks: (game, p, x, y, id) => y + (id ? footprintOf(id) : 1) > laneRows(game, p) - tidesRows(p),
    offenders: (game, p) => p.towers.filter((t) => t.typeId !== ROCK_ID && t.gridY + towerSize(t) > laneRows(game, p) - tidesRows(p)),
  },
};
/** Bots: towers they may sell at most to meet a conditionalPerk when picking it. */
const COND_SELL_MAX = 1;
/** v0.23b: a bot that keeps a conditionalPerk's condition does not build where it would break it. */
function aiCondBlocks(game, p, x, y, id) {
  if (!p?.ai || !p.aiCond || id === ROCK_ID) return false;
  for (const [pid, keep] of Object.entries(p.aiCond)) if (keep && perkLevel(p, pid) && CONDITIONAL_PERKS[pid]?.blocks(game, p, x, y, id)) return true;
  return false;
}
/**
 * v0.23b: once a round (or less) a bot decides per owned conditionalPerk whether to keep its condition: it keeps it
 * unless it is better off breaking it (it lost lives last round while short of defence, or is low on lives). While
 * keeping it, it sells the few towers that break it (at most COND_SELL_MAX).
 */
function aiConditions(game, p) {
  if (p.aiCondRound === game.round) return;
  const lost = Math.max(0, (p.aiCondLives ?? p.lives) - p.lives);
  p.aiCondRound = game.round;
  p.aiCondLives = p.lives;
  const out = {};
  for (const pid of Object.keys(CONDITIONAL_PERKS)) {
    if (!perkLevel(p, pid)) continue;
    const c = CONDITIONAL_PERKS[pid],
      cost = c.cost(game, p),
      better = lost >= 3 || (lost > 0 && p.lives <= 8) || cost > COND_SELL_MAX + 1;
    out[pid] = !better;
    if (out[pid] && cost > 0 && cost <= COND_SELL_MAX && !game.warmup) {
      const t = c.offenders(game, p).sort((a, b) => (a.totalSpent || 0) - (b.totalSpent || 0))[0];
      if (t) command(game, { type: "sell", player: p.id, towerId: t.id });
    }
  }
  p.aiCond = out;
}
function tickZones(game, p) {
  p.backupOn = !!zoneOf(game, p, "backup")?.on;
  p.tidesOn = !!zoneOf(game, p, "tides")?.on;
}
/** Speed factor of a creep in the defender's Backup Line mist (all creeps) or Low Tides water (ground). */
function zoneSpeed(game, p, c) {
  if (!perkLevel(p, "backup") && !perkLevel(p, "tides")) return 1;
  const row = gridAt(game, c).y,
    rows = laneRows(game, p);
  let f = 1;
  // v0.27mF: no faster creeps any more while the condition is broken (only the slow while it holds)
  if (p.backupOn && perkLevel(p, "backup") && row >= 0 && row < backupRows(p)) f *= 1 - BACKUP.slow;
  if (p.tidesOn && perkLevel(p, "tides") && !c.flying && row >= rows - tidesRows(p) && row < rows) f *= 1 - TIDES.slow;
  return f;
}
/** Sanction Policy (Arcane): gold, lock length in rounds, income bonus, ability cooldown cut. */
export const SANCTION = { gold: 0, rounds: 20, income: 0.15, first: 0.15, cooldown: 0.15 }; // v0.27zzcF: the 1st creep gets the full +15 % too // v0.19h1: no gold, 15 % shorter cooldowns
/** v0.18h: cooldown of an active ability for this player (Sanction Policy: 20 % shorter). */
export const abilityCd = (p, cd) => cd * (perkLevel(p, "sanction") ? 1 - SANCTION.cooldown : 1);
function lockStock(game, p, id, rounds) {
  const st = (p.stock[id] ||= { count: 0, next: LOCKED_NEXT });
  st.lockRound = Math.max(st.lockRound || 0, game.round) + rounds; // added onto a lock that is still running
  st.next = LOCKED_NEXT;
}
function applySanction(game, p) {
  p.gold += SANCTION.gold;
  p.stats.goldEarned += SANCTION.gold;
  const sends = tierSends(p.tier),
    bonus = {};
  sends.filter((x) => !x.bossTier).forEach((x, i) => {
    if (i % 2 === 1) lockStock(game, p, x.id, SANCTION.rounds);
    else bonus[x.id] = i === 0 ? SANCTION.first : SANCTION.income;
  });
  const boss = sends.find((x) => x.bossTier);
  if (boss && !p.bossBought?.[boss.id]) lockStock(game, p, boss.id, SANCTION.rounds);
  p.sanction = { tier: p.tier, bonus };
  emit(game, "sanction", { player: p.id });
}
/** Summon Tower: towers of level 1-3 that may appear (any element, single field, no support towers). */
function summonPool(level) {
  return getCatalog().towers.filter((u) => u.playable && u.attacks && !u.perkUnit && !u.isHall && !u.support && (u.level || 1) === level && footprintOf(u.id) === 1 && !UNIQUE_TOWERS.has(u.id) && !/hall of/i.test(u.name || ""));
}
function summonTower(game, p) {
  const roll = random(game),
    level = roll < 0.2 ? 1 : roll < 0.7 ? 2 : 3;
  let pool = summonPool(level);
  for (let l = 1; !pool.length && l <= 3; l++) pool = summonPool(l);
  if (!pool.length) return;
  const item = pool[Math.floor(random(game) * pool.length)],
    cells = [];
  for (let y = 0; y < laneRows(game, p); y++) for (let x = 0; x < game.grid.cols; x++) if (canBuild(game, p.id, x, y, item.id).ok) cells.push([x, y]);
  if (!cells.length) return void summonRefund(game, p, item.id); // v0.27xF: no free field: its sell value in gold
  const [x, y] = cells[Math.floor(random(game) * cells.length)],
    tower = newTower(game, p, item.id, x, y);
  tower.buildRemaining = 0;
  tower.summoned = true;
  tower.summonValue = item.pointValue || 0;
  tower.totalSpent = 0;
  markSummoned(tower); // v0.26fF
  p.towers.push(tower);
  p.stats.built++;
  repath(game, p);
  emit(game, "build", { player: p.id, id: item.id, towerId: tower.id, x: tower.x, y: tower.y, summoned: true });
  emit(game, "summon", { player: p.id, id: item.id, towerId: tower.id, x: tower.x, y: tower.y, level: item.level || 1 });
  completeTower(game, p, tower);
}
function launchPillar(game, p, x, y) {
  const level = perkLevel(p, "pillar");
  (game.pillars ||= []).push({
    player: p.id,
    x,
    y,
    radius: PILLAR.radius,
    damage: pillarDamage(p, level),
    start: game.time,
    erupt: game.time + PILLAR.delay,
    end: game.time + PILLAR.delay + PILLAR.duration,
    next: game.time + PILLAR.delay,
    until: game.time + PILLAR.delay + PILLAR.duration + PILLAR.scorch,
  });
  p.pillarReady = game.time + abilityCd(p, PILLAR.cooldown);
  emit(game, "pillar", { player: p.id, x, y, radius: PILLAR.radius });
}
function tickPillars(game) {
  if (!game.pillars?.length) return;
  for (const f of game.pillars) {
    const p = game.players[f.player];
    while (p && !p.out && f.next < f.end - EPS && (f.burst || game.time + EPS >= f.next)) { // v0.21m: Fire Block bursts at once
      f.next += PILLAR.interval;
      const r = f.radius * game.grid.cellUnits;
      for (const c of p.creeps) {
        const d = dist(game, c, f);
        if (c.dead || c.hp <= 0 || d > r || divineShield(game, c)) continue;
        // v0.16i: hotter core: up to +75 % damage in the centre, the full value at the edge
        const core = 1 + PILLAR.core * (1 - d / Math.max(1, r));
        if (f.towerId) {
          // v0.27mF: Flameburst: a tower's fire explosion, spell damage credited to the tower, no hotter core
          const tower = p.towers.find((t) => t.id === f.towerId) || null;
          strike(game, p, tower, c, f.damage * (c.flying ? PILLAR.air : 1), "spells", true);
          if (c.hp <= 0) killCreep(game, p, c);
          continue;
        }
        c.hp -= guardCut(game, c, f.damage * core * (c.flying ? PILLAR.air : 1) * (!c.wave && isBudget(c.typeId) ? PILLAR.budget : 1) * spellResist(c), true); // v0.23: Magic Resistance (Pillar, Fire Block)
        if (c.hp <= 0) killCreep(game, p, c);
      }
    }
  }
  game.pillars = game.pillars.filter((f) => f.until > game.time);
}
function launchMonsun(game, p) {
  const level = perkLevel(p, "monsun");
  p.monsun = { start: game.time, until: game.time + MONSUN.duration[Math.min(5, level) - 1], next: game.time + MONSUN.strike, force: monsunForce(p, level), damage: monsunDamage(p, level) };
  p.monsunReady = game.time + abilityCd(p, MONSUN.cooldown);
  emit(game, "monsun", { player: p.id, until: p.monsun.until });
}
function tickMonsun(game, p) {
  const m = p.monsun;
  if (!m) return;
  if (game.time > m.until + EPS) {
    p.monsun = null;
    return;
  }
  const push = m.force * game.grid.cellUnits * movementMultiplier(game) * TICK;
  for (const c of p.creeps) if (!c.dead && c.hp > 0) pushBack(game, c, push * (c.flying ? 2 : 1), p);
  while (game.time + EPS >= m.next && m.next <= m.until + EPS) {
    m.next += MONSUN.strike;
    const alive = p.creeps.filter((c) => !c.dead && c.hp > 0 && !divineShield(game, c)),
      air = alive.filter((c) => c.flying),
      list = air.length ? air : alive;
    if (!list.length) continue;
    const c = list[Math.floor(random(game) * list.length)],
      damage = m.damage * (air.length ? 1 : MONSUN.groundShare);
    c.hp -= guardCut(game, c, damage * spellResist(c), true); // v0.23: Magic Resistance
    emit(game, "lightning", { player: p.id, x: c.x, y: c.y, small: !air.length, damage: Math.round(damage) });
    if (c.hp <= 0) killCreep(game, p, c);
  }
}
function launchGolem(game, p) {
  const level = perkLevel(p, "agolem"),
    route = findPath(game, p.id);
  if (!route?.length) return { ok: false, reason: "No path for the golem" };
  const path = route.slice().reverse(),
    hp = golemHp(p, level),
    s = statsFor(game, p, obj(GOLEM_ID));
  (p.golems ||= []).push({
    id: "g" + game.nextId++,
    typeId: GOLEM_ID,
    owner: p.id,
    golem: true,
    level,
    x: path[0].x,
    y: path[0].y,
    path,
    pathIndex: 1,
    hp,
    maxHp: hp,
    speed: s.speed,
    statuses: [],
    hit: [],
  });
  p.golemReady = game.time + abilityCd(p, AGOLEM.cooldown);
  emit(game, "golem", { player: p.id, x: path[0].x, y: path[0].y });
  return { ok: true };
}
function tickGolems(game, p) {
  if (!p.golems?.length) return;
  const reach = AGOLEM.reach * game.grid.cellUnits;
  for (const g of p.golems) {
    let left = g.speed * TICK;
    while (left > EPS) {
      const next = g.path[g.pathIndex];
      if (!next) break;
      const d = dist(game, g, next);
      if (d <= left + EPS) {
        g.x = next.x;
        g.y = next.y;
        g.pathIndex++;
        left -= d;
      } else {
        g.x += ((next.x - g.x) * left) / d;
        g.y += ((next.y - g.y) * left) / d;
        left = 0;
      }
    }
    const i = Math.min(5, g.level) - 1;
    for (const c of p.creeps) {
      if (g.hp <= 0) break;
      if (c.dead || c.hp <= 0 || c.flying || g.hit.includes(c.id) || dist(game, g, c) > reach) continue;
      g.hit.push(c.id);
      const loss = g.maxHp * AGOLEM.loss[i] * (heavyCreep(c) ? AGOLEM.heavy : 1);
      g.hp -= loss;
      if (!divineShield(game, c)) c.hp -= guardCut(game, c, loss * AGOLEM.damage * spellResist(c)); // v0.23: Magic Resistance
      knockBack(game, c, AGOLEM.knock[i] * game.grid.cellUnits, p); // v0.19k: glides back
      emit(game, "skill", { player: p.id, kind: "golemHit", x: c.x, y: c.y });
      if (c.hp <= 0) killCreep(game, p, c);
    }
    if (g.hp <= 0) {
      g.dead = true;
      emit(game, "golemDown", { player: p.id, x: g.x, y: g.y });
    } else if (g.pathIndex >= g.path.length) {
      // the portal row: the golem moves on into the next lane as a creep
      g.dead = true;
      const target = targetOf(game, p.id),
        c = target && target.id !== p.id && !target.out ? spawnCreep(game, p.id, GOLEM_ID, null, target.id) : null;
      if (c) {
        c.hp = g.hp;
        c.maxHp = g.maxHp;
        c.golem = true;
      }
      emit(game, "golemPortal", { player: p.id, x: g.x, y: g.y, lane: target?.id ?? -1 });
    }
  }
  p.golems = p.golems.filter((g) => !g.dead);
}
/** v0.10n: Golem Whisperer (Earth): boss creeps 25 % cheaper and 10 % more hit points (v0.27kF: mini bosses too). */
export const GOLEM = { discount: 0.25, hp: 0.1 };
/** v0.26cF: Mountain Golem (tier-5 boss): unlocks no tier; it can be recruited again and again, each one gives the tier-5 creeps +5 % HP for good. */
export const MOUNTAIN_GOLEM = { id: "n02R", hp: 0.05 };
/** v0.26cF: Ring of Life: flat creep HP per perk level by the creep's tier (T1–T5), 1st creep of every tier income bonus by level. */
export const RING = { hp: [1, 10, 30, 100, 400], income: [0.05, 0.075, 0.1] };
export const ringHp = (tier, level) => RING.hp[Math.max(1, Math.min(RING.hp.length, tier || 1)) - 1] * Math.max(0, Math.min(3, level | 0));
/**
 * v0.26cF: Revenge (Fire): a Fire Wolf for every enemy breach, onto the sender's field. 1.33 fields/s.
 * HP = tier base × perk level factor (strong) × (1 + 2 % per player level) (weak). Income: small, by tier × perk level.
 */
export const REVENGE = { speed: 1.33 * 284.44, tierHp: [120, 700, 3000, 9000, 25000], levelHp: [0.5, 1, 1.75], perPlayerLevel: 0.02, tierIncome: [0.5, 2, 5, 12, 30] };
const revTier = (p) => Math.max(1, Math.min(REVENGE.tierHp.length, p?.tier || 1)) - 1;
export const revengeHp = (p, level = perkLevel(p, "revenge")) =>
  Math.round(REVENGE.tierHp[revTier(p)] * REVENGE.levelHp[Math.max(1, Math.min(3, level || 1)) - 1] * (1 + REVENGE.perPlayerLevel * (p?.level || 1)));
export const revengeIncome = (p, level = perkLevel(p, "revenge")) => REVENGE.tierIncome[revTier(p)] * Math.max(1, Math.min(3, level || 1));
/** v0.10p: Wings of War (Storm), per level. */
export const WINGS = { hp: 0.06, speed: 0.03, income: 0.1 };
/** v0.10p: Hellfire (Fire): burning row (0-based, v0.10q: 6th row from the top) and damage per second. */
// v0.16g: buffed and scaled with the owner's send tier (creep hit points grow steeply per tier)
export const HELLFIRE = { row: 5, tiles: 6, perLevel: 10, base: 5, tierScale: [1, 2.5, 5.5, 12, 25, 50], perPlayerLevel: 0.03 }; // v0.22i1: weaker scaling (was 1 / 3 / 7 / 16 / 35 / 70 and 6 % per player level) // v0.22: less from the send tier (was 1 / 4 / 10 / 25 / 60 / 120)
// v0.19b1: Lava Floor (was Hellfire): also +6 % damage per player level
/** v0.21n: Lava Floor is a little weaker early on: 70 % in round 0, +1.5 % per round, full from round 20. */
export const hellfireRound = (round) => Math.min(1, 0.7 + 0.015 * Math.max(0, round || 0));
export const hellfireDps = (p, level = perkLevel(p, "hellfire")) =>
  level ? (HELLFIRE.perLevel * level + HELLFIRE.base) * HELLFIRE.tierScale[Math.max(0, Math.min(HELLFIRE.tierScale.length, p?.tier || 1) - 1)] * (1 + HELLFIRE.perPlayerLevel * (p?.level || 1)) : 0;
/** v0.10p: Arcane Burst (Arcane): cooldown, radius in fields (base + per level), damage per level and tier. */
export const BURST = { cooldown: 40, radius: 1.15, radiusPerLevel: 0.1, damage: 450, tier: [1, 4, 10, 25, 60] }; // v0.22: 200 → 450, tier factor 1/2/3/4/5 → 1/4/10/25/60
export const burstDamage = (p, level = perkLevel(p, "burst")) => level * BURST.damage * BURST.tier[Math.max(1, Math.min(BURST.tier.length, p?.tier || 1)) - 1];
export const burstRadius = (level) => BURST.radius + BURST.radiusPerLevel * level;
/**
 * v0.23w: Frost Bolt (Water, active): an aimed bolt; every creep in the radius takes the full damage and is slowed
 * by 50 % (a frost debuff) for 3 + 2 × level s. Damage grows with the perk level, the send tier (like Pillar of Fire)
 * and the player level.
 */
export const FROSTBOLT = { cooldown: 40, delay: 0.25, radius: 1.625, slow: 0.5, base: 42, perLevel: 21, perPlayerLevel: 0.03 }; // v0.27nF: damage −30 % (60 + 30 × level → 42 + 21 × level), radius +30 % (1.25 → 1.625): more slow, less nuke
export const frostboltDamage = (p, level = perkLevel(p, "frostbolt")) =>
  level ? Math.round((FROSTBOLT.base + FROSTBOLT.perLevel * level) * PILLAR_DAMAGE_TIER[Math.max(1, Math.min(PILLAR_DAMAGE_TIER.length, p?.tier || 1)) - 1] * (1 + FROSTBOLT.perPlayerLevel * (p?.level || 1))) : 0;
export const frostboltSlowTime = (level) => 1.5 * (3 + 2 * Math.max(1, level || 1)); // v0.27zzfF: +50 % (4.5 s + 3 s per level)
/**
 * v0.23w: Clones (Arcane): every sent creep has 10 % + 5 % per level chance to bring a clone (50 % HP, drawn a little
 * see-through in arcane colours). Heavy creeps can be cloned from level 3, bosses from level 6. A clone adds its share
 * of the card's income (a cloned Goblin of a 2-Goblin card: half the card's income).
 */
/**
 * v0.23x: Infested Ground (Plague, active): an aimed field turns into infested ground. When charged it strikes one ground
 * creep standing on it (high single-target damage, a 1 s slow), then recharges for 3.33 s; after 2 + level strikes it is
 * a normal field again. At most 6 such fields per player: a new one replaces the one with the fewest strikes left.
 */
export const INFESTED = { cooldown: 45, every: 3.33, max: 6, base: 150, perLevel: 75, perPlayerLevel: 0.04, slow: 0.5, slowTime: 1 };
export const infestedDamage = (p, level = perkLevel(p, "infested")) =>
  level ? Math.round((INFESTED.base + INFESTED.perLevel * level) * PILLAR_DAMAGE_TIER[Math.max(1, Math.min(PILLAR_DAMAGE_TIER.length, p?.tier || 1)) - 1] * (1 + INFESTED.perPlayerLevel * (p?.level || 1))) : 0;
export const infestedCharges = (level) => 2 + Math.max(1, level || 1);
function placeInfested(game, p, x, y) {
  const { cols, rows } = game.grid,
    gx = Math.min(cols - 1, Math.max(0, Math.floor(x * cols))),
    gy = Math.min(laneRows(game, p) - 1, Math.max(0, Math.floor(y * rows))),
    list = (p.infested ||= []),
    level = perkLevel(p, "infested");
  const old = list.findIndex((t) => t.x === gx && t.y === gy);
  if (old >= 0) list.splice(old, 1); // the same field again: fresh charges
  if (list.length >= INFESTED.max) {
    // the one with the fewest strikes left goes (the oldest of those)
    let k = 0;
    for (let i = 1; i < list.length; i++) if (list[i].charges < list[k].charges) k = i;
    list.splice(k, 1);
  }
  list.push({ x: gx, y: gy, charges: infestedCharges(level), ready: game.time, damage: infestedDamage(p, level) });
  p.infestedReady = game.time + abilityCd(p, INFESTED.cooldown);
  emit(game, "infested", { player: p.id, x: (gx + 0.5) / cols, y: (gy + 0.5) / rows, gx, gy });
}
function tickInfested(game, p) {
  if (!p.infested?.length) return;
  const { cols, rows } = game.grid;
  for (const t of p.infested) {
    if (game.time + EPS < t.ready || t.charges <= 0) continue;
    let target = null;
    for (const c of p.creeps)
      if (!c.dead && c.hp > 0 && !c.flying && c.y >= 0 && !divineShield(game, c) && Math.floor(c.x * cols) === t.x && Math.floor(c.y * rows) === t.y && (!target || c.progress > target.progress)) target = c;
    if (!target) continue;
    target.hp -= guardCut(game, target, t.damage * spellResist(target), true);
    t.charges--;
    t.ready = game.time + INFESTED.every;
    emit(game, "infestedBurst", { player: p.id, x: target.x, y: target.y, gx: t.x, gy: t.y, damage: Math.round(t.damage), creepId: target.id });
    if (target.hp <= 0) killCreep(game, p, target);
    else {
      const st = target.statuses.find((o) => o.abilityId === "infested"),
        dur = negativeDuration(target, INFESTED.slowTime);
      if (st) st.remaining = Math.max(st.remaining, dur);
      else target.statuses.push({ abilityId: "infested", remaining: dur, slow: INFESTED.slow, dps: 0, owner: p.id });
    }
  }
  p.infested = p.infested.filter((t) => t.charges > 0);
}
/**
 * v0.23zb: Siege Ogre (Tier 4, was Shieldbearer): once in its life it plants a Siege Plank over a 1×1 tower next to it
 * when crossing that tower shortens its way by at least 3 fields. Planting takes 1.2 s; the plank lasts 30 s and lets
 * creeps walk over that tower one at a time (the tower keeps shooting). Without its plank the ogre walks 25 % faster
 * but loses its armor.
 */
export const SIEGE_OGRE = { id: "n01G", plant: 1.2, last: 30, minSave: 3, speed: 1.25, carry: 0.8, reach: 0.62, queue: 4, joinSave: 2 }; // v0.24h: carry, reach, queue, joinSave
const plankKey = (pl) => pl.x + "," + pl.y;
const plankAt = (p, x, y) => p.planks?.find((pl) => pl.x === x && pl.y === y) || null;
/** v0.24h: a route crosses a plank straight along it (in and out on the plank's axis), never round a corner. */
function alongPlank(pl, dir, before, after) {
  if (!before || !after) return false;
  return dir === "h"
    ? before.gridY === pl.y && after.gridY === pl.y && Math.abs(before.gridX - pl.x) === 1 && after.gridX === 2 * pl.x - before.gridX
    : before.gridX === pl.x && after.gridX === pl.x && Math.abs(before.gridY - pl.y) === 1 && after.gridY === 2 * pl.y - before.gridY;
}
/** v0.24h: creeps routed over a plank that have not crossed it yet (the one on it included). */
function plankQueue(p, pl) {
  const key = plankKey(pl);
  let n = 0;
  for (const o of p.creeps) {
    if (o.plankRoute !== key || o.dead || o.hp <= 0) continue;
    for (let i = Math.max(0, o.pathIndex - 1); i < o.path.length; i++)
      if (o.path[i].gridX === pl.x && o.path[i].gridY === pl.y) {
        n++;
        break;
      }
  }
  return n;
}
/**
 * v0.24h: a ground creep that stands next to a Siege Plank (8 neighbouring fields) takes it when that saves at least
 * `joinSave` fields and fewer than `queue` creeps are already on their way over it. Only these creeps ever re-route
 * for a plank; the field path and all other creeps keep their way (no masses waiting behind a plank).
 */
function joinPlank(game, p, c, gx, gy, force = false) {
  if (c.flying || c.plankRoute || !p.planks?.length) return false;
  for (const pl of p.planks) {
    if (Math.abs(pl.x - gx) > 1 || Math.abs(pl.y - gy) > 1 || (pl.x === gx && pl.y === gy)) continue;
    if (game.time + EPS >= pl.until || plankQueue(p, pl) >= SIEGE_OGRE.queue) continue;
    const full = findPath(game, p.id, { x: gx, y: gy }, null, [pl]);
    if (!full || full.length < 2) continue;
    const way = full.slice(1),
      over = way.findIndex((n) => n.gridX === pl.x && n.gridY === pl.y);
    if (over < 0 || over > 1) continue; // the plank must be the next field or the one after
    if (!alongPlank(pl, pl.dir, over ? way[over - 1] : { gridX: gx, gridY: gy }, way[over + 1])) continue; // walks along the plank
    const left = c.path.length - c.pathIndex;
    if (!force && way.length > left - SIEGE_OGRE.joinSave) continue;
    c.prevNode = behindOf(c);
    c.path = way;
    c.pathIndex = 0;
    c.plankRoute = plankKey(pl);
    return true;
  }
  return false;
}
function siegeOgre(game, p, c, remaining) {
  if (c.planting?.approach) {
    // v0.24h: the ogre first walks right up to the tower before it lays the plank down
    const t = c.planting,
      tower = p.towers.some((o) => o.gridX === t.x && o.gridY === t.y && towerSize(o) === 1);
    if (!tower || plankAt(p, t.x, t.y)) {
      c.planting = null; // the tower went (or got a plank): back onto its way
      return 0;
    }
    const tx = (t.x + 0.5 - t.dx * SIEGE_OGRE.reach) / game.grid.cols,
      ty = (t.y + 0.5 - t.dy * SIEGE_OGRE.reach) / game.grid.rows,
      dist = Math.hypot((c.x - tx) * game.grid.cols, (c.y - ty) * game.grid.rows) * game.grid.cellUnits;
    if (dist > remaining + EPS) {
      const f = remaining / dist;
      c.x += (tx - c.x) * f;
      c.y += (ty - c.y) * f;
      return -1;
    }
    c.x = tx;
    c.y = ty;
    t.approach = false;
    t.start = game.time;
    t.until = game.time + SIEGE_OGRE.plant;
    emit(game, "plankStart", { player: p.id, creepId: c.id, x: c.x, y: c.y });
    return -1;
  }
  if (c.planting) {
    if (game.time + EPS < c.planting.until) return -1;
    const t = c.planting;
    c.planting = null;
    c.planted = true;
    c.speed *= SIEGE_OGRE.speed;
    c.baseSpeed = (c.baseSpeed || c.speed) * SIEGE_OGRE.speed;
    c.armor = 0;
    if (p.towers.some((o) => o.gridX === t.x && o.gridY === t.y && towerSize(o) === 1) && !plankAt(p, t.x, t.y)) {
      const pl = { x: t.x, y: t.y, until: game.time + SIEGE_OGRE.last, busy: null, dir: t.dir };
      (p.planks ||= []).push(pl);
      emit(game, "plank", { player: p.id, x: (t.x + 0.5) / game.grid.cols, y: (t.y + 0.5) / game.grid.rows, gx: t.x, gy: t.y, owner: c.owner, dir: t.dir });
      // v0.24h: no general re-route: the ogre crosses its plank, creeps on the neighbouring fields may follow
      const way = findPath(game, p.id, { x: t.x, y: t.y }, null, [pl]);
      if (way?.length) {
        c.prevNode = behindOf(c);
        c.path = way;
        c.pathIndex = 0;
        c.plankRoute = plankKey(pl);
      }
      const cols = game.grid.cols,
        rows = game.grid.rows;
      for (const o of p.creeps)
        if (o !== c && !o.flying && !o.dead && o.y >= 0) joinPlank(game, p, o, Math.min(cols - 1, Math.max(0, Math.floor(o.x * cols))), Math.floor(o.y * rows));
    } else {
      // no plank after all: back onto the way from where the ogre stands
      c.path = creepPathFrom(game, p.id, c);
      c.pathIndex = 0;
    }
    return 0;
  }
  if (c.planted || c.y < 0 || c.ogreChecked === c.pathIndex) return 0;
  c.ogreChecked = c.pathIndex;
  const { cols, rows } = game.grid,
    gx = Math.min(cols - 1, Math.max(0, Math.floor(c.x * cols))),
    gy = Math.floor(c.y * rows);
  if (gy < 0 || gy >= laneRows(game, p)) return 0;
  const left = c.path.length - c.pathIndex;
  let best = null;
  for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0]]) {
    const x = gx + dx,
      y = gy + dy;
    if (x < 0 || x >= cols || y >= rows) continue;
    const t = p.towers.find((o) => o.gridX === x && o.gridY === y && towerSize(o) === 1);
    if (!t || p.planks?.some((pl) => pl.x === x && pl.y === y)) continue;
    // the way from that tower's field to the exit if it could be crossed
    const way = findPath(game, p.id, { x, y }, null, [{ x, y }]); // v0.24h: only this candidate plank
    if (!way) continue;
    if (!alongPlank({ x, y }, dy ? "v" : "h", { gridX: gx, gridY: gy }, way[1])) continue; // v0.24h: straight over it, so the plank lies the way creeps walk
    const save = left - (way.length + 1);
    if (save >= SIEGE_OGRE.minSave && (!best || save > best.save)) best = { x, y, save, dx, dy, dir: dy ? "v" : "h" };
  }
  if (!best) return 0;
  // v0.24h: first the walk up to the tower (see above), then 1.2 s of planting
  c.planting = { x: best.x, y: best.y, dx: best.dx, dy: best.dy, dir: best.dir, approach: true, until: 0, start: game.time }; // until is set once it stands at the tower
  return siegeOgre(game, p, c, remaining);
}
/** v0.23zb: Siege Planks end after 30 s (or when their tower is gone), but never under a creep that is crossing. */
function tickPlanks(game, p) {
  if (!p.planks?.length) return;
  const before = p.planks.length;
  const gone = [];
  p.planks = p.planks.filter((pl) => {
    const tower = p.towers.some((o) => o.gridX === pl.x && o.gridY === pl.y && towerSize(o) === 1),
      crossing = pl.busy && p.creeps.some((o) => o.id === pl.busy && !o.dead && o.hp > 0 && Math.floor(o.x * game.grid.cols) === pl.x && Math.floor(o.y * game.grid.rows) === pl.y);
    const keep = tower && (game.time < pl.until || (crossing && game.time < pl.until + 5));
    if (!keep) gone.push(plankKey(pl));
    return keep;
  });
  if (p.planks.length === before) return;
  // v0.24h: only the creeps that were on their way over a removed plank look for a new way
  for (const c of p.creeps) {
    if (!c.plankRoute || !gone.includes(c.plankRoute)) continue;
    c.plankRoute = null;
    if (c.flying || c.dead) continue;
    c.prevNode = behindOf(c);
    c.path = creepPathFrom(game, p.id, c);
    c.pathIndex = 0;
  }
}
export const CLONES = { base: 0.1, perLevel: 0.05, hp: 0.5, heavyFrom: 3, bossFrom: 6 };
export const cloneChance = (level) => (level > 0 ? CLONES.base + CLONES.perLevel * level : 0);
/** v0.10q: Giant's Pocks (Plague), per perk level: share of remaining hp, poison seconds (×3 + 2), slow, dps × tier × 2. */
export const POCKS = { interval: 4, hpShare: 0.05, slow: 0.03 };
function tickPocks(game, p) {
  const level = perkLevel(p, "pocks");
  if (!level) return;
  if (!(p.pocksNext > 0)) p.pocksNext = game.time + POCKS.interval;
  if (game.time + EPS < p.pocksNext) return;
  p.pocksNext = game.time + POCKS.interval;
  let c = null;
  for (const o of p.creeps) if (!o.dead && o.hp > 0 && !divineShield(game, o) && (!c || o.hp > c.hp || (o.hp === c.hp && o.id < c.id))) c = o;
  if (!c) return;
  c.hp -= guardCut(game, c, c.hp * POCKS.hpShare * level);
  const tough = nerfClass(c) === "boss" || c.bossTier || obj(c.typeId)?.bossTier || c.defenseType === "large";
  c.statuses.push({
    abilityId: "pocks",
    poison: true,
    remaining: (level * 3 + 2) * (tough ? 0.5 : 1) * (1 + ALCHEMIST.duration * perkLevel(p, "alchemist")), // v0.27aF
    slow: POCKS.slow * level,
    dps: level * (p.tier || 1) * 2,
    owner: p.id,
  });
  emit(game, "skill", { player: p.id, kind: "pocks", x: c.x, y: c.y });
  if (c.hp <= 0) killCreep(game, p, c);
}
/**
 * v0.23k: Lava Floor lies on single tiles of the player's field instead of the 6th row: 6 tiles on level 1
 * (at least 2 in the upper half, 2 in the lower half, 2 anywhere) and one more for every level from 2 on.
 * The tiles are drawn once and stay; new levels add tiles.
 */
export const lavaTileCount = (level) => (level > 0 ? HELLFIRE.tiles + Math.max(0, level - 1) : 0);
function growLava(game, p) {
  const want = lavaTileCount(perkLevel(p, "hellfire")),
    lava = (p.lava ||= []);
  if (lava.length >= want) return lava;
  const { cols } = game.grid,
    rows = laneRows(game, p),
    half = Math.floor(rows / 2),
    taken = new Set(lava.map(([x, y]) => y * cols + x));
  for (let guard = 0; lava.length < want && guard < 400; guard++) {
    const n = lava.length,
      // the first two in the upper half, the next two in the lower half, then anywhere
      y0 = n < 2 ? 0 : n < 4 ? half : 0,
      y1 = n < 2 ? half : rows,
      x = Math.floor(random(game) * cols),
      y = y0 + Math.floor(random(game) * (y1 - y0));
    if (taken.has(y * cols + x)) continue;
    taken.add(y * cols + x);
    lava.push([x, y]);
  }
  return lava;
}
export const onLava = (game, p, c) => {
  if (!p.lava?.length || c.y < 0) return false;
  const x = Math.floor(c.x * game.grid.cols),
    y = Math.floor(c.y * game.grid.rows);
  for (const t of p.lava) if (t[0] === x && t[1] === y) return true;
  return false;
};
function tickHellfire(game, p) {
  if (!perkLevel(p, "hellfire")) return;
  growLava(game, p);
  const dps = hellfireDps(p) * hellfireRound(game.round); // v0.21n: weaker in early rounds
  if (!dps) return;
  for (const c of p.creeps) {
    if (c.dead || c.hp <= 0 || c.flying || c.y < 0 || !onLava(game, p, c) || divineShield(game, c)) continue; // v0.17n: Divine Shield
    c.hp -= guardCut(game, c, dps * TICK);
    if (c.hp <= 0) killCreep(game, p, c);
  }
}
function launchBurst(game, p, x, y) {
  const level = perkLevel(p, "burst"),
    r = burstRadius(level) * game.grid.cellUnits,
    centre = { x, y },
    inside = p.creeps.filter((c) => !c.dead && c.hp > 0 && !divineShield(game, c) && dist(game, c, centre) <= r), // v0.17n: shielded creeps are immune
    total = burstDamage(p, level),
    share = inside.length ? total / inside.length : 0;
  for (const c of inside) {
    c.hp -= guardCut(game, c, share * spellResist(c), true); // v0.23: Magic Resistance
    if (c.hp <= 0) killCreep(game, p, c);
  }
  p.burstReady = game.time + abilityCd(p, BURST.cooldown);
  emit(game, "burst", { player: p.id, x, y, radius: burstRadius(level), hits: inside.length, damage: Math.round(share) });
}
/** v0.23w: Frost Bolt: full damage to every creep in the radius, then a 50 % frost slow (the stronger frost wins). */
/**
 * v0.27zzaF: Frost Strike (was Frost Bolt): aimed at one field. The field freezes for FROSTBOLT.delay seconds, then
 * icicles erupt and hit every creep on that field (damage and slow as before).
 */
function launchFrostBolt(game, p, x, y) {
  const level = perkLevel(p, "frostbolt"),
    { cols, rows } = game.grid,
    gx = Math.max(0, Math.min(cols - 1, Math.floor(x * cols))),
    gy = Math.floor(y * rows);
  p.frostboltReady = game.time + abilityCd(p, FROSTBOLT.cooldown);
  p.pendingSummons = [...(p.pendingSummons || []), { kind: "frost", at: game.time + FROSTBOLT.delay, gx, gy, lv: level }];
  emit(game, "frostStart", { player: p.id, x: (gx + 0.5) / cols, y: (gy + 0.5) / rows, delay: FROSTBOLT.delay });
}
function frostStrike(game, p, s) {
  const level = s.lv || perkLevel(p, "frostbolt"),
    { cols, rows } = game.grid,
    x = (s.gx + 0.5) / cols,
    y = (s.gy + 0.5) / rows,
    inside = p.creeps.filter((c) => !c.dead && c.hp > 0 && !divineShield(game, c) && Math.abs(c.x - x) * cols <= 0.6 && Math.abs(c.y - y) * rows <= 0.6),
    damage = frostboltDamage(p, level),
    time = frostboltSlowTime(level);
  for (const c of inside) {
    c.hp -= guardCut(game, c, damage * spellResist(c), true); // Magic Resistance like the other spells
    if (c.hp <= 0) {
      killCreep(game, p, c);
      continue;
    }
    const duration = negativeDuration(c, time),
      frost = c.statuses.find((st) => st.abilityId === "frost");
    if (frost) {
      frost.remaining = Math.max(frost.remaining, duration);
      frost.slow = Math.max(frost.slow || 0, FROSTBOLT.slow);
    } else c.statuses.push({ abilityId: "frost", remaining: duration, slow: FROSTBOLT.slow, dps: 0, owner: p.id });
  }
  emit(game, "frostbolt", { player: p.id, x, y, radius: 0.5, tile: true, hits: inside.length, damage: Math.round(damage) });
}
function bossDiscount(p, item, gold) {
  if (!item?.isSend) return gold;
  let share = 1;
  if ((item.bossTier || item.id === MINI_BOSS.id) && perkLevel(p, "golem")) share *= 1 - GOLEM.discount; // v0.27kF: also mini bosses (Mud Golem)
  if (perkLevel(p, "breeding") && hasDeathrattle(item.id)) share *= 1 - BREEDING.discount; // v0.27aF: Breeding Pools spawners
  if (UNDEAD_SENDS.has(item.id) && perkLevel(p, "exhume")) share *= 1 - EXHUME.discount[Math.min(3, perkLevel(p, "exhume")) - 1]; // v0.10r/s
  if (perkLevel(p, "manufacture") && eighthOf(item)) share *= 1 - MANUFACTURE.discount[Math.min(3, perkLevel(p, "manufacture")) - 1]; // v0.12; v0.20d: 8th creep
  if (perkLevel(p, "synthesizer") && thirdOf(item)) share *= 1 - SYNTHESIZER.discount[Math.min(3, perkLevel(p, "synthesizer")) - 1]; // v0.20d
  if (perkLevel(p, "forge") && sixthOf(item)) share *= 1 - FORGE.discount[Math.min(3, perkLevel(p, "forge")) - 1]; // v0.21c
  if (perkLevel(p, "nobility") && isHeavy(item)) share *= 1 - NOBILITY.discount[Math.min(3, perkLevel(p, "nobility")) - 1]; // v0.12
  let up = false;
  if (p?.questLog) {
    const q = questCostShare(p, item);
    up = q < 1; // v0.23b: banter rewards always round up (Goblin 5 → 4, Imp 50 → 40)
    share *= q * (1 - contractShare(p, item, "discount")); // v0.15: banter rewards and penalties; v0.19a1: contracts
  }
  return share === 1 ? gold : up ? Math.ceil(gold * share - 1e-9) : Math.round(gold * share);
}
/** v0.10r: undead creeps (Exhumination). */
export const UNDEAD_SENDS = new Set(["n00R", "n011", "n016", "n019", "n01B", "n01H", "n013", "n01D", "n02N", "n02E"]);
export const EXHUME = { discount: [0.2, 0.35, 0.5], restock: 0.1 }; // v0.26cF: recruit 10 % faster per perk level (10 / 20 / 30 %) // v0.20c: recruit 10 % faster // v0.10s
/** v0.26cF: Exhumination: how much faster undead creeps recruit at a perk level (0.1 per level). */
export const exhumeSpeed = (level) => EXHUME.restock * Math.max(0, Math.min(3, level | 0));
/** v0.10r: Red Boots (per level), High Voltage (per level), Water Block (per level 1-3), Gold Treasure. */
export const BOOTS = { slow: [0.25, 0.35, 0.45, 0.525, 0.6], income: 0.015 }; // v0.10s: slow resistance by level; v0.22: 5 levels, +1.5 % income per level
export const VOLTAGE = { bonus: 0.5 };
/**
 * v0.19j: Fire Block (Fire, levels 1-3): every 12 / 9 / 6 s the first breach sets off a small pillar of fire
 * on the path just before the exit: 3 pulses in 0.9 s, radius 1.5 fields, up to +75 % in the centre, flyers half.
 * Damage per pulse = (8 + 6 × perk level) × send-tier factor (1 / 4 / 10 / 25 / 60 / 120) × (1 + 5 % per player level).
 */
export const FIREBLOCK = { cooldown: [12, 9, 6], radius: 1.5, pulses: 3, delay: 0.3, step: 0.4, base: 8, perLevel: 6, scorch: 6, back: 1, backPerLevel: 0.25, radiusPerLevel: 0.12 }; // v0.21m: push back 1 field; v0.21y: +0.25 fields push and +0.12 fields radius per level; v0.24s: each further pulse `delay` s later and `step` fields further up the path
/** v0.24s: the point `fields` fields further up `path` (walked backwards from its end, starting at `from`). */
function pathPointBack(game, path, from, fields) {
  const { cols, rows } = game.grid;
  if (!path?.length) return { x: from.x, y: Math.max(0, from.y - fields / rows) };
  let left = fields,
    at = { x: from.x, y: from.y };
  for (let i = path.length - 2; i >= 0 && left > EPS; i--) {
    const node = path[i],
      step = Math.hypot((at.x - node.x) * cols, (at.y - node.y) * rows);
    if (step >= left) {
      const f = left / Math.max(EPS, step);
      return { x: at.x + (node.x - at.x) * f, y: at.y + (node.y - at.y) * f };
    }
    left -= step;
    at = { x: node.x, y: node.y };
  }
  return at;
}
export const fireBlockBack = (level) => FIREBLOCK.back + FIREBLOCK.backPerLevel * level;
export const fireBlockRadius = (level) => FIREBLOCK.radius + FIREBLOCK.radiusPerLevel * level;
export const fireBlockDamage = (p, level = Math.min(3, perkLevel(p, "fireblock"))) =>
  Math.round((FIREBLOCK.base + FIREBLOCK.perLevel * level) * PILLAR_TIER[Math.max(1, Math.min(PILLAR_TIER.length, p?.tier || 1)) - 1] * (1 + 0.05 * (p?.level || 1)));
function fireBlock(game, p, c) {
  const level = Math.min(3, perkLevel(p, "fireblock"));
  if (!level || p.fireBlockReady > game.time + EPS) return false;
  p.fireBlockReady = game.time + FIREBLOCK.cooldown[level - 1];
  const spot = !c.flying && c.path?.length > 1 ? c.path[c.path.length - 2] : { x: c.x, y: c.y };
  // v0.21m: the creep that set it off is pushed back 1 field (no breach), like Water Block
  if (c.flying) {
    const column = gridAt(game, c).x;
    c.path = [pos(game, column, -1), exitPos(game, p, column)];
    c.pathIndex = 1;
  } else if (c.path?.length) c.pathIndex = c.path.length;
  const way = !c.flying && c.path?.length > 1 ? c.path.slice(0, c.path.length - 1) : null;
  knockBack(game, c, fireBlockBack(level) * game.grid.cellUnits, p);
  // v0.24s: one pillar per pulse, each FIREBLOCK.delay s later and FIREBLOCK.step fields further up the path
  for (let i = 0; i < FIREBLOCK.pulses; i++) {
    const at = i ? pathPointBack(game, way, spot, FIREBLOCK.step * i) : spot,
      start = game.time + FIREBLOCK.delay * i;
    (game.pillars ||= []).push({
      player: p.id,
      x: at.x,
      y: at.y,
      radius: fireBlockRadius(level),
      damage: fireBlockDamage(p, level),
      small: true,
      start,
      erupt: start,
      end: start + PILLAR.interval,
      next: start,
      burst: i === 0,
      until: start + PILLAR.interval + FIREBLOCK.scorch,
    });
  }
  emit(game, "skill", { player: p.id, kind: "fireblock", x: spot.x, y: spot.y });
  tickPillars(game);
  return true;
}
export const WATERBLOCK = { cooldown: [15, 13, 11], back: [6, 8, 10], backAir: [3, 5, 6], frost: 5, slow: [0.75, 0.85, 0.9] }; // v0.22h1: ground 4 + 2 × level fields, flyers 3 / 5 / 6, frozen 75 / 85 / 90 % slower
export const treasureGold = (game) => Math.max(1, game?.round || 0) * 30; // v0.19e2: +20 % (was 25 per round)
/** v0.19e2: Gold Treasure income: +60, doubled while the player has less than 40 % of the highest income. */
export const TREASURE = { income: 60, behind: 0.4 };
export function treasureIncome(game, p) {
  const inc = (q) => (q?.income || 0) + (q?.incomeDecimal || 0) / 100,
    top = Math.max(0, ...(game?.players || []).filter((q) => !q.out).map(inc));
  return p && top > 0 && inc(p) < TREASURE.behind * top ? TREASURE.income * 2 : TREASURE.income;
}
/** v0.20c: Air Block (Storm): the first flying breach every 15 / 13 / 11 s is struck by lightning, pushed back and stunned. */
export const AIRBLOCK = { cooldown: [15, 13, 11], back: [3, 5, 7], stun: [2, 3, 4], monsun: [6, 8, 10], base: 25, perLevel: 20 }; // v0.24s: Monsun cooldown cut 6 / 8 / 10 s
export const airBlockDamage = (p, level = Math.min(3, perkLevel(p, "airblock"))) =>
  Math.round((AIRBLOCK.base + AIRBLOCK.perLevel * Math.max(1, level)) * PILLAR_TIER[Math.max(1, Math.min(PILLAR_TIER.length, p?.tier || 1)) - 1] * (1 + 0.05 * (p?.level || 1)));
function airBlock(game, p, c) {
  const level = Math.min(3, perkLevel(p, "airblock"));
  if (!level || !c.flying || p.airBlockReady > game.time + EPS) return false;
  p.airBlockReady = game.time + AIRBLOCK.cooldown[level - 1];
  const column = gridAt(game, c).x;
  c.path = [pos(game, column, -1), exitPos(game, p, column)];
  c.pathIndex = 1;
  knockBack(game, c, AIRBLOCK.back[level - 1] * game.grid.cellUnits, p);
  c.statuses.push({ abilityId: "stun", remaining: negativeDuration(c, AIRBLOCK.stun[level - 1]), slow: 0, dps: 0, stun: true, owner: p.id });
  if (perkLevel(p, "monsun") && p.monsunReady > game.time) p.monsunReady = Math.max(game.time, p.monsunReady - AIRBLOCK.monsun[level - 1]);
  emit(game, "skill", { player: p.id, kind: "airblock", x: c.x, y: c.y });
  if (!divineShield(game, c)) {
    const damage = airBlockDamage(p, level);
    c.hp -= guardCut(game, c, damage * spellResist(c), true); // v0.23: Magic Resistance
    emit(game, "lightning", { player: p.id, x: c.x, y: c.y, damage });
    if (c.hp <= 0) killCreep(game, p, c);
  }
  return true;
}
/** Water Block: true when the breach was denied (creep frozen and pushed back up its path). */
function bootsResist(p) {
  const level = Math.min(BOOTS.slow.length, perkLevel(p, "boots"));
  return level ? 1 - BOOTS.slow[level - 1] : 1;
}
function waterBlock(game, p, c) {
  const level = Math.min(3, perkLevel(p, "waterblock"));
  if (!level || p.blockReady > game.time + EPS) return false;
  p.blockReady = game.time + WATERBLOCK.cooldown[level - 1];
  const back = (c.flying ? WATERBLOCK.backAir : WATERBLOCK.back)[level - 1],
    slow = WATERBLOCK.slow[level - 1];
  // v0.19k: the creep glides back along its path instead of jumping
  if (c.flying) {
    const column = gridAt(game, c).x;
    c.path = [pos(game, column, -1), exitPos(game, p, column)];
    c.pathIndex = 1;
  } else if (c.path?.length) c.pathIndex = c.path.length;
  knockBack(game, c, back * game.grid.cellUnits, p);
  const frost = c.statuses.find((st) => st.abilityId === "frost");
  // v0.22h1: the Water Block frost holds the creep in icicles (drawn at its feet)
  if (frost) {
    frost.remaining += WATERBLOCK.frost;
    frost.slow = Math.max(frost.slow, slow);
    frost.ice = true;
  } else c.statuses.push({ abilityId: "frost", remaining: WATERBLOCK.frost, slow, dps: 0, owner: p.id, ice: true });
  emit(game, "skill", { player: p.id, kind: "waterblock", x: c.x, y: c.y });
  return true;
}
/** Archer (h003) and every tower that grows out of it. */
let ARCHER_LINE = null;
/** v0.16: the footman line (Footman and every upgrade from it). */
/** v0.27xF: Footman-Line attack speed bonus on the base value. */
const FOOTMAN_LINE_SPEED = 0.05;
let FOOTMAN_LINE = null;
function footmanLine() {
  if (!FOOTMAN_LINE) {
    FOOTMAN_LINE = new Set(["h000"]);
    const queue = ["h000"];
    while (queue.length) for (const u of obj(queue.shift())?.upgrades || []) if (!FOOTMAN_LINE.has(u)) FOOTMAN_LINE.add(u) && queue.push(u);
  }
  return FOOTMAN_LINE;
}
/**
 * v0.17g: attack facts for tooltips: splash radius (in game units, 0 = none), arrows per shot
 * (Multi Shot, Fire Archer) and bounce targets (Glaive). Mirrors the attack code below.
 */
export function attackInfo(game, id, p) {
  const item = obj(id);
  if (!item?.attacks) return { splash: 0, multi: 0, bounce: 0 };
  const skills = unitAbilities({ typeId: id }).map((a) => skillOf(a, Math.min(fval(a, "alev", 0, 1), Math.max(1, item.level || 1)))).filter(Boolean),
    ms = skills.find((sk) => sk.type === "multishot"),
    multi = ms ? ms.count : fireArcher(id) ? item.level || 1 : 0,
    bounce = item.weapon === "mbounce" ? num(item.fields?.utc1, 1) : 0;
  let splash = 0;
  if (item.weapon !== "mbounce") {
    if (isCannonTower(item)) splash = Math.max(item.splashSmall, item.splashMedium, CANNON_RING * game.grid.cellUnits) * BOMBARD_RADIUS + gunpowderBonus(game, p);
    else if (item.splashFull > 0 || item.splashMedium > 0 || item.splashSmall > 0)
      splash = lineSet("h02R").has(id) ? Math.max(item.splashFull, item.splashMedium, item.splashSmall) * BOMBARD_RADIUS + gunpowderBonus(game, p) : Math.max(item.splashFull, item.splashMedium, item.splashSmall);
  }
  return { splash, multi: multi > 1 ? multi : 0, bounce: bounce > 1 ? bounce : 0 };
}
/** v0.16: Fire Archers fire one arrow per tower level at different creeps. */
let FIRE_ARCHERS = null;
export function fireArcher(id) {
  if (!FIRE_ARCHERS) {
    FIRE_ARCHERS = new Set(["h01J"]);
    const queue = ["h01J"];
    while (queue.length) for (const u of obj(queue.shift())?.upgrades || []) if (!FIRE_ARCHERS.has(u)) FIRE_ARCHERS.add(u) && queue.push(u);
  }
  return FIRE_ARCHERS.has(id);
}
function archerLine() {
  if (!ARCHER_LINE) {
    ARCHER_LINE = new Set(["h003"]);
    const queue = ["h003"];
    while (queue.length) for (const u of obj(queue.shift())?.upgrades || []) if (!ARCHER_LINE.has(u)) ARCHER_LINE.add(u) && queue.push(u);
  }
  return ARCHER_LINE;
}
/** v0.27zzcF: Recruitment Flow: every level recruits 20 % faster (level 5: twice as fast). */
export const RECRUIT_FLOW = 0.2;
/** Seconds per recruit (v0.10i: Recruitment refills every creep 10 % faster per level). */
export function stockRegenOf(p, s) {
  const level = perkLevel(p, "recruit");
  const slave = perkLevel(p, "slave") && firstOfTier(s) ? 1 + slaveSpeed(perkLevel(p, "slave")) : 1; // v0.14
  const slower = UNDEAD_SENDS.has(s.id) && perkLevel(p, "exhume") ? 1 / (1 + exhumeSpeed(perkLevel(p, "exhume"))) : 1; // v0.10s: Exhumination (v0.20c: faster; v0.26cF: 10 % per level)
  const faster = (perkLevel(p, "manufacture") && eighthOf(s) ? MANUFACTURE.restock : 1) * (perkLevel(p, "synthesizer") && thirdOf(s) ? SYNTHESIZER.restock : 1) * (perkLevel(p, "forge") && sixthOf(s) ? FORGE.restock : 1) * (perkLevel(p, "nobility") && isHeavy(s) ? NOBILITY.restock : 1); // v0.12
  const contract = 1 + contractShare(p, s, "restock"); // v0.19d2: Blood Contract
  const flow = perkLevel(p, "recruitflow") && !s.bossTier ? 1 + RECRUIT_FLOW * Math.min(5, perkLevel(p, "recruitflow")) : 1; // v0.27zzcF: Recruitment Flow
  return ((s.stockRegen || 0) / (level && !s.bossTier ? 1 + 0.1 * level : 1)) * slower / faster / slave / contract / flow;
}
/** Highest stock of a send for this player (v0.10i: Recruitment no longer adds stock). */
export function stockMaxOf(p, s) {
  return s ? s.stockMax + (perkLevel(p, "slave") && firstOfTier(s) ? SLAVE.stock * Math.min(SLAVE.max, perkLevel(p, "slave")) : 0) : 0; // v0.14: Slave Labour
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
export const EXP_EASE = 0.15;
const EXP_STEPS = [60, 125, 200, 300]; // EXP_STEPS[i]: EXP to reach level i + 2
while (EXP_STEPS.length < MAX_LEVEL - 1) {
  const next = EXP_STEPS.length + 2;
  EXP_STEPS.push(Math.round(EXP_STEPS[EXP_STEPS.length - 1] * 1.05 + 25 * next - 150));
}
// v0.14: higher levels need a little less: from level 6 the step shrinks linearly, 15 % less from level 25 on
for (let i = 4; i < EXP_STEPS.length; i++) EXP_STEPS[i] = Math.round(EXP_STEPS[i] * (1 - EXP_EASE * Math.min(1, (i + 2 - 5) / 20)));
export function expNeeded(level) {
  return EXP_STEPS[Math.max(1, Math.min(MAX_LEVEL - 1, level)) - 1];
}
/** v0.27bF: a breach gives at least this share of the EXP the sender's current level needs in total (2000 / 8000 → at least 80). */
export const BREACH_EXP_MIN = 0.01;
function gainExp(game, p, amount, source = "other", floor = 0) {
  if (!(amount > 0)) return;
  amount *= 1 + NOVICE[Math.min(3, perkLevel(p, "novice"))] + SCHOLAR.exp * Math.min(10, perkLevel(p, "scholar")); // v0.21e: up to level 10 // v0.19g1: Novice 20 / 35 / 50 / 60 / 70 %; v0.20d: Scholar +10 % per level
  if (floor > amount) amount = floor; // v0.27bF: breach minimum (after the EXP bonuses)
  p.exp += amount;
  p.stats.expEarned += amount;
  (p.stats.expBy ||= {})[source] = (p.stats.expBy[source] || 0) + amount; // v0.24oF: EXP per source (stats and tests)
  while (p.level < MAX_LEVEL && p.exp >= p.expNext) {
    p.exp -= p.expNext;
    p.level++;
    p.expNext = expNeeded(p.level);
    if (game) {
      (p.levelRound ||= {})[p.level] = game.round || 0; // v0.22: Gold perk counts the round this level was reached
      const kind = ELEMENT_LEVELS.includes(p.level) && FACTIONS.some((f) => !p.research[f.unlock]) ? "element" : "upgrade";
      p.picks.push(makePick(game, p, kind));
      emit(game, "levelUp", { player: p.id, level: p.level, kind });
    }
  }
  if (p.level >= MAX_LEVEL) p.exp = Math.min(p.exp, p.expNext); // full bar at the top level
}
/** Test hook (local debug only): grant EXP as if earned in play. */
export function grantExp(game, playerIndex, amount) {
  gainExp(game, game.players[playerIndex], amount, "debug");
}
/**
 * v0.09i: perk availability. Every reward of the level-up dialog (a "perk") may appear only on
 * the levels listed here: "1-3" = levels 1 to 3, "2,6,9-12" = 2, 6, 9, 10, 11, 12, "15+" = from
 * level 15 on. Perks missing from the table are available on every level. Elements stay on
 * their fixed levels (opening pick, 10 and 25).
 */
export const PERK_AVAILABILITY = {
  // perks
  gunpowder: "2-5", // v0.21u
  recruit: "2-3", // v0.27zziF (was 2-5)
  recruitflow: "2+", // v0.27zzcF: Recruitment Flow (Water)
  feudal: "2-3", // v0.27zziF (was 2-5)
  archery: "2-4", // v0.27zziF (was 2-5)
  militia: "2", // v0.17h: level 2 only
  evolution: "2-3",
  gold: "3", // v0.15: only on level 3, and only for the poorest player (see goldPerkOpen)
  novice: "2-3", // v0.27zziF (was 3-6)
  volley: "2-5", // v0.19h1: once taken also offered up to level 15 (PERK_AVAILABILITY_OWNED)
  pillage: "6+",
  crowd: "6+",
  golem: "3+",
  permafrost: "3+",
  hills: "2+", // v0.24q: from level 2; v0.22h1: skips the next level (PERK_SKIP)
  stormfeathers: "2+", // v0.22h1
  wings: "3+",
  hellfire: "2-8", // v0.19b1: Lava Floor; v0.21j: levels 2–8
  burst: "3+",
  frostbolt: "6+", // v0.23w: skips the next two levels (PERK_SKIP_LEVELS)
  clones: "6+", // v0.23w: skips the next two levels (PERK_SKIP_LEVELS)
  infested: "6+", // v0.23x: skips the next two levels (PERK_SKIP_LEVELS)
  pocks: "3+",
  treasure: "6,9", // v0.19k→l: also on level 6
  voltage: "6+", // v0.21b: open from level 6 so level 20 can be reached
  boots: "6+",
  exhume: "3+",
  waterblock: "3+",
  fireblock: "3+", // v0.19j
  airblock: "3+", // v0.20c
  supergrowth: "10+", // v0.20c: sits out the next two levels after a pick (PERK_SKIP_LEVELS)
  // v0.12
  lone: "3-5", // v0.22g1; v0.22t2: levels 3–5, later again once owned (ContinousPick)
  manufacture: "2+",
  synthesizer: "2+", // v0.20d: like Creep Manufacture
  forge: "2+", // v0.21c: Creep Forge
  autoloader: "2+", // v0.22g1: skips the next level (PERK_SKIP)
  scholar: "6+", // v0.20d
  summon: "2",
  nobility: "2+",
  breeding: "2+", // v0.27aF: skip 3
  alchemist: "6+", // v0.27aF: Poison Alchemist
  pillar: "6+", // v0.24d: from level 6 (was 5)
  fort: "2", // v0.19b1: level 2 only
  agolem: "5+",
  monsun: "6+", // v0.24j: from level 6 (was 5), skips 2 (PERK_SKIP_LEVELS)
  slave: "2+", // v0.14
  guardian: "6+", // v0.14
  quarry: "2-3", // v0.18h; v0.21c: levels 2 and 3
  backup: "2-4",
  tides: "2-4",
  sanction: "2+",
  // research (needs the matching element)
  owl: "3+", // Watcher Owl (v0.19a1: skips the next level)
  carmor: "6+", // Creep Armor (v0.19a1: skips the next level)
  leadership: "3+", // Leadership (v0.19a1)
  tailwind: "6+", // Tailwind (v0.19a1: skips the next level)
  mind: "6+", // Mind Control, was Willpower (v0.19a1: skips the next level)
  medicine: "2+", // Healing Power (v0.19a1)
  melee: "3+", // Melee Protocol, was Sparring Lessons (v0.19a1)
  heavy: "2+", // Heavy Weapons (v0.19j: from level 2, max 20)
  bank: "2+", // Magic Bank, was Magic Library (v0.19a1)
  frenzy: "2+", // Unholy Frenzy (v0.19a1)
  wolves: "2+", // Spirit Wolves (v0.19a1)
  firearrows: "2+", // Fire Arrows (v0.21c: from level 2)
  ring: "2-3", // v0.26cF: Ring of Life (ContinousPick, skips 2); v0.27zziF: 2-3 (was 2)
  revenge: "12+", // v0.26cF: Revenge (skips 3)
  scouting: "2+", // v0.27bF
  amnesia: "9,12,15,20", // v0.26eF
};
const availabilityCache = new Map();
/** v0.22j1: the first level an availability spec opens on ("2-5" → 2, "6,9" → 6). */
const firstAvailable = (spec) => Math.min(...String(spec ?? "1+").split(",").map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n)), Infinity);
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
/** v0.10i: extra levels on which a perk appears once the player owns it (at least level 1). */
export const PERK_AVAILABILITY_OWNED = {
  volley: "6-15", // v0.19h1: once taken, offered up to level 15
};
/**
 * v0.22j1: ContinousPick: once a player owns the perk (level 1 or more), its availability has no upper
 * level any more: it stays on offer on every later level until it reaches its max level.
 * (Replaces the "owned → again from level 5" rule of Gunpowder, Recruitment, Feudality and Archery.)
 */
export const PERK_CONTINUOUS = new Set(["gunpowder", "recruit", "feudal", "archery", "lone", "ring"]); // v0.26cF: Ring of Life // v0.22t2: Last Guardians
/** v0.19g1: an owned-perk extra range only counts if the perk was first taken below this level (none for now). */
const PERK_OWNED_BEFORE = {};
const perkAvailable = (o, level, p) => {
  const id = o.type === "perk" ? o.id : o.type;
  // v0.12: some perks sit out the level after they were taken
  // v0.23b: every perk now sits out the level after it was taken (skip1); a few still sit out two (PERK_SKIP_LEVELS)
  // v0.26dF: perks without their own value sit out two levels (PERK_SKIP_DEFAULT, was 1)
  const skip = PERK_SKIP_LEVELS[id] ?? PERK_SKIP_DEFAULT;
  if (o.type === "perk" && p?.perkTakenAt?.[id] != null && level - p.perkTakenAt[id] <= skip) return false; // v0.20c
  if (parseAvailability(PERK_AVAILABILITY[id] ?? "1+")(level)) return true;
  if (o.type === "perk" && PERK_CONTINUOUS.has(id) && perkLevel(p, id) >= 1 && level >= firstAvailable(PERK_AVAILABILITY[id])) return true; // v0.22j1
  if (o.type === "perk" && PERK_OWNED_BEFORE[id] && !((p?.perkFirstAt?.[id] ?? Infinity) < PERK_OWNED_BEFORE[id])) return false;
  return o.type === "perk" && perkLevel(p, id) >= 1 && !!PERK_AVAILABILITY_OWNED[id] && parseAvailability(PERK_AVAILABILITY_OWNED[id])(level);
};
/** v0.26: perks that strengthen the own defence (towers, spells and traps on the own field); a mission can leave them out. */
export const DEFENSIVE_PERKS = new Set(["alchemist", "gunpowder", "archery", "militia", "evolution", "volley", "hellfire", "frostbolt", "infested", "burst", "fireblock", "airblock", "waterblock", "pocks", "permafrost", "hills", "stormfeathers", "crowd", "lone", "summon", "pillar", "fort", "agolem", "backup", "tides", "monsun", "owl", "melee", "heavy", "frenzy", "firearrows", "autoloader"]);
/** v0.23k: with exactly one element owned, its element perks are 10 % more likely to be drawn than neutral perks. */
export const ELEMENT_PERK_WEIGHT = 1.1;
/** v0.28.002F: perks offered in a reward dialog have this weight in the next reward dialog only. */
export const RECENT_OFFER_WEIGHT = 0.5;
function makePick(game, p, kind, noQuest = false, focus = null, remember = true) {
  const oneElement = FACTIONS.filter((f) => p.research[f.unlock]).length === 1,
    recent = kind === "element" ? null : p.offeredLast || null,
    // v0.24q: times the perk's own draft weight (Hill Paths 0.75)
    weight = (o) =>
      (oneElement && o?.type === "perk" && perkElements(o.id).length ? ELEMENT_PERK_WEIGHT : 1) *
      (o?.type === "perk" ? (PERKS[o.id]?.weight ?? 1) : 1) *
      (o?.type === "perk" && recent?.includes(o.id) ? RECENT_OFFER_WEIGHT : 1);
  if (kind !== "element" && remember) {
    // the dialog made here remembers its perks for the next one (after the draw below)
    const pick = makePickDraw(game, p, kind, noQuest, focus, weight);
    p.offeredLast = pick.options.filter((o) => o.type === "perk").map((o) => o.id);
    return pick;
  }
  return makePickDraw(game, p, kind, noQuest, focus, weight);
}
function makePickDraw(game, p, kind, noQuest, focus, weight) {
  // weighted draw without putting back (all weights 1: the same as the plain draw before)
  const draw = (list, n) => {
    const pool = list.slice(),
      out = [];
    while (pool.length && out.length < n) {
      let total = 0;
      for (const o of pool) total += weight(o);
      let r = random(game) * total,
        k = 0;
      while (k < pool.length - 1 && (r -= weight(pool[k])) >= 0) k++;
      out.push(pool.splice(k, 1)[0]);
    }
    return out;
  };
  if (kind === "element")
    return { kind, level: p.level, options: draw(FACTIONS.filter((f) => !p.research[f.unlock]).map((f) => ({ type: "element", id: f.id })), 3) };
  // v0.09q: no general rewards any more; perks and research, each on its own levels
  const open = (o) => perkAvailable(o, p.level, p) && optionValid(game, p, o);
  // v0.18h: an unpopular perk the player turned down drops out of the draw with its share (stacking per refusal)
  const liked = (o) => {
    const share = PERKS[o.id]?.unpopular,
      refused = p.perkRefused?.[o.id] || 0;
    return !(share > 0 && refused > 0) || random(game) < Math.pow(1 - share, refused);
  };
  const perks = Object.keys(PERKS)
    .map((id) => ({ type: "perk", id }))
    .filter(open)
    .filter(liked);
  // v0.22g1 / v0.22i1: the reward dialog that comes with a later element pick (levels 10, 25) offers only that
  // element's perks, when one is open on this level; every other dialog is drawn as usual
  if (focus) {
    const only = perks.filter((o) => perkElements(o.id).includes(focus));
    if (only.length) return { kind, level: p.level, options: draw(only, 3), focus };
  }
  // through level 3 one perk is always among the options
  const early = p.level <= 3 && perks.length ? draw(perks, 1) : [];
  const rest = perks.filter((x) => !early.some((e) => e.id === x.id)); // v0.21: no separate upgrade pool any more
  // v0.27nF: quests are drawn apart from perks: a dialog holds one quest with questChance (33 %, lowered by quests
  // offered and not taken, down to 20 %); Breach Contract and Untouchable come in a random version
  const quests = noQuest ? [] : Object.keys(QUESTS).filter((id) => questOpen(game, p, id)),
    withQuest = quests.length > 0 && random(game) < questChance(p),
    picked = draw(rest, Math.max(0, 3 - early.length - (withQuest ? 1 : 0)));
  if (withQuest) {
    const id = quests[Math.floor(random(game) * quests.length)],
      versions = QUEST_VERSIONS[id]?.versions.length || 0;
    picked.push(versions ? { type: "quest", id, version: 1 + Math.floor(random(game) * versions) } : { type: "quest", id });
  }
  const options = draw(early.concat(picked), 3);
  return { kind, level: p.level, options, ...(noQuest ? { noQuest: true } : {}) };
}
/** Open picks were rolled at level-up; after a choice, options that are no longer possible
 *  (an element already owned, an upgrade at its last level) are swapped for fresh ones. */
function optionKey(o) {
  return o.type + ":" + (o.id || "");
}
function optionValid(game, p, o) {
  if (o.type === "quest") return questOpen(game, p, o.id); // v0.15
  if (o.type === "element") {
    const f = FACTIONS.find((x) => x.id === o.id);
    return !!f && !p.research[f.unlock];
  }
  if (o.type === "forget") return perkLevel(p, o.id) >= 1; // v0.26eF: Amnesia choice
  if (o.type === "perk" && p.perkForgotten?.[o.id]) return false; // v0.26eF: a forgotten perk never comes back this match
  if (o.type === "perk" && o.id === "amnesia" && !amnesiaTargets(p).length) return false;
  if (o.type === "perk" && perkElements(o.id).length && !perkElements(o.id).some((el) => ownsElement(p, el))) return false;
  if (o.type === "perk" && perkExcluded(o.id).some((el) => ownsElement(p, el))) return false; // v0.18h
  if (o.type === "perk" && p.rules?.noDefense && DEFENSIVE_PERKS.has(o.id)) return false; // v0.26: mission rule
  if (o.type === "perk" && o.id === "lone" && loneCount(p) > loneTowers(perkLevel(p, "lone") + 1) + 1e-6) return false; // v0.18h / v0.22g1: only while the next level's tower limit holds
  if (o.type === "perk" && o.id === "quarry" && freeCells(game, p, QUARRY.stones).length < QUARRY.stones) return false; // v0.18h
  if (o.type === "perk" && o.id === "gold" && !goldPerkOpen(game, p)) return false;
  if (o.type === "perk" && o.id === "scholar" && scholarTargets(p).length < SCHOLAR.upgrades) return false; // v0.20d
  if (o.type === "perk") return perkLevel(p, o.id) < (PERKS[o.id]?.max || 0) && (o.id !== "evolution" || evolutionTargets(game, p).length > 0);
  return true;
}
function refreshPicks(game, p) {
  // v0.26eF: an Amnesia dialog only loses choices that are gone; an empty one is dropped
  for (const pick of p.picks) if (pick.kind === "amnesia") pick.options = pick.options.filter((o) => optionValid(game, p, o));
  p.picks = p.picks.filter((pick) => pick.kind !== "amnesia" || pick.options.length);
  for (const pick of p.picks) {
    if (pick.kind === "amnesia") continue;
    const seen = new Set(),
      keep = pick.options.filter((o) => optionValid(game, p, o) && !seen.has(optionKey(o)) && seen.add(optionKey(o)));
    if (keep.length === pick.options.length) continue;
    const fresh = makePick(game, p, pick.kind, true, pick.focus || null, false).options.filter((o) => !seen.has(optionKey(o))); // v0.22i1: a focused dialog stays focused
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
  if (option.type === "quest" && !questOpen(game, p, option.id)) {
    refreshPicks(game, p); // v0.15: a stale quest choice is swapped for a fresh reward
    return { ok: false, reason: p.quest ? "Finish your running quest first" : "Quest not available" };
  }
  p.picks.shift();
  // v0.15: a quest shown in this dialog counts as offered once, taken or not
  for (const o of pick.options) if (o.type === "quest") p.questOffers = { ...(p.questOffers || {}), [o.id]: (p.questOffers?.[o.id] || 0) + 1 };
  // v0.27nF: a quest offered and not taken makes quests in later dialogs rarer (33 % → at least 20 %)
  if (option.type !== "quest" && pick.options.some((o) => o.type === "quest")) p.questChance = Math.max(QUEST_CHANCE.min, questChance(p) - QUEST_CHANCE.drop);
  // v0.18h: unpopular perks shown here and not taken become less likely
  for (const o of pick.options) if (o !== option && o.type === "perk" && PERKS[o.id]?.unpopular) p.perkRefused = { ...(p.perkRefused || {}), [o.id]: (p.perkRefused?.[o.id] || 0) + 1 };
  applyOption(game, p, option, pick.level);
  // v0.19c1: a later element (levels 10, 25) brings an ordinary level-up reward right after it
  if (option.type === "element" && pick.level > 1) {
    const extra = makePick(game, p, "upgrade", false, option.id); // v0.22i1: only this dialog shows the element's perks
    if (extra.options.length) p.picks.unshift({ ...extra, level: pick.level });
  }
  refreshPicks(game, p);
  emit(game, "picked", { player: p.id, option, level: pick.level });
  return { ok: true, option };
}
/** v0.15: the effect of one reward option (from the dialog, or granted by a quest). */
function applyOption(game, p, option, level) {
  skillEpoch++; // v0.21l: perks or research may change: tower skills are read anew
  abilityEpoch++; // v0.23i
  const pick = { level };
  if (option.type === "quest") return acceptQuest(game, p, option.id, option.version); // v0.27nF: version drawn with the offer
  if (option.type === "element") {
    const f = FACTIONS.find((x) => x.id === option.id);
    finishResearch(game, p, f.research);
    if (!p.faction) p.faction = f.id;
  }
  else if (option.type === "gold") p.gold += option.amount;
  else if (option.type === "income") p.income += option.amount;
  else if (option.type === "lives") p.lives += option.amount;
  else if (option.type === "forget") forgetPerk(game, p, option.id); // v0.26eF: Amnesia
  else if (option.type === "perk") {
    p.perks = { ...(p.perks || {}), [option.id]: perkLevel(p, option.id) + 1 };
    p.perkTakenAt = { ...(p.perkTakenAt || {}), [option.id]: pick.level }; // v0.12
    if (p.perkFirstAt?.[option.id] == null) p.perkFirstAt = { ...(p.perkFirstAt || {}), [option.id]: pick.level }; // v0.19g1
    if (option.id === "novice") p.freeGens = (p.freeGens || 0) + 1; // v0.19g1: next level 1 EXP generator is free
    if (option.id === "summon") queueSummon(game, p, "summon"); // v0.17q: after a short delay
    if (option.id === "pillar" && !(p.pillarReady > game.time)) p.pillarReady = game.time;
    if (option.id === "agolem" && !(p.golemReady > game.time)) p.golemReady = game.time;
    if (option.id === "monsun" && !(p.monsunReady > game.time)) p.monsunReady = game.time;
    if (option.id === "archery") p.freeArchers = (p.freeArchers || 0) + 1; // v0.19h1: was Forest Patrol; v0.20a: every pick, one free archer
    if (option.id === "militia") queueSummon(game, p, "militia"); // v0.17q
    if (option.id === "fort") queueSummon(game, p, "fort"); // v0.26fF: a row of walls
    if (option.id === "quarry") {
      const gold = quarryGold(pick.level, p, game); // v0.24s: by round
      p.gold += gold;
      p.stats.goldEarned += gold;
      queueSummon(game, p, "quarry"); // v0.18h: stones appear after the view moved to the own field
    }
    if (option.id === "sanction") applySanction(game, p); // v0.18h
    if (option.id === "amnesia") {
      // v0.26eF: the forget dialog opens next, before any other open reward
      const list = amnesiaTargets(p),
        options = [];
      while (list.length && options.length < AMNESIA.choices) options.push(list.splice(Math.floor(random(game) * list.length), 1)[0]);
      if (options.length) p.picks.unshift({ kind: "amnesia", level: pick.level, options });
    }
    if (option.id === "evolution") evolveTower(game, p);
    if (option.id === "scholar") scholarUpgrade(game, p); // v0.20d
    if (option.id === "gold") {
      const gold = perkGold(pick.level, p, game);
      p.gold += gold;
      p.stats.goldEarned += gold;
    }
    if (option.id === "volley" && !(p.volleyReady > game.time)) p.volleyReady = game.time;
    if (option.id === "burst" && !(p.burstReady > game.time)) p.burstReady = game.time;
    if (option.id === "frostbolt" && !(p.frostboltReady > game.time)) p.frostboltReady = game.time; // v0.23w
    if (option.id === "infested" && !(p.infestedReady > game.time)) p.infestedReady = game.time; // v0.23x
    if (option.id === "treasure") {
      const gold = treasureGold(game);
      p.gold += gold;
      p.stats.goldEarned += gold;
      p.income += treasureIncome(game, p); // v0.19e2
    }
  }
}
/** v0.26eF: Amnesia: choices in its dialog; owned perks it can forget (not powerups, not Amnesia). */
export const AMNESIA = { choices: 3 };
function amnesiaTargets(p) {
  return Object.keys(p.perks || {})
    .filter((id) => id !== "amnesia" && PERKS[id] && !PERKS[id].powerup && perkLevel(p, id) >= 1)
    .map((id) => ({ type: "forget", id }));
}
/** v0.26eF: forgets a perk for the rest of the match and queues 1 + its level extra level-up rewards. */
function forgetPerk(game, p, id) {
  const level = perkLevel(p, id);
  if (!level) return;
  const { [id]: _gone, ...rest } = p.perks;
  p.perks = rest;
  p.perkForgotten = { ...(p.perkForgotten || {}), [id]: true };
  if (id === "sanction") p.sanction = null; // its income bonus ends (running locks run out)
  if (id === "hellfire") p.lava = [];
  if (id === "infested") p.infested = [];
  for (let k = 0; k < 1 + level; k++) {
    const extra = makePick(game, p, "upgrade");
    if (extra.options.length) p.picks.push(extra);
  }
  emit(game, "amnesia", { player: p.id, id, level, rewards: 1 + level });
}
/** v0.19d2: seconds between two payouts of an EXP generator. */
export const EXP_GEN_EVERY = 4; // v0.24oF: 5 → 4 s
/** v0.15: the Gold perk is only offered to the player with the lowest gold and the lowest income. */
/** v0.20d: Scholar: owned perks it may raise (not Arcane, not powerups, below their max level). */
// v0.20e/v0.21: the former upgrades are perks now; Arcane ones (Magic Bank, Spirit Wolves) never count
function scholarTargets(p) {
  return Object.keys(p.perks || {})
    .filter((id) => id !== "scholar" && perkLevel(p, id) >= 1 && PERKS[id] && !PERKS[id].powerup && !perkLook(id).includes("arcane") && perkLevel(p, id) < PERKS[id].max)
    .map((id) => ({ type: "perk", id }));
}
function scholarUpgrade(game, p) {
  skillEpoch++; // v0.21l: perks or research may change: tower skills are read anew
  abilityEpoch++; // v0.23i
  const list = scholarTargets(p),
    done = [];
  for (let k = 0; k < SCHOLAR.upgrades && list.length; k++) {
    const { type, id } = list.splice(Math.floor(random(game) * list.length), 1)[0];
    p.perks = { ...p.perks, [id]: perkLevel(p, id) + 1 };
    if (id === "novice") p.freeGens = (p.freeGens || 0) + 1;
    if (id === "archery") p.freeArchers = (p.freeArchers || 0) + 1;
    done.push({ type, id, level: p.perks[id] });
  }
  if (done.length) emit(game, "scholar", { player: p.id, upgrades: done }); // v0.20e: one banner for the player
}
function goldPerkOpen(game, p) {
  const live = game.players.filter((q) => !q.out),
    inc = (q) => q.income + (q.incomeDecimal || 0) / 100;
  return live.every((q) => q.gold >= p.gold - 1e-9 && inc(q) >= inc(p) - 1e-9);
}
// ---- v0.15: quests ----------------------------------------------------------------------------
/**
 * Quests are a reward category of the level-up dialog. A player runs one quest at a time, takes
 * each quest once and sees each one in at most two dialogs. "Banter" quests send five waves of
 * one creep type down the player's own lane (from the second round after accepting); every quest
 * creep must die. Their creeps may come buffed: fat (more hit points) from the third wave, fast
 * (winged helmet and fine boots, faster, dodges attacks) from the fifth, which also brings a boss.
 * A won banter makes the listed creeps cheaper and lets them spawn buffed now and then; a lost one
 * makes them dearer. Untouchable asks for a number of rounds without any breach.
 */
export const QUESTS = Object.freeze({
  goblin: { name: "Goblin Banter", avail: "2-3", kind: "banter", model: "n00E", creeps: ["n00E", "n00U"], hp: 0.7, plural: "Goblins", pair: "Goblins & Trenchlins", discount: 0.2, exp: 100 }, // v0.23b: 20 % (rounded up: Goblin 4, Imp 40)
  // v0.27nF: Untouchable in 3 versions: no breach for 5 / 7 / 10 rounds (QUEST_VERSIONS)
  untouchable: { name: "Untouchable", avail: "6-12", kind: "untouchable" },
  troll: { name: "Troll Banter", avail: "8-12", kind: "banter", model: "n010", creeps: ["n010", "n00F"], hp: 0.8, plural: "Trolls", pair: "Trolls & Witch Doctors", exp: 200 },
  undead: { name: "Undead Banter", avail: "13-18", kind: "banter", model: "n016", creeps: ["n016", "n01D"], hp: 0.85, plural: "Zombies", pair: "Zombies & Ghouls", exp: 300 },
  hound: { name: "Hound Banter", avail: "19-25", kind: "banter", model: "n02L", creeps: ["n02L", "n00L"], hp: 0.9, plural: "Demon Hounds", pair: "Demon Hounds & Wolves", exp: 450 },
  scarab: { name: "Scarab Banter", avail: "26-35", kind: "banter", model: "n01S", creeps: ["n01S", "n02V"], hp: 0.95, plural: "Scarabs", pair: "Scarabs & Spawn Spiders", exp: 600 },
  // v0.27nF: Breach Contract replaces Blood and Unholy Contract: score a breach within 10 / 8 / 6 / 4 rounds (QUEST_VERSIONS)
  breach: { name: "Breach Contract", avail: "3+", kind: "breach" },
});
/**
 * v0.27nF: versions of Breach Contract and Untouchable, drawn when the quest is offered. EXP = base + player level ×
 * (15 + 5 × version number); rewards: `random` random perks at once (never Amnesia) and `points` reward points (extra
 * reward dialogs).
 */
export const QUEST_VERSIONS = {
  breach: { base: 100, versions: [{ rounds: 10, random: 2 }, { rounds: 8, random: 2 }, { rounds: 6, points: 1, random: 1 }, { rounds: 4, points: 2 }] },
  untouchable: { base: 200, versions: [{ rounds: 5, random: 2 }, { rounds: 7, points: 1, random: 1 }, { rounds: 10, points: 2 }] },
};
export const questVersion = (id, version) => QUEST_VERSIONS[id]?.versions[Math.max(1, Math.min(QUEST_VERSIONS[id].versions.length, version || 1)) - 1] || null;
export const questVersionExp = (id, version, level) => (QUEST_VERSIONS[id] ? QUEST_VERSIONS[id].base + (level || 1) * (15 + 5 * Math.max(1, version || 1)) : 0);
/** v0.27nF: chance that a reward dialog holds a quest; every offered quest not taken lowers it by `drop`, down to `min`. */
export const QUEST_CHANCE = { start: 0.33, drop: 0.02, min: 0.2 };
export const questChance = (p) => Math.max(QUEST_CHANCE.min, p?.questChance ?? QUEST_CHANCE.start);
/** Banter numbers: waves, creeps per wave, buffs, boss, reward and penalty. */
/** v0.23b: speed loss of a player's creeps of the old tier still in play once the tier boss is bought (true debuff). */
export const BOSS_TRUE_SLOW = 0.2;
/** v0.23b: range of the Archer tower, levels 1–6, in fields. */
export const ARCHER_RANGE = 3.5;
export const BANTER = {
  delay: 1, // rounds from accepting to the first wave (v0.17b: 1 instead of 2)
  waves: 5,
  count: 10,
  fat: { hp: 3, hpLate: 2.2, from: 3, chance: 0.3 }, // v0.16: ×3, ×2.2 for creeps past the 2nd place of their tier
  fast: { speed: 1.45, dodge: 0.25, from: 5, chance: 0.25 },
  boss: { hp: 1.2, armor: [2, 10, 40, 75, 75], leak: 3, bounty: 6 }, // v0.27mF: linear armor by the defender's tier (old +4)
  exp: 100,
  discount: 0.25,
  penalty: 0.25,
};
function questOpen(game, p, id) {
  const q = QUESTS[id];
  if (!q || p.quest || p.questLog?.[id] || (p.questOffers?.[id] || 0) >= 2) return false;
  return parseAvailability(q.avail)(p.level);
}
function acceptQuest(game, p, id, version = 1) {
  const q = QUESTS[id],
    v = questVersion(id, version);
  p.quest =
    q.kind === "breach"
      ? { id, version, since: game.round, until: game.round + v.rounds - 1, need: v.rounds } // v0.27nF
      : q.kind === "banter"
      ? { id, since: game.round, next: game.round + BANTER.delay, wave: 0 }
      : { id, version, since: game.round, need: v.rounds, clean: 0 }; // v0.27nF: Untouchable 5 / 7 / 10 rounds
  emit(game, "quest", { player: p.id, id, state: "start", need: p.quest.need || 0 });
}
/** Hit points of quest creeps follow the neutral wave curve at the current round. */
function questWaveNumber(game) {
  return Math.max(1, Math.floor((game.round - WAVE_FIRST_ROUND) / WAVE_EVERY_ROUNDS) + 1);
}
/** Called on every income tick: banter waves and Untouchable's round count. */
function tickQuestRound(game, p) {
  const st = p.quest;
  if (!st) return;
  const q = QUESTS[st.id];
  if (!q) {
    p.quest = null; // v0.27nF: a quest from an older version (Blood / Unholy Contract) just ends
    return;
  }
  if (q.kind === "breach") {
    if (game.round > st.until) finishQuest(game, p, false); // v0.19a1: no breach in time
    return;
  }
  if (q.kind === "untouchable") {
    if (game.round > st.since) st.clean++;
    if (st.clean >= st.need) finishQuest(game, p, true);
    return;
  }
  if (st.wave >= BANTER.waves || game.round < st.next) return;
  st.wave++;
  st.next = game.round + 1;
  const n = questWaveNumber(game),
    k = st.wave;
  for (let i = 0; i < BANTER.count; i++) {
    const roll = random(game);
    let buff = null;
    if (k >= BANTER.fast.from && roll < BANTER.fast.chance) buff = "fast";
    else if (k >= BANTER.fat.from && roll < BANTER.fast.chance * (k >= BANTER.fast.from ? 1 : 0) + BANTER.fat.chance) buff = "fat";
    game.waveQueue.push({ time: game.time + 0.5 * i, defender: p.id, number: n, type: "normal", model: q.model, flying: false, quest: st.id, buff, hpShare: q.hp });
  }
  if (k === BANTER.waves) game.waveQueue.push({ time: game.time + 0.5 * BANTER.count + 0.8, defender: p.id, number: n, type: "normal", model: q.model, flying: false, quest: st.id, boss: true, hpShare: q.hp });
  emit(game, "questWave", { player: p.id, id: st.id, wave: k, of: BANTER.waves });
}
/** A queued quest creep enters the lane. */
function spawnQuestCreep(game, entry) {
  const c = spawnWaveCreep(game, entry);
  if (!c) return null;
  const total = waveTotalHp(entry.number);
  c.quest = entry.quest;
  if (entry.boss) {
    c.hp = c.maxHp = Math.max(20, Math.round(total * BANTER.boss.hp * entry.hpShare));
    c.armor += BANTER.boss.armor[Math.max(1, Math.min(5, game.players[entry.defender]?.tier || 1)) - 1]; // v0.27mF
    c.waveBoss = true;
    c.defenseType = "hero";
    c.leakLives = BANTER.boss.leak;
    c.bounty *= BANTER.boss.bounty;
    c.speed *= 0.8;
    c.baseSpeed *= 0.8;
  } else {
    c.hp = c.maxHp = Math.max(4, Math.round((total / 10) * entry.hpShare));
    c.bounty = Math.max(1, Math.round(c.bounty * 0.6));
    if (entry.buff) buffCreep(c, entry.buff);
  }
  return c;
}
/** v0.16: fat creeps get ×3 hit points if they are among the first two of their tier, else ×2.2. */
export function fatHp(id) {
  const item = obj(id),
    place = item?.tier ? tierSends(item.tier).findIndex((s) => s.id === id) : -1;
  return place >= 0 && place < 2 ? BANTER.fat.hp : BANTER.fat.hpLate;
}
/** Fat: more hit points. Fast: faster and dodges attacks. */
function buffCreep(c, kind) {
  c.buff = kind;
  if (kind === "fat") {
    const k = fatHp(c.typeId);
    c.maxHp *= k;
    c.hp *= k;
  } else {
    c.speed *= BANTER.fast.speed;
    c.baseSpeed *= BANTER.fast.speed;
    c.dodge = BANTER.fast.dodge;
  }
}
/** Every tick: a banter whose waves are out and whose creeps are all dead is won. */
function checkQuest(game, p) {
  const st = p.quest;
  if (!st || QUESTS[st.id].kind !== "banter" || st.wave < BANTER.waves) return;
  if (p.creeps.some((c) => c.quest === st.id && !c.dead && c.hp > 0)) return;
  if (game.waveQueue?.some((w) => w.quest === st.id && w.defender === p.id)) return;
  finishQuest(game, p, true);
}
/** A breach in this player's lane: banter fails when a quest creep gets through, Untouchable on any. */
function questBreach(game, p, c) {
  const st = p.quest;
  if (!st) return;
  if (QUESTS[st.id]?.kind === "untouchable" || c.quest === st.id) finishQuest(game, p, false);
}
function finishQuest(game, p, won) {
  const st = p.quest,
    q = QUESTS[st.id];
  p.quest = null;
  p.questLog = { ...(p.questLog || {}), [st.id]: won ? "won" : "lost" };
  const granted = [],
    gold0 = p.gold,
    income0 = p.income; // v0.17m: gold/income rewards for the quest overlay
  let exp = 0;
  if (won && q.kind === "banter") exp = q.exp ?? BANTER.exp; // v0.23zh: later banters give more EXP (100 / 200 / 300 / 450 / 600)
  // v0.27nF: Breach Contract and Untouchable: EXP by version and level, random perks and reward points by version
  if (won && QUEST_VERSIONS[st.id]) {
    const v = questVersion(st.id, st.version);
    exp = questVersionExp(st.id, st.version, p.level);
    for (let i = 0; i < (v.random || 0); i++) {
      // a random perk: never Amnesia (it asks for a choice of its own)
      const options = makePick(game, p, "upgrade", true, null, false).options.filter((o) => o.type === "perk" && o.id !== "amnesia");
      if (!options.length) continue;
      const option = options[Math.floor(random(game) * options.length)];
      applyOption(game, p, option, p.level);
      granted.push(option);
    }
    for (let i = 0; i < (v.points || 0); i++) p.picks.push(makePick(game, p, "upgrade", true));
  }
  if (exp) gainExp(game, p, exp, "quest");
  if (won && p.stats) questHunterCheck(game, p); // v0.27oF
  emit(game, "quest", { player: p.id, id: st.id, state: won ? "won" : "lost", exp, granted, rounds: st.need || 0, gold: Math.max(0, p.gold - gold0), income: Math.max(0, p.income - income0) });
}
/** Cost share of a send from finished banters (won: cheaper, lost: dearer). */
function questCostShare(p, item) {
  let share = 1;
  for (const [id, result] of Object.entries(p?.questLog || {})) {
    const q = QUESTS[id];
    if (q?.kind !== "banter" || !q.creeps.includes(item.id)) continue;
    if (result === "won") share *= 1 - (q.discount ?? BANTER.discount); // v0.17: a failed banter costs nothing; v0.23b: own discount per banter
  }
  return share;
}
/** v0.24s: Quarry gold: round × 10, at least 60, with the round in which the player reached the level it was drafted for. */
export const quarryGold = (level, p = null, game = null) => Math.max(60, (p?.levelRound?.[level] ?? game?.round ?? 0) * 10);
/** Gold perk: 40 + 20 × the level of the dialog it was offered in. */
/** v0.22: Gold perk: round × 5 + 20, with the round in which the player reached that level. */
export const perkGold = (level, p = null, game = null) => (p?.levelRound?.[level] ?? game?.round ?? 0) * 5 + 20;
/** Militia: footmen that stand at once on random free fields (never blocking the path). */
/**
 * v0.26fF: tower value. Every tower keeps the gold its levels cost (t.value): built and upgraded levels count in
 * full (discounts and free towers too); a tower summoned for free (perks, mission presets) counts its level 1 at
 * 50 % and every higher level at 25 %. Paid upgrades on top count in full. Selling returns 50 % of the value
 * (more against Very Easy / Easy bots, SELL_RELIEF).
 */
export const TOWER_VALUE = { summonFirst: 0.5, summonLater: 0.25, sell: 0.5 };
let TOWER_PARENT = null;
function towerChain(id) {
  if (!TOWER_PARENT) {
    TOWER_PARENT = new Map();
    for (const u of getCatalog().towers) for (const up of u.upgrades || []) if (!TOWER_PARENT.has(up)) TOWER_PARENT.set(up, u.id);
  }
  const chain = [id];
  for (let cur = id, n = 0; !obj(cur)?.isRoot && TOWER_PARENT.has(cur) && n < 20; n++) chain.unshift((cur = TOWER_PARENT.get(cur))); // up to the buildable root
  return chain;
}
export function summonedValue(id) {
  return towerChain(id).reduce((sum, x, i) => sum + (obj(x)?.cost || 0) * (i ? TOWER_VALUE.summonLater : TOWER_VALUE.summonFirst), 0);
}
/** v0.26fF: a tower's value (older saves without one: the full price, summoned towers by the summon rule). */
export function towerValue(t) {
  if (Number.isFinite(t?.value)) return t.value;
  const item = obj(t?.typeId);
  return t?.summoned || t?.preset || t?.militia ? summonedValue(t.typeId) : item?.pointValue || item?.cost || 0;
}
function markSummoned(t) {
  t.value = summonedValue(t.typeId);
  t.freeBase = t.value; // what the tower was worth for free (left out of Tower Worth achievements)
}
/** v0.26fF: Fortifications: a full row of walls with one free field at its left or right end, on the free row farthest from the own towers. */
function placeWallRow(game, p) {
  const cols = game.grid.cols,
    rows = laneRows(game, p),
    towerRows = p.towers.map((t) => gridAt(game, t).y),
    rowsFree = [];
  for (let y = 0; y < rows; y++) {
    let ok = true;
    for (let x = 0; x < cols && ok; x++) if (towerAt(p, x, y) || !canBuild(game, p.id, x, y, WALL_ID).ok) ok = false;
    if (ok) rowsFree.push({ y, far: towerRows.length ? Math.min(...towerRows.map((ty) => Math.abs(ty - y))) : rows });
  }
  rowsFree.sort((a, b) => b.far - a.far);
  const best = rowsFree.filter((r) => r.far === rowsFree[0]?.far);
  // ties: random order; each row tries the gap on the side that makes the path longer first
  while (best.length) {
    const { y } = best.splice(Math.floor(random(game) * best.length), 1)[0],
      sides = [0, cols - 1].map((gap) => ({ gap, len: findPath(game, p.id, null, Array.from({ length: cols }, (_, x) => ({ x, y })).filter((c) => c.x !== gap))?.length || 0 }))
        .filter((s) => s.len > 0)
        .sort((a, b) => b.len - a.len || random(game) - 0.5);
    for (const { gap } of sides) {
      const cells = Array.from({ length: cols }, (_, x) => x).filter((x) => x !== gap);
      if (!cells.every((x) => canBuild(game, p.id, x, y, WALL_ID).ok)) continue;
      const placed = [];
      for (const x of cells) {
        if (!canBuild(game, p.id, x, y, WALL_ID).ok) break;
        const w = newTower(game, p, WALL_ID, x, y);
        w.buildRemaining = 0;
        w.summoned = true;
        markSummoned(w);
        p.towers.push(w);
        placed.push(w);
        p.stats.built++;
        repath(game, p);
        emit(game, "build", { player: p.id, id: WALL_ID, towerId: w.id, x: w.x, y: w.y, summoned: true });
        completeTower(game, p, w);
      }
      if (placed.length) {
        emit(game, "summon", { player: p.id, id: WALL_ID, towerId: placed[0].id, x: placed[0].x, y: placed[0].y, level: 1, walls: placed.length });
        return;
      }
    }
  }
  summonRefund(game, p, WALL_ID, cols - 1); // v0.27xF: no free row: the walls' sell value in gold
}
/**
 * v0.27xF: a free tower that finds no free field pays the gold selling it would give instead (summoned value × sell
 * rate, walls 1 gold each).
 */
function summonRefund(game, p, id, count = 1) {
  if (!obj(id) || count <= 0) return 0;
  const relief = sellRelief(game, p.id),
    rate = TOWER_VALUE.sell + (1 - TOWER_VALUE.sell) * relief,
    each = id === WALL_ID ? 1 : Math.max(0, Math.trunc(summonedValue(id) * rate + 1e-9)),
    gold = each * count;
  if (gold > 0) {
    p.gold += gold;
    p.stats.goldEarned += gold;
    emit(game, "summonGold", { player: p.id, id, gold, count });
  }
  return gold;
}
function placeMilitia(game, p, count) {
  for (let k = 0; k < count; k++) {
    const cells = [];
    for (let y = 0; y < laneRows(game, p); y++)
      for (let x = 0; x < game.grid.cols; x++) if (canBuild(game, p.id, x, y, "h000").ok) cells.push([x, y]);
    if (!cells.length) return void summonRefund(game, p, "h000", count - k); // v0.27xF: no free field: their sell value in gold
    const [x, y] = cells[Math.floor(random(game) * cells.length)],
      tower = newTower(game, p, "h000", x, y);
    tower.buildRemaining = 0;
    tower.militia = true;
    markSummoned(tower); // v0.26fF: summoned for free
    p.towers.push(tower);
    p.stats.built++;
    repath(game, p);
    emit(game, "build", { player: p.id, id: "h000", towerId: tower.id, x: tower.x, y: tower.y });
    emit(game, "summon", { player: p.id, id: "h000", towerId: tower.id, x: tower.x, y: tower.y, level: 1, militia: true }); // v0.17q: same arrival effect
    completeTower(game, p, tower);
  }
}
/**
 * v0.19g1: Evolution targets: level 2 towers with a level 3 upgrade the player could take (gold
 * aside); only when there is none, level 1 towers with a level 2 upgrade.
 */
function evolutionTargets(game, p) {
  const at = (lv) => {
    const out = [];
    for (const t of p.towers) {
      const item = obj(t.typeId);
      if (!item || (item.level || 1) !== lv || t.buildRemaining > 0 || item.isHall || t.typeId === WALL_ID || t.typeId === ROCK_ID) continue;
      const ups = item.upgrades.filter((id) => {
        const u = obj(id);
        if (!u?.playable || (u.level || 1) !== lv + 1) return false;
        const a = available(game, p.id, "upgrade", id, t.id);
        return a.ok || /more gold/.test(a.reason || "");
      });
      if (ups.length) out.push({ t, ups });
    }
    return out;
  };
  const two = at(2);
  return two.length ? two : at(1);
}
/** Evolution: a random level 2 (else level 1) tower takes one of its next upgrades at once, free, and a copy follows. */
function evolveTower(game, p) {
  const list = evolutionTargets(game, p);
  if (!list.length) return;
  const { t, ups } = list[Math.floor(random(game) * list.length)],
    id = ups[Math.floor(random(game) * ups.length)],
    item = obj(id),
    old = obj(t.typeId),
    ratio = t.hp / t.maxHp;
  if (t.completed && old.woodIncome) p.woodIncome -= old.woodIncome;
  t.value = towerValue(t) + (item.cost || 0); // v0.26fF: a free upgrade counts in full
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
  // v0.19g1: the copy arrives like a summoned tower, after the view moved to the own field
  if (!UNIQUE_TOWERS.has(id) && footprintOf(id) === 1) queueSummon(game, p, "copy", { id });
}
/** v0.19g1: the Evolution copy: the same tower on a random free field, sells for 10 % of its value. */
function placeCopy(game, p, id) {
  const item = obj(id);
  if (!item) return;
  const cells = [];
  for (let y = 0; y < laneRows(game, p); y++) for (let x = 0; x < game.grid.cols; x++) if (canBuild(game, p.id, x, y, id).ok) cells.push([x, y]);
  if (!cells.length) return void summonRefund(game, p, id); // v0.27xF: no free field: its sell value in gold
  const [x, y] = cells[Math.floor(random(game) * cells.length)],
    tower = newTower(game, p, id, x, y);
  tower.buildRemaining = 0;
  tower.summoned = true;
  tower.summonValue = item.pointValue || 0;
  tower.totalSpent = 0;
  markSummoned(tower); // v0.26fF
  p.towers.push(tower);
  p.stats.built++;
  repath(game, p);
  emit(game, "build", { player: p.id, id, towerId: tower.id, x: tower.x, y: tower.y, summoned: true });
  emit(game, "summon", { player: p.id, id, towerId: tower.id, x: tower.x, y: tower.y, level: item.level || 1 });
  completeTower(game, p, tower);
}
/** Arrow Volley: arrows of the perk (as level 1 archers) plus two per archer-line tower (v0.19k), spread over a moment. */
function launchVolley(game, p, x, y) {
  const level = perkLevel(p, "volley"),
    base = obj("h003"),
    arrows = [];
  const grow = 1 + VOLLEY.perRound * Math.max(0, game.round || 0), // v0.19g1: +0.5 % per round
    baseDamage = (VOLLEY.bonus + statsFor(game, p, base).damage) * grow;
  for (let i = 0; i < VOLLEY.perLevel * level; i++) arrows.push({ damage: baseDamage, attackType: base.attackType });
  for (const t of p.towers) {
    if (t.buildRemaining > 0 || !archerLine().has(t.typeId)) continue;
    const item = obj(t.typeId),
      // v0.19g1: +50 %; v0.19k: two arrows per archer-line tower, +15 % per tower level above 1
      damage = (VOLLEY.bonus + VOLLEY.archer * statsFor(game, p, item).damage) * grow * (1 + VOLLEY.perTowerLevel * Math.max(0, (item.level || 1) - 1));
    for (let k = 0; k < VOLLEY.perTower; k++) arrows.push({ damage, attackType: item.attackType });
  }
  const n = arrows.length;
  arrows.forEach((a, i) => (game.volleys ||= []).push({ player: p.id, x, y, time: game.time + (VOLLEY.spread * i) / Math.max(1, n), ...a }));
  p.volleyReady = game.time + abilityCd(p, volleyCd(perkLevel(p, "volley"))); // v0.21c: 1 s less per level
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
      // v0.27aF: Arrow damage (counts like an Archer-Line hit); a creep the volley kills gives 300 % EXP
      const before = hit.hp;
      volleyStrike = true;
      try {
        strike(game, p, null, hit, v.damage, v.attackType);
      } finally {
        volleyStrike = false;
      }
      if (before > 0 && hit.hp <= 0) {
        hit.volleyKill = true;
        hit.lastHit = null;
      }
    }
    // a miss lands somewhere in the area
    const a = random(game) * Math.PI * 2,
      d = random(game) * VOLLEY.radius,
      at = hit ? { x: hit.x, y: hit.y } : { x: v.x + (Math.cos(a) * d) / game.grid.cols, y: v.y + (Math.sin(a) * d) / game.grid.rows };
    emit(game, "volley", { player: p.id, x: at.x, y: at.y, targetId: hit?.id ?? null });
  }
}
function completeTower(game, p, t) {
  abilityEpoch++; // v0.23i: a finished tower can fulfil a skill requirement
  if (t.completed) return;
  t.completed = true;
  delete t.upgradeUndo; // v0.25j
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
    gainExp(game, p, wood, "achievement");
    emit(game, "achievement", { player: p.id, achievement: "hall", name: "Hall Builder", exp: wood }); // v0.19d2: named for the notification
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
  towerAchievements(game, p, t, item); // v0.15
  builderCheck(game, p); // v0.19j: Constructor / Highrise / Tycoon
  emit(game, "built", { player: p.id, towerId: t.id, id: item.id });
}
/**
 * v0.15: two achievements every player can earn once: the first element tower built or upgraded,
 * and the first tower upgraded to its last level. Each gives a little EXP.
 */
export const TOWER_ACHIEVEMENTS = Object.freeze({
  element: { name: "Elementalist", text: "Your first element tower", exp: 25 },
  maxed: { name: "Master Builder", text: "Your first tower at its highest level", exp: 200 }, // v0.16: 200 EXP
});
function towerAchievements(game, p, t, item) {
  if (t.fromSale || t.summoned || item.support === "farm") return;
  const got = (p.achieved ||= {});
  const award = (key) => {
    got[key] = true;
    const a = TOWER_ACHIEVEMENTS[key];
    gainExp(game, p, a.exp, "achievement");
    emit(game, "achievement", { player: p.id, achievement: key, name: a.name, exp: a.exp });
  };
  if (!got.element && item.element && item.element !== "neutral") award("element");
  if (!got.maxed && t.upgrading && (item.level || 1) > 1 && !(item.upgrades || []).some((id) => obj(id))) award("maxed");
}
/**
 * v0.16: achievements only the first player in a match gets: Labyrinth (a path of 30+ fields)
 * and Creep Collector I–V (every creep of a tier bought at least once, the boss excepted).
 */
export const GLOBAL_ACHIEVEMENTS = Object.freeze({ labyrinth: { name: "Labyrinth", fields: 30, exp: 100 } });
export const collectorExp = (tier) => tier * 100 + 50;
const ROMAN = ["", "I", "II", "III", "IV", "V"];
function labyrinthCheck(game, p) {
  const a = (game.achievements ||= { tiers: [], halls: 0, hallNextTime: 0 }),
    need = GLOBAL_ACHIEVEMENTS.labyrinth;
  if (a.labyrinth !== undefined || !p.path || p.path.length - 1 < need.fields) return;
  a.labyrinth = p.id;
  gainExp(game, p, need.exp, "achievement");
  emit(game, "achievement", { player: p.id, achievement: "labyrinth", name: need.name, exp: need.exp, global: true });
}
function collectorCheck(game, p, item) {
  if (!item.tier || item.bossTier) return;
  (p.bought ||= {})[item.id] = true;
  const a = (game.achievements ||= { tiers: [], halls: 0, hallNextTime: 0 }),
    done = (a.collector ||= {});
  if (done[item.tier] !== undefined) return;
  if (!tierSends(item.tier).every((x) => x.bossTier || p.bought[x.id])) return;
  done[item.tier] = p.id;
  const exp = collectorExp(item.tier);
  gainExp(game, p, exp, "achievement");
  emit(game, "achievement", { player: p.id, achievement: "collector", tier: item.tier, name: "Creep Collector " + ROMAN[item.tier], exp, global: true });
}
/**
 * v0.18f: Recruiter I–V — global, only the first player to spend this much gold on non-boss creeps.
 */
export const RECRUITER_ACHIEVEMENTS = Object.freeze([
  { gold: 500, exp: 25 },
  { gold: 2500, exp: 40 },
  { gold: 10000, exp: 120 },
  { gold: 100000, exp: 240 },
  { gold: 1000000, exp: 360 },
]);
/** v0.27oF: Airborne / Air Force — global, the first player to spend 5,000 / 50,000 gold on flying creeps. */
export const AIR_ACHIEVEMENTS = Object.freeze([
  { name: "Airborne", gold: 5000, exp: 100 },
  { name: "Air Force", gold: 50000, exp: 300 },
]);
/** v0.27oF: Quest Hunter — global, the first player to complete 3 quests. */
export const QUEST_HUNTER = Object.freeze({ name: "Quest Hunter", quests: 3, exp: 200 });
function airCheck(game, p, item, gold) {
  if (!item.flying || !gold) return;
  const spent = (p.stats.airGold = (p.stats.airGold || 0) + gold),
    a = (game.achievements ||= { tiers: [], halls: 0, hallNextTime: 0 }),
    done = (a.air ||= {});
  AIR_ACHIEVEMENTS.forEach((r, i) => {
    if (done[i] !== undefined || spent < r.gold) return;
    done[i] = p.id;
    gainExp(game, p, r.exp, "achievement");
    emit(game, "achievement", { player: p.id, achievement: "air", level: i + 1, name: r.name, exp: r.exp, global: true });
  });
}
function questHunterCheck(game, p) {
  const won = (p.stats.questsWon = (p.stats.questsWon || 0) + 1),
    a = (game.achievements ||= { tiers: [], halls: 0, hallNextTime: 0 });
  if (a.questHunter !== undefined || won < QUEST_HUNTER.quests) return;
  a.questHunter = p.id;
  gainExp(game, p, QUEST_HUNTER.exp, "achievement");
  emit(game, "achievement", { player: p.id, achievement: "questHunter", name: QUEST_HUNTER.name, exp: QUEST_HUNTER.exp, global: true });
}
function recruiterCheck(game, p, item, gold) {
  if (item.bossTier || !gold) return;
  const spent = (p.stats.creepGold = (p.stats.creepGold || 0) + gold),
    a = (game.achievements ||= { tiers: [], halls: 0, hallNextTime: 0 }),
    done = (a.recruiter ||= {});
  RECRUITER_ACHIEVEMENTS.forEach((r, i) => {
    if (done[i] !== undefined || spent < r.gold) return;
    done[i] = p.id;
    gainExp(game, p, r.exp, "achievement");
    emit(game, "achievement", { player: p.id, achievement: "recruiter", level: i + 1, name: "Recruiter " + ROMAN[i + 1], exp: r.exp, global: true });
  });
}
/**
 * v0.19j: Constructor, Highrise and Tycoon — global, only the first player whose towers together
 * cost 1,000 / 10,000 / 100,000 gold (what was really paid: rocks, farms and free or summoned value don't count).
 */
export const BUILDER_ACHIEVEMENTS = Object.freeze([
  { key: "constructor", name: "Constructor", gold: 1000, exp: 130, frame: "bronze" },
  { key: "highrise", name: "Highrise", gold: 10000, exp: 300, frame: "silver" },
  { key: "tycoon", name: "Tycoon", gold: 100000, exp: 900, frame: "gold" },
]);
export function towerWorth(p) {
  let sum = 0;
  for (const t of p.towers || []) {
    if (t.typeId === ROCK_ID) continue;
    const item = obj(t.typeId);
    if (!item || item.support === "farm") continue;
    sum += Math.max(0, towerValue(t) - (t.freeBase || 0)); // v0.26fF: tower value without what perks gave for free
  }
  return sum;
}
/** The player's most valuable tower (its art goes on the builder splat). */
function bestTower(p) {
  let best = null;
  for (const t of p.towers || []) {
    const item = t.typeId !== ROCK_ID && obj(t.typeId);
    if (item && item.support !== "farm" && (item.pointValue || 0) > (best?.v || 0)) best = { id: t.typeId, v: item.pointValue };
  }
  return best?.id;
}
function builderCheck(game, p) {
  const a = (game.achievements ||= { tiers: [], halls: 0, hallNextTime: 0 }),
    done = (a.builder ||= {});
  if (BUILDER_ACHIEVEMENTS.every((b) => Object.hasOwn(done, b.key))) return;
  const worth = towerWorth(p);
  for (const b of BUILDER_ACHIEVEMENTS) {
    if (Object.hasOwn(done, b.key) || worth < b.gold) continue; // hasOwn: "constructor" is on every object
    done[b.key] = p.id;
    gainExp(game, p, b.exp, "achievement");
    emit(game, "towerSplat", { player: p.id, achievement: b.key, name: b.name, frame: b.frame, exp: b.exp, typeId: bestTower(p) });
  }
}
/** v0.19j: Bloodthirst (10+ lives stolen) and Bloodrage (30+) — global, first player only, a splat like First Blood. */
export const BLOOD_ACHIEVEMENTS = Object.freeze([
  { key: "bloodthirst", name: "Bloodthirst", lives: 10, mult: 3 },
  { key: "bloodrage", name: "Bloodrage", lives: 30, mult: 5 },
]);
function bloodCheck(game, sender) {
  const a = (game.achievements ||= { tiers: [], halls: 0, hallNextTime: 0 }),
    done = (a.blood ||= {}),
    stolen = Object.values(sender.stats.stoleFrom || {}).reduce((s, n) => s + n, 0);
  for (const b of BLOOD_ACHIEVEMENTS) {
    if (Object.hasOwn(done, b.key) || stolen < b.lives) continue;
    done[b.key] = sender.id;
    const exp = RULES.firstBloodWood * b.mult; // 200 % / 400 % more than First Blood
    gainExp(game, sender, exp, "achievement");
    emit(game, "firstBlood", { player: sender.id, exp, kind: b.key, name: b.name });
  }
}
function pay(p, cost) {
  p.gold -= cost.gold;
  if (p.gold < 0 && p.gold > -1e-6) p.gold = 0; // v0.23u: rounding (gold 9.999…, price 10) no longer leaves -0.000001 gold (shown as -1)
}

/** All human and AI actions use this same validated command entry point. */
/** v0.22b: match recorder hook (the app logs human commands of Insane training matches for replays). */
let commandHook = null;
export function setCommandHook(fn) {
  commandHook = typeof fn === "function" ? fn : null;
}
export function command(game, input) {
  const result = runCommand(game, input);
  if (commandHook) try { commandHook(game, input, result); } catch {}
  if (game.teams) teamSync(game); // v0.20
  return result;
}
// v0.23i: commands that never change what towers can do (sending creeps, active perk spells, pause)
const SKILL_NEUTRAL = new Set(["send", "autoSend", "autoMode", "pause", "volley", "burst", "pillar", "monsun", "frostbolt", "infested"]);
function runCommand(game, input) {
  skillEpoch++; // v0.21l: perks or research may change: tower skills are read anew
  if (!SKILL_NEUTRAL.has(input?.type)) abilityEpoch++; // v0.23i
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
    // v0.18h: modes Default (the creep in the slot), Eco (best budget creep) and Tier Up (save for the boss)
    if (AUTO_MODES.includes(input.mode)) {
      p.autoMode = input.mode;
      if (input.mode !== "default") p.autoSend = null;
    } else if (input.id) p.autoMode = "default";
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
    if (!game.teams) p.lives = 0; // v0.20: in a team game the team keeps its lives
    emit(game, "surrender", { player: p.id });
    defeat(game, p, null, true);
    return { ok: true };
  }
  if (type === "pick") return resolvePick(game, p, input.index | 0);
  if (game.paused) return { ok: false, reason: "Game paused" };
  if (type === "sell") return sellTower(game, p, input.towerId);
  if (type === "burst") {
    if (!perkLevel(p, "burst")) return { ok: false, reason: "Arcane Burst not learned" };
    if (p.burstReady > game.time + EPS) return { ok: false, reason: `Arcane Burst ready in ${Math.ceil(p.burstReady - game.time)} s` };
    const x = Number(input.x),
      y = Number(input.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < -0.1 || y > 1.1) return { ok: false, reason: "Outside the board" };
    launchBurst(game, p, x, y);
    return { ok: true };
  }
  if (type === "infested") {
    // v0.23x: Infested Ground (aimed at a field)
    if (!perkLevel(p, "infested")) return { ok: false, reason: "Infested Ground not learned" };
    if (p.infestedReady > game.time + EPS) return { ok: false, reason: `Infested Ground ready in ${Math.ceil(p.infestedReady - game.time)} s` };
    const x = Number(input.x),
      y = Number(input.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return { ok: false, reason: "Outside the board" };
    placeInfested(game, p, x, y);
    return { ok: true };
  }
  if (type === "frostbolt") {
    // v0.23w: Frost Bolt (aimed)
    if (!perkLevel(p, "frostbolt")) return { ok: false, reason: "Frost Strike not learned" };
    if (p.frostboltReady > game.time + EPS) return { ok: false, reason: `Frost Strike ready in ${Math.ceil(p.frostboltReady - game.time)} s` };
    const x = Number(input.x),
      y = Number(input.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < -0.1 || y > 1.1) return { ok: false, reason: "Outside the board" };
    launchFrostBolt(game, p, x, y);
    return { ok: true };
  }
  // v0.12: Pillar of Fire (aimed), Arcane Golem and Monsun (instant)
  if (type === "pillar") {
    if (!perkLevel(p, "pillar")) return { ok: false, reason: "Pillar of Fire not learned" };
    if (p.pillarReady > game.time + EPS) return { ok: false, reason: `Pillar of Fire ready in ${Math.ceil(p.pillarReady - game.time)} s` };
    const x = Number(input.x),
      y = Number(input.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < -0.1 || y > 1.1) return { ok: false, reason: "Outside the board" };
    launchPillar(game, p, x, y);
    return { ok: true };
  }
  if (type === "agolem") {
    if (!perkLevel(p, "agolem")) return { ok: false, reason: "Arcane Golem not learned" };
    if (p.golemReady > game.time + EPS) return { ok: false, reason: `Arcane Golem ready in ${Math.ceil(p.golemReady - game.time)} s` };
    return launchGolem(game, p);
  }
  if (type === "monsun") {
    if (!perkLevel(p, "monsun")) return { ok: false, reason: "Monsun not learned" };
    if (p.monsunReady > game.time + EPS) return { ok: false, reason: `Monsun ready in ${Math.ceil(p.monsunReady - game.time)} s` };
    launchMonsun(game, p);
    return { ok: true };
  }
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
    if (aiCondBlocks(game, p, gx, gy, id)) return { ok: false, reason: "Conditional perk" }; // v0.23b
    const free = id === "h003" && (p.freeArchers || 0) > 0;
    const starter = free && (p.starterArchers || 0) > 0;
    const freeGen = id === "h01F" && (p.freeGens || 0) > 0; // v0.19g1: Novice
    if (free) p.freeArchers--;
    else if (freeGen) p.freeGens--;
    else pay(p, check.cost);
    if (starter) p.starterArchers--;
    const root = directRootOf(p, id); // v0.27zzdF: a level-2 blueprint builds level 2 like any blueprint
    if (!free && (BASIC_TOWERS.has(id) || root)) p.basicBought = (p.basicBought || 0) + 1; // v0.23b
    const tower = newTower(game, p, id, gx, gy);
    if (root) {
      tower.previousTypeId = root.id;
      tower.totalSpent = (root.cost || 0) + (item.cost || 0);
      tower.value = (root.cost || 0) + (item.cost || 0);
      if (check.cost.gold < tower.value) tower.discount = tower.value - check.cost.gold;
    }
    if (free && !starter) tower.free = true;
    if ((free && !starter) || freeGen) tower.freeValue = item.pointValue || item.cost; // v0.19h1: free archers and EXP generators sell for 10 % of their own value
    else if (!free && !root && check.cost.gold < item.cost) tower.discount = item.cost - check.cost.gold; // v0.19d2: the half-price EXP generator sells on what was paid
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
    // v0.25j: what a sale during the upgrade has to undo (the upgrade is cancelled and paid back in full first)
    t.value = towerValue(t) + (item.cost || 0); // v0.26fF
    t.upgradeUndo = { from: t.typeId, name: t.name, gold: check.cost.gold, spent: item.cost, value: item.cost || 0, wood: item.woodCost, woodBack: t.completed && old.woodIncome ? old.woodIncome : 0 };
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
    // v0.21j: Call the Peons (an Orc restocked one Goblin, v0.18e) removed
    supergrowth(p, item); // v0.20c
    if (id === "n00Y") p.treantCount++; // v0.10w: EXP now on the treant's death, burning from purchase 21
    if (id === "n01D") {
      if (p.ghoulCount <= 25) {
        p.ghoulCount++;
        p.woodIncome++;
      }
      gainExp(game, p, 1, "ghoul");
    }
    // v0.23w: Clones: each creep of the card may bring a clone (heavy creeps from level 3, bosses from level 6)
    const cloneLv = perkLevel(p, "clones"),
      cloneOk = cloneLv > 0 && (!item.bossTier || cloneLv >= CLONES.bossFrom) && (item.bossTier || !isHeavy(item) || cloneLv >= CLONES.heavyFrom);
    let clones = 0;
    for (const spawnId of item.spawnIds) {
      sendSpawn(game, p.id, spawnId); // v0.23p: smoothed (was spawnCreep)
      if (cloneOk && random(game) < cloneChance(cloneLv)) {
        sendSpawn(game, p.id, spawnId, true);
        clones++;
      }
    }
    if (clones) {
      // each clone adds its creep's share of the card's income, in hundredths like the rest
      const share = Math.round(((base * 100 + decimal) * clones) / Math.max(1, item.spawnIds.length));
      p.incomeDecimal += share;
      p.income += Math.trunc(p.incomeDecimal / 100);
      p.incomeDecimal %= 100;
      emit(game, "clones", { player: p.id, id, count: clones });
    }
    p.stats.sent++;
    p.stats.creeps = (p.stats.creeps || 0) + item.spawnIds.length; // v0.14
    collectorCheck(game, p, item); // v0.16
    (p.stats.spent ||= {})[id] = (p.stats.spent[id] || 0) + (check.cost?.gold || 0);
    recruiterCheck(game, p, item, check.cost?.gold || 0); // v0.18f
    airCheck(game, p, item, check.cost?.gold || 0); // v0.27oF: Airborne / Air Force
    guardianSend(game, p); // v0.14: River Guardian
    emit(game, "send", { player: p.id, id, count: item.spawnIds.length, income: base + decimal / 100, auto: !!input.auto });
    if (item.bossTier) {
      const reward = { n00T: 250, n015: 375, n01H: 500, n01T: 250, n02R: 300 }[id];
      if (reward) gainExp(game, p, reward, "bossSend");
      // Each tier boss can be bought once; buying it unlocks the next tier (tier 6 is off in the source).
      p.bossBought = { ...(p.bossBought || {}), [id]: true };
      if (id === "n01T") p.infernalBossCount++;
      if (id !== MOUNTAIN_GOLEM.id) advanceTier(game, p, item.bossTier);
      else p.mountainGolems = (p.mountainGolems || 0) + 1; // v0.26cF: tier-5 creeps +5 % HP for good, no tier 6
      // v0.23b: the creeps of the tier left behind that are still in play lose 20 % speed for good (a true
      // debuff: no perk or ability that softens or shortens debuffs touches it)
      for (const pl of game.players)
        for (const c of pl.creeps || []) {
          const def = obj(c.typeId);
          if (id !== MOUNTAIN_GOLEM.id && c.owner === p.id && !c.dead && c.hp > 0 && !c.wave && def && !def.bossTier && def.tier === item.tier) c.trueSlow = Math.max(c.trueSlow || 0, BOSS_TRUE_SLOW);
        }
    }
    // v0.27F: the Mud Golem opens the rest of tier 1 (once)
    if (id === MINI_BOSS.id && !p.mudGolem) {
      p.mudGolem = true;
      // v0.27.006: the creeps it opens start their delay now (rounds from the purchase, MUD_GOLEM_LOCKS)
      if (!p.rules?.noStartDelay)
        for (const [sid, rounds] of Object.entries(MUD_GOLEM_LOCKS)) if (obj(sid)) p.stock[sid] = { count: 0, next: LOCKED_NEXT, lockRound: game.round + rounds };
      gainExp(game, p, MINI_BOSS.exp, "bossSend");
      emit(game, "tier", { player: p.id, tier: 1, message: "Tier 1 creeps unlocked" });
    }
    return { ok: true, count: item.spawnIds.length };
  }
  return { ok: false, reason: "Unknown command" };
}

function finishResearch(game, p, id) {
  skillEpoch++; // v0.21l: perks or research may change: tower skills are read anew
  abilityEpoch++; // v0.23i
  p.research[id] = (p.research[id] || 0) + 1;
  const element = FACTIONS.find((f) => f.research === id);
  if (element) {
    p.research[element.unlock] = 1;
    p.elementsPurchased++;
    p.research.Rhfs = FACTIONS.filter((f) => p.research[f.unlock]).length;
  }
  // v0.27zfF: R00R no longer turns Arrow Towers into Arcane Towers (the Arcane Tower line was removed)
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
        c.maxHp = s.hp * (c.hpMul || 1) + (c.hpFlat || 0); // v0.19a1: Spirit Wolves keep their own buff
        c.hp = c.maxHp * ratio;
        c.armor = s.armor;
        c.regen = s.regen;
        c.speed *= (s.speed * (c.speedMul || 1)) / oldSpeed;
        c.baseSpeed = s.speed * (c.speedMul || 1);
      }
  emit(game, "researched", { player: p.id, id, level: p.research[id] });
}
// ---- Send stock (v0.06) ------------------------------------------------------------------
/** The 12 sends of a tier in deck order: cheapest first, boss last. */
/** v0.19h1: health bar width of the weakest sends of every tier: 1st −33 %, 2nd −20 %, 3rd −10 %. */
const HP_BAR_WEAK = [0.67, 0.8, 0.9],
  hpBarCache = new Map();
export function hpBarScale(item) {
  if (!item?.isSend || item.bossTier) return 1;
  if (!hpBarCache.has(item.id)) hpBarCache.set(item.id, HP_BAR_WEAK[tierSends(item.tier).findIndex((s) => s.id === item.id)] ?? 1);
  return hpBarCache.get(item.id);
}
/** v0.20c: Supergrowth (Earth): every purchase of a ground creep from the upper half of its tier (places 1–6) raises that creep's HP by (3 / 4.5 / 6 %) ÷ place. */
export const SUPERGROWTH = [0, 0.03, 0.045, 0.06];
/**
 * v0.20f: Supergrowth counts in the stronger half of the tier (places 7–12, the boss left out): the
 * strongest non-boss creep is N = 1, the next weaker N = 2 … place 7 N = 5. 0 = not affected.
 */
export const growthPlace = (item) => {
  if (!item?.isSend || item.bossTier || item.flying) return 0;
  const all = tierSends(item.tier),
    list = all.filter((s) => !s.bossTier),
    i = list.findIndex((s) => s.id === item.id);
  return i >= Math.floor(all.length / 2) ? list.length - i : 0;
};
function supergrowth(p, item) {
  const level = Math.min(3, perkLevel(p, "supergrowth")),
    place = growthPlace(item);
  if (!level || place < 1) return;
  (p.growth ||= {})[item.id] = Math.round(((p.growth[item.id] || 0) + SUPERGROWTH[level] / place) * 1e6) / 1e6;
}
// v0.21l: the sends of a tier, sorted once per catalog (asked for many times per tick); frozen, never changed by a caller
const TIER_SENDS = new Map();
let tierSendsCatalog = null;
export function tierSends(tier) {
  const catalog = getCatalog();
  if (tierSendsCatalog !== catalog) {
    TIER_SENDS.clear();
    tierSendsCatalog = catalog;
  }
  if (!TIER_SENDS.has(tier))
    TIER_SENDS.set(tier, Object.freeze(catalog.sends.filter((s) => s.playable && s.tier === tier && s.id !== MINI_BOSS.id).sort((a, b) => Number(!!a.bossTier) - Number(!!b.bossTier) || a.cost - b.cost)));
  return TIER_SENDS.get(tier);
}
/**
 * Opening stock of a tier: the first three sends are ready at once and half full; the others wait their start
 * delay in rounds (v0.27iF: content.js START_ROUNDS, before seconds with a per-row factor).
 */
function stockTier(game, p, tier, now) {
  let prevRounds = 0;
  tierSends(tier).forEach((s, i) => {
    if (i < 3) {
      p.stock[s.id] = { count: Math.max(1, Math.ceil(stockMaxOf(p, s) / 2)), next: now + Math.max(0.05, s.stockRegen) };
      return;
    }
    // v0.26bF: noStartDelay (mission rule): every creep opens like a lock that just opened
    if (p.rules?.noStartDelay) {
      p.stock[s.id] = { count: 0, next: now };
      return;
    }
    // v0.27iF: the start delay is set in rounds (income ticks) per creep (content.js START_ROUNDS); the first
    // recruit arrives the moment the lock opens. v0.16: the boss waits one round longer than the creep before it
    const rounds = s.bossTier ? prevRounds + 1 : Math.max(0, Math.round(s.stockStart || 0));
    prevRounds = rounds;
    p.stock[s.id] = rounds > 0 ? { count: 0, next: LOCKED_NEXT, lockRound: game.round + rounds } : { count: stockMaxOf(p, s), next: now };
  });
  // v0.25j: tier 1 opens with a fixed stock for the cheapest creeps (FIRST_STOCK), capped by the stock maximum
  if (tier === 1)
    tierSends(1).forEach((s) => {
      const n = FIRST_STOCK[s.id];
      if (n != null) p.stock[s.id] = { count: Math.min(n, stockMaxOf(p, s)), next: now + Math.max(0.05, s.stockRegen) };
      const lock = START_LOCK[s.id];
      if (lock && !p.rules?.noStartDelay) p.stock[s.id] = { count: 0, next: LOCKED_NEXT, lockRound: (game.round || 0) + lock.rounds, openStock: lock.stock }; // v0.27bF
    });
}
/** v0.25j: opening stock of the first tier-1 creeps (Goblin 10, Pony 5, Gnoll 2, Wolf 2). */
const FIRST_STOCK = Object.freeze({ n00E: 10, n007: 5, n00K: 2 });
/** v0.27bF: tier-1 creeps locked for a fixed number of rounds at the start; when the lock opens they hold `stock` at once (Wolf: 5 rounds, 2). */
export const START_LOCK = Object.freeze({ n00L: { rounds: 5, stock: 2 } });
/**
 * v0.27.006: tier-1 creeps 5–10 (hidden until the Mud Golem is recruited) start their delay with that purchase, in rounds:
 * Skeleton 1, Orc, Necromancer and Flying Sheep 3, Wolfrider (Raider) 4. Their delays from the match start no longer matter.
 */
export const MUD_GOLEM_LOCKS = Object.freeze({ n00R: 1, n00M: 3, n00N: 3, n00P: 3, n00S: 4 });
/** v0.15: placeholder restock time of a creep still locked by its start delay (JSON-safe). */
const LOCKED_NEXT = 1e9;
/** v0.15: rounds until a locked creep is ready (0 = not locked). */
export const lockRoundsLeft = (game, stock) => (stock?.lockRound > game.round ? stock.lockRound - game.round : 0);
function openLocks(game, p) {
  for (const [id, stock] of Object.entries(p.stock))
    if (stock.lockRound && stock.lockRound <= game.round) {
      delete stock.lockRound;
      stock.next = game.time;
      // v0.27bF: START_LOCK creeps open with their start stock; the restock timer starts from there
      if (stock.openStock != null) {
        const s = obj(id);
        stock.count = Math.min(stock.openStock, stockMaxOf(p, s));
        stock.next = game.time + Math.max(0.05, s?.stockRegen || 1);
        delete stock.openStock;
      }
    }
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
    gainExp(game, p, 75, "achievement");
    emit(game, "achievement", { player: p.id, achievement: "tier", tier, name: `First to Tier ${tier}`, exp: 75 }); // v0.19d2: named for the notification
  }
  (p.stats.tierAt ||= []).push([tier, game.round]); // v0.25k: tier markers in the income chart
  emit(game, "tier", { player: p.id, tier, message: `Tier ${tier} unlocked` });
  growMaze(game, p, rowsForTier(game, tier)); // v0.24r
}
/** v0.24r: the player's maze grows to `rows` rows (never shrinks); paths and flyers' exits move down with it. */
function growMaze(game, p, rows) {
  if (rows > laneRows(game, p)) {
    p.rows = rows;
    repath(game, p);
    for (const c of p.creeps) {
      if (!c.flying || !c.path?.length) continue;
      const end = c.path[c.path.length - 1];
      if (Number.isInteger(end?.gridX)) c.path[c.path.length - 1] = exitPos(game, p, end.gridX);
    }
    emit(game, "maze", { player: p.id, rows });
  }
}
/**
 * v0.19d2: Training against only very easy bots: no sell penalty (−100 %); against only easy or
 * very easy bots with at least one easy bot: half the penalty. Online matches and missions keep it.
 */
export const SELL_RELIEF = { veryEasy: 1, easy: 0.5 };
export function sellRelief(game, playerIndex) {
  if (!game.training || game.mission) return 0;
  const bots = game.players.filter((q) => q.id !== playerIndex && q.ai && !q.aiTakeover);
  if (!bots.length || game.players.some((q) => q.id !== playerIndex && !q.ai)) return 0;
  const levels = bots.map((q) => q.aiLevel || game.aiLevel);
  if (!levels.every((l) => Object.hasOwn(SELL_RELIEF, l))) return 0;
  return Math.min(...levels.map((l) => SELL_RELIEF[l]));
}
export function getSellValue(game, playerIndex, towerId) {
  const t = game.players[playerIndex]?.towers.find((t) => t.id === towerId);
  if (!t) return 0;
  const item = obj(t.typeId);
  if (t.typeId === ROCK_ID) return -(t.stonePrice ?? game.mission?.rockCost ?? 40); // v0.17: clearing a rock costs gold (v0.18h: Quarry stones 50 / 200)
  if (item.support === "farm") return 0;
  if (t.typeId === WALL_ID) return 1; // v0.22zk: a wall always sells for 1 gold
  // v0.26fF: 50 % of the tower value (less loss against Very Easy / Easy bots)
  const relief = sellRelief(game, playerIndex),
    rate = TOWER_VALUE.sell + (1 - TOWER_VALUE.sell) * relief;
  return Math.max(0, Math.trunc(towerValue(t) * rate + 1e-9));
}
/** v0.19h1: what the tower would sell for without a penalty (summoned, free or discounted); the app shows it in brackets. */
export function getSellBase(game, playerIndex, towerId) {
  const t = game.players[playerIndex]?.towers.find((t) => t.id === towerId);
  if (!t || t.typeId === ROCK_ID) return null;
  const item = obj(t.typeId);
  if (!item || item.support === "farm") return null;
  const relief = sellRelief(game, playerIndex);
  return Math.trunc(item.pointValue * (item.sellRate + (1 - item.sellRate) * relief));
}
function sellTower(game, p, towerId) {
  const i = p.towers.findIndex((t) => t.id === towerId);
  if (i < 0) return { ok: false, reason: "Tower not found" };
  const t = p.towers[i];
  // v0.25j: selling a tower while it upgrades cancels the upgrade (full refund) and sells the tower it was before
  let undone = 0;
  if (t.buildRemaining > EPS && t.upgrading && t.upgradeUndo && obj(t.upgradeUndo.from)) {
    const u = t.upgradeUndo;
    p.gold += u.gold;
    p.woodIncome += u.woodBack;
    t.totalSpent -= u.spent;
    t.value = towerValue(t) - (u.value ?? u.spent ?? 0); // v0.26fF
    t.woodSpent -= u.wood;
    t.typeId = u.from;
    t.name = u.name;
    t.buildRemaining = 0;
    t.upgrading = false;
    t.completed = true;
    delete t.upgradeUndo;
    undone = u.gold;
  }
  const item = obj(t.typeId);
  // v0.28.004F: a tower still under construction can be sold too (same sell value as a finished one)
  if (t.typeId === ROCK_ID) {
    // v0.17: a rock is cleared for gold, not sold
    const price = t.stonePrice ?? game.mission?.rockCost ?? 40;
    if (p.gold + EPS < price) return { ok: false, reason: `Need ${Math.ceil(price - p.gold)} more gold to ${t.quarry ? "demolish the stone" : "clear the rock"}` };
    p.gold -= price;
    if (p.gold < 0 && p.gold > -1e-6) p.gold = 0; // v0.23u
    p.towers.splice(i, 1);
    p.path = findPath(game, p.id) || [];
    const exp = t.quarry ? QUARRY.exp[t.stone] || 0 : 0; // v0.22m2
    emit(game, "rock", { player: p.id, towerId, x: t.x, y: t.y, cleared: true, stone: t.stone || null, exp });
    if (exp) gainExp(game, p, exp, "quarry");
    if (t.quarry) finishQuarry(game, p); // v0.18h
    return { ok: true, refund: -price };
  }
  const value = getSellValue(game, p.id, towerId),
    refund = value + undone;
  p.gold += value;
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
      c.hp -= guardCut(game, c, damage);
    }
    p.towers.splice(i, 1);
  } else p.towers.splice(i, 1); // selling clears the field completely
  // No juggling (v0.07n): creeps already walking keep their route; a field opened by a sale
  // is a shortcut for the next creeps only.
  p.path = findPath(game, p.id) || [];
  emit(game, "sell", { player: p.id, towerId, refund, x: t.x, y: t.y }); // v0.17b: position for the gold pop-up (the tower is gone by then)
  return { ok: true, refund };
}

// ---- v0.18h: auto-send modes --------------------------------------------------------------------
export const AUTO_MODES = ["default", "eco", "tierup"];
/** v0.23p: auto spawn and the auto modes try every 4 ticks (0.2 s), 20 % sooner than before (5 ticks, 0.25 s). */
export const AUTO_EVERY = 4;
/** Profit of a creep for this player: income per purchase in % of its price (the "Profit" row of the tooltip). */
export function creepProfit(game, p, id) {
  const item = obj(id),
    price = item ? bossDiscount(p, item, item.cost) : 0;
  return price > 0 ? (sendIncome(game, p.id, id) / price) * 100 : 0;
}
/**
 * Budget creeps of a tier: the three non-boss creeps with the highest profit, plus every creep whose
 * profit is at most 0.5 points below the lowest of those three. Sorted by profit, best first.
 */
export function budgetCreeps(game, p, tier = p.tier) {
  const list = tierSends(tier)
    .filter((x) => !x.bossTier && sendAllowed(p, x))
    .map((x) => ({ id: x.id, profit: creepProfit(game, p, x.id) }))
    .filter((x) => x.profit > 0)
    .sort((a, b) => b.profit - a.profit || (a.id < b.id ? -1 : 1));
  if (list.length <= 3) return list;
  const floor = list[2].profit - 0.5 - 1e-9;
  return list.filter((x, i) => i < 3 || x.profit >= floor);
}
const incomeNow = (p) => p.income + (p.incomeDecimal || 0) / 100;
/** Rounds (income ticks) until `gold` reaches `need` with `income` per round, but never before `locked` rounds. */
function roundsTo(need, gold, income, locked) {
  const missing = need - gold;
  if (missing <= EPS) return { whole: locked, exact: locked };
  if (!(income > EPS)) return { whole: Infinity, exact: Infinity };
  return { whole: Math.max(locked, Math.ceil(missing / income - 1e-9)), exact: Math.max(locked, missing / income) };
}
function autoModeSend(game, p) {
  const budget = budgetCreeps(game, p),
    trySend = (id) => available(game, p.id, "send", id).ok && command(game, { type: "send", player: p.id, id, auto: true }).ok;
  if (p.autoMode === "tierup") {
    const boss = tierOneLocked(p) ? obj(MINI_BOSS.id) : tierSends(p.tier).find((x) => x.bossTier), // v0.27F: first the Mud Golem
      a = boss && available(game, p.id, "send", boss.id);
    if (boss && !p.bossBought?.[boss.id] && p.tier < 6 && sendAllowed(p, boss)) {
      if (a.ok) return void command(game, { type: "send", player: p.id, id: boss.id, auto: true });
      if (/Restocking|Warm up/.test(a.reason || "")) return;
      const need = bossDiscount(p, boss, boss.cost),
        locked = lockRoundsLeft(game, p.stock[boss.id]),
        now = roundsTo(need, p.gold, incomeNow(p), locked);
      // a budget creep is bought only if the boss is still reached as fast or faster
      for (const b of budget) {
        const item = obj(b.id),
          price = bossDiscount(p, item, item.cost);
        if (!available(game, p.id, "send", b.id).ok) continue;
        const after = roundsTo(need, p.gold - price, incomeNow(p) + sendIncome(game, p.id, b.id), locked),
          raw = roundsTo(need, p.gold - price, incomeNow(p) + sendIncome(game, p.id, b.id), 0),
          rawNow = roundsTo(need, p.gold, incomeNow(p), 0);
        // the gold for the boss comes in sooner, or still in time while the boss is locked anyway
        if (after.whole <= now.whole && (raw.exact < rawNow.exact - 1e-9 || raw.exact <= locked + 1e-9)) return void trySend(b.id);
      }
      return;
    }
  }
  // Eco (and Tier Up without a boss left to buy): the best budget creep that can be sent now
  for (const b of budget) if (trySend(b.id)) return;
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
    // v0.20: in a team game only players of the other team
    if (!q.out && (!game.teams || q.team !== game.players[index].team)) others.push(q);
  }
  if (!others.length) return game.players[(index + 1) % n];
  if (game.rotation === false) return others[0]; // v0.20: rotation switched off: always the next player
  return others[Math.floor(Math.max(0, game.round - 1) / ROTATE_ROUNDS) % others.length];
}
/** Players whose creeps currently run into this player's lane. */
export function attackersOf(game, index) {
  return game.players.filter((q) => q.id !== index && !q.out && targetOf(game, q.id).id === index);
}
export const aliveCount = (game) => game.players.filter((q) => !q.out).length;
/** A player has no lives left: the duel ends, or with four players that player drops out. */
function defeat(game, p, by = null, surrender = false) {
  if (game.teams) {
    // v0.20: the team's lives are gone: the whole team is out; a player who surrenders leaves alone
    if (!surrender || teamMates(game, p).length <= 1) return teamDefeat(game, p.team, by);
    p.out = true;
    p.lives = 0;
    for (const c of p.creeps) c.dead = true;
    p.autoSend = null;
    emit(game, "eliminated", { player: p.id, place: 2, by: -1 });
    return;
  }
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
function spawnCreep(game, ownerIndex, id, at = null, lane = null, noEscort = false) {
  const item = obj(id);
  if (!item || !item.hp) return null;
  const owner = game.players[ownerIndex],
    target = lane !== null && lane !== undefined && game.players[lane] ? game.players[lane] : game.teams ? nextTeamTarget(game, owner) : targetOf(game, ownerIndex), // v0.20: teams: one creep each, in turn
    s = statsFor(game, owner, item);
  if (!target || target.out || target.id === ownerIndex) return null;
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
    speed: s.speed * (0.88 + random(game) * 0.24) * (id === "n00Y" && (owner?.treantCount || 0) > TREANT.burnAfter && !at ? 1 + TREANT.speed : 1),
    baseSpeed: s.speed * (id === "n00Y" && (owner?.treantCount || 0) > TREANT.burnAfter && !at ? 1 + TREANT.speed : 1),
    burning: id === "n00Y" && (owner?.treantCount || 0) > TREANT.burnAfter && !at ? true : undefined,
    regen: s.regen,
    flying: item.flying,
    invisible: (item.abilities || []).some((id) => getCatalog().abilities[id]?.baseId === "Apiv"),
    defenseType: item.defenseType,
    path: item.flying ? [position, exitPos(game, target, column)] : findPath(game, target.id, gridAt(game, position)) || [],
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
  const escort = noEscort ? null : BOSS_MOBS[id]; // v0.23w: a cloned boss comes alone
  if (escort && obj(escort))
    [12, 0, -12].forEach((delta, i) =>
      game.pendingSpawns.push({ owner: ownerIndex, lane: target.id, id: escort, time: game.time + 0.1 * (i + 1), x: creep.x, y: creep.y, health: 1, speedDelta: delta }),
    );
  return creep;
}
/**
 * v0.23p: spawn smoothing. A big send (bots, auto spawn, many buys in one tick) no longer creates every creep in
 * the same tick: each lane takes at most `perTick` sent creeps per tick (20 ticks/s); the rest wait in
 * game.sendQueue in order and follow in the next ticks (40 creeps: 0.25 s). Gold, income and events stay at the
 * moment of the send; only the creep itself appears a moment later. Normal play (a few creeps at once) is unchanged.
 */
export const SPAWN_SMOOTH = { perTick: 8 };
function laneSlot(game, lane) {
  if (game.spawnTickNo !== game.tick) {
    game.spawnTickNo = game.tick;
    game.spawnPerLane = {};
  }
  const n = game.spawnPerLane[lane] || 0;
  if (n >= SPAWN_SMOOTH.perTick) return false;
  game.spawnPerLane[lane] = n + 1;
  return true;
}
/** v0.23p: a creep from a send: at once while its lane has a free slot this tick (and nobody waits), else queued. */
function sendSpawn(game, ownerIndex, id, clone = false) {
  const owner = game.players[ownerIndex],
    target = game.teams ? nextTeamTarget(game, owner) : targetOf(game, ownerIndex);
  if (!target || target.out || target.id === ownerIndex) return;
  const lane = target.id;
  game.sendQueue ||= [];
  if (!game.sendQueue.some((q) => q.lane === lane) && laneSlot(game, lane)) {
    const c = spawnCreep(game, ownerIndex, id, null, lane, clone);
    if (clone) makeClone(c);
  } else game.sendQueue.push(clone ? { owner: ownerIndex, id, lane, clone: true } : { owner: ownerIndex, id, lane });
}
/** v0.23w: a Clones copy: half the health. */
function makeClone(c) {
  if (!c) return;
  c.clone = true;
  c.maxHp *= CLONES.hp;
  c.hp = Math.min(c.hp, c.maxHp);
}
/** v0.23p: once per tick: queued creeps take the free slots of their lane, in order. */
function releaseSendQueue(game) {
  if (!game.sendQueue?.length) return;
  const keep = [];
  for (const q of game.sendQueue) {
    if (!laneSlot(game, q.lane)) {
      keep.push(q);
      continue;
    }
    const t = game.players[q.lane],
      c = spawnCreep(game, q.owner, q.id, null, t && !t.out ? q.lane : null, !!q.clone); // a lane that lost meanwhile: the usual target
    if (q.clone) makeClone(c); // v0.23w
  }
  game.sendQueue = keep;
}
const BOSS_MOBS = { n00T: "n01U", n01H: "n01X" }; // v0.19k: the Siege Golem (n015) spawns no escorts any more
/** Divine Shield cycle (Divine Timer): 10 s invulnerable, 20 s open, starting with the shield on spawn (v0.22u2). */
/** v0.19k: the Siege Golem no longer calls clockwork escorts. */
const CLOCKWORK_ESCORTS = false;
const DIVINE = new Set(["n015", "n02M", "n02I"]); // v0.23zb: the Siege Ogre (was Shieldbearer, n01G) lost its Divine Shield
export function divineShield(game, c) {
  if (c.wave || !DIVINE.has(c.typeId)) return false;
  const age = game.time - c.bornTick * TICK;
  return age >= 0 && age % 30 < 10; // v0.22u2: shielded from the moment it spawns (was: from 10 s after arrival)
}

/**
 * v0.27lF: armor is a flat reduction per hit (like the Armor ability): armor N ignores N damage of every tower attack,
 * at least 1 gets through; negative armor adds that much damage to every hit. Spells are not reduced. (Before: the
 * Warcraft 3 formula 1 / (1 + 0.05 × armor) on every damage, spells too.)
 */
/** v0.27lF: damage of a typical tower hit for the bots' armor estimates when no tower is known. */
const AI_ARMOR_HIT = 40;
export const flatArmor = (dealt, armor) => (armor > 0 ? (dealt > 1 ? Math.max(1, dealt - armor) : dealt) : dealt - armor);
/**
 * Damage type matrix (attack type against defense type). `armor` and `hit` (average damage per hit) only for the
 * bots' estimates: the share of a hit of that size that gets through the flat armor (v0.27lF).
 */
export function damageMultiplier(attackType, defenseType, armor = 0, hit = 0) {
  const type = RULES.damageMatrix[attackType] || RULES.damageMatrix.normal,
    index = RULES.defenseOrder.indexOf(defenseType);
  const typeBonus = type[index < 0 ? 1 : index];
  if (!armor || !(hit > 0)) return typeBonus;
  return flatArmor(hit * typeBonus, armor) / hit;
}
/** Damage type matrix plus the wave "immune" trait (magic and spells barely hurt). */
function hitMultiplier(attackType, creep) {
  const base = damageMultiplier(attackType, creep.defenseType);
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
// v0.24n: Trueshot Aura of the Trueshot Tower levels 3–6: +10 / 20 / 33 / 50 % damage (map values were 5 / 12 / 22 / 36 %)
const TRUESHOT_BONUS = { h01W: 0.1, h01D: 0.2, h019: 0.33, h01E: 0.5 };
/** v0.28.004F: the Trueshot Tower line (levels 3–6), the source of the Marksman Aura (was called Trueshot Aura). */
const isTrueshotTower = (typeId) => typeId in TRUESHOT_BONUS || /^Trueshot Tower/.test(String(obj(typeId)?.name || "").replace(/\|c\w{8}|\|r/g, ""));
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
          targets = splitIds(field(a.fields, "atar", level)),
          name = String(field(a.fields, "anam", 0) || "");
        return {
          baseId: a.baseId,
          // v0.17p: auras that name only air or only ground affect only those creeps
          air: targets.includes("air"),
          ground: targets.includes("ground"),
          airFactor: a.airFactor ?? 1, // v0.17p: Speed Aura: flyers get half the bonus
          only: /Trueshot/i.test(name) ? "archer" : /Skirmish/i.test(name) ? "melee" : null, // v0.17p; v0.24n: Trueshot only for the Archer-Line
          friend: targets.includes("friend"),
          self: targets.includes("self"),
          enemies: targets.includes("enemies"),
          radius: fval(a, "aare", level),
          oae1: a.baseId === "AOae" ? fval(a, "Oae1", level) : 0,
          oae2: a.baseId === "AOae" ? fval(a, "Oae2", level) : 0,
          had1: a.baseId === "AHad" ? fval(a, "Had1", level) : 0,
          ear1: TRUESHOT_BONUS[unit.typeId] ?? (a.baseId === "AEar" || a.baseId === "ACat" ? fval(a, "Ear1", level) : 0), // v0.24n
          uau1: a.baseId === "AUau" ? fval(a, "Uau1", level) : 0,
          uau2: a.baseId === "AUau" ? fval(a, "Uau2", level) : 0,
        };
      });
    AURA_CACHE.set(unit.typeId, list);
  }
  return list;
}
// v0.21l: the units of a lane that carry an aura at all (54 of 190 types), gathered once per tick.
// Kept in a WeakMap so it never ends up in a saved or sent game state. auraAt() takes max/min
// over its sources, so their order does not matter.
const AURA_SOURCES = new WeakMap();
function auraSources(game, p) {
  // v0.23: the same key (tick, creep count, tower count) compared as numbers, no string built per call
  let hit = AURA_SOURCES.get(p);
  if (!hit || hit.tick !== game.tick || hit.creeps !== p.creeps.length || hit.towers !== p.towers.length) {
    const list = [];
    for (const u of p.towers) if (aurasOf(u).length) list.push(u);
    for (const u of p.creeps) if (aurasOf(u).length) list.push(u);
    AURA_SOURCES.set(p, (hit = { tick: game.tick, creeps: p.creeps.length, towers: p.towers.length, list }));
  }
  return hit.list;
}
/** v0.27.006: radius of a tower type's strongest creep-slowing aura (Frost Aura), 0 if none (for the snowflake tiles). */
export function frostAuraRadius(typeId) {
  let r = 0;
  for (const a of aurasOf({ typeId })) if (a.baseId === "AOae" && a.enemies && a.oae1 < 0) r = Math.max(r, a.radius || 0);
  return r;
}
// v0.24m: auras of towers reach the towers on the neighbouring fields only (straight and diagonal, measured from
// the footprint); auras on creeps keep their radius. v0.24n: halls (2×2, also the two-element towers) reach one
// field further, i.e. two rings of fields around them.
const isTowerUnit = (u) => u.size !== undefined && obj(u.typeId)?.kind === "tower";
function neighbourTowers(game, a, b) {
  const dx = Math.abs(a.x - b.x) * game.grid.cols,
    dy = Math.abs(a.y - b.y) * game.grid.rows,
    reach = ((a.size || 1) + (b.size || 1)) / 2 + ((a.size || 1) > 1 ? 1 : 0) + 0.01; // a = the aura's source
  return dx <= reach && dy <= reach;
}
function auraAt(game, target, owner, units) {
  let speedUp = 0,
    speedDown = 0,
    attackUp = 0,
    attackDown = 0,
    armorUp = 0,
    armorDown = 0,
    damage = 0,
    trueDamage = 0, // v0.23: Trueshot Aura adds onto Damage Aura (the strongest of each kind)
    regen = 0,
    trueshot = false;
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
      if (friendly && target !== source && isTowerUnit(source) && isTowerUnit(target)) {
        if (!neighbourTowers(game, source, target)) continue; // v0.24m: tower auras on towers: neighbouring fields
      } else if (a.radius <= 0 || outOfRange(game, source, target, a.radius)) continue; // v0.23: outOfRange
      const fly = !!target.flying;
      if (a.air !== a.ground && (fly ? !a.air : !a.ground)) continue; // v0.17p: air-only / ground-only auras
      if (a.only) {
        // v0.17p: Skirmish Aura only for melee towers; v0.24n: Trueshot Aura only for Archer-Line towers
        const it = obj(target.typeId);
        if (!it?.attacks) continue;
        if (a.only === "archer" ? !archerLine().has(target.typeId) : !isMeleeTower(it)) continue;
        if (a.only === "archer" && isTrueshotTower(target.typeId)) continue; // v0.28.004F: Marksman Aura never boosts Trueshot Towers (its own one included)
        if (a.only === "archer" && a.ear1 > 0) trueshot = true;
      }
      if (a.baseId === "AOae") {
        const speed = a.oae1 * (fly ? a.airFactor : 1);
        speedUp = Math.max(speedUp, speed);
        speedDown = Math.min(speedDown, speed);
        attackUp = Math.max(attackUp, a.oae2);
        attackDown = Math.min(attackDown, a.oae2);
      }
      if (a.baseId === "AHad") {
        armorUp = Math.max(armorUp, a.had1);
        armorDown = Math.min(armorDown, a.had1);
      }
      if (a.baseId === "AEar" && a.only === "archer") trueDamage = Math.max(trueDamage, a.ear1); // v0.23
      else if (a.baseId === "AEar" || a.baseId === "ACat") damage = Math.max(damage, a.ear1);
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
    damage: 1 + damage + trueDamage, // v0.23: Damage Aura + Trueshot Aura add up (was: only the stronger one)
    regen,
    trueshot,
  };
}
/** v0.24m: what the auras around a placed tower add (for its tooltip). */
export function towerAuras(game, playerIndex, towerId) {
  const p = game?.players?.[playerIndex],
    tower = p?.towers.find((t) => t.id === towerId);
  if (!tower) return null;
  let manaBonus = 0,
    regenBest = 0;
  for (const t of p.towers)
    if (!(t.buildRemaining > 0) && (t === tower || neighbourTowers(game, t, tower)))
      for (const sk of towerSkills(p, t)) {
        if (sk.type === "manaAura") manaBonus = Math.max(manaBonus, sk.regen);
        else if (sk.type === "manaRegenAura") regenBest = Math.max(regenBest, sk.rate);
      }
  return { ...auraAt(game, tower, p, auraSources(game, p)), mana: manaBonus, manaRate: regenBest };
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
const DEATH_KNIGHT = "h02C";
export const MANA_REGEN_AURA = 0.5; // v0.17p (v0.27zziF: exported for the Mana Aura tooltip)
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
    case "ANre":
      // v0.17p: Mana Regeneration Aura (Hall of Elements, Magic City): towers in range regain mana 50 % faster
      // (the map value Arm1 = 1 would be +100 %; halved because Magic Towers fire their empowered bolt on a full bar)
      sk = { type: "manaRegenAura", rate: MANA_REGEN_AURA, radius: fval(a, "aare", level, 600) };
      break;
    case "Xfoc":
      // v0.18b: own ability (content.js CUSTOM_ABILITIES): Earth Laser's Focus Fire
      sk = { type: "focus", step: a.step, interval: a.interval, max: a.max };
      break;
    case "Xhwl":
      // v0.17p: own ability (content.js CUSTOM_ABILITIES): Pit Lord's Howl (unused since v0.27yF)
      sk = { type: "howl", radius: a.radius, slow: a.slow, amp: a.amp, duration: a.duration, cooldown: a.cooldown };
      break;
    case "Xter":
      // v0.27yF: Terror Demon's Terror Aura
      sk = { type: "terror", radius: a.radius, amp: a.amp };
      break;
    case "Xent":
      // v0.27zaF: Tree of Life's timed Entangle
      sk = { type: "timedEntangle", interval: a.interval, duration: a.duration, dps: a.dps };
      break;
    case "Adtg":
      sk = { type: "detect", radius: fval(a, "aran", level, tipNum(a, level, /Range (\d+)/, 300)) };
      break;
    case "Abof":
      sk = { type: "disease", dps: fval(a, "Hfs1", level) * DISEASE_BUFF, radius: DISEASE_RADIUS[level] ?? fval(a, "aare", level, 225), duration: fval(a, "adur", level, 3) }; // v0.24j: +40 % (v0.27zzhF: removed); v0.27zzhF: radius per level
      break;
    case "Amgl":
    case "Aro1":
      if (a.id === "A006") sk = { type: "execute" };
      else if (a.id === "A04W") sk = { type: "stomp" };
      else if (a.id === "A0BG") sk = { type: "passive" }; // v0.18b: Armor Disruption removed (Earth Laser has Focus Fire)
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
    case "Xtbs":
      // v0.22n2: Tier Boss: the damage it ignores comes from TIER_BOSS by creep type
      sk = { type: "tierBoss" };
      break;
    case "Xmbs":
      // v0.27F: Mini Boss (Mud Golem): half of the Rock Golem's Tier Boss resistances
      sk = { type: "miniBoss" };
      break;
    case "Xslr":
      // v0.21k: own ability: the creep is slowed less (Warden, Eredar Warlock)
      sk = { type: "slowResist", value: a.resist || 0 };
      break;
    case "Xspr":
      // v0.22za2: own ability: less damage from tower splash (Orc)
      sk = { type: "splashResist", reduce: a.reduce || 0 };
      break;
    case "Xlrs":
      // v0.17b: own ability (content.js CUSTOM_ABILITIES): less damage from one tower line
      sk = { type: "lineResist", root: a.line, reduce: a.reduce || 0 };
      break;
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
const COVERED_BASES = new Set(["ANre", "Xfoc", "Xhwl", "Xter", "Xent", "Xlrs", "Xspr", "Xslr", "Xtbs", "Xmbs", "Xinf", "AHfa", "Avul", "Aslo", "ANca", "Aroc", "Afra", "AIcf", "Afbt", "AHbh", "AHab", "Adtg", "Abof", "Amgl", "ACat", "AUau", "ACes", "Ansk", "AIsr", "Apiv", "Arsk", "Aspt", "Asal", "Aimp"]);
const VISUAL_ONLY = (a) => (a.baseId === "Aasl" && fval(a, "Slo1", 1) === 0) || ["Aroa", "Aeth"].includes(a.baseId) || a.id === "A06Z";
// v0.21l: a tower's skills are asked for up to three times per tick: kept for that tick (WeakMap, never saved)
const TOWER_SKILLS = new WeakMap();
// bumped at every tick and every command, so a perk or research change is seen at once
let skillEpoch = 0;
// v0.23i: tower skills only change with perks, research or finished towers (commands, finished research,
// finished buildings), not every tick: their own counter, so the lists are no longer rebuilt every tick
let abilityEpoch = 0;
function towerSkills(player, tower) {
  const hit = TOWER_SKILLS.get(tower);
  const n = player.towers?.length || 0;
  if (hit && hit.epoch === abilityEpoch && hit.n === n && hit.typeId === tower.typeId && hit.player === player) return hit.list;
  const list = towerSkillsRaw(player, tower);
  TOWER_SKILLS.set(tower, { epoch: abilityEpoch, n, typeId: tower.typeId, player, list });
  return list;
}
function towerSkillsRaw(player, tower) {
  return unitAbilities(tower)
    .map((a) => skillOf(a, abilityLevel(player, tower, a)))
    .filter((sk) => sk && sk.type !== "passive" && (!sk.requires?.length || meetRequirements(player, sk.requires.map((id) => ({ id, level: 1 }))).ok));
}
const CREEP_SKILLS = new Map();
/** v0.24s: a unit type's abilities with name and skill at its own level (for the unit info). */
export function unitSkillList(id) {
  const item = obj(id);
  if (!item?.abilities?.length) return [];
  return unitAbilities({ typeId: id }).map((a) => ({
    id: a.id,
    name: String(field(a.fields, "anam", 0) || a.id),
    skill: skillOf(a, Math.max(1, item.level || 1)),
  }));
}
function creepSkills(c) {
  if (c.wave) return [];
  const key = c.enraged ? c.typeId + ":enraged" : c.typeId; // v0.21z: the Enraged Meat Golem has its own skills
  if (!CREEP_SKILLS.has(key))
    CREEP_SKILLS.set(key, (c.enraged ? ENRAGED_GOLEM.abilities.map((id) => getCatalog().abilities[id]).filter(Boolean) : unitAbilities(c)).map((a) => skillOf(a, 1)).filter(Boolean));
  return CREEP_SKILLS.get(key);
}
/**
 * v0.22n2: Tier Boss (the tier boss golems): debuffs last 50 % shorter and every tower attack does this much less
 * damage, never below 1. Replaces Scale Armor, Nerf Resistance and Magic Resistance on them.
 */
export const TIER_BOSS = { shorter: 0.5, push: 0.5, slowResist: 0.3, ignore: { n00T: 1, n015: 5, n01H: 10, n01T: 20, n02R: 30 } };
function nerfClass(c) {
  if (c.waveBoss) return "boss";
  if (c.wave) return "normal";
  const ids = obj(c.typeId)?.abilities || [];
  if (ids.includes("A05F") || ids.includes("XA12")) return "boss";
  if (ids.includes("A02U") || c.typeId === "n01G" || c.typeId === "n02N") return "resist";
  return "normal";
}
/** Nerf Resistance shortens negative effects by 75 % (A02U); v0.22n2: Tier Boss by 50 %. */
function negativeDuration(c, normal, hero = null) {
  const cls = nerfClass(c);
  if (cls === "normal") return creepSkills(c).some((sk) => sk.type === "miniBoss") ? normal * (1 - (1 - TIER_BOSS.shorter) * MINI_BOSS.share) : normal; // v0.27F: Mini Boss 25 % shorter
  if (cls === "boss" && creepSkills(c).some((sk) => sk.type === "tierBoss")) return normal * TIER_BOSS.shorter;
  return hero != null ? hero : normal * 0.25; // v0.24j: the ability's own hero/boss duration counts when it has one (bash, stomp)
}
function detected(game, p, c) {
  return p.towers.some((t) => !(t.buildRemaining > 0) && towerSkills(p, t).some((sk) => sk.type === "detect" && inRange(game, t, c, sk.radius))); // v0.23: inRange
}
/** One damage instance against a creep, with creep-side skills applied. */
/** v0.22za2: true while a tower's splash lands (Splash Resistance); set around the splash strikes in attack(). */
let splashHit = false;
const splashStrike = (game, p, tower, c, damage, attackType) => {
  splashHit = true;
  try {
    return strike(game, p, tower, c, damage, attackType);
  } finally {
    splashHit = false;
  }
};
/** v0.27aF: set while an Arrow Volley arrow strikes: it counts as Arrow damage (like a basic Archer tower's hit). */
let volleyStrike = false;
const VOLLEY_TOWER = { typeId: "h003" };
function strike(game, p, tower, c, damage, attackType, spell = false, extraArmor = c.auraArmor || 0) {
  const arrowHit = tower || (volleyStrike ? VOLLEY_TOWER : null);
  if (c.dead || damage <= 0 || divineShield(game, c)) return 0;
  const cs = creepSkills(c);
  if (!spell) {
    const evade = c.dodge ? { chance: Math.max(c.dodge, cs.find((sk) => sk.type === "evasion")?.chance || 0) } : cs.find((sk) => sk.type === "evasion"); // v0.15: fast quest creeps dodge
    if (evade && random(game) < evade.chance) {
      if (random(game) < 0.25) emit(game, "skill", { player: p.id, kind: "miss", x: c.x, y: c.y });
      return 0;
    }
  }
  // v0.27lF: Arcane Penalty (Penalty Lap) turns the creep's armor negative; bosses keep their Tier Boss reduction
  const penalty = c.statuses.some((st) => st.abilityId === PENALTY_LAP.id),
    armor = (penalty ? -Math.abs(c.armor || 0) : c.armor || 0) + extraArmor - (c.shred || 0) + c.statuses.reduce((sum, st) => sum + (st.armor || 0), 0);
  let dealt = damage * hitMultiplier(spell ? "spells" : attackType, c);
  if (!spell) {
    dealt = flatArmor(dealt, armor); // v0.27lF: flat armor on tower attacks
    const scales = cs.find((sk) => sk.type === "scales");
    if (scales) dealt = penalty && !obj(c.typeId)?.bossTier ? dealt + scales.ignore : Math.max(scales.min, dealt - scales.ignore); // v0.27lF: reversed by Arcane Penalty
    // v0.22n2: Tier Boss ignores part of every tower attack, never below 1
    if (arrowHit && cs.some((sk) => sk.type === "tierBoss")) dealt = Math.max(1, dealt - (TIER_BOSS.ignore[c.typeId] || 0)); // like Scale Armor: at least 1 per hit
    else if (arrowHit && cs.some((sk) => sk.type === "miniBoss")) dealt = Math.max(1, dealt - TIER_BOSS.ignore.n00T * MINI_BOSS.share); // v0.27F: half the Rock Golem's
  }
  if (spell || attackType === "magic") {
    const resist = cs.find((sk) => sk.type === "magicResist");
    if (resist) dealt *= 1 - resist.reduce;
    if (c.magicVuln) dealt *= 1 + c.magicVuln; // v0.19a1: Spirit Wolves take 300 % more magic damage
  }
  if (tower) {
    // v0.17b: Arrow / Siege Resistance – less damage from every tower of one line
    if (splashHit) {
      const sr = cs.find((sk) => sk.type === "splashResist"); // v0.22za2: Splash Resistance
      if (sr) dealt *= 1 - sr.reduce;
    }
    const lr = cs.find((sk) => sk.type === "lineResist");
    if (lr && lineSet(lr.root).has(tower.typeId)) dealt *= 1 - lr.reduce;
    // v0.17p: Howl: more damage from towers
    const amp = c.statuses.reduce((m, st) => Math.max(m, st.amp || 0), 0); // v0.27yF: Howl or Terror Aura, the strongest
    if (amp) dealt *= 1 + amp;
  } else if (volleyStrike) {
    // v0.27aF: Arrow Volley arrows: Arrow Resistance and Howl count as for an Archer tower's hit
    const lr = cs.find((sk) => sk.type === "lineResist");
    if (lr && lineSet(lr.root).has(VOLLEY_TOWER.typeId)) dealt *= 1 - lr.reduce;
    const amp = c.statuses.reduce((m, st) => Math.max(m, st.amp || 0), 0); // v0.27yF: Howl or Terror Aura, the strongest
    if (amp) dealt *= 1 + amp;
  }
  const before = c.hp;
  c.hp -= guardCut(game, c, dealt, spell || attackType === "magic");
  if (tower) {
    c.lastHit = tower.id;
    const done = Math.max(0, Math.min(before, before - c.hp));
    tower.dmg = (tower.dmg || 0) + done; // v0.22j1: damage dealt (overkill not counted), for tooltips and test runs
    if (p.stats) (p.stats.towerDmg ||= {})[tower.typeId] = (p.stats.towerDmg[tower.typeId] || 0) + done;
  }
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
    } else if (sk.type === "execute" && tower.typeId === DEATH_KNIGHT) {
      // v0.17p: Death Knight culls: a creep below 10 % of its max health or below 666 health dies at once
      if (target.hp > 0 && target.hp <= Math.max(target.maxHp * 0.1, 666) && !target.guard && !divineShield(game, target)) {
        const amount = target.hp;
        target.hp = 0;
        target.lastHit = tower.id;
        emit(game, "skill", { player: p.id, kind: "execute", x: target.x, y: target.y, amount });
      }
    } else if (sk.type === "execute" && EXECUTE_DAMAGE[tower.typeId] && target.hp > 0 && target.hp <= target.maxHp * 0.25) {
      if (random(game) < { normal: 1, resist: 1 / 3, boss: 1 / 5 }[cls]) {
        const amount = EXECUTE_DAMAGE[tower.typeId];
        strike(game, p, tower, target, amount, "normal");
        emit(game, "skill", { player: p.id, kind: "execute", x: target.x, y: target.y, amount });
      }
    } else if (sk.type === "disease") {
      const mine = game.clouds.filter((cl) => cl.towerId === tower.id);
      if (mine.length >= 3) game.clouds.splice(game.clouds.indexOf(mine[0]), 1);
      game.clouds.push({ lane: p.id, towerId: tower.id, x: target.x, y: target.y, radius: sk.radius, dps: sk.dps, remaining: sk.duration, splash: item.attackType || "siege", next: 0.5 }); // v0.27zzhF: hits once per second as the launcher's splash
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
// Cannon: tiny core takes full damage, a wider ring 25 % (v0.17a). Magic: mana charges slowly, a full
// bar fires an empowered bolt. Poison: every hit adds a stack (damage + a little slow, stacks
// add up). Frost: one slow, never stacks.
const CANNON_CORE = 0.35, // cells
  CANNON_RING = 1.15, // cells
  CANNON_RING_FACTOR = 0.25, // v0.17a: outer ring 50 % -> 25 %
  BOMBARD_RADIUS = 0.9; // v0.17b: the outer splash radius of the whole Bombard line is 10 % smaller
export const MAGIC_CHARGE_SECONDS = 8;
/** v0.27zzgF: the Arcane Missile deals 50 % more to heavy and boss creeps. */
export const ARCANE_MISSILE_HEAVY = 0.5;
export const MAGIC_EMPOWER = 5; // v0.24i: Arcane Missile (the empowered bolt) 4× → 5× damage
/** v0.24j: Arcane Missile of the Magic Tower levels 5 and 6: +20 % and +33 % on top. */
export const MAGIC_EMPOWER_LEVEL = { 5: 1.2, 6: 1.33 };
export const magicEmpower = (item) => MAGIC_EMPOWER * (MAGIC_EMPOWER_LEVEL[item?.level] || 1);
/** v0.24j: Disease Launcher +40 % (its attack in content.js, its disease clouds here). */
export const DISEASE_BUFF = 1; // v0.27zzhF: the +40 % of v0.24j removed (clouds and attack)
/** v0.27zzhF: disease cloud radius by Disease Launcher level (was 225 / 250 / 275 / 300; 128 = one field). */
export const DISEASE_RADIUS = { 3: 180, 4: 200, 5: 220, 6: 230 };
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
/** v0.22g1: the Bombard line (cannon towers and the h02R line), as Gunpowder and Heavy Weapons count it. */
const isBombardLine = (item) => !!item && (isCannonTower(item) || lineSet("h02R").has(item.id));
export const isMagicTower = (item) => /^Magic Tower/.test(nameOf(item)) && (item?.mana || 0) > 0;
/** Slow from all statuses: frost and other slows never stack, poison stacks add up to a cap. */
export function statusSlow(statuses) {
  const s = statusSlowParts(statuses);
  return 1 - (1 - s.frost) * (1 - s.other);
}
/**
 * v0.22h1: frost debuffs (the strongest one counts) and the other slows (strongest one plus stacking
 * poison) apart, so they can be applied one after the other: Frozen Ground, then frost, then the rest.
 */
export function statusSlowParts(statuses) {
  let frost = 0,
    other = 0,
    poison = 0;
  for (const st of statuses) {
    if (st.poison) poison += st.slow || 0;
    else if (st.abilityId === "frost") frost = Math.max(frost, st.slow || 0);
    else other = Math.max(other, st.slow || 0);
  }
  return { frost: Math.max(0, frost), other: Math.max(0, other) + Math.min(POISON_SLOW_CAP, poison) };
}
// ---- Charged specials ("ULTIMATE ... N" triggers) --------------------------------------
// Every attack adds 1-10 charge; at N the tower casts its special and resets. Values come
// from the dummy casters (o002 Flamestrike, o003 Chain Lightning, o004 Blizzard, o005
// Tsunami, o006 Swarm Rockets, n00H Entangle) and the trigger bodies.
export const ULTIMATES = { // v0.23: exported for the Decay Attack tooltip
  h01L: { charge: 40, kind: "entangle", level: 1 },
  h00B: { charge: 40, kind: "entangle", level: 2 },
  h037: { charge: 40, kind: "entangle", level: 3 },
  // v0.27zziF: Hall of Plague 2–4 lost the charged decay strike (8 / 12 / 18 %); every attack decays instead (DECAY)
  // v0.27zziF: Terror Demon: no charged decay strike any more (30 %), every attack decays instead (DECAY)
  h00J: { charge: 60, kind: "penalty" }, // v0.27lF: Penalty Lap (was Shrink Ray)
  h020: { charge: 80, kind: "chain" },
  h010: { charge: 100, kind: "blizzard" },
  h03W: { charge: 140, kind: "tsunami" },
  h043: { charge: 160, kind: "raise" },
};
const ENTANGLE = { 1: { dps: 30, dur: 6, min: 300 }, 2: { dps: 90, dur: 9, min: 600 }, 3: { dps: 270, dur: 12, min: 1200 }, 4: { dps: 840, dur: 15, min: 2400 } };
/** SKILL Chain Light Hall: 1 in 7 attacks (damage per hall level from the map trigger). */
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
      target.hp -= guardCut(game, target, target.maxHp * pct);
      target.lastHit = tower.id;
      break;
    }
    case "penalty": {
      // v0.27lF: Penalty Lap: the creep farthest along the path in range goes back to the start of the maze
      const c = p.creeps
        .filter((o) => !o.dead && o.hp > 0 && o.y >= 0 && !divineShield(game, o) && !o.statuses.some((st) => st.abilityId === PENALTY_LAP.id) && dist(game, tower, o) <= PENALTY_LAP.range)
        .sort((a, b) => b.progress - a.progress || (a.id < b.id ? -1 : 1))[0];
      if (!c) return; // nobody to send back: the charge stays
      penaltyLap(game, p, c);
      at.x = c.x;
      at.y = c.y;
      break;
    }
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
/**
 * v0.27lF: Penalty Lap (Magic City, replaces Shrink Ray): a creep is teleported back to the first field of the path and
 * gets Arcane Penalty until it breaches or dies: 20 % slower, its armor turned negative (armor 3 → −3, also the
 * Armor ability; a boss keeps its Tier Boss reduction but its armor turns negative as well). A creep with Arcane
 * Penalty cannot be sent back again.
 */
export const PENALTY_LAP = { id: "penalty", slow: 0.2, range: 896 };
function penaltyLap(game, p, c) {
  const from = { x: c.x, y: c.y },
    lane = game.players[c.defender] || p,
    column = spawnColumn(game),
    start = pos(game, column, -1);
  c.x = start.x;
  c.y = start.y;
  c.progress = 0; // maxProgress stays: walking the maze again gives no new scouting EXP
  c.path = c.flying ? [start, exitPos(game, lane, column)] : findPath(game, lane.id, { x: column, y: -1 }) || [];
  c.pathIndex = 0;
  c.prevNode = null;
  c.plankRoute = null;
  if (c.planting) c.planting = null; // a Siege Ogre loses the plank it was about to lay
  c.statuses.push({ abilityId: PENALTY_LAP.id, remaining: 1e9, slow: PENALTY_LAP.slow, dps: 0, owner: p.id });
  emit(game, "skill", { player: p.id, kind: "penalty", x: start.x, y: start.y, from, creepId: c.id });
}
/**
 * v0.27lF: Battle Mech (h046, was Robogoblin with Swarm Rockets): Missile Barrage. Every 12 s (v0.27mF), while creeps are in the
 * player's maze, it launches 3 heavy missiles one after another (0.3 s apart) at path fields with creeps on them,
 * the fullest fields first; every field is at least 2 fields away from the fields the barrage already aimed at. The
 * missiles fly 3.60 fields/s; on impact every creep on that field (ground and air) takes 3.5 × the Mech's attack
 * damage (perks and damage auras count) as splash damage (Splash Resistance and armor count).
 */
export const MISSILE_BARRAGE = { towerId: "h046", every: 13.5, count: 3, gap: 0.3, speed: 3.6, apart: 2, factor: 1.3 }; // v0.27mF: every 12 s (was 9), 3.5 × attack damage (was 4); v0.27zziF: every 13.5 s, 1.3 × attack damage
function tickBarrage(game, p, tower, stats) {
  if (tower.typeId !== MISSILE_BARRAGE.towerId || (tower.barrageReady || 0) > game.time + EPS) return;
  const cols = game.grid.cols,
    rows = game.grid.rows,
    path = new Set((p.path || []).map((n) => n.gridX + "," + n.gridY)),
    fields = new Map();
  for (const c of p.creeps) {
    if (c.dead || c.hp <= 0 || c.y < 0 || divineShield(game, c)) continue;
    // aims where the creep will be when the missile lands (flight time to the creep's field, walked along its way)
    const here = pos(game, Math.min(cols - 1, Math.max(0, Math.floor(c.x * cols))), Math.floor(c.y * rows)),
      ahead = creepAhead(game, c, Math.hypot((here.x - tower.x) * cols, (here.y - tower.y) * rows) / MISSILE_BARRAGE.speed + MISSILE_BARRAGE.gap),
      gx = Math.min(cols - 1, Math.max(0, Math.floor(ahead.x * cols))),
      gy = Math.floor(ahead.y * rows),
      key = gx + "," + gy;
    if (gy < 0) continue;
    if (!c.flying && !path.has(key)) continue; // ground creeps on the path; flyers anywhere in the maze
    const f = fields.get(key) || { gx, gy, hp: 0 };
    f.hp += c.hp;
    fields.set(key, f);
  }
  if (!fields.size) return; // nobody in the maze: ready as soon as someone comes
  const picks = [];
  for (const f of [...fields.values()].sort((a, b) => b.hp - a.hp || a.gy - b.gy || a.gx - b.gx)) {
    if (picks.some((q) => Math.max(Math.abs(q.gx - f.gx), Math.abs(q.gy - f.gy)) < MISSILE_BARRAGE.apart)) continue;
    picks.push(f);
    if (picks.length >= MISSILE_BARRAGE.count) break;
  }
  const damage = MISSILE_BARRAGE.factor * (stats.damage || 0) * (auraAt(game, tower, p, auraSources(game, p))?.damage || 1);
  game.missiles ||= [];
  picks.forEach((f, k) => {
    const to = pos(game, f.gx, f.gy),
      fieldsAway = Math.hypot((to.x - tower.x) * cols, (to.y - tower.y) * rows),
      launch = game.time + k * MISSILE_BARRAGE.gap;
    game.missiles.push({ lane: p.id, towerId: tower.id, gx: f.gx, gy: f.gy, x: to.x, y: to.y, launch, impact: launch + fieldsAway / MISSILE_BARRAGE.speed, damage, launched: false });
  });
  tower.barrageReady = game.time + MISSILE_BARRAGE.every;
  emit(game, "skill", { player: p.id, kind: "ultimate", name: "barrage", x: tower.x, y: tower.y, towerId: tower.id });
}
/** v0.27lF: where a creep will roughly be after `t` seconds on its way (its speed and slows now; stunned: where it is). */
function creepAhead(game, c, t) {
  if (c.statuses.some((st) => st.stun)) return { x: c.x, y: c.y };
  let d = (c.speed || 0) * (1 - statusSlow(c.statuses)) * Math.max(0, t), // c.speed already carries the mode multiplier
    x = c.x,
    y = c.y;
  for (let i = c.pathIndex || 0; d > EPS && c.path && i < c.path.length; i++) {
    const n = c.path[i],
      seg = dist(game, { x, y }, n);
    if (seg > d) {
      x += (n.x - x) * (d / seg);
      y += (n.y - y) * (d / seg);
      break;
    }
    x = n.x;
    y = n.y;
    d -= seg;
  }
  return { x, y };
}
/**
 * v0.27mF: Fire Lord (h00I): Flameburst replaces Flamestrike. Every 8 s, while a creep is in range, a fire explosion
 * like Fire Block's bursts on the creep farthest along: every creep within 1.5 fields takes 1.25 × the tower's attack
 * damage (perks and damage auras count) as spell damage; flyers half, like the Fire Block pillars.
 */
export const FLAMEBURST = { towerId: "h00I", every: 8, radius: 1.5, factor: 1.25 };
function tickFlameburst(game, p, tower, stats) {
  if (tower.typeId !== FLAMEBURST.towerId || (tower.burstReady || 0) > game.time + EPS) return;
  const target = p.creeps
    .filter((c) => !c.dead && c.hp > 0 && c.y >= 0 && !divineShield(game, c) && inRange(game, tower, c, stats.range))
    .sort((a, b) => b.progress - a.progress || (a.id < b.id ? -1 : 1))[0];
  if (!target) return;
  tower.burstReady = game.time + FLAMEBURST.every;
  const damage = FLAMEBURST.factor * (stats.damage || 0) * (auraAt(game, tower, p, auraSources(game, p))?.damage || 1);
  (game.pillars ||= []).push({ player: p.id, towerId: tower.id, x: target.x, y: target.y, radius: FLAMEBURST.radius, damage, small: true, start: game.time, erupt: game.time, end: game.time + PILLAR.interval, next: game.time, burst: true, until: game.time + PILLAR.interval + FIREBLOCK.scorch });
  emit(game, "skill", { player: p.id, kind: "flameburst", x: target.x, y: target.y, towerId: tower.id });
}
function tickMissiles(game, p) {
  if (!game.missiles?.length) return;
  const cols = game.grid.cols,
    rows = game.grid.rows;
  for (const m of game.missiles) {
    if (m.lane !== p.id) continue;
    const tower = p.towers.find((t) => t.id === m.towerId) || null;
    if (!m.launched && game.time + EPS >= m.launch) {
      m.launched = true;
      if (tower) emit(game, "skill", { player: p.id, kind: "missile", x: m.x, y: m.y, from: { x: tower.x, y: tower.y }, flight: Math.max(0.05, m.impact - m.launch) });
    }
    if (game.time + EPS < m.impact) continue;
    m.done = true;
    for (const c of p.creeps) {
      if (c.dead || c.hp <= 0 || Math.min(cols - 1, Math.max(0, Math.floor(c.x * cols))) !== m.gx || Math.floor(c.y * rows) !== m.gy) continue;
      if (tower) splashStrike(game, p, tower, c, m.damage, obj(tower.typeId)?.attackType || "siege");
      else strike(game, p, null, c, m.damage, "siege");
    }
    emit(game, "skill", { player: p.id, kind: "missileHit", x: m.x, y: m.y });
  }
  game.missiles = game.missiles.filter((m) => !m.done);
}
/** Auras that tick every simulation step: immolation and disease clouds. */
/**
 * v0.27oF: immolation auras no longer stack: every tick each creep only burns from the strongest aura that reaches
 * it (collected over all towers of the lane, applied in applyImmolation); burning creeps carry `immo` (time) for the
 * flames drawn at their feet.
 */
const IMMOLATION = new Map(); // creep → { tower, damage }; filled and emptied within one lane's tick
function tickAreaDamage(game, p, tower, skills) {
  for (const sk of skills) {
    if (sk.type !== "immolation" || sk.dps <= 0) continue;
    for (const c of p.creeps) {
      if (c.dead || c.hp <= 0 || (sk.airOnly && !c.flying) || outOfRange(game, tower, c, sk.radius)) continue; // v0.23: outOfRange
      const damage = sk.dps * TICK * (c.flying ? sk.flyFactor : 1),
        best = IMMOLATION.get(c);
      if (!best || damage > best.damage) IMMOLATION.set(c, { tower, damage });
    }
  }
}
function applyImmolation(game, p) {
  if (!IMMOLATION.size) return;
  for (const [c, hit] of IMMOLATION) {
    if (c.dead || c.hp <= 0) continue;
    strike(game, p, hit.tower, c, hit.damage, "spells", true);
    c.immo = game.time;
  }
  IMMOLATION.clear();
}
/**
 * v0.17p: Pit Lord's Howl. When creeps come within its radius the tower howls: those creeps are
 * slowed and take more damage from towers for a while; then it rests for its cooldown.
 */
/** v0.27zaF: Tree of Life: every few seconds a random creep in range (not already entangled) is entangled. */
function tickEntangle(game, p, tower, skills, range) {
  const sk = skills.find((x) => x.type === "timedEntangle");
  if (!sk) return;
  if (tower.entangleReady == null) tower.entangleReady = game.time + sk.interval;
  if (tower.entangleReady > game.time) return;
  const pool = p.creeps.filter((c) => !c.dead && c.hp > 0 && inRange(game, tower, c, range) && !divineShield(game, c) && !c.statuses.some((st) => st.abilityId === "entangle"));
  if (!pool.length) return; // waits until a creep comes into range
  const c = pool[Math.floor(random(game) * pool.length)];
  c.statuses.push({ abilityId: "entangle", remaining: negativeDuration(c, sk.duration), slow: 0, dps: sk.dps, stun: true, owner: p.id });
  tower.entangleReady = game.time + sk.interval;
  emit(game, "skill", { player: p.id, kind: "entangle", x: c.x, y: c.y, towerId: tower.id });
}
/** v0.27yF: Terror Aura: creeps in range take more damage from towers while they stay there (refreshed every tick). */
const TERROR_HOLD = 0.2;
function tickTerror(game, p, tower, skills) {
  const sk = skills.find((x) => x.type === "terror");
  if (!sk) return;
  for (const c of p.creeps) {
    if (c.dead || c.hp <= 0 || !inRange(game, tower, c, sk.radius)) continue;
    const st = c.statuses.find((x) => x.abilityId === "terror");
    if (st) {
      st.remaining = TERROR_HOLD;
      st.amp = Math.max(st.amp, sk.amp);
    } else c.statuses.push({ abilityId: "terror", remaining: TERROR_HOLD, slow: 0, amp: sk.amp, dps: 0, owner: p.id });
  }
}
function tickHowl(game, p, tower, skills) {
  const sk = skills.find((x) => x.type === "howl");
  if (!sk || (tower.howlReady || 0) > game.time) return;
  const near = p.creeps.filter((c) => !c.dead && c.hp > 0 && inRange(game, tower, c, sk.radius)); // v0.23: inRange
  if (!near.length) return;
  for (const c of near) {
    c.statuses = c.statuses.filter((st) => st.abilityId !== "howl");
    c.statuses.push({ abilityId: "howl", remaining: negativeDuration(c, sk.duration), slow: sk.slow, amp: sk.amp, dps: 0, owner: p.id });
  }
  tower.howlReady = game.time + sk.cooldown;
  emit(game, "skill", { player: p.id, kind: "howl", x: tower.x, y: tower.y, radius: sk.radius, towerId: tower.id });
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
    if (cl.splash) {
      // v0.27zzhF: disease clouds deal the launcher's splash damage once per second (its attack type, armour, Dodge,
      // Splash Resistance and the Tier Boss reduction count), no longer armour-piercing spell damage every tick
      cl.next -= TICK;
      if (cl.next > EPS) continue;
      cl.next += 1;
      for (const c of [...p.creeps])
        if (!c.dead && c.hp > 0 && (cl.air || !c.flying) && dist(game, cl, c) <= cl.radius) splashStrike(game, p, tower, c, cl.dps, cl.splash);
      continue;
    }
    for (const c of p.creeps)
      if (!c.dead && c.hp > 0 && (cl.air || !c.flying) && dist(game, cl, c) <= cl.radius) strike(game, p, tower, c, cl.dps * TICK, "spells", true);
  }
  game.clouds = game.clouds.filter((cl) => cl.remaining > 0);
}
/**
 * v0.27zziF: Decay (Hall of Plague 2–4): every attack destroys this share of the creep's max health;
 * Tier Bosses take 50 % less, Mini Bosses 40 % less. Divine Shield blocks it, Water Shield absorbs it.
 */
export const DECAY = { h021: 0.02, h009: 0.03, h038: 0.04, h01Z: 0.05, h043: 0.06, boss: 0.5, mini: 0.6 }; // Terror Demon 5 %, Skull Mage 6 %
function applyDecay(game, p, tower, target) {
  const pct = DECAY[tower.typeId];
  if (!pct || target.dead || target.hp <= 0 || divineShield(game, target)) return;
  const f = nerfClass(target) === "boss" ? DECAY.boss : creepSkills(target).some((sk) => sk.type === "miniBoss") ? DECAY.mini : 1,
    before = target.hp;
  target.hp -= guardCut(game, target, target.maxHp * pct * f);
  target.lastHit = tower.id;
  const done = Math.max(0, Math.min(before, before - target.hp));
  tower.dmg = (tower.dmg || 0) + done;
  if (p.stats) (p.stats.towerDmg ||= {})[tower.typeId] = (p.stats.towerDmg[tower.typeId] || 0) + done;
}
/** v0.23: Decay Attack abilities that drain this share of the creep's remaining health per hit (Kel Thuzad). */
export const DECAY_DRAIN = {}; // v0.27zziF: Skull Mage drain (6 % of remaining health) became Decay (6 % of max health)
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
    if (ability.baseId === "Aspo" && /frost/i.test(String(field(a, "anam", 0) || ""))) {
      // v0.13: the water "Frost Attack" (Frost Archer, Naga Guard, Hall of Water …) uses the poison
      // base in the map but is a frost slow: Spo2 of the level, no damage, never stacks (shared
      // with the Water Elemental's frost; the stronger slow wins, a new hit refreshes it).
      const slow = fval(ability, "Spo2", level);
      if (slow > 0) {
        const duration = negativeDuration(target, fval(ability, "adur", level) || 3),
          frost = target.statuses.find((st) => st.abilityId === "frost");
        if (frost) {
          frost.remaining = Math.max(frost.remaining, duration);
          frost.slow = Math.max(frost.slow, slow);
        } else target.statuses.push({ abilityId: "frost", remaining: duration, slow, dps: 0, owner: player.id });
      }
    } else if (ability.baseId === "Aspo") {
      // Poison stacks: each hit adds damage over time and a little slow; the oldest stack drops at the cap.
      // v0.13: the slow per stack is the ability's own value (Spo2), capped as before.
      const alch = perkLevel(player, "alchemist"), // v0.27aF: Poison Alchemist
        duration = negativeDuration(target, fval(ability, "adur", level) || 6) * (1 + ALCHEMIST.duration * alch),
        dps = Math.max(1, fval(ability, "Spo1", level)),
        stackSlow = fval(ability, "Spo2", level) || POISON_SLOW_PER_STACK;
      const mine = target.statuses.filter((s) => s.poison && s.stack === "Aspo"); // v0.24j: melee and ranged poison share one pool of stacks
      if (mine.length >= POISON_MAX_STACKS + ALCHEMIST.stacks * alch) {
        const oldest = mine.reduce((a, b) => (b.remaining < a.remaining ? b : a));
        target.statuses.splice(target.statuses.indexOf(oldest), 1);
      }
      target.statuses.push({
        abilityId: ability.id,
        stack: "Aspo",
        poison: true,
        remaining: duration,
        slow: stackSlow,
        dps,
        owner: player.id,
      });
      // v0.23: Kel Thuzad's Decay Attack also drains a share of the remaining health on every hit (not while shielded)
      const drain = DECAY_DRAIN[ability.id];
      if (drain && target.hp > 0 && !divineShield(game, target)) {
        target.hp -= guardCut(game, target, target.hp * drain);
        target.lastHit = tower.id;
      }
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
function attack(game, p, tower, dt, known = null) {
  const item = obj(tower.typeId);
  if (!item.attacks) return;
  // v0.21l: stats come from the tower loop (computed there anyway); the aura only when the tower
  // can shoot this tick or has a second weapon, plus every 10th tick for the Trueshot crosshair
  const stats = known || statsFor(game, p, item),
    needAura = item.weapon2 || tower.cooldown - dt <= 0 || game.tick % 10 === 0,
    aura = needAura ? auraAt(game, tower, p, auraSources(game, p)) : null; // v0.21l
  if (aura) tower.trueshot = aura.trueshot; // v0.17p: drawn as a small crosshair
  const cursed = tower.curse && tower.curse.until > game.time ? tower.curse.amount : 0;
  if (item.weapon2) secondWeapon(game, p, tower, item, stats, aura, dt, cursed);
  tower.cooldown -= dt;
  if (tower.cooldown > 0) return;
  const canHit = (c) => (c.flying ? item.targets.includes("air") : item.targets.includes("ground")) && (!c.invisible || detected(game, p, c));
  const melee = isMeleeTower(item) && towerSize(tower) === 1,
    inReach = (c) => (melee ? inMeleeReach(game, tower, c) : inRange(game, tower, c, stats.range)); // v0.23: inRange
  const skills = towerSkills(p, tower),
    focus = skills.find((sk) => sk.type === "focus");
  // v0.23i: most ready towers have nothing in reach: find that out without building the target list
  if (!(focus && tower.focusId)) {
    let any = false;
    for (const c of p.creeps)
      if (!c.dead && c.hp > 0 && !divineShield(game, c) && inReach(c) && canHit(c)) {
        any = true;
        break;
      }
    if (!any) {
      if (focus) tower.focusOut = null;
      tower.cooldown = 0;
      tower.focusId = null;
      tower.focusMult = 1;
      return;
    }
  }
  const targets = p.creeps.filter((c) => !c.dead && c.hp > 0 && !divineShield(game, c) && inReach(c) && canHit(c)); // v0.21x: no shots at invulnerable creeps
  // v0.22u2: Focus Fire holds a target that just left its range (up to 0.2 tiles further, at most 0.5 s);
  // losing it that way rests the laser like a kill does
  let held = null;
  if (focus && tower.focusId && !targets.some((c) => c.id === tower.focusId)) {
    const c = p.creeps.find((o) => o.id === tower.focusId),
      alive = c && !c.dead && c.hp > 0 && !divineShield(game, c) && canHit(c);
    if (alive && dist(game, tower, c) <= stats.range + game.grid.cellUnits * FOCUS_HOLD.tiles && game.time - (tower.focusOut ??= game.time) <= FOCUS_HOLD.seconds) held = c;
    else if (alive) {
      tower.focusId = null;
      tower.focusMult = 1;
      tower.focusOut = null;
      tower.cooldown = FOCUS_REST;
      tower.smokeUntil = game.time + FOCUS_REST;
      emit(game, "laserSmoke", { player: p.id, towerId: tower.id, x: tower.x, y: tower.y, duration: FOCUS_REST });
      return;
    }
  } else if (focus) tower.focusOut = null;
  if (!targets.length && !held) {
    tower.cooldown = 0;
    tower.focusId = null; // v0.18b: Focus Fire ends without a target
    tower.focusMult = 1;
    return;
  }
  // v0.18b: towers take the weaker creeps they can more likely kill first (no bosses, no heavy
  // creeps while others are in reach), then the one furthest along the path
  // v0.21v: heavy creeps and bosses come last only in the upper half of the field; from halfway on they count like any creep
  // v0.23k: bosses always come last (towers prefer every other creep in reach, on the whole path)
  const shy = (c) => (obj(c.typeId)?.bossTier || c.waveBoss ? 2 : c.progress < HEAVY_SHY && heavyCreep(c) ? 1 : 0);
  targets.sort((a, b) => shy(a) - shy(b) || b.progress - a.progress || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // v0.18b: Focus Fire keeps its target while it stays in reach
  const target = held || (focus && tower.focusId && targets.find((c) => c.id === tower.focusId)) || targets[0];
  tower.aimId = target.id; // v0.21y: the selected tower shows its splash around this creep
  let damage =
    (diceRoll(game, item.damageBase, item.dice, item.sides) + stats.damageBonus) * stats.damageMultiplier * aura.damage;
  if (focus) {
    // +9 % every 0.25 s on the same target (v0.22u2: was 10 %; flyers 20 % slower), up to 500 %; a new target or a pause starts again
    if (tower.focusId !== target.id || !(game.time - (tower.focusLast ?? -99) <= Math.max(0.6, stats.cooldown * 1.5 + 0.25))) {
      tower.focusId = target.id;
      tower.focusStart = game.time;
    }
    tower.focusLast = game.time;
    tower.focusMult = Math.min(focus.max, 1 + focus.step * (target.flying ? FOCUS_AIR : 1) * Math.floor((game.time - tower.focusStart + EPS) / focus.interval));
    damage *= tower.focusMult;
  }
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
    damage *= magicEmpower(item) * (heavyCreep(target) ? 1 + ARCANE_MISSILE_HEAVY : 1); // v0.24j: stronger on levels 5 and 6; v0.27zzgF: +50 % against heavy and boss creeps
    tower.mana = 0;
    empowered = true;
    emit(game, "skill", { player: p.id, kind: "empower", x: target.x, y: target.y, towerId: tower.id });
  }
  const feedback = skills.find((sk) => sk.type === "feedback");
  const victimAura = auraAt(game, target, game.players[target.owner], auraSources(game, p)); // v0.21l
  // Corrosive auras (AHad) lower armor; strike() adds the creep's own shred and statuses.
  splashHit = isSplashTower(item) && !isMeleeTower(item); // v0.22za2: a splash tower's main hit is splash too
  let dealt;
  try {
    dealt = strike(game, p, tower, target, damage + (feedback && target.summoned ? feedback.bonus : 0), item.attackType, false, victimAura.armor);
  } finally {
    splashHit = false;
  }
  applyOnHit(game, p, tower, target);
  applyDecay(game, p, tower, target); // v0.27zziF
  applySkills(game, p, tower, item, target, damage, skills);
  chargedSpecial(game, p, tower, target);
  const shots = [target];
  // Multi Shot: extra arrows at the next creeps in range.
  const multi = skills.find((sk) => sk.type === "multishot") || (fireArcher(item.id) ? { count: item.level || 1 } : null); // v0.16: Fire Archer multishot
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
    // Cannon: full damage in a tiny core around the impact, 25 % in the wider ring.
    const core = Math.max(item.splashFull, CANNON_CORE * game.grid.cellUnits),
      ring = Math.max(item.splashSmall, item.splashMedium, CANNON_RING * game.grid.cellUnits) * BOMBARD_RADIUS + gunpowderBonus(game, p);
    for (const other of p.creeps) {
      if (other === target || other.dead || other.hp <= 0 || !canHit(other)) continue;
      const d = dist(game, target, other),
        rate = d <= core ? 1 : d <= ring ? CANNON_RING_FACTOR : 0;
      if (rate) splashStrike(game, p, tower, other, damage * rate, item.attackType);
    }
    emit(game, "skill", { player: p.id, kind: "splash", x: target.x, y: target.y, radius: ring, core });
  } else if (item.splashFull > 0 || item.splashMedium > 0 || item.splashSmall > 0) {
    // v0.17b: Bombard line (Disease Launcher, Treant Tower): outer radius 10 % smaller
    const bombard = lineSet("h02R").has(tower.typeId),
      gp = bombard ? gunpowderBonus(game, p) : 0, // v0.21u: Gunpowder widens the outermost ring
      maxR = bombard ? Math.max(item.splashFull, item.splashMedium, item.splashSmall) * BOMBARD_RADIUS + gp : Infinity;
    const melee = isMeleeTower(item); // v0.22a: melee splash (former Splash Attack) only hits the ground
    for (const other of p.creeps) {
      if (other === target || other.dead || other.hp <= 0 || (melee && other.flying)) continue;
      const d = dist(game, target, other);
      if (d > maxR) continue;
      let rate =
        d <= item.splashFull
          ? 1
          : d <= item.splashMedium
            ? item.splashMediumFactor
            : d <= item.splashSmall + gp
              ? item.splashSmallFactor
              : 0;
      if (rate) splashStrike(game, p, tower, other, damage * rate, item.attackType);
    }
  }
  // Cleaving / splash attack skill (Ogre, Pit Lord, Robogoblin).
  const cleave = skills.find((sk) => sk.type === "cleave");
  if (cleave)
    for (const other of p.creeps)
      if (other !== target && !other.dead && other.hp > 0 && !other.flying && dist(game, target, other) <= cleave.radius)
        splashStrike(game, p, tower, other, damage * cleave.fraction, item.attackType);
  tower.cooldown += Math.max(0.08, stats.cooldown / aura.attack / Math.max(0.1, 1 - cursed));
  // v0.19b1: Focus Fire: after a kill the laser rests for 1 s and its weapon smokes
  const rest = focus && (target.dead || target.hp <= 0);
  if (rest) {
    tower.cooldown = Math.max(tower.cooldown, FOCUS_REST);
    tower.smokeUntil = game.time + FOCUS_REST;
  }
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
      ...(focus ? { focus: tower.focusMult || 1, focusMax: focus.max } : {}), // v0.18b: drawn as a beam
    });
  if (rest) {
    tower.focusId = null;
    tower.focusMult = 1;
    emit(game, "laserSmoke", { player: p.id, towerId: tower.id, x: tower.x, y: tower.y, duration: FOCUS_REST });
  }
}
/** v0.19b1: seconds an Earth Laser rests (and smokes) after Focus Fire killed its target. */
export const FOCUS_REST = 1.1; // v0.22u2: +10 %
/** v0.22u2: Focus Fire holds a target that escapes its range, and charges 20 % slower against flyers. */
export const FOCUS_HOLD = { tiles: 0.2, seconds: 0.5 };
export const FOCUS_AIR = 0.8;
/** Bash towers carry an extra anti-air weapon (ua2*): own cooldown, range and damage. */
function secondWeapon(game, p, tower, item, stats, aura, dt, cursed) {
  const w = item.weapon2;
  tower.cooldown2 = (tower.cooldown2 || 0) - dt;
  if (tower.cooldown2 > 0) return;
  const target = p.creeps
    .filter((c) => !c.dead && c.hp > 0 && !divineShield(game, c) && c.flying && w.targets.includes("air") && inRange(game, tower, c, rangedReach(game, w.range)) && (!c.invisible || detected(game, p, c))) // v0.23: inRange
    .sort((a, b) => b.progress - a.progress || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
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
export const CROWD = { interval: 5, threshold: [50, 45, 40], cull: 3, income: 0.1 }; // v0.20d
/** v0.20d: the undead creep Crowd Control sends back, by the culling player's tier. */
export const CROWD_UNDEAD = { 1: "n00R", 2: "n011", 3: "n016", 4: "n01D", 5: "n02E" };
function crowdControl(game, p) {
  const level = perkLevel(p, "crowd");
  if (!level) return;
  if (!(p.crowdNext > 0)) p.crowdNext = game.time + CROWD.interval;
  if (game.time + EPS < p.crowdNext) return;
  p.crowdNext = game.time + CROWD.interval;
  const alive = p.creeps.filter((c) => !c.dead && c.hp > 0);
  if (alive.length < CROWD.threshold[Math.min(3, level) - 1]) return; // v0.23: at 50 or more creeps (was: more than 50)
  const victims = alive
    .filter((c) => !divineShield(game, c)) // v0.23: creeps under Divine Shield are never culled
    .sort((a, b) => a.hp - b.hp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, CROWD.cull);
  const back = [];
  for (const c of victims) {
    emit(game, "skill", { player: p.id, kind: "crowd", x: c.x, y: c.y });
    if (!c.wave && c.owner >= 0 && c.owner !== p.id) back.push({ to: c.owner, tier: creepTier(game, c) });
    c.hp = 0;
    killCreep(game, p, c);
  }
  // v0.23: every culled creep goes back to its owner as one undead creep of its own tier (was: one undead of your tier, to the main sender); each pays a little income
  for (const b of back) {
    const q = game.players[b.to],
      undead = CROWD_UNDEAD[b.tier];
    if (!q || q.out || (game.teams && q.team === p.team)) continue;
    if (spawnCreep(game, p.id, undead, null, b.to)) {
      p.incomeDecimal += Math.round((obj(undead)?.pointValue || 0) * 100 * CROWD.income);
      p.income += Math.trunc(p.incomeDecimal / 100);
      p.incomeDecimal %= 100;
    }
  }
}
/** v0.23: the send tier of a creep (spawned helpers without a tier of their own, such as death spawns, count as their sender's tier). */
function creepTier(game, c) {
  const it = obj(c.typeId);
  return Math.max(1, Math.min(5, it?.kind === "send" && it.tier > 0 ? it.tier : game.players[c.owner]?.tier || 1));
}
/**
 * v0.21z: the Meat Golem denies its first death. It stops, growls and rises as the Enraged Meat
 * Golem with that form's stats (the former dummy creep n008): 42,000 hit points, speed 261,
 * armor 7 and Tier Boss (v0.22n2; was Scale Armor 10, Magic Resistance 50 %, Nerf Resistance 75 %). Perk and wave scaling of
 * the hit points carries over.
 */
// v0.22n2: Tier Boss instead of Scale Armor, Magic and Nerf Resistance; +80 % speed (was 137 → 261, +90 %)
export const ENRAGED_GOLEM = { id: "n01H", hp: 42000, speedBonus: 0.8, armor: 66, // v0.27mF: linear armor (old 7)
  pause: 1.2, abilities: ["A01A", "XA12", "A043", "A0CD"] };
function enrageGolem(game, p, c) {
  const item = obj(c.typeId),
    hpScale = c.maxHp / (item.hp || c.maxHp),
    pace = 1 + ENRAGED_GOLEM.speedBonus;
  c.enraged = true;
  c.maxHp = Math.round(ENRAGED_GOLEM.hp * hpScale);
  c.hp = c.maxHp;
  c.speed *= pace;
  c.baseSpeed = (c.baseSpeed || c.speed) * pace;
  c.armor += ENRAGED_GOLEM.armor - (item.armor || 0);
  c.statuses = c.statuses.filter((st) => !(st.dps > 0) && !st.stun); // damage over time and stuns end with the old form
  c.enrageUntil = game.time + ENRAGED_GOLEM.pause;
  emit(game, "skill", { player: p.id, kind: "enrage", creepId: c.id, x: c.x, y: c.y });
}
/**
 * v0.23v: EXP for a kill: (price of the creep card / creeps it sends) × (0.11 − tier × 0.01), e.g. Goblin 5 / 2 × 0.10 =
 * 0.25 EXP, Orc 60 × 0.10 = 6. Bosses give none (their buyer already gets EXP); creeps that are no send card give none.
 */
/** v0.24oF: breaches and line crossings of tier 2+ creeps give +10 % EXP per tier above 1 (tier 2 +10 %, tier 3 +20 % …). */
export const CREEP_TIER_EXP = { perTier: 0.1 };
function creepTierExp(c) {
  const tier = obj(c.typeId)?.tier || 1;
  return 1 + CREEP_TIER_EXP.perTier * Math.max(0, tier - 1);
}
/** v0.24p: kill EXP in % of the cost per creep, by tier (tier 5+: 1 %). */
export const KILL_EXP_PCT = [1.5, 1.4, 1.25, 1.1, 1];
export function killExp(item) {
  if (!item || !item.isSend || !(item.cost > 0)) return 0; // v0.24oF: tier bosses count too (were 0)
  const n = item.spawnIds?.length || 1, // the cost is split over the creeps one send makes (heavies and bosses: 1)
    tier = item.tier || 1;
  return ((item.cost / n) * KILL_EXP_PCT[Math.min(KILL_EXP_PCT.length, Math.max(1, tier)) - 1]) / 100; // v0.24p: KILL_EXP_PCT % of the cost
}
/** v0.24oF: kill EXP of a summoned creep from its health, in brackets: 0.005 per HP up to 1,000, 0.003 per HP from 1,001 to 10,000, 0.0015 per HP above. */
/** v0.24oF: a Clones copy gives 25 % less kill EXP. */
export const CLONE_KILL_EXP = 0.75;
export const SUMMON_EXP = [
  [1000, 0.005],
  [10000, 0.003],
  [Infinity, 0.0015],
];
export function summonExp(hp) {
  let exp = 0,
    low = 0;
  for (const [top, rate] of SUMMON_EXP) {
    if (hp <= low) break;
    exp += (Math.min(hp, top) - low) * rate;
    low = top;
  }
  return exp;
}
function killCreep(game, p, c) {
  if (c.dead) return;
  if (c.typeId === ENRAGED_GOLEM.id && !c.enraged) return enrageGolem(game, p, c);
  c.dead = true;
  // v0.10w: a killed treant gives its sender 30 − (treants bought this game) EXP (v0.21z: was 20)
  if (c.typeId === "n00Y" && !c.wave && c.owner >= 0) {
    const sender = game.players[c.owner];
    if (sender && !sender.out) gainExp(game, sender, Math.max(0, TREANT.exp - (sender.treantCount || 0)), "treant");
  }
  const item = obj(c.typeId),
    tower = p.towers.find((t) => t.id === c.lastHit);
  let bounty = c.wave ? c.bounty : diceRoll(game, item.bountyBase, item.bountyDice, item.bountySides);
  if (p.rules?.noBounty) bounty = 0; // v0.26bF: mission rule
  // v0.22j1: Bounty Bonus is a fixed +20 % on every kill (was a 50 % chance of extra gold)
  const bonus = !!tower && (obj(tower.typeId).abilities.includes("A00O") || obj(tower.typeId).abilities.includes("A072") || tower.typeId === "h02U");
  if (bonus) bounty *= 1 + BOUNTY_BONUS;
  p.gold += bounty;
  p.stats.goldEarned += bounty;
  p.stats.kills++;
  if (tower) {
    tower.kills++;
    (p.stats.towerKills ||= {})[tower.typeId] = (p.stats.towerKills[tower.typeId] || 0) + 1; // v0.22j1: kills by tower type, sold towers included
  }
  const exp = (c.summoned ? summonExp(c.maxHp || 0) : killExp(item)) * (c.clone ? CLONE_KILL_EXP : 1) * (c.volleyKill ? VOLLEY.killExp : 1); // v0.27aF: Arrow Volley kills 300 % // v0.24oF: summoned creeps by health, Clones copies −25 %
  if (exp > 0) gainExp(game, p, exp, c.summoned ? "summonKills" : "kills"); // v0.23v: a little EXP for every kill
  emit(game, "kill", { player: p.id, id: c.typeId, creepId: c.id, x: c.x, y: c.y, bounty, bonus, wave: c.wave || 0, boss: !!c.waveBoss });
  if (c.wave) waveDeath(game, p, c);
  else deathrattle(game, c);
}

function deathrattle(game, c) {
  let plan = (DEATH_PLANS[c.typeId] || []).slice();
  if (c.typeId === "n03A" || c.typeId === "n037") {
    const roll = 1 + Math.floor(random(game) * 5),
      first = { 1: "n02Z", 2: "n034", 3: "n02Y", 4: "n036", 5: "n02Z" }[roll];
    plan = [[first, 0]];
    if (c.typeId === "n03A") plan.push([["n02Z", "n034", "n02Y", "n036", "n037"][Math.floor(random(game) * 5)], 0.4]);
  }
  for (const sk of creepSkills(c))
    if (sk.type === "spawnOnDeath" && obj(sk.id)) for (let i = 0; i < sk.count; i++) plan.push([sk.id, i * 0.3]);
  // v0.12: Breeding Pools of the sender: chance of one more spawn, spawns with more hit points
  const sender = c.owner >= 0 ? game.players[c.owner] : null,
    breed = Math.min(3, perkLevel(sender, "breeding"));
  let boost = 1;
  // v0.27aF: one sure extra spawn; spawns +25 % HP per level from level 2
  if (breed && plan.length && !c.wave) {
    boost = 1 + breedingHp(breed);
    const [id, , health = 1] = plan[0];
    for (let k = 0; k < BREEDING.extra; k++) plan.push([id, Math.max(...plan.map((x) => x[1])) + 0.2, health]);
  }
  for (const [id, delay, health = 1] of plan)
    game.pendingSpawns.push({ owner: c.owner, lane: c.defender, id, time: game.time + delay, x: c.x, y: c.y, health, ...(boost > 1 ? { boost } : {}) });
}
/** The next lane a leaked creep runs on: the next seat to the right that is still in, not the sender's. */
function laneAfter(game, p, sender) {
  const n = game.players.length;
  for (let k = 1; k < n; k++) {
    const q = game.players[(p.id + k) % n];
    // v0.20: in a team game the creep runs on in the lane of the next player of the same (defending) team
    if (!q.out && q.id !== sender.id && (!game.teams || q.team === p.team)) return q;
  }
  return p;
}
function touchdown(game, p, c) {
  questBreach(game, p, c); // v0.15
  if (c.owner < 0) return waveTouchdown(game, p, c);
  const sender = game.players[c.owner];
  if (sender?.quest && QUESTS[sender.quest.id]?.kind === "breach") finishQuest(game, sender, true); // v0.19a1: a breach fulfils a contract (v0.27nF: Breach Contract)
  p.lives = Math.max(0, p.lives - 1);
  // v0.17: who took lives from whom (Nemesis in the match summary)
  (p.stats.lostTo ||= {})[sender.id] = (p.stats.lostTo[sender.id] || 0) + 1;
  (sender.stats.stoleFrom ||= {})[p.id] = (sender.stats.stoleFrom[p.id] || 0) + 1;
  (sender.stats.stoleBy ||= {})[c.typeId] = (sender.stats.stoleBy[c.typeId] || 0) + 1; // v0.17g: lives stolen per creep type
  if (!sender.out) sender.lives++;
  sender.stats.leaks++;
  // v0.17: stealing a life cracks one of your rocks (missions with rocks)
  if (game.mission?.rocksOnSteal) {
    const k = sender.towers.findIndex((t) => t.typeId === ROCK_ID);
    if (k >= 0) {
      const rock = sender.towers.splice(k, 1)[0];
      sender.path = findPath(game, sender.id) || [];
      emit(game, "rock", { player: sender.id, towerId: rock.id, x: rock.x, y: rock.y, cracked: true });
    }
  }
  // v0.10k: Pillage; v0.19h1: 12 % of the leaked player's gold per perk level
  const pillage = Math.min(PILLAGE.max, perkLevel(sender, "pillage"));
  if (pillage && !sender.out) {
    const loot = Math.floor(p.gold * PILLAGE.shares[pillage]);
    if (loot > 0) {
      p.gold -= loot;
      sender.gold += loot;
      emit(game, "pillage", { player: p.id, owner: sender.id, gold: loot, x: c.x, y: c.y });
    }
  }
  gainExp(game, sender, (["n00S", "n01C"].includes(c.typeId) ? 30 : RULES.touchdownWood) * creepTierExp(c), "breach", BREACH_EXP_MIN * (sender.expNext || 0)); // v0.24oF: +10 % per tier above 1; v0.27bF: at least 1 % of the sender's current level step
  if (["n01R", "n02P"].includes(c.typeId)) {
    const stolen = Math.trunc(p.income / 100);
    p.income -= stolen;
    sender.income += stolen;
  }
  if (!game.firstBlood) {
    game.firstBlood = true;
    gainExp(game, sender, RULES.firstBloodWood, "achievement");
    emit(game, "firstBlood", { player: sender.id, exp: RULES.firstBloodWood });
  }
  bloodCheck(game, sender); // v0.19j
  emit(game, "leak", { player: p.id, owner: sender.id, creepId: c.id, lives: p.lives, x: c.x, y: c.y });
  if (p.lives > 0 && !p.out && !sender.out && perkLevel(p, "revenge")) spawnFireWolf(game, p, sender); // v0.26cF: Revenge
  if (p.lives <= 0) {
    gainExp(game, sender, RULES.defeatWood, "defeat");
    defeat(game, p, sender);
    return;
  }
  c.laps++;
  c.statuses = c.statuses.filter((st) => st.abilityId !== PENALTY_LAP.id); // v0.27lF: Arcane Penalty ends with the breach
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
  c.path = c.flying ? [start, exitPos(game, lane, column)] : findPath(game, lane.id, { x: column, y: -1 }) || [];
  c.pathIndex = 0;
  c.prevNode = null;
}
/** v0.17g: how far (in fields) a creep may walk beside the centre line of the path. */
const CREEP_SPREAD = 0.25;
function moveCreep(game, p, c, dt) {
  if (c.dead) return;
  const shielded = divineShield(game, c);
  for (const s of c.statuses) {
    s.remaining -= dt;
    if (!shielded) c.hp -= guardCut(game, c, s.dps * dt * hitMultiplier("spells", c, 0));
  }
  c.statuses = c.statuses.filter((s) => s.remaining > 0);
  if (c.hp <= 0) {
    killCreep(game, p, c);
    return;
  }
  if (c.enrageUntil > game.time) return; // v0.21z: the Meat Golem stops for a moment and growls
  const slow = statusSlowParts(c.statuses),
    stunned = c.statuses.some((s) => s.stun),
    aura = auraAt(game, c, game.players[c.owner], auraSources(game, p)); // v0.21l
  c.hp = Math.min(c.maxHp, c.hp + (c.regen + (aura.regen || 0)) * dt);
  c.auraArmor = aura.armor; // v0.17p: armor auras (Corrosive, Napalm, Creep Armor) count for every hit, not only the main target
  const curse = c.curseUsed ? null : creepSkills(c).find((sk) => sk.type === "curse"); // v0.23zb: the Undoctor curses once
  if (curse && !stunned) {
    c.cooldown = (c.cooldown || 0) - dt;
    if (c.cooldown <= 0) {
      const tower = p.towers
        .filter((t) => !(t.buildRemaining > 0) && !(t.curse && t.curse.until > game.time) && inRange(game, c, t, curse.range)) // v0.23: inRange
        .sort((a, b) => dist(game, c, a) - dist(game, c, b))[0];
      if (tower) {
        tower.curse = { amount: curse.amount, until: game.time + curse.duration };
        c.cooldown = curse.cooldown;
        c.curseUsed = true;
        emit(game, "skill", { player: p.id, kind: "curse", x: tower.x, y: tower.y, towerId: tower.id });
      }
    }
  }
  // v0.19k: a knock-back glides: the creep slides back first and walks on afterwards
  if (c.knock) {
    const step = Math.min(c.knock.left, c.knock.rate * dt);
    pushBack(game, c, step, game.players[c.knock.p] || p);
    c.knock.left -= step;
    if (c.knock.left <= EPS) c.knock = null;
    c.progress = laneProgress(game, p, c);
    return;
  }
  if (stunned) {
    c.progress = laneProgress(game, p, c);
    return;
  }
  // c.speed is already scaled once by statsFor; scale both clamp limits too.
  // This equals clamp(original speed with modifiers,24,1000)*modeMultiplier.
  const mobility = movementMultiplier(game);
  // v0.10r: Red Boots of the sender: ground creeps 25 % less slowed per level
  const boots = (c.flying || c.owner < 0 ? 1 : bootsResist(game.players[c.owner])) * (1 - (creepSkills(c).find((sk) => sk.type === "slowResist")?.value || 0)) * (creepSkills(c).some((sk) => sk.type === "tierBoss") ? 1 - TIER_BOSS.slowResist : creepSkills(c).some((sk) => sk.type === "miniBoss") ? 1 - TIER_BOSS.slowResist * MINI_BOSS.share : 1); // v0.21k: Slow Resistance; v0.24s: tier bosses 30 %
  const frozen = c.flying ? 1 : 1 - FROZEN_GROUND * perkLevel(p, "permafrost") * boots; // v0.10o: Frozen Ground (was Permafrost) of the defender
  const auraSpeed = aura.speed < 1 ? 1 - (1 - aura.speed) * boots : aura.speed; // v0.17n: Red Boots also soften aura slows
  // v0.18h: Backup Line mist / Low Tides water of the defender (Red Boots soften the slow part)
  const zoneRaw = zoneSpeed(game, p, c),
    zone = zoneRaw < 1 ? 1 - (1 - zoneRaw) * boots : zoneRaw;
  // v0.22h1: Hill Paths of the defender: ground creeps whose next step leads upwards walk slower
  const hillLv = c.flying ? 0 : Math.min(5, perkLevel(p, "hills")),
    upWay = hillLv && c.path?.[c.pathIndex],
    hill = upWay && upWay.y + (c.oy || 0) < c.y - EPS ? 1 - HILLS[hillLv] * boots : 1;
  // v0.22h1: slows apply in a fixed order, each on what the one before left: Frozen Ground first, then the
  // frost debuffs, then every other slow (other debuffs, Hill Paths, auras, Backup Line / Low Tides zones)
  let factor = frozen;
  factor *= 1 - clamp(slow.frost * boots, 0, 0.9);
  factor *= 1 - clamp(slow.other * boots, 0, 0.9);
  factor *= hill * auraSpeed * zone;
  if (c.trueSlow) factor *= 1 - c.trueSlow; // v0.23b: true debuff (after the tier boss was bought), never softened
  let remaining = clamp(c.speed * factor, 24 * mobility, 1000 * mobility) * dt;
  // v0.19k: Monsun: ground creeps lean into the storm and only creep forward, so the wind really pushes them back
  if (!c.flying && p.monsun && game.time <= p.monsun.until + EPS) remaining *= MONSUN.walk;
  // v0.17g: every creep walks its own line inside the path (up to a quarter field off the centre),
  // so packed groups spread out and splash damage hits fewer of them at once
  if (c.ox === undefined) {
    c.ox = (random(game) - 0.5) * 2 * CREEP_SPREAD / game.grid.cols;
    c.oy = (random(game) - 0.5) * 2 * CREEP_SPREAD / game.grid.rows;
  }
  if (c.typeId === SIEGE_OGRE.id && !c.flying) {
    if (!c.planted) remaining *= SIEGE_OGRE.carry; // v0.24h: carrying the plank: 20 % slower
    if (siegeOgre(game, p, c, remaining)) remaining = 0; // v0.23zb: walking up to the tower and planting its Siege Plank
  }
  while (remaining > EPS && game.running) {
    const way = c.path[c.pathIndex];
    if (way && p.planks?.length && !c.flying) {
      // v0.23zb: one creep at a time on a Siege Plank; the others wait in front of it
      const pk = p.planks.find((pl) => pl.x === way.gridX && pl.y === way.gridY);
      for (const pl of p.planks) if (pl.busy === c.id && pl !== pk) pl.busy = null;
      if (pk) {
        if (pk.busy && pk.busy !== c.id && p.creeps.some((o) => o.id === pk.busy && !o.dead && o.hp > 0)) break;
        pk.busy = c.id;
      }
    }
    if (!way) {
      if (airBlock(game, p, c)) break; // v0.20c: flyers first meet the Air Block
      if (waterBlock(game, p, c)) break; // v0.10r
      if (fireBlock(game, p, c)) break; // v0.19j; v0.21m: pushes the creep back, no breach
      touchdown(game, p, c);
      break;
    }
    const nx = way.x + c.ox,
      ny = way.y + c.oy, // v0.23i: no object per step
      distance = Math.hypot((c.x - nx) * game.grid.cols, (c.y - ny) * game.grid.rows) * game.grid.cellUnits;
    if (distance <= remaining + EPS) {
      c.x = nx;
      c.y = ny;
      c.pathIndex++;
      remaining -= distance;
      if (!c.flying && Number.isInteger(way.gridX)) {
        if (c.plankRoute) {
          // v0.24h: over the plank and off it again: an ordinary creep from here on
          let ahead = way.gridX + "," + way.gridY === c.plankRoute;
          for (let i = c.pathIndex; i < c.path.length && !ahead; i++) ahead = c.path[i].gridX + "," + c.path[i].gridY === c.plankRoute;
          if (!ahead) c.plankRoute = null;
        }
        else if (p.planks?.length && !c.plankRoute) joinPlank(game, p, c, way.gridX, way.gridY); // v0.24h: next to a plank: take it?
      }
    } else {
      const factor = remaining / distance;
      c.x += (nx - c.x) * factor;
      c.y += (ny - c.y) * factor;
      remaining = 0;
    }
  }
  c.progress = laneProgress(game, p, c);
  c.maxProgress = Math.max(c.maxProgress, c.progress);
  scoutExp(game, c);
}
/**
 * v0.24q: ScoutExp: the sender gets EXP while its creep (flyers too) walks down the defender's maze: `line` for every
 * `lineEvery`-th row reached, and from row `fromLine` on `field` for every new field entered (+`fieldBoost` per
 * `lineEvery` rows reached). Times the creep-tier bonus.
 */
export const SCOUT_EXP = { fromLine: 4, field: 0.3, lineEvery: 8, line: 1, fieldBoost: 0.5 };
/** v0.27bF: Scouting perk (Storm, levels 1-3): +50 % scout EXP per level. */
export const SCOUTING = { perLevel: 0.5, max: 3 };
function scoutExp(game, c) {
  if (c.owner < 0 || c.wave) return;
  const owner = game.players[c.owner];
  if (!owner || owner.out) return;
  const { rows, cols } = game.grid,
    lane = laneRows(game, game.players[c.defender ?? -1]),
    row = Math.floor(c.y * rows + 1e-6);
  if (row < 1) return;
  const line = Math.min(lane - 1, row),
    tierBonus = creepTierExp(c);
  let exp = 0;
  for (let l = (c.scoutLine || 0) + 1; l <= line; l++) if (l % SCOUT_EXP.lineEvery === 0) exp += SCOUT_EXP.line;
  if (line > (c.scoutLine || 0)) c.scoutLine = line;
  if (row >= SCOUT_EXP.fromLine && row < lane) {
    const key = Math.floor(c.x * cols + 1e-6) * 1000 + row;
    if (!(c.scoutSeen ||= {})[key]) {
      c.scoutSeen[key] = 1;
      exp += SCOUT_EXP.field * (1 + SCOUT_EXP.fieldBoost * Math.floor((c.scoutLine || 0) / SCOUT_EXP.lineEvery));
    }
  }
  if (exp > 0) gainExp(game, owner, exp * tierBonus * (1 + SCOUTING.perLevel * Math.min(SCOUTING.max, perkLevel(owner, "scouting"))), "scout"); // v0.27bF: Scouting
}

/** v0.19a1: Spirit Wolves: one wolf per round (v0.21k; was one per perk level); each one adds its income for good. */
function spawnSpiritWolves(game, p, level) {
  const id = WOLVES.ids[Math.max(1, Math.min(WOLVES.ids.length, p.tier || 1)) - 1],
    item = obj(id);
  if (!item) return;
  // v0.19b1: +400 % HP per perk level above 1, +40 % per player level, then + (tier × 200 − 200) flat
  const hpMul = 1 + WOLVES.hp * (level - 1) + WOLVES.hpPerLevel * (p.level || 1),
    roundHp = wolfRoundHp(game.round || 0), // v0.19d2
    hpFlat = WOLVES.hpPerTier * ((p.tier || 1) - 1) * roundHp,
    speedMul = 1 + WOLVES.speed * (level - 1) + WOLVES.speedPerLevel * (p.level || 1) + WOLVES.speedPerTier * ((p.tier || 1) - 1),
    share = game.round <= WOLVES.early ? WOLVES.earlyIncome : 1;
  for (let i = 0; i < 1; i++) { // v0.21k: one wolf per round at every level (was one per perk level)
    const wolf = spawnCreep(game, p.id, id);
    if (!wolf) break;
    Object.assign(wolf, { summoned: true, spiritWolf: true, magicVuln: WOLVES.magic, hpMul: hpMul * roundHp, speedMul });
    wolf.maxHp = (wolf.maxHp * hpMul * roundHp + hpFlat) * WOLVES.hpScale; // v0.24i: −25 % hit points
    wolf.hp = wolf.maxHp;
    wolf.hpFlat = hpFlat;
    wolf.speed *= speedMul;
    wolf.baseSpeed *= speedMul;
    p.incomeDecimal += Math.round(wolfIncome(p.tier, level) * 100 * share);
  }
  p.income += Math.trunc(p.incomeDecimal / 100);
  p.incomeDecimal %= 100;
}
/** v0.26cF: Revenge: a Fire Wolf of the defender's tier runs onto the field of the player whose creep breached. */
function spawnFireWolf(game, p, sender) {
  const level = Math.min(3, perkLevel(p, "revenge")),
    id = WOLVES.ids[Math.max(1, Math.min(WOLVES.ids.length - 1, p.tier || 1)) - 1],
    item = obj(id);
  if (!item || !item.hp) return;
  const wolf = spawnCreep(game, p.id, id, null, sender.id, true);
  if (!wolf) return;
  const perkHp = wolf.maxHp / item.hp, // the defender's own creep HP perks still count
    speedMul = REVENGE.speed / (item.speed || 240);
  Object.assign(wolf, { summoned: true, fireWolf: true, name: "Fire Wolf" });
  wolf.maxHp = revengeHp(p, level) * perkHp;
  wolf.hp = wolf.maxHp;
  wolf.speed *= speedMul;
  wolf.baseSpeed *= speedMul;
  p.incomeDecimal += Math.round(revengeIncome(p, level) * 100);
  p.income += Math.trunc(p.incomeDecimal / 100);
  p.incomeDecimal %= 100;
  (p.stats.fireWolves ||= 0), p.stats.fireWolves++;
  emit(game, "skill", { player: sender.id, owner: p.id, kind: "revenge", x: wolf.x, y: wolf.y }); // shown on the board the wolf runs on
}
/** v0.19d2: EXP per tick of all finished EXP generators of a player (before High Voltage). */
function expGenBase(p) {
  let base = 0;
  for (const t of p.towers) base += t.completed ? obj(t.typeId)?.woodIncome || 0 : 0;
  return base;
}
/** v0.19d2: EXP generators pay their full amount every 4 s (v0.24oF; was 5 s) (before: once per round); each one reports its share for a pop-up over it. */
function expGenTick(game) {
  for (const p of game.players) {
    if (p.out) continue;
    const volt = 1 + VOLTAGE.bonus * perkLevel(p, "voltage"),
      gens = [];
    let exp = 0;
    for (const t of p.towers) {
      const w = t.completed ? obj(t.typeId)?.woodIncome || 0 : 0;
      if (!w) continue;
      const e = w * volt; // v0.24oF: the flat 25 % bonus (v0.17c) is gone
      exp += e;
      gens.push({ towerId: t.id, x: t.x, y: t.y, exp: e });
    }
    if (!gens.length) continue;
    gainExp(game, p, exp, "generators");
    emit(game, "expGen", { player: p.id, exp, gens });
  }
}
function incomeTick(game) {
  game.warmup = false;
  game.round++;
  missionRound(game); // v0.17
  missionAux(game); // v0.26
  if (game.waves && game.round >= WAVE_FIRST_ROUND && (game.round - WAVE_FIRST_ROUND) % WAVE_EVERY_ROUNDS === 0)
    launchWave(game, (game.round - WAVE_FIRST_ROUND) / WAVE_EVERY_ROUNDS + 1);
  game.incomeCounter++;
  game.incomeRemaining += game.incomeInterval;
  if (game.players.length > 2 && game.rotation !== false && !game.teams && game.round > 1 && (game.round - 1) % ROTATE_ROUNDS === 0)
    emit(game, "rotate", { targets: game.players.map((q) => (q.out ? -1 : targetOf(game, q.id).id)) });
  for (const p of game.players) {
    if (p.out) continue;
    openLocks(game, p); // v0.15
    tickQuestRound(game, p); // v0.15
    // v0.19a1: Magic Bank: 5 % interest per level on the idle gold at the start of the round (at most 50k)
    const bank = perkLevel(p, "bank"); // v0.21: a perk now
    if (bank) {
      const interest = Math.min(BANK.cap, Math.floor(Math.max(0, p.gold) * bankRate(bank))); // v0.24i
      if (interest > 0) {
        p.gold += interest;
        p.stats.goldEarned += interest;
        emit(game, "interest", { player: p.id, gold: interest });
      }
    }
    if (perkLevel(p, "wolves")) spawnSpiritWolves(game, p, perkLevel(p, "wolves")); // v0.19a1; v0.21: a perk now
    const paid = incomeShare(game, p); // v0.20: teams share their income evenly
    p.gold += paid;
    p.stats.goldEarned += paid;
    (p.stats.incomeLog ||= []).push(paid); // v0.14: income paid in this round
    // v0.19d2: EXP generators pay on their own 5 s clock (expGenTick); the rest of the EXP per round (Ghouls) stays here
    const volt = 1 + VOLTAGE.bonus * perkLevel(p, "voltage"), // v0.10r: High Voltage
      expRound = Math.max(0, p.woodIncome - expGenBase(p)) * volt;
    if (expRound > 0) gainExp(game, p, expRound, "ghoul");
    emit(game, "income", { player: p.id, gold: paid, exp: expRound, gens: [] });
  }
  game.expGenRemaining = EXP_GEN_EVERY; // v0.19d2: a generator tick at the start of every round, then every 4 s
  expGenTick(game);
  if (game.round >= RULES.suddenDeathRound && isShowdownMatch(game)) {
    showdownRound(game);
    return;
  }
  if (game.round >= RULES.suddenDeathRound) {
    if (!game.suddenDeath) {
      game.suddenDeath = true;
      emit(game, "suddenDeath");
    }
    for (const p of game.players) {
      if (p.out) continue;
      if (game.teams && game.players.some((q) => !q.out && q.team === p.team && q.id < p.id)) continue; // v0.20: once per team
      if (p.lives > 5) {
        p.lives--;
        gainExp(game, p, 25, "suddenDeath");
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
          gainExp(game, p, wood, "suddenDeath");
        }
    }
  }
}
/** v0.27zzlF: Showdown – only ranked 1v1 matches (app sets game.ranked before the first tick; not Ranked FFA). */
export const isShowdownMatch = (game) => !!game.ranked && !game.rankedFfa && game.players.length === 2 && !game.teams;
/**
 * v0.27zzlF: Showdown (ranked 1v1, from round 120 instead of the sudden death): at the end of every round each player
 * loses 1 life, no floor. "showdown" once (skull splat, sinister light), "showdownLife" per lost life (skull at the
 * finish line). Both lives at 0 in the same round: the player whose creeps broke through more often wins (then fewer
 * neutral-wave leaks taken, then seat 0 – never a draw).
 */
function showdownRound(game) {
  if (!game.showdown) {
    game.showdown = true;
    game.suddenDeath = true;
    emit(game, "showdown");
  }
  const alive = game.players.filter((p) => !p.out);
  for (const p of alive) {
    p.lives = Math.max(0, p.lives - 1);
    gainExp(game, p, 25, "suddenDeath");
    const at = exitPos(game, p, (game.grid.cols - 1) / 2); // the middle of the finish line
    emit(game, "showdownLife", { player: p.id, lives: p.lives, x: at.x, y: at.y });
  }
  const dead = alive.filter((p) => p.lives <= 0);
  if (!dead.length || !game.running) return;
  if (dead.length === 1) return defeat(game, dead[0]);
  // the loser: fewer breaches in the opponent's lane, then more neutral-wave leaks taken, then the higher seat
  const [loser] = [...dead].sort((a, b) => (a.stats.leaks || 0) - (b.stats.leaks || 0) || (b.stats.waveLeaks || 0) - (a.stats.waveLeaks || 0) || b.id - a.id);
  defeat(game, loser);
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
  normal: Object.freeze({ interval: 14 }), // v0.24k: 20 → 14
  hard: Object.freeze({ interval: 10, minTowers: 4, towerGrowth: 0.34, upgradeEager: true }),
  insane: Object.freeze({ interval: 5, minTowers: 4, towerGrowth: 0.34, upgradeEager: true }), // v0.22b: adaptive, reads the opponent's style
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
const AI_WAVE_SAFETY = { veryEasy: 0.9, easy: 0.6, normal: 1, hard: 1.35, insane: 1.35 };
function waveDefense(game, p) {
  if (!game.waves) return { gap: 0, flying: false, airTowers: true };
  const level = aiLevel(game, p),
    info = nextWave(game),
    alive = p.creeps.filter((c) => c.owner < 0);
  if (!info) return { gap: 0, flying: false, airTowers: true };
  const spec = WAVE_TYPES[info.type],
    lead = obj(info.groups?.[0]?.model), // v0.18a: real creeps
    defenseType = lead?.defenseType || spec.defense || (info.flying ? "small" : "medium"),
    armor = damageMultiplier("normal", "medium") / damageMultiplier("normal", "medium", info.armor, AI_ARMOR_HIT); // v0.27lF: flat armor against a typical hit
  const total = info.hp * info.count * (spec.split ? 1.76 : 1) * armor + alive.reduce((sum, c) => sum + c.hp, 0);
  const speed = (lead?.speed || 240 * (spec.speed || 1)) * movementMultiplier(game),
    cells = info.flying ? laneRows(game, p) : Math.max(laneRows(game, p), p.path.length),
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
  return { gap: Math.max(groundGap, airGap), groundGap, airGap, flying: flyingShare > 0, airTowers: airDps > 0, total, count: info.count + alive.length, flyingShare, seconds: info.seconds };
}
// ---- AI (v0.06) ---------------------------------------------------------------------------
// Economy first: the bot keeps as few towers as it can, spends on defence only while the
// creeps the opponent actually sends (plus the next neutral wave) outgrow its kill capacity,
// and otherwise invests in income sends. It saves for pushes now and then, prefers flyers
// when the opponent has little anti-air, and plays every match a little differently: each
// AI player rolls a personality from the game seed. Everything goes through `command`.
const AI_SAFETY = { veryEasy: 0.6, easy: 0.85, normal: 1.2, hard: 1.45, insane: 1.45 }; // v0.16k: very easy 1.45 → 0.6
// How the difficulty plays: share of decisions that follow the maze plan, how noisy tower
// placement is, and persona multipliers. Very easy turtles: it overbuilds, sends little and late.
const AI_STYLE = {
  veryEasy: { strict: 0.35, noise: 0.8, turtle: 0.6, maxSends: 1, persona: { greed: 0.3, push: 0, bossRound: 2.2, expGen: 0, upgradeBias: 0.5, smartPush: 0 } }, // v0.16k: weaker
  easy: { strict: 0.75, noise: 0.35, persona: { greed: 0.85, push: 0.5, bossRound: 1.3 } },
  // v0.24k: Normal sits between Easy and Hard (100 games: beats Easy 92 %, wins 22 % against Hard; was 80 % / 8 %):
  // more send greed, less placement noise and data-based perk picks at half Hard's weight
  normal: { strict: 1, noise: 0.05, fixed: { airEval: 1, splashTop: 1, smartPerks: 1 }, ranges: { greed: [1.4, 2.0] } }, // v0.22m2: splashTop: area damage counts most in the top rows // v0.22g: rates the opponent's anti-air before sending flyers
  // Hard (v0.07m): its own ranges from about 1,000 hard-vs-hard games (two random searches over
  // every trait, then checks: 70 % wins against the old ranges, 54 % against the first draft).
  // Area damage pays on the long template routes; the bot keeps a slim safety margin, sends
  // more, pushes rarely and briefly, reads the opponent's saved gold as a coming push, holds
  // more of each neutral wave and goes for the kill when the opponent runs low on lives.
  hard: {
    strict: 1,
    noise: 0,
    fixed: { smartPerks: 2, airEval: 1, airAura: 0.6, airLearn: 1, splashTop: 1 }, // v0.21v: data-based perk and element picks (see PERK_EDGE); v0.22g: air evaluation, aura escort, learns from air waves
    vsHuman: { waveTiming: 8, saveMore: 2, adaptive: 1, speedAware: 1 }, // v0.21v: against a human: pushes wait for the neutral wave, more saved-up waves; v0.22z2: and Hard reads the human's style like Hardo
    ranges: {
      greed: [1.8, 2.4], // v0.24i (was 1.7–2.3)
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
// v0.22b: Insane plays like Hard and adapts its persona to the opponent's style every few seconds (see adaptPersona)
AI_STYLE.insane = { ...AI_STYLE.hard, fixed: { ...AI_STYLE.hard.fixed, adaptive: 1, speedAware: 1, bossRush: 0 } };
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
/**
 * v0.25l: Hardo's trained styles (persona traits from self-play). One is picked per match by the seed; the style id is
 * recorded with the match. archer-opener is listed twice, so it comes up twice as often.
 */
const HARDO_STYLES = Object.freeze([
  { id: "archer-opener", p: { greed: 2.486, splash: 1.228, push: 0.228, pushSize: 2.346, pushMargin: 1.704, bossRound: 5.075, expGen: 1.04, upgradeBias: 0.921, caution: 1.17, rateShare: 0.226, waveShare: 0.534, airThreshold: 0.18, researchBias: 1.404, flyerBias: 1.186, mazeRush: 0.344, mazeValue: 0.888, bankWatch: 0.805, killShot: 6.135, sendPick: 1.856, rowAware: 2, opener: 1 } },
  { id: "archer-opener", p: { greed: 2.486, splash: 1.228, push: 0.228, pushSize: 2.346, pushMargin: 1.704, bossRound: 5.075, expGen: 1.04, upgradeBias: 0.921, caution: 1.17, rateShare: 0.226, waveShare: 0.534, airThreshold: 0.18, researchBias: 1.404, flyerBias: 1.186, mazeRush: 0.344, mazeValue: 0.888, bankWatch: 0.805, killShot: 6.135, sendPick: 1.856, rowAware: 2, opener: 1 } },
  { id: "economy", p: { greed: 3.374, splash: 1.966, push: 0.076, pushSize: 1.126, pushMargin: 1.258, bossRound: 6.646, expGen: 1.175, upgradeBias: 1.295, caution: 1.183, rateShare: 0.29, waveShare: 0.45, airThreshold: 0.159, researchBias: 1.248, flyerBias: 1.294, mazeRush: 0.181, mazeValue: 1.079, bankWatch: 0.647, killShot: 8.03, sendPick: 1.063 } },
  { id: "pressure", p: { greed: 2.486, splash: 1.228, push: 0.228, pushSize: 2.346, pushMargin: 1.704, bossRound: 5.075, expGen: 1.04, upgradeBias: 0.921, caution: 1.17, rateShare: 0.226, waveShare: 0.534, airThreshold: 0.18, researchBias: 1.404, flyerBias: 1.186, mazeRush: 0.344, mazeValue: 0.888, bankWatch: 0.805, killShot: 6.135, sendPick: 1.856 } },
]);
function aiPersonality(game, p) {
  if (p.aiPersona) return p.aiPersona;
  const roll = ([a, b]) => a + (b - a) * random(game);
  // the hard bot rolls inside its own ranges (v0.07m, from hard-vs-hard self-play)
  const ranges = aiTuning === AI_DEFAULTS && AI_STYLE[aiLevel(game, p)]?.ranges ? { ...aiTuning, ...AI_STYLE[aiLevel(game, p)].ranges } : aiTuning;
  p.aiPersona = Object.fromEntries(Object.entries(ranges).map(([k, range]) => [k, roll(range)]));
  // v0.24j: Fisher–Yates with the game's own dice (a random sort comparator depends on the browser's sort and is biased)
  const order = FACTIONS.map((f) => f.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random(game) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  p.aiPersona.elementOrder = order;
  for (const [k, f] of Object.entries(AI_STYLE[aiLevel(game, p)]?.persona || {})) p.aiPersona[k] *= f;
  Object.assign(p.aiPersona, AI_STYLE[aiLevel(game, p)]?.fixed || {}); // v0.21v: fixed traits, no dice roll
  if (p.rules?.persona) Object.assign(p.aiPersona, p.rules.persona); // v0.17: mission personality
  // v0.25l: Hardo plays one of his trained styles per match (picked by the seed, recorded with the match)
  else if (aiLevel(game, p) === "insane") {
    const style = HARDO_STYLES[game.seed % HARDO_STYLES.length];
    p.hardoStyle = style.id;
    Object.assign(p.aiPersona, style.p);
  }
  return p.aiPersona;
}
/**
 * v0.22zc2: gold a human keeps banking round after round (Magic Bank interest, saving for tiers) is economy, not a
 * coming push: after 2 idle rounds Hardo trusts it 15 % less per round, down to 25 % (game 3 of 19.10.: 14k gold
 * into towers against a banked pile that never came while its income stalled at 560–1,100).
 */
function bankTrust(game, p, a, persona) {
  if (!persona?.adaptive || !persona.humanFoe) return 1;
  const tr = ((p.aiBankTrack ||= {})[a.id] ||= { round: game.round, gold: a.gold, idle: 0 });
  if (game.round !== tr.round) {
    tr.idle = a.gold >= tr.gold * 0.7 ? tr.idle + 1 : 0;
    tr.gold = a.gold;
    tr.round = game.round;
  }
  return clamp(1 - 0.15 * Math.max(0, tr.idle - 2), 0.25, 1);
}
/** v0.22u2: gold an opponent banks right below its next boss is mostly the boss (one creep), not a push. */
function bankedGold(a, persona) {
  if (!persona?.adaptive || !persona.humanFoe || !AI_ADAPT.bossBank) return a.gold; // v0.22z2: humans only
  const boss = tierSends(a.tier).find((s) => s.bossTier && !a.bossBought?.[s.id] && a.tier < s.bossTier);
  if (!boss || a.income < boss.cost * 0.2 || a.gold < boss.cost * 0.6 || a.gold > boss.cost * 1.3) return a.gold;
  return Math.max(0, a.gold - boss.cost) + boss.cost * 0.25;
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
    } else if (inRange(game, centre, node, stats.range + cu * 0.15)) n++; // v0.23: inRange
  }
  return n;
}
const isSplashTower = (item) => !!item && (isCannonTower(item) || item.splashFull > 0 || item.splashMedium > 0 || item.splashSmall > 0);
/**
 * v0.22m2: Normal, Hard and Hardo know that area damage pays near the spawn: creeps come out of the portals
 * in a tight pack and spread out on the way down. Measured in bot games: cannons hit 3.1 creeps per shot in the
 * top row, 2.1 in the middle, 1.9 at the bottom. The curve keeps the old average (×1.8): top ×2.4, bottom ×1.55.
 * splashView is set at the start of think() for the bot whose turn it is; other bots keep the flat ×1.8.
 */
let splashView = 0,
  crowdView = 1, // v0.22u2: Hardo scales the splash bonus by how many creeps the opponent really sends (few big tier-3 creeps: little splash)
  rowView = 0; // v0.25l: persona.rowAware – value towers by row (melee splash near the spawn, ranged lower down)
/** Measured splash curve over the rows, scaled to an average of 1 (top row ×1.3, bottom ×0.86). */
const splashShape = (game, y) => (1.9 + 1.2 * (1 - Math.min(1, y / baseRows(game))) ** 3) / 2.2; // v0.24r: shape of a fresh maze
/**
 * v0.27zzkF: the bot's own-defence estimate overrated long-range towers (Hall of Storm range 900, Bouncing Shot 650 rated as
 * area splash on top of its bounce): Storm bots rated their lane at almost twice its real strength, built too little and lost
 * 73 % of their Storm starts. Range capped at 450 in the estimate, Bouncing Shot ×1.2: Storm losses 11 %, bot strength unchanged.
 */
const AI_RANGE_CAP = 450,
  AI_BOUNCE_FACTOR = 1.2;
function splashFactor(game, item, y, size, air = false) {
  if (item?.weapon === "mbounce") return AI_BOUNCE_FACTOR; // v0.27zzkF: bouncing missiles are not area splash
  if (rowView && !air && splashView === 1) {
    const depth = Math.min(1, Math.max(0, (y + size / 2) / baseRows(game))),
      melee = isMeleeTower(item),
      splash = item.splashFull > 0 || item.splashMedium > 0 || item.splashSmall > 0;
    if (melee && splash) return 1 + ((y + size / 2 < 3 ? 2.4 : 1.3) - 1) * crowdView;
    if (isSplashTower(item)) return 1 + (0.8 + 1.8 * (1 - depth) ** 2 - 1) * crowdView;
    return melee ? 1 : 0.9 + 0.4 * depth;
  }
  if (!isSplashTower(item)) return 1;
  if (splashView !== 1 || air) return 1 + 0.8 * crowdView;
  return 1 + (1.8 * splashShape(game, y + size / 2) - 1) * crowdView;
}
/** Damage one creep takes while it passes this tower once (ground or air). */
function towerPassDamage(game, p, item, x, y, size, path, air = false) {
  if (!item?.attacks || !item.targets.includes(air ? "air" : "ground")) return 0;
  const stats = statsFor(game, p, item),
    dps = stats.damage / Math.max(0.1, stats.cooldown),
    splash = splashFactor(game, item, y, size, air),
    // v0.27zzkF: the reach counts at most AI_RANGE_CAP: a single-target tower cannot hit every creep in a long range at once
    secs = (reachOn(game, item, stats.range > AI_RANGE_CAP ? { ...stats, range: AI_RANGE_CAP } : stats, x, y, size, path) * game.grid.cellUnits) / (240 * movementMultiplier(game));
  return dps * splash * secs;
}
/** Flyers cross straight down the column they spawn in; any column is equally likely. */
const airPathOf = (game, rows = baseRows(game)) => Array.from({ length: rows }, (_, y) => pos(game, Math.floor(game.grid.cols / 2), y));
// v0.23: the flyer columns of a board, made once per game (pos() only depends on the grid; never changed by a caller);
// v0.24r: per maze length
const AIR_COLUMNS = new WeakMap();
function airColumns(game, rows = baseRows(game)) {
  let byRows = AIR_COLUMNS.get(game);
  if (!byRows) AIR_COLUMNS.set(game, (byRows = new Map()));
  let list = byRows.get(rows);
  if (!list) {
    const { cols } = game.grid;
    list = Array.from({ length: cols }, (_, c) => Array.from({ length: rows }, (_, r) => pos(game, c, r)));
    byRows.set(rows, list);
  }
  return list;
}
function airPass(game, p, item, x, y, size) {
  const { cols } = game.grid,
    columns = airColumns(game, laneRows(game, p)); // v0.23
  let sum = 0;
  for (let c = 0; c < cols; c++) sum += towerPassDamage(game, p, item, x, y, size, columns[c], true);
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
// v0.23: the routes without extra cells only depend on the tower fields: kept per player until a tower is
// built, sold, moved or removed (WeakMap, never saved; callers only read the routes)
const SPAWN_ROUTES = new WeakMap();
const towerLayout = (p) => {
  const out = [];
  for (const t of p.towers) out.push(t.gridX, t.gridY, towerSize(t));
  return out;
};
function sameList(a, b) {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function spawnRoutes(game, p, extra = null) {
  if (!extra) {
    const layout = towerLayout(p),
      hit = SPAWN_ROUTES.get(p);
    if (hit && hit.game === game && sameList(hit.layout, layout)) return hit.routes;
    const routes = spawnRoutesRaw(game, p, null);
    if (routes[0] !== p.path) SPAWN_ROUTES.set(p, { game, layout, routes }); // the [p.path] fallback is not kept
    return routes;
  }
  return spawnRoutesRaw(game, p, extra);
}
function spawnRoutesRaw(game, p, extra = null) {
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
// v0.23: laneCapacity is asked for several times per bot turn (own lane and the opponent's) and the towers seldom
// change in between: the result is kept per player and handed out again while every input is the same: the game,
// the path and route arrays (never changed in place), the bot view (splashView, crowdView), every tower's type,
// field and size, and the stats object statsFor returns for it (the same object while its inputs are unchanged).
// Up to 4 entries per player (own and opponent's view); WeakMap, never saved or sent.
const LANE_CAPACITY = new WeakMap();
function laneCapacity(game, p, path = p.path, routes = null) {
  const towers = [];
  for (const t of p.towers) {
    const item = obj(t.typeId);
    towers.push(t.typeId, t.gridX, t.gridY, towerSize(t), item?.attacks ? statsFor(game, p, item) : null);
  }
  let list = LANE_CAPACITY.get(p);
  if (!list) LANE_CAPACITY.set(p, (list = []));
  for (const e of list)
    if (e.game === game && e.path === path && e.routes === routes && e.splash === splashView && e.crowd === crowdView && sameList(e.towers, towers))
      return { ground: e.ground, air: e.air };
  const { ground, air } = laneCapacityRaw(game, p, path, routes);
  if (list.length >= 4) list.shift();
  list.push({ game, path, routes, splash: splashView, crowd: crowdView, towers, ground, air });
  return { ground, air };
}
function laneCapacityRaw(game, p, path = p.path, routes = null) {
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
function observeEnemy(game, p, persona = p.aiPersona) {
  const seen = (p.aiSeen ||= { hp: 0, air: 0, rate: 0, airRate: 0, burst: 0, airBurst: 0, roundStart: game.tick }),
    // v0.22b: Felito Hardo counts fast creeps heavier: towers get less time for them (Raider pushes broke it in game 1)
    fast = persona?.speedAware ? 240 * movementMultiplier(game) : 0,
    // v0.22l: every creep costs at least one shot: a swarm of 2-HP Goblins eats far more tower time than its HP
    floor = persona?.speedAware ? shotFloor(game, p) : 0;
  let fresh = 0,
    freshAir = 0;
  for (const c of p.creeps)
    if (c.owner >= 0 && c.owner !== p.id && !c.aiSeen) {
      c.aiSeen = true;
      if (c.laps) continue;
      const hp = (fast && !c.flying ? c.maxHp * clamp((c.baseSpeed || c.speed || fast) / fast, 1, 2.5) : c.maxHp) + (floor > c.maxHp ? floor - c.maxHp : 0);
      seen.hp += hp;
      fresh += c.flying ? 0 : hp;
      if (!c.flying) seen.n = (seen.n || 0) + 1;
      if (c.flying) {
        seen.air += c.maxHp;
        freshAir += c.maxHp;
        p.aiAirSeenAt = game.round; // v0.27zzjF: the opponent really sends air (for AIR_GATED)
      }
    }
  seen.burst = Math.max(seen.burst * 0.97, fresh);
  seen.airBurst = Math.max(seen.airBurst * 0.97, freshAir);
  const roundTicks = Math.round(game.incomeInterval / TICK);
  if (game.tick - seen.roundStart >= roundTicks) {
    seen.rate = seen.rate * 0.55 + seen.hp * 0.45;
    seen.nRate = (seen.nRate ?? AI_ADAPT.crowdCount) * 0.55 + (seen.n || 0) * 0.45; // v0.22u2: ground creeps per round
    seen.n = 0;
    seen.airRate = seen.airRate * 0.55 + seen.air * 0.45;
    seen.hp = 0;
    seen.air = 0;
    seen.roundStart = game.tick;
  }
  return seen;
}
/**
 * v0.21v: perk and element edges from 155 hard-vs-hard games (18.10.): win rate when the bot took a
 * perk minus when it skipped the same offer, shrunk against noise (−1 … +1). The hard bot weighs its
 * picks with them twice over (persona.smartPerks = 2): 73 % wins against the old hard bot in 128 games.
 * v0.22zi1: recalibrated from 1,048 hard players (20.10., v0.22zh1): new perks rated, Arcane Burst, Water Block,
 * Frozen Ground and Heavy Nobility toned down; elements from the start-element win rates. 57.5 % against the old table (80 games).
 */
const PERK_EDGE = {"agolem": 0.39, "heavy": 0.16, "tailwind": 0.3, "pillar": 0.13, "permafrost": 0.08, "supergrowth": 0.05, "guardian": 0.06, "burst": -0.02, "nobility": 0.06, "mind": 0.03, "waterblock": 0, "crowd": 0.06, "hellfire": 0.1, "evolution": 0.11, "pillage": 0.14, "leadership": 0.04, "owl": 0.04, "volley": 0.05, "novice": 0.02, "feudal": 0.02, "monsun": 0.07, "fireblock": 0.04, "golem": -0.04, "exhume": 0.02, "bank": -0.04, "recruit": -0.12, "militia": -0.05, "treasure": -0.02, "boots": 0.01, "firearrows": -0.06, "slave": -0.09, "pocks": -0.08, "forge": -0.25, "breeding": -0.03, "wolves": -0.08, "archery": -0.4, "airblock": -0.3, "summon": 0.01, "synthesizer": -0.3, "voltage": -0.08, "frenzy": -0.12, "gold": -0.05, "scholar": 0.07, "gunpowder": 0.03, "carmor": 0, "wings": -0.01, "manufacture": -0.02, "stormfeathers": -0.03, "medicine": -0.04, "hills": -0.06, "melee": -0.08};
const ELEMENT_EDGE = {"earth": -0.38, "storm": -0.57, "fire": 0.68, "plague": -0.09, "arcane": 0.8, "water": -0.24};
function aiPick(game, p, persona) {
  const pick = p.picks[0],
    score = (o) => {
      const base = scoreRaw(o),
        edge = o.type === "element" ? ELEMENT_EDGE[o.id] : o.type === "perk" ? PERK_EDGE[o.id] : undefined;
      if (!(persona.smartPerks > 0) || edge === undefined) return base;
      return o.type === "element" ? base + persona.smartPerks * edge * 4 : base * Math.max(0.15, 1 + persona.smartPerks * edge);
    },
    scoreRaw = (o) => {
      // Self-play: storm and arcane win most often for the bot; the order still varies per match.
      if (o.type === "element") return 10 - persona.elementOrder.indexOf(o.id) + (persona.smartElements ? ((persona.newElements ?? 1) ? ELEMENT_BONUS_NEW : ELEMENT_BONUS)[o.id] || 0 : 0);
      if (o.type === "income") return (game.round < 30 ? 6 : 2) * o.amount + random(game);
      if (o.type === "gold") return o.amount / 40 + random(game);
      if (o.type === "lives") return p.lives < 12 ? 9 : 1 + random(game);
      // v0.26eF: Amnesia: forget the perk the data rates worst, higher levels give more rewards
      if (o.type === "forget") return perkLevel(p, o.id) - 6 * (PERK_EDGE[o.id] ?? 0) + random(game);
      // v0.12: perks the bot can hardly use rank low
      if (o.type === "perk" && o.id === "fort") return 0.5 + random(game);
      // v0.23b: conditionalPerk: only when the condition holds, or holds after selling at most COND_SELL_MAX towers
      if (o.type === "perk" && CONDITIONAL_PERKS[o.id]) {
        const cost = CONDITIONAL_PERKS[o.id].cost(game, p, 1);
        return cost === 0 ? (5 + random(game) * 2) * (persona.researchBias ?? 1) : cost <= COND_SELL_MAX ? 2.5 + random(game) : 0.2 + random(game) * 0.2;
      }
      if (o.type === "perk" && ["quarry", "sanction"].includes(o.id)) return 0.8 + random(game); // v0.18h: the bot's mazes rarely fit these
      if (o.type === "quest") return 1 + random(game) * 2; // v0.15: the bot rarely takes quests
      if (o.type === "perk" && o.id === "autoloader") return (6 + random(game) * 2) * (persona.researchBias ?? 1); // v0.22g1: a tower boost like Heavy Weapons
      // v0.21: the former upgrades keep their old weight (tower boosts 6, the rest 4, times the persona's bias)
      // v0.22u2: Hardo skips a line perk for a line it does not build (game 1: Melee Protocol twice, no melee tower)
      if (persona.adaptive && o.type === "perk" && o.id === "melee" && !p.towers.some((t) => isMeleeTower(obj(t.typeId)))) return 1 + random(game);
      if (o.type === "perk" && Object.values(RESEARCH_PERKS).includes(o.id)) return ((["melee", "frenzy", "heavy", "firearrows"].includes(o.id) ? 6 : 4) + random(game) * 2) * (persona.researchBias ?? 1);
      return (4 + random(game) * 2) * (persona.researchBias ?? 1);
    };
  // v0.19b3: the very easy bot picks at random, but likes Quarry 50 % more than any other reward
  const lucky = () => {
    const weight = (o) => (o.type === "perk" && o.id === "quarry" ? STONE_LOVE : 1);
    let roll = random(game) * pick.options.reduce((sum, o) => sum + weight(o), 0);
    for (let i = 0; i < pick.options.length; i++) if ((roll -= weight(pick.options[i])) < 0) return i;
    return pick.options.length - 1;
  };
  // v0.21v: the start element is random, preferring one no other player started with
  const els = pick.options.map((o, i) => [o, i]).filter(([o]) => o.type === "element");
  if (!p.faction && els.length && !p.rules?.persona?.elementOrder) { // missions keep their fixed element order
    const taken = new Set(game.players.filter((q) => q !== p && q.faction).map((q) => q.faction)),
      free = els.filter(([o]) => !taken.has(o.id)),
      pool = free.length ? free : els;
    command(game, { type: "pick", player: p.id, index: pool[Math.floor(random(game) * pool.length)][1] });
    return;
  }
  const best =
    aiLevel(game, p) === "veryEasy"
      ? lucky()
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
/**
 * v0.27zziF: Hall of Elements in the bot maze. From tier 2 the maze grows by 3 rows; each template gets an
 * extension found offline (exhaustive search over one 2×2 hall plus up to 8 towers in rows 8–11): the hall sits in
 * the middle of the new rows, one or two towers turn the route around it. A: route 33.8 → 37.8 (+3 for the new rows,
 * +4 from the hall design); a full tower wall there gives +6 but needs 6 towers instead of hall + 2. Indexed like
 * MAZE_TEMPLATES["6x9"]; `hall` = top-left field, `order` = towers after the hall, `curve` = route after each of
 * them (on the 9-row scale like the template curves).
 */
const HALL_EXT = {
  "6x9": [
    { hall: "2,10", order: "1,9 4,11", curve: [36.83, 37.83] },
    { hall: "2,10", order: "4,9 1,11", curve: [35.83, 36.83] },
    { hall: "2,10", order: "1,9 4,11", curve: [35.83, 36.83] },
    { hall: "3,10", order: "0,11 1,11 2,11 1,9", curve: [34.5, 35.5, 38.5, 40.5] },
    { hall: "2,10", order: "4,9 1,11", curve: [36.5, 37.5] },
    { hall: "2,10", order: "1,9 4,11", curve: [36.5, 37.5] },
    { hall: "2,10", order: "1,9 4,11", curve: [36.5, 37.5] },
  ],
};
// v0.27zziF: which bots put a hall into their maze: Easy, Normal and Hard always, Hardo in half of its matches
// (rolled per match); Very Easy keeps its fun mazes (two of them have a hall)
const HALL_MAZE = { easy: 1, normal: 1, hard: 1, insane: 0.5 };
const HALL_ID = "h05L";
/**
 * v0.27zziF: early halls. Three quarters of the hall bots play a maze with the hall in it from tier 1 (found offline by
 * simulated annealing: one 2×2 hall + 18 towers; the hall at the top reaches 33.5 like the best plain templates with
 * 20 towers, a hall in the middle 31.5). The hall goes down once `step` towers of the order stand. The others
 * build it when the maze grows (HALL_EXT).
 */
const HALL_EARLY = 0.75; // early halls won 69 % against no hall (35 Hard games; late halls 52 %)
const HALL_TEMPLATES = {
  "6x9": [
    { weight: 2, hall: "1,0", step: 4, order: "3,0 4,0 5,0 0,4 1,4 2,4 3,3 4,2 1,2 5,8 4,8 3,8 2,7 1,6 3,5 4,6 5,4 0,8", curve: [10.17, 10.33, 11, 13.5, 14.5, 15.5, 16.5, 19.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5, 28.5, 30.5, 32.5, 33.5] },
    { weight: 1, hall: "3,2", step: 4, order: "2,4 1,4 0,4 5,8 4,8 5,0 4,0 3,0 2,0 1,1 1,2 3,8 2,7 1,6 3,5 4,6 0,8 4,5", curve: [10.17, 10.33, 11, 13.5, 14.5, 14.83, 15.5, 16.5, 17.83, 21.5, 23.5, 24.5, 25.5, 26.5, 28.5, 30.5, 31.5, 31.5] },
  ],
};
/**
 * v0.27zziF: late halls may move up: in templates D and F a hall on the top row costs no route (it covers two
 * template towers). When the maze grows and those two towers are cheap, the bot sells them and builds the hall there,
 * where the creeps come in packed, instead of at the bottom.
 */
const HALL_UPPER = { "6x9": { 4: "3,0", 6: "1,0" } };
const HALL_SELL_MAX = 400; // gold the towers on the upper spot may have cost at most
/** v0.27zziF: the hall extension of a template plan once the maze has grown (tier 2), mirrored like the plan. */
function hallExt(game, p, maze) {
  if (!maze?.hallExt || laneRows(game, p) < maze.rows + 3) return null;
  const ext = HALL_EXT[game.grid.cols + "x" + maze.rows]?.[maze.hallExt.tpl];
  if (!ext) return null;
  const cols = game.grid.cols,
    cell = (k, w = 1) => {
      let [x, y] = k.split(",").map(Number);
      if (maze.hallExt.mirror) x = cols - w - x;
      return { x, y, key: x + "," + y };
    },
    hall = cell(ext.hall, 2);
  return { hall, order: ext.order.split(" ").map((k) => cell(k)), curve: ext.curve, cells: [0, 1].flatMap((dy) => [0, 1].map((dx) => hall.x + dx + "," + (hall.y + dy))) };
}
const hasHall = (p) => p.towers.some((t) => obj(t.typeId)?.isHall);
const hallCells = (h) => [0, 1].flatMap((dy) => [0, 1].map((dx) => h.x + dx + "," + (h.y + dy)));
/** v0.27zziF: fields kept free for the planned hall while it is not built yet. */
function hallReserved(game, p, maze) {
  if (!maze || hasHall(p)) return null;
  if (maze.hallAt) return new Set(hallCells(maze.hallAt)); // early hall: its fields stay free from the start
  const ext = hallExt(game, p, maze);
  return ext ? new Set(ext.cells) : null;
}
/** v0.27zziF: where the planned hall goes now (null = not yet), and which own towers must be sold for it. */
function hallSpotNow(game, p, maze) {
  if (!maze || hasHall(p)) return null;
  if (maze.hallAt) {
    const taken = takenCells(p),
      built = maze.order.filter((c) => taken.has(c.key)).length;
    return built >= (maze.hallStep || 0) ? { spot: maze.hallAt, sell: [] } : null;
  }
  const ext = hallExt(game, p, maze);
  if (!ext) return null;
  if (maze.hallUpper) {
    const cells = new Set(hallCells(maze.hallUpper)),
      on = p.towers.filter((t) => towerCells(t).some((c) => cells.has(c.x + "," + c.y)));
    const cheap = on.every((t) => !obj(t.typeId)?.isHall && t.typeId !== ROCK_ID && !(t.buildRemaining > EPS) && towerSize(t) === 1 && cells.has(t.gridX + "," + t.gridY)),
      spent = on.reduce((sum, t) => sum + (t.totalSpent || obj(t.typeId)?.cost || 0), 0);
    if (cheap && spent <= HALL_SELL_MAX) return { spot: maze.hallUpper, sell: on, fallback: ext.hall };
  }
  return { spot: ext.hall, sell: [] };
}
/** v0.27zziF: the planned build order and route curve, with the hall extension's towers once the maze has grown. */
function planOrder(game, p, maze) {
  let ext = maze?.template && !maze.fun ? hallExt(game, p, maze) : null;
  // the hall went elsewhere (moved up): the towers that turn the route around the bottom hall are not needed
  const hall = ext && p.towers.find((t) => obj(t.typeId)?.isHall);
  if (hall && (hall.gridX !== ext.hall.x || hall.gridY !== ext.hall.y)) ext = null;
  if (!ext) return { order: maze.order, curve: maze.curve, keys: maze.keys };
  return { order: maze.order.concat(ext.order), curve: maze.curve.concat(ext.curve), keys: new Set([...maze.keys, ...ext.order.map((c) => c.key), ...ext.cells]) };
}
/**
 * v0.27zziF: build the planned hall (it is not part of the 1×1 build order, and the template never places 2×2
 * buildings). On its planned fields if they are free, else on the 2×2 spot in the grown rows that keeps the route
 * longest. Returns true when it was built.
 */
function buildPlannedHall(game, p, maze) {
  const plan = hallSpotNow(game, p, maze);
  if (!plan) return false;
  const item = obj(HALL_ID);
  if (!item || !available(game, p.id, "build", HALL_ID).ok) return false;
  const ok = (x, y) => canBuild(game, p.id, x, y, HALL_ID).ok && !aiCondBlocks(game, p, x, y, HALL_ID) && previewBuild(game, p.id, x, y, HALL_ID).ok;
  // moving up: sell the cheap towers on the upper spot first (their gold comes back at the sell rate)
  if (plan.sell.length) {
    for (const t of plan.sell) command(game, { type: "sell", player: p.id, towerId: t.id });
    if (ok(plan.spot.x, plan.spot.y) && command(game, { type: "build", player: p.id, id: HALL_ID, gridX: plan.spot.x, gridY: plan.spot.y }).ok) return true;
    plan.spot = plan.fallback; // should not happen (the spot costs no route); the bottom spot then
  }
  let spot = plan.spot && ok(plan.spot.x, plan.spot.y) ? plan.spot : null;
  if (!spot && maze.hallAt) return false; // early hall: wait until its fields can take it
  if (!spot) {
    let best = -1;
    for (let y = maze.rows - 1; y <= laneRows(game, p) - 2; y++)
      for (let x = 0; x <= game.grid.cols - 2; x++) {
        if (!ok(x, y)) continue;
        const r = expectedRoute(game, p, [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }]);
        if (r > best) (best = r), (spot = { x, y });
      }
  }
  return !!spot && command(game, { type: "build", player: p.id, id: HALL_ID, gridX: spot.x, gridY: spot.y }).ok;
}
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
/** v0.16k: fun mazes for the very easy bot (6×9 board, x 0–5, y 0–8 from the portal down). */
const FUN_MAZES = [
  { name: "smiley", order: "1,2 4,2 2,4 3,4 0,5 5,5 1,6 2,6 3,6 4,6 0,0 5,0" },
  { name: "heart", order: "1,1 4,1 0,2 2,2 3,2 5,2 0,3 5,3 1,4 4,4 2,5 3,5" },
  { name: "pillars", order: "0,1 2,1 4,1 1,3 3,3 5,3 0,5 2,5 4,5 1,7 3,7 5,7" },
  { name: "lightning", order: "4,0 3,1 2,2 3,3 4,4 3,5 2,6 1,7 0,8 5,6" },
  { name: "towers", order: "0,0 0,1 0,2 5,6 5,7 5,8 2,3 3,3 2,4 3,4" },
  // v0.19f: typed mazes: every cell names its tower (A Archer, F Footman, B Bombard, G EXP generator,
  // O Ogre = Footman upgraded to Ogre, R Bird Hunter = Archer upgraded); `start` = what is built first
  { name: "fools-path", start: [["A", 4], ["B", 2]], layout: ["B--O-B", "B-O--B", "B----B", "A--O-A", "A----A", "A-O--A", "A----A", "A--R-A", "A-R--A"] },
  { name: "trichter", start: [["A", 4], ["B", 2]], layout: ["O----O", "BO--OB", "-BO---", "B---FB", "B--F-B", "A----A", "RA--AR", "AAF--A", "GGGF-G"] },
  { name: "checkmate", start: [["A", 6]], layout: ["O-O-O-", "-O-O-O", "R-R-R-", "-A-A-A", "A-A-A-", "-A-A-A", "A-A-A-", "-A-A-A", "A-A-A-"] },
  { name: "arrow-down", start: [["F", 4], ["A", 4]], layout: ["O-OO-O", "--OO--", "--OO--", "--OO--", "-BRRB-", "--BB--", "------", "AA--AA", "GA--AG"] },
  // H Hall of Elements (2×2), Q any tower; the swimming pool only for bots with Water, its Bird Hunters become Water Elementals
  { name: "swimming-pool", needs: "R01D", start: [["A", 4]], goals: { R: "h025" }, layout: ["FF--FF", "------", "-AAAA-", "-AHHA-", "-AHHA-", "-AAAA-", "------", "AR--RA", "AA--AA"] },
  { name: "rat-castle", start: [["A", 4], ["B", 2]], last: ["G"], layout: ["-O-BBR", "R--BBB", "-O----", "A-BFB-", "-HHAF-", "AHH-O-", "------", "-AAAAA", "-F-R--"] },
];
/** v0.19f: typed maze cells: what is built there first, and where its line has to end */
const TYPED_CELL = { A: { base: "h003", kind: "A" }, R: { base: "h003", kind: "A", goal: "h05B" }, F: { base: "h000", kind: "F" }, O: { base: "h000", kind: "F", goal: "h05A" }, B: { base: "h02R", kind: "B" }, G: { base: "h01F", kind: "G" }, H: { base: "h05L", kind: "H" } };
/** Build order of a typed maze: the `start` towers first (nearest the portal first), then row by row. */
function typedOrder(game, tpl, mirror) {
  const cols = game.grid.cols,
    cells = [];
  tpl.layout.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === "Q") ch = "AFB"[Math.floor(random(game) * 3)]; // any tower: rolled per match
      if (TYPED_CELL[ch]) cells.push({ x: mirror ? cols - 1 - x : x, y, type: ch, ...(tpl.goals?.[ch] ? { goal: tpl.goals[ch] } : {}) });
    }),
  );
  // the hall is one 2×2 building on its top-left field
  const hall = cells.filter((c) => c.type === "H");
  if (hall.length) {
    const hx = Math.min(...hall.map((c) => c.x)),
      hy = Math.min(...hall.map((c) => c.y));
    cells.splice(0, cells.length, ...cells.filter((c) => c.type !== "H" || (c.x === hx && c.y === hy)));
  }
  const shuffled = (list) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random(game) * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };
  // row by row from the portal, in a random order inside each row
  const rows = [];
  cells.forEach((c) => (rows[c.y] ||= []).push(c));
  const byRow = rows.filter(Boolean).flatMap((r) => shuffled(r)),
    order = [];
  for (const [kind, n] of tpl.start || []) {
    const pick = byRow.filter((c) => !order.includes(c) && TYPED_CELL[c.type].kind === kind).slice(0, n);
    order.push(...pick);
  }
  const rest = byRow.filter((c) => !order.includes(c)),
    late = (c) => (tpl.last || []).includes(TYPED_CELL[c.type].kind);
  return order.concat(rest.filter((c) => !late(c)), rest.filter(late));
}
function funMaze(game, wanted = null, p = null) {
  const { cols } = game.grid,
    rows = baseRows(game), // v0.24r: built for a fresh maze
    named = wanted && FUN_MAZES.find((m) => m.name === wanted),
    given = wanted && !named && /\d,\d/.test(wanted) ? { order: wanted } : named, // a name or an order of cells
    // v0.19f: mission tower rules would break a typed maze: those bots keep the plain shapes
    pool = FUN_MAZES.filter((m) => (!m.layout || !(p?.rules?.towers || p?.rules?.noAir)) && (!m.needs || p?.research?.[m.needs]));
  let order,
    typed = null;
  if (!given && random(game) < 0.25) {
    // pure chaos: a random scatter, new every match
    const cells = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.push({ x, y });
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(random(game) * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    order = cells.slice(0, 14);
  } else {
    const tpl = given || pool[Math.floor(random(game) * pool.length)],
      mirror = random(game) < 0.5;
    order = tpl.layout
      ? typedOrder(game, tpl, mirror)
      : tpl.order.split(" ").map((k) => {
          const [x, y] = k.split(",").map(Number);
          return { x: mirror ? cols - 1 - x : x, y };
        });
    if (tpl.layout) typed = tpl.name;
  }
  order = order.map((c) => ({ ...c, key: c.x + "," + c.y }));
  return { cols, rows, template: true, fun: true, typed, order, keys: new Set(order.map((c) => c.key)), curve: order.map(() => 10.2).concat([10.2]), gaps: [], wallOf: {}, cellsOf: [], extra: new Set(), size: order.length };
}
function templatePlan(game, forced = null) {
  const list = MAZE_TEMPLATES[game.grid.cols + "x" + baseRows(game)];
  if (!list) return null;
  let roll = random(game) * list.reduce((s, t) => s + t.weight, 0),
    tpl = list[list.length - 1];
  for (const t of list) if ((roll -= t.weight) < 0) { tpl = t; break; }
  if (forced !== null && list[forced]) tpl = list[forced]; // self-play hook (persona.mazeTpl)
  const tplIndex = list.indexOf(tpl); // v0.27zziF: for the hall extension
  const mirror = random(game) < 0.5,
    order = tpl.order.split(" ").map((k) => {
      let [x, y] = k.split(",").map(Number);
      if (mirror) x = game.grid.cols - 1 - x;
      return { x, y, key: x + "," + y };
    });
  return { cols: game.grid.cols, rows: baseRows(game), template: true, tplIndex, mirror, order, keys: new Set(order.map((c) => c.key)), curve: tpl.curve, gaps: [], wallOf: {}, cellsOf: [], extra: new Set(), size: order.length };
}
/** v0.27zziF: an early-hall template (see HALL_TEMPLATES): the plain build order plus the hall's field and step. */
function hallTemplatePlan(game) {
  const list = HALL_TEMPLATES[game.grid.cols + "x" + baseRows(game)];
  if (!list) return null;
  let roll = random(game) * list.reduce((s, t) => s + t.weight, 0),
    tpl = list[list.length - 1];
  for (const t of list) if ((roll -= t.weight) < 0) { tpl = t; break; }
  const cols = game.grid.cols,
    mirror = random(game) < 0.5,
    order = tpl.order.split(" ").map((k) => {
      let [x, y] = k.split(",").map(Number);
      if (mirror) x = cols - 1 - x;
      return { x, y, key: x + "," + y };
    });
  let [hx, hy] = tpl.hall.split(",").map(Number);
  if (mirror) hx = cols - 2 - hx;
  return { cols, rows: baseRows(game), template: true, tplIndex: -1 - list.indexOf(tpl), mirror, hallAt: { x: hx, y: hy }, hallStep: tpl.step, order, keys: new Set(order.map((c) => c.key)), curve: tpl.curve, gaps: [], wallOf: {}, cellsOf: [], extra: new Set(), size: order.length };
}
/**
 * The bot's maze. On the arena a template (see above); elsewhere, and for very easy, horizontal
 * walls whose single gap alternates sides, so creeps snake across the whole lane. Each match
 * rolls its template and mirror side, or where the first wall sits and which side its gap is on.
 */
function mazePlan(game, p, level) {
  // v0.24r: templates and fun mazes are made for a fresh maze, the generated plan for the player's current one
  if (p.aiMaze && p.aiMaze.cols === game.grid.cols && p.aiMaze.rows === (p.aiMaze.template || p.aiMaze.fun ? baseRows(game) : laneRows(game, p))) {
    // v0.10za: a saved or synced game turns the plan's Sets into {}; rebuild them instead of crashing.
    const m = p.aiMaze;
    if (m.extra instanceof Set && (!m.template || m.keys instanceof Set)) return m;
    if (m.template && Array.isArray(m.order)) {
      m.keys = new Set(m.order.map((c) => c.key));
      m.extra = new Set();
      return m;
    }
    p.aiMaze = null;
  }
  // v0.16k: very easy builds funny, chaotic mazes (a smiley, a heart, pillars, lightning, chaos)
  if (p.rules?.maze && game.grid.cols === 6 && baseRows(game) === 9) return (p.aiMaze = funMaze(game, p.rules.maze, p)); // v0.17: mission maze
  if (level === "veryEasy" && game.grid.cols === 6 && baseRows(game) === 9) return (p.aiMaze = funMaze(game, null, p));
  if (level !== "veryEasy" && (p.aiPersona?.mazeV2 ?? 1) > 0.5) {
    // v0.27zziF: a hall in the maze (missions with their own tower rules keep theirs); persona.hallMaze and
    // persona.hallEarly (self-play hooks) override the level's shares. Early: a hall template from tier 1;
    // late: a plain template, the hall when the maze grows (or on the top row, see HALL_UPPER)
    const share = p.aiPersona?.hallMaze ?? HALL_MAZE[level] ?? 0,
      hall = share > 0 && !p.rules?.towers && !!HALL_EXT[game.grid.cols + "x" + baseRows(game)] && (share >= 1 || random(game) < share);
    if (hall && p.aiPersona?.mazeTpl == null && random(game) < (p.aiPersona?.hallEarly ?? HALL_EARLY)) {
      const early = hallTemplatePlan(game);
      if (early) return (p.aiMaze = early);
    }
    const plan = templatePlan(game, p.aiPersona?.mazeTpl ?? null);
    if (plan) {
      if (hall && HALL_EXT[plan.cols + "x" + plan.rows]?.[plan.tplIndex]) {
        plan.hallExt = { tpl: plan.tplIndex, mirror: plan.mirror };
        const up = HALL_UPPER[plan.cols + "x" + plan.rows]?.[plan.tplIndex];
        if (up) {
          let [x, y] = up.split(",").map(Number);
          if (plan.mirror) x = plan.cols - 2 - x;
          plan.hallUpper = { x, y };
        }
      }
      return (p.aiMaze = plan);
    }
  }
  const { cols } = game.grid,
    rows = laneRows(game, p),
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
    plan = planOrder(game, p, maze), // v0.27zziF: with the hall extension's towers from tier 2
    reserved = hallReserved(game, p, maze),
    open = plan.order.filter((c) => !taken.has(c.key)),
    built = plan.order.length - open.length,
    out = [];
  if (open.length) {
    const before = built ? plan.curve[built - 1] : plan.curve[0] - 0.3;
    let j = built;
    while (j < plan.curve.length - 1 && plan.curve[j] <= before) j++;
    const promise = Math.max(0, (plan.curve[j] - before) / (j - built + 1)) / Math.max(1, before);
    // v0.22l: Hardo's first towers may take any open cell of its plan (it prefers the middle, see templateSpot)
    open.slice(0, ctx.center ? 10 : 3).forEach((c, i) => out.push({ x: c.x, y: c.y, key: c.key, plan: true, rank: ctx.center ? 0 : i, promise }));
  }
  // v0.16k: a fun maze stays recognisable: only a few towers beyond its shape, then upgrades
  if (open.length <= 1 && !(maze.fun && taken.size >= maze.order.length + 4)) {
    const now = ctx.expRoute ?? (ctx.expRoute = expectedRoute(game, p));
    for (let y = 0; y < laneRows(game, p); y++)
      for (let x = 0; x < game.grid.cols; x++) {
        const key = x + "," + y;
        if (taken.has(key) || plan.keys.has(key) || reserved?.has(key)) continue;
        if (expectedRoute(game, p, [{ x, y }]) + 1e-6 < now) continue;
        out.push({ x, y, key, plan: false, rank: 0, promise: 0 });
      }
  }
  return (ctx.tplCandidates = out);
}
function templateSpot(game, p, item, persona, air, ctx) {
  if (ctx.hallNear === undefined) {
    const h = p.towers.find((t) => obj(t.typeId)?.isHall);
    ctx.hallNear = h ? (x, y) => x >= h.gridX - 2 && x <= h.gridX + 3 && y >= h.gridY - 2 && y <= h.gridY + 3 : null;
  }
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
      if (splashView === 1) { if (isSplashTower(item)) value *= persona.splash * 1.3; } // v0.22m2: the row is in the pass damage (1.3 = the old average row bonus)
      else if (isCannonTower(item)) value *= persona.splash * (1 + 0.6 * (1 - Math.min(1, c.y / baseRows(game))));
    }
    if (value <= 0) continue;
    value *= Math.max(0, 1 - (persona.mazeRank ?? 0.15) * c.rank); // keep to the build order
    // v0.27zziF: free towers next to the hall get its auras (halls reach one field further)
    if (!c.plan && ctx.hallNear?.(c.x, c.y)) value *= 1.15;
    // v0.22l: Hardo's first towers stand in the middle: they reach creeps from every portal column (side towers let
    // the first creeps slip past)
    if (ctx.center) {
      const mid = (game.grid.cols - 1) / 2;
      value *= 1 + AI_ADAPT.centerBonus * (1 - Math.abs(c.x - mid) / Math.max(1, mid));
    }
    if (value <= 0) continue;
    if (ctx.noise) value *= 1 + ctx.noise * (random(game) - 0.5) * 2;
    if (!best || value > best.value) best = { x: c.x, y: c.y, value, plan: c.plan };
  }
  return best;
}
function bestSpot(game, p, item, persona, air = false, ctx = {}) {
  const { cols } = game.grid,
    rows = laneRows(game, p),
    size = footprintOf(item.id),
    maze = ctx.maze || null;
  if (maze?.template && size === 1 && ctx.strict) return templateSpot(game, p, item, persona, air, ctx);
  if (maze?.template && size > 1 && ctx.strict) return null; // halls do not fit the template
  const capNow = ctx.cap && !maze?.template ? ctx.cap.ground : groundCapacity(game, p, p.path),
    reserved = maze ? hallReserved(game, p, maze) : null, // v0.27zziF
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
        if (reserved && [0, size - 1].some((dy) => [0, size - 1].some((dx) => reserved.has(x + dx + "," + (y + dy))))) continue; // v0.27zziF: the hall's fields
        if (restrict && wall === undefined && !maze.extra?.has?.(key)) continue;
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
        if (splashView === 1) { if (isSplashTower(item)) value *= persona.splash * 1.3; } // v0.22m2: the row is in the pass damage (1.3 = the old average row bonus)
        else if (isCannonTower(item)) value *= persona.splash * (1 + 0.6 * (1 - y / rows)); // area damage pays near the spawn
        if (wall !== undefined) value *= 1 + 0.6 * (filled / maze.size) + 0.1 * (maze.walls.length - wall);
        if (maze?.template && maze.keys.has(key)) value *= 1.6;
        // v0.27rF: the first fighting towers stand in the middle (as in templateSpot): side towers let the early waves slip past
        if (ctx.center && !air) {
          const mid = (cols - size) / 2;
          value *= 1 + AI_ADAPT.centerBonus * (1 - Math.abs(x - mid) / Math.max(1, mid));
        }
        if (ctx.noise) value *= 1 + ctx.noise * (random(game) - 0.5) * 2;
        if (!best || value > best.value) best = { x, y, value };
      }
    return best;
  };
  // Following the plan, a finished maze means upgrades instead of new towers.
  return ctx.strict && maze ? scan(true) : scan(false);
}
/** Upgrades and new towers that add kill capacity, best value per gold first. */
/**
 * v0.27zzjF: Headhunter L7 (air only, 15,000) only when the opponent really sent flyers in the last
 * AIR_GATE_ROUNDS rounds (30.10. tests: 21 % of all bot tower gold went into it for 2 % of the damage,
 * bought against the neutral air waves and kept idle).
 */
const AIR_GATED = new Set(["h00D"]),
  AIR_GATE_ROUNDS = 15;
function defenceOptions(game, p, persona, level, style, cap, wantAir, onlyBuild = false, need = 0) {
  const options = [],
    maze = mazePlan(game, p, level),
    routes = maze.template ? cap.routes || spawnRoutes(game, p) : null,
    pass = (item, t) => (routes ? routesPass(game, p, item, t.gridX, t.gridY, towerSize(t), routes) : towerPassDamage(game, p, item, t.gridX, t.gridY, towerSize(t), p.path));
  // v0.19f: a typed maze is built cell by cell with its own towers, then upgraded as drawn
  const typed = maze.typed ? typedSteps(game, p, maze, wantAir) : null;
  if (typed?.steps.length) return typed.steps;
  // upgrades of existing towers: capacity gained per gold
  if (!onlyBuild)
    for (const t of p.towers)
      for (const id of obj(t.typeId).upgrades) {
        if (typed?.goals.has(t.id)) continue; // still on its way to an Ogre or a Bird Hunter
        const item = obj(id);
        if (!item?.attacks || !available(game, p.id, "upgrade", id, t.id).ok) continue;
        if (AIR_GATED.has(id) && !(game.round - (p.aiAirSeenAt ?? -Infinity) <= AIR_GATE_ROUNDS)) continue; // v0.27zzjF
        if (wantAir ? !item.targets.includes("air") : !item.targets.includes("ground")) continue;
        const before = wantAir ? airPass(game, p, obj(t.typeId), t.gridX, t.gridY, towerSize(t)) : pass(obj(t.typeId), t),
          after = wantAir ? airPass(game, p, item, t.gridX, t.gridY, towerSize(t)) : pass(item, t);
        const gain = (after - before) * persona.upgradeBias;
        if (gain > 0) options.push({ value: gain / item.cost, cost: item.cost, run: () => command(game, { type: "upgrade", player: p.id, id, towerId: t.id }) });
      }
  // v0.19f: a finished typed maze keeps its shape: only upgrades, new towers only if none are left
  if (typed && (options.some((o) => !o.id) || p.towers.filter((t) => !maze.keys.has(t.gridX + "," + t.gridY) && t.typeId !== ROCK_ID).length >= 4))
    return options.sort((a, b) => b.value - a.value);
  // new towers on the best spot, following the maze plan
  const ctx = { maze, strict: random(game) < style.strict || !!maze?.fun, noise: style.noise, cap, need, cellCache: new Map(), center: p.towers.filter((t) => t.typeId !== ROCK_ID && obj(t.typeId)?.attacks).length < AI_ADAPT.centerTowers }; // v0.27rF: every bot (was Hardo / adaptive only) starts with central towers; // v0.16k: fun mazes keep their shape; v0.22l: Hardo starts in the middle
  for (const item of getCatalog().towers) {
    if (!item.isRoot || !item.attacks || !item.playable) continue;
    if (wantAir ? !item.targets.includes("air") : !item.targets.includes("ground")) continue;
    if (!available(game, p.id, "build", item.id).ok && !(p.gold < item.cost && available(game, p.id, "build", item.id).reason?.includes("more gold"))) continue;
    const spot = bestSpot(game, p, item, persona, wantAir, ctx);
    if (spot) options.push({ id: item.id, value: spot.value / item.cost, cost: item.cost, plan: spot.plan, run: () => command(game, { type: "build", player: p.id, id: item.id, gridX: spot.x, gridY: spot.y }) });
  }
  // v0.25l: persona.opener – the first two fighting towers are archers
  if (persona.opener && !wantAir && p.towers.filter((t) => t.typeId !== ROCK_ID && obj(t.typeId)?.attacks).length < 2 && !p.towers.some((t) => t.typeId === "h003"))
    for (const o of options) if (o.id === "h003") o.value *= 4;
  return options.sort((a, b) => b.value - a.value);
}
/** v0.19f: next step of the line from tower type `from` towards `goal` (null when not on the way). */
function stepToward(from, goal) {
  const seen = new Map([[from, null]]),
    queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (id === goal) {
      let k = id;
      while (seen.get(k) && seen.get(k) !== from) k = seen.get(k);
      return k === from ? null : k;
    }
    for (const u of obj(id)?.upgrades || []) if (!seen.has(u)) seen.set(u, id), queue.push(u);
  }
  return null;
}
/**
 * v0.19f: what a typed maze still wants: the next cells in build order (the first one that can be
 * built now; a cell that would block the path waits or is left out), then the upgrades to Ogre and
 * Bird Hunter. Against flyers Bird Hunter cells go first. `goals` = towers still on their way.
 */
function typedSteps(game, p, maze, wantAir) {
  const at = new Map(p.towers.map((t) => [t.gridX + "," + t.gridY, t])),
    goals = new Set(),
    steps = [];
  const buildStep = (c) => {
    const id = TYPED_CELL[c.type].base,
      item = obj(id),
      ok = available(game, p.id, "build", id);
    if (!item || (!ok.ok && !String(ok.reason || "").includes("more gold"))) return null;
    if (!canBuild(game, p.id, c.x, c.y, id).ok || aiCondBlocks(game, p, c.x, c.y, id)) return null; // v0.23b
    const cost = id === "h01F" ? ((p.freeGens || 0) > 0 ? 0 : firstGenPrice(p, item)) : id === "h003" && (p.freeArchers || 0) > 0 ? 0 : firstGenPrice(p, item);
    return { id, value: 1e9, cost, plan: true, run: () => command(game, { type: "build", player: p.id, id, gridX: c.x, gridY: c.y }) };
  };
  const upgradeSteps = [];
  for (const c of maze.order) {
    const goal = c.goal || TYPED_CELL[c.type]?.goal,
      t = at.get(c.key);
    if (!goal || !t) continue;
    const next = stepToward(t.typeId, goal);
    if (!next) continue;
    goals.add(t.id);
    const item = obj(next),
      ok = available(game, p.id, "upgrade", next, t.id);
    if (!item || (!ok.ok && !String(ok.reason || "").includes("more gold"))) continue;
    upgradeSteps.push({ air: c.type === "R", value: 1e9, cost: item.cost, run: () => command(game, { type: "upgrade", player: p.id, id: next, towerId: t.id }) });
  }
  let build = null;
  if (wantAir) for (const c of maze.order) if (c.type === "R" && !at.has(c.key) && (build = buildStep(c))) break;
  if (wantAir && !build && upgradeSteps.some((u) => u.air)) return { steps: [upgradeSteps.find((u) => u.air)], goals };
  if (!build) for (const c of maze.order) if (!at.has(c.key) && (build = buildStep(c))) break;
  if (build) steps.push(build);
  else if (upgradeSteps.length) steps.push(upgradeSteps[0]);
  return { steps, goals };
}
/**
 * v0.22b: the Insane bot reads its opponent every two seconds, only from what a player can see too
 * (their board, gold, income and the creeps they send), and shifts its persona to counter that style:
 * - thin defence against what it can send (greedy economy): saved-up pushes and finishing blows
 * - a strong defence: out-earn them, no pushes
 * - banked gold (a push is coming): hold more of it in the lane
 * - many flyers: more anti-air ahead of time
 */
/**
 * v0.22l: the most creep HP a player can send at once: its gold plus the next income, spent on the creeps of
 * its tier with the most hit points per gold, as far as the stock allows; fast creeps count heavier.
 */
function sendThreat(game, a, floor = 0) {
  let budget = Math.max(0, a.gold) + Math.max(0, a.income),
    hp = 0;
  const eff = (s) => s.spawnIds.reduce((h, id) => h + Math.max(obj(id)?.hp || 0, floor), 0); // every creep costs at least one shot
  const list = tierSends(a.tier)
    .filter((s) => !s.bossTier && s.playable && s.cost > 0 && !s.flying && (a.stock?.[s.id]?.count || 0) > 0)
    .map((s) => ({ s, per: (eff(s) * clamp((obj(s.spawnIds[0])?.speed || 240) / 240, 1, 2.5)) / s.cost }))
    .sort((x, y) => y.per - x.per);
  for (const { s, per } of list) {
    const n = Math.min(a.stock[s.id].count + 1, Math.floor(budget / s.cost));
    if (n <= 0) continue;
    budget -= n * s.cost;
    hp += n * s.cost * per;
  }
  return hp;
}
/** v0.22l: damage of one shot of this player's single-target towers (average), the least a creep costs them. */
function shotFloor(game, p) {
  let sum = 0,
    n = 0;
  for (const t of p.towers) {
    const item = obj(t.typeId);
    if (!item?.attacks || isCannonTower(item) || item.splashFull > 0 || item.splashSmall > 0) continue;
    sum += statsFor(game, p, item).damage;
    n++;
  }
  return n ? (sum / n) * 0.8 : 0;
}
/** Hit points of the opponents' creeps walking in this lane right now. */
const laneHp = (p) => p.creeps.reduce((sum, c) => sum + (c.owner !== p.id && !c.dead && !c.flying ? Math.max(0, c.hp) : 0), 0);
const towerGold = (q) => q.towers.reduce((s, t) => s + (t.totalSpent || obj(t.typeId)?.cost || 0), 0);
function adaptPersona(game, p, enemy, persona) {
  if (!persona.adaptive || !enemy || enemy.out) return persona;
  if (!p.aiRead || game.tick - p.aiRead.tick >= 40) {
    const seen = p.aiSeen || { rate: 0, airRate: 0 },
      read = (p.aiRead ||= { thin: 1, bank: 0, air: 0, eco: 1 }),
      ema = (old, v, k = 0.35) => old * (1 - k) + v * k;
    read.tick = game.tick;
    // how cheap a push that breaks through their lane is, against one round of our income (bigger = thinner defence)
    const plan = game.round >= 3 ? breakthroughPlan(game, p, enemy, { ...persona, pushSize: 2, armorAware: 0 }) : null,
      send = plan && tierSends(p.tier).find((s) => s.id === plan.id),
      price = send ? Math.max(1, plan.left * (send.cost - send.income * 2)) : Infinity;
    read.thin = ema(read.thin, Math.min(6, p.income / price));
    read.bank = ema(read.bank, enemy.gold / Math.max(10, enemy.income));
    read.air = ema(read.air, seen.airRate / Math.max(1, seen.rate));
    read.eco = ema(read.eco, enemy.income / Math.max(10, p.income));
    read.def = towerGold(enemy) / Math.max(50, towerGold(p));
  }
  const r = p.aiRead,
    k = AI_ADAPT,
    out = { ...persona },
    tags = [];
  if (game.round >= 4 && r.thin > k.thin) {
    tags.push("punish");
    out.push = Math.max(out.push ?? 0, k.punishPush);
    out.pushSize = Math.min(out.pushSize ?? 2, 2);
    out.saveMore = (out.saveMore ?? 1) * 2;
    out.killShot = Math.max(out.killShot ?? 0, k.killShot);
  } else if (r.thin < k.strong) {
    tags.push("outeco");
    out.greed = (out.greed ?? 1) * k.ecoGreed;
    out.push = 0;
    out.saveMore = (out.saveMore ?? 1) * 0.5;
  }
  if (r.eco > 1.2 && r.thin >= k.strong) out.greed = (out.greed ?? 1) * 1.15; // they out-earn us: keep up
  if (r.bank > k.bank) {
    tags.push("bank");
    out.bankWatch = Math.max(out.bankWatch ?? 0, k.bankWatch);
    out.bankFast = k.bankFast; // a saved-up push is often fast creeps (Raiders)
  }
  if (r.air > k.air) {
    tags.push("air");
    out.airCaution = k.airCaution;
  }
  p.aiStyle = tags.join("+") || "base";
  return out;
}
/** Thresholds of the Insane bot's reading (tuned in self-play against bots that play like humans). */
export const AI_ADAPT = { thin: 2.5, strong: -1, punishPush: 0.5, killShot: 15, ecoGreed: 1.25, bank: 1.2, bankWatch: 1.0, bankFast: 1.5, air: 0.25, airCaution: 1.4, earlyRounds: 10, earlyCaution: 0.9, airMargin: 2, tierIncome: 0.5, tierIncomes: [0.5, 0.3, 0.3, 0.3], tierSaveRounds: 2, bossBank: 1, crowdCount: 12, tierSave: 0, threatMargin: 1.25, centerTowers: 4, centerBonus: 1.2 };
/**
 * v0.26bF: mission rule `archers: { total, early, by }`: the bot owns at least `early` Archer-Line towers
 * before the end of round `by` and at least `total` after that. A missing archer is built first, on the
 * maze plan if there is one, else on the free cell that lengthens the path most. True = built one.
 */
function missionArchers(game, p) {
  const r = p.rules.archers,
    line = archerLine(),
    have = p.towers.filter((t) => line.has(t.typeId)).length,
    need = game.round <= (r.by || 0) ? r.early || 0 : r.total || 0;
  if (have >= need || !available(game, p.id, "build", "h003").ok) return false;
  const maze = mazePlan(game, p, aiLevel(game, p));
  if (maze.template) {
    const spots = templateCandidates(game, p, maze, {}).sort((a, b) => Number(b.plan) - Number(a.plan));
    for (const c of spots) if (previewBuild(game, p.id, c.x, c.y, "h003").ok && command(game, { type: "build", player: p.id, id: "h003", gridX: c.x, gridY: c.y }).ok) return true;
  }
  let best = null;
  for (let y = 0; y < laneRows(game, p); y++)
    for (let x = 0; x < game.grid.cols; x++) {
      const pv = previewBuild(game, p.id, x, y, "h003");
      if (pv.ok && pv.path?.length && (!best || pv.path.length > best.n)) best = { x, y, n: pv.path.length };
    }
  return !!best && command(game, { type: "build", player: p.id, id: "h003", gridX: best.x, gridY: best.y }).ok;
}
/**
 * v0.27zzlF: bot decisions that would fall on the same tick are split: of the bots due this tick only the one that waited
 * longest decides (ties: lower seat), the others stay due and decide on the next ticks. Two Hardo bots (every tick) now
 * alternate; bots with a longer interval already think on different ticks (nextAiTick starts at seat × 3) and wait at most
 * a tick or two. -1 = no bot due (or a single bot: no turn needed).
 */
function aiTurnOf(game) {
  let best = null,
    bots = 0;
  for (const p of game.players) {
    if (!p.ai || p.out) continue;
    bots++;
    if (game.tick < p.nextAiTick) continue;
    if (!best || (p.lastAiTick ?? -1) < (best.lastAiTick ?? -1)) best = p;
  }
  return bots > 1 && best ? best.id : -1;
}
function think(game, p) {
  if (game.tick < p.nextAiTick) return;
  if (game.aiTurn >= 0 && game.aiTurn !== p.id) return; // v0.27zzlF: another bot decides this tick
  p.lastAiTick = game.tick;
  const level = aiLevel(game, p),
    interval = { veryEasy: 80, easy: 40, normal: 20, hard: 10, insane: 1 }[level] || 20, // v0.25l: Hardo thinks every tick
    style = AI_STYLE[level] || AI_STYLE.normal;
  p.nextAiTick = game.tick + interval;
  if (p.rules?.sleep && game.time < p.rules.sleep) return; // v0.17: a sleepy mission enemy
  if (p.rules?.archers && missionArchers(game, p)) return; // v0.26bF
  const rolled = aiPersonality(game, p),
    enemy = targetOf(game, p.id), // the player this bot sends to
    humanFoe = enemy && (!enemy.ai || enemy.simHuman), // simHuman: test bots that stand in for a human
    persona = adaptPersona(game, p, enemy, { ...(humanFoe && style.vsHuman ? { ...rolled, ...style.vsHuman } : rolled), humanFoe: !!humanFoe }), // v0.21v, v0.22b; v0.22z2: knows whether it plays a human
    _splash = (splashView = rolled.splashTop || 0), // v0.22m2
    attackers = attackersOf(game, p.id), // the players sending into this bot's lane
    seen = observeEnemy(game, p, persona);
  rowView = persona.rowAware ? 1 : 0;
  crowdView = persona.adaptive && persona.humanFoe && game.round >= 10 ? clamp((seen.nRate ?? AI_ADAPT.crowdCount) / AI_ADAPT.crowdCount, 0.4, 1) : 1;
  for (let guard = 12; p.picks.length && guard > 0; guard--) aiPick(game, p, persona); // v0.15: never loop on a refused choice
  aiConditions(game, p); // v0.23b: conditionalPerk
  // v0.09q: Arrow Volley where the most creeps stand, or on a creep about to break through
  if (perkLevel(p, "volley") && !(p.volleyReady > game.time) && p.creeps.length) {
    const r = VOLLEY.radius * game.grid.cellUnits,
      live = p.creeps.filter((c) => !c.dead && c.hp > 0 && c.owner !== p.id);
    let best = null;
    for (const c of live) {
      const n = live.filter((o) => inRange(game, c, o, r)).length; // v0.23: inRange
      if (!best || n > best.n) best = { c, n };
    }
    if (best && (best.n >= 4 || best.c.progress > 0.75)) command(game, { type: "volley", player: p.id, x: best.c.x, y: best.c.y });
  }
  // v0.10p: Arcane Burst on the densest group, or on a creep about to break through
  if (perkLevel(p, "burst") && !(p.burstReady > game.time) && p.creeps.length) {
    const r = burstRadius(perkLevel(p, "burst")) * game.grid.cellUnits,
      live = p.creeps.filter((c) => !c.dead && c.hp > 0 && c.owner !== p.id);
    let best = null;
    for (const c of live) {
      const n = live.filter((o) => inRange(game, c, o, r)).length; // v0.23: inRange
      if (!best || n > best.n) best = { c, n };
    }
    if (best && (best.n >= 3 || best.c.progress > 0.75)) command(game, { type: "burst", player: p.id, x: best.c.x, y: best.c.y });
  }
  // v0.12: Pillar of Fire on the densest group, Arcane Golem and Monsun when the lane fills up
  if (perkLevel(p, "pillar") && !(p.pillarReady > game.time) && p.creeps.length) {
    const r = PILLAR.radius * game.grid.cellUnits,
      live = p.creeps.filter((c) => !c.dead && c.hp > 0 && c.owner !== p.id);
    let best = null;
    for (const c of live) {
      const n = live.filter((o) => inRange(game, c, o, r)).length; // v0.23: inRange
      if (!best || n > best.n) best = { c, n };
    }
    if (best && (best.n >= 5 || best.c.progress > 0.8)) command(game, { type: "pillar", player: p.id, x: best.c.x, y: best.c.y });
  }
  if (perkLevel(p, "infested") && !(p.infestedReady > game.time) && p.path?.length > 4) {
    // v0.23x: Infested Ground on a free field of the own path (its middle third), not one already infested
    const n = p.path.length,
      taken = new Set((p.infested || []).map((t) => t.y * game.grid.cols + t.x));
    for (let k = Math.floor(n / 3); k < Math.floor((2 * n) / 3); k++) {
      const node = p.path[k];
      if (!node || node.gridY < 0 || node.gridY >= laneRows(game, p) || taken.has(node.gridY * game.grid.cols + node.gridX)) continue;
      command(game, { type: "infested", player: p.id, x: (node.gridX + 0.5) / game.grid.cols, y: (node.gridY + 0.5) / game.grid.rows });
      break;
    }
  }
  if (perkLevel(p, "frostbolt") && !(p.frostboltReady > game.time) && p.creeps.length) {
    // v0.23w: Frost Bolt on the biggest group, or on a creep deep in the field
    const r = FROSTBOLT.radius * game.grid.cellUnits,
      live = p.creeps.filter((c) => !c.dead && c.hp > 0 && c.owner !== p.id);
    let best = null;
    for (const c of live) {
      const n = live.filter((o) => inRange(game, c, o, r)).length;
      if (!best || n > best.n) best = { c, n };
    }
    if (best && (best.n >= 4 || best.c.progress > 0.75)) command(game, { type: "frostbolt", player: p.id, x: best.c.x, y: best.c.y });
  }
  if ((perkLevel(p, "agolem") && !(p.golemReady > game.time)) || (perkLevel(p, "monsun") && !(p.monsunReady > game.time))) {
    const live = p.creeps.filter((c) => !c.dead && c.hp > 0),
      ground = live.filter((c) => !c.flying).length,
      deep = live.some((c) => c.progress > 0.7);
    if (perkLevel(p, "agolem") && !(p.golemReady > game.time) && (ground >= 6 || (deep && ground >= 2))) command(game, { type: "agolem", player: p.id });
    if (perkLevel(p, "monsun") && !(p.monsunReady > game.time) && (live.length >= 8 || deep)) command(game, { type: "monsun", player: p.id });
  }
  // ---- how much defence is needed right now
  // Need: the biggest group the opponent sends (towers chew through a group creep by creep),
  // a share of their whole round, the next neutral wave when it is close, and fresh leaks.
  const early = persona.adaptive && game.round < AI_ADAPT.earlyRounds, // v0.22e: Hardo opens greedy (game 3: 13 towers vs 9 by round 10, far less income)
    safety = (AI_SAFETY[level] || 1.2) * (persona.caution ?? 1) * (early ? AI_ADAPT.earlyCaution : 1),
    wave = waveDefense(game, p),
    waveSoon = game.waves && wave.total && wave.seconds < 25,
    prior = game.round < 4 ? attackers.reduce((sum, a) => sum + a.income * hpPerGold(a.tier), 0) * 0.35 : 0,
    // v0.07l: gold the opponent banks is a push in the making (a human watches that number)
    // v0.22d: Hardo holds more of the gold banked by an opponent a tier ahead (game 2: tier-2 Troll pushes broke it)
    bank = (persona.bankWatch ?? 0) > 0 && !game.warmup && !early ? attackers.reduce((sum, a) => sum + bankedGold(a, persona) * bankTrust(game, p, a, persona) * hpPerGold(a.tier) * (persona.adaptive && a.tier > p.tier ? 1.4 : 1), 0) * persona.bankWatch * (persona.bankFast ?? 1) : 0,
    // v0.22l: Hardo sizes a neutral wave by shots too (a wave of tiny creeps needs more towers than its HP suggests)
    waveGround = waveSoon ? Math.max(wave.total, persona.speedAware ? (wave.count || 0) * shotFloor(game, p) : 0) * (1 - wave.flyingShare) * (persona.waveShare ?? 0.62) * safety : 0,
    // v0.22l: early on Hardo holds only what the opponent can really send next round (gold + income, stock,
    // fast creeps heavier) plus what is already on its way, never more: more towers would be overkill
    threat = early ? attackers.reduce((sum, a) => sum + sendThreat(game, a, shotFloor(game, p)), 0) * AI_ADAPT.threatMargin + laneHp(p) : Infinity,
    groundNeed = Math.max(Math.min(Math.max(seen.burst, (seen.rate - seen.airRate) * (persona.rateShare ?? 0.33), prior, bank) * safety, threat), waveGround),
    airNeed = Math.max(seen.airBurst, seen.airRate * (persona.rateShare ?? 0.33) * (persona.airCaution ?? 1), waveSoon ? wave.total * wave.flyingShare * (persona.waveShare ?? 0.62) : 0) * safety,
    planNow = mazePlan(game, p, level),
    routesNow = planNow.template ? spawnRoutes(game, p) : null,
    cap = { ...laneCapacity(game, p, p.path, routesNow), routes: routesNow },
    pressure = p.creeps.filter((c) => c.owner !== p.id && c.progress > 0.6).reduce((s, c) => s + c.hp, 0),
    lost = (p.aiLives ?? p.lives) > p.lives;
  p.aiLives = p.lives;
  if (lost) p.aiAlarm = game.tick + Math.round(20 / TICK);
  const alarm = (p.aiAlarm || 0) > game.tick;
  // v0.22u2: Hardo's tier-up comes before defence the opponent only might need (game 1 of 19.10.: banked gold
  // made it pour 65k into towers, tier 2 only at 1,075 income, never tier 3)
  // (whether the boss is for sale, gold aside: available() also refuses while the gold is short)
  const tierBoss = persona.adaptive && !game.warmup ? tierSends(p.tier).find((s) => s.bossTier && !p.bossBought?.[s.id] && p.tier < s.bossTier && (p.stock[s.id]?.count ?? 0) >= 1 && !(lockRoundsLeft(game, p.stock[s.id]) > 0)) : null,
    // v0.22z2: the human tier rule (and saving for the boss) only against humans; against bots the old rule won 80 %, the new one 52 %
    tierReady = !!tierBoss && game.round >= 6 && p.income >= tierBoss.cost * (persona.humanFoe ? AI_ADAPT.tierIncomes[p.tier - 1] ?? AI_ADAPT.tierIncome : AI_ADAPT.tierIncome),
    realNeed = Math.max(Math.min(Math.max(seen.burst, (seen.rate - seen.airRate) * (persona.rateShare ?? 0.33), prior) * safety, threat), waveGround);
  const groundGap = groundNeed - cap.ground + (alarm ? pressure + 40 : 0),
    airGap = airNeed - cap.air,
    // v0.22zc2: with the human at 5 lives or fewer Hardo keeps its gold for the finishing push (game 3: Felito sat on
    // 2–5 lives for 12 rounds while Hardo's gold went into towers)
    finishing = persona.adaptive && persona.humanFoe && !!enemy && !enemy.out && enemy.lives <= 5 && p.lives > 8 && !alarm,
    calm = persona.humanFoe && (tierReady || finishing) && !alarm && realNeed <= cap.ground && airGap <= 0,
    // a turtling bot keeps spending on defence it does not need yet
    defend = !calm && (groundGap > 0 || airGap > 0 || random(game) < (style.turtle || 0));
  // v0.19d2: bots from easy up place their free archer at once, on the best spot of their maze plan
  if (level !== "veryEasy" && (p.freeArchers || 0) > 0 && available(game, p.id, "build", "h003").ok) {
    const free = defenceOptions(game, p, persona, level, style, cap, false, true, 0).find((o) => o.id === "h003");
    if (free?.run().ok) return;
  }
  // v0.22y2: Normal, Hard and Hardo keep their maze secret in the warm-up and build only in its last seconds
  // (a random moment 1.5–4 s before round 1), so the opponent cannot read their plan; the free archer still goes down at once
  if (["normal", "hard", "insane"].includes(level) && game.warmup) {
    p.aiWarmBuild ??= 1.5 + random(game) * 2.5;
    if (game.incomeRemaining > p.aiWarmBuild) return;
  }
  p.aiDebug = { round: game.round, rate: Math.round(seen.rate), burst: Math.round(seen.burst), airBurst: Math.round(seen.airBurst), wave: waveSoon ? Math.round(wave.total) : 0, capG: Math.round(cap.ground), capA: Math.round(cap.air), gapG: Math.round(groundGap), gapA: Math.round(airGap), alarm };
  // v0.27zziF: from tier 2 the planned Hall of Elements goes down as soon as its gold is there
  if (!game.warmup && (planNow.hallExt || planNow.hallAt) && !hasHall(p) && p.gold >= (obj(HALL_ID)?.cost ?? Infinity) && buildPlannedHall(game, p, planNow)) return;
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
  // v0.22f: Hardo learns from its pushes: one that took no life means the opponent's lane is stronger than its
  // estimate (slows, perks like Lone Guardians, abilities), one that broke through well lets the estimate relax
  if (p.aiPushCheck && game.tick >= p.aiPushCheck.tick) {
    const got = p.stats.leaks - p.aiPushCheck.leaks0,
      scale = p.aiPushCheck.air && persona.airEval ? "aiAirScale" : "aiCapScale"; // v0.22g: air waves teach the air estimate
    p[scale] = clamp((p[scale] || 1) * (got <= 0 ? 1.6 : got >= 3 ? 0.85 : 1), 1, 5);
    p.aiPushCheck = null;
  }
  // v0.27F: tier 1 starts with five cards; bots recruit the Mud Golem as soon as they can spare the gold
  // (it saves for it, no creep sends or extras, once its income has grown or the round is late)
  if (tierOneLocked(p) && game.round >= (MINI_BOSS.aiRound[level] ?? 3)) {
    const mud = obj(MINI_BOSS.id);
    if (mud && sendAllowed(p, mud)) {
      if (p.gold >= mud.cost + Math.min(p.income, 20) && available(game, p.id, "send", mud.id).ok && command(game, { type: "send", player: p.id, id: mud.id }).ok) return;
      if (p.income >= MINI_BOSS.aiIncome || game.round >= MINI_BOSS.aiSave) return;
    }
  }
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
      const now = plan.saved ? savePlan(game, p, enemy, persona, plan.id) : breakthroughPlan(game, p, enemy, persona, plan.id);
      if (now && p.gold >= item.cost * now.left) {
        plan.left = now.left;
        plan.sending = true;
      } else p.aiPush = null;
      return;
    } else if (p.gold >= item.cost * plan.left || plan.sending) {
      plan.leaks0 ??= p.stats.leaks; // v0.22f: judge the push afterwards
      // v0.22g: an air wave stays air-only; Hard and Hardo now and then add one aura carrier (Endurance, Devotion …)
      if (!plan.escort && item.flying && (persona.airAura ?? 0) > 0) {
        plan.escort = "none";
        const spare = p.gold - item.cost * plan.left,
          esc = random(game) < persona.airAura ? airEscort(game, p, Math.min(spare, item.cost * plan.left * 0.5)) : null;
        if (esc && command(game, { type: "send", player: p.id, id: esc.id }).ok) plan.escort = esc.id;
      }
      plan.sending = true;
      for (let i = 0; i < 4 && plan.left > 0; i++) {
        if (!command(game, { type: "send", player: p.id, id: plan.id }).ok) break;
        plan.left--;
      }
      if (plan.left <= 0) {
        if (persona.adaptive || (persona.airLearn && item.flying)) p.aiPushCheck = { tick: game.tick + Math.round(35 / TICK), leaks0: plan.leaks0 ?? p.stats.leaks, air: !!item.flying };
        p.aiPush = null;
      }
      return;
    } else return; // saving
  }
  const boss = sends.find((s) => s.bossTier);
  if (boss && game.round >= persona.bossRound * p.tier && p.gold >= boss.cost + (persona.bossRush && ((enemy && enemy.tier > p.tier) || p.gold > p.income * 1.5) ? Math.min(p.income, boss.cost) * 0.15 : p.income)) {
    command(game, { type: "send", player: p.id, id: boss.id });
    return;
  }
  // v0.22e: Hardo tiers up by income, like a strong human (tier 2 at about 500 income): from income ≥ half the
  // boss price it buys the boss as soon as the gold is there (saving up for it with tierSave lost in self-play)
  // v0.22u2: the later bosses come from a smaller share of their price (tier 3 at about 3,000 income), and the
  // last two rounds before the boss Hardo saves instead of spending on income sends
  if (persona.adaptive && tierBoss && tierReady) {
    const need = tierBoss.cost + Math.min(p.income, tierBoss.cost) * 0.1;
    if (p.gold >= need) {
      if (command(game, { type: "send", player: p.id, id: tierBoss.id }).ok) return;
    }
    if (persona.humanFoe && !p.aiPush && p.gold + p.income * AI_ADAPT.tierSaveRounds >= need) return;
  }
  // v0.22d: once the opponent is a tier ahead or its gold lies idle (sold-out stock), Hardo needs only a small cushion above the boss price (game 2: it
  // stayed in tier 1 for 44 rounds because "boss cost + one round of income" grew faster than its savings).
  // Buying it early or saving up for it lost in self-play.
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
      for (let y = laneRows(game, p) - 1; y >= 0; y--)
        for (const x of [0, game.grid.cols - 1]) {
          const pv = previewBuild(game, p.id, x, y, gen.id);
          if (pv.ok && pv.path?.length >= p.path.length && command(game, { type: "build", player: p.id, id: gen.id, gridX: x, gridY: y }).ok) return;
        }
    }
  }
  // Maze rush: with spare gold, lay the next template tower before it is needed.
  if ((persona.mazeRush ?? 0) > 0 && !early && random(game) < persona.mazeRush) { // v0.22l: Hardo does not rush the maze early
    const maze = mazePlan(game, p, level);
    if (maze.template && planOrder(game, p, maze).order.some((c) => !towerAt(p, c.x, c.y))) {
      const opt = defenceOptions(game, p, persona, level, style, cap, false, true, groundNeed).find((o) => o.plan);
      if (opt && p.gold - opt.cost >= reserve && opt.run().ok) return;
    }
  }
  // v0.07l: a low opponent gets a finishing push as soon as one can break through
  if (!p.aiPush && (persona.killShot ?? 0) > 0 && enemy.lives <= persona.killShot && game.round >= 4) {
    const plan = breakthroughPlan(game, p, enemy, finishing ? { ...persona, pushSize: 1 } : persona); // v0.22zc2: finish now, not in 3 rounds
    if (plan) {
      p.aiPush = plan;
      return;
    }
  }
  // A push: saved-up gold for one wave big enough to break through. The smart planner sizes it
  // against the opponent's real kill capacity (flyers win when their anti-air is thin); the
  // legacy planner just buys the toughest creep per gold.
  // v0.16j: now and then (rarely in tier 1, more often from tier 2) the bot checks whether a
  // saved-up wave of one strong or fast creep type would really break through, and saves for it
  const saves = (p.aiSaves ||= {});
  if (!p.aiPush && game.round >= 4 && persona.smartPush && !((saves[Math.min(3, p.tier)] || 0) >= (saveRule(p).max ?? Infinity)) && random(game) < aiSaveChance(p) * (persona.saveMore ?? 1)) {
    const plan = savePlan(game, p, enemy, persona);
    if (plan) {
      saves[Math.min(3, p.tier)] = (saves[Math.min(3, p.tier)] || 0) + 1;
      p.aiPush = plan;
      return;
    }
  }
  if (!p.aiPush && game.round >= (persona.smartPush ? 4 : 6) && random(game) < persona.push * 0.12 * (interval / 10) ** (persona.adaptive ? 1 : 0) && !(persona.adaptive && p.tier === 1 && p.aiStyle !== "punish" && !p.aiStyle?.startsWith("punish"))) {
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
    pool = tierSends(p.tier).filter((s) => !s.bossTier && s.income > 0 && sendAllowed(p, s) && !(persona.airEval && s.flying)), // v0.22g: flyers only go out as air waves
    tough = (s) => ((persona.armorBias ?? 0) > 0 ? toughnessOf(game, p, enemy, pool, s) ** persona.armorBias : 1),
    worth = (s) => (s.income / s.cost) * (s.flying ? flyerBias : 1) * tough(s);
  for (let k = 0; k < burst; k++) {
    const economical = pool.filter((s) => available(game, p.id, "send", s.id).ok).sort((a, b) => worth(b) - worth(a));
    if (!economical.length) return;
    const chosen = economical[Math.floor(random(game) * Math.min(Math.max(1, Math.floor(persona.sendPick ?? 3)), economical.length))];
    if (p.gold - chosen.cost < reserve || !command(game, { type: "send", player: p.id, id: chosen.id }).ok) return;
  }
}
/**
 * v0.16j: saved-up waves. Tier 1 and 2 keep income first: the bot only strikes when the
 * opponent's defence is very weak (a cheap wave takes several lives) – in tier 1 just with
 * Raiders or Necromancers, in tier 2 with the strong half of the tier (Trolls and up). From
 * tier 3 on saving is a tactic to kill: more often, pricier waves, above all when they could
 * end the opponent. Fast creeps count with their speed: the towers have less time for them.
 */
const AI_SAVE = {
  // v0.16k: tier 1 at most 2 saved waves per match, tier 2 at most 2, from tier 3 regularly and bigger
  1: { chance: 0.0006, ids: ["n00S", "n00N"], minLives: 4, rounds: 1.5, max: 2 },
  2: { chance: 0.001, strong: 0.5, minLives: 4, rounds: 2, max: 2 },
  3: { chance: 0.006, perTier: 0.001, minLives: 3, rounds: 3, kill: 5 },
  margin: 1.25,
  refSpeed: 240,
};
const saveRule = (p) => AI_SAVE[Math.min(3, p.tier || 1)];
const aiSaveChance = (p) => saveRule(p).chance + (saveRule(p).perTier || 0) * Math.max(0, p.tier - 3);
function savePlan(game, p, enemy, persona, onlyId = null) {
  const rule = saveRule(p),
    theirs = laneCapacity(game, enemy),
    pool = tierSends(p.tier).filter((s) => !s.bossTier && s.playable && s.cost > 0 && sendAllowed(p, s)),
    costs = pool.map((s) => s.cost).sort((a, b) => a - b),
    minCost = rule.strong ? costs[Math.floor(costs.length * rule.strong)] || 0 : 0;
  let best = null;
  for (const s of pool) {
    if ((onlyId && s.id !== onlyId) || (rule.ids && !rule.ids.includes(s.id)) || s.cost < minCost) continue;
    const stock = p.stock[s.id],
      unit = obj(s.spawnIds[0]);
    if (!stock || !unit) continue;
    const hp = hpOf(s),
      bodies = Math.max(1, s.spawnIds.length),
      cap =
        persona.airEval && s.flying
          ? airCapacityVs(game, p, enemy, s) // v0.22g
          : (persona.armorAware ? capacityVs(game, p, enemy, s) : s.flying ? theirs.air : theirs.ground) * (AI_SAVE.refSpeed / Math.max(60, unit.speed || AI_SAVE.refSpeed)) * (p.aiCapScale || 1),
      kill = rule.kill && enemy.lives <= 12, // tier 3+: a kill in reach may cost more
      rounds = kill ? rule.kill : rule.rounds,
      budget = onlyId ? p.gold : p.gold + p.income * rounds, // the final check spends only gold in hand
      reachable = Math.min(stockMaxOf(p, s), stock.count + Math.floor((rounds * game.incomeInterval) / Math.max(0.5, s.stockRegen || 1))),
      n = Math.min(reachable, Math.floor(budget / s.cost));
    if (n < 2) continue;
    // creeps beyond the lane's capacity (with a safety margin) get through
    const lives = Math.floor((n * hp - cap * AI_SAVE.margin) / Math.max(1, hp / bodies)),
      price = n * (s.cost - s.income * 2);
    if (lives < Math.min(rule.minLives, enemy.lives) || price > p.income * rounds) continue;
    const value = (lives >= enemy.lives ? 3 : 1) * Math.min(lives, enemy.lives) / Math.max(1, price);
    if (!best || value > best.value) best = { id: s.id, left: n, value, rounds };
  }
  return best && { id: best.id, left: best.left, until: game.round + Math.ceil(best.rounds) + 2, smart: true, saved: true };
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
      sum += pass * damageMultiplier(item.attackType, unit.defenseType || "medium", unit.armor || 0, item.damage || AI_ARMOR_HIT);
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
const ELEMENT_BONUS = { storm: 2.5, arcane: 1.8, plague: 0.8 },
  // v0.16i: self-play (36 hard games): storm won only 30 %, plague, fire and earth about 60 %
  ELEMENT_BONUS_NEW = { storm: 0.6, arcane: 1.4, plague: 1.6, fire: 1.4, earth: 1.4 };
/**
 * v0.22g: the opponent's real kill capacity against one flyer type (AI from Normal up): every anti-air tower's
 * pass damage along the flyer columns, against the flyer's armour type and value, for the time the slow flyer
 * really spends in range (the old estimate assumed ground speed and so rated flyers ~1.7× too strong), times
 * what earlier air waves taught the bot. Air Block denies one breach of the wave: one more flyer's hit points.
 */
function airCapacityVs(game, p, enemy, s) {
  const unit = obj(s.spawnIds[0]) || s,
    key = "air:" + s.id;
  if (!p.aiArmorCache || game.tick - p.aiArmorCache.tick > 100) p.aiArmorCache = { tick: game.tick, map: new Map() };
  const map = p.aiArmorCache.map;
  if (!map.has(key)) {
    let sum = 0;
    for (const t of enemy.towers) {
      const item = obj(t.typeId);
      if (!item?.attacks || !item.targets?.includes("air")) continue;
      sum += airPass(game, enemy, item, t.gridX, t.gridY, towerSize(t)) * damageMultiplier(item.attackType, unit.defenseType || "medium", unit.armor || 0, item.damage || AI_ARMOR_HIT);
    }
    const slow = clamp(AI_SAVE.refSpeed / Math.max(60, unit.speed || AI_SAVE.refSpeed), 0.5, 3),
      block = perkLevel(enemy, "airblock") > 0 ? hpOf(s) / Math.max(1, s.spawnIds.length) : 0,
      // flyers are slow (about 18 s across the board): the opponent sees them coming and builds anti-air with the
      // gold in hand (and the next income if it arrives during the flight). Self-play: without this, 0 of 30 air
      // waves broke through; with the defending bot switched off, 5 of 6 flyers did.
      flight = (laneRows(game, enemy) * game.grid.cellUnits) / Math.max(1, (unit.speed || AI_SAVE.refSpeed) * movementMultiplier(game)),
      spend = enemy.gold + ((game.incomeRemaining ?? Infinity) < flight ? enemy.income : 0),
      react = Math.max(0, spend) * antiAirPerGold(game, p, enemy) * AI_AIR_REACT * damageMultiplier(obj("h003")?.attackType, unit.defenseType || "medium", unit.armor || 0, obj("h003")?.damage || AI_ARMOR_HIT);
    map.set(key, (sum + react) * slow + block);
  }
  return map.get(key) * (p.aiAirScale || 1);
}
/** Share of the anti-air the opponent could buy with its gold that counts against an air wave. */
const AI_AIR_REACT = 0.8;
/** v0.22g: anti-air pass damage per gold the opponent gets from a new archer-line tower in the middle of its board. */
function antiAirPerGold(game, p, enemy) {
  const key = "aapg:" + enemy.id,
    map = p.aiArmorCache.map; // the bot's own cache (renewed every 100 ticks), never the opponent's state
  if (map.has(key)) return map.get(key);
  const ids = new Set(["h003"]);
  for (const t of enemy.towers) if (obj(t.typeId)?.targets?.includes("air")) ids.add(t.typeId);
  let best = 0;
  const x = Math.floor(game.grid.cols / 2) - 1,
    y = Math.floor(baseRows(game) / 2);
  for (const id of ids) {
    const item = obj(id),
      cost = item?.cost || 0;
    if (!item?.attacks || cost <= 0) continue;
    best = Math.max(best, airPass(game, enemy, item, x, y, 1) / cost);
  }
  map.set(key, best);
  return best;
}
/** v0.22g: the cheapest aura carrier of the tier whose aura also helps flyers (Endurance, Devotion …). */
function airEscort(game, p, budget) {
  let best = null;
  for (const s of tierSends(p.tier)) {
    if (s.bossTier || !s.playable || s.flying || s.cost <= 0 || s.cost > budget || !sendAllowed(p, s) || !(p.stock[s.id]?.count >= 1)) continue;
    if (!aurasOf({ typeId: s.spawnIds[0] }).some((a) => (a.friend || a.self) && (a.air || !a.ground))) continue;
    if (!best || s.cost < best.cost) best = s;
  }
  return best;
}
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
    flyers = tierSends(p.tier).filter((s) => s.flying && !s.bossTier && s.income >= 0 && sendAllowed(p, s)),
    weakAir = theirs.air < theirs.ground * (persona.airThreshold ?? 0.25);
  const pool = weakAir && flyers.length ? flyers : tierSends(p.tier).filter((s) => !s.bossTier && sendAllowed(p, s));
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
    if (s.bossTier || !s.playable || s.cost <= 0 || (onlyId && s.id !== onlyId) || !sendAllowed(p, s)) continue;
    const stock = p.stock[s.id];
    if (!stock) continue;
    const hp = hpOf(s),
      unit = obj(s.spawnIds[0]),
      quick = persona.speedAware && !s.flying ? clamp(AI_SAVE.refSpeed / Math.max(60, unit?.speed || AI_SAVE.refSpeed), 0.4, 1) : 1, // v0.22b: fast creeps need fewer
      cap =
        persona.airEval && s.flying
          ? airCapacityVs(game, p, enemy, s) // v0.22g: speed, armour and Air Block counted
          : (persona.armorAware ? capacityVs(game, p, enemy, s) : s.flying ? theirs.air : theirs.ground) * quick * (p.aiCapScale || 1),
      n = Math.max(2, Math.ceil((cap * (persona.pushMargin ?? 1.35) * (persona.adaptive && s.flying && !persona.airEval ? AI_ADAPT.airMargin : 1) + 1) / Math.max(1, hp))),
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
/**
 * v0.18a: neutral waves consist only of creeps that really exist: every wave sends real creeps
 * with their own hit points, armour, armour type and speed. The wave type picks which creeps
 * (fast ones, armoured ones, flyers …) and the wave's hit-point budget (waveTotalHp × hp) decides
 * how many of them come. Bounty and the breach cost stay wave rules.
 */
export const WAVE_TYPES = Object.freeze({
  // count: creeps the hit points are planned for; share: the wave's hit points relative to waveTotalHp
  normal: { label: "Normal", tip: "A balanced wave.", count: 10, share: 1, bounty: 1 },
  swarm: { label: "Swarm", tip: "Many weak foes. Splash damage helps.", count: 18, share: 0.76, bounty: 0.5 },
  fast: { label: "Fast", tip: "They rush through. Slow them or build a long path.", count: 10, share: 0.7, bounty: 1, pool: "fast" },
  armored: { label: "Armored", tip: "Armored foes. Magic and siege work well.", count: 8, share: 0.92, bounty: 1.3, pool: "armored" },
  air: { label: "Flyers", tip: "They fly over the path. Only anti-air hits them.", count: 8, share: 0.44, flying: true, bounty: 1.2 },
  tough: { label: "Tough", tip: "Few strong foes. Focused damage helps.", count: 4, share: 1.1, bounty: 1.2 },
  mixed: { label: "Mixed", tip: "Ground and air at once.", count: 12, share: 0.84, mixed: true, bounty: 1 },
  boss: { label: "Boss", tip: "A giant foe. A breakthrough costs 3 lives.", count: 1, share: 1.2, boss: true, bounty: 20, leak: 3 },
});
const WAVE_ORDER = ["normal", "swarm", "fast", "armored", "air", "tough", "normal", "fast", "mixed", "boss"];
/** Which real creeps a wave type may use (never the send-only bosses outside boss waves). */
const WAVE_POOLS = {
  ground: (s) => !s.flying && !s.bossTier,
  fast: (s) => !s.flying && !s.bossTier && s.speed >= 280,
  armored: (s) => !s.flying && !s.bossTier && s.armor >= 1,
  air: (s) => !!s.flying && !s.bossTier,
  boss: (s) => !s.flying,
};
/** The real creep whose hit points are closest (log scale) to `target`, and how many fit the budget. */
function waveGroup(poolName, budget, target, maxCount = 30) {
  const pool = getCatalog().sends.filter((s) => s.playable && s.hp > 0 && s.id !== MINI_BOSS.id && WAVE_POOLS[poolName](s)); // v0.27F: no Mud Golem in neutral waves
  let best = null;
  for (const s of pool) {
    const d = Math.abs(Math.log(s.hp / Math.max(1, target)));
    if (!best || d < best.d - 1e-9) best = { s, d };
  }
  const s = best?.s || getCatalog().byId.n00M;
  return { model: s.id, count: Math.max(1, Math.min(maxCount, Math.round(budget / s.hp))), hp: s.hp, armor: s.armor || 0 };
}
const WAVE_INFO_CACHE = new Map();
export function waveInfo(number) {
  const catalog = getCatalog(),
    key = number;
  const cached = WAVE_INFO_CACHE.get(key);
  if (cached && cached.catalog === catalog) return cached.info;
  let type = WAVE_ORDER[(number - 1) % WAVE_ORDER.length],
    spec = WAVE_TYPES[type];
  // no real fast or armoured creep is small enough this early: the wave is a normal one
  if (spec.pool && waveGroup(spec.pool, 1, (waveTotalHp(number) * spec.share) / spec.count).hp > (2.5 * waveTotalHp(number) * spec.share) / spec.count) spec = WAVE_TYPES[(type = "normal")];
  const budget = waveTotalHp(number) * spec.share,
    slots = spec.count + (spec.boss || type === "tough" ? 0 : Math.min(6, Math.floor(number / 10)));
  let groups;
  if (spec.mixed) groups = [waveGroup("ground", budget / 2, budget / slots, 15), waveGroup("air", budget / 2, budget / slots, 15)].map((g, i) => ({ ...g, flying: i === 1 }));
  else if (spec.boss) groups = [{ ...waveGroup("boss", budget, budget, 1), flying: false }];
  else {
    const pool = spec.flying ? "air" : spec.pool || "ground";
    groups = [{ ...waveGroup(pool, budget, budget / slots), flying: !!spec.flying }];
  }
  const count = groups.reduce((n, g) => n + g.count, 0),
    hpTotal = groups.reduce((n, g) => n + g.count * g.hp, 0),
    // the bounty of the old ten-creep formula is shared by the real creeps
    bountyTotal = Math.max(1, Math.round((1 + number * 0.55) * spec.bounty)) * slots;
  const info = {
    number,
    type,
    label: spec.label,
    tip: spec.tip,
    count,
    groups,
    hp: Math.round(hpTotal / count), // average per creep (estimates, AI)
    armor: Math.round(groups.reduce((n, g) => n + g.count * g.armor, 0) / count),
    bounty: Math.max(1, Math.round(bountyTotal / count)),
    boss: !!spec.boss,
    flying: !!spec.flying,
    mixed: !!spec.mixed,
    round: waveRound(number),
  };
  WAVE_INFO_CACHE.set(key, { catalog, info });
  return info;
}
export function nextWave(game) {
  if (!game.waves) return null;
  let number = 1;
  while (waveRound(number) <= game.round) number++;
  const inRounds = waveRound(number) - game.round;
  return { ...waveInfo(number), seconds: game.incomeRemaining + (inRounds - 1) * game.incomeInterval };
}
/** The (first) creep a wave consists of; mixed waves: the ground or the air group. */
export function waveModel(number, type, info = waveInfo(number)) {
  const g = info.groups.find((x) => (type === "air" ? x.flying : !x.flying)) || info.groups[0];
  return g.model;
}
function launchWave(game, number) {
  const info = waveInfo(number),
    spec = WAVE_TYPES[info.type];
  game.wave = number;
  emit(game, "wave", { wave: number, kind: info.type, label: info.label, tip: info.tip, boss: info.boss, flying: info.flying, mixed: info.mixed });
  // mixed waves alternate ground and air creeps
  const order = [];
  const left = info.groups.map((g) => g.count);
  while (left.some((n) => n > 0)) info.groups.forEach((g, k) => left[k]-- > 0 && order.push(g));
  const gap = 0.55 * (spec.boss ? 1 : order.length > 12 ? 0.6 : 1);
  order.forEach((g, i) => {
    for (const defender of game.players.filter((q) => !q.out))
      game.waveQueue.push({ time: game.time + gap * i, defender: defender.id, number, type: info.type, model: g.model, flying: g.flying, index: i, real: true });
  });
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
    real = !!entry.real, // v0.18a: neutral waves use the creep's own values
    speed = (real ? item.speed : 240 * (spec.speed || 1)) * movementMultiplier(game),
    hp = (real ? item.hp : info.hp) * hpScale;
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
    armor: real ? item.armor || 0 : info.armor,
    speed: speed * (0.92 + random(game) * 0.16),
    baseSpeed: speed,
    regen: real ? item.regen || 0 : spec.regen ? hp * spec.regen : 0,
    flying: !!entry.flying,
    immune: !!spec.immune,
    split: child ? 0 : spec.split || 0,
    bounty: child ? Math.max(1, Math.round(info.bounty * 0.4)) : info.bounty,
    leakLives: spec.leak || 1,
    defenseType: real ? item.defenseType || "medium" : spec.defense || (entry.flying ? "small" : "medium"),
    path: entry.flying ? [position, exitPos(game, target, column)] : findPath(game, target.id, gridAt(game, position)) || [],
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

const NONE = Object.freeze([]); // v0.23i: shared empty list
const AURA_SCRATCH_MANA = [],
  AURA_SCRATCH_REGEN = []; // v0.23i: reused every tick
function fixedTick(game) {
  fixedTickInner(game);
  if (game.teams) teamSync(game); // v0.20: what this tick changed, for the whole team
}
function fixedTickInner(game) {
  skillEpoch++; // v0.21l
  game.tick++;
  game.time = game.tick * TICK;
  game.incomeRemaining -= TICK;
  if (game.incomeRemaining <= EPS) incomeTick(game);
  // v0.19d2: EXP generators every 4 s (v0.24oF) between the income ticks
  if (!game.warmup && game.expGenRemaining !== undefined) {
    game.expGenRemaining -= TICK;
    if (game.expGenRemaining <= EPS) {
      game.expGenRemaining += EXP_GEN_EVERY;
      expGenTick(game);
    }
  }
  tickVolleys(game); // v0.09q
  tickPillars(game); // v0.12
  // v0.23i: no new arrays in the (usual) ticks without a spawn due
  const pending = game.pendingSpawns.length && game.pendingSpawns.some((s) => s.time <= game.time + EPS) ? game.pendingSpawns.filter((s) => s.time <= game.time + EPS) : NONE;
  if (pending.length) game.pendingSpawns = game.pendingSpawns.filter((s) => s.time > game.time + EPS);
  for (const s of pending) {
    const c = spawnCreep(game, s.owner, s.id, s, s.lane ?? null);
    if (c) {
      if (s.boost > 1) c.maxHp *= s.boost; // v0.12: Breeding Pools
      c.hp = c.maxHp * s.health;
      c.summoned = true;
      if (s.speedDelta) c.speed = Math.max(1, c.speed + s.speedDelta * movementMultiplier(game));
    }
  }
  releaseSendQueue(game); // v0.23p
  game.clouds ||= [];
  if (game.waveQueue?.length) {
    const due = game.waveQueue.filter((w) => w.time <= game.time + EPS);
    if (due.length) {
      game.waveQueue = game.waveQueue.filter((w) => w.time > game.time + EPS);
      for (const w of due) w.quest ? spawnQuestCreep(game, w) : w.aux ? spawnAuxCreep(game, w) : spawnWaveCreep(game, w); // v0.15: quest creeps; v0.26: auxiliaries
    }
  }
  game.aiTurn = aiTurnOf(game); // v0.27zzlF: one bot decision per tick
  for (const p of game.players) {
    if (p.out) {
      // v0.24j: clouds on a knocked-out lane would never tick down: they go with the lane
      if (game.clouds?.some((cl) => cl.lane === p.id)) game.clouds = game.clouds.filter((cl) => cl.lane !== p.id);
      if (game.missiles?.some((m) => m.lane === p.id)) game.missiles = game.missiles.filter((m) => m.lane !== p.id); // v0.27lF
      continue;
    }
    // v0.23: only the sends of the current tier can restock (the others were skipped one by one before); each
    // stock is independent, so the order does not matter
    for (const item of stockTierSends(p.tier)) {
      const stock = p.stock[item.id];
      if (!stock || stock.count >= stockMaxOf(p, item) || stock.lockRound > game.round) continue;
      if (game.time + EPS >= stock.next) {
        stock.count++;
        stock.next = game.time + Math.max(TICK, stockRegenOf(p, item));
      }
    }
    tickZones(game, p); // v0.18h
    crowdControl(game, p); // v0.10l
    tickSummons(game, p); // v0.17q
    tickHellfire(game, p); // v0.10p
    tickPocks(game, p); // v0.10q
    tickInfested(game, p); // v0.23x
    tickPlanks(game, p); // v0.23zb
    tickGuardian(game, p); // v0.14
    if (p.quest) checkQuest(game, p); // v0.15
    tickMonsun(game, p); // v0.12
    tickGolems(game, p); // v0.12
    for (const q of p.researchQueue) {
      q.remaining -= TICK;
      if (q.remaining <= EPS) finishResearch(game, p, q.id);
    }
    if (p.researchQueue.length) p.researchQueue = p.researchQueue.filter((q) => q.remaining > EPS); // v0.23i
    const manaAuras = AURA_SCRATCH_MANA,
      regenAuras = AURA_SCRATCH_REGEN;
    manaAuras.length = 0;
    regenAuras.length = 0;
    for (const t of p.towers)
      if (!(t.buildRemaining > 0))
        for (const sk of towerSkills(p, t)) {
          if (sk.type === "manaAura") manaAuras.push({ t, sk });
          else if (sk.type === "manaRegenAura") regenAuras.push({ t, sk }); // v0.17p
        }
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
      // v0.23: the strongest mana / mana-regeneration aura in reach, in plain loops (no arrays per tower and tick)
      let manaBonus = 0,
        regenBest = 0;
      // v0.24m: mana auras also reach only the neighbouring fields (the hall itself included)
      for (const m of manaAuras) if (m.sk.regen > manaBonus && (m.t === t || neighbourTowers(game, m.t, t))) manaBonus = m.sk.regen;
      for (const m of regenAuras) if (m.sk.rate > regenBest && (m.t === t || neighbourTowers(game, m.t, t))) regenBest = m.sk.rate;
      const regen = isMagicTower(item) ? stats.mana / MAGIC_CHARGE_SECONDS : item.manaRegen,
        regenRate = 1 + regenBest; // v0.17p
      t.mana = Math.min(stats.mana, t.mana + (regen + manaBonus) * regenRate * TICK);
      attack(game, p, t, TICK, stats); // v0.21l: the stats just computed
      const tSkills = towerSkills(p, t);
      tickAreaDamage(game, p, t, tSkills);
      tickHowl(game, p, t, tSkills); // v0.17p
      tickTerror(game, p, t, tSkills); // v0.27yF
      tickEntangle(game, p, t, tSkills, stats.range); // v0.27zaF
      tickBarrage(game, p, t, stats); // v0.27lF: Battle Mech
      tickFlameburst(game, p, t, stats); // v0.27mF: Fire Lord
    }
    applyImmolation(game, p); // v0.27oF: the strongest aura per creep
    tickClouds(game, p);
    tickMissiles(game, p); // v0.27lF
    // BOSS T2 Clockwork: every 8.25 s a Siege Golem with 50 mana calls two clockwork escorts.
    const clockwork = Math.floor(game.time / 8.25) !== Math.floor((game.time - TICK) / 8.25);
    for (const c of p.creeps) {
      if (c.mana !== undefined) c.mana = Math.min(obj(c.typeId).mana, c.mana + (obj(c.typeId).manaRegen || 0) * TICK);
      if (clockwork && CLOCKWORK_ESCORTS && c.typeId === "n015" && !c.dead && c.mana >= 50 && obj("n01W")) {
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
    if (p.autoSend && p.autoSendActive !== false && !p.autoHold && game.tick % AUTO_EVERY === 0 && p.gold >= (obj(p.autoSend)?.cost ?? Infinity))
      command(game, { type: "send", player: p.id, id: p.autoSend, auto: true });
    else if (!p.autoSend && (p.autoMode === "eco" || p.autoMode === "tierup") && p.autoSendActive !== false && !p.autoHold && game.tick % AUTO_EVERY === 0) autoModeSend(game, p); // v0.18h
    if (p.ai) think(game, p);
  }
  // v0.23: made anew only when an event was added (game.eventId) or its oldest entry left the 0.35 s window (event
  // times never decrease, so the rest is still inside); plain loop with a constant type set
  const fx = EFFECTS_CACHE.get(game);
  if (!fx || fx.eventId !== game.eventId || fx.list !== game.effects || (fx.list.length && !(game.time - fx.list[0].time < 0.35))) {
    const effects = [];
    for (const e of game.events) if (game.time - e.time < 0.35 && EFFECT_TYPES.has(e.type)) effects.push(e);
    game.effects = effects;
    EFFECTS_CACHE.set(game, { eventId: game.eventId, list: effects });
  }
}
const EFFECT_TYPES = new Set(["shot", "kill", "leak", "build"]);
const EFFECTS_CACHE = new WeakMap(); // v0.23: never saved or sent
// v0.23: every send of a tier, as the restock loop in fixedTickInner needs them (per catalog; never changed by a caller)
const STOCK_TIER = new Map();
let stockTierCatalog = null;
function stockTierSends(tier) {
  const catalog = getCatalog();
  if (stockTierCatalog !== catalog) {
    STOCK_TIER.clear();
    stockTierCatalog = catalog;
  }
  let list = STOCK_TIER.get(tier);
  if (!list) STOCK_TIER.set(tier, (list = catalog.sends.filter((s) => s.tier === tier)));
  return list;
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
/**
 * v0.23: `{ lean: true }` (online backup snapshots) leaves out the walking routes of ground creeps, about
 * 70 % of a late-game snapshot; restoreGame rebuilds them the way the simulation re-routes after a build.
 * `events: false` sends an empty event list. One JSON pass, no parse/stringify round trip.
 */
export function serializeGame(game, options = null) {
  if (!options?.lean && options?.events !== false) return JSON.stringify(game);
  return JSON.stringify(leanGame(game, options || {}));
}
function leanGame(game, { lean = false, events = true } = {}) {
  return {
    ...game,
    ...(events === false ? { events: [] } : {}),
    players: lean ? game.players.map((p) => ({ ...p, creeps: p.creeps.map(leanCreep) })) : game.players,
  };
}
function leanCreep(c) {
  // flyers (2 nodes), creeps mid knock-back and creeps at the end of their route keep the whole route
  if (c.flying || c.knock || !Array.isArray(c.path) || c.pathIndex >= c.path.length) return c;
  const head = c.path[c.pathIndex],
    { path, ...rest } = c;
  if (!head || !Number.isInteger(head.gridX)) return c;
  return { ...rest, pathIndex: 0, prevNode: behindOf(c), pathHead: [head.gridX, head.gridY] };
}
/** v0.23: a ground creep without a usable route walks on from the nearest field that still leads to the exit. */
function snapCreep(game, p, c) {
  const d = exitDistances(game, p),
    { cols } = game.grid,
    rows = laneRows(game, p),
    g = gridAt(game, c);
  let best = null;
  for (let y = -1; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      if (d[square(game, x, y)] < 0) continue;
      const m = Math.abs(x - g.x) + Math.abs(y - g.y);
      if (!best || m < best.m) best = { x, y, m };
    }
  if (!best) return [];
  const at = pos(game, best.x, best.y);
  c.x = at.x;
  c.y = at.y;
  return findPath(game, p.id, best) || [];
}
/** v0.23: routes of a restored snapshot: lean creeps re-route from the node they were heading to (like repath). */
function restoreCreepPaths(game, p) {
  for (const c of p.creeps) {
    if (c.flying || (c.pathHead === undefined && Array.isArray(c.path))) continue;
    const head = Array.isArray(c.pathHead) && c.pathHead.every(Number.isInteger) ? c.pathHead : null;
    delete c.pathHead;
    c.path = head ? [pos(game, head[0], head[1])] : [];
    c.pathIndex = 0;
    c.path = creepPathFrom(game, p.id, c);
    if (!c.path.length) c.path = snapCreep(game, p, c);
  }
}
/** v0.21: a save from before the upgrade-to-perk change: research levels become perk levels, open upgrade options perks. */
function migrateResearchPerks(game) {
  for (const p of game?.players || []) {
    if (!p?.research) continue;
    for (const [rid, pid] of Object.entries(RESEARCH_PERKS)) {
      const level = p.research[rid] || 0;
      if (level > 0) p.perks = { ...(p.perks || {}), [pid]: Math.max(p.perks?.[pid] || 0, level) };
      delete p.research[rid];
      if (p.perkTakenAt?.[rid] != null) p.perkTakenAt = { ...p.perkTakenAt, [pid]: p.perkTakenAt[rid] };
    }
    delete p.research.R01P; // the hidden arrow upgrade Fire Arrows raised
    for (const pick of p.picks || []) pick.options = (pick.options || []).map((o) => (o.type === "research" && RESEARCH_PERKS[o.id] ? { type: "perk", id: RESEARCH_PERKS[o.id] } : o));
  }
}
export function restoreGame(serialized) {
  const game = typeof serialized === "string" ? JSON.parse(serialized) : structuredClone(serialized);
  migrateResearchPerks(game); // v0.21
  if (!isCompatibleGameGrid(game)) {
    const error = new Error(
      "This save belongs to another game version or board size. Its positions can't be used as they are.",
    );
    error.code = "incompatible-save";
    throw error;
  }
  if (
    !Array.isArray(game.players) ||
    !(game.players.length >= 2 && game.players.length <= 6) || // v0.21a: online matches hold 2 to 6 players
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
    // v0.23: a creep standing on a tower field (it was walking there when the tower went up) no longer
    // rejects the save (42 % of live online snapshots were refused); its route is rebuilt below instead
    if (
      !findPath(game, p.id) ||
      p.creeps.some((c) => !Number.isFinite(c.x) || !Number.isFinite(c.y) || c.x < 0 || c.x > 1 || c.y < -0.2 || c.y > 1.2)
    )
      throw new Error("Save contains a blocked or invalid path");
    restoreCreepPaths(game, p);
  }
  return game;
}
export const saveGame = serializeGame;
export const loadGame = restoreGame;
