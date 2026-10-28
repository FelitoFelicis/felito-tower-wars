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
  EXP_GEN_TOP_ID = "hXG5", // v0.24oF: fifth EXP generator level
  GOLEM_ID = "nAGO",
  MUD_GOLEM_ID = "nMDG", // v0.27F: tier 1 mini boss (send card; the Rock Golem's escort n01U stays its own unit)
  TRENCH_ORC_ID = "nTRO"; // v0.27hF: tier 2 Trench Orc (built from the Orc n00M; replaces the Giant Bat)
export const FACTIONS = [
  { id: "water", name: "Water", color: "#68caff", research: "R00N", unlock: "R01D" },
  { id: "fire", name: "Fire", color: "#ff9169", research: "R00M", unlock: "R01G" },
  { id: "storm", name: "Storm", color: "#bcbcff", research: "R00O", unlock: "R01E" },
  { id: "earth", name: "Earth", color: "#e4b575", research: "R00Q", unlock: "R01I" },
  { id: "arcane", name: "Arcane", color: "#f59eda", research: "R00R", unlock: "R01H" },
  { id: "plague", name: "Plague", color: "#a9de7e", research: "R00P", unlock: "R01F" },
];
export const RULES = {
  initialGold: 30, // v0.08c: 40 → 30; v0.23b: no free archer, the first two basic towers are cheaper
  initialIncome: 20,
  initialLumber: 0,
  initialLives: 30,
  incomeInterval: 15,
  warmup: 6, // v0.16: 12 → 10 s; v0.23b: 10 → 8 s; v0.23f: 8 → 6 s
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
export const REMOVED_SENDS = new Set(["n012", "n00Q", "n021", "n00Y", "n002", "n039", "n01R", "n02J", "n02P", "n01E", "n01B"]); // v0.27hF: Giant Bat (n012) taken out for now; v0.22n2; v0.22o2: Bat Rider, Skeleton Mage
const NO_INCOME = new Set(["n00Y", "n01H", "n01R", "n01T", "n02P", "n02Q", "n02R"]); // v0.21p: Ghoul (n01D) earns income now
const NO_DECIMAL = new Set(["n00Y", "n01R", "n02N", "n01T", "n02P", "n02Q", "n02R"]);
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
  // v0.27F: Mud Golem as a tier 1 send card (mini boss): 200 gold, +10 income, 650 HP (v0.27cF), unlocks the upper half of tier 1
  {
    const escort = rawUnits.get("n01U"),
      shop = rawUnits.get(SHOPS[0]);
    if (escort && shop) {
      rawUnits.set(MUD_GOLEM_ID, {
        ...escort,
        id: MUD_GOLEM_ID,
        custom: true,
        fields: { ...escort.fields, unam: "[05] Mud Golem", ugol: 200, upoi: 10, uhpm: 650, usma: 1, usrg: 1, usst: 0, uabi: "A01A,XA14", utyp: "ancient" },
      });
      shop.fields.useu = (shop.fields.useu || "") + "," + MUD_GOLEM_ID;
    }
  }
  // v0.27hF: Trench Orc (tier 2, in the Giant Bat's place): the Orc's figure and Splash Resistance, plus Armor 2
  {
    const orc = rawUnits.get("n00M"),
      shop = rawUnits.get(SHOPS[1]);
    if (orc && shop) {
      rawUnits.set(TRENCH_ORC_ID, {
        ...orc,
        id: TRENCH_ORC_ID,
        custom: true,
        fields: { ...orc.fields, unam: "[21] Trench Orc", ugol: 1000, upoi: 62, uhpm: 3000, usma: 8, usrg: 7.5, usst: 80, uabi: "A01A,XA02,XA15" },
      });
      shop.fields.useu = (shop.fields.useu || "") + "," + TRENCH_ORC_ID;
    }
  }
  // v0.24j: melee poison (Zombie Tower, Death Knight) is the same "Poison Attack" as the ranged poison towers (Poison
  // Archer): the ranged ability's fields with the melee poison's own numbers (damage, slow, duration per level)
  {
    const melee = rawAbilities.get("A08Z"),
      ranged = rawAbilities.get("A090");
    if (melee && ranged) {
      const keep = ["Spo1", "Spo2", "adur", "ahdu", "aub1", "alev"],
        fields = { ...ranged.fields };
      for (const k of keep) if (melee.fields[k] !== undefined) fields[k] = melee.fields[k];
      rawAbilities.set("A08Z", { ...ranged, id: "A08Z", fields });
    }
  }
  // v0.17p: ability fixes (field patches, removed and added abilities per unit)
  for (const [id, patch] of Object.entries(ABILITY_PATCH)) {
    const a = rawAbilities.get(id);
    if (a) rawAbilities.set(id, { ...a, ...(patch.props || {}), fields: { ...a.fields, ...(patch.fields || {}) } });
  }
  // v0.22a: melee towers lose the "Splash Attack" ability; its share and radius become the
  // tower's own splash spec (shown and drawn like the Bombard splash)
  for (const [id, raw] of rawUnits) {
    const f = raw.fields,
      range = Number(f.ua1r) || 0;
    if (!/^h/.test(id) || !(range > 0 && range <= 200)) continue;
    const ids = splitIds(f.uabi),
      cleave = ids.find((x) => rawAbilities.get(x)?.baseId === "ANca");
    if (!cleave) continue;
    const a = rawAbilities.get(cleave).fields,
      lvl = Math.min(Number(Object.values(a.alev || { 0: 1 })[0]) || 1, Number(String(f.unam || "").replace(/\|c\w{8}|\|r/g, "").match(/\[Level (\d+)\]/)?.[1]) || 1),
      at = (fld, fb) => {
        const v = fld || {};
        return Number(v[lvl] ?? v[String(lvl)] ?? v[1] ?? v["1"] ?? fb);
      };
    rawUnits.set(id, {
      ...raw,
      fields: { ...f, uabi: ids.filter((x) => x !== cleave).join(","), ua1f: 0, ua1h: at(a.aare, 180), uhd1: Math.round(at(a.nca1, 0.3) * 100) / 100, ua1q: 0, uqd1: 0 },
    });
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
      name: renameFull(name), // v0.21m
      shortName: unitName(name.replace(/^\[[^\]]+\]\s*/, "").replace(/\s*\[[^\]]+\]/g, "")), // v0.21m: our names replace the Warcraft ones
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
      woodIncome: { h01F: 1, h023: 2, h026: 4, h027: 7 }[raw.id] || 0, // v0.24oF: 1 / 2 / 4 / 7 (+ 12 for the new top level below); was 1 / 2 / 3 / 4
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
    // v0.22n2: taken out of the send tiers (2 per tier): Satyr, Alchemist, Treant, Rouge Wizard, Sasquatch, Eredar Warlock, Wendigo, Warden
    if (isSend && REMOVED_SENDS.has(raw.id)) {
      unit.playable = false;
      unit.unavailableReason = "Removed from the game.";
    }
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
  // v0.24oF: a fifth EXP generator level and new prices 200 / 600 / 2000 / 5000 / 10,000 per step
  // (sell value counts everything paid: 200 / 800 / 2800 / 7800 / 17,800)
  if (byId.h01F && byId.h023 && byId.h026 && byId.h027) {
    const top = byId.h027;
    const gen5 = {
      ...top,
      id: EXP_GEN_TOP_ID,
      name: top.name.replace(/Level\s+6/i, "Level 7"),
      fields: { ...top.fields, unam: "Lumbermill [|c00FFFF00Level 7|r]", uupt: "" },
      level: 7,
      upgrades: [],
      woodIncome: 12,
      source: { file: "port", id: EXP_GEN_TOP_ID },
    };
    byId[EXP_GEN_TOP_ID] = gen5;
    allUnits.push(gen5);
    top.upgrades = [EXP_GEN_TOP_ID];
    const prices = { h01F: 200, h023: 600, h026: 2000, h027: 5000, [EXP_GEN_TOP_ID]: 10000 };
    let paid = 0;
    ["h01F", "h023", "h026", "h027", EXP_GEN_TOP_ID].forEach((id, i) => {
      const u = byId[id];
      u.cost = prices[id];
      paid += prices[id];
      u.pointValue = paid;
      // levels 1-5 instead of the Lumbermill's old 3-7
      u.level = i + 1;
      u.name = u.name.replace(/Level\s+\d+/i, `Level ${i + 1}`);
      if (u.fields?.unam) u.fields = { ...u.fields, unam: u.fields.unam.replace(/Level\s+\d+/i, `Level ${i + 1}`) };
    });
  }
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
      cost: 4, // v0.22zk: 5 → 4
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
      pointValue: 4, // v0.22zk: worth its price of 4, sells for 1 (pinned in getSellValue)
      sellRate: 0.25,
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
  // v0.21y: drop placeholder requirements ("Coming soon…", e.g. Rhla on the Fire Elemental) so only the element is needed
  for (const u of allUnits) u.requires = (u.requires || []).filter((r) => r.id !== "Rhla");
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
    byId.R00K.description = "Archer-Line towers: +0.5 / +0.33 / +0.25 fields range per level";
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
  for (const [id, max] of Object.entries({ R002: 20, R00V: 20, R00D: 10, R00C: 10, R001: 20, R006: 10, R00X: 10, R00W: 10, R00U: 10, R00K: 5 })) if (byId[id]) byId[id].maxLevel = max;
  if (byId.R00K) byId.R00K.description = "Archer-Line towers: +0.5 / +0.33 / +0.25 / +0.2 / +0.17 fields range per level";
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
    sends: allUnits.filter((u) => u.isSend && !REMOVED_SENDS.has(u.id)).sort((a, b) => a.tier - b.tier || a.cost - b.cost),
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
 * flying, stockMax, stockRegen (seconds per recruit), stockStart (v0.27iF: rounds before the first, see START_ROUNDS).
 */
