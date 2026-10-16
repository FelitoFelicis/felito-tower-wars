/**
 * First-match tutorial (v0.10g): one short bubble at a time and a pointing hand on the exact thing
 * to tap. The step is worked out from the game state every frame, so going back (deselecting the
 * card, switching tabs) simply shows the earlier step again. Runs once, in the first local game
 * against the AI; "Replay tutorial" in the options starts it again.
 *
 * app.js hands in a small API of getters (its state lives in module variables) and `hold(on)`,
 * which pauses the match while the player still builds and the setup countdown would run out.
 */
import { canBuild, findPath, towerAt, available } from "./simulation.js";
import { t } from "./i18n.js";

export const TUTORIAL_PREF = "felito.tutorial.v1";
const DOTS = 8;
const TEXT = {
  pick: "Tap the Archer: your first one is free!",
  pickMore: "Build more: tap the Archer.",
  place: "Tap the glowing field to build it.",
  more2: "Towers shoot monsters on the path. Build two more.",
  more1: "Great! Build one more.",
  toBuild: "Tap BUILD to place your towers.",
  board: "Tap your gold and lives up here to see your own board.",
  sendTab: "Now tap SEND to attack.",
  send: "Send a monster: it attacks your enemy and raises your income.",
  income: "+{n} = the gold you get every round. Sending monsters raises it.",
  back: "Tap BUILD to go back to your board.",
  tower: "Tap one of your towers to upgrade it.",
  upgrade: "Tap the upgrade to make it stronger.",
  final: "Stop monsters before they reach the bottom, or you lose lives. Good luck!",
  hold: "Take your time: the clock waits for you.",
  ready: "Monsters can go in {n} s.",
};
// Cartoon glove pointing up; the fingertip sits at (17, 2).
const HAND_SVG = `<svg viewBox="0 0 48 62" width="48" height="62" aria-hidden="true"><g stroke="#3b2410" stroke-width="2.4" stroke-linejoin="round"><rect x="4" y="31" width="11" height="17" rx="5.5" fill="#fff6e2" transform="rotate(-26 9.5 39.5)"/><rect x="9" y="23" width="32" height="29" rx="10" fill="#fff6e2"/><rect x="22" y="18.5" width="10" height="13" rx="5" fill="#fff6e2"/><rect x="31" y="20.5" width="10" height="13" rx="5" fill="#fff6e2"/><path d="M11 30V8a6 6 0 0 1 12 0v22" fill="#fff6e2"/><path d="M14 36c3 1.6 6 1.6 9 0" fill="none" stroke-width="1.6" stroke-linecap="round" opacity=".55"/><rect x="11.5" y="48.5" width="28" height="10.5" rx="3.5" fill="#e9b949"/><path d="M15 53.8h21" stroke="#a8782a" stroke-width="1.6" stroke-linecap="round"/></g></svg>`;
const TIP = { x: 17, y: 2 },
  HAND_LEN = 60;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

