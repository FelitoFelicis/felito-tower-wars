/**
 * Shared building blocks for all figures, so every tower and creep shares one style:
 * chunky chibi proportions (big head, short body), bright colours, few small details.
 * Look at docs/concepts/towers-and-world.png for the target look.
 *
 * Every helper takes a Geo (`g`) and options; positions are in model space
 * (1 = one board cell, +Y up, the figure faces +Z, y = 0 is where the feet stand).
 */
import { Geo, PART, PLATE_H, ELEMENT_COLORS, defineModel, mix, shade, rgb } from "../r3d.js";

export { Geo, PART, PLATE_H, ELEMENT_COLORS, defineModel, mix, shade, rgb };

export const SKIN = { light: 0xf2c6a0, tan: 0xd9a27a, dark: 0x9a6a48, green: 0x8fbf5a, orc: 0x6f9a45, gray: 0xb8b8b0, blue: 0x7fb8e0, undead: 0xa9c79a, red: 0xc8503c };
export const METAL = { iron: 0x8c96a3, steel: 0xc3ccd6, dark: 0x3c4048, gold: 0xf2c14e, bronze: 0xc98a3c, copper: 0xd07a4a };
export const WOOD = { light: 0xc08a52, mid: 0x9a6636, dark: 0x6b4426 };
export const STONE = { light: 0xbfb8aa, mid: 0x9b958a, dark: 0x6f6a62 };

/** Trim colour for a tier: 1 bronze/iron, 2 steel, 3 gold. */
export const trim = (tier) => (tier >= 3 ? METAL.gold : tier === 2 ? METAL.steel : METAL.bronze);

/**
 * Standard chibi humanoid. Returns anchors to attach gear to:
 *  { head: [x, y, z], headR, handL, handR, chest, back, hip, top, armL, armR }
 * armL / armR are { part, pivot } so held items swing with the arm.
 *
 * o: {
 *   scale (1), bulk (1 = normal, 1.5 = brute, 0.85 = slim), headScale (1),
 *   skin, shirt, pants, boots, belt (null = none), gloves (null = skin),
 *   eyes (0x2a2a3a), eyeGlow (0), ears ("none" | "elf" | "big"),
 *   armsUp (0..1 lifts the hands to chest height), legs (true), stance (0.075 half distance of feet)
 * }
 */
