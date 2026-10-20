/**
 * Circle Tower Wars designs (Sonnenwiese, Bonbon, Pfotenwelt): every tower and every monster moves in its
 * own way. Pure math on the sprite transform the arena already updates each frame (lean, stretch, offset,
 * tilt), so it costs no extra draw calls, textures or memory. The original design does not use this file.
 *
 * Towers: `idle` runs all the time, `attack` plays on each shot (k from 0 to 1). Both return
 *   { lean, stretch }  lean in eighths of the figure height towards the target, stretch of the body above the plate.
 * Monsters: `gait` returns { y, rot, sx, sy, lean } per step of their walk.
 */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
const seg = (k, a, b) => clamp((k - a) / (b - a), 0, 1);
const bump = (x) => Math.sin(Math.PI * clamp(x, 0, 1)); // 0 → 1 → 0
const settle = (x, f = 9, d = 5) => Math.exp(-d * x) * Math.cos(f * x); // decaying wobble from 1 to 0

// ---- tower idle styles: t in seconds, p phase, a amplitude scale --------------------------------------
const IDLE = {
  breathe: (t, p, a) => ({ lean: 0, stretch: 1 + 0.016 * a * Math.sin(t * 2 + p) }),
  pant: (t, p, a) => ({ lean: 0.03 * a * Math.sin(t * 2.2 + p), stretch: 1 + 0.012 * a * Math.sin(t * 15 + p) }), // dogs: quick panting
  sway: (t, p, a) => ({ lean: 0.16 * a * Math.sin(t * 1.4 + p), stretch: 1 + 0.01 * a * Math.sin(t * 2.8 + p) }),
  wave: (t, p, a) => ({ lean: 0.2 * a * Math.sin(t * 2.1 + p), stretch: 1 + 0.025 * a * Math.sin(t * 2.1 + p + 1.3) }), // naga, hydra, water
  flicker: (t, p, a) => ({ lean: 0.06 * a * Math.sin(t * 17 + p), stretch: 1 + 0.03 * a * (Math.sin(t * 13 + p) + Math.sin(t * 21 + 2 * p)) * 0.5 }),
  float: (t, p, a) => ({ lean: 0.05 * a * Math.sin(t * 0.9 + p), stretch: 1 + 0.04 * a * Math.sin(t * 1.8 + p) }),
  proud: (t, p, a) => ({ lean: 0, stretch: 1 + 0.03 * a * Math.pow(Math.max(0, Math.sin(t * 1.1 + p)), 2) }),
  mech: (t, p, a) => ({ lean: 0, stretch: 1 + 0.018 * a * Math.round(Math.sin(t * 3 + p) * 2) / 2 }), // stepped like a machine
  still: (t, p, a) => ({ lean: 0, stretch: 1 + 0.006 * a * Math.sin(t * 1.3 + p) }),
  crackle: (t, p, a) => {
    const c = (t * 0.7 + p) % 3.1; // a short jolt every few seconds
    return { lean: c < 0.25 ? 0.12 * a * Math.sin(c * 90) : 0, stretch: 1 + 0.012 * Math.sin(t * 2 + p) + (c < 0.25 ? 0.03 * a : 0) };
  },
  fidget: (t, p, a) => {
    const c = (t * 0.45 + p) % 2.6; // looks around now and then
    return { lean: 0.22 * a * bump(c / 0.9) * (Math.floor((t * 0.45 + p) / 2.6) % 2 ? 1 : -1), stretch: 1 + 0.012 * Math.sin(t * 2 + p) };
  },
  bounce: (t, p, a) => ({ lean: 0, stretch: 1 + 0.035 * a * Math.pow(Math.abs(Math.sin(t * 2.6 + p)), 3) }), // happy little hops
  chop: (t, p, a) => {
    const c = (t * 0.5 + p) % 2.2; // swings the tool now and then
    return { lean: c < 0.5 ? 0.55 * a * Math.sin((c / 0.5) * Math.PI) * (c < 0.2 ? -0.5 : 1) : 0, stretch: 1 + (c < 0.5 ? -0.03 * a * bump(c / 0.5) : 0.008 * Math.sin(t * 2)) };
  },
  hover: (t, p, a) => ({ lean: 0.04 * a * Math.sin(t * 0.7 + p), stretch: 1 + 0.05 * a * Math.sin(t * 1.2 + p) }),
  pulse: (t, p, a) => {
    const c = (t * 0.8 + p) % 1;
    return { lean: 0, stretch: 1 + 0.03 * a * (bump(c / 0.14) + 0.6 * bump((c - 0.2) / 0.14)) }; // heartbeat
  },
  heavy: (t, p, a) => ({ lean: 0.05 * a * Math.sin(t * 0.8 + p), stretch: 1 + 0.022 * a * Math.sin(t * 1.1 + p) }),
  wobble: (t, p, a) => ({ lean: 0.12 * a * (Math.sin(t * 1.7 + p) + 0.5 * Math.sin(t * 3.9 + 2 * p)), stretch: 1 + 0.015 * a * Math.sin(t * 2.3 + p) }), // zombies, shaky things
  none: () => ({ lean: 0, stretch: 1 }),
};