/**
 * v0.17b: own creep abilities. "Xlrs" = less damage from every tower of one line (`line` = the
 * line's root tower: h003 Archer, h02R Bombard). simulation.js reads `line` and `reduce`.
 */
export const CUSTOM_ABILITIES = [
  { id: "XA01", baseId: "Xlrs", custom: true, line: "h003", reduce: 0.33, fields: { anam: { 0: "Arrow Resistance" }, aub1: { 1: "Takes 33% less damage from Archer-Line towers" } } },
  // v0.22za2: Orc: Splash Resistance replaces Siege Resistance: less damage from tower splash attacks (no spells)
  { id: "XA02", baseId: "Xspr", custom: true, reduce: 0.33, fields: { anam: { 0: "Splash Resistance" }, aub1: { 1: "Takes 33% less splash damage from towers" } } },
  // v0.27hF: Trench Orc: Armor 2 (ignores 2 damage from every hit, at least 1 gets through)
  { id: "XA15", baseId: "Ansk", custom: true, fields: { anam: { 0: "Scale Armor" }, aub1: { 1: "Ignores 2 damage from all attacks\nbut takes minimum 1 damage" }, Ssk3: { 1: 2 }, Ssk2: { 1: 1 } } },
  { id: "XA08", baseId: "Xslr", custom: true, resist: 0.4, fields: { anam: { 0: "Slow Resistance" }, aub1: { 1: "40% less slowed" } } }, // v0.21k: Warden, Eredar Warlock
  { id: "XA03", baseId: "Xinf", custom: true, fields: { anam: { 0: "Deathrattle" }, aub1: { 1: "Summons 3 Skeletons on death" } } }, // v0.17g: display only (the spawn runs through DEATH_PLANS)
  // v0.17p: Pit Lord tower: Howl. When creeps come near it howls: creeps within 1.5 fields are slowed and take more tower damage for 12 s.
  { id: "XA04", baseId: "Xhwl", custom: true, radius: 192, slow: 0.25, amp: 0.2, duration: 12, cooldown: 20, fields: { anam: { 0: "Howl" }, aub1: { 1: "Creeps within 1.5 fields: 25% slower, +20% tower damage for 12 s" } } },
  // v0.17p: Phoenix: Phoenix Fire as an immolation aura with full damage to ground and air
  { id: "XA05", baseId: "AIcf", custom: true, fields: { anam: { 0: "Phoenix Fire" }, aare: { 1: 192 }, aub1: { 1: "Deals 350 damage per second\nRange 192\nTargets Ground & Air" } } },
  // v0.18b: Earth Laser: Focus Fire. While the tower keeps hitting the same creep, its damage rises by 10 % every 0.25 s, up to 500 %.
  // v0.18e: Orc: buying one restocks one Goblin at once (display only; the restock runs in simulation.js)
  // v0.21z: display only: Treant EXP and Wisp, Meat Golem Enrage (the effects run in simulation.js)
  { id: "XA09", baseId: "Xinf", custom: true, fields: { anam: { 0: "EXP Bonus" }, aub1: { 1: "Gives you EXP when killed" } } },
  { id: "XA10", baseId: "Xinf", custom: true, fields: { anam: { 0: "Spawn Wisp" }, aub1: { 1: "Spawns a Wisp on death" } } },
  { id: "XA11", baseId: "Xinf", custom: true, fields: { anam: { 0: "Enrage" }, aub1: { 1: "Denies its first death and rises enraged" } } },
  // v0.22n2: Tier Boss (every tier boss golem) replaces Scale Armor, Nerf Resistance and Magic Resistance: debuffs last
  // 50 % shorter, every tower attack does 1 / 5 / 10 / 20 / 30 less damage (never below 1; simulation.js TIER_BOSS)
  { id: "XA12", baseId: "Xtbs", custom: true, fields: { anam: { 0: "Tier Boss" }, aub1: { 1: "Reduced damage from attacks, 50% less duration for debuffs, 30% slow resistance" } } },
  // v0.27F: Mud Golem (tier 1 mini boss): half of the Rock Golem's Tier Boss resistances (simulation.js MINI_BOSS)
  { id: "XA14", baseId: "Xmbs", custom: true, fields: { anam: { 0: "Mini Boss" }, aub1: { 1: "Half the resistances of a Tier Boss. Recruiting it unlocks the rest of tier 1" } } },
  // v0.26cF: Mountain Golem: unlocks no tier; display only (the effect runs in simulation.js MOUNTAIN_GOLEM)
  { id: "XA13", baseId: "Xinf", custom: true, fields: { anam: { 0: "Mountain Might" }, aub1: { 1: "Can be recruited again. Each one gives your tier 5 creeps +5% HP for good" } } },
  { id: "XA06", baseId: "Xfoc", custom: true, step: 0.09, interval: 0.25, max: 5, fields: { anam: { 0: "Focus Fire" }, aub1: { 1: "Damage +9% every 0.25 s while attacking the same target, up to 500%" } } },
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
  // v0.21k: Fire Archer Multi Shot one arrow per tower level (level 3: 3 without the ability, 4 / 5 / 6 here; was 3 / 4 / 5)
  A02E: { fields: { aub1: { 1: "Shoots |c00FFFF004|r arrows simultaneously" } } },
  A03G: { fields: { aub1: { 1: "Shoots |c00FFFF005|r arrows simultaneously" } } },
  A05G: { fields: { aub1: { 1: "Shoots |c00FFFF006|r arrows simultaneously" } } },
  A0D1: { fields: { Ssk3: { 1: 12 } } }, // v0.23: Druid's Scale Armor ignores 12 damage per hit (the value was missing, so it ignored nothing)
  A08K: { fields: { Ssk2: { 1: 3 } } }, // v0.23: Frost Wyrm and Lord Garithos take at least 3 damage per hit (was 1: the value was missing)
  // v0.23zb: Undoctor (was Witch Doctor): its curse works once per creep, −33 % rate of fire for 60 s (was −30 % for 90 s, again and again)
  A0D6: { fields: { Slo2: { 1: 0.33 }, adur: { 1: 60 }, aub1: { 1: "Once: decreases a tower's rate of fire\nby |c00FFFF0033%|r for |c00FFFF0060|r seconds" } } },
};
/**
 * v0.21m: the names this port gave its units, written over the Warcraft names in the catalog itself, so every
 * text (cards, tooltips, card book, messages, neutral waves) uses them: Peon → Goblin, Chaos Peon → Imp, …
 */
