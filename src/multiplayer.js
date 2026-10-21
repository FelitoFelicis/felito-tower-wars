/**
 * Felito online transport. The host owns the simulation; this module only carries JSON.
 * v0.19: rooms hold up to six players (the host plus MAX_GUESTS guests, star topology).
 * Real PeerJS/WebRTC, no simulated online transport and no embedded credentials.
 */
// Version 3 requires the schema-4 expanded board and mobile movement rules. Keep the address namespace
// stable so an old client receives a clear handshake mismatch, not a lost room.
// v0.19: protocol 5 = rooms with up to six players (seat assignment in the lobby).
// v0.23: protocol 7 = compressed direct channel, tower deltas, rejoin tokens, room-wide relay topic. An older
// client gets a clean "versions don't match" at the handshake instead of undecodable data.
export const PROTOCOL_VERSION = 7; // v0.20: team games and room options (older versions cannot join)
export const MAX_GUESTS = 5;
export const MAX_PAYLOAD_BYTES = 512 * 1024;
export const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PROTOCOL = "felito-tw";
const MAX_WIRE_BYTES = MAX_PAYLOAD_BYTES + 1024;
const SCRIPT_URL = new URL("../vendor/peerjs.min.js", import.meta.url).href;
const encoder = new TextEncoder();
let peerLoader;


/**
 * v0.13: ICE servers. PeerJS's own TURN relays (eu-0/us-0.turn.peerjs.com) no longer hand out
 * relay candidates, so two players behind strict NATs (mobile data, many home routers) could
 * never connect. Several STUN servers find direct routes; a TURN relay carries the rest.
 * TURN_SERVICE: a Metered.ca app (free tier). Its API key is meant for browsers and only
 * returns short-lived TURN credentials. Empty = STUN only.
 */
export const TURN_SERVICE = { app: "", apiKey: "" };
const STUN_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" },
];
let iceCache = null;
async function iceServers() {
  if (iceCache && iceCache.until > Date.now()) return iceCache.servers;
  let turn = [];
  if (TURN_SERVICE.app && TURN_SERVICE.apiKey) {
    try {
      const ctrl = new AbortController(),
        timer = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(`https://${TURN_SERVICE.app}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(TURN_SERVICE.apiKey)}`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) turn = (await r.json()).filter((s) => s && s.urls && !String(s.urls).startsWith("stun"));
    } catch {}
  }
  const servers = [...STUN_SERVERS, ...turn];
  iceCache = { servers, until: Date.now() + (turn.length ? 10 * 60 * 1000 : 60 * 1000) };
  return servers;
}
async function peerOptions(dependencies = {}) {
  return {
    host: "0.peerjs.com",
    port: 443,
    path: "/",
    secure: true,
    debug: 0,
    // test hook: window.felitoForceRelay = true blocks direct channels, so the relay path runs
    config: globalThis.felitoForceRelay ? { iceServers: [], iceTransportPolicy: "relay" } : { iceServers: await iceServers() },
    ...(dependencies.peerOptions || {}),
  };
}

// ---- v0.13a: relay fallback over public MQTT brokers ------------------------------------
// When two devices can't open a direct WebRTC channel (mobile data, strict routers) and no TURN
// relay is configured, the game data travels through public MQTT brokers instead. The topic is
// derived from a 128-bit random secret that the guest sends to the host through PeerJS
// signalling (connection metadata), so nobody else knows it. Messages are deflated and carry a
// frame counter, so both brokers can be used at once and duplicates are dropped.
const RELAY_BROKERS = ["wss://broker.hivemq.com:8884/mqtt", "wss://test.mosquitto.org:8081/mqtt"];
const RELAY_AFTER_MS = 5000;
const textEnc = new TextEncoder(),
  textDec = new TextDecoder();
export function randomSecret(dependencies = {}) {
  const bytes = dependencies.randomBytes ? dependencies.randomBytes(16) : globalThis.crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const validSecret = (s) => typeof s === "string" && /^[0-9a-f]{32}$/.test(s);
async function deflate(bytes) {
  if (!globalThis.CompressionStream) return bytes;
  const out = new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw")));
  return new Uint8Array(await out.arrayBuffer());
}
async function inflate(bytes) {
  if (!globalThis.DecompressionStream) return bytes;
  const out = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")));
  return new Uint8Array(await out.arrayBuffer());
}
/** v0.23: inflate that stops at `max` bytes (a tiny frame can't blow up into gigabytes); null if larger. */
async function inflateCapped(bytes, max) {
  if (!globalThis.DecompressionStream) return null;
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader(),
    parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}
/** Minimal MQTT 3.1.1 client over WebSocket: connect, subscribe, QoS 0 publish, ping. */
const RELAY_GIVE_UP_MS = 45000, // v0.23: a broker that stays unreachable this long is gone for good
  RELAY_LINK_BUFFER = 512 * 1024; // v0.23: a broker socket with this much unsent data skips frames
class MqttLink {
  constructor(url, onMessage) {
    this.url = url;
    this.onMessage = onMessage;
    this.ready = false;
    this.closed = false;
    this.dead = false; // v0.23: gave up reconnecting
    this.subs = [];
    this.buffer = new Uint8Array(0);
    this.packetId = 1;
    this.everReady = false;
    this.retries = 0;
    this.downSince = 0;
    this.retryTimer = null;
    this.opening = false;
    this.onDead = null;
  }
  get bufferedAmount() {
    return this.ws?.bufferedAmount || 0;
  }
  static str(s) {
    const b = textEnc.encode(s);
    return [b.length >> 8, b.length & 255, ...b];
  }
  static len(n) {
    const out = [];
    do {
      let d = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) d |= 128;
      out.push(d);
    } while (n > 0);
    return out;
  }
  packet(type, body) {
    const head = [type, ...MqttLink.len(body.length)],
      out = new Uint8Array(head.length + body.length);
    out.set(head, 0);
    out.set(body, head.length);
    return out;
  }
  open(timeout = 6000) {
    return new Promise((resolve) => {
      let done = false;
      this.opening = true;
      const finish = (ok) => {
        if (done) return;
        done = true;
        this.opening = false;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => {
        finish(false);
        // v0.23: a reconnect attempt that times out only drops its socket (the link keeps retrying)
        if (this.everReady) this.dropSocket();
        else this.close();
      }, timeout);
      this.buffer = new Uint8Array(0);
      try {
        this.ws = new WebSocket(this.url, ["mqtt"]);
      } catch {
        finish(false);
        if (this.everReady) this.lost();
        return;
      }
      const ws = this.ws;
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        const id = "felito-" + Math.random().toString(36).slice(2, 12);
        ws.send(this.packet(0x10, [...MqttLink.str("MQTT"), 4, 2, 0, 60, ...MqttLink.str(id)]));
      };
      ws.onmessage = (e) => {
        if (ws !== this.ws) return;
        const add = new Uint8Array(e.data),
          merged = new Uint8Array(this.buffer.length + add.length);
        merged.set(this.buffer);
        merged.set(add, this.buffer.length);
        this.buffer = merged;
        this.parse(() => {
          if (this.ready) {
            this.everReady = true;
            this.retries = 0;
            this.downSince = 0;
          }
          finish(true);
        });
      };
      ws.onerror = () => finish(false);
      ws.onclose = () => {
        if (ws !== this.ws) return;
        this.ready = false;
        finish(false);
        if (this.everReady) this.lost(); // v0.23: the broker dropped us: reconnect with backoff
      };
      clearInterval(this.ping); // v0.23: one keep-alive per link, also after reconnects
      this.ping = setInterval(() => {
        if (this.ready) this.raw(new Uint8Array([0xc0, 0]));
      }, 25000);
    });
  }
  /** v0.23: closes the current socket only (a reconnect follows). */
  dropSocket() {
    const ws = this.ws;
    this.ready = false;
    try {
      ws?.close();
    } catch {}
    if (!this.closed) this.lost();
  }
  /**
   * v0.23: the broker socket closed while we still need it: reconnect after 1, 2, 4 … 15 s (with jitter).
   * The subscriptions are sent again on CONNACK. After RELAY_GIVE_UP_MS without a broker the link is dead.
   */
  lost() {
    if (this.closed || this.dead || this.retryTimer || this.opening) return;
    const now = Date.now();
    this.downSince ||= now;
    if (now - this.downSince >= RELAY_GIVE_UP_MS) {
      this.dead = true;
      clearInterval(this.ping);
      try {
        this.onDead?.(this);
      } catch {}
      return;
    }
    const delay = Math.min(15000, 1000 * 2 ** this.retries++) * (0.8 + Math.random() * 0.4);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.closed) return;
      this.open().then((ok) => {
        if (!ok && !this.closed) this.lost();
      });
    }, delay);
  }
  parse(onConnack) {
    while (this.buffer.length >= 2) {
      let mult = 1,
        length = 0,
        i = 1,
        byte;
      do {
        if (i >= this.buffer.length) return;
        byte = this.buffer[i++];
        length += (byte & 127) * mult;
        mult *= 128;
      } while (byte & 128);
      if (this.buffer.length < i + length) return;
      const type = this.buffer[0],
        body = this.buffer.subarray(i, i + length);
      this.buffer = this.buffer.slice(i + length);
      if (type >> 4 === 2) {
        this.ready = body[1] === 0;
        for (const t of this.subs) this.sendSubscribe(t);
        onConnack();
      } else if (type >> 4 === 3) {
        const tl = (body[0] << 8) | body[1],
          topic = textDec.decode(body.subarray(2, 2 + tl)),
          qos = (type >> 1) & 3,
          start = 2 + tl + (qos ? 2 : 0);
        try {
          this.onMessage(topic, body.slice(start));
        } catch {}
      }
    }
  }
  raw(bytes) {
    try {
      if (this.ws?.readyState === 1) this.ws.send(bytes);
    } catch {}
  }
  sendSubscribe(topic) {
    const id = this.packetId++ & 0xffff || 1;
    this.raw(this.packet(0x82, [id >> 8, id & 255, ...MqttLink.str(topic), 0]));
  }
  subscribe(topic) {
    this.subs.push(topic);
    if (this.ready) this.sendSubscribe(topic);
  }
  publish(topic, bytes) {
    if (!this.ready) return false;
    if (this.bufferedAmount > RELAY_LINK_BUFFER) return false; // v0.23: this broker is behind; the other one carries the frame
    const t = MqttLink.str(topic),
      body = new Uint8Array(t.length + bytes.length);
    body.set(t);
    body.set(bytes, t.length);
    this.raw(this.packet(0x30, body));
    return true;
  }
  close() {
    this.closed = true;
    clearInterval(this.ping);
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    try {
      if (this.ws?.readyState === 1) this.raw(new Uint8Array([0xe0, 0]));
      this.ws?.close();
    } catch {}
  }
}
/**
 * v0.23: in-order delivery of relay frames that arrive over two brokers. Replaces the old high-water
 * mark, which threw away a frame that only the slower broker delivered. A sliding window drops
 * duplicates, holds frames that arrive early and waits up to RELAY_GAP_MS for a missing one before
 * it skips the gap. `deliver(bytes)` gets every frame once, in counter order.
 */