// ---- tower attack styles: k 0..1 over the attack --------------------------------------------------------
const ATTACK = {
  draw(k, a) {
    // pull the string back, release with a snap, settle
    if (k < 0.45) return { lean: -0.32 * a * ease(seg(k, 0, 0.45)), stretch: 1 + 0.035 * seg(k, 0, 0.45) };
    if (k < 0.58) return { lean: (-0.32 + 0.82 * seg(k, 0.45, 0.58)) * a, stretch: 1.035 - 0.05 * seg(k, 0.45, 0.58) };
    return { lean: 0.5 * a * (1 - ease(seg(k, 0.58, 1))), stretch: 0.985 + 0.015 * ease(seg(k, 0.58, 1)) };
  },
  double(k, a) {
    // two quick shots
    const h = k < 0.5 ? k * 2 : (k - 0.5) * 2;
    const r = ATTACK.draw(h, a * (k < 0.5 ? 0.8 : 1));
    return r;
  },
  slow(k, a) {
    // long calm draw (frost)
    if (k < 0.6) return { lean: -0.28 * a * ease(seg(k, 0, 0.6)), stretch: 1 + 0.03 * seg(k, 0, 0.6) };
    return { lean: (-0.28 + 0.7 * bump(seg(k, 0.6, 1))) * a * (1 - seg(k, 0.85, 1)), stretch: 1 };
  },
  precise(k, a) {
    // sniper: still, then a small sharp kick
    if (k < 0.15) return { lean: -0.5 * a * ease(seg(k, 0, 0.15)), stretch: 0.98 };
    return { lean: -0.5 * a * settle(seg(k, 0.15, 1), 14, 7), stretch: 1 - 0.02 * settle(seg(k, 0.15, 1), 14, 7) };
  },
  lunge(k, a) {
    if (k < 0.3) return { lean: -0.45 * a * ease(seg(k, 0, 0.3)), stretch: 1 + 0.03 * seg(k, 0, 0.3) };
    if (k < 0.48) {
      const x = seg(k, 0.3, 0.48);
      return { lean: (-0.45 + 1.75 * x * x) * a, stretch: 1.03 - 0.08 * x };
    }
    const x = ease(seg(k, 0.48, 1));
    return { lean: 1.3 * a * (1 - x), stretch: 0.95 + 0.05 * x };
  },
  thrust(k, a) {
    // fast spear or trident jab without a big wind-up
    if (k < 0.12) return { lean: -0.2 * a * seg(k, 0, 0.12), stretch: 1 };
    if (k < 0.26) return { lean: (-0.2 + 1.5 * ease(seg(k, 0.12, 0.26))) * a, stretch: 1 + 0.06 * seg(k, 0.12, 0.26) };
    return { lean: 1.3 * a * (1 - ease(seg(k, 0.26, 1))), stretch: 1.06 - 0.06 * ease(seg(k, 0.26, 1)) };
  },
  slam(k, a) {
    // rise tall, smash down, bounce back
    if (k < 0.35) return { lean: -0.3 * a * ease(seg(k, 0, 0.35)), stretch: 1 + 0.13 * a * ease(seg(k, 0, 0.35)) };
    if (k < 0.47) {
      const x = seg(k, 0.35, 0.47);
      return { lean: (-0.3 + 1.2 * x) * a, stretch: 1 + 0.13 * a - 0.3 * a * x * x };
    }
    const x = seg(k, 0.47, 1);
    return { lean: 0.9 * a * settle(x, 8, 5), stretch: 1 - 0.17 * a * settle(x, 10, 6) };
  },
  stomp(k, a) {
    // a hop on the spot and a heavy landing
    if (k < 0.3) return { lean: 0, stretch: 1 + 0.18 * a * ease(seg(k, 0, 0.3)) };
    if (k < 0.4) return { lean: 0, stretch: 1 + 0.18 * a - 0.36 * a * seg(k, 0.3, 0.4) };
    return { lean: 0.08 * Math.sin(seg(k, 0.4, 1) * 30) * (1 - seg(k, 0.4, 1)), stretch: 1 - 0.18 * a * settle(seg(k, 0.4, 1), 9, 5) };
  },
  cleave(k, a) {
    // diagonal swing: far back, then a long sweep through
    if (k < 0.32) return { lean: -0.7 * a * ease(seg(k, 0, 0.32)), stretch: 1 + 0.06 * seg(k, 0, 0.32) };
    if (k < 0.5) return { lean: (-0.7 + 2 * ease(seg(k, 0.32, 0.5))) * a, stretch: 1.06 - 0.12 * seg(k, 0.32, 0.5) };
    return { lean: 1.3 * a * (1 - ease(seg(k, 0.5, 1))), stretch: 0.94 + 0.06 * ease(seg(k, 0.5, 1)) };
  },
  bash(k, a) {
    // shield bash: short step in, squash on contact
    if (k < 0.2) return { lean: -0.2 * a * seg(k, 0, 0.2), stretch: 1.02 };
    if (k < 0.34) return { lean: (-0.2 + 1.1 * seg(k, 0.2, 0.34)) * a, stretch: 1.02 - 0.1 * seg(k, 0.2, 0.34) };
    return { lean: 0.9 * a * (1 - ease(seg(k, 0.34, 1))), stretch: 0.92 + 0.08 * ease(seg(k, 0.34, 1)) };
  },
  spin(k, a) {
    // glaive twirl: quick alternating leans that fade
    const x = seg(k, 0, 0.8);
    return { lean: 0.75 * a * Math.sin(x * TAU * 2.2) * (1 - x), stretch: 1 + 0.05 * bump(x) };
  },
  throw(k, a) {
    // big wind-up behind the head, whip forward
    if (k < 0.42) return { lean: -0.85 * a * ease(seg(k, 0, 0.42)), stretch: 1 + 0.07 * seg(k, 0, 0.42) };
    if (k < 0.55) return { lean: (-0.85 + 2.1 * ease(seg(k, 0.42, 0.55))) * a, stretch: 1.07 - 0.12 * seg(k, 0.42, 0.55) };
    return { lean: 1.25 * a * (1 - ease(seg(k, 0.55, 1))), stretch: 0.95 + 0.05 * ease(seg(k, 0.55, 1)) };
  },
  recoil(k, a) {
    if (k < 0.1) return { lean: -0.7 * a * ease(seg(k, 0, 0.1)), stretch: 1 - 0.1 * a * seg(k, 0, 0.1) };
    const y = seg(k, 0.1, 1);
    return { lean: -0.7 * a * settle(y, 11, 5), stretch: 1 - 0.1 * a * settle(y, 9, 6) };
  },
  punch(k, a) {
    // two jabs, left and right fist
    const j = (x) => (x < 0.3 ? -0.15 * x / 0.3 : 1.1 * bump((x - 0.3) / 0.7));
    const h = k < 0.5 ? k * 2 : (k - 0.5) * 2;
    return { lean: j(h) * a * (k < 0.5 ? 0.8 : 1), stretch: 1 - 0.05 * bump(h) };
  },
  laser(k, a) {
    // steady beam: a fine tremble while firing
    if (k < 0.12) return { lean: -0.25 * a * seg(k, 0, 0.12), stretch: 0.98 };
    const x = seg(k, 0.12, 1);
    return { lean: (-0.25 + 0.05 * Math.sin(x * 120)) * a * (1 - x), stretch: 0.98 + 0.02 * x };
  },
  catapult(k, a) {
    // arm cocks back slowly, then snaps forward and wobbles
    if (k < 0.4) return { lean: -0.6 * a * ease(seg(k, 0, 0.4)), stretch: 0.96 };
    const y = seg(k, 0.4, 1);
    return { lean: 0.9 * a * settle(y, 10, 4.5) * (y < 0.06 ? y / 0.06 : 1), stretch: 1 + 0.06 * settle(y, 10, 6) };
  },
  cast(k, a) {
    if (k < 0.4) return { lean: 0.1 * a * seg(k, 0, 0.4), stretch: 1 + 0.1 * a * ease(seg(k, 0, 0.4)) };
    if (k < 0.55) return { lean: (0.1 + 0.5 * seg(k, 0.4, 0.55)) * a, stretch: 1 + 0.1 * a - 0.14 * seg(k, 0.4, 0.55) };
    return { lean: 0.6 * a * (1 - ease(seg(k, 0.55, 1))), stretch: 0.96 + 0.04 * ease(seg(k, 0.55, 1)) };
  },
  castFast(k, a) {
    // fire: a quick flick of the wrist
    if (k < 0.18) return { lean: -0.2 * a * seg(k, 0, 0.18), stretch: 1 + 0.05 * seg(k, 0, 0.18) };
    return { lean: 0.8 * a * settle(seg(k, 0.18, 1), 12, 6), stretch: 1 + 0.05 * settle(seg(k, 0.18, 1), 12, 6) };
  },
  jolt(k, a) {
    // storm: a shock runs through the body
    const x = seg(k, 0, 0.7);
    return { lean: 0.35 * a * Math.sin(x * 70) * (1 - x), stretch: 1 + 0.08 * a * bump(x) };
  },
  flare(k, a) {
    // elementals and the phoenix puff up and burst
    if (k < 0.3) return { lean: 0, stretch: 1 + 0.16 * a * ease(seg(k, 0, 0.3)) };
    return { lean: 0.3 * a * settle(seg(k, 0.3, 1), 8, 6), stretch: 1 + 0.16 * a * settle(seg(k, 0.3, 1), 9, 4) };
  },
  surge(k, a) {
    // water rises like a wave, then falls forward
    if (k < 0.4) return { lean: -0.2 * a * seg(k, 0, 0.4), stretch: 1 + 0.15 * a * ease(seg(k, 0, 0.4)) };
    return { lean: (-0.2 + 1 * bump(seg(k, 0.4, 1))) * a, stretch: 1 + 0.15 * a * (1 - ease(seg(k, 0.4, 1))) };
  },
  strike(k, a) {
    // snake heads coil, then strike fast
    if (k < 0.3) return { lean: -0.55 * a * ease(seg(k, 0, 0.3)), stretch: 1 - 0.08 * seg(k, 0, 0.3) };
    if (k < 0.4) return { lean: (-0.55 + 1.9 * seg(k, 0.3, 0.4)) * a, stretch: 0.92 + 0.2 * seg(k, 0.3, 0.4) };
    return { lean: 1.35 * a * (1 - ease(seg(k, 0.4, 1))), stretch: 1.12 - 0.12 * ease(seg(k, 0.4, 1)) };
  },
  bloom(k, a) {
    // tree of life: unfolds slowly and glows
    return { lean: 0.15 * a * Math.sin(k * TAU), stretch: 1 + 0.1 * a * bump(k) };
  },
  pulse(k, a) {
    // buildings and crystals: a soft double beat
    return { lean: 0, stretch: 1 + 0.07 * a * (bump(k / 0.3) + 0.5 * bump((k - 0.35) / 0.3)) };
  },
};