export function chibi(g, o = {}) {
  const s = o.scale ?? 1,
    bulk = o.bulk ?? 1,
    hs = (o.headScale ?? 1) * (bulk > 1.2 ? 0.82 : 1),
    skin = o.skin ?? SKIN.light,
    shirt = o.shirt ?? 0x3f7f4a,
    pants = o.pants ?? 0x5a4632,
    boots = o.boots ?? 0x5b3a24,
    belt = o.belt === undefined ? 0x6b4426 : o.belt,
    gloves = o.gloves ?? skin,
    st = (o.stance ?? 0.075) * bulk;
  const legTop = 0.2 * s,
    hipY = 0.22 * s,
    chestY = (0.32 + 0.02 * (bulk - 1)) * s,
    shoulderY = (0.38 + 0.04 * (bulk - 1)) * s,
    headR = 0.17 * s * hs,
    headY = shoulderY + headR * 0.95 + 0.02 * s;
  const legL = { part: PART.LEG_L, pivot: [legTop, 0] },
    legR = { part: PART.LEG_R, pivot: [legTop, 0] };
  if (o.legs !== false) {
    for (const [x, leg] of [
      [-st, legL],
      [st, legR],
    ]) {
      g.roundBox(0.095 * s * Math.min(bulk, 1.3), 0.075 * s, 0.13 * s, 0.025 * s, { at: [x, 0.037 * s, 0.015 * s], color: boots, ...leg });
      g.cylinder(0.042 * s * bulk, 0.046 * s * bulk, 0.13 * s, { at: [x, 0.12 * s, 0], color: pants, seg: 8, ...leg });
    }
  }
  // hips and torso
  g.roundBox(0.24 * s * bulk, 0.09 * s, 0.16 * s * Math.min(bulk, 1.25), 0.035 * s, { at: [0, hipY, 0], color: pants });
  g.sphere(0.14 * s, { at: [0, chestY, 0], scale: [bulk, 1.0 + 0.1 * (bulk - 1), 0.78 * Math.min(bulk, 1.3)], color: shirt, seg: 10, rings: 7 });
  if (belt !== null) g.torus(0.118 * s * bulk, 0.022 * s, { at: [0, hipY + 0.035 * s, 0], scale: [1, 1, 0.75], color: belt, seg: 14 });
  // arms
  const up = o.armsUp ?? 0,
    armX = (0.15 + 0.06 * (bulk - 1)) * s,
    handY = (0.24 + 0.1 * up) * s,
    handZ = 0.04 * s + 0.06 * up * s,
    armR = 0.042 * s * Math.max(1, bulk * 1.1);
  const armL = { part: PART.ARM_L, pivot: [shoulderY, 0] },
    armRp = { part: PART.ARM_R, pivot: [shoulderY, 0] };
  for (const [sx, arm] of [
    [-1, armL],
    [1, armRp],
  ]) {
    const hx = sx * (armX + 0.035 * s);
    g.tube(
      [
        [sx * armX, shoulderY, 0],
        [hx, (shoulderY + handY) / 2, handZ * 0.4],
        [hx, handY + 0.02 * s, handZ],
      ],
      armR,
      { color: shirt, seg: 7, ...arm },
    );
    g.sphere(armR * 1.25, { at: [sx * armX, shoulderY, 0], color: shirt, seg: 8, rings: 6, ...arm });
    g.sphere(0.046 * s * Math.max(1, bulk), { at: [hx, handY, handZ], color: gloves, seg: 8, rings: 6, ...arm });
  }
  // head
  const head = [0, headY, 0.01 * s];
  g.sphere(headR, { at: head, scale: [1.02, 0.96, 0.95], color: skin, seg: 12, rings: 9, part: PART.HEAD });
  eyes(g, head, headR, { color: o.eyes ?? 0x2a2a3a, glow: o.eyeGlow ?? 0, part: PART.HEAD });
  if (o.ears === "elf")
    for (const sx of [-1, 1])
      g.cone(0.035 * s, 0.13 * s, { at: [sx * headR * 1.02, head[1] + 0.02 * s, head[2] - 0.01], rot: [0, 0, -sx * 1.15], color: skin, seg: 6, part: PART.HEAD });
  if (o.ears === "big")
    for (const sx of [-1, 1]) g.sphere(0.05 * s, { at: [sx * headR * 1.02, head[1], head[2]], scale: [0.5, 1, 0.8], color: skin, seg: 8, rings: 6, part: PART.HEAD });
  return {
    head,
    headR,
    handL: [-(armX + 0.035 * s), handY, handZ],
    handR: [armX + 0.035 * s, handY, handZ],
    chest: [0, chestY, 0.1 * s],
    back: [0, chestY + 0.02 * s, -0.11 * s * Math.min(bulk, 1.3)],
    hip: [0, hipY, 0],
    top: [0, headY + headR, 0],
    shoulderY,
    armL,
    armR: armRp,
    scale: s,
  };
}

/** Two big cartoon eyes on the front of a head. */
export function eyes(g, head, r, o = {}) {
  const col = o.color ?? 0x2a2a3a,
    spread = o.spread ?? 0.36,
    h = o.height ?? -0.02,
    size = o.size ?? 1;
  for (const sx of [-1, 1]) {
    const at = [head[0] + sx * r * spread, head[1] + r * h, head[2] + r * 0.88];
    g.sphere(r * 0.2 * size, { at, scale: [0.8, 1.1, 0.5], color: col, glow: o.glow || 0, seg: 8, rings: 6, part: o.part ?? PART.HEAD });
    if (!o.glow) g.sphere(r * 0.06 * size, { at: [at[0] + r * 0.05, at[1] + r * 0.07, at[2] + r * 0.09], color: 0xffffff, glow: 0.6, seg: 6, rings: 4, part: o.part ?? PART.HEAD });
  }
  if (o.brows)
    for (const sx of [-1, 1])
      g.box(r * 0.3, r * 0.07, r * 0.08, { at: [head[0] + sx * r * spread, head[1] + r * 0.25, head[2] + r * 0.9], rot: [0, 0, sx * (o.angry ? -0.35 : 0.15)], color: o.brows, part: o.part ?? PART.HEAD });
}

