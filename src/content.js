/** Read-only WC3 object-data adapter. Values retain original IDs and provenance. */
export const cleanText = (value) =>
  String(value ?? "")
    .replace(/\|c[\da-f]{8}/gi, "")
    .replace(/\|r/g, "")
    .replace(/\|n/g, "\n")
    .replace(/\r/g, "");
export const splitIds = (value) =>
  String(value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v && v !== "_" && v !== "-");
export function field(fields, key, level = 0) {
  const value = fields?.[key];
  if (value && typeof value === "object") return value[level] ?? value[1] ?? value[0] ?? Object.values(value)[0];
  return value;
}
const n = (value, fallback = null) =>
  value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback;
/** v0.12: Wall (Fortifications) and Arcane Golem, units of the port itself. */
export const WALL_ID = "hWAL",
  GOLEM_ID = "nAGO";
export const FACTIONS = [
  { id: "water", name: "Water", color: "#68caff", research: "R00N", unlock: "R01D" },
  { id: "fire", name: "Fire", color: "#ff9169", research: "R00M", unlock: "R01G" },
  { id: "storm", name: "Storm", color: "#bcbcff", research: "R00O", unlock: "R01E" },
  { id: "earth", name: "Earth", color: "#e4b575", research: "R00Q", unlock: "R01I" },
  { id: "arcane", name: "Arcane", color: "#f59eda", research: "R00R", unlock: "R01H" },
  { id: "plague", name: "Plague", color: "#a9de7e", research: "R00P", unlock: "R01F" },
];
export const RULES = {
  initialGold: 30, // v0.08c: 40 → 30, plus one free archer
  initialIncome: 20,
  initialLumber: 0,
  initialLives: 30,
  incomeInterval: 15,
  warmup: 10, // v0.16: 12 → 10 s
  suddenDeathRound: 120,
  suddenDeathFloor: 5,
  touchdownWood: 15,
  firstBloodWood: 50, // v0.09w: 75 → 50
  defeatWood: 150,
  armorFactor: 0.05,
  source: "war3map.j:1491-1530,3393-3394,5809,7029-7032,21350-21505; war3mapMisc.txt:DefenseArmor",
  damageMatrix: {
    normal: [0.7, 1, 1, 1, 1, 0.5, 0.4, 1],
    pierce: [1, 1, 0.7, 0, 1, 0.33, 0.15, 0.7],
    magic: [1, 0.7, 1.25, 1, 1, 0.6, 0.3, 0.6],
    siege: [0.7, 1, 0.7, 1, 1, 0.33, 0.2, 1.1],
    hero: [1, 1, 1, 0.5, 1, 1, 0.5, 1],
    chaos: [0.7, 1, 1, 1, 1, 0.85, 1, 1.25],
    spells: [1, 1, 1, 1, 1, 1, 1, 1],
  },
  defenseOrder: ["small", "medium", "large", "fort", "normal", "hero", "divine", "none"],
  spiritIncome: [0, 3, 7, 12, 18, 25, 33, 42, 52, 63, 75],
};
const SHOPS = ["H049", "H04A", "H04E", "H04B", "H04K", "H02K"];
/** Researches a player can hold (elements, their upgrades, level rewards). */
const PLAYER_RESEARCH = ["R00K", "R00M", "R00N", "R00O", "R00P", "R00Q", "R00R", "R00U", "R00V", "R00W", "R00X", "R001", "R002", "R005", "R006", "R00C", "R00D", "R00J"]; // v0.17b: Forged Arrows (R000) and Improved Construction (R013) removed
const NO_INCOME = new Set(["n00Y", "n01H", "n01D", "n01R", "n01T", "n02P", "n02Q", "n02R"]);
const NO_DECIMAL = new Set(["n00Y", "n01D", "n01R", "n02N", "n01T", "n02P", "n02Q", "n02R"]);
const TRIPLES = new Set(["n00P", "n00U", "n01L", "n01S", "n017"]);
const BASE_TOWER_HP = { hhou: 500, hgtw: 500, hctw: 500, hatw: 500 };
const BOSS_TIERS = { n00T: 2, n015: 3, n01H: 4, n01T: 5, n02R: 6 };
let current = null;

function records(data) {
  return Array.isArray(data) ? data : [...(data?.original ?? []), ...(data?.custom ?? [])];
}
function mergeObjects(data) {
  const out = new Map();
  for (const item of records(data)) out.set(item.id, { ...item, fields: { ...item.fields } });
  // Custom objects inherit pristine Warcraft SLK data, NOT this map's modified
  // original records. Those base archives are absent; keep missing values explicit.
  return out;
}