export const UNIT_NAMES = Object.freeze({ Peon: "Goblin", "Chaos Peon": "Trenchlin", Akolyte: "Goblin Zealot", Dragonspawn: "Crystal Lizard", "Frost Wyrm": "Bone Dragon", "Lord Garithos": "Dark Knight", "Witch Doctor": "Undoctor", "Centaur Warrior": "Satyr", "Forest Troll": "Centaur", "Grom Hellscream": "Bandit Leader", "Fel Raider": "Rouge Knight", Horse: "Pony", "Cairne Bloodhoof": "Minotaurus", Lumbermill: "EXP Generator", "Skeleton Grunt": "Skeleton Berserker", "Draenai Marauder": "Scaleworm", "Siege Golem": "Iron Golem", Abomination: "Zombie Ogre", "Demon Hunter": "Demon Knight", Faceless: "Dark Monk", Spellbreaker: "Witch Hunter", "Void Walker": "Banshee" }); // v0.23a: Boar Scout → Boar; v0.23c: Horse → Boar; v0.23d: tier 1 is the Horse again, tier 2 stays Boar Scout
const unitName = (short) => UNIT_NAMES[short] || short;
const renameFull = (full) => {
  const short = full.replace(/^\[[^\]]+\]\s*/, "").replace(/\s*\[[^\]]+\]/g, "");
  return UNIT_NAMES[short] ? full.replace(short, UNIT_NAMES[short]) : full;
};
/** Removed everywhere: Critical Shot (Bird Hunter, v0.18a), Blitz Weapon + its lightning (Bash Tower), Poison Weapon (Death Knight), the air halves of Endurance Aura, every Unholy Aura. */
const REMOVED_ABILITIES = new Set(["A05Q", "A00P", "A01W", "A02S", "A06K", "A08E", "A08G", "A08I", "A09R", "A0D3", "A06X", "A09O",
  // v0.21j: Detector removed from every tower, and with it invisibility (Eredar Warlock A0B2, Warden Apiv)
  "A025", "A04N", "A05C", "A06I", "A007", "A0BB", "A0BI", "A0B2", "Apiv"]);
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
  // v0.22n2: the tier bosses lose Scale Armor, Nerf Resistance and Magic Resistance (Tier Boss instead)
  n00T: { A0CG: "", A05F: "", A01S: "" }, // Rock Golem
  n015: { A05E: "", A05F: "", A01S: "" }, // Siege Golem
  n01H: { A0D1: "", A05F: "", A01S: "" }, // Meat Golem
  n01T: { A09P: "", A05F: "", A01S: "" }, // Infernal Golem
  n02R: { A0D5: "", A05F: "" }, // Mountain Golem
  // v0.23: Skeleton Berserker and Ghoul: Arrow Resistance like the Skeleton's, 33 % less damage from Archer-Line towers (was: ignores 1 / 9 ranged damage)
  n011: { A00C: "XA01" },
  n01D: { A09U: "XA01" },
};
/** Per unit: abilities added in front. */
const UNIT_ABILITY_ADD = { n02P: ["XA08"], n01R: ["XA08"], n00Y: ["XA10", "XA09"], n01H: ["XA11", "XA12"], n00T: ["XA12"], n015: ["XA12"], n01T: ["XA12"], n02R: ["XA12", "XA13"], n02I: ["A03D"] }; // v0.23: Lord Garithos shows his Divine Shield // v0.22n2: Tier Boss // v0.21z: Treant EXP Bonus and Spawn Wisp, Meat Golem Enrage // v0.21k: Slow Resistance for Warden and Eredar Warlock
/**
 * v0.18a: tower damage buffs in percent of the average damage, rounded up to the next whole number.
 * The difference is added to the flat damage part, so the dice spread stays the same.
 */