/** Hood: an open dome around the back and top of the head with a tip falling back, plus a cowl. */
export function hood(g, a, color, o = {}) {
  const r = a.headR * 1.17,
    [x, y, z] = a.head;
  g.sphere(r, { at: [x, y + 0.01, z - 0.01], rot: [-Math.PI / 2 + (o.tilt ?? 0.55), 0, 0], color, seg: 14, rings: 10, half: true, open: true, part: PART.HEAD });
  g.cone(r * 0.5, r * 1.0, { at: [x, y + r * 0.62, z - r * 0.78], rot: [-1.1, 0, 0], color, seg: 8, part: PART.HEAD });
  // shoulder cowl
  if (o.cowl !== false) g.cylinder(r * 0.55, r * 0.78, r * 0.3, { at: [x, a.shoulderY + 0.005, z - 0.02], color, seg: 12 });
}

/** Rounded metal helmet with an optional crest, horns or face guard. */
export function helmet(g, a, color, o = {}) {
  const r = a.headR * 1.1,
    [x, y, z] = a.head;
  g.sphere(r, { at: [x, y + 0.02, z - 0.01], color, seg: 12, rings: 8, part: PART.HEAD, half: true, scale: [1, 1.05, 1] });
  g.torus(r * 0.98, r * 0.09, { at: [x, y + 0.02, z - 0.01], color: o.trim ?? METAL.gold, seg: 16, part: PART.HEAD });
  if (o.nose) g.box(r * 0.12, r * 0.6, r * 0.1, { at: [x, y - r * 0.1, z + r * 0.98], color, part: PART.HEAD });
  if (o.crest) g.prism([[-0.02, 0], [0.12, 0.04], [0.16, 0.16], [0.02, 0.12], [-0.1, 0.08]], 0.03, { at: [x, y + r * 0.9, z - r * 0.2], rot: [0, Math.PI / 2, 0], scale: a.scale, color: o.crest, part: PART.HEAD });
  if (o.horns)
    for (const sx of [-1, 1])
      g.tube(
        [
          [x + sx * r * 0.8, y + r * 0.3, z],
          [x + sx * r * 1.25, y + r * 0.55, z - 0.02],
          [x + sx * r * 1.3, y + r * 1.0, z - 0.05],
        ],
        [r * 0.16, r * 0.11, 0.004],
        { color: o.horns, seg: 6, part: PART.HEAD },
      );
  if (o.visor) {
    g.sphere(r * 1.0, { at: [x, y - 0.01, z + 0.015], scale: [1, 0.92, 1], color, seg: 12, rings: 8, part: PART.HEAD });
    g.box(r * 1.1, r * 0.12, r * 0.12, { at: [x, y + r * 0.05, z + r * 0.93], color: o.slit ?? 0x16181c, glow: o.slitGlow || 0, part: PART.HEAD });
  }
}

/** Tall pointed wizard hat with a brim; tip bends back. */
export function wizardHat(g, a, color, o = {}) {
  const r = a.headR,
    [x, y, z] = a.head;
  g.cylinder(r * 1.55, r * 1.6, r * 0.12, { at: [x, y + r * 0.62, z - 0.01], color, seg: 14, part: PART.HEAD });
  g.tube(
    [
      [x, y + r * 0.62, z - 0.01],
      [x, y + r * 1.3, z - r * 0.15],
      [x, y + r * 1.85, z - r * 0.55],
      [x, y + r * 2.05, z - r * 1.0],
    ],
    [r * 0.95, r * 0.6, r * 0.3, 0.005],
    { color, seg: 10, part: PART.HEAD },
  );
  if (o.band) g.torus(r * 0.93, r * 0.09, { at: [x, y + r * 0.72, z - 0.02], color: o.band, seg: 14, part: PART.HEAD });
  if (o.star) g.crystal(r * 0.18, r * 0.35, { at: [x, y + r * 1.15, z + r * 0.62], color: o.star, glow: 0.8, part: PART.HEAD });
}

/** Simple crown. */
export function crown(g, a, color = METAL.gold, o = {}) {
  const r = a.headR * (o.size ?? 0.75),
    [x, y, z] = a.head,
    cy = y + a.headR * 0.85;
  g.cylinder(r, r, r * 0.35, { at: [x, cy, z], color, seg: 10, open: true, part: PART.HEAD });
  for (let i = 0; i < 6; i++) {
    const u = (i / 6) * Math.PI * 2;
    g.cone(r * 0.2, r * 0.45, { at: [x + Math.cos(u) * r, cy + r * 0.38, z + Math.sin(u) * r], color, seg: 4, part: PART.HEAD });
  }
  if (o.gem) g.crystal(r * 0.18, r * 0.3, { at: [x, cy, z + r], color: o.gem, glow: 0.7, part: PART.HEAD });
}