export function configureContent(data) {
  const rawUnits = mergeObjects(data.units),
    rawUpgrades = mergeObjects(data.upgrades),
    rawAbilities = mergeObjects(data.abilities);
  // v0.17b: own creep abilities (not in the map data): damage resistance against one tower line
  for (const a of CUSTOM_ABILITIES) rawAbilities.set(a.id, { ...a, fields: { ...a.fields } });
  // v0.17p: ability fixes (field patches, removed and added abilities per unit)
  for (const [id, patch] of Object.entries(ABILITY_PATCH)) {
    const a = rawAbilities.get(id);
    if (a) rawAbilities.set(id, { ...a, ...(patch.props || {}), fields: { ...a.fields, ...(patch.fields || {}) } });
  }
  for (const [id, raw] of rawUnits) {
    const list = splitIds(raw.fields.uabi),
      next = list.flatMap((x) => (UNIT_ABILITY_SWAP[id]?.[x] !== undefined ? [UNIT_ABILITY_SWAP[id][x]].filter(Boolean) : REMOVED_ABILITIES.has(x) ? [] : [x]));
    for (const x of UNIT_ABILITY_ADD[id] || []) if (!next.includes(x)) next.unshift(x);
    if (next.join(",") !== list.join(",")) rawUnits.set(id, { ...raw, fields: { ...raw.fields, uabi: next.join(",") } });
  }
  const byId = {},
    allUnits = [],
    allResearch = [];
  const buildRoots = [
    ...new Set([...splitIds(rawUnits.get("h002")?.fields.ubui), ...splitIds(rawUnits.get("h01Q")?.fields.ubui)]),
  ];
  const towerSet = new Set(buildRoots);
  const traverse = (id) => {
    for (const next of upgradeIds(rawUnits.get(id)?.fields.uupt))
      if (!towerSet.has(next)) {
        towerSet.add(next);
        traverse(next);
      }
  };
  buildRoots.forEach(traverse);
  // Auto Construction contains later direct-build unlocks. Retain them as catalog items.
  splitIds(rawUnits.get("h03O")?.fields.ubui).forEach((id) => {
    towerSet.add(id);
    traverse(id);
  });
  const hallSet = new Set(["h05L"]);
  const hallTraverse = (id) => {
    for (const next of upgradeIds(rawUnits.get(id)?.fields.uupt))
      if (!hallSet.has(next)) {
        hallSet.add(next);
        hallTraverse(next);
      }
  };
  hallTraverse("h05L");
  const sendTiers = new Map();
  SHOPS.forEach((shop, i) =>
    splitIds(rawUnits.get(shop)?.fields.useu).forEach((id) => {
      if (!sendTiers.has(id)) sendTiers.set(id, i + 1);
    }),
  );
  // v0.09d: the builder's research pages (Wisps) are gone from the data; the researches the
  // player can own are listed here instead.
  const playerResearch = new Set(PLAYER_RESEARCH);
  for (const raw of rawUnits.values()) {
    const f = raw.fields,
      missing = [],
      assumptions = [];
    const value = (key, fallback = null) => {
      const v = n(f[key]);
      if (v !== null) return v;
      missing.push(key);
      if (fallback !== null)
        assumptions.push({ field: key, value: fallback, reason: "Warcraft base value missing; explicit port fallback" });
      return fallback;
    };
    const isTower = towerSet.has(raw.id),
      isSend = sendTiers.has(raw.id),
      description = cleanText(f.utub);
    const name = cleanText(f.unam || raw.id),
      damageBase = value("ua1b", 0),
      dice = value("ua1d", 0),
      sides = value("ua1s", 0);
    const nameElement = description.match(/Element\s+(Water|Fire|Earth|Storm|Arcane|Plague)/i)?.[1]?.toLowerCase();
    const defenseType = f.udty || "medium";
    if (!f.udty)
      assumptions.push({
        field: "udty",
        value: defenseType,
        reason: "Warcraft base armour type missing; port fallback medium",
      });
    const abilities = splitIds(f.uabi),
      attacks = n(f.uaen, damageBase + dice > 0 ? 1 : 0) > 0;
    const unit = {
      id: raw.id,
      baseId: raw.baseId,
      name,
      shortName: name.replace(/^\[[^\]]+\]\s*/, "").replace(/\s*\[[^\]]+\]/g, ""),
      description,
      kind: isTower ? "tower" : isSend ? "send" : "unit",
      cost: value("ugol"),
      woodCost: value("ulum", 0),
      hp: value("uhpm"),
      regen: value("uhpr", 0),
      damage: damageBase + (dice * (sides + 1)) / 2,
      damageBase,
      dice,
      sides,
      attacks,
      damageUpgrade: value("udu1", 0),
      armorUpgrade: value("udup", 0),
      cooldown: value("ua1c", 1),
      range: value("ua1r", 0),
      attackType: f.ua1t || "normal",
      defenseType,
      armor: value("udef", 0),
      speed: value("umvs", 240),
      flying: f.umvt === "fly",
      movementType: f.umvt || "foot",
      targets: splitIds(f.ua1g || "ground,air"),
      weapon: f.ua1w || "normal",
      splashFull: value("ua1f", 0),
      splashMedium: value("ua1h", 0),
      splashSmall: value("ua1q", 0),
      splashMediumFactor: value("uhd1", 0.5),
      splashSmallFactor: value("uqd1", 0.25),
      bountyBase: value("ubba", 0),
      bountyDice: value("ubdi", 0),
      bountySides: value("ubsi", 0),
      pointValue: value("upoi", 0),
      buildTime: value("ubld", 1),
      mana: value("umpm", 0),
      manaRegen: value("umpr", 0),
      upgrades: upgradeIds(f.uupt),
      researchAffected: splitIds(f.upgr),
      requires: splitIds(f.ureq).map((id, i) => ({ id, level: n(splitIds(f.urqa)[i], 1) })),
      abilities,
      fields: f,
      source: { file: "war3map.w3u", id: raw.id, baseId: raw.baseId, byteOffset: raw.byteOffset },
      element: nameElement || "neutral",
      level: n(name.match(/Level\s+(\d+)/i)?.[1], 1),
      tier: sendTiers.get(raw.id) || 0,
      stockMax: value("usma", 99),
      stockRegen: value("usrg", 0),
      stockStart: value("usst", 0),
      missingFields: missing,
      assumptions,
      isRoot: buildRoots.includes(raw.id),
      isBuildable: isTower,
      isSend,
      bossTier: BOSS_TIERS[raw.id] || null,
      isHall: hallSet.has(raw.id),
      income: NO_INCOME.has(raw.id) ? 0 : value("upoi", 0) + (raw.id === "n00E" ? 0.17 : raw.id === "n00U" ? 0.5 : 0),
      incomeHundredths: raw.id === "n00E" ? 17 : raw.id === "n00U" ? 50 : 0, // JASS decimal income
      decimalEligible: !NO_DECIMAL.has(raw.id),
      spawnIds: (f.utyp || "").includes("ancient") ? [raw.id] : Array(TRIPLES.has(raw.id) ? 3 : 2).fill(raw.id),
      sellRate: ["h003", "h000", "h02R", "h03V", "h05L"].includes(raw.id) ? 0.5 : 0.75,
      support: raw.id === "h02Q" ? "farm" : ["h01F", "h023", "h026", "h027"].includes(raw.id) ? "lumber" : null,
      woodIncome: { h01F: 1, h023: 2, h026: 3, h027: 4 }[raw.id] || 0,
      implementedAbilities: [],
      unimplementedAbilities: abilities.slice(),
      inactiveInSource: sendTiers.get(raw.id) === 6,
    };
    // Towers inherit missing life from their Warcraft base object (Farm hhou and
    // Guard Tower hgtw both have 500). Recorded as an assumption, never hidden.
    if (isTower && unit.hp === null && Object.hasOwn(BASE_TOWER_HP, raw.baseId)) {
      unit.hp = BASE_TOWER_HP[raw.baseId];
      assumptions.push({ field: "uhpm", value: unit.hp, reason: `Warcraft base object ${raw.baseId}: default hit points` });
    }
    // Pure adapters never silently fabricate essential purchase values.
    unit.playable = (isTower || isSend) && unit.cost !== null && unit.hp !== null;
    if (!unit.playable && (isTower || isSend))
      unit.unavailableReason = "Warcraft base values for price or life are missing.";
    // The only sapper send (Witch Doctor) curses towers through its Slow ability; the port runs that curse.
    if (isSend && (f.utyp || "").includes("sapper") && !abilities.some((id) => rawAbilities.get(id)?.baseId === "Aslo")) {
      unit.playable = false;
      unit.unavailableReason = "Sapper attacks on buildings aren't ported yet; purchase locked.";
    }
    // Second weapon (Bash towers hit air with ua2*).
    if (f.ua2g && f.ua2r) {
      const b = n(f.ua2b, 0),
        d = n(f.ua2d, 0),
        sd = n(f.ua2s, 0);
      unit.weapon2 = {
        damageBase: b,
        dice: d,
        sides: sd,
        damage: b + (d * (sd + 1)) / 2,
        cooldown: n(f.ua2c, 1),
        range: n(f.ua2r, 0),
        attackType: f.ua2t || "normal",
        targets: splitIds(f.ua2g),
      };
    }
    // Water and Fire Elementals are strictly anti-air (weapon 1 targets air only).
    byId[unit.id] = unit;
    allUnits.push(unit);
  }
  // Archers upgrade only into Archer level 2 (no guard, cannon or magic branch from level 1).
  const UPGRADE_LIMITS = { h003: ["h02S"] };
  for (const [id, keep] of Object.entries(UPGRADE_LIMITS)) if (byId[id]) byId[id].upgrades = byId[id].upgrades.filter((u) => keep.includes(u));
  // The former lumbermill is the EXP generator: built directly, gives EXP every income round.
  if (byId.h01F) byId.h01F.isRoot = true;
  // Wood is gone from the game: nothing costs wood any more.
  for (const u of allUnits) u.woodCost = 0;
  applyCreepTuning(byId);
  applyTowerDamageBuff(byId);
  // v0.17c: the Arcane Tower line loses its Detector ability
  for (const u of allUnits)
    if (u.isBuildable && /^Arcane Tower$/.test(u.shortName || "")) {
      const keep = (id) => rawAbilities.get(id)?.baseId !== "Adtg";
      u.abilities = u.abilities.filter(keep);
      u.unimplementedAbilities = u.unimplementedAbilities.filter(keep);
    }
  // v0.12: units that only perks bring into play
  if (byId.h000) {
    const base = byId.h000;
    // Fortifications: a cheap wall without attack for mazing (sells for 1 gold)
    const wall = {
      ...base,
      id: WALL_ID,
      name: "Wall",
      shortName: "Wall",
      description: "A plain stone wall for cheap mazes. No attack. Double-tap to sell it.",
      cost: 5,
      hp: 400,
      regen: 0,
      armor: 5,
      defenseType: "fortified",
      damage: 0,
      damageBase: 0,
      dice: 0,
      sides: 0,
      attacks: false,
      range: 0,
      targets: [],
      cooldown: 1,
      upgrades: [],
      requires: [],
      researchAffected: [],
      abilities: [],
      implementedAbilities: [],
      unimplementedAbilities: [],
      fields: {},
      weapon2: undefined,
      buildTime: 1,
      pointValue: 2,
      sellRate: 0.5,
      level: 1,
      element: "neutral",
      isRoot: true,
      isBuildable: true,
      playable: true,
      support: null,
      woodIncome: 0,
      perkUnit: "fort",
      source: { file: "port", id: WALL_ID },
    };
    byId[WALL_ID] = wall;
    allUnits.push(wall);
    // v0.17: campaign rocks: block a field until cleared for gold or cracked by stealing lives
    const rock = {
      ...wall,
      id: "hROK",
      name: "Rock",
      shortName: "Rock",
      description: "A boulder in your maze. Clear it for gold, or crack it by stealing lives from your enemy.",
      cost: 0,
      hp: 1000,
      pointValue: 0,
      isRoot: false,
      isBuildable: false,
      perkUnit: null,
      source: { file: "port", id: "hROK" },
    };
    byId.hROK = rock;
    allUnits.push(rock);
  }
  if (byId.n00T) {
    // Arcane Golem: walks a maze upwards, then runs on as a creep in the next lane
    const golem = {
      ...byId.n00T,
      id: GOLEM_ID,
      name: "Arcane Golem",
      shortName: "Arcane Golem",
      description: "Summoned by the Arcane Golem perk.",
      kind: "unit",
      isSend: false,
      bossTier: null,
      tier: 0,
      cost: 0,
      income: 0,
      pointValue: 0,
      bountyBase: 0,
      bountyDice: 0,
      bountySides: 0,
      speed: 128, // 1.00 field per second (before the arena's 45 %)
      defenseType: "medium",
      abilities: [],
      implementedAbilities: [],
      unimplementedAbilities: [],
      researchAffected: [],
      spawnIds: [GOLEM_ID],
      playable: false,
      perkUnit: "agolem",
      source: { file: "port", id: GOLEM_ID },
    };
    byId[GOLEM_ID] = golem;
    allUnits.push(golem);
  }
  // Wisp "pages" are the builder's research-menu scrollers, not towers.
  for (const u of allUnits) {
    if (/^Wisp\b/.test(u.name)) u.playable = false;
    u.upgrades = u.upgrades.filter((id) => !/^Wisp\b/.test(byId[id]?.name || ""));
  }
  for (const raw of rawUpgrades.values()) {
    const f = raw.fields;
    const r = {
      id: raw.id,
      baseId: raw.baseId,
      kind: "research",
      name: cleanText(field(f, "gnam", 1) || raw.id),
      description: cleanText(field(f, "gub1", 1)),
      cost: n(field(f, "gglb")),
      woodCost: n(field(f, "glmb")),
      costIncrement: n(field(f, "gglm"), 0),
      woodIncrement: n(field(f, "glmm"), 0),
      maxLevel: n(field(f, "glvl"), 1),
      time: n(field(f, "gtib"), 0),
      timeIncrement: n(field(f, "gtim"), 0),
      effects: [1, 2, 3, 4]
        .map((i) => ({
          type: field(f, "gef" + i),
          base: n(field(f, "gba" + i), 0),
          increment: n(field(f, "gmo" + i), 0),
          code: field(f, "gco" + i),
        }))
        .filter((e) => e.type),
      fields: f,
      playerResearch: playerResearch.has(raw.id),
      source: { file: "war3map.w3q", id: raw.id, baseId: raw.baseId, byteOffset: raw.byteOffset },
      requires: splitIds(f.greq?.[1]).map((id, i) => ({ id, level: n(splitIds(f.grqc?.[1])[i], 1) })),
    };
    r.playable = r.playerResearch && r.cost !== null && r.woodCost !== null;
    r.unsupportedEffects = r.effects
      .filter((e) => !["ratt", "ratx", "rats", "rarm", "rhpo", "rhpx", "rhpr", "ratr", "rmov", "rman"].includes(e.type))
      .map((e) => e.type);
    r.effectCoverage = r.unsupportedEffects.length
      ? "Partly: internal ability levels / spell triggers not fully ported"
      : "Numeric effects";
    byId[r.id] = r;
    allResearch.push(r);
  }
  const triggerResearch = new Set([...FACTIONS.map((f) => f.research), "R00D", "R00W", "R001", "R006"]);
  // Heavy Weapons sets only the effect type ("ratt", percent damage);
  // the tooltips state +5 % per level, recorded as the value instead of guessing natives.
  for (const id of ["R005"]) {
    const r = byId[id];
    if (!r) continue;
    for (const e of r.effects) if (e.type === "ratt" && !e.base && !e.increment) Object.assign(e, { base: 0.05, increment: 0.05 });
    r.assumption = "Value from the tooltip: +5 % damage per level";
  }
  // Fire tree: researching R00J raises the internal arrow upgrade R01P (ratt +10 %/level).
  if (byId.R00J && byId.R01P) {
    byId.R00J.effects = byId.R01P.effects.map((e) => ({ ...e }));
    for (const u of allUnits) if (u.researchAffected.includes("R01P") && !u.researchAffected.includes("R00J")) u.researchAffected.push("R00J");
    byId.R00J.effectCoverage = "As in the original: raises the internal arrow upgrade R01P";
  }
  // v0.13: Watcher Owl: three levels; its range bonus (archer line only) is applied in simulation.js
  if (byId.R00K) {
    byId.R00K.maxLevel = 3;
    byId.R00K.effects = [];
    byId.R00K.description = "Archer-line towers: +0.5 / +0.33 / +0.25 fields range per level";
    for (const u of allUnits) u.researchAffected = u.researchAffected.filter((id) => id !== "R00K");
    triggerResearch.add("R00K");
  }
  // v0.19a1: reworked level-up upgrades: effects in simulation.js (PERK_REWORK), own max levels
  for (const id of ["R002", "R00C", "R001", "R006", "R00X", "R00W", "R00U"]) {
    const r = byId[id];
    if (!r) continue;
    r.effects = [];
    for (const u of allUnits) u.researchAffected = u.researchAffected.filter((x) => x !== id);
    triggerResearch.add(id);
  }
  for (const [id, max] of Object.entries({ R002: 20, R00V: 20, R00D: 10, R00C: 10, R001: 10, R006: 10, R00X: 10, R00W: 10, R00U: 10, R00K: 5 })) if (byId[id]) byId[id].maxLevel = max;
  if (byId.R00K) byId.R00K.description = "Archer-line towers: +0.5 / +0.33 / +0.25 / +0.2 / +0.17 fields range per level";
  // v0.09d: the empty fire-tree steps and the "[Elemental] X" pages were removed from the data.
  for (const r of allResearch) {
    r.affectedUnits = allUnits.filter((u) => u.researchAffected.includes(r.id)).map((u) => u.id);
    r.missingEffects = r.effects
      .filter((e) => e.type === "ratt" || (!e.base && !e.increment && e.type !== "rarm"))
      .map((e) => e.type);
    const numerical =
      r.affectedUnits.length > 0 &&
      r.effects.some(
        (e) =>
          ["ratx", "rats", "rarm", "rhpo", "rhpx", "rhpr", "ratr", "rmov", "rman"].includes(e.type) &&
          (e.base || e.increment || e.type === "rarm"),
      );
    const percent = r.affectedUnits.length > 0 && r.effects.some((e) => e.type === "ratt" && (e.base || e.increment));
    r.portedEffect = numerical || percent || triggerResearch.has(r.id);
    if (r.placeholder) {
      r.playable = false;
      r.unavailableReason = "A placeholder of the fire tree without its own effect in the original.";
    } else if (r.hidden) {
      r.playable = false;
      r.unavailableReason = "Elements are bought through element research.";
    } else if (r.playable && !r.portedEffect) {
      r.playable = false;
      r.unavailableReason = "Research effect not ported yet or Warcraft base values missing; purchase locked.";
    }
    r.missingEffects = r.missingEffects.filter((t) => !(t === "ratt" && percent));
    if (r.missingEffects.length) r.effectCoverage = "Partly: missing native effect values are not made up";
  }
  current = {
    version: 1,
    factions: FACTIONS,
    towers: allUnits.filter((u) => u.isBuildable),
    sends: allUnits.filter((u) => u.isSend).sort((a, b) => a.tier - b.tier || a.cost - b.cost),
    research: allResearch.filter((r) => r.playerResearch && !r.hidden),
    allResearch,
    allUnits,
    byId,
    buildRoots,
    rules: RULES,
    abilities: Object.fromEntries(rawAbilities),
    counts: {
      units: allUnits.length,
      towers: towerSet.size,
      sends: sendTiers.size,
      research: playerResearch.size,
      abilities: rawAbilities.size,
    },
    limitations: [
      "Port with the original values; no full Warcraft engine or JASS emulation.",
      "Missing Warcraft base values are listed per object in assumptions; price and hit points are never made up.",
      "Geometry, collision and AI are mobile implementations of their own.",
      "Special spells without an implementation are marked as such.",
      "Team rules of the original map are not active.",
    ],
  };
  return current;
}

