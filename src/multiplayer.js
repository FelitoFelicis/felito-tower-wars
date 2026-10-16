/**
 * Felito 1v1 transport. The host owns the simulation; this module only carries JSON.
 * Real PeerJS/WebRTC, no simulated online transport and no embedded credentials.
 */
// Version 3 requires the schema-4 expanded board and mobile movement rules. Keep the address namespace
// stable so an old client receives a clear handshake mismatch, not a lost room.
export const PROTOCOL_VERSION = 4;
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
/** Minimal MQTT 3.1.1 client over WebSocket: connect, subscribe, QoS 0 publish, ping. */
class MqttLink {
  constructor(url, onMessage) {
    this.url = url;
    this.onMessage = onMessage;
    this.ready = false;
    this.closed = false;
    this.subs = [];
    this.buffer = new Uint8Array(0);
    this.packetId = 1;
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
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => {
        finish(false);
        this.close();
      }, timeout);
      try {
        this.ws = new WebSocket(this.url, ["mqtt"]);
      } catch {
        return finish(false);
      }
      this.ws.binaryType = "arraybuffer";
      this.ws.onopen = () => {
        const id = "felito-" + Math.random().toString(36).slice(2, 12);
        this.ws.send(this.packet(0x10, [...MqttLink.str("MQTT"), 4, 2, 0, 60, ...MqttLink.str(id)]));
      };
      this.ws.onmessage = (e) => {
        const add = new Uint8Array(e.data),
          merged = new Uint8Array(this.buffer.length + add.length);
        merged.set(this.buffer);
        merged.set(add, this.buffer.length);
        this.buffer = merged;
        this.parse(() => finish(true));
      };
      this.ws.onerror = () => finish(false);
      this.ws.onclose = () => {
        this.ready = false;
        finish(false);
      };
      this.ping = setInterval(() => {
        if (this.ready) this.raw(new Uint8Array([0xc0, 0]));
      }, 25000);
    });
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
    try {
      if (this.ws?.readyState === 1) this.raw(new Uint8Array([0xe0, 0]));
      this.ws?.close();
    } catch {}
  }
}
/**
 * A message channel on all reachable brokers. `inbox`/`outbox` are topics. Messages are strings
 * (deflated on the wire, framed with a counter). Resolves once at least one broker is connected.
 */
