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
    this.room = Object.freeze({
      code,
      role,
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
        const options = {
          host: "0.peerjs.com",
          port: 443,
          path: "/",
          secure: true,
          debug: 0,
          ...(this.dependencies.peerOptions || {}),
        };
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
          metadata: { protocol: PROTOCOL, version: PROTOCOL_VERSION, room: this.code },
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
    this.phase = this.role === "host" ? "hello" : "welcome";
    this.listen(connection, "data", (data) => this.receive(data), this.connectionListeners);
    this.listen(connection, "error", (err) => this.connectionFailure(peerFailure(err)), this.connectionListeners);
    this.listen(
      connection,
      "close",
      () => {
        if (this.closed) return;
        this.connectionFailure(error("opponent-left", "Your opponent left the room."));
      },
      this.connectionListeners,
    );
    let opened = false;
    const onOpen = () => {
      if (this.closed || opened) return;
      opened = true;
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

  connectionFailure(err) {
    if (this.closed) return;
    // Invalid or abandoned candidates do not destroy a host's waiting room.
    if (this.role === "host" && !this.connected && this.opened) {
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
    const bytes = encoder.encode(raw).byteLength;
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
      const payload = jsonPayload(packet.payload);
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
    this.status("connected", "Directly connected. The duel can start.");
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
      const payload = jsonPayload(data);
      const wire = JSON.stringify({
        protocol: PROTOCOL,
        version: PROTOCOL_VERSION,
        room: this.code,
        type: "data",
        sequence: this.sequence + 1,
        payload,
      });
      if ((this.connection.bufferSize || 0) > 16 || (this.connection.dataChannel?.bufferedAmount || 0) > 1024 * 1024) {
        throw error("backpressure", "The connection is busy. The next update will try again.");
      }
      if (!this.outbound() || !this.outboundBytes(encoder.encode(wire).byteLength)) {
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
export async function createRoom(callbacks = {}, dependencies = {}) {
  return startRoom("host", randomCode(dependencies), callbacks, dependencies);
}

/** Resolves when signaling is ready and the connection attempt has started. */
export async function joinRoom(code, callbacks = {}, dependencies = {}) {
  return startRoom("guest", normalizeRoomCode(code), callbacks, dependencies);
}