/** Cape hanging from the shoulders down the back. */
export function cape(g, a, color, o = {}) {
  const s = a.scale,
    len = (o.length ?? 0.3) * s,
    w = (o.width ?? 0.3) * s,
    yTop = a.shoulderY + 0.02 * s,
    zb = a.back[2] - 0.02 * s;
  g.prism(
    [
      [-w * 0.45, 0],
      [w * 0.45, 0],
      [w * 0.62, -len],
      [w * 0.2, -len * 1.06],
      [-w * 0.2, -len * 1.06],
      [-w * 0.62, -len],
    ],
    0.025 * s,
    { at: [0, yTop, zb], rot: [0.18, 0, 0], color, team: o.team ?? 0 },
  );
}

/** A bow held vertically at `at`, facing +Z. */
export function bow(g, at, o = {}) {
  const size = o.size ?? 0.34,
    color = o.color ?? WOOD.mid,
    part = o.part ?? {};
  g.torus(size * 0.55, size * 0.045, { at, rot: [Math.PI / 2, Math.PI / 2, 0], arc: Math.PI * 0.9, color, glow: o.glow || 0, seg: 12, tube: 5, ...part });
  // string
  g.cylinder(0.005, 0.005, size * 1.0, { at: [at[0], at[1], at[2] + 0.005], color: o.string ?? 0xf0e6d0, seg: 4, glow: o.glow ? 0.6 : 0, ...part });
  if (o.arrow) arrow(g, [at[0] - 0.02, at[1], at[2] + 0.06], { len: size * 0.9, rot: [0, -Math.PI / 2, 0], tip: o.arrowTip, glow: o.arrowGlow, part });
}

/** Arrow along +Z centred at `at` (rot to orient). */
export function arrow(g, at, o = {}) {
  const len = o.len ?? 0.3,
    part = o.part ?? {};
  const sub = new Geo();
  sub.cylinder(0.008, 0.008, len, { rot: [Math.PI / 2, 0, 0], color: o.shaft ?? WOOD.light, seg: 4 });
  sub.cone(0.022, 0.06, { at: [0, 0, len / 2 + 0.025], rot: [Math.PI / 2, 0, 0], color: o.tip ?? METAL.steel, glow: o.glow || 0, seg: 5 });
  sub.prism([[0, 0], [0.03, -0.05], [0, -0.07]], 0.004, { at: [0, 0, -len / 2 + 0.05], rot: [0, Math.PI / 2, 0], color: o.feather ?? 0xd84a3a });
  sub.prism([[0, 0], [0.03, -0.05], [0, -0.07]], 0.004, { at: [0, 0, -len / 2 + 0.05], rot: [Math.PI / 2, Math.PI / 2, 0], color: o.feather ?? 0xd84a3a });
  if (part.part) sub.u = sub.u.map((v, k) => (k % 2 === 0 ? part.part : part.pivot[0]));
  if (part.part) sub.u2 = sub.u2.map((v, k) => (k % 2 === 1 ? part.pivot[1] : v));
  g.merge(sub, { at, rot: o.rot || [0, 0, 0] });
}

/** Sword pointing up (+Y) with the grip centred at `at`. */
export function sword(g, at, o = {}) {
  const len = o.len ?? 0.36,
    w = o.width ?? 0.06,
    part = o.part ?? {},
    blade = o.blade ?? METAL.steel;
  const sub = new Geo();
  sub.prism([[-w / 2, 0], [w / 2, 0], [w / 2, len * 0.82], [0, len], [-w / 2, len * 0.82]], 0.018, { at: [0, 0.05, 0], color: blade, glow: o.glow || 0, flat: true });
  sub.box(w * 2.4, 0.025, 0.035, { at: [0, 0.045, 0], color: o.guard ?? METAL.gold });
  sub.cylinder(0.016, 0.016, 0.08, { at: [0, 0, 0], color: o.grip ?? WOOD.dark, seg: 6 });
  sub.sphere(0.022, { at: [0, -0.045, 0], color: o.guard ?? METAL.gold, seg: 6, rings: 4 });
  partify(sub, part);
  g.merge(sub, { at, rot: o.rot || [0, 0, 0], scale: o.scale ?? 1 });
}