// ---- monster gaits: s = step clock (radians), t seconds, p phase ------------------------------------------
const GAIT = {
  scurry: (s, t, p, a) => ({ y: 0.035 * a * Math.abs(Math.sin(s * 2.2)), rot: 0.04 * a * Math.sin(s * 2.2), sx: 1, sy: 1 + 0.03 * a * Math.sin(s * 4.4), lean: 0.12 * a }),
  trot: (s, t, p, a) => ({ y: 0.05 * a * Math.abs(Math.sin(s * 1.4)), rot: 0.06 * a * Math.sin(s * 1.4), sx: 1, sy: 1 + 0.03 * a * Math.cos(s * 2.8), lean: 0.06 * a }),
  gallop: (s, t, p, a) => ({ y: 0.08 * a * Math.max(0, Math.sin(s * 1.1)), rot: 0.1 * a * Math.sin(s * 1.1 + 0.8), sx: 1 + 0.02 * a * Math.sin(s * 2.2), sy: 1 - 0.03 * a * Math.sin(s * 2.2), lean: 0.08 * a }),
  hop(s, t, p, a) {
    const c = (s * 0.42) % 1, // airborne for most of the cycle, squash on landing
      air = c < 0.75 ? Math.sin((c / 0.75) * Math.PI) : 0,
      land = c >= 0.75 ? bump((c - 0.75) / 0.25) : 0;
    return { y: 0.14 * a * air, rot: 0.05 * a * Math.sin(c * TAU), sx: 1 + 0.08 * a * land - 0.03 * a * air, sy: 1 - 0.1 * a * land + 0.05 * a * air, lean: 0.05 * a };
  },
  waddle: (s, t, p, a) => ({ y: 0.02 * a * Math.abs(Math.sin(s)), rot: 0.13 * a * Math.sin(s), sx: 1, sy: 1 + 0.02 * a * Math.cos(s * 2), lean: 0 }),
  stomp(s, t, p, a) {
    const c = Math.sin(s * 0.75),
      down = Math.pow(1 - Math.abs(c), 6); // heavy footfall
    return { y: 0.04 * a * Math.abs(c), rot: 0.05 * a * c, sx: 1 + 0.05 * a * down, sy: 1 - 0.06 * a * down, lean: 0.02 * a };
  },
  march: (s, t, p, a) => ({ y: 0.03 * a * Math.abs(Math.sin(s * 1.2)), rot: 0.035 * a * Math.sign(Math.sin(s * 1.2)) * Math.pow(Math.abs(Math.sin(s * 1.2)), 0.5), sx: 1, sy: 1 + 0.02 * a * Math.cos(s * 2.4), lean: 0.03 * a }),
  rattle: (s, t, p, a) => ({ y: 0.03 * a * Math.abs(Math.sin(s * 1.3)), rot: 0.06 * a * Math.sin(s * 1.3) + 0.03 * a * Math.sin(s * 7.1), sx: 1, sy: 1 + 0.02 * Math.sin(s * 5), lean: 0.03 * a }), // skeleton bones clatter
  shamble: (s, t, p, a) => ({ y: 0.025 * a * Math.abs(Math.sin(s * 0.7)), rot: 0.1 * a * (Math.sin(s * 0.7) * 0.7 + 0.3 * Math.sin(s * 1.9 + p)), sx: 1, sy: 1 - 0.03 * a * Math.abs(Math.sin(s * 0.7)), lean: 0.1 * a + 0.06 * a * Math.sin(s * 0.35) }),
  float: (s, t, p, a) => ({ y: 0.06 * a + 0.05 * a * Math.sin(t * 2.1 + p), rot: 0.05 * a * Math.sin(t * 1.3 + p), sx: 1 - 0.03 * a * Math.sin(t * 2.1 + p), sy: 1 + 0.05 * a * Math.sin(t * 2.1 + p), lean: 0.08 * a * Math.sin(t * 1.6 + p) }),
  fly: (s, t, p, a) => ({ y: 0.05 * a * Math.sin(t * 6 + p), rot: 0.05 * a * Math.sin(t * 3 + p), sx: 1, sy: 1 + 0.06 * a * Math.sin(t * 12 + p), lean: 0.05 * a }),
  glide: (s, t, p, a) => ({ y: 0.06 * a * Math.sin(t * 1.7 + p), rot: 0.07 * a * Math.sin(t * 0.9 + p), sx: 1, sy: 1 + 0.025 * a * Math.sin(t * 3.4 + p), lean: 0.03 * a }),
  hover: (s, t, p, a) => ({ y: 0.03 * a * Math.sin(t * 9 + p), rot: 0.03 * a * Math.sin(t * 4.5 + p) + 0.02 * Math.sin(t * 23), sx: 1, sy: 1, lean: 0.06 * a }), // gyrocopter rattle
  scuttle: (s, t, p, a) => ({ y: 0.012 * a * Math.abs(Math.sin(s * 3.5)), rot: 0.02 * a * Math.sin(s * 7), sx: 1 + 0.025 * a * Math.sin(s * 3.5), sy: 1 - 0.025 * a * Math.sin(s * 3.5), lean: 0 }),
  slither: (s, t, p, a) => ({ y: 0.02 * a * Math.sin(s * 0.9), rot: 0.06 * a * Math.sin(s * 0.9), sx: 1 + 0.06 * a * Math.sin(s * 1.8), sy: 1 - 0.05 * a * Math.sin(s * 1.8), lean: 0.12 * a * Math.sin(s * 0.9 + 1) }),
  dash: (s, t, p, a) => ({ y: 0.03 * a * Math.abs(Math.sin(s * 2)), rot: 0.03 * a * Math.sin(s * 2), sx: 1, sy: 1 - 0.02 * a, lean: 0.22 * a }),
  roll: (s, t, p, a) => ({ y: 0.02 * a * Math.abs(Math.sin(s)), rot: 0.08 * a * Math.sin(s * 0.5), sx: 1 + 0.03 * a * Math.sin(s), sy: 1 - 0.03 * a * Math.sin(s), lean: 0.04 * a }),
  mech: (s, t, p, a) => ({ y: 0.035 * a * Math.round(Math.abs(Math.sin(s * 0.9)) * 3) / 3, rot: 0.03 * a * Math.round(Math.sin(s * 0.9) * 2) / 2, sx: 1, sy: 1, lean: 0.02 * a }), // clunky steps
};