const RELAY_GAP_MS = 500,
  RELAY_WINDOW = 256;
export function frameWindow(deliver, timers = {}) {
  const later = timers.setTimeout || setTimeout,
    stop = timers.clearTimeout || clearTimeout;
  let next = 0,
    gapTimer = null;
  const held = new Map();
  const drain = () => {
    while (held.has(next)) {
      const bytes = held.get(next);
      held.delete(next++);
      deliver(bytes);
    }
    if (!held.size) {
      stop(gapTimer);
      gapTimer = null;
    } else if (!gapTimer)
      gapTimer = later(() => {
        gapTimer = null;
        if (held.size) next = Math.min(...held.keys()); // the missing frame never came: skip it
        drain();
      }, RELAY_GAP_MS);
  };
  return (n, bytes) => {
    if (!next) next = n; // the first frame we hear starts the window
    if (n < next || held.has(n)) return false; // a duplicate (the other broker) or too old
    if (n >= next + RELAY_WINDOW) {
      // far ahead (the sender restarted its window or we were away): start over from here
      for (const k of [...held.keys()].sort((a, b) => a - b)) deliver(held.get(k));
      held.clear();
      next = n;
    }
    held.set(n, bytes);
    drain();
    return true;
  };
}
/**
 * A message channel on all reachable brokers. `inbox`/`outbox` are topics. Messages are strings
 * (deflated on the wire, framed with a counter). Resolves once at least one broker is connected.
 * v0.23: more inboxes (e.g. the room-wide broadcast topic) can be added later with `links.listen(topic, onText)`.
 */
async function openRelayLinks(inbox, onText) {
  const inboxes = new Map();
  const listen = (topic, handler) => {
    if (inboxes.has(topic)) return;
    const chain = { p: Promise.resolve() };
    const accept = frameWindow((bytes) => {
      chain.p = chain.p.then(() => inflate(bytes)).then((b) => handler(textDec.decode(b))).catch(() => {});
    });
    inboxes.set(topic, accept);
  };
  if (inbox) listen(inbox, onText);
  const onMessage = (topic, bytes) => {
    const accept = inboxes.get(topic);
    if (!accept || bytes.length < 4) return;
    const n = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
    accept(n, bytes.subarray(4));
  };
  const links = RELAY_BROKERS.map((url) => new MqttLink(url, onMessage));
  const opened = await Promise.all(links.map((l) => l.open().then((ok) => (ok ? l : (l.close(), null)))));
  const live = opened.filter(Boolean);
  if (inbox) for (const l of live) l.subscribe(inbox);
  // v0.23: subscribe to one more topic on every broker of this channel
  live.listen = (topic, handler) => {
    listen(topic, handler);
    for (const l of live) if (!l.subs.includes(topic)) l.subscribe(topic);
  };
  return live;
}
/**
 * v0.14: presence. Every open game says anonymously over the relay brokers what it is doing
 * ("queue" = searching a Quick Match, "pve" = playing vs AI); a heartbeat every 10 s keeps the
 * entry alive for 25 s. `watch(cb)` reports { queue, pve } counts, own entry included.
 */