/** Round shield facing +Z centred at `at`. */
export function shield(g, at, o = {}) {
  const r = o.r ?? 0.14,
    part = o.part ?? {};
  const sub = new Geo();
  sub.cylinder(r, r, 0.03, { rot: [Math.PI / 2, 0, 0], color: o.color ?? 0x2f5fa8, seg: 14, team: o.team ?? 0 });
  sub.torus(r, 0.016, { rot: [Math.PI / 2, 0, 0], color: o.rim ?? METAL.gold, seg: 16 });
  sub.sphere(r * 0.25, { at: [0, 0, 0.015], scale: [1, 1, 0.6], color: o.boss ?? METAL.gold, seg: 8, rings: 5 });
  if (o.emblem) sub.prism([[0, r * 0.6], [r * 0.18, 0.02], [0, -r * 0.6], [-r * 0.18, 0.02]], 0.01, { at: [0, 0, 0.022], color: o.emblem, glow: o.emblemGlow || 0 });
  partify(sub, part);
  g.merge(sub, { at, rot: o.rot || [0, 0, 0] });
}

/** Staff standing up with the hand at `at`; optional glowing orb or crystal on top. */
export function staff(g, at, o = {}) {
  const len = o.len ?? 0.6,
    part = o.part ?? {};
  const sub = new Geo();
  sub.cylinder(0.018, 0.022, len, { at: [0, len * 0.25, 0], color: o.color ?? WOOD.mid, seg: 6 });
  const top = len * 0.75;
  if (o.crystal) sub.crystal(0.05, 0.14, { at: [0, top + 0.07, 0], color: o.crystal, glow: 0.85 });
  else if (o.orb) {
    sub.torus(0.045, 0.012, { at: [0, top + 0.01, 0], color: o.ring ?? METAL.gold, seg: 10 });
    sub.sphere(0.055, { at: [0, top + 0.06, 0], color: o.orb, glow: 0.85, seg: 10, rings: 7 });
  }
  partify(sub, part);
  g.merge(sub, { at, rot: o.rot || [0, 0, 0] });
}

/** Long weapon: spear / trident / pitchfork. Grip at `at`, pointing up. */
export function spear(g, at, o = {}) {
  const len = o.len ?? 0.7,
    part = o.part ?? {},
    head = o.head ?? METAL.steel;
  const sub = new Geo();
  sub.cylinder(0.014, 0.014, len, { at: [0, len * 0.3, 0], color: o.color ?? WOOD.mid, seg: 6 });
  const top = len * 0.8;
  if (o.trident) {
    sub.box(0.16, 0.02, 0.02, { at: [0, top, 0], color: head, glow: o.glow || 0 });
    for (const x of [-0.07, 0, 0.07]) sub.cone(0.018, x === 0 ? 0.13 : 0.1, { at: [x, top + (x === 0 ? 0.07 : 0.055), 0], color: head, glow: o.glow || 0, seg: 5 });
  } else sub.cone(0.035, 0.13, { at: [0, top + 0.06, 0], color: head, glow: o.glow || 0, seg: 5, flat: true });
  partify(sub, part);
  g.merge(sub, { at, rot: o.rot || [0, 0, 0] });
}

/** Hammer / mace / club with the grip at `at`, head up. kind: "hammer" | "club" | "mace". */
export function hammer(g, at, o = {}) {
  const len = o.len ?? 0.36,
    part = o.part ?? {},
    kind = o.kind ?? "hammer";
  const sub = new Geo();
  sub.cylinder(0.02, 0.02, len, { at: [0, len * 0.35, 0], color: o.handle ?? WOOD.dark, seg: 6 });
  const top = len * 0.85;
  if (kind === "hammer") sub.roundBox(o.headW ?? 0.2, o.headH ?? 0.11, o.headD ?? 0.11, 0.02, { at: [0, top, 0], color: o.color ?? STONE.mid });
  else if (kind === "club")
    sub.lathe(
      [
        [0.02, top - 0.22],
        [0.06, top - 0.08],
        [0.09, top + 0.04],
        [0.07, top + 0.1],
        [0, top + 0.12],
      ],
      { color: o.color ?? WOOD.light, seg: 8 },
    );
  else {
    sub.sphere(0.075, { at: [0, top, 0], color: o.color ?? METAL.iron, seg: 8, rings: 6 });
    for (let i = 0; i < 6; i++) {
      const u = (i / 6) * Math.PI * 2;
      sub.cone(0.022, 0.06, { at: [Math.cos(u) * 0.08, top, Math.sin(u) * 0.08], rot: [0, -u, -Math.PI / 2], color: METAL.steel, seg: 4 });
    }
  }
  partify(sub, part);
  g.merge(sub, { at, rot: o.rot || [0, 0, 0] });
}