/**
 * Balancing table for creeps. It mirrors the project doc "Creep-Werte (Balancing)": every value
 * here replaces the original map value for that creep. Fields: cost, income, hp, armor,
 * defenseType, speed (game units: 128 = one field per second), count (creeps per purchase),
 * flying, stockMax, stockRegen (seconds per recruit), stockStart (seconds before the first).
 */
/**
 * v0.17b: own creep abilities. "Xlrs" = less damage from every tower of one line (`line` = the
 * line's root tower: h003 Archer, h02R Bombard). simulation.js reads `line` and `reduce`.
 */
export const CUSTOM_ABILITIES = [
  { id: "XA01", baseId: "Xlrs", custom: true, line: "h003", reduce: 0.33, fields: { anam: { 0: "Arrow Resistance" }, aub1: { 1: "Takes 33% less damage from Archer-line towers" } } },
  { id: "XA02", baseId: "Xlrs", custom: true, line: "h02R", reduce: 0.33, fields: { anam: { 0: "Siege Resistance" }, aub1: { 1: "Takes 33% less damage from Bombard-line towers" } } },
  { id: "XA03", baseId: "Xinf", custom: true, fields: { anam: { 0: "Deathrattle" }, aub1: { 1: "Summons 3 Skeletons on death" } } }, // v0.17g: display only (the spawn runs through DEATH_PLANS)
  // v0.17p: Pit Lord tower: Howl. When creeps come near it howls: creeps within 1.5 fields are slowed and take more tower damage for 12 s.
  { id: "XA04", baseId: "Xhwl", custom: true, radius: 192, slow: 0.25, amp: 0.2, duration: 12, cooldown: 20, fields: { anam: { 0: "Howl" }, aub1: { 1: "Creeps within 1.5 fields: 25% slower, +20% tower damage for 12 s" } } },
  // v0.17p: Phoenix: Phoenix Fire as an immolation aura with full damage to ground and air
  { id: "XA05", baseId: "AIcf", custom: true, fields: { anam: { 0: "Phoenix Fire" }, aare: { 1: 192 }, aub1: { 1: "Deals 350 damage per second\nRange 192\nTargets Ground & Air" } } },
  // v0.18b: Earth Laser: Focus Fire. While the tower keeps hitting the same creep, its damage rises by 10 % every 0.25 s, up to 500 %.
  // v0.18e: Orc: buying one restocks one Goblin at once (display only; the restock runs in simulation.js)
  { id: "XA07", baseId: "Xinf", custom: true, fields: { anam: { 0: "Call the Peons" }, aub1: { 1: "When bought: restocks 1 Goblin" } } },
  { id: "XA06", baseId: "Xfoc", custom: true, step: 0.1, interval: 0.25, max: 5, fields: { anam: { 0: "Focus Fire" }, aub1: { 1: "Damage +10% every 0.25 s while attacking the same target, up to 500%" } } },
];
/**
 * v0.17p: ability fixes.
 * - Critical Hit (Zombie Tower 4-6) and Critical Shot (Bird Hunter 4-6): 10/12/15 % chance for
 *   200/250/300 % damage, keyed by tower level; no research needed any more.
 * - Endurance Aura is now one "Speed Aura" for ground and air; flyers get half the bonus (`airFactor`).
 */
