/**
 * Towers 1–15 of the concept sheet (docs/concepts/towers-and-world.png, top two rows).
 * Each model stands on y = 0 (top of the plate) and faces +Z.
 */
import { Geo, PART, defineModel, chibi, hood, bow, arrow, SKIN, METAL, WOOD, trim } from "./kit.js";

// 1 Archer: young hooded archer, green cloak, simple wooden bow.
defineModel("t-archer", ({ tier }) => {
  const g = new Geo();
  const a = chibi(g, { skin: SKIN.light, shirt: 0x3e7d3a, pants: 0x5a4632, boots: 0x6b4426, belt: 0x7a4e2a, armsUp: 0.35 });
  hood(g, a, 0x2f7a35);
  bow(g, [a.handL[0] - 0.03, a.handL[1] + 0.06, a.handL[2] + 0.04], { size: 0.36, color: tier >= 2 ? WOOD.dark : WOOD.mid, part: a.armL, arrow: true });
  // quiver on the back
  g.cylinder(0.045, 0.04, 0.2, { at: [0.06, a.shoulderY - 0.02, a.back[2] - 0.02], rot: [0.35, 0, -0.35], color: 0x7a4e2a, seg: 8 });
  for (const dx of [-0.015, 0.015]) g.cone(0.02, 0.05, { at: [0.1 + dx, a.shoulderY + 0.1, a.back[2] - 0.06], rot: [0.35, 0, -0.35], color: 0xd84a3a, seg: 4 });
  if (tier >= 2) g.torus(0.13, 0.015, { at: [0, a.shoulderY - 0.01, 0], scale: [1, 1, 0.8], color: trim(tier), seg: 14 });
  return g;
}, { kind: "tower", height: 0.82 });