/** Stack of flame cones (self-lit). */
export function flame(g, at, o = {}) {
  const s = o.size ?? 0.2,
    c1 = o.color ?? 0xff7a1e,
    c2 = o.core ?? 0xffe070,
    part = o.part ?? {};
  g.cone(s * 0.55, s * 1.3, { at: [at[0], at[1] + s * 0.4, at[2]], color: c1, glow: 0.9, seg: 7, ...part });
  g.cone(s * 0.32, s * 0.9, { at: [at[0], at[1] + s * 0.3, at[2] + s * 0.08], color: c2, glow: 1, seg: 6, ...part });
  for (const sx of [-1, 1]) g.cone(s * 0.22, s * 0.6, { at: [at[0] + sx * s * 0.35, at[1] + s * 0.1, at[2]], rot: [0, 0, -sx * 0.4], color: c1, glow: 0.9, seg: 5, ...part });
}

/** Glowing crystal cluster. */
export function crystals(g, at, o = {}) {
  const s = o.size ?? 0.2,
    color = o.color ?? 0x5ab8ff,
    part = o.part ?? {};
  g.crystal(s * 0.32, s * 1.2, { at: [at[0], at[1] + s * 0.55, at[2]], color, glow: o.glow ?? 0.75, ...part });
  g.crystal(s * 0.22, s * 0.75, { at: [at[0] + s * 0.32, at[1] + s * 0.3, at[2] + s * 0.05], rot: [0, 0, -0.45], color, glow: o.glow ?? 0.75, ...part });
  g.crystal(s * 0.2, s * 0.65, { at: [at[0] - s * 0.3, at[1] + s * 0.26, at[2] - s * 0.04], rot: [0, 0, 0.5], color, glow: o.glow ?? 0.75, ...part });
}

/** Feathered or leathery wing; side -1 = left (part WING_L), 1 = right. Root at `at`. */
export function wing(g, at, side, o = {}) {
  const span = o.span ?? 0.45,
    h = o.height ?? 0.3,
    color = o.color ?? 0xf2ede0,
    part = side < 0 ? PART.WING_L : PART.WING_R,
    common = { color, glow: o.glow || 0, part, pivot: [at[1], 0] };
  const pts = o.bat
    ? [
        [0, 0],
        [span * 0.35, h * 0.35],
        [span * 0.7, h * 0.55],
        [span, h * 0.3],
        [span * 0.8, -h * 0.05],
        [span * 0.6, h * 0.05],
        [span * 0.45, -h * 0.15],
        [span * 0.25, -h * 0.05],
      ]
    : [
        [0, 0],
        [span * 0.3, h * 0.45],
        [span * 0.75, h * 0.7],
        [span, h * 0.55],
        [span * 0.85, h * 0.2],
        [span * 0.65, -h * 0.05],
        [span * 0.4, -h * 0.15],
        [span * 0.15, -h * 0.1],
      ];
  const sub = new Geo();
  sub.prism(pts, 0.025, { ...common, rot: [0, 0, 0] });
  if (!o.bat)
    for (let i = 0; i < 3; i++)
      sub.prism([[0, 0], [span * 0.25, -h * 0.05], [span * 0.2, -h * 0.25]], 0.02, { at: [span * (0.5 + i * 0.16), h * 0.1 - i * 0.04, 0.012], color: o.tips ?? shade(color, 0.85), glow: o.glow || 0, part, pivot: [at[1], 0] });
  // mirror for the left wing and lift slightly backwards
  const placed = side < 0 ? sub.mirrored(false) : sub;
  g.merge(placed, { at: [at[0], at[1], at[2]], rot: [0.25, side * 0.35, 0] });
  // fix the part pivots after the move (they are absolute heights)
  return g;
}

/** Copy a part assignment onto every vertex of a sub-geometry. */
export function partify(sub, part) {
  if (!part || !part.part) return sub;
  for (let k = 0; k < sub.u.length; k += 2) {
    sub.u[k] = part.part;
    sub.u[k + 1] = part.pivot?.[0] ?? 0;
  }
  for (let k = 1; k < sub.u2.length; k += 2) sub.u2[k] = part.pivot?.[1] ?? 0;
  return sub;
}