export const TOWER_DAMAGE_BUFF = {
  h05B: 0.05, // Bird Hunter level 3: 45 → 48
  h03A: 0.075, // Bird Hunter level 4: 135 → 146
  h03B: 0.1, // Bird Hunter level 5: 375 → 413
  h03N: 0.1, // Bird Hunter level 6: 900 → 990
  // v0.24i: Ogre Tower line +8 %, plain Footman line from level 2 +12 %
  h05A: 0.08, h033: 0.08, h034: 0.08, h03I: 0.08,
  h02U: 0.12, h02V: 0.12, h035: 0.12, h036: 0.12, h03J: 0.12,
  // v0.24j: Disease Launcher +40 % (its disease clouds: simulation.js DISEASE_BUFF)
  e003: 0.4, e006: 0.4, e008: 0.4, e009: 0.4,
};
function applyTowerDamageBuff(byId) {
  for (const [id, pct] of Object.entries(TOWER_DAMAGE_BUFF)) {
    const u = byId[id];
    if (!u || !(u.damage > 0)) continue;
    const next = Math.ceil(u.damage * (1 + pct) - 1e-9);
    u.damageBase += next - u.damage;
    u.damage = next;
  }
  // v0.24p: pinned average damage (after the percentage buffs)
  for (const [id, dmg] of Object.entries(TOWER_DAMAGE_PIN)) {
    const u = byId[id];
    if (!u || !(u.damage > 0)) continue;
    u.damageBase += dmg - u.damage;
    u.damage = dmg;
  }
}
// v0.24p: fixed average damage per tower (Footman level 2: 11)
export const TOWER_DAMAGE_PIN = { h02U: 11 };
/**
 * v0.27iF: start delay of every send in rounds (the lock shown on its card). Only sends from the 4th place of a tier
 * on wait; the first three open at once and a tier boss waits one round longer than the creep before it.
 */