export function createTutorial(api) {
  let s = null,
    raf = 0,
    ui = null;

  const isDone = () => {
    try {
      return localStorage.getItem(TUTORIAL_PREF) === "done";
    } catch {
      return false;
    }
  };
  const save = (done) => {
    try {
      done ? localStorage.setItem(TUTORIAL_PREF, "done") : localStorage.removeItem(TUTORIAL_PREF);
    } catch {}
  };
  const eligible = () => api.begun() && !api.online() && ["training", "ffa"].includes(api.session());

  function mount() {
    if (ui) return ui;
    const root = document.createElement("div");
    root.className = "tut";
    root.hidden = true;
    root.innerHTML = `<div class="tut-ring"></div><div class="tut-tap"></div><div class="tut-hand"><div class="tut-hand-bob">${HAND_SVG}</div></div><div class="tut-bubble" role="status" aria-live="polite"><div class="tut-card"><p class="tut-text"></p><p class="tut-sub" hidden></p><div class="tut-foot"><span class="tut-dots" aria-hidden="true">${"<i></i>".repeat(DOTS)}</span><button type="button" class="tut-skip">${t("Skip")}</button><button type="button" class="tut-go" hidden>${t("Let's go!")}</button></div><i class="tut-tail" aria-hidden="true"></i></div></div>`;
    document.body.appendChild(root);
    ui = {
      root,
      ring: root.querySelector(".tut-ring"),
      tap: root.querySelector(".tut-tap"),
      hand: root.querySelector(".tut-hand"),
      bubble: root.querySelector(".tut-bubble"),
      card: root.querySelector(".tut-card"),
      text: root.querySelector(".tut-text"),
      sub: root.querySelector(".tut-sub"),
      dots: [...root.querySelectorAll(".tut-dots i")],
      skip: root.querySelector(".tut-skip"),
      go: root.querySelector(".tut-go"),
      tail: root.querySelector(".tut-tail"),
    };
    ui.skip.addEventListener("click", (e) => {
      e.stopPropagation();
      api.tone?.("tap");
      finish(true);
    });
    ui.go.addEventListener("click", (e) => {
      e.stopPropagation();
      api.tone?.("select");
      finish(false);
    });
    // presses on the two buttons must not reach the board or close the upgrade bar
    for (const b of [ui.skip, ui.go]) b.addEventListener("pointerdown", (e) => e.stopPropagation());
    return ui;
  }

  /** Starts the tutorial (once, unless forced). It shows as soon as no dialog is open. */
  function start({ force = false } = {}) {
    if ((!force && isDone()) || !eligible()) return false;
    stop();
    mount();
    s = { armed: performance.now(), sawModal: false, calmSince: 0, started: false, key: "", sub: null, holding: false, finalAt: 0, cell: null, cellKey: "", cellAt: 0, scrolledAt: 0 };
    raf = requestAnimationFrame(frame);
    return true;
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (s?.holding) api.hold(false);
    s = null;
    if (ui) ui.root.hidden = true;
  }
  function finish(skipped) {
    const wasStarted = !!s?.started;
    save(true);
    stop();
    api.onFinish?.({ skipped, started: wasStarted });
  }
  function hide() {
    if (ui && !ui.root.hidden) ui.root.hidden = true;
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!s) return;
    if (!eligible()) return stop();
    const game = api.game(),
      me = api.own(),
      p = game?.players?.[me];
    if (!p) return hide();
    if (!game.running || (game.winner !== null && game.winner !== undefined) || p.out) return s.started ? finish(false) : stop();
    if (document.querySelector("dialog[open]")) {
      s.sawModal = true;
      s.calmSince = 0;
      return hide();
    }
    const now = performance.now();
    if (!s.started) {
      // wait for the opening element choice: it opens a moment after the start
      s.calmSince ||= now;
      const opening = p.picks?.[0]?.kind === "element" && p.picks[0].level <= 1;
      if (opening && !s.sawModal && now - s.armed < 2500) return hide();
      if (now - s.calmSince < 300) return hide();
      s.started = true;
      s.baseBuilt = p.stats.built;
      s.baseSent = p.stats.sent;
      s.types = new Map(p.towers.map((tw) => [tw.id, tw.typeId]));
      s.sent = false;
      s.upgraded = false;
    }
    // progress is read from the game itself: builds, sends and upgrades (done or queued)
    for (const tw of p.towers) {
      const was = s.types.get(tw.id);
      if (was === undefined) s.types.set(tw.id, tw.typeId);
      else if (was !== tw.typeId) s.upgraded = true;
    }
    if (api.upQueued().length) s.upgraded = true;
    if (p.stats.sent > s.baseSent) s.sent = true;

    const step = resolve(game, me, p);
    const wantHold = !!step.build && game.warmup && game.incomeRemaining <= 1.05;
    if (wantHold !== s.holding) {
      s.holding = wantHold;
      api.hold(wantHold);
    }
    if (s.holding && !step.sub) step.sub = t(TEXT.hold);
    if (step.final) {
      s.finalAt ||= now;
      if (now - s.finalAt > 12000) return finish(false);
    }
    render(step);
  }

  // ---- steps ------------------------------------------------------------------------------
  function resolve(game, me, p) {
    const tab = api.tab(),
      view = api.view(),
      sel = api.selected(),
      built = p.stats.built - s.baseBuilt,
      afford = (id) => !!id && available(game, me, "build", id).ok;
    // 1–3: build three towers (as long as there is gold for it)
    if (built < 3 && (afford("h003") || afford(sel))) {
      const base = { build: true, n: built ? 3 : 1 };
      if (tab !== "build") return { ...base, key: "toBuild", text: TEXT.toBuild, target: shown('[data-tab="build"]') };
      if (view !== me) return { ...base, key: "board", text: TEXT.board, target: shown(".player-plate.own") };
      if (!sel || !afford(sel)) return { ...base, key: built ? "pickMore" : "pick", text: built ? TEXT.pickMore : TEXT.pick, target: archerCard() };
      const cell = suggestCell(game, me, p, sel);
      if (cell)
        return {
          ...base,
          n: built ? 3 : 2,
          key: "place" + built,
          text: built === 0 ? TEXT.place : built === 1 ? TEXT.more2 : TEXT.more1,
          target: { cell },
        };
    }
    // 4–5: send a monster
    if (!s.sent) {
      if (tab !== "send") return { key: "sendTab", n: 4, text: TEXT.sendTab, target: shown('[data-tab="send"]') };
      return {
        key: "send",
        n: 5,
        text: TEXT.send,
        sub: game.warmup ? t(TEXT.ready, { n: Math.max(1, Math.ceil(game.incomeRemaining)) }) : "",
        target: sendCard(),
      };
    }
    // 6: what the green number up top means (v0.11b): shown for a few seconds after the first
    // send, while play goes on; the overlay never takes taps
    if (!s.incomeDone) {
      s.sentAt ||= performance.now();
      const at = shown("#own-income") || shown(".hud-gold");
      if (at && performance.now() - s.sentAt < 5000) return { key: "income", n: 6, text: TEXT.income, vars: { n: Math.floor(p.income) }, target: at };
      s.incomeDone = true;
    }
    // 7: upgrade a tower (skipped when no tower can be upgraded)
    const catalog = api.catalog(),
      upgradable = p.towers.filter((tw) => (catalog?.byId[tw.typeId]?.upgrades || []).some((id) => catalog.byId[id]));
    if (!s.upgraded && upgradable.length) {
      if (tab !== "build") return { key: "back", n: 7, text: TEXT.back, target: shown('[data-tab="build"]') };
      if (view !== me) return { key: "board6", n: 7, text: TEXT.board, target: shown(".player-plate.own") };
      const up = api.selectedTower() ? shown("#cards [data-upgrade]") : null;
      if (up) return { key: "upgrade", n: 7, text: TEXT.upgrade, target: up };
      const tw = upgradable.find((x) => x.typeId === "h003" && x.buildRemaining <= 0) || upgradable.find((x) => x.buildRemaining <= 0) || upgradable[0];
      return { key: "tower", n: 7, text: TEXT.tower, target: { cell: { x: tw.gridX, y: tw.gridY, size: tw.size || 1 } } };
    }
    // 8: done
    return { key: "final", n: 8, text: TEXT.final, final: true, target: shown("#own-lives") || shown(".player-plate.own") };
  }

  /** The first matching element that is really on screen (not hidden, not covered). */
  function shown(selector) {
    for (const el of document.querySelectorAll(selector)) if (onScreen(el)) return el;
    return null;
  }
  const onScreen = (el) => !!tapPoint(el);
  /** A point where a tap really reaches `el` (other buttons may cover parts of it), or null. */
  function tapPoint(el) {
    if (!el?.isConnected || el.closest("[hidden]")) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.right < 2 || r.bottom < 2 || r.left > innerWidth - 2 || r.top > innerHeight - 2) return null;
    // a little right of and below the middle: the glove then leaves a card's name and price free
    for (const [u, v] of [[0.62, 0.6], [0.5, 0.5], [0.5, 0.3], [0.3, 0.5], [0.75, 0.5], [0.5, 0.86]]) {
      const x = clamp(r.left + r.width * u, 1, innerWidth - 1),
        y = clamp(r.top + r.height * v, 1, innerHeight - 1),
        hit = document.elementFromPoint(x, y);
      if (hit && (hit === el || el.contains(hit))) return { x, y };
    }
    return null;
  }
  function archerCard() {
    const card = shown('#sheet-cards [data-card="h003"]') || shown('#cards [data-card="h003"]');
    if (card) return card;
    // scrolled away in the card strip: bring it back once in a while
    const hidden = document.querySelector('#cards [data-card="h003"]'),
      now = performance.now();
    if (hidden && now - s.scrolledAt > 1500) {
      s.scrolledAt = now;
      hidden.parentElement?.scrollTo?.({ left: Math.max(0, hidden.offsetLeft - 8), behavior: "smooth" });
    }
    return shown('#cards [data-card][data-kind="tower"]') || shown("#cards [data-card]");
  }
  function sendCard() {
    const cards = [...document.querySelectorAll("#sheet-cards [data-card], #cards [data-card]")].filter(onScreen);
    return cards.find((c) => !c.classList.contains("unaffordable")) || cards[0] || null;
  }

  /**
   * A good free field for the selected tower: the one that lengthens the average route the most;
   * ties go to fields next to your towers (so they form a wall) and near the middle of the board.
   */
  function suggestCell(game, me, p, id) {
    const key = [p.towers.map((tw) => tw.gridX + "," + tw.gridY).join(" "), id, game.players[me].creeps.length].join("|"),
      now = performance.now();
    if (s.cell && s.cellKey === key && now - s.cellAt < 600) return s.cell;
    const { cols, rows } = game.grid,
      size = id && api.catalog()?.byId[id]?.isHall ? 2 : 1,
      route = (extra) => {
        let sum = 0;
        for (let c = 0; c < cols; c++) {
          const path = findPath(game, me, { x: c, y: -1 }, extra);
          if (!path) return -1;
          sum += path.length - 1;
        }
        return sum / cols;
      },
      base = route(null),
      mine = (x, y) => !!towerAt(p, x, y);
    let best = null;
    for (let y = 0; y <= rows - size; y++)
      for (let x = 0; x <= cols - size; x++) {
        if (!canBuild(game, me, x, y, id).ok) continue;
        const cells = [];
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) cells.push({ x: x + dx, y: y + dy });
        const gain = route(cells) - base,
          next = (mine(x - 1, y) ? 1 : 0) + (mine(x + size, y) ? 1 : 0) + (mine(x, y - 1) ? 0.4 : 0) + (mine(x, y + size) ? 0.4 : 0),
          far = Math.hypot(x + size / 2 - cols / 2, (y + size / 2 - 3.5) * 0.9),
          score = gain * 4 + Math.min(2, next) * 1.6 - far * 0.6;
        if (!best || score > best.score + 1e-6) best = { x, y, size, score };
      }
    s.cell = best;
    s.cellKey = key;
    s.cellAt = now;
    return best;
  }

  // ---- drawing ----------------------------------------------------------------------------
  function measure(target) {
    if (!target) return null;
    if (target instanceof Element) {
      const at = tapPoint(target);
      if (!at) return null;
      const r = target.getBoundingClientRect();
      return { kind: "el", rect: r, x: at.x, y: at.y, mid: r.top + r.height / 2 };
    }
    const cell = target.cell,
      arena = api.arena();
    if (!cell || !arena?.cellCenter) return null;
    const half = (cell.size - 1) / 2,
      c = arena.cellCenter(cell.x + half, cell.y + half),
      c1 = arena.cellCenter(cell.x + half + 1, cell.y + half);
    if (!c || !c1) return null;
    // cellCenter is relative to the arena container (the inverse of arena.gridAtClient)
    const box = document.getElementById("arena").getBoundingClientRect(),
      side = Math.hypot(c1.x - c.x, c1.y - c.y) * cell.size;
    return { kind: "cell", x: box.left + c.x, y: box.top + c.y, side };
  }

  function render(step) {
    const u = ui,
      text = t(step.text, step.vars);
    if (step.key !== s.key) {
      s.key = step.key;
      u.text.textContent = text;
      u.dots.forEach((d, i) => (d.className = i + 1 < step.n ? "done" : i + 1 === step.n ? "now" : ""));
      u.skip.hidden = !!step.final;
      u.go.hidden = !step.final;
      u.card.classList.remove("pop");
      void u.card.offsetWidth;
      u.card.classList.add("pop");
    } else if (u.text.textContent !== text) u.text.textContent = text;
    const sub = step.sub || "";
    if (sub !== s.sub) {
      s.sub = sub;
      u.sub.textContent = sub;
      u.sub.hidden = !sub;
    }
    if (u.root.hidden) u.root.hidden = false;
    const vw = innerWidth,
      vh = innerHeight,
      tg = measure(step.target),
      bw = u.bubble.offsetWidth,
      bh = u.bubble.offsetHeight;
    u.root.classList.toggle("no-target", !tg);
    if (!tg) {
      // nothing to point at (yet): the bubble waits above the card tray
      u.bubble.style.transform = `translate(${Math.round((vw - bw) / 2)}px, ${Math.round(vh * 0.62 - bh)}px)`;
      u.tail.hidden = true;
      return;
    }
    u.tail.hidden = false;
    const down = (tg.mid ?? tg.y) > vh * 0.5; // lower half: the hand comes from above and points down
    const fx = tg.x,
      fy = tg.kind === "cell" ? tg.y + tg.side * (down ? -0.08 : 0.1) : tg.y;
    u.root.dataset.x = Math.round(fx);
    u.root.dataset.y = Math.round(fy);
    const right = fx > vw * 0.62,
      // from above the glove comes in diagonally, so a card's name and price stay readable
      angle = down ? (right ? 147 : 213) : right ? 16 : -16;
    // ring: the card outline, or the glowing field
    u.ring.classList.toggle("cell", tg.kind === "cell");
    if (tg.kind === "cell") {
      const side = Math.max(16, tg.side - 3);
      Object.assign(u.ring.style, { width: side + "px", height: side + "px", transform: `translate(${tg.x - side / 2}px, ${tg.y - side / 2}px)` });
    } else {
      const r = tg.rect,
        pad = 5;
      Object.assign(u.ring.style, { width: r.width + pad * 2 + "px", height: r.height + pad * 2 + "px", transform: `translate(${r.left - pad}px, ${r.top - pad}px)` });
    }
    u.tap.style.transform = `translate(${fx}px, ${fy}px)`;
    u.hand.style.transform = `translate(${fx - TIP.x}px, ${fy - TIP.y}px) rotate(${angle}deg)`;
    // bubble beyond the glove's cuff, always inside the screen; its tail points at the cuff
    const rad = (angle * Math.PI) / 180,
      ex = fx - HAND_LEN * Math.sin(rad),
      ey = fy + HAND_LEN * Math.cos(rad),
      top = down ? ey - 10 - bh : ey + 10,
      left = clamp(ex - bw / 2, 10, Math.max(10, vw - bw - 10));
    let y = clamp(top, 8, Math.max(8, vh - bh - 8));
    // v0.11b: for a button in the nav row the bubble waits above the card tray, so it never
    // covers the cards (or puts Skip on top of one)
    const tray = document.querySelector(".command-deck")?.getBoundingClientRect();
    if (tray && tray.height > 0 && tg.kind === "el" && tg.rect.top >= tray.bottom - 4) y = Math.max(8, Math.min(y, tray.top - bh - 6));
    u.bubble.style.transform = `translate(${Math.round(left)}px, ${Math.round(y)}px)`;
    u.tail.classList.toggle("up", !down);
    u.tail.style.left = clamp(ex - left, 22, bw - 22) - 7 + "px";
  }

  return {
    start,
    stop,
    /** Clears "done" so the next local game against the AI shows the tutorial again. */
    reset: () => save(false),
    active: () => !!s,
    done: isDone,
  };
}