/**
 * Four-legged animal. Returns anchors { head, headR, back, tail, mouth }.
 * o: { scale, body (color), belly, len (0.42), height (0.34 back height), legLen, headR, snout (length),
 *      ears ("pointy" | "round" | "floppy" | null), tail ("bushy" | "thin" | "stub" | null), horns, legColor, hoof }
 */
export function quadruped(g, o = {}) {
  const s = o.scale ?? 1,
    len = (o.len ?? 0.42) * s,
    bh = (o.height ?? 0.34) * s,
    legLen = (o.legLen ?? 0.17) * s,
    body = o.body ?? 0x8a7a6a,
    belly = o.belly ?? shade(body, 1.2),
    legC = o.legColor ?? shade(body, 0.85),
    r = bh - legLen;
  // body: ellipsoid along Z
  g.sphere(r * 0.95, { at: [0, legLen + r * 0.55, 0], scale: [0.85, 0.85, len / (r * 1.6)], color: body, seg: 12, rings: 8 });
  g.sphere(r * 0.75, { at: [0, legLen + r * 0.35, 0.02], scale: [0.75, 0.6, len / (r * 1.8)], color: belly, seg: 10, rings: 6 });
  const pivotY = legLen + r * 0.3;
  const legs = [
    [-1, 1, PART.LEG_L],
    [1, 1, PART.LEG_R],
    [-1, -1, PART.LEG_R],
    [1, -1, PART.LEG_L],
  ];
  for (const [sx, sz, part] of legs) {
    const x = sx * r * 0.45,
      z = sz * len * 0.32;
    g.cylinder(0.035 * s, 0.03 * s, legLen + r * 0.3, { at: [x, (legLen + r * 0.3) / 2, z], color: legC, seg: 7, part, pivot: [pivotY, z] });
    g.cylinder(0.038 * s, 0.04 * s, 0.035 * s, { at: [x, 0.018 * s, z + 0.005], color: o.hoof ?? shade(legC, 0.6), seg: 7, part, pivot: [pivotY, z] });
  }
  const headR = (o.headR ?? 0.12) * s,
    head = [0, legLen + r * 0.95 + headR * 0.4, len * 0.55 + headR * 0.3];
  g.sphere(headR, { at: head, color: body, seg: 10, rings: 8, part: PART.HEAD });
  const sn = (o.snout ?? 0.09) * s;
  if (sn > 0) {
    g.sphere(headR * 0.62, { at: [0, head[1] - headR * 0.25, head[2] + headR * 0.55 + sn * 0.4], scale: [0.9, 0.75, 1 + sn / (headR * 1.3)], color: o.muzzle ?? belly, seg: 9, rings: 6, part: PART.HEAD });
    g.sphere(headR * 0.18, { at: [0, head[1] - headR * 0.12, head[2] + headR * 0.6 + sn * 1.05], color: 0x2a2020, seg: 6, rings: 4, part: PART.HEAD });
  }
  eyes(g, [head[0], head[1] + headR * 0.15, head[2] + headR * 0.05], headR, { color: o.eyes ?? 0x241a14, glow: o.eyeGlow || 0, spread: 0.45, size: 0.85 });
  if (o.ears === "pointy" || o.ears === undefined)
    for (const sx of [-1, 1]) g.cone(headR * 0.32, headR * 0.7, { at: [sx * headR * 0.55, head[1] + headR * 0.85, head[2] - headR * 0.15], rot: [-0.2, 0, -sx * 0.3], color: body, seg: 5, part: PART.HEAD });
  if (o.ears === "round") for (const sx of [-1, 1]) g.sphere(headR * 0.3, { at: [sx * headR * 0.7, head[1] + headR * 0.7, head[2] - headR * 0.2], scale: [1, 1, 0.5], color: body, seg: 7, rings: 5, part: PART.HEAD });
  if (o.ears === "floppy") for (const sx of [-1, 1]) g.sphere(headR * 0.35, { at: [sx * headR * 0.95, head[1] + headR * 0.1, head[2] - headR * 0.1], scale: [0.4, 1.1, 0.7], color: shade(body, 0.85), seg: 7, rings: 5, part: PART.HEAD });
  if (o.horns)
    for (const sx of [-1, 1])
      g.tube(
        [
          [sx * headR * 0.5, head[1] + headR * 0.6, head[2]],
          [sx * headR * 1.1, head[1] + headR * 1.0, head[2] - headR * 0.2],
          [sx * headR * 1.2, head[1] + headR * 1.5, head[2] - headR * 0.4],
        ],
        [headR * 0.2, headR * 0.13, 0.004],
        { color: o.horns, seg: 6, part: PART.HEAD },
      );
  const tailZ = -len * 0.55,
    tailY = legLen + r * 0.8;
  if (o.tail === "bushy" || o.tail === undefined)
    g.sphere(0.07 * s, { at: [0, tailY + 0.02 * s, tailZ - 0.08 * s], scale: [0.7, 0.7, 1.6], rot: [0.6, 0, 0], color: o.tailColor ?? body, seg: 8, rings: 6, part: PART.TAIL, pivot: [tailY, tailZ] });
  else if (o.tail === "thin")
    g.tube(
      [
        [0, tailY, tailZ],
        [0, tailY + 0.03 * s, tailZ - 0.1 * s],
        [0, tailY - 0.02 * s, tailZ - 0.18 * s],
      ],
      [0.018 * s, 0.014 * s, 0.006 * s],
      { color: o.tailColor ?? body, seg: 5, part: PART.TAIL, pivot: [tailY, tailZ] },
    );
  else if (o.tail === "stub") g.sphere(0.04 * s, { at: [0, tailY, tailZ - 0.02], color: o.tailColor ?? body, seg: 6, rings: 4, part: PART.TAIL, pivot: [tailY, tailZ] });
  return { head, headR, back: [0, legLen + r * 1.4, 0], tail: [0, tailY, tailZ], legLen, bodyTop: legLen + r * 1.4 };
}