const PRESENCE_TOPIC = `felito/v${PROTOCOL_VERSION}/presence`;
export function createPresence() {
  const id = Math.random().toString(36).slice(2, 12),
    seen = new Map(),
    watchers = new Set();
  let state = "idle",
    links = null,
    opening = null,
    beat = null,
    tick = null;
  const counts = () => {
    const now = Date.now(),
      c = { queue: 0, pve: 0, pvp: 0 }; // v0.18a: online matches count too ("Players online")
    for (const [k, v] of seen) {
      if (now - v.at > 25000) seen.delete(k);
      else if (v.s in c) c[v.s]++;
    }
    if (state in c && !seen.has(id)) c[state]++;
    return c;
  };
  const notify = () => {
    const c = counts();
    for (const cb of watchers)
      try {
        cb(c);
      } catch {}
  };
  const onMessage = (topic, bytes) => {
    const who = topic.slice(PRESENCE_TOPIC.length + 1);
    if (!who || who.length > 24) return;
    let s = "";
    try {
      s = JSON.parse(textDec.decode(bytes)).s;
    } catch {
      return;
    }
    if (s === "queue" || s === "pve" || s === "pvp") seen.set(who, { s, at: Date.now() });
    else seen.delete(who);
    notify();
  };
  const open = () =>
    (opening ||= (async () => {
      for (const url of RELAY_BROKERS) {
        const link = new MqttLink(url, onMessage);
        if (await link.open()) {
          link.subscribe(PRESENCE_TOPIC + "/+");
          links = [link];
          return links;
        }
        link.close();
      }
      links = [];
      return links;
    })());
  const say = () => {
    for (const l of links || []) l.publish(`${PRESENCE_TOPIC}/${id}`, textEnc.encode(JSON.stringify({ s: state })));
  };
  const set = (next) => {
    if (next === state) return;
    state = next;
    clearInterval(beat);
    beat = null;
    if (state === "idle") {
      say(); // tells the others to drop this entry
      if (!watchers.size) setTimeout(() => {
        if (state === "idle" && !watchers.size) {
          for (const l of links || []) l.close();
          links = null;
          opening = null;
        }
      }, 800);
      return;
    }
    open().then(() => {
      say();
      if (!beat && state !== "idle") beat = setInterval(say, 10000);
    });
  };
  const watch = (cb) => {
    watchers.add(cb);
    open().then(notify);
    tick ||= setInterval(notify, 3000);
    return () => {
      watchers.delete(cb);
      if (!watchers.size) {
        clearInterval(tick);
        tick = null;
      }
    };
  };
  return { set, watch, counts };
}
class RelayLinkSender {
  constructor(links, outbox) {
    this.links = links;
    this.outbox = outbox;
    this.n = 0;
    this.queue = Promise.resolve();
    this.pending = 0;
  }
  /** v0.23: the smallest socket backlog of the live brokers (the fastest one carries the frames). */
  get bufferedAmount() {
    const live = this.links.filter((l) => l.ready);
    return live.length ? Math.min(...live.map((l) => l.bufferedAmount)) : 0;
  }
  send(text, zipped = null) {
    this.pending++;
    this.queue = this.queue
      .then(() => zipped || deflate(textEnc.encode(text)))
      .then((z) => {
        // v0.23: a frame number is only used when a broker takes the frame, so a frame no broker could
        // carry (all reconnecting) never leaves a gap the receiver waits for
        if (!this.links.some((l) => l.ready && l.bufferedAmount <= RELAY_LINK_BUFFER)) return;
        const n = ++this.n,
          out = new Uint8Array(z.length + 4);
        out.set([(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
        out.set(z, 4);
        for (const l of this.links) l.publish(this.outbox, out);
      })
      .catch(() => {})
      .finally(() => this.pending--);
  }
}
/**
 * A PeerJS-DataConnection look-alike over the relay: on("open"|"data"|"close"|"error"), send(),
 * close(), open, bufferSize. Both sides say "hi" until they hear the other side.
 */
class RelayChannel {
  constructor(secret, role, code) {
    this.code = code;
    this.base = `felito/v${PROTOCOL_VERSION}/r/${code}/${secret}`;
    this.role = role;
    this.handlers = {};
    this.open = false;
    this.closed = false;
    this.relay = true;
  }
  on(event, fn) {
    (this.handlers[event] ||= []).push(fn);
  }
  off(event, fn) {
    this.handlers[event] = (this.handlers[event] || []).filter((f) => f !== fn);
  }
  emit(event, ...args) {
    for (const fn of [...(this.handlers[event] || [])]) {
      try {
        fn(...args);
      } catch {}
    }
  }
  get bufferSize() {
    return this.sender?.pending || 0;
  }
  /** v0.23: bytes the broker sockets have not sent yet (WebSocket.bufferedAmount), for backpressure. */
  get bufferedAmount() {
    return this.sender?.bufferedAmount || 0;
  }
  /** v0.23, guest: also listen on the room-wide topic the host broadcasts its states to. */
  joinBroadcast(secret) {
    if (!validSecret(secret) || !this.links?.listen) return false;
    this.links.listen(`felito/v${PROTOCOL_VERSION}/r/${this.code}/${secret}/b`, (text) => {
      if (!this.closed && this.open) this.emit("data", text);
    });
    return true;
  }
  async start() {
    const me = this.role === "host" ? "h" : "g",
      other = me === "h" ? "g" : "h";
    this.links = await openRelayLinks(`${this.base}/${other}`, (text) => {
      if (this.closed) return;
      if (text === "\u0001hi" || text === "\u0001hi!") {
        if (!this.open) {
          this.open = true;
          clearInterval(this.hello);
          this.sender.send("\u0001hi!");
          this.emit("open");
        } else if (text === "\u0001hi") this.sender.send("\u0001hi!");
        return;
      }
      if (text === "\u0001bye") {
        this.closeNow(true);
        return;
      }
      if (this.open) this.emit("data", text);
    });
    if (this.closed) return this.dispose();
    if (!this.links.length) {
      this.emit("error", { type: "relay-unavailable" });
      return;
    }
    // v0.23: a broker that drops us reconnects on its own; only when every broker is gone for good does the channel close
    for (const l of this.links)
      l.onDead = () => {
        if (this.closed || !this.links.every((x) => x.dead)) return;
        this.emit("error", { type: "relay-unavailable" });
        this.closeNow(true);
      };
    this.sender = new RelayLinkSender(this.links, `${this.base}/${me}`);
    this.sender.send("\u0001hi");
    this.hello = setInterval(() => !this.open && this.sender.send("\u0001hi"), 600);
  }
  send(text) {
    if (!this.open || this.closed) throw new Error("relay not open");
    this.sender.send(String(text));
  }
  closeNow(remote) {
    if (this.closed) return;
    if (!remote && this.sender) this.sender.send("\u0001bye");
    this.closed = true;
    this.open = false;
    clearInterval(this.hello);
    setTimeout(() => this.dispose(), remote ? 0 : 300);
    this.emit("close");
  }
  close() {
    this.closeNow(false);
  }
  dispose() {
    for (const l of this.links || []) l.close();
  }
}

export class MultiplayerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MultiplayerError";
    this.code = code;
  }
}

const error = (code, message) => new MultiplayerError(code, message);
const callback = (callbacks, name, ...args) => {
  try {
    callbacks[name]?.(...args);
  } catch (err) {
    console.error("Felito multiplayer callback failed:", err);
  }
};

export function normalizeRoomCode(value) {
  const code = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "");
  if (/^\d{4}$/.test(code)) return code; // v0.19c1: friend rooms use four digits
  if (code.length !== 8 || [...code].some((char) => !ROOM_ALPHABET.includes(char))) {
    throw error("invalid-code", "The room code must have 4 digits.");
  }
  return code;
}

function randomCode(dependencies) {
  // v0.19c1: Play a friend: a four-digit code (Quick Match keeps its internal eight-letter codes)
  if (dependencies.digits) {
    const n = globalThis.crypto?.getRandomValues(new Uint16Array(1))?.[0];
    if (n === undefined) throw error("crypto-unavailable", "This browser can't create a secure room code.");
    return String(n % 10000).padStart(4, "0");
  }
  const bytes = dependencies.randomBytes
    ? dependencies.randomBytes(8)
    : globalThis.crypto?.getRandomValues(new Uint8Array(8));
  if (!bytes || bytes.length !== 8)
    throw error("crypto-unavailable", "This browser can't create a secure room code.");
  return [...bytes].map((byte) => ROOM_ALPHABET[byte & 31]).join("");
}

function loadPeer() {
  if (typeof globalThis.Peer === "function") return Promise.resolve(globalThis.Peer);
  if (peerLoader) return peerLoader;
  peerLoader = new Promise((resolve, reject) => {
    if (!globalThis.document) {
      reject(error("browser-required", "Multiplayer needs a browser with WebRTC."));
      return;
    }
    const script = document.createElement("script");
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (err) {
        script.remove();
        reject(err);
      } else resolve(globalThis.Peer);
    };
    const timer = setTimeout(
      () => finish(error("load-timeout", "The multiplayer module didn't load in time.")),
      12000,
    );
    script.async = true;
    script.src = SCRIPT_URL;
    script.onload = () =>
      finish(
        typeof globalThis.Peer === "function"
          ? null
          : error("load-failed", "The multiplayer module isn't available."),
      );
    script.onerror = () => finish(error("load-failed", "The multiplayer module couldn't be loaded."));
    document.head.append(script);
  }).catch((err) => {
    peerLoader = null;
    throw err;
  });
  return peerLoader;
}