const speedAura = (bonus) => ({
  fields: { anam: { 0: "Speed Aura" }, Oae1: { 1: bonus }, atar: { 1: "ground,air,friend,self,invulnerable,vulnerable" }, aub1: { 1: `Creeps nearby run ${Math.round(bonus * 100)}% faster (flyers half)` } },
  props: { airFactor: 0.5 },
});
const CRIT_BY_LEVEL = { alev: { 0: 6 }, Ocr1: { 4: 0.1, 5: 0.12, 6: 0.15 }, Ocr2: { 4: 2, 5: 2.5, 6: 3 }, areq: { 0: "" } };
const ABILITY_PATCH = {
  A02K: { fields: CRIT_BY_LEVEL }, // Zombie Tower: Critical Hit (was stored as 12 instead of 0.12, so every hit crit)
  A03Q: speedAura(0.1), // Alchemist, Tauren Chief (the ground bonus was 0)
  A03P: speedAura(0.15), // Grom Hellscream
  A01U: speedAura(0.18), // Cairne Bloodhoof
  A03M: speedAura(0.2), // Demon Hunter, Lord Garithos
};
/** Removed everywhere: Critical Shot (Bird Hunter, v0.18a), Blitz Weapon + its lightning (Bash Tower), Poison Weapon (Death Knight), the air halves of Endurance Aura, every Unholy Aura. */
const REMOVED_ABILITIES = new Set(["A05Q", "A00P", "A01W", "A02S", "A06K", "A08E", "A08G", "A08I", "A09R", "A0D3", "A06X", "A09O"]);
/** v0.18b: towers taken out of the game (Archangel); no tower upgrades into them any more. */
const REMOVED_UNITS = new Set(["h022"]);
const upgradeIds = (s) => splitIds(s).filter((id) => !REMOVED_UNITS.has(id));
/** Per unit: map ability → replacement ("" removes it). */
const UNIT_ABILITY_SWAP = {
  h024: { A09W: "" }, // Naga Archer: no Howl
  h01Z: { A09W: "XA04" }, // Pit Lord tower: working Howl
  h020: { A0CI: "XA05" }, // Phoenix: Phoenix Fire is an immolation aura
  // v0.18b: Earth Laser: Focus Fire instead of Armor Disruption
  h03R: { A0BG: "XA06" },
  h03X: { A0BG: "XA06" },
  h03Y: { A0BG: "XA06" },
  h03Z: { A0BG: "XA06" },
};
/** Per unit: abilities added in front. */
const UNIT_ABILITY_ADD = {};
/**
 * v0.18a: tower damage buffs in percent of the average damage, rounded up to the next whole number.
 * The difference is added to the flat damage part, so the dice spread stays the same.
 */
