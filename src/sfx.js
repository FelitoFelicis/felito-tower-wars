/**
 * Small synthesized sound effects (no audio files). Every sound is a short
 * envelope on oscillators/noise, throttled so dense fights stay pleasant.
 */
export function createSfx() {
  let ctx = null,
    master = null,
    noise = null,
    enabled = true;
  const last = {};
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate),
      data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise = buffer;
    return ctx;
  }
  function tone({ type = "sine", from = 440, to = from, dur = 0.12, gain = 0.06, delay = 0, attack = 0.005 }) {
    const t = ctx.currentTime + delay,
      o = ctx.createOscillator(),
      v = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    v.gain.setValueAtTime(0.0001, t);
    v.gain.exponentialRampToValueAtTime(gain, t + attack);
    v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(v).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  function hiss({ dur = 0.15, gain = 0.05, freq = 1200, q = 0.8, delay = 0, sweep = 1 }) {
    const t = ctx.currentTime + delay,
      s = ctx.createBufferSource(),
      f = ctx.createBiquadFilter(),
      v = ctx.createGain();
    s.buffer = noise;
    f.type = "bandpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    v.gain.setValueAtTime(0.0001, t);
    v.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(v).connect(master);
    s.start(t);
    s.stop(t + dur + 0.02);
  }
  const sounds = {
    tap: () => tone({ type: "triangle", from: 720, to: 640, dur: 0.05, gain: 0.03 }),
    select: () => tone({ type: "triangle", from: 520, to: 780, dur: 0.07, gain: 0.035 }),
    build: () => {
      tone({ type: "square", from: 150, to: 70, dur: 0.12, gain: 0.05 });
      hiss({ dur: 0.12, gain: 0.05, freq: 500, sweep: 0.5 });
    },
    built: () => tone({ type: "triangle", from: 880, to: 1320, dur: 0.09, gain: 0.03 }),
    upgrade: () => {
      tone({ type: "triangle", from: 660, to: 990, dur: 0.1, gain: 0.04 });
      tone({ type: "triangle", from: 990, to: 1480, dur: 0.12, gain: 0.035, delay: 0.07 });
    },
    sell: () => {
      tone({ type: "triangle", from: 1200, to: 1600, dur: 0.06, gain: 0.035 });
      tone({ type: "triangle", from: 1500, to: 2000, dur: 0.06, gain: 0.03, delay: 0.06 });
    },
    send: () => hiss({ dur: 0.22, gain: 0.06, freq: 500, q: 1.4, sweep: 3.2 }),
    kill: () => tone({ type: "triangle", from: 900 + Math.random() * 200, to: 500, dur: 0.06, gain: 0.018 }),
    leak: () => {
      tone({ type: "sine", from: 120, to: 50, dur: 0.35, gain: 0.12 });
      hiss({ dur: 0.2, gain: 0.05, freq: 300, sweep: 0.4 });
    },
    breach: () => {
      tone({ type: "triangle", from: 520, to: 520, dur: 0.1, gain: 0.04 });
      tone({ type: "triangle", from: 780, to: 780, dur: 0.16, gain: 0.04, delay: 0.09 });
    },
    income: () => {
      tone({ type: "sine", from: 1320, to: 1320, dur: 0.12, gain: 0.03 });
      tone({ type: "sine", from: 1760, to: 1760, dur: 0.18, gain: 0.025, delay: 0.08 });
    },
    // v0.08c: a short bell at the start of every round (inharmonic partials, long decay)
    bell: () => {
      const f = 1046;
      [
        [1, 0.05, 1.1],
        [2.76, 0.022, 0.7],
        [5.4, 0.012, 0.45],
        [8.93, 0.006, 0.3],
      ].forEach(([k, g, d]) => tone({ type: "sine", from: f * k, to: f * k * 0.998, dur: d, gain: g, attack: 0.003 }));
      tone({ type: "triangle", from: f / 2, dur: 0.6, gain: 0.018, attack: 0.004 });
    },
    // v0.09u: Arrow Volley — a flight of whistling arrows falling from the sky
    volley: () => {
      for (let i = 0; i < 5; i++) {
        const d = i * 0.09 + Math.random() * 0.04,
          f = 2400 + Math.random() * 700;
        tone({ type: "sine", from: f, to: f * 0.55, dur: 0.55, gain: 0.022, delay: d, attack: 0.05 });
        hiss({ dur: 0.5, gain: 0.03, freq: f * 1.1, q: 6, delay: d, sweep: 0.55 });
      }
      hiss({ dur: 0.18, gain: 0.04, freq: 900, q: 1, delay: 0.62, sweep: 0.6 });
    },
    // v0.09w: First Blood — a heavy war-drum hit and a low growl under the voice line
    firstBlood: () => {
      tone({ type: "sine", from: 110, to: 40, dur: 0.5, gain: 0.22 });
      hiss({ dur: 0.25, gain: 0.08, freq: 220, q: 0.7, sweep: 0.5 });
      tone({ type: "sawtooth", from: 82, to: 62, dur: 0.7, gain: 0.05, delay: 0.12, attack: 0.06 });
      tone({ type: "sawtooth", from: 87, to: 65, dur: 0.7, gain: 0.04, delay: 0.12, attack: 0.06 });
      tone({ type: "sine", from: 98, to: 42, dur: 0.45, gain: 0.18, delay: 0.32 });
    },
    error: () => tone({ type: "square", from: 180, to: 140, dur: 0.12, gain: 0.03 }),
    tier: () => [523, 659, 784, 1046].forEach((f, i) => tone({ type: "triangle", from: f, dur: 0.16, gain: 0.04, delay: i * 0.08 })),
    victory: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone({ type: "triangle", from: f, dur: 0.3, gain: 0.05, delay: i * 0.11 })),
    defeat: () => [392, 330, 262, 196].forEach((f, i) => tone({ type: "sine", from: f, dur: 0.35, gain: 0.05, delay: i * 0.16 })),
  };
  const minGap = { volley: 0.5, kill: 0.07, tap: 0.03, built: 0.08, income: 0.3, leak: 0.12, bell: 1 };
  return {
    play(name) {
      if (!enabled || !sounds[name]) return;
      if (!ensure()) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const now = ctx.currentTime;
      if (last[name] && now - last[name] < (minGap[name] || 0.02)) return;
      last[name] = now;
      try {
        sounds[name]();
      } catch {}
    },
    unlock() {
      if (enabled && ensure() && ctx.state === "suspended") ctx.resume().catch(() => {});
    },
    /** Tier-up fanfare: grows from a bright arpeggio (tier 2) to a full brass-and-drums flourish (tier 5). */
    fanfare(tier = 2) {
      if (!enabled || !ensure()) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const n = Math.max(2, Math.min(5, tier)),
        root = [0, 0, 392, 349, 330, 294][n], // lower root each tier: a broader, heavier sound
        step = 0.13 - n * 0.008,
        up = [0, 4, 7, 12, 16, 19, 24].slice(0, 3 + n),
        hz = (semi) => root * Math.pow(2, semi / 12);
      try {
        up.forEach((s, i) => {
          tone({ type: "triangle", from: hz(s), dur: 0.22, gain: 0.045, delay: i * step });
          if (n >= 3) tone({ type: "sawtooth", from: hz(s + 7), dur: 0.2, gain: 0.012 + n * 0.003, delay: i * step });
        });
        const end = up.length * step;
        // closing chord, longer and fuller with every tier
        [0, 4, 7, 12, ...(n >= 4 ? [16, 19] : []), ...(n >= 5 ? [24] : [])].forEach((s) =>
          tone({ type: n >= 4 ? "sawtooth" : "triangle", from: hz(s + 12), dur: 0.5 + n * 0.18, gain: 0.02 + n * 0.004, delay: end, attack: 0.02 }),
        );
        if (n >= 3) tone({ type: "sine", from: hz(-12), to: hz(-12) * 0.98, dur: 0.6 + n * 0.15, gain: 0.08, delay: end });
        if (n >= 4) for (let k = 0; k < n - 1; k++) hiss({ dur: 0.18, gain: 0.05, freq: 180, q: 0.7, delay: k * step * 2, sweep: 0.5 });
        if (n >= 5) hiss({ dur: 1.2, gain: 0.05, freq: 6000, q: 0.4, delay: end, sweep: 0.6 });
      } catch {}
    },
    setEnabled(value) {
      enabled = !!value;
    },
    get enabled() {
      return enabled;
    },
  };
}

/** Short vibration cues where supported (Android); silently ignored elsewhere. */
export function haptic(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {}
}