/** Wooden wheel facing ±X (axle along X). */
export function wheel(g, at, r, o = {}) {
  g.cylinder(r, r, o.width ?? 0.04, { at, rot: [0, 0, Math.PI / 2], color: o.color ?? WOOD.mid, seg: 12 });
  g.torus(r, 0.012, { at, rot: [0, 0, Math.PI / 2], color: o.rim ?? METAL.iron, seg: 14, tube: 4 });
  g.cylinder(r * 0.25, r * 0.25, (o.width ?? 0.04) + 0.02, { at, rot: [0, 0, Math.PI / 2], color: o.rim ?? METAL.iron, seg: 8 });
}

// ---------------------------------------------------------------------------------------------
// the round tower plate (drawn by the renderer under every tower)

/**
 * Round stone plate like in the concept: stone disc, a coloured rim band in the element colour
 * (gold trim for neutral towers) and a thin team-coloured strip at the bottom. Top at y = PLATE_H.
 */
export function plateGeo(element = "neutral", size = 1) {
  const g = new Geo(),
    r = 0.43 * size,
    h = PLATE_H,
    rim = ELEMENT_COLORS[element] ?? ELEMENT_COLORS.neutral,
    neutral = element === "neutral" || !ELEMENT_COLORS[element];
  g.lathe(
    [
      [r * 0.98, 0],
      [r, h * 0.2],
      [r * 0.99, h * 0.75],
      [r * 0.95, h],
      [0, h],
    ],
    { color: STONE.mid, seg: 24 },
  );
  // light top slab with stone seams
  g.cylinder(r * 0.86, r * 0.88, 0.012, { at: [0, h + 0.002, 0], color: STONE.light, seg: 24 });
  for (let i = 0; i < 6; i++) {
    const u = (i / 6) * Math.PI * 2 + 0.3;
    g.box(r * 0.42, 0.004, 0.012, { at: [Math.cos(u) * r * 0.5, h + 0.009, Math.sin(u) * r * 0.5], rot: [0, -u, 0], color: STONE.dark });
  }
  g.cylinder(r * 0.22, r * 0.22, 0.004, { at: [0, h + 0.009, 0], color: STONE.mid, seg: 12 });
  // coloured rim band
  g.torus(r * 1.0, h * 0.2, { at: [0, h * 0.55, 0], scale: [1, 0.9, 1], color: rim, glow: neutral ? 0.15 : 0.45, seg: 28, tube: 5 });
  if (neutral) g.torus(r * 1.005, h * 0.08, { at: [0, h * 0.86, 0], color: METAL.gold, glow: 0.2, seg: 28, tube: 4 });
  // team strip at the foot
  g.torus(r * 0.985, h * 0.1, { at: [0, h * 0.12, 0], color: 0x3a6fd0, team: 1, seg: 28, tube: 4 });
  return g;
}
