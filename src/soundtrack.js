/**
 * File-based soundtrack: a menu theme and a battle loop, decoded with Web Audio
 * and looped with a short crossfade (the source tracks end without a fade).
 */
export const TRACKS = Object.freeze({
  menu: { url: "assets/music/menu-call-to-adventure.mp3", volume: 0.26 },
  battle: { url: "assets/music/battle-clash-of-the-clans.mp3", volume: 0.18 },
});
const CROSSFADE = 2.4,
  SWITCH_FADE = 0.9;

export function createSoundtrack(tracks = TRACKS) {
  let ctx = null,
    master = null,
    enabled = true,
    wanted = null,
    ducked = false,
    level = 1, // v0.13: music volume (master × music slider)
    current = null,
    timer = null;
  const buffers = {},
    loading = {};
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? level : 0;
    master.connect(ctx.destination);
    return ctx;
  }
  async function load(name) {
    if (buffers[name]) return buffers[name];
    if (!loading[name])
      loading[name] = fetch(tracks[name].url)
        .then((r) => {
          if (!r.ok) throw new Error(r.status);
          return r.arrayBuffer();
        })
        .then((data) => new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject)))
        .then((buffer) => (buffers[name] = buffer))
        .catch(() => {
          loading[name] = null;
          return null;
        });
    return loading[name];
  }
  /** One playing instance of a track; schedules its own crossfaded successor. */
  function startVoice(name, buffer, at, fadeIn) {
    const src = ctx.createBufferSource(),
      gain = ctx.createGain(),
      level = tracks[name].volume;
    src.buffer = buffer;
    src.connect(gain).connect(master);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(level, at + fadeIn);
    src.start(at);
    return { name, src, gain, start: at, end: at + buffer.duration, level };
  }
  function fadeOut(voice, at, duration) {
    try {
      voice.gain.gain.cancelScheduledValues(at);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, at);
      voice.gain.gain.linearRampToValueAtTime(0.0001, at + duration);
      voice.src.stop(at + duration + 0.05);
    } catch {}
  }
  function tick() {
    if (!ctx || !current) return;
    const now = ctx.currentTime;
    if (!current.next && now >= current.end - CROSSFADE - 0.3) {
      const at = Math.max(now, current.end - CROSSFADE);
      current.next = startVoice(current.name, current.src.buffer, at, CROSSFADE);
      fadeOut(current, at, CROSSFADE);
    }
    if (current.next && now >= current.next.start + CROSSFADE) current = current.next;
  }
  async function switchTo(name) {
    wanted = name;
    if (!enabled || !ensure() || ctx.state !== "running") return;
    if (current?.name === name) return;
    const now = ctx.currentTime;
    if (current) {
      fadeOut(current, now, SWITCH_FADE);
      if (current.next) fadeOut(current.next, now, SWITCH_FADE);
      current = null;
    }
    if (!name) return;
    const buffer = await load(name);
    if (!buffer || wanted !== name || current) return;
    current = startVoice(name, buffer, ctx.currentTime + 0.05, SWITCH_FADE);
    clearInterval(timer);
    timer = setInterval(tick, 250);
  }
  return {
    /** Must be called from a user gesture before audio can start. */
    unlock() {
      if (!enabled || !ensure()) return;
      if (ctx.state === "suspended") ctx.resume().then(() => switchTo(wanted)).catch(() => {});
      else switchTo(wanted);
    },
    play(name) {
      if (wanted === name && (current?.name === name || !enabled)) return;
      switchTo(name);
    },
    stop() {
      switchTo(null);
    },
    /** Quieter while a menu is open, without changing the track. */
    setDucked(value) {
      if (ducked === !!value) return;
      ducked = !!value;
      if (master) master.gain.setTargetAtTime(enabled ? (ducked ? 0.45 : 1) * level : 0, ctx.currentTime, 0.25);
    },
    setEnabled(value) {
      enabled = !!value;
      if (master) master.gain.setTargetAtTime(enabled ? (ducked ? 0.45 : 1) * level : 0, ctx.currentTime, 0.15);
      if (enabled) switchTo(wanted);
    },
    /** v0.13: 0..1 */
    setVolume(value) {
      level = Math.max(0, Math.min(1, Number(value) || 0));
      if (master) master.gain.setTargetAtTime(enabled ? (ducked ? 0.45 : 1) * level : 0, ctx.currentTime, 0.08);
    },
    /** Suspend while the page is hidden. */
    setHidden(hidden) {
      if (!ctx) return;
      if (hidden) ctx.suspend().catch(() => {});
      else if (enabled) ctx.resume().catch(() => {});
    },
    preload(name) {
      if (ensure()) load(name);
    },
    getState() {
      return { enabled, wanted, playing: current?.name || null, context: ctx?.state || "none" };
    },
  };
}