/** [idle, attack, idle amount, attack amount] per tower figure. Keys are base art keys (shared by all sets). */
const TOWER = {
  "tower-archer": ["breathe", "draw"],
  "tower-archer-elite": ["proud", "double"],
  "tower-arrowtower": ["mech", "recoil", 1, 0.6],
  "tower-arcane-archer": ["float", "draw", 0.6],
  "tower-fire-archer": ["flicker", "draw", 0.7, 1.15],
  "tower-frost-archer": ["breathe", "slow", 0.7],
  "tower-poison-archer": ["sway", "draw", 0.8],
  "tower-naga-archer": ["wave", "draw"],
  "tower-birdhunter": ["fidget", "throw", 1, 0.7],
  "tower-headhunter": ["bounce", "throw"],
  "tower-trueshot": ["still", "precise"],
  "tower-glaive": ["sway", "spin"],
  "tower-guard": ["pant", "lunge"],
  "tower-guard-elite": ["proud", "bash"],
  "tower-guard-champion": ["proud", "slam", 1.2, 0.9],
  "tower-naga-guard": ["wave", "thrust"],
  "tower-bash": ["heavy", "slam"],
  "tower-stomp": ["heavy", "stomp", 1.3],
  "tower-ogre": ["sway", "slam", 0.7, 1.1],
  "tower-flame-crusader": ["flicker", "lunge", 0.4],
  "tower-death-knight": ["heavy", "cleave"],
  "tower-zombie": ["wobble", "lunge", 1, 0.8],
  "tower-treant": ["sway", "slam", 1.2, 0.8],
  "tower-tree-of-life": ["sway", "bloom", 0.6],
  "tower-cannon": ["still", "recoil"],
  "tower-cannon-elite": ["still", "recoil", 1, 1.3],
  "tower-robogoblin": ["mech", "punch"],
  "tower-hydra": ["wave", "strike", 1.3],
  "tower-pit-lord": ["heavy", "cleave", 1.2, 1.1],
  "tower-lich": ["float", "cast"],
  "tower-archangel": ["hover", "lunge", 0.8, 0.8],
  "tower-phoenix": ["flicker", "flare", 1.2],
  "tower-magic-elite": ["breathe", "cast"],
  "tower-magic-grand": ["proud", "cast", 0.8, 1.1],
  "tower-magic-city": ["hover", "pulse", 1.2],
  "tower-archmage": ["float", "cast", 0.5, 1.2],
  "tower-arcane": ["float", "cast"],
  "tower-fire": ["flicker", "castFast", 0.5],
  "tower-frost": ["breathe", "slow", 0.6],
  "tower-storm": ["crackle", "jolt"],
  "tower-earth": ["heavy", "stomp", 1, 0.8],
  "tower-poison": ["wobble", "throw", 0.5, 0.6],
  "tower-disease": ["still", "catapult"],
  "tower-earth-laser": ["still", "laser"],
  "tower-fire-elemental": ["flicker", "flare", 1.5],
  "tower-water-elemental": ["wave", "surge", 1.2],
  "tower-fire-lord": ["heavy", "flare", 1.2, 0.8],
  "tower-hall": ["pulse", "pulse"],
  "tower-farm": ["bounce", "pulse", 0.8],
  "tower-lumbermill": ["chop", "pulse"],
  "tower-exp-generator": ["pulse", "pulse", 0.8],
  "tower-wall": ["none", "pulse", 0, 0.3],
};
/** [gait, amount, pace] per monster figure. */
const CREEP = {
  "creep-goblin": ["scurry"],
  "creep-wichtel": ["scurry", 1.2, 1.15],
  "creep-horse": ["gallop"],
  "creep-gnoll": ["trot", 1.1],
  "creep-wolf": ["trot", 1.2, 1.2],
  "creep-skeleton": ["rattle"],
  "creep-orc": ["stomp", 0.8],
  "creep-satyr": ["hop", 0.8],
  "creep-necromancer": ["float", 0.6],
  "creep-sheep-fly": ["fly", 1.2],
  "creep-raider": ["gallop", 0.9, 1.1],
  "creep-alchemist": ["waddle", 0.9],
  "creep-golem": ["stomp", 1.2, 0.8],
  "creep-boar": ["gallop", 1.1, 1.3],
  "creep-centaur": ["gallop", 1, 0.9],
  "creep-gyrocopter": ["hover"],
  "creep-dryad": ["hop", 0.6, 1.1],
  "creep-troll": ["waddle", 1.1, 0.9],
  "creep-warlock": ["float", 0.8],
  "creep-zeppelin": ["glide", 0.6],
  "creep-spider": ["scuttle", 1.2],
  "creep-orc-warlord": ["stomp", 1],
  "creep-siege-golem": ["mech", 1.2],
  "creep-ghoul": ["shamble"],
  "creep-marauder": ["stomp", 1.1],
  "creep-shade": ["float", 1.2],
  "creep-darkknight": ["march", 1.2],
  "creep-siren": ["slither"],
  "creep-shaman": ["hop", 0.7, 0.9],
  "creep-fel-raider": ["gallop", 1.2],
  "creep-bat-rider": ["fly", 1],
  "creep-minotaur": ["stomp", 1.1, 1.1],
  "creep-flesh-golem": ["shamble", 1.2, 0.8],
  "creep-hellhound": ["trot", 1.3, 1.3],
  "creep-voidwalker": ["float", 1.4],
  "creep-yeti": ["waddle", 1.2, 0.85],
  "creep-dragonspawn": ["march", 1],
  "creep-spellbreaker": ["march", 0.8],
  "creep-frost-wyrm": ["glide", 1.2],
  "creep-demon-slayer": ["dash"],
  "creep-infernal": ["stomp", 1.4, 0.7],
  "creep-scarab": ["scuttle", 0.9, 0.8],
  "creep-pit-lord": ["stomp", 1.2, 0.9],
  "creep-gryphon": ["fly", 0.9],
  "creep-harpy": ["fly", 1.3],
  "creep-black-dragon": ["glide", 1],
  "creep-mountain-golem": ["stomp", 1.5, 0.6],
};

const base = (key) => key.replace(/-(v|l)\d$/, "").replace(/#.*$/, "");
/** Idle sway of a tower figure; `t` in seconds. */
export function towerIdle(key, t, phase) {
  const m = TOWER[base(key)] || ["breathe", "draw"];
  return (IDLE[m[0]] || IDLE.breathe)(t, phase, m[2] ?? 1);
}
/** Attack pose of a tower figure, `k` from 0 to 1, or null when the figure has no profile. */
export function towerAttack(key, k) {
  const m = TOWER[base(key)];
  if (!m) return null;
  return (ATTACK[m[1]] || ATTACK.draw)(k, m[3] ?? 1);
}
/** Attack style name (for small extra effects such as dust on a stomp). */
export const towerAttackStyle = (key) => TOWER[base(key)]?.[1] || null;
/** Walk of a monster: `step` grows with its pace, `t` in seconds. Offsets are in cells. */
export function creepGait(key, step, t, phase) {
  const m = CREEP[base(key)] || ["trot"];
  return (GAIT[m[0]] || GAIT.trot)(step * (m[2] ?? 1), t, phase, m[1] ?? 1);
}