async function openRelayLinks(inbox, onText) {
  let lastIn = 0;
  const chain = { p: Promise.resolve() };
  const onMessage = (topic, bytes) => {
    if (topic !== inbox || bytes.length < 4) return;
    const n = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
    if (n <= lastIn) return;
    lastIn = n;
    chain.p = chain.p.then(() => inflate(bytes.subarray(4))).then((b) => onText(textDec.decode(b))).catch(() => {});
  };
  const links = RELAY_BROKERS.map((url) => new MqttLink(url, onMessage));
  const opened = await Promise.all(links.map((l) => l.open().then((ok) => (ok ? l : (l.close(), null)))));
  const live = opened.filter(Boolean);
  for (const l of live) l.subscribe(inbox);
  return live;
}
class RelayLinkSender {
  constructor(links, outbox) {
    this.links = links;
    this.outbox = outbox;
    this.n = 0;
    this.queue = Promise.resolve();
    this.pending = 0;
  }
  send(text) {
    const n = ++this.n;
    this.pending++;
    this.queue = this.queue
      .then(() => deflate(textEnc.encode(text)))
      .then((z) => {
        const out = new Uint8Array(z.length + 4);
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
  if (code.length !== 8 || [...code].some((char) => !ROOM_ALPHABET.includes(char))) {
    throw error("invalid-code", "The room code must have 8 letters or digits.");
  }
  return code;
}

function randomCode(dependencies) {
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
    this.timers = new Set();
    this.peerListeners = [];
    this.connectionListeners = [];
    this.closed = false;
    this.connected = false;
    this.sequence = 0;
    this.receivedSequence = 0;
    this.outbound = tokenBucket(this.now, 80, 60);
    this.inbound = tokenBucket(this.now, 120, 90);
    this.outboundBytes = tokenBucket(this.now, 4 * 1024 * 1024, 2 * 1024 * 1024);
    this.inboundBytes = tokenBucket(this.now, 4 * 1024 * 1024, 2 * 1024 * 1024);
    this.relaySecret = role === "guest" ? randomSecret(dependencies) : null;
    this.room = Object.freeze({
      code,
      role,
      isRelay: () => !!this.connection?.relay,
      send: (data) => this.send(data),
      close: () => this.finish("closed", "Room closed."),
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
            if (this.closed || this.role !== "host" || this.connection) this.rejectExtra(connection);
            else this.attach(connection);
          },
          this.peerListeners,
        );
        this.listen(
          this.peer,
          "error",
          (err) => {
            if (
              this.connected &&
              ["network", "socket-error", "socket-closed", "server-error", "disconnected"].includes(err?.type)
            ) {
              this.status(
                "warning",
                "Room service disconnected; the running duel stays directly connected.",
                peerFailure(err),
              );
            } else this.fail(peerFailure(err));
          },
          this.peerListeners,
        );
        this.listen(
          this.peer,
          "close",
          () => this.finish("disconnected", "The room was closed."),
          this.peerListeners,
        );
        this.listen(
          this.peer,
          "disconnected",
          () => {
            if (this.connected)
              this.status("warning", "Room service disconnected; the running duel stays directly connected.");
            else this.fail(error("signaling-disconnected", "The connection to the room service was interrupted."));
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
    if (this.role === "host") this.status("ready", "Room ready. Share the code with your opponent.");
    else {
      this.status("connecting", "Connecting to the host …");
      try {
        const connection = this.peer.connect("felito-v1-" + this.code, {
          label: PROTOCOL,
          metadata: { protocol: PROTOCOL, version: PROTOCOL_VERSION, room: this.code, relay: this.relaySecret },
          serialization: "binary",
          reliable: true,
        });
        this.attach(connection);
      } catch (err) {
        this.fail(peerFailure(err));
        return;
      }
    }
    this.resolve?.(this.room);
    this.resolve = this.reject = null;
  }

  rejectExtra(connection) {
    if (this.closed) {
      connection.close();
      return;
    }
    const close = () => {
      try {
        connection.close();
      } catch {}
    };
    const reject = () => {
      try {
        connection.send(
          JSON.stringify({
            protocol: PROTOCOL,
            version: PROTOCOL_VERSION,
            room: this.code,
            type: "reject",
            reason: "room-full",
          }),
        );
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

  attach(connection) {
    if (this.closed) {
      connection.close();
      return;
    }
    this.connection = connection;
    // v0.13a: no direct channel after a few seconds: switch both sides to the MQTT relay
    let relayNow = null;
    if (!connection.relay) {
      const secret = this.role === "guest" ? this.relaySecret : connection.metadata?.relay;
      if (validSecret(secret) && this.dependencies.relay !== false) {
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
    this.listen(connection, "data", (data) => this.receive(data), this.connectionListeners);
    this.listen(connection, "error", (err) => relayNow?.() || this.connectionFailure(peerFailure(err)), this.connectionListeners);
    this.listen(
      connection,
      "close",
      () => {
        if (this.closed || relayNow?.()) return;
        this.connectionFailure(error("opponent-left", "Your opponent left the room."));
      },
      this.connectionListeners,
    );
    let opened = false;
    const onOpen = () => {
      if (this.closed || opened) return;
      opened = true;
      this.channelOpen = true;
      this.cancel(this.relayTimer);
      this.cancel(this.connectionTimer);
      this.handshakeTimer = this.later(
        () =>
          this.connectionFailure(
            error("handshake-timeout", "Your opponent didn't finish the handshake."),
          ),
        this.handshakeTimeout,
      );
      if (this.role === "guest") this.control("hello");
      else this.status("connecting", "Opponent found. Checking the game version …");
    };
    this.listen(connection, "open", onOpen, this.connectionListeners);
    this.connectionTimer = this.later(
      () =>
        this.connectionFailure(
          error(
            "connection-timeout",
            "The direct data channel isn't answering. A firewall or mobile network may be blocking it.",
          ),
        ),
      this.timeout,
    );
    if (connection.open) onOpen();
  }

  useRelay(connection, secret) {
    for (const dispose of this.connectionListeners.splice(0)) dispose();
    this.cancel(this.connectionTimer);
    try {
      connection.close();
    } catch {}
    this.status("connecting", "No direct connection. Switching to the relay server …");
    const relay = new RelayChannel(secret, this.role, this.code);
    this.attach(relay);
    relay.start();
  }

  connectionFailure(err) {
    if (this.closed) return;
    // Invalid or abandoned candidates do not destroy a host's waiting room.
    if (this.role === "host" && !this.connected && this.opened) {
      this.channelOpen = false;
      this.cancel(this.relayTimer);
      this.cancel(this.connectionTimer);
      this.cancel(this.handshakeTimer);
      for (const dispose of this.connectionListeners.splice(0)) dispose();
      const connection = this.connection;
      this.connection = null;
      try {
        connection?.close();
      } catch {}
      this.status("warning", err.message, err);
      this.status("ready", "Room still ready. An opponent can join.");
    } else this.fail(err);
  }

  control(type, extra = {}) {
    if (this.closed || !this.connection?.open) return false;
    try {
      this.connection.send(
        JSON.stringify({ protocol: PROTOCOL, version: PROTOCOL_VERSION, room: this.code, type, ...extra }),
      );
      return true;
    } catch (err) {
      this.connectionFailure(peerFailure(err));
      return false;
    }
  }

  receive(raw) {
    if (this.closed) return;
    if (typeof raw !== "string" || raw.length > MAX_WIRE_BYTES || !this.inbound()) {
      this.connectionFailure(
        error("invalid-traffic", "The data channel received invalid or too many messages."),
      );
      return;
    }
    const bytes = raw.length; // v0.13b: no per-message re-encoding
    if (bytes > MAX_WIRE_BYTES || !this.inboundBytes(bytes)) {
      this.connectionFailure(error("traffic-limit", "The data channel exceeded its data limit."));
      return;
    }
    let packet;
    try {
      packet = JSON.parse(raw);
    } catch {
      this.connectionFailure(error("invalid-json", "Your opponent sent invalid game data."));
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
      this.connectionFailure(error("protocol-mismatch", "The game versions or room codes don't match."));
      return;
    }
    this.lastReceived = this.now();
    if (packet.type === "reject") {
      this.fail(error("room-full", "The room already has two players."));
      return;
    }
    if (!this.connected) {
      if (this.role === "host" && this.phase === "hello" && packet.type === "hello") {
        this.phase = "confirm";
        this.control("welcome");
        return;
      }
      if (this.role === "guest" && this.phase === "welcome" && packet.type === "welcome") {
        this.phase = "ready";
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
      this.connectionFailure(error("invalid-handshake", "The handshake failed."));
      return;
    }
    if (packet.type === "ping") {
      this.control("pong");
      return;
    }
    if (packet.type === "pong") return;
    if (packet.type !== "data" || !Number.isSafeInteger(packet.sequence) || packet.sequence <= this.receivedSequence) {
      this.connectionFailure(error("invalid-message", "The data channel received an invalid message sequence."));
      return;
    }
    try {
      // v0.13b: the packet was parsed once already; no second validate/copy pass (it cost frames)
      const payload = packet.payload;
      if (!payload || typeof payload !== "object") throw error("invalid-payload", "Only valid JSON game data can be sent.");
      this.receivedSequence = packet.sequence;
      callback(this.callbacks, "onData", payload, this.room);
    } catch (err) {
      this.connectionFailure(err);
    }
  }

  connectedNow() {
    if (this.closed || this.connected) return;
    this.connected = true;
    this.phase = "connected";
    this.cancel(this.handshakeTimer);
    this.cancel(this.connectionTimer);
    this.lastReceived = this.now();
    this.status("connected", this.connection?.relay ? "Connected through the relay server. The duel can start." : "Directly connected. The duel can start.");
    callback(this.callbacks, "onConnect", this.room);
    const heartbeat = () => {
      if (this.closed) return;
      if (this.now() - this.lastReceived > this.idleTimeout) {
        this.fail(error("opponent-timeout", "Your opponent stopped responding. The duel has ended."));
        return;
      }
      this.control("ping");
      if (!this.closed) this.heartbeatTimer = this.later(heartbeat, this.heartbeatInterval);
    };
    this.heartbeatTimer = this.later(heartbeat, this.heartbeatInterval);
  }

  send(data) {
    if (this.closed || !this.connected || !this.connection?.open) return false;
    try {
      // v0.13b: one serialization pass per message (was four)
      const body = JSON.stringify(data);
      if (!body || body[0] !== "{") throw error("invalid-payload", "Only valid JSON game data can be sent.");
      if (body.length > MAX_PAYLOAD_BYTES) throw error("payload-too-large", "The game data is too large for one message.");
      const wire =
        JSON.stringify({ protocol: PROTOCOL, version: PROTOCOL_VERSION, room: this.code, type: "data", sequence: this.sequence + 1 }).slice(0, -1) +
        ',"payload":' +
        body +
        "}";
      if ((this.connection.bufferSize || 0) > 16 || (this.connection.dataChannel?.bufferedAmount || 0) > 1024 * 1024) {
        throw error("backpressure", "The connection is busy. The next update will try again.");
      }
      if (!this.outbound() || !this.outboundBytes(wire.length)) {
        throw error("send-limit", "Too many game messages. Please wait for the next update.");
      }
      this.connection.send(wire);
      this.sequence++;
      return true;
    } catch (err) {
      if (err instanceof MultiplayerError) this.status("warning", err.message, err);
      else this.connectionFailure(peerFailure(err));
      return false;
    }
  }

  fail(err) {
    this.finish("error", err.message, err);
  }

  finish(state, message, err) {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    for (const timer of this.timers) this.clearTimer(timer);
    this.timers.clear();
    for (const dispose of [...this.connectionListeners.splice(0), ...this.peerListeners.splice(0)]) dispose();
    this.callbacks.signal?.removeEventListener("abort", this.abort);
    try {
      this.connection?.close();
    } catch {}
    try {
      this.peer?.destroy();
    } catch {}
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

/** Resolves after signaling registration. Wait for onConnect before sending. */
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
 * Resolves { role: "host" | "guest", code }.
 */
export const QUICK_SLOTS = 6;
const lobbyId = (slot) => `felito-qm-p${PROTOCOL_VERSION}-${slot}`;
export async function findQuickMatch({ signal, onStatus } = {}, dependencies = {}) {
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
  // Waits on a claimed slot for one opponent; hands it a fresh room code. The match only counts
  // once the opponent takes the code; otherwise the slot keeps waiting.
  const hostSlot = (peer) =>
    new Promise((resolve, reject) => {
      let matched = false,
        offering = null,
        settled = false;
      const stop = () => {
        try {
          peer.destroy();
        } catch {}
      };
      const settle = (value, err) => {
        if (settled) return;
        settled = true;
        clearTimeout(rescan);
        signal?.removeEventListener("abort", abort);
        if (err) reject(err);
        else resolve(value);
        stop();
      };
      const abort = () => settle(null, error("aborted", "Search cancelled."));
      signal?.addEventListener("abort", abort, { once: true });
      // Give other free slots a chance: re-scan every 20 s so two waiting players find each other.
      const rescan = setTimeout(() => {
        if (!matched && !offering) settle(null);
      }, 20000);
      peer.on("connection", async (conn) => {
        const secret = conn.metadata?.qm;
        if (matched || offering || settled || !validSecret(secret)) {
          setTimeout(() => conn.close(), 300);
          return;
        }
        const code = randomCode(dependencies),
          offer = { protocol: PROTOCOL, kind: "qm-match", code };
        offering = secret;
        let talk = null,
          repeat = null;
        const take = (msg) => {
          if (matched || offering !== secret || msg?.protocol !== PROTOCOL || msg.kind !== "qm-ack" || msg.code !== code) return;
          matched = true;
          clearTimeout(giveUp);
          clearInterval(repeat);
          talk?.close();
          setTimeout(() => settle({ role: "host", code }), 250);
        };
        const giveUp = setTimeout(() => {
          if (matched || offering !== secret) return;
          offering = null;
          clearInterval(repeat);
          talk?.close();
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
        if (matched || offering !== secret) return talk.close();
        talk.send(offer);
        repeat = setInterval(() => talk.send(offer), 700);
      });
      peer.on("error", (e) => {
        if (!matched && ["network", "server-error", "socket-error", "socket-closed"].includes(e?.type)) settle(null);
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
        conn = peer.connect(lobbyId(slot), { reliable: true, metadata: { qm: secret } });
        conn.on("data", onOffer);
      });
    });
  for (let round = 0; ; round++) {
    check();
    tell(round ? "Still searching for an opponent …" : "Searching for an opponent …");
    for (let slot = 0; slot < QUICK_SLOTS; slot++) {
      check();
      const { peer, result } = await openPeer(lobbyId(slot));
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