export const TOWER_DAMAGE_BUFF = {
  h05B: 0.05, // Bird Hunter level 3: 45 → 48
  h03A: 0.075, // Bird Hunter level 4: 135 → 146
  h03B: 0.1, // Bird Hunter level 5: 375 → 413
  h03N: 0.1, // Bird Hunter level 6: 900 → 990
};
function applyTowerDamageBuff(byId) {
  for (const [id, pct] of Object.entries(TOWER_DAMAGE_BUFF)) {
    const u = byId[id];
    if (!u || !(u.damage > 0)) continue;
    const next = Math.ceil(u.damage * (1 + pct) - 1e-9);
    u.damageBase += next - u.damage;
    u.damage = next;
  }
}
export const CREEP_TUNING = {
  n00E: { income: 1, cost: 5, stockMax: 18 }, // Goblin: income 1.17 → 1 (v0.07g), cost 6 → 5 (v0.07h); peon companion removed (v0.07i); stock 16 → 18 (v0.08b)
  n007: { cost: 10, income: 1.9 }, // Horse: cost 12 → 10, income 2 → 1.9 (v0.08b)
  n00K: { income: 3.5 }, // Gnoll: income 3 → 3.5 (v0.08d)
  n00M: { hp: 312, count: 1, bountyBase: 11, name: "[06] Orc", shortName: "Orc", abilities: ["A01A", "XA02", "XA07"] }, // Grunt → Orc (v0.17b): hit points +30 %, 120 → 156 (v0.09s); Siege Resistance 33 % (v0.17b); v0.18e: one Orc per purchase (heavy), hit points 156 → 312, bounty 5+1d1 → 11+1d1 (12 per purchase as before), restocks 1 Goblin
  n00R: { abilities: ["A01A", "XA01"] }, // Skeleton: Arrow Resistance now 33 % less damage from Archer-line towers (v0.17b, was: ignores 1 ranged damage)
  n00N: { hp: 180, abilities: ["A01A", "XA03"] }, // Necromancer: hit points 170 → 180 (v0.17f); Unholy Aura removed, Deathrattle shown (v0.17g)
  n00P: { hp: 85, speed: 138.56, stockRegen: 11 }, // Flying Sheep: hit points 80 → 85, speed 1.06 → 1.08 fields/s (v0.17b); restock 10 → 11 s (v0.17o)
  n00L: { speed: 375 }, // Wolf: 25 % faster, 300 → 375 (v0.08d)
  n00S: { speed: 420, stockRegen: 13, income: 8 }, // Raider: 25 % faster (v0.07b); restock 12 → 13 s (v0.17o); income 9 → 8 (v0.17q)
  n010: { hp: 1300 }, // Forest Troll: hit points −10 %, 1450 → 1300 (v0.16i: broke through 5–8× as often as other tier-2 creeps in self-play)
};
function applyCreepTuning(byId) {
  // v0.09s: every creep except flyers and bosses wears medium armour
  for (const s of Object.values(byId)) {
    if (s.kind !== "send") continue;
    for (const id of new Set([s.id, ...(s.spawnIds || [])])) {
      const u = byId[id];
      if (u && !s.flying && !u.flying && u.movementType !== "fly" && u.defenseType !== "hero") u.defenseType = "medium";
    }
  }
  for (const [id, tune] of Object.entries(CREEP_TUNING)) {
    const u = byId[id];
    if (!u) continue;
    const { count, income, ...rest } = tune;
    Object.assign(u, rest);
    if (income !== undefined) {
      u.income = income;
      u.pointValue = Math.floor(income);
      u.incomeHundredths = Math.round((income - Math.floor(income)) * 100);
    }
    if (count) u.spawnIds = Array(count).fill(id);
    if (rest.flying !== undefined) u.movementType = rest.flying ? "fly" : "foot";
  }
}
export async function loadContent(base = new URL("../data/", import.meta.url)) {
  const names = ["units", "upgrades", "abilities"];
  const version = new URL(import.meta.url).searchParams.get("v");
  const result = await Promise.all(
    names.map(async (name) => {
      const url = new URL(name + ".json", base);
      if (version) url.searchParams.set("v", version);
      const response = await fetch(url);
      if (!response.ok) throw new Error("Catalog not loaded: " + name);
      return response.json();
    }),
  );
  return configureContent(Object.fromEntries(names.map((name, i) => [name, result[i]])));
}
export function getCatalog() {
  if (!current) throw new Error("Call await loadContent() or configureContent(data) first.");
  return current;
}
export function getResearchCost(id, level = 0) {
  const r = getCatalog().byId[id];
  if (!r || r.kind !== "research") return null;
  return {
    gold: r.cost === null ? null : r.cost + r.costIncrement * level,
    wood: r.woodCost === null ? null : r.woodCost + r.woodIncrement * level,
    time: r.time + r.timeIncrement * level,
  };
}
