/**
 * File-based soundtrack: a menu theme and a battle loop, looped with a short crossfade
 * (the source tracks end without a fade).
 * v0.23: the tracks stream through <audio> elements (MediaElementAudioSourceNode → per-voice gain →
 * master) instead of being decoded whole with decodeAudioData (both tracks decoded held ~68 MB of RAM).
 * The gain graph, the crossfades, ducking, mute and volume work exactly as before.
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
  // v0.23: per track a small pool of <audio> elements, each wired once into the graph
  // (an element can only get one MediaElementAudioSourceNode). Two per track cover the loop crossfade.
  const pool = {};
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
  function makeEntry(name) {
    const el = new Audio();
    el.preload = "auto";
    el.loop = false;
    el.src = tracks[name].url;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    let src = null;
    try {
      src = ctx.createMediaElementSource(el);
      src.connect(gain).connect(master);
    } catch {}
    const entry = { el, src, gain, busy: false, primed: false, stopTimer: null, startTimer: null };
    pool[name].push(entry);
    return entry;
  }
  /** v0.23: an idle element of the track; the first need creates two (the loop crossfade plays both). */
  function idleEntry(name) {
    const list = (pool[name] ||= []);
    if (!list.length) makeEntry(name), makeEntry(name); // the second one buffers ahead for the loop
    return list.find((e) => !e.busy) || makeEntry(name);
  }
  /** One playing instance of a track (fades in from `delay` seconds from now). */
  function startVoice(name, delay, fadeIn) {
    const entry = idleEntry(name),
      { el, gain } = entry,
      volume = tracks[name].volume,
      at = ctx.currentTime + delay;
    entry.busy = true;
    clearTimeout(entry.stopTimer);
    gain.gain.cancelScheduledValues(0);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(volume, at + fadeIn);
    const voice = { name, entry, gain, start: at, level: volume, next: null, stopped: false };
    const go = () => {
      if (voice.stopped) return;
      try {
        el.currentTime = 0;
      } catch {}
      if (el.readyState < 3) {
        // not buffered yet: hold the fade-in until the stream really plays (as the decoded version waited for its buffer)
        gain.gain.cancelScheduledValues(0);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        el.addEventListener(
          "playing",
          () => {
            if (voice.stopped) return;
            const t0 = ctx.currentTime;
            gain.gain.cancelScheduledValues(0);
            gain.gain.setValueAtTime(0.0001, t0);
            gain.gain.linearRampToValueAtTime(volume, t0 + fadeIn);
            voice.start = t0;
          },
          { once: true },
        );
      }
      if (document.hidden) return; // setHidden(false) starts it with the context
      const p = el.play();
      if (p?.catch)
        p.catch(() => {
          // could not start (no gesture yet, file missing): free the element; the next switch or tick tries again
          voice.stopped = true;
          release(entry);
          if (current === voice) current = null;
          else if (current?.next === voice) current.next = null;
        });
    };
    if (delay > 0.06) entry.startTimer = setTimeout(go, delay * 1000);
    else go();
    // a track that ends before the timer saw it (throttled timers) hands over at once
    el.onended = () => {
      if (current === voice && !voice.next && wanted === name) {
        voice.next = startVoice(name, 0, 0.05);
        current = voice.next;
      }
      if (!voice.stopped) release(entry);
    };
    return voice;
  }
  function release(entry) {
    clearTimeout(entry.stopTimer);
    clearTimeout(entry.startTimer);
    try {
      entry.el.pause();
    } catch {}
    entry.busy = false;
  }
  function fadeOut(voice, at, duration) {
    try {
      voice.gain.gain.cancelScheduledValues(at);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, at);
      voice.gain.gain.linearRampToValueAtTime(0.0001, at + duration);
    } catch {}
    const entry = voice.entry;
    clearTimeout(entry.stopTimer);
    entry.stopTimer = setTimeout(() => {
      voice.stopped = true;
      release(entry);
    }, Math.max(0, at - ctx.currentTime + duration + 0.05) * 1000);
  }
  function tick() {
    if (!ctx || !current) return;
    const el = current.entry.el,
      d = el.duration,
      t = el.currentTime;
    if (!current.next && Number.isFinite(d) && d > CROSSFADE * 2) {
      if (t >= d - CROSSFADE - 0.3) {
        const delay = Math.max(0, d - CROSSFADE - t);
        current.next = startVoice(current.name, delay, CROSSFADE);
        fadeOut(current, ctx.currentTime + delay, CROSSFADE);
      }
    }
    if (current.next && ctx.currentTime >= current.next.start + CROSSFADE) current = current.next;
  }
  function switchTo(name) {
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
    current = startVoice(name, 0.05, SWITCH_FADE);
    clearInterval(timer);
    timer = setInterval(tick, 250);
  }
  /** v0.23: playing elements, for pausing them while the page is hidden. */
  const busyEntries = () => Object.values(pool).flat().filter((e) => e.busy);
  return {
    /** Must be called from a user gesture before audio can start. */
    unlock() {
      if (!enabled || !ensure()) return;
      // v0.23: every element is started once inside a gesture (mobile Safari lets later play() calls,
      // e.g. the loop crossfade, through only after that), silent behind its idle gain
      if (wanted) idleEntry(wanted);
      for (const entry of Object.values(pool).flat())
        if (!entry.primed && !entry.busy) {
          entry.primed = true;
          entry.el
            .play()
            ?.then?.(() => {
              if (!entry.busy) entry.el.pause();
            })
            .catch(() => (entry.primed = false));
        }
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
      if (hidden) {
        ctx.suspend().catch(() => {});
        for (const e of busyEntries()) e.el.pause(); // v0.23: the streams pause with the context
      } else if (enabled)
        ctx
          .resume()
          .then(() => {
            for (const e of busyEntries()) if (e.el.paused) e.el.play()?.catch?.(() => {});
          })
          .catch(() => {});
    },
    /** v0.23: starts buffering the track's stream (no decoding any more). */
    preload(name) {
      if (ensure()) idleEntry(name);
    },
    getState() {
      return { enabled, wanted, playing: current?.name || null, context: ctx?.state || "none", elements: Object.values(pool).flat().length }; // v0.23: elements (debug)
    },
  };
}
