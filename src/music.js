/**
 * Original, quiet eight-bar fantasy miniature, synthesized locally with Web Audio.
 * No audio files, network requests, storage, autoplay, or global input handlers.
 *
 * Usage (preference persistence belongs to the caller):
 *   const music = createBackgroundMusic();
 *   music.setEnabled(savedPreference === true);
 *   music.setPlaying(gameIsActive);
 *   // Call directly inside an actual click/pointer/key handler:
 *   await music.unlock();
 *
 * setEnabled(bool), setPlaying(bool): update intent; never create/resume a context.
 * unlock(): Promise<boolean>; create/resume in a user gesture, then honor intent.
 * getState(): { enabled, playing, active, needsGesture, supported, disposed }.
 * dispose(): Promise<void>; remove listeners, timers, nodes, and close the context.
 * After visibility loss or a browser audio interruption, a new unlock is required.
 * Options: volume (0..0.25, default 0.12), onError(error), plus injectable
 * createContext(), document, setTimeout, clearTimeout for deterministic tests.
 */
export function createBackgroundMusic(options = {}) {
  const ownerDocument = options.document ?? globalThis.document;
  const setTimer = options.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const clearTimer = options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  const contextFactory = options.createContext ?? (Context ? () => new Context() : null);
  const volume = Number.isFinite(options.volume) ? Math.max(0, Math.min(0.25, options.volume)) : 0.12;
  const voices = new Set();
  let context = null,
    master = null,
    filter = null,
    timer = null,
    pendingUnlock = null;
  let enabled = false,
    playing = false,
    disposed = false,
    gestureReady = false;
  let active = false,
    generation = 0,
    nextNoteAt = 0,
    position = 0;

  const beat = 60 / 72;
  const interval = beat / 2;
  const lookahead = 0.2;
  const chords = [
    [50, 57, 64],
    [50, 57, 65],
    [53, 60, 67],
    [53, 60, 69],
    [48, 55, 62],
    [48, 55, 64],
    [55, 62, 69],
    [50, 57, 64],
  ];
  const melody = [
    [74, 69, 76],
    [72, 69, 67],
    [69, 72, 77],
    [76, 72, 69],
    [74, 67, 72],
    [76, 74, 67],
    [69, 74, 72],
    [69, 64, null],
  ];
  const visible = () => !ownerDocument?.hidden;
  const wanted = () => enabled && playing && visible() && !disposed;
  const report = (error) => {
    try {
      options.onError?.(error);
    } catch {
      /* Audio must not break a match. */
    }
  };
  const safely = (callback) => {
    try {
      return callback();
    } catch (error) {
      report(error);
    }
  };

  function removeVoice(voice) {
    if (!voices.delete(voice)) return;
    voice.oscillator.onended = null;
    safely(() => voice.oscillator.disconnect());
    safely(() => voice.gain.disconnect());
    if (voice.pan) safely(() => voice.pan.disconnect());
  }

  function silence({ suspend = true } = {}) {
    active = false;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    const now = context?.currentTime || 0;
    if (master) {
      safely(() => master.gain.cancelScheduledValues(now));
      safely(() => master.gain.setValueAtTime(0, now));
    }
    for (const voice of [...voices]) {
      safely(() => voice.oscillator.stop(now));
      removeVoice(voice);
    }
    if (suspend && context?.state === "running") {
      try {
        Promise.resolve(context.suspend()).catch(report);
      } catch (error) {
        report(error);
      }
    }
  }

  function requireGesture() {
    generation++;
    gestureReady = false;
    silence();
  }

  function note(midi, at, duration, pad, panValue) {
    // A hard ceiling also covers delayed onended delivery on mobile browsers.
    if (voices.size >= 24 || !wanted()) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const pan = context.createStereoPanner ? context.createStereoPanner() : null;
    const voice = { oscillator, gain, pan };
    voices.add(voice);
    oscillator.onended = () => removeVoice(voice);
    oscillator.type = pad ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(440 * 2 ** ((midi - 69) / 12), at);
    oscillator.detune.setValueAtTime(pad ? panValue * 5 : 0, at);
    const peak = pad ? 0.075 : 0.11;
    const attack = pad ? 0.65 : 0.012;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(peak, at + attack);
    if (pad) gain.gain.setValueAtTime(peak, at + duration - 0.9);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain);
    if (pan) {
      pan.pan.setValueAtTime(panValue, at);
      gain.connect(pan);
      pan.connect(master);
    } else gain.connect(master);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.025);
  }

  function schedule() {
    timer = null;
    if (!wanted() || !gestureReady || context?.state !== "running") {
      silence({ suspend: false });
      return;
    }
    try {
      const now = context.currentTime;
      // Skip unheard beats after a main-thread stall; never emit a catch-up burst.
      if (nextNoteAt < now - lookahead) {
        const missed = Math.ceil((now + 0.06 - nextNoteAt) / interval);
        position += missed;
        nextNoteAt += missed * interval;
      }
      while (nextNoteAt < now + lookahead) {
        const step = position % 8;
        const bar = Math.floor(position / 8) % chords.length;
        if (step === 0)
          chords[bar].forEach((midi, index) => note(midi, nextNoteAt, beat * 4 - 0.16, true, (index - 1) * 0.38));
        const melodyIndex = [0, 3, 6].indexOf(step);
        if (melodyIndex >= 0 && melody[bar][melodyIndex] !== null) {
          note(melody[bar][melodyIndex], nextNoteAt, 1.15, false, bar % 2 ? 0.17 : -0.17);
        }
        position++;
        nextNoteAt += interval;
      }
      timer = setTimer(schedule, 80);
    } catch (error) {
      report(error);
      requireGesture();
    }
  }

  function reconcile() {
    if (!wanted()) return;
    if (active || !gestureReady || context?.state !== "running") return;
    active = true;
    nextNoteAt = context.currentTime + 0.06;
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(volume, now + 0.5);
    schedule();
  }

  function onContextState() {
    if (context?.state !== "running") {
      generation++;
      gestureReady = false;
      silence({ suspend: false });
    }
  }

  function ensureContext() {
    if (context) return context;
    context = contextFactory();
    master = context.createGain();
    filter = context.createBiquadFilter();
    master.gain.value = 0;
    filter.type = "lowpass";
    filter.frequency.value = 1700;
    filter.Q.value = 0.3;
    master.connect(filter);
    filter.connect(context.destination);
    if (context.addEventListener) context.addEventListener("statechange", onContextState);
    else context.onstatechange = onContextState;
    return context;
  }

  function unlock() {
    if (disposed || !enabled || !visible() || !contextFactory) return Promise.resolve(false);
    if (gestureReady && context?.state === "running") {
      reconcile();
      return Promise.resolve(true);
    }
    if (pendingUnlock) return pendingUnlock;
    const attempt = generation;
    let resumed;
    try {
      const audio = ensureContext();
      // Deliberately call resume synchronously in the caller's user activation.
      resumed = audio.state === "running" ? undefined : audio.resume();
    } catch (error) {
      report(error);
      silence();
      return Promise.resolve(false);
    }
    pendingUnlock = Promise.resolve(resumed)
      .then(
        () => {
          if (disposed || attempt !== generation || !enabled || !visible() || context?.state !== "running") {
            silence();
            return false;
          }
          gestureReady = true;
          reconcile();
          return true;
        },
        (error) => {
          report(error);
          gestureReady = false;
          silence();
          return false;
        },
      )
      .finally(() => {
        pendingUnlock = null;
      });
    return pendingUnlock;
  }

  function setEnabled(value) {
    if (disposed) return;
    const next = value === true;
    if (enabled === next) return;
    enabled = next;
    if (!enabled) requireGesture();
    else reconcile();
  }

  function setPlaying(value) {
    if (disposed) return;
    const next = value === true;
    if (playing === next) return;
    playing = next;
    if (!playing) requireGesture();
    else reconcile();
  }

  const onVisibility = () => {
    if (!visible()) requireGesture();
  };
  ownerDocument?.addEventListener("visibilitychange", onVisibility);

  function getState() {
    return { enabled, playing, active, needsGesture: wanted() && !gestureReady, supported: !!contextFactory, disposed };
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    requireGesture();
    ownerDocument?.removeEventListener("visibilitychange", onVisibility);
    if (!context) return;
    if (context.removeEventListener) context.removeEventListener("statechange", onContextState);
    else context.onstatechange = null;
    safely(() => master?.disconnect());
    safely(() => filter?.disconnect());
    try {
      if (context.state !== "closed") await context.close();
    } catch (error) {
      report(error);
    }
  }

  return { setEnabled, setPlaying, unlock, getState, dispose };
}