async function peerClass(dependencies, signal) {
  if (signal?.aborted) throw error("aborted", "Connection cancelled.");
  const loading = dependencies.Peer
    ? Promise.resolve(dependencies.Peer)
    : dependencies.loadPeer
      ? dependencies.loadPeer()
      : loadPeer();
  if (!signal) return loading;
  let abort;
  try {
    return await Promise.race([
      loading,
      new Promise((_, reject) => {
        abort = () => reject(error("aborted", "Connection cancelled."));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function jsonPayload(value) {
  const seen = new WeakSet();
  const visit = (item, depth) => {
    if (depth > 32) throw error("invalid-payload", "The game data is nested too deeply.");
    if (item === null || typeof item === "boolean" || typeof item === "string") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object" || !item)
      throw error("invalid-payload", "Only valid JSON game data can be sent.");
    if (seen.has(item)) throw error("invalid-payload", "The game data contains a cycle.");
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    ) {
      throw error("invalid-payload", "The game data must be plain JSON objects.");
    }
    seen.add(item);
    for (const key of Object.keys(item)) visit(item[key], depth + 1);
    seen.delete(item);
  };
  visit(value, 0);
  const serialized = JSON.stringify(value);
  if (encoder.encode(serialized).byteLength > MAX_PAYLOAD_BYTES) {
    throw error("payload-too-large", "The game data is too large for one message.");
  }
  return JSON.parse(serialized);
}

function tokenBucket(now, capacity, perSecond) {
  let tokens = capacity,
    last = now();
  return (cost = 1) => {
    const current = now();
    tokens = Math.min(capacity, tokens + (Math.max(0, current - last) * perSecond) / 1000);
    last = current;
    if (tokens < cost) return false;
    tokens -= cost;
    return true;
  };
}

function peerFailure(err) {
  const messages = {
    "peer-unavailable": "Room not found. Check the code and whether the host is waiting.",
    "unavailable-id": "This room code is taken. Create a new room.",
    "browser-incompatible": "This browser doesn't support the WebRTC data channel needed.",
    network: "The connection server can't be reached. Check your internet connection.",
    "socket-error": "Connecting to the connection server failed.",
    "socket-closed": "The connection server closed the connection.",
    "server-error": "The connection server is unavailable right now.",
    "relay-unavailable": "No direct connection, and the relay servers can't be reached either.",
    webrtc: "The direct data channel couldn't be set up. The network may be blocking WebRTC.",
  };
  return error(
    err?.type || "connection-error",
    messages[err?.type] || "The multiplayer connection failed.",
  );
}

/**
 * v0.19: one data channel between the host and one guest. A room holds up to MAX_GUESTS links
 * (star: every guest talks only to the host, the host owns the simulation). Each link has its own
 * handshake, relay fallback, sequence numbers, rate limits and heartbeat.
 */
class Link {
  constructor(session, id) {
    this.s = session;
    this.id = id;
    this.role = session.role;
    this.code = session.code;
    this.timers = new Set();
    this.listeners = [];
    this.closed = false;
    this.connected = false;
    this.channelOpen = false;
    this.sequence = 0;
    this.receivedSequence = 0;
    const now = session.now;
    this.outbound = tokenBucket(now, 80, 60);
    this.inbound = tokenBucket(now, 120, 90);
    this.outboundBytes = tokenBucket(now, 4 * 1024 * 1024, 2 * 1024 * 1024);
    this.inboundBytes = tokenBucket(now, 4 * 1024 * 1024, 2 * 1024 * 1024);
    this.zip = false; // v0.23: both sides compress data on the direct channel
    this.outChain = Promise.resolve();
    this.inChain = Promise.resolve();
    this.zipPending = 0;
    this.deferred = null; // v0.23, guest: the newest state held back during a burst
    this.pingAt = 0; // v0.23: when the oldest unanswered ping went out
    this.bcast = false; // v0.23, host: this relay guest also hears the room-wide topic
    this.receivedBcast = 0;
  }
  get relay() {
    return !!this.connection?.relay;
  }
  later(fn, ms) {
    const timer = this.s.setTimer(() => {
      this.timers.delete(timer);
      if (!this.closed) fn();
    }, ms);
    this.timers.add(timer);
    return timer;
  }
  cancel(timer) {
    if (timer !== undefined) {
      this.s.clearTimer(timer);
      this.timers.delete(timer);
    }
  }
  disposeListeners() {
    for (const dispose of this.listeners.splice(0)) dispose();
  }
  attach(connection) {
    if (this.closed) {
      try {
        connection.close();
      } catch {}
      return;
    }
    this.connection = connection;
    // v0.13a: no direct channel after a few seconds: switch both sides to the MQTT relay
    let relayNow = null;
    if (!connection.relay) {
      const secret = this.role === "guest" ? this.s.relaySecret : connection.metadata?.relay;
      if (validSecret(secret) && this.s.dependencies.relay !== false) {
        relayNow = () => {
          if (this.closed || this.connection !== connection || this.channelOpen) return false;
          this.cancel(this.relayTimer);
          this.useRelay(connection, secret);
          return true;
        };
        this.relayTimer = this.later(relayNow, RELAY_AFTER_MS);
      }
    }
    this.phase = this.role === "host" ? "hello" : "welcome";
    this.s.listen(connection, "data", (data) => this.receive(data), this.listeners);
    this.s.listen(connection, "error", (err) => relayNow?.() || this.failure(peerFailure(err)), this.listeners);
    this.s.listen(
      connection,
      "close",
      () => {
        if (this.closed || relayNow?.()) return;
        // v0.23: closed during the handshake: most likely an older game version on the other side
        if (this.channelOpen && !this.connected) return this.failure(error("handshake-closed", "The other side closed the connection. It may run a different game version."));
        this.failure(error("opponent-left", this.role === "guest" ? "Your opponent left the room." : "A player left the room."));
      },
      this.listeners,
    );
    let opened = false;
    const onOpen = () => {
      if (this.closed || opened) return;
      opened = true;
      this.channelOpen = true;
      this.cancel(this.relayTimer);
      this.cancel(this.connectionTimer);
      this.handshakeTimer = this.later(
        () => this.failure(error("handshake-timeout", "The other side didn't finish the handshake.")),
        this.s.handshakeTimeout,
      );
      if (this.role === "guest") this.control("hello", canZip(this.s) ? { zip: true } : {});
      else this.s.status("connecting", "Player found. Checking the game version …");
    };
    this.s.listen(connection, "open", onOpen, this.listeners);
    this.connectionTimer = this.later(
      () =>
        this.failure(
          error("connection-timeout", "The direct data channel isn't answering. A firewall or mobile network may be blocking it."),
        ),
      this.s.timeout,
    );
    if (connection.open) onOpen();
  }
  useRelay(connection, secret) {
    this.disposeListeners();
    this.cancel(this.connectionTimer);
    try {
      connection.close();
    } catch {}
    this.s.status("connecting", "No direct connection. Switching to the relay server …");
    const relay = new RelayChannel(secret, this.role, this.code);
    this.attach(relay);
    relay.start();
  }
  failure(err) {
    if (this.closed) return;
    this.s.linkFailed(this, err);
  }
  control(type, extra = {}) {
    if (this.closed || !this.connection?.open) return false;
    try {
      this.connection.send(JSON.stringify({ protocol: PROTOCOL, version: PROTOCOL_VERSION, room: this.code, type, ...extra }));
      return true;
    } catch (err) {
      this.failure(peerFailure(err));
      return false;
    }
  }
  receive(raw) {
    if (this.closed) return;
    // v0.23: compressed data frames on the direct channel (see zipFrame)
    if (raw instanceof Blob) {
      raw.arrayBuffer().then((b) => this.receive(b), () => {});
      return;
    }
    let frame = null;
    if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
      frame = this.zip ? unzipHeader(raw) : null;
      if (!frame) {
        this.failure(error("invalid-traffic", "The data channel received invalid or too many messages."));
        return;
      }
    } else if (typeof raw !== "string") {
      this.failure(error("invalid-traffic", "The data channel received invalid or too many messages."));
      return;
    }
    const size = frame ? frame.bytes.byteLength : raw.length;
    if (size > MAX_WIRE_BYTES) {
      this.failure(error("invalid-traffic", "The data channel received invalid or too many messages."));
      return;
    }
    if (!this.inbound() || !this.inboundBytes(size)) {
      // v0.23: a guest that wakes up (phone back from the background, WiFi -> LTE) gets the host's backlog at
      // once. That burst no longer kills the link: excess messages are dropped and the newest state is kept
      // and shown a moment later.
      // (After a duel takeover the host receives states too, so this holds for both sides; only a flood
      // that goes on for seconds still ends the link.)
      const now = this.s.now();
      if (now - (this.floodAt || 0) > 10000) {
        this.floodAt = now;
        this.flood = 0;
      }
      if (++this.flood > 1500) {
        this.failure(error("traffic-limit", "The data channel exceeded its data limit."));
        return;
      }
      netCount("burst"); // v0.23o
      return this.holdBack(raw, frame);
    }
    if (frame) this.unzip(frame);
    else this.handle(raw);
  }
  /** v0.23: a compressed state that a newer queued state replaces is skipped (no inflate after a burst). */
  supersede(frame) {
    if (frame.kind !== "state") return false;
    if (frame.seq > (this.newestState || 0)) this.newestState = frame.seq;
    return true;
  }
  /** v0.23, guest: keeps only the newest held-back state (or snapshot) of a burst; the rest is dropped. */
  holdBack(raw, frame) {
    const kind = frame ? frame.kind : wireKind(raw);
    // guest: rare host messages (results, takeover, rejoin token, lobby) are handled right away; only states
    // are merged. Host: a guest's surplus commands are dropped (the rate limit stays a limit)
    if (kind !== "state" && kind !== "snap") return this.role === "guest" ? (frame ? this.unzip(frame, true) : this.handle(raw, true)) : undefined;
    this.deferred ||= {};
    if (this.deferred[kind]) netCount("burstDropped"); // v0.23o: an older held-back state is replaced
    this.deferred[kind] = { raw, frame };
    if (this.deferredTimer === undefined)
      this.deferredTimer = this.later(() => {
        this.deferredTimer = undefined;
        const held = this.deferred || {};
        this.deferred = null;
        for (const k of ["snap", "state"]) {
          const d = held[k];
          if (!d) continue;
          if (d.frame) this.unzip(d.frame, true);
          else this.handle(d.raw, true);
        }
      }, 150);
  }
  unzip(frame, stale = false) {
    const isState = this.supersede(frame);
    this.inChain = this.inChain
      .then(() => (isState && frame.seq < this.newestState ? "skip" : inflateCapped(frame.bytes.subarray(frame.offset), MAX_WIRE_BYTES)))
      .then((b) => {
        if (b === "skip") netCount("skipped"); // v0.23o: a newer state was already queued
        if (this.closed || b === "skip") return;
        if (!b) throw new Error("too large");
        const body = textDec.decode(b);
        this.handle(frame.head.slice(0, -1) + ',"payload":' + body + "}", stale);
      })
      .catch(() => this.failure(error("invalid-payload", "Only valid JSON game data can be sent.")));
  }
  /** One wire message (a JSON string). `stale`: a held-back message that may already be outdated. */
  handle(raw, stale = false) {
    if (this.closed) return;
    let packet;
    try {
      packet = JSON.parse(raw);
    } catch {
      this.failure(error("invalid-json", "The other side sent invalid game data."));
      return;
    }
    if (
      !packet ||
      typeof packet !== "object" ||
      Array.isArray(packet) ||
      packet.protocol !== PROTOCOL ||
      packet.version !== PROTOCOL_VERSION ||
      packet.room !== this.code
    ) {
      // v0.23: say so before closing, so an older client shows "versions don't match" instead of waiting
      if (!this.connected) this.control("reject", { reason: "version" });
      this.failure(error("protocol-mismatch", "The game versions or room codes don't match."));
      return;
    }
    this.lastReceived = this.s.now();
    this.pingAt = 0; // v0.23: the other side is alive
    if (packet.type === "reject") {
      // v0.23: only a guest is ever rejected (a host ignores such a packet)
      if (this.role !== "guest") return;
      this.s.fail(
        packet.reason === "match-started"
          ? error("match-started", "This match has already started.")
          : packet.reason === "rejoin-failed"
            ? error("rejoin-failed", "Your seat in this match is no longer available.")
            : packet.reason === "version"
              ? error("protocol-mismatch", "The game versions or room codes don't match.")
              : error("room-full", `The room is full (${MAX_GUESTS + 1} players).`),
      );
      return;
    }
    if (!this.connected) {
      if (this.role === "host" && this.phase === "hello" && packet.type === "hello") {
        this.phase = "confirm";
        this.zip = packet.zip === true && canZip(this.s); // v0.23
        this.control("welcome", this.zip ? { zip: true } : {});
        return;
      }
      if (this.role === "guest" && this.phase === "welcome" && packet.type === "welcome") {
        this.phase = "ready";
        this.zip = packet.zip === true && canZip(this.s); // v0.23
        this.control("confirm");
        return;
      }
      if (this.role === "host" && this.phase === "confirm" && packet.type === "confirm") {
        if (this.control("ready")) this.connectedNow();
        return;
      }
      if (this.role === "guest" && this.phase === "ready" && packet.type === "ready") {
        this.connectedNow();
        return;
      }
      this.failure(error("invalid-handshake", "The handshake failed."));
      return;
    }
    if (packet.type === "ping") {
      this.control("pong");
      return;
    }
    if (packet.type === "pong") return;
    // v0.23: the other side closed the room on purpose (no rejoin wait for a player who left)
    if (packet.type === "bye") {
      this.failure(error("left", this.role === "guest" ? "The host left the match." : "A player left the room."));
      return;
    }
    // v0.23: the host tells a relay guest the room-wide topic; the guest says when it listens there
    if (packet.type === "bcast-topic" && this.role === "guest") {
      if (this.connection?.joinBroadcast?.(packet.secret)) this.control("bcast-ok");
      return;
    }
    if (packet.type === "bcast-ok" && this.role === "host") {
      this.bcast = this.relay;
      return;
    }
    // v0.23: messages on the room-wide relay topic count their own sequence
    const bcast = packet.type === "bcast" && this.role === "guest",
      last = bcast ? this.receivedBcast : this.receivedSequence;
    if (!Number.isSafeInteger(packet.sequence) || packet.sequence <= last || (packet.type !== "data" && !bcast)) {
      if (stale || bcast) return; // a held-back state that a newer one overtook; a broadcast heard twice
      this.failure(error("invalid-message", "The data channel received an invalid message sequence."));
      return;
    }
    const payload = packet.payload;
    if (!payload || typeof payload !== "object") {
      this.failure(error("invalid-payload", "Only valid JSON game data can be sent."));
      return;
    }
    if (bcast) this.receivedBcast = packet.sequence;
    else this.receivedSequence = packet.sequence;
    callback(this.s.callbacks, "onData", payload, this.s.room, this.id);
  }
  /** v0.23: a ping now (at most one unanswered at a time) for a quick "is the other side alive" check. */
  ping() {
    if (!this.connected) return;
    if (this.pingAt && this.s.now() - this.pingAt < 3000) return;
    if (this.control("ping")) this.pingAt ||= this.s.now();
  }
  /** v0.23: a ping went unanswered for 2 s (the other side's page is not running). */
  pingMissed() {
    return !!this.pingAt && this.s.now() - this.pingAt > 2000;
  }
  connectedNow() {
    if (this.closed || this.connected) return;
    this.connected = true;
    this.phase = "connected";
    this.cancel(this.handshakeTimer);
    this.cancel(this.connectionTimer);
    this.lastReceived = this.s.now();
    let beatAt = this.s.now();
    const heartbeat = () => {
      // v0.23: a heartbeat that fires far too late means OUR page was frozen (phone in the background).
      // The other side's messages are only now arriving, so its silence doesn't count: wait for them.
      // (one grace per idle timeout, so a hidden tab whose timers are throttled still notices a dead link)
      const now = this.s.now(),
        late = now - beatAt > 2.5 * this.s.heartbeatInterval;
      beatAt = now;
      if (late && now - (this.graceAt || -Infinity) > this.s.idleTimeout) {
        this.graceAt = now;
        this.lastReceived = Math.max(this.lastReceived, now - this.s.heartbeatInterval);
        // back from a freeze: if the other side doesn't answer a ping within 4 s, the link is gone
        // (the host dropped us meanwhile); the guest then rejoins at once instead of after 30 s
        this.pingAt = 0;
        if (this.control("ping")) this.pingAt = now;
        this.later(() => {
          if (this.pingAt && this.s.now() - this.pingAt >= 4000) this.failure(error("opponent-timeout", this.role === "guest" ? "The host stopped responding." : "A player stopped responding."));
        }, 4000);
      }
      if (now - this.lastReceived > this.s.idleTimeout) {
        this.failure(
          error(
            "opponent-timeout",
            this.role === "guest" ? "The host stopped responding. The match has ended." : "A player stopped responding.",
          ),
        );
        return;
      }
      if (this.control("ping")) this.pingAt ||= now;
      if (!this.closed) this.later(heartbeat, this.s.heartbeatInterval);
    };
    this.later(heartbeat, this.s.heartbeatInterval);
    this.s.linkConnected(this);
  }
  /** Sends one already serialized JSON object (the payload). v0.23: `zipped` = a shared deflate of it. */
  sendBody(body, zipped = null) {
    if (this.closed || !this.connected || !this.connection?.open) return false;
    try {
      const head = JSON.stringify({ protocol: PROTOCOL, version: PROTOCOL_VERSION, room: this.code, type: "data", sequence: this.sequence + 1 }),
        zip = this.zip && !this.relay; // the relay deflates on its own
      // v0.23: the relay reports its broker sockets' unsent bytes too
      const buffered = this.connection.dataChannel?.bufferedAmount ?? this.connection.bufferedAmount ?? 0;
      if ((this.connection.bufferSize || 0) > 16 || buffered > 1024 * 1024 || this.zipPending > 8) {
        netCount("backpressure"); // v0.23o
        throw error("backpressure", "The connection is busy. The next update will try again.");
      }
      if (zip) {
        if (!this.outbound() || !this.outboundBytes(Math.ceil(body.length / 6))) { netCount("sendLimit"); throw error("send-limit", "Too many game messages. Please wait for the next update."); }
        const z = zipped || deflate(textEnc.encode(body)),
          kind = wireKind(body, 0),
          connection = this.connection;
        this.sequence++;
        this.zipPending++;
        this.outChain = this.outChain
          .then(() => z)
          .then((bytes) => {
            if (!this.closed && this.connection === connection && connection.open) connection.send(zipFrame(head, kind, bytes));
          })
          .catch((err) => this.failure(peerFailure(err)))
          .finally(() => this.zipPending--);
        return true;
      }
      const wire = head.slice(0, -1) + ',"payload":' + body + "}";
      if (!this.outbound() || !this.outboundBytes(wire.length)) {
        { netCount("sendLimit"); throw error("send-limit", "Too many game messages. Please wait for the next update."); }
      }
      this.connection.send(wire);
      this.sequence++;
      return true;
    } catch (err) {
      if (err instanceof MultiplayerError) this.s.status("warning", err.message, err);
      else this.failure(peerFailure(err));
      return false;
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    for (const timer of this.timers) this.s.clearTimer(timer);
    this.timers.clear();
    this.disposeListeners();
    try {
      this.connection?.close();
    } catch {}
  }
}

/** v0.23: compression on the direct channel needs both stream APIs (and can be switched off for tests). */
// v0.23o: Options › Online › Compression sets globalThis.felitoNetZip; off on either side = no compression on that link
const canZip = (session) => session.dependencies.zip !== false && globalThis.felitoNetZip !== false && !!globalThis.CompressionStream && !!globalThis.DecompressionStream;
/** v0.23o: counters for the net stats overlay (Options › Online › Net stats). */
const netCount = (key) => {
  const st = (globalThis.felitoNetStats ||= {});
  st[key] = (st[key] || 0) + 1;
};
/** v0.23: the message kind of a serialized payload or wire string, without parsing it. */
function wireKind(text, from = null) {
  const i = from ?? text.indexOf(',"payload":');
  if (i < 0) return "";
  const m = /^(?:,"payload":)?\{"kind":"([a-z-]{1,24})"/.exec(text.slice(i, i + 48));
  return m ? m[1] : "";
}
/**
 * v0.23: a compressed frame on the direct channel: 0x5a, the header length (2 bytes), the header JSON
 * (protocol, version, room, type, sequence) and the deflated payload. The header names the kind ("k")
 * so a guest can drop surplus states without inflating them.
 */
function zipFrame(head, kind, zipped) {
  const h = textEnc.encode(kind ? head.slice(0, -1) + ',"k":' + JSON.stringify(kind) + "}" : head),
    out = new Uint8Array(3 + h.length + zipped.length);
  out[0] = 0x5a;
  out[1] = h.length >> 8;
  out[2] = h.length & 255;
  out.set(h, 3);
  out.set(zipped, 3 + h.length);
  return out;
}
function unzipHeader(raw) {
  const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  if (bytes.length < 4 || bytes[0] !== 0x5a) return null;
  const n = (bytes[1] << 8) | bytes[2];
  if (n > 512 || bytes.length < 3 + n) return null;
  let head, kind, seq;
  try {
    const text = textDec.decode(bytes.subarray(3, 3 + n)),
      obj = JSON.parse(text);
    if (!obj || typeof obj !== "object") return null;
    kind = typeof obj.k === "string" ? obj.k : "";
    delete obj.k;
    head = JSON.stringify(obj);
    seq = Number.isSafeInteger(obj.sequence) ? obj.sequence : 0;
  } catch {
    return null;
  }
  return { bytes, offset: 3 + n, head, kind, seq };
}
/** Serializes a payload once (v0.13b: one pass) and checks it. v0.23: a string is an already serialized payload. */
function payloadBody(data) {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  if (!body || body[0] !== "{") throw error("invalid-payload", "Only valid JSON game data can be sent.");
  if (body.length > MAX_PAYLOAD_BYTES) throw error("payload-too-large", "The game data is too large for one message.");
  return body;
}

class Session {
  constructor(role, code, callbacks, dependencies) {
    this.role = role;
    this.code = code;
    this.callbacks = callbacks;
    this.dependencies = dependencies;
    this.now = dependencies.now || (() => Date.now());
    this.setTimer = dependencies.setTimeout || globalThis.setTimeout.bind(globalThis);
    this.clearTimer = dependencies.clearTimeout || globalThis.clearTimeout.bind(globalThis);
    this.timeout = dependencies.timeoutMs || 20000;
    this.handshakeTimeout = dependencies.handshakeTimeoutMs || 8000;
    this.heartbeatInterval = dependencies.heartbeatIntervalMs || 5000;
    this.idleTimeout = dependencies.idleTimeoutMs || 30000;
    // v0.19: a host takes up to maxGuests guests (default 5 = six players)
    this.maxGuests = Math.max(1, Math.min(MAX_GUESTS, Math.round(Number(dependencies.maxGuests)) || MAX_GUESTS));
    this.timers = new Set();
    this.peerListeners = [];
    this.links = new Map();
    this.nextLinkId = 1;
    this.locked = false;
    this.closed = false;
    this.relaySecret = role === "guest" ? randomSecret(dependencies) : null;
    // v0.23, host: the room-wide relay topic (one publish per state for every relay guest)
    this.roomSecret = role === "host" ? randomSecret(dependencies) : null;
    this.bcastSender = null;
    this.bcastSequence = 0;
    // v0.23, guest: a rejoin token that reclaims our seat in a running (locked) match
    this.rejoin = role === "guest" && validSecret(dependencies.rejoin) ? dependencies.rejoin : null;
    const connectedLinks = () => [...this.links.values()].filter((l) => l.connected);
    this.room = Object.freeze({
      code,
      role,
      maxPlayers: role === "host" ? this.maxGuests + 1 : null,
      isRelay: () => connectedLinks().some((l) => l.relay),
      /** Connected peers: guest ids on the host (1, 2, …), [0] (the host) on a guest. */
      peers: () => connectedLinks().map((l) => l.id),
      /** Host: to every connected guest; guest: to the host. True if at least one link took it. */
      send: (data) => this.broadcast(data),
      sendTo: (id, data) => this.sendTo(id, data),
      /** Host: no new guests (the match started) or open again. */
      lock: (value = true) => {
        this.locked = !!value;
      },
      kick: (id) => this.dropLink(this.links.get(id), error("kicked", "Removed from the room.")),
      close: () => this.finish("closed", "Room closed."),
      /** v0.23: ping the other side now (guest: the host) / did that ping go unanswered for 2 s? */
      ping: () => connectedLinks().forEach((l) => l.ping()),
      pingMissed: () => connectedLinks().some((l) => l.pingMissed()),
      /** v0.23, host: the rejoin token a guest link came with (null for a new player). */
      rejoinOf: (id) => this.links.get(id)?.rejoin || null,
    });
  }

  status(state, message, err) {
    callback(this.callbacks, "onStatus", {
      state,
      message,
      code: this.code,
      role: this.role,
      ...(err ? { error: err } : {}),
    });
  }

  later(fn, ms) {
    const timer = this.setTimer(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
    return timer;
  }

  cancel(timer) {
    if (timer !== undefined) {
      this.clearTimer(timer);
      this.timers.delete(timer);
    }
  }

  listen(emitter, event, listener, list) {
    emitter.on(event, listener);
    list.push(() => {
      if (emitter.off) emitter.off(event, listener);
      else emitter.removeListener?.(event, listener);
    });
  }

  anyConnected() {
    for (const l of this.links.values()) if (l.connected) return true;
    return false;
  }

  async start(PeerClass) {
    this.status("connecting", "Connecting to the room service …");
    const options = await peerOptions(this.dependencies);
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      if (this.callbacks.signal?.aborted) {
        this.fail(error("aborted", "Connection cancelled."));
        return;
      }
      this.abort = () => this.fail(error("aborted", "Connection cancelled."));
      this.callbacks.signal?.addEventListener("abort", this.abort, { once: true });
      this.startTimer = this.later(
        () => this.fail(error("signaling-timeout", "The room service isn't answering. Please try again.")),
        this.timeout,
      );
      try {
        this.peer = this.role === "host" ? new PeerClass("felito-v1-" + this.code, options) : new PeerClass(options);
        this.listen(this.peer, "open", () => this.open(), this.peerListeners);
        this.listen(
          this.peer,
          "connection",
          (connection) => {
            if (this.closed || this.role !== "host") return this.rejectExtra(connection, "room-full");
            // v0.23: a guest with a valid rejoin token reclaims its seat in a running match
            const rejoin = connection.metadata?.rejoin;
            if (this.locked && validSecret(rejoin)) {
              if (!this.callbacks.canRejoin?.(rejoin) || this.links.size >= 2 * MAX_GUESTS) return this.rejectExtra(connection, "rejoin-failed");
              this.addLink(connection).rejoin = rejoin;
              return;
            }
            if (this.locked) return this.rejectExtra(connection, "match-started");
            if (this.links.size >= this.maxGuests) return this.rejectExtra(connection, "room-full");
            this.addLink(connection);
          },
          this.peerListeners,
        );
        this.listen(
          this.peer,
          "error",
          (err) => {
            if (this.anyConnected() && ["network", "socket-error", "socket-closed", "server-error", "disconnected"].includes(err?.type)) {
              this.status("warning", "Room service disconnected; the running match stays directly connected.", peerFailure(err));
            } else if (this.role === "host" && this.opened && err?.type === "peer-unavailable") {
              // not ours to handle on the host
            } else if (this.role === "guest" && this.opened && err?.type === "peer-unavailable" && !this.anyConnected() && (this.unavailableTries || 0) < (this.dependencies.retryUnavailable || 0)) {
              // v0.19b1: Quick Match guest: the host registers its room a moment later; ask again shortly
              this.unavailableTries = (this.unavailableTries || 0) + 1;
              for (const link of this.links.values()) link.close();
              this.links.clear();
              this.status("connecting", "Waiting for the host's room …");
              this.later(() => this.connectToHost(), 1500);
            } else this.fail(peerFailure(err));
          },
          this.peerListeners,
        );
        this.listen(this.peer, "close", () => this.finish("disconnected", "The room was closed."), this.peerListeners);
        this.listen(
          this.peer,
          "disconnected",
          () => {
            if (this.anyConnected()) {
              this.status("warning", "Room service disconnected; the running match stays directly connected.");
              // v0.23: a host stays registered, so a guest whose connection dropped can rejoin
              if (this.role === "host")
                this.later(() => {
                  try {
                    if (!this.closed && this.peer?.disconnected) this.peer.reconnect?.();
                  } catch {}
                }, 1000);
            } else if (this.role === "host" && this.opened) {
              // v0.19: a waiting room tries to stay registered
              try {
                this.peer.reconnect?.();
              } catch {}
              this.status("warning", "The room service connection was interrupted. Reconnecting …");
            } else this.fail(error("signaling-disconnected", "The connection to the room service was interrupted."));
          },
          this.peerListeners,
        );
        this.listen(this.peer, "call", (call) => call.close(), this.peerListeners);
      } catch (err) {
        this.fail(err instanceof MultiplayerError ? err : peerFailure(err));
      }
    });
  }

  open() {
    if (this.closed || this.opened) return;
    this.opened = true;
    this.cancel(this.startTimer);
    if (this.role === "host") this.status("ready", `Room ready (up to ${this.maxGuests + 1} players).`); // v0.19c1: no code talk (Quick Match has none)
    else if (!this.connectToHost()) return;
    this.resolve?.(this.room);
    this.resolve = this.reject = null;
  }

  /** Guest: opens the data channel to the host's room (again after a retry). */
  connectToHost() {
    if (this.closed) return false;
    this.status("connecting", "Connecting to the host …");
    try {
      const connection = this.peer.connect("felito-v1-" + this.code, {
        label: PROTOCOL,
        metadata: { protocol: PROTOCOL, version: PROTOCOL_VERSION, room: this.code, relay: this.relaySecret, ...(this.rejoin ? { rejoin: this.rejoin } : {}) }, // v0.23: rejoin
        serialization: "binary",
        reliable: true,
      });
      this.addLink(connection, 0);
    } catch (err) {
      this.fail(peerFailure(err));
      return false;
    }
    return true;
  }

  addLink(connection, id = this.nextLinkId++) {
    const link = new Link(this, id);
    this.links.set(id, link);
    link.attach(connection);
    return link;
  }

  rejectExtra(connection, reason = "room-full") {
    const close = () => {
      try {
        connection.close();
      } catch {}
    };
    if (this.closed) return close();
    const reject = () => {
      try {
        connection.send(JSON.stringify({ protocol: PROTOCOL, version: PROTOCOL_VERSION, room: this.code, type: "reject", reason }));
      } catch {}
      this.later(close, 100);
    };
    connection.on("error", close);
    if (connection.open) reject();
    else {
      connection.on("open", reject);
      this.later(close, 1500);
    }
  }

  linkConnected(link) {
    // v0.23, host: a relay guest also listens on the room-wide topic (it answers "bcast-ok")
    if (this.role === "host" && link.relay) link.control("bcast-topic", { secret: this.roomSecret });
    if (this.role === "guest") {
      this.status("connected", link.relay ? "Connected through the relay server. The match can start." : "Directly connected. The match can start.");
    } else {
      const n = this.room.peers().length;
      this.status("connected", `${n + 1}/${this.maxGuests + 1} players in the room.`);
    }
    callback(this.callbacks, "onConnect", this.room, link.id, link.rejoin ? { rejoin: link.rejoin } : null);
  }

  dropLink(link, err) {
    if (!link || link.closed) return;
    const wasConnected = link.connected;
    link.close();
    this.links.delete(link.id);
    if (!wasConnected) return;
    callback(this.callbacks, "onPeerLeave", { id: link.id, reason: err?.code || "left", message: err?.message || "A player left the room." });
  }

  linkFailed(link, err) {
    if (this.closed) return;
    if (this.role === "guest") return this.fail(err);
    // v0.19, host: a lost guest never closes the room; a failed candidate leaves it waiting
    const wasConnected = link.connected;
    this.dropLink(link, err);
    if (!wasConnected) {
      this.status("warning", err.message, err);
      if (!this.anyConnected() && !this.locked) this.status("ready", "Room still ready. Players can join.");
    }
  }

  broadcast(data) {
    if (this.closed) return false;
    let body;
    try {
      body = payloadBody(data);
    } catch (err) {
      this.status("warning", err.message, err);
      return false;
    }
    let ok = false;
    const links = [...this.links.values()].filter((l) => l.connected);
    // v0.23: one deflate for every compressed direct link
    const zipped = links.filter((l) => l.zip && !l.relay).length > 1 ? deflate(textEnc.encode(body)) : null;
    zipped?.catch(() => {});
    // v0.23: relay guests on the room-wide topic get one publish together instead of one per guest × broker
    const bcast = this.role === "host" ? links.filter((l) => l.bcast && l.relay && l.connection?.open) : [];
    if (bcast.length && this.sendBroadcast(body, bcast)) ok = true;
    else bcast.length = 0;
    for (const link of links) if (!bcast.includes(link) && link.sendBody(body, link.zip && !link.relay ? zipped : null)) ok = true;
    return ok;
  }
  /** v0.23, host: one message to the room-wide relay topic (on the brokers of one relay guest's channel). */
  sendBroadcast(body, links) {
    // one ready broker socket per broker address, taken from the relay guests' channels: every broker a
    // relay guest shares with the host gets the message once
    const byUrl = new Map();
    for (const l of links) for (const m of l.connection?.links || []) if (m.ready && !byUrl.has(m.url)) byUrl.set(m.url, m);
    if (!byUrl.size) return false;
    const sender = (this.bcastSender ||= new RelayLinkSender([], `felito/v${PROTOCOL_VERSION}/r/${this.code}/${this.roomSecret}/b`));
    sender.links = [...byUrl.values()]; // the frame counter stays with the sender when the brokers change
    if (sender.pending > 16 || sender.bufferedAmount > 1024 * 1024) {
      this.status("warning", "The connection is busy. The next update will try again.");
      return true; // skipped like a busy link; the next state follows
    }
    const wire = JSON.stringify({ protocol: PROTOCOL, version: PROTOCOL_VERSION, room: this.code, type: "bcast", sequence: ++this.bcastSequence }).slice(0, -1) + ',"payload":' + body + "}";
    sender.send(wire);
    return true;
  }

  sendTo(id, data) {
    const link = this.links.get(id);
    if (this.closed || !link?.connected) return false;
    try {
      return link.sendBody(payloadBody(data));
    } catch (err) {
      this.status("warning", err.message, err);
      return false;
    }
  }

  fail(err) {
    this.finish("error", err.message, err);
  }

  finish(state, message, err) {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.timers) this.clearTimer(timer);
    this.timers.clear();
    // v0.23: closing on purpose says "bye" first, so the others know this player left (and isn't just
    // reconnecting); those channels close a moment later so the message gets out
    const byes = state === "closed" ? [...this.links.values()].filter((l) => l.connected && l.control("bye")) : [];
    for (const link of this.links.values()) {
      if (!byes.includes(link)) {
        link.close();
        continue;
      }
      for (const timer of link.timers) this.clearTimer(timer);
      link.timers.clear();
      link.disposeListeners();
      link.closed = true; // no more callbacks from it
    }
    this.links.clear();
    for (const dispose of this.peerListeners.splice(0)) dispose();
    this.callbacks.signal?.removeEventListener("abort", this.abort);
    const peer = this.peer,
      teardown = () => {
        for (const link of byes) {
          try {
            link.connection?.close();
          } catch {}
        }
        try {
          peer?.destroy();
        } catch {}
      };
    if (byes.length) this.setTimer(teardown, 200);
    else teardown();
    this.status(state, message, err);
    this.reject?.(err || error("closed", message));
    this.resolve = this.reject = null;
    callback(this.callbacks, "onDisconnect", {
      reason: err?.code || state,
      message,
      code: this.code,
      role: this.role,
      ...(err ? { error: err } : {}),
    });
  }
}

async function startRoom(role, code, callbacks, dependencies) {
  let PeerClass;
  try {
    PeerClass = await peerClass(dependencies, callbacks.signal);
  } catch (err) {
    const failure = err instanceof MultiplayerError ? err : peerFailure(err);
    callback(callbacks, "onStatus", { state: "error", message: failure.message, code, role, error: failure });
    throw failure;
  }
  return new Session(role, code, callbacks, dependencies).start(PeerClass);
}

/**
 * Resolves after signaling registration. Wait for onConnect before sending.
 * v0.19 callbacks: onConnect(room, peerId) for every guest that joins (host) or once (guest),
 * onData(payload, room, peerId), onPeerLeave({ id, reason, message }) when a guest drops (host),
 * onDisconnect(info) when the whole room ends. dependencies.maxGuests limits the room (1–5).
 */
export async function createRoom(callbacks = {}, dependencies = {}, presetCode) {
  const code = presetCode ? normalizeRoomCode(presetCode) : randomCode(dependencies);
  return startRoom("host", code, callbacks, dependencies);
}

/** Resolves when signaling is ready and the connection attempt has started. */
export async function joinRoom(code, callbacks = {}, dependencies = {}) {
  return startRoom("guest", normalizeRoomCode(code), callbacks, dependencies);
}

/**
 * Quick Match (v0.10i): matchmaking without an own server. Lobby slots are fixed PeerJS ids.
 * Whoever registers a free slot waits there; the next searcher finds the id taken, connects and
 * receives a fresh room code. Both then use the normal room flow (host = waiter). A slot is
 * released as soon as a pair is made, so stale or busy slots only cost a few seconds.
 * v0.19: the waiter keeps its slot open and hands the same code to up to five searchers.
 * Resolves { role: "host" | "guest", code, slot? } (slot: host only; close() it when the room
 * starts or is full).
 */
export const QUICK_SLOTS = 6;
const lobbyId = (slot, ranked = false) => `felito-${ranked ? "rk" : "qm"}-p${PROTOCOL_VERSION}-${slot}`; // v0.23b: Ranked has its own slots
/** v0.23b: `ranked`: Ranked Match – same matchmaking as Quick Match, own queue, always 1v1 (one guest per slot). */
export async function findQuickMatch({ signal, onStatus, ranked = false } = {}, dependencies = {}) {
  const maxGuests = ranked ? 1 : MAX_GUESTS;
  const PeerClass = await peerClass(dependencies, signal);
  const options = await peerOptions(dependencies);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = () => {
    if (signal?.aborted) throw error("aborted", "Search cancelled.");
  };
  const tell = (message) => callback({ onStatus }, "onStatus", { state: "searching", message });
  // Opens a peer; resolves "open" or the PeerJS error type.
  const openPeer = (id) =>
    new Promise((resolve) => {
      const peer = id ? new PeerClass(id, options) : new PeerClass(options);
      const timer = setTimeout(() => done("timeout"), 10000);
      const done = (result) => {
        clearTimeout(timer);
        resolve({ peer, result });
      };
      peer.on("open", () => done("open"));
      peer.on("error", (e) => done(e?.type || "error"));
    });
  // v0.13a: the lobby talks over the relay brokers (topic from a secret in the connection
  // metadata, which travels through PeerJS signalling) and over the data channel if one opens.
  const lobbyTalk = async (secret, me, onMsg) => {
    const base = `felito/v${PROTOCOL_VERSION}/qm/${secret}`,
      other = me === "h" ? "g" : "h";
    let links = [];
    try {
      links = await openRelayLinks(`${base}/${other}`, (text) => {
        try {
          onMsg(JSON.parse(text));
        } catch {}
      });
    } catch {}
    const sender = links.length ? new RelayLinkSender(links, `${base}/${me}`) : null;
    return {
      send: (msg) => sender?.send(JSON.stringify(msg)),
      close: () => setTimeout(() => links.forEach((l) => l.close()), 600),
    };
  };
  // Waits on a claimed slot. v0.19: the slot hands one room code to up to MAX_GUESTS searchers, so
  // a Quick Match room fills up to six players. It resolves with the first taker and stays open
  // (`slot`) until the app closes it (match starts, room full) or 60 s have passed.
  const hostSlot = (peer) =>
    new Promise((resolve, reject) => {
      const code = randomCode(dependencies),
        offer = { protocol: PROTOCOL, kind: "qm-match", code },
        offers = new Map();
      let acks = 0,
        settled = false,
        closed = false,
        life = null;
      const stop = () => {
        try {
          peer.destroy();
        } catch {}
      };
      const slot = {
        code,
        get joined() {
          return acks;
        },
        close() {
          if (closed) return;
          closed = true;
          clearTimeout(rescan);
          clearTimeout(life);
          for (const o of offers.values()) o.end();
          offers.clear();
          stop();
        },
      };
      const settle = (value, err) => {
        if (settled) return;
        settled = true;
        clearTimeout(rescan);
        signal?.removeEventListener("abort", abort);
        if (err) {
          reject(err);
          slot.close();
        } else if (!value) {
          resolve(null);
          slot.close();
        } else resolve(value);
      };
      const abort = () => settle(null, error("aborted", "Search cancelled."));
      signal?.addEventListener("abort", abort, { once: true });
      // Give other free slots a chance: re-scan every 20 s so two waiting players find each other.
      const rescan = setTimeout(() => {
        if (!acks && !offers.size) settle(null);
      }, 20000);
      peer.on("connection", async (conn) => {
        const secret = conn.metadata?.qm;
        if (closed || offers.has(secret) || acks + offers.size >= maxGuests || !validSecret(secret)) {
          setTimeout(() => conn.close(), 300);
          return;
        }
        let talk = null,
          repeat = null,
          done = false;
        const o = {
          end() {
            done = true;
            clearTimeout(giveUp);
            clearInterval(repeat);
            talk?.close();
          },
        };
        offers.set(secret, o);
        const take = (msg) => {
          if (done || closed || msg?.protocol !== PROTOCOL || msg.kind !== "qm-ack" || msg.code !== code) return;
          o.end();
          offers.delete(secret);
          acks++;
          if (!settled) {
            life = setTimeout(() => slot.close(), 60000);
            setTimeout(() => settle({ role: "host", code, slot }), 250);
          }
          if (acks >= maxGuests) setTimeout(() => slot.close(), 600);
        };
        const giveUp = setTimeout(() => {
          if (done) return;
          o.end();
          offers.delete(secret);
          try {
            conn.close();
          } catch {}
        }, 9000);
        conn.on("data", take);
        conn.on("open", () => {
          try {
            conn.send(offer);
          } catch {}
        });
        talk = await lobbyTalk(secret, "h", take);
        if (done) return talk.close();
        talk.send(offer);
        repeat = setInterval(() => talk.send(offer), 700);
      });
      peer.on("error", (e) => {
        if (!acks && ["network", "server-error", "socket-error", "socket-closed"].includes(e?.type)) settle(null);
      });
    });
  // Asks a waiting slot for a match; resolves the room code or null.
  const askSlot = (slot) =>
    new Promise((resolve) => {
      openPeer().then(async ({ peer, result }) => {
        let done = false,
          talk = null;
        const finish = (code) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(code);
          talk?.close();
          setTimeout(
            () => {
              try {
                peer.destroy();
              } catch {}
            },
            code ? 600 : 0,
          );
        };
        const timer = setTimeout(() => finish(null), 11000);
        if (result !== "open") return finish(null);
        const secret = randomSecret(dependencies);
        let conn = null;
        const onOffer = (msg) => {
          if (done || msg?.protocol !== PROTOCOL || msg.kind !== "qm-match") return;
          let code = null;
          try {
            code = normalizeRoomCode(msg.code);
          } catch {}
          if (!code) return;
          const ack = { protocol: PROTOCOL, kind: "qm-ack", code };
          talk?.send(ack);
          talk?.send(ack);
          try {
            if (conn?.open) conn.send(ack);
          } catch {}
          finish(code);
        };
        talk = await lobbyTalk(secret, "g", onOffer);
        if (done) return;
        peer.on("error", () => finish(null));
        conn = peer.connect(lobbyId(slot, ranked), { reliable: true, metadata: { qm: secret } });
        conn.on("data", onOffer);
      });
    });
  for (let round = 0; ; round++) {
    check();
    tell(round ? "Still searching for an opponent …" : "Searching for an opponent …");
    for (let slot = 0; slot < QUICK_SLOTS; slot++) {
      check();
      const { peer, result } = await openPeer(lobbyId(slot, ranked));
      check();
      if (result === "open") {
        tell("Waiting for an opponent …");
        const found = await hostSlot(peer);
        if (found) return found;
        break; // re-scan from slot 0
      }
      try {
        peer.destroy();
      } catch {}
      if (result === "unavailable-id") {
        const code = await askSlot(slot);
        check();
        if (code) return { role: "guest", code };
      } else if (result !== "timeout") {
        throw peerFailure({ type: result });
      }
    }
    await wait(1000 + Math.random() * 1500);
  }
}