export const START_ROUNDS = {
  n00L: 4, n00R: 5, n00M: 6, n00N: 8, n00P: 8, n00S: 9, // tier 1 (the Wolf opens through START_LOCK)
  n011: 1, n00V: 1, n010: 2, nTRO: 4, n02V: 4, n014: 4, // tier 2
  n03A: 1, n019: 2, n01A: 2, n01C: 3, n01G: 5, n01F: 6, // tier 3 (v0.27jF: Naga Siren 2 → 1, Shade 1 → 2)
  n00F: 1, n01L: 1, n01N: 2, n02M: 3, n02N: 4, n02O: 4, // tier 4
  n025: 1, n026: 1, n02E: 2, n02I: 3, n02K: 3, n02Q: 4, // tier 5
};
export const CREEP_TUNING = {
  nMDG: { bountyBase: 18, bountyDice: 0 }, // v0.27F: Mud Golem bounty like a tier 1 creep of its price
  // v0.27gF: tier 2: Skeleton Berserker and Flying Machine swap places (and start delays); Flying Machine 300 → 500 gold,
  // HP 375 → 625, income 12 → 20 (4 % as before), bounty 34 → 57 (same share of its price)
  n011: { name: "[16] Skeleton Berserker", stockStart: 1 }, // v0.27iF: start delay in rounds
  n00V: { name: "[17] Flying Machine", cost: 500, hp: 450, count: 3, income: 20, bountyBase: 38, stockStart: 1 }, // v0.27hF: 3 per purchase, 450 HP each, bounty 57 → 38 each (same total)
  [TRENCH_ORC_ID]: { name: "[21] Trench Orc", shortName: "Trench Orc", cost: 1000, hp: 3000, income: 62, count: 1, speed: 180, stockMax: 8, stockRegen: 7.5, stockStart: 4, bountyBase: 199, bountyDice: 1, abilities: ["A01A", "XA02", "XA15"] }, // v0.27hF: speed like the Orc, start delay like the Giant Bat
  n01Y: { armor: 4 }, // v0.24s: Dark Monk armor 4
  n01D: { income: 60 }, // v0.21p: Ghoul earns income now (1500 gold: 4 %, like Demon Hound)
  // v0.21p: Naga Siren's death spawns +50 % hit points (they look like little Naga Sirens, art.js / arena.js)
  n02Z: { hp: 4050 }, // Mutant 2500 → 3750; v0.22zl: +8 %, 4050
  n034: { hp: 3240 }, // Scout 2000 → 3000; v0.22zl: +8 %, 3240
  n02Y: { hp: 3240 }, // Thief 2000 → 3000; v0.22zl: +8 %, 3240
  n036: { hp: 4860 }, // Warrior 3000 → 4500; v0.22zl: +8 %, 4860
  n037: { hp: 2430 }, // Wizard 1500 → 2250; v0.22zl: +8 %, 2430
  n02P: { hp: 90000 }, // Warden: +50 % hit points, 60000 → 90000 (v0.21k)
  n01R: { hp: 30000 }, // Eredar Warlock: +50 % hit points, 20000 → 30000 (v0.21k)
  n00E: { income: 1, cost: 5, stockMax: 18, bountyBase: 0.85, bountyDice: 0, speed: 170.66 }, // v0.24k: 0.64 → 0.60 fields/s; // v0.22h1: bounty 0.85 per Goblin (+70 % over the tier 1 average); // Goblin: income 1.17 → 1 (v0.07g), cost 6 → 5 (v0.07h); peon companion removed (v0.07i); stock 16 → 18 (v0.08b)
  n007: { cost: 10, speed: 227.55, income: 1.9, bountyBase: 1.5, bountyDice: 0 }, // v0.24s: Pony 0.80 fields/s; // v0.22h1: bounty 1.5 per Horse (+50 %); // Horse: cost 12 → 10, income 2 → 1.9 (v0.08b)
  n00K: { income: 3.5, bountyBase: 2.6, bountyDice: 0 }, // v0.22h1: bounty 2.6 per Gnoll (+30 %, was 0–5 at random); // Gnoll: income 3 → 3.5 (v0.08d)
  n00M: { hp: 250, speed: 180, stockRegen: 7, stockMax: 8, // v0.26a: stock max 8
    count: 1, bountyBase: 11, name: "[06] Orc", shortName: "Orc", abilities: ["A01A", "XA02"] }, // Grunt → Orc (v0.17b): hit points +30 %, 120 → 156 (v0.09s); Siege Resistance 33 % (v0.17b), v0.22za2: Splash Resistance, 260 HP; v0.18e: one Orc per purchase (heavy), hit points 156 → 312, bounty 5+1d1 → 11+1d1 (12 per purchase as before), restocks 1 Goblin; v0.21m: hit points 312 → 300, speed 190 → 180 (−5 %); v0.21p: 280 hit points, restock 6 → 7 s; v0.24s: 250 HP
  n00R: { hp: 60, abilities: ["A01A", "XA01"] }, // v0.26a: 55 → 60 HP; // Skeleton: Arrow Resistance now 33 % less damage from Archer-Line towers (v0.17b, was: ignores 1 ranged damage)
  n00N: { hp: 200, abilities: ["A01A", "XA03", "XA01"] }, // v0.26cF: 200 HP, Arrow Resistance 33 %; Necromancer: hit points 170 → 180 (v0.17f), 185 (v0.21p); Unholy Aura removed, Deathrattle shown (v0.17g)
  n00P: { hp: 85, speed: 138.56, stockRegen: 11 }, // Flying Sheep: hit points 80 → 85, speed 1.06 → 1.08 fields/s (v0.17b); restock 10 → 11 s (v0.17o)
  n00W: { speed: 227.55, hp: 175 }, // v0.24k: Boar Scout 0.84 → 0.80 fields/s, hit points 180 → 175
  n016: { hp: 675, speed: 170.66 }, // v0.24k: Zombie hit points −10 % (750 → 675); v0.24s: 0.60 fields/s
  n01S: { hp: 6750 }, // v0.24k: Scarabaeus hit points −10 % (7500 → 6750)
  n00U: { speed: 170.66 }, // v0.22n2: Imp 0.70 → 0.64 fields/s (game units before the arena's 45 %); v0.24k: Trenchlin 0.60 fields/s
  n00X: { speed: 284.44 }, // v0.22n2: Centaur Warrior 1.01 → 1.00 fields/s
  n019: { cost: 2000, hp: 2100, income: 40 }, // v0.22o2: Shade 1200 → 2000 gold, hit points with it 1250 → 2100; v0.22p2: income 24 → 40
  // v0.23zb: Shieldbearer → Siege Ogre: one per purchase (heavy) with double hit points and bounty, armor 3, no Divine Shield;
  // plants a Siege Plank once (simulation.js SIEGE_OGRE)
  n01G: { name: "[34] Siege Ogre", shortName: "Siege Ogre", count: 1, hp: 16000, armor: 3, bountyBase: 718, abilities: ["A08S", "A01A"], stockMax: 2, stockRegen: 17 }, // v0.22o2: was Spiritwalker → Shieldbearer; v0.24i: stock 5 → 2, restock 15 → 17 s
  n025: { income: 30 }, // v0.24j: Raven earns a little income (0.3 % of its price; flyers pay less than ground creeps)
  n00L: { speed: 398.22, cost: 30, hp: 40, income: 3, stockMax: 8 }, // v0.27bF: 1.40 fields/s (398 × 0.45 / 128), HP 35 → 40, income 4 → 3, stock max 12 → 8; locked 5 rounds, opens with 2 (simulation.js START_LOCK); Wolf: 25 % faster, 300 → 375 (v0.08d); v0.24s: cost 30; v0.26bF: HP 32 → 35, 5 % faster (375 → 394)
  n00S: { speed: 420, stockRegen: 13, income: 8, name: "[10] Wolfrider", shortName: "Wolfrider" }, // v0.24s: Raider → Wolfrider; Raider: 25 % faster (v0.07b); restock 12 → 13 s (v0.17o); income 9 → 8 (v0.17q)
  n012: { name: "[21] Giant Bat", shortName: "Giant Bat" }, // v0.23zq: the Zeppelin is the Giant Bat
  n025: { name: "[52] Raven", shortName: "Raven" }, // v0.23zo: the Gryphon Rider is the Raven
  n02Q: { name: "[59] Demon Lord", shortName: "Demon Lord" }, // v0.23zn: the Pit Lord creep is the Demon Lord (the Pit Lord tower keeps its name)
  n02R: { cost: 150000, hp: 560000 }, // v0.23zm: Mountain Golem 100,000 → 150,000 gold, hit points +40 % (400,000 → 560,000)
  n01T: { cost: 120000, hp: 108000 }, // v0.23zh: Infernal Golem 60,000 → 120,000 gold, hit points +200 % (36,000 → 108,000)
  n01H: { hp: 46200 }, // Meat Golem: hit points +10 %, 42000 → 46200 (v0.21y); v0.21z: no death spawns, denies its first death and rises enraged (simulation.js ENRAGED_GOLEM)
  n03A: { income: 45, hp: 4320 }, // v0.22zl: hit points +8 %, 4000 → 4320; // v0.21z: Naga Siren earns a low income (1800 gold: 2.5 %)
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
  // v0.27iF: start delays count in rounds (income ticks), like the lock they open; the map's seconds are converted
  // once (values as the old seconds formula gave them); CREEP_TUNING's stockStart below is in rounds too
  for (const u of Object.values(byId)) if (u.kind === "send") u.stockStart = START_ROUNDS[u.id] ?? Math.round(((u.stockStart || 0) * 2) / 3 / RULES.incomeInterval);
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
