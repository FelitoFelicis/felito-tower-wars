/**
 * Babylon.js 2D layer (v0.08): the small part of a 2D game framework the arena needs, on top of
 * Babylon.js — immediate-mode vector graphics, textured images with tint and flip, canvas text,
 * depth order and additive blending, drawn by an orthographic camera in CSS pixels (y down).
 * Babylon itself comes from vendor/babylon-felito.js (a subset build that sets globalThis.BABYLON).
 */
const B = globalThis.BABYLON;

export const BLEND = { NORMAL: 0, ADD: 1 };
export const TINT = { MULTIPLY: 0, FILL: 1 };

// Premultiplied alpha everywhere: textures are uploaded premultiplied, shapes output rgb*a.
B.ShaderStore.ShadersStore.f2dShapeVertexShader = `precision highp float;
attribute vec3 position; attribute vec4 color;
uniform mat4 worldViewProjection;
varying vec4 vColor;
void main() { vColor = vec4(color.rgb * color.a, color.a); gl_Position = worldViewProjection * vec4(position, 1.0); }`;
B.ShaderStore.ShadersStore.f2dShapeFragmentShader = `precision highp float;
varying vec4 vColor;
void main() { gl_FragColor = vColor; }`;
B.ShaderStore.ShadersStore.f2dImageVertexShader = `precision highp float;
attribute vec3 position; attribute vec2 uv; attribute vec4 color; attribute float fill;
uniform mat4 worldViewProjection;
varying vec2 vUV; varying vec4 vTint; varying float vFill;
void main() { vUV = uv; vTint = color; vFill = fill; gl_Position = worldViewProjection * vec4(position, 1.0); }`;
B.ShaderStore.ShadersStore.f2dImageFragmentShader = `precision highp float;
uniform sampler2D tex;
varying vec2 vUV; varying vec4 vTint; varying float vFill;
void main() {
  vec4 c = texture2D(tex, vUV);
  vec3 rgb = mix(c.rgb * vTint.rgb, vTint.rgb * c.a, vFill);
  gl_FragColor = vec4(rgb, c.a) * vTint.a;
}`;

const rgbOf = (color) => [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255];
const cssColor = (c) => (typeof c === "number" ? "#" + c.toString(16).padStart(6, "0") : c);

/** Phaser-style HSV (0..1) to a 0xRRGGBB colour. */
export function hsvToColor(h, s, v) {
  const i = Math.floor(h * 6),
    f = h * 6 - i,
    p = v * (1 - s),
    q = v * (1 - f * s),
    t = v * (1 - (1 - f) * s),
    [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/** v0.23: a canvas size for text: powers of two from 32 px, so a pooled text keeps its texture. */
const bucket = (n) => Math.max(32, 2 ** Math.ceil(Math.log2(Math.max(1, n))));
/** v0.23: measures a text block like Text2D draws it (CSS px; widths per line). */
function measureText(text, s, pad) {
  const size = parseFloat(s.fontSize) || 16,
    font = `${size}px ${s.fontFamily}`,
    lines = String(text).split("\n"),
    stroke = s.stroke ? s.strokeThickness || 0 : 0,
    [pl, pt, pr, pb] = pad,
    probe = (measureText.probe ||= document.createElement("canvas").getContext("2d"));
  probe.font = font;
  const m = probe.measureText("ÉMgy|"),
    ascent = Math.ceil(m.actualBoundingBoxAscent || size * 0.8),
    descent = Math.ceil(m.actualBoundingBoxDescent || size * 0.25),
    lineH = ascent + descent + stroke,
    widths = lines.map((l) => Math.ceil(probe.measureText(l).width));
  return { font, lines, stroke, ascent, lineH, widths, w: Math.max(1, Math.max(...widths) + stroke + pl + pr), h: Math.max(1, lineH * lines.length + pt + pb) };
}
/** v0.23: draws a measured text block with its top left corner at device pixel (ox, oy), at resolution r. */
function paintText(ctx, M, s, pad, r, ox = 0, oy = 0) {
  const { w, h, stroke, lines, widths, ascent, lineH } = M,
    [pl, pt, pr] = pad;
  ctx.setTransform(r, 0, 0, r, ox, oy);
  if (s.backgroundColor) {
    ctx.fillStyle = cssColor(s.backgroundColor);
    ctx.fillRect(0, 0, w, h);
  }
  ctx.font = M.font;
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  lines.forEach((line, i) => {
    const lw = widths[i],
      x = pl + stroke / 2 + (s.align === "center" ? (w - pl - pr - stroke - lw) / 2 : s.align === "right" ? w - pl - pr - stroke - lw : 0),
      y = pt + stroke / 2 + ascent + i * lineH;
    if (stroke) {
      ctx.strokeStyle = cssColor(s.stroke);
      ctx.lineWidth = stroke;
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = cssColor(s.color);
    ctx.fillText(line, x, y);
  });
}
const SCRATCH_UV = [0, 0, 0, 0];

export class Stage {
  constructor(container, { background = "#0b201d", dpr = 1, antialias = true } = {}) {
    this.dpr = dpr;
    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, { display: "block", width: "100%", height: "100%", touchAction: "none", outline: "none" });
    container.appendChild(this.canvas);
    // v0.23: no MSAA on dense screens (devicePixelRatio >= 2), where it costs much and shows little
    this.engine = new B.Engine(this.canvas, antialias, { stencil: false, preserveDrawingBuffer: false, premultipliedAlpha: false, alpha: false, powerPreference: "high-performance" }, false);
    this.engine.setHardwareScalingLevel(1 / dpr);
    this.scene = new B.Scene(this.engine);
    this.scene.detachControl?.();
    this.scene.skipPointerMovePicking = true;
    this.scene.skipFrustumClipping = true;
    const bg = rgbOf(parseInt(background.slice(1), 16));
    this.scene.clearColor = new B.Color4(bg[0], bg[1], bg[2], 1);
    this.camera = new B.FreeCamera("f2d-camera", new B.Vector3(0, 0, -10), this.scene);
    this.camera.mode = B.Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.setTarget(new B.Vector3(0, 0, 0));
    this.camera.inputs?.clear?.();
    this.camera.minZ = 0.1;
    this.camera.maxZ = 100;
    new B.DynamicTexture("f2d-init", 1, this.scene).dispose(); // v0.23: registers the engine's dynamic-texture calls used by _uploadArt
    this.textures = new Map(); // key -> { tex, w, h, fw, fh, cols, top?, uvRect?, rects?, restore? }
    this.materials = new Map();
    this.dirty = new Set();
    // v0.23: art loads on first use (see request), four files at a time
    this.pending = new Set();
    this.failed = new Set();
    this.waiters = new Map();
    this.jobs = [];
    this.jobByUrl = new Map();
    this.outs = new Map(); // v0.23a: key -> its load on the way (reloadImage marks an older one stale)
    this.users = new Map(); // v0.23a: key -> images drawing it (they redraw when the texture is replaced)
    this.loading = 0;
    this.atlases = new Map();
    this.shakeUntil = 0;
    this.shakeAmount = 0;
    this.resize();
    this.scene.onBeforeRenderObservable.add(() => {
      for (const o of this.dirty) o._flush();
      this.dirty.clear();
      this._placeCamera();
    });
    // v0.23: art uploaded without a kept copy is fetched again after a lost WebGL context
    this.engine.onContextRestoredObservable?.add(() => {
      for (const [key, t] of [...this.textures]) if (t.restore) {
        t.tex.dispose();
        this.textures.delete(key);
        t.restore();
      }
    });
  }
  // v0.23: the size is read in resize() only (reading clientWidth every frame forced a layout after each UI update)
  get width() {
    return this._w;
  }
  get height() {
    return this._h;
  }
  resize() {
    this._w = this.canvas.clientWidth || this._w || 1;
    this._h = this.canvas.clientHeight || this._h || 1;
    this.engine.resize();
    this._placeCamera();
  }
  _placeCamera() {
    let dx = 0,
      dy = 0;
    if (performance.now() < this.shakeUntil) {
      dx = (Math.random() * 2 - 1) * this.shakeAmount * this.width;
      dy = (Math.random() * 2 - 1) * this.shakeAmount * this.height;
    }
    dx -= this.slideX || 0; // v0.09: sideways offset while swiping between fields
    dy += this.scrollY || 0; // Mobile Max: world y at the top edge of the screen
    const c = this.camera;
    c.orthoLeft = dx;
    c.orthoRight = this.width + dx;
    c.orthoTop = -dy;
    c.orthoBottom = -this.height - dy;
  }
  /** Camera shake like Phaser's: duration in ms, intensity as a share of the screen. */
  shake(ms, intensity) {
    this.shakeUntil = Math.max(this.shakeUntil, performance.now() + ms);
    this.shakeAmount = Math.max(intensity, performance.now() < this.shakeUntil - ms ? this.shakeAmount : 0);
  }
  /** `update` returns false to skip drawing this frame (v0.23: the board idles at a lower rate). */
  start(update) {
    const t0 = performance.now();
    let last = t0;
    this.t0 = t0;
    this.update = update;
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      const draw = update(now - t0, now - last);
      last = now;
      if (draw !== false) this.scene.render();
    });
  }
  /** v0.23: draw one frame right away (after a resize, which clears the canvas), without a game tick. */
  redraw() {
    if (!this.update || this.disposed) return;
    this.update(performance.now() - this.t0, 0, true);
    this.scene.render();
  }
  dispose() {
    this.disposed = true;
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
    this.canvas.remove();
  }
  // ---- textures -----------------------------------------------------------------------
  hasTexture(key) {
    return this.textures.has(key);
  }
  frameSize(key) {
    const t = this.textures.get(key);
    return t ? { w: t.fw, h: t.fh } : { w: 1, h: 1 };
  }
  /** v0.23: UV rectangle and size (texture px) of a named part of an atlas, or null. */
  rect(key, name) {
    return this.textures.get(key)?.rects?.[name] || null;
  }
  /** Puts a ready texture under `key` and points every material of that key at it. */
  _setTexture(key, tex, entry) {
    tex.wrapU = tex.wrapV = B.Texture.CLAMP_ADDRESSMODE;
    tex.hasAlpha = true;
    this.textures.get(key)?.tex.dispose();
    entry.tex = tex;
    entry.fw ||= entry.w;
    entry.fh ||= entry.h;
    entry.cols = Math.max(1, Math.floor(entry.w / entry.fw));
    this.textures.set(key, entry);
    for (const [k, m] of this.materials) if (k.startsWith(key + "|")) m.setTexture("tex", tex);
    // v0.23a: images of this key take the new size and UVs (a picture swapped in place, a lost context)
    for (const img of this.users.get(key) || []) {
      img.uvDirty = true;
      img._dirty();
    }
    return key;
  }
  /**
   * A canvas (or loaded image) as a texture; with frame size it becomes a sprite sheet.
   * v0.23: `mipmaps: false` for text; `free` drops the canvas after the upload (`restore` remakes it after a lost context).
   */
  addCanvas(key, source, frameWidth = 0, frameHeight = 0, { mipmaps = true, free = false, ...extra } = {}) {
    let canvas = source;
    if (!(source instanceof HTMLCanvasElement)) {
      canvas = document.createElement("canvas");
      canvas.width = source.naturalWidth || source.width;
      canvas.height = source.naturalHeight || source.height;
      canvas.getContext("2d").drawImage(source, 0, 0);
      free = true;
    }
    const tex = new B.DynamicTexture("t:" + key, canvas, this.scene, mipmaps, mipmaps ? B.Texture.TRILINEAR_SAMPLINGMODE : B.Texture.BILINEAR_SAMPLINGMODE);
    tex.update(true, true);
    const w = canvas.width,
      h = canvas.height;
    if (free) {
      tex._texture && (tex._texture._dynamicTextureSource = null);
      tex._rebuild = () => {}; // nothing to upload again after a lost context: `restore` makes it anew
      canvas.width = canvas.height = 0;
    }
    return this._setTexture(key, tex, { w, h, fw: frameWidth, fh: frameHeight, ...extra });
  }
  /**
   * v0.23: queue `url` for texture `key` unless it is there or on its way (art loads on first use).
   * `paint(rgba)` changes the pixels before the upload (team colours); urgent requests jump the queue.
   */
  request(key, url, { fw = 0, fh = 0, paint = null, urgent = false, meta = null, force = false } = {}) {
    if (this.disposed || (!force && (this.textures.has(key) || this.failed.has(key)))) return;
    if (force) {
      // v0.23a: a load of this key still on its way is dropped when it arrives (reloadImage)
      const old = this.outs.get(key);
      if (old) old.stale = true;
      this.pending.delete(key);
      this.failed.delete(key);
    }
    let job = this.jobByUrl.get(url);
    if (!this.pending.has(key)) {
      this.pending.add(key);
      if (!job) {
        job = { url, outs: [] };
        this.jobByUrl.set(url, job);
        if (urgent) this.jobs.unshift(job);
        else this.jobs.push(job);
      }
      const out = { key, url, fw, fh, paint, meta };
      job.outs.push(out);
      this.outs.set(key, out);
    }
    if (urgent && job && this.jobs[0] !== job) {
      const i = this.jobs.indexOf(job);
      if (i > 0) {
        this.jobs.splice(i, 1);
        this.jobs.unshift(job);
      }
    }
    this._pump();
  }
  /** v0.23: like request, but resolves once the texture is there (or failed). */
  load(key, url, opts) {
    if (this.textures.has(key) || this.failed.has(key)) return Promise.resolve(this.textures.has(key) ? key : null);
    return new Promise((resolve) => {
      if (!this.waiters.has(key)) this.waiters.set(key, []);
      this.waiters.get(key).push(resolve);
      this.request(key, url, { urgent: true, ...opts });
    });
  }
  loadImage(key, url, frameWidth = 0, frameHeight = 0) {
    return this.load(key, url, { fw: frameWidth, fh: frameHeight });
  }
  /**
   * Design variants: load a picture over an existing texture of the same key (the old one stays visible
   * until the new one has arrived). v0.23a: no copy of a picture is kept after its upload, so the new file is
   * fetched and decoded; `paint` (team colours), frame size and size data come along like in request.
   */
  reloadImage(key, url, opts = {}) {
    if (this.disposed) return Promise.resolve(null);
    return new Promise((resolve) => {
      if (!this.waiters.has(key)) this.waiters.set(key, []);
      this.waiters.get(key).push(resolve);
      this.request(key, url, { ...opts, force: true });
    });
  }
  /** Keys of the textures made from `key` (player colour copies), loaded or on their way. */
  derivedKeys(key) {
    const out = [];
    for (const k of this.artKeys()) if (k.startsWith(key + "#")) out.push(k);
    return out;
  }
  /** v0.23a: every picture texture key, loaded or on its way. */
  artKeys() {
    return new Set([...this.textures.keys(), ...this.pending]);
  }
  /** v0.23a: the file a texture was loaded from (or is loading from), if it came from request. */
  urlOf(key) {
    return this.outs.get(key)?.url ?? this.textures.get(key)?.url ?? null;
  }
  /** v0.23a: let a texture go (the old look's scenery atlas); its batches draw nothing until it is back. */
  dropTexture(key) {
    const t = this.textures.get(key);
    if (!t) return;
    t.tex.dispose();
    this.textures.delete(key);
  }
  _pump() {
    while (this.loading < 4 && this.jobs.length) {
      const job = this.jobs.shift();
      this.jobByUrl.delete(job.url);
      if (job.outs.every((o) => o.stale)) continue; // v0.23a: every key of it was reloaded from another file
      this.loading++;
      this._decode(job.url)
        .then((src) => {
          for (const o of job.outs)
            try {
              if (!this.disposed && !o.stale) this._uploadArt(o, src); // v0.23a: stale = replaced by a newer load
            } catch (err) {
              console.warn("Texture upload failed:", o.key, err);
            }
          src.close?.();
        })
        .catch(() => {
          console.warn("Bild fehlt:", job.url);
          for (const o of job.outs) if (!o.stale) this.failed.add(o.key);
        })
        .finally(() => {
          this.loading--;
          for (const o of job.outs) {
            if (o.stale) continue; // v0.23a: the newer load of this key finishes it
            if (this.outs.get(o.key) === o) this.outs.delete(o.key);
            this.pending.delete(o.key);
            const w = this.waiters.get(o.key);
            if (w) {
              this.waiters.delete(o.key);
              w.forEach((resolve) => resolve(this.textures.has(o.key) ? o.key : null));
            }
          }
          this._pump();
        });
    }
  }
  /** v0.23: a decoded picture: an ImageBitmap (decoded off the main thread) where possible, else an image. */
  async _decode(url) {
    if (typeof createImageBitmap === "function" && typeof fetch === "function") {
      let res = null;
      try {
        res = await fetch(url);
      } catch {}
      if (res && !res.ok) throw new Error("HTTP " + res.status);
      if (res)
        try {
          return await createImageBitmap(await res.blob(), { premultiplyAlpha: "premultiply" });
        } catch {}
    }
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  }
  /** v0.23: upload straight from the decoded picture (mipmapped), keeping no canvas or copy of it. */
  _uploadArt(o, src) {
    const w = src.naturalWidth || src.width,
      h = src.naturalHeight || src.height,
      restore = () => this.request(o.key, o.url, o);
    if (o.paint) {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(src, 0, 0);
      const data = ctx.getImageData(0, 0, w, h);
      o.paint(data.data, w, h); // v0.27zzcF: size for the base ellipse of tower pictures
      ctx.putImageData(data, 0, 0);
      this.addCanvas(o.key, canvas, o.fw, o.fh, { free: true, restore, url: o.url, meta: o.meta });
      return;
    }
    // An ImageBitmap ignores the flip and premultiply upload flags (it is premultiplied already), so it is
    // uploaded top row first and its UVs run top-down; an image goes up flipped and premultiplied like a canvas.
    const bitmap = typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap,
      engine = this.engine,
      internal = engine.createDynamicTexture(w, h, true, B.Texture.TRILINEAR_SAMPLINGMODE);
    engine.updateDynamicTexture(internal, src, !bitmap, !bitmap);
    internal._dynamicTextureSource = null;
    const tex = new B.Texture(null, this.scene, false, false, B.Texture.TRILINEAR_SAMPLINGMODE);
    tex._texture = internal;
    this._setTexture(o.key, tex, { w, h, fw: o.fw, fh: o.fh, top: bitmap, restore, url: o.url, meta: o.meta });
  }
  /**
   * v0.23: several pictures in one mipmapped texture (one draw call for the whole meadow). Each sits on a
   * 16 px grid with its edge pixels repeated into a 16 px border, so filtering never bleeds between them.
   */
  async loadAtlas(key, items) {
    const G = 16,
      srcs = await Promise.all(items.map(([, url]) => this._decode(url).catch(() => null))),
      up = (n) => Math.ceil(n / G) * G,
      maxW = 1152;
    let x = 0,
      y = 0,
      rowH = 0;
    const places = srcs.map((src) => {
      if (!src) return null;
      const w = src.naturalWidth || src.width,
        h = src.naturalHeight || src.height,
        cw = up(w) + 2 * G,
        ch = up(h) + 2 * G;
      if (x + cw > maxW && x > 0) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      const p = { x: x + G, y: y + G, w, h };
      x += cw;
      rowH = Math.max(rowH, ch);
      return p;
    });
    const AW = Math.max(G, ...places.map((p) => (p ? p.x + up(p.w) + G : 0))),
      AH = y + rowH,
      canvas = document.createElement("canvas");
    canvas.width = AW;
    canvas.height = Math.max(G, AH);
    const ctx = canvas.getContext("2d"),
      rects = {};
    ctx.imageSmoothingEnabled = false;
    places.forEach((p, i) => {
      if (!p) return;
      const s = srcs[i],
        { x, y, w, h } = p;
      ctx.drawImage(s, x, y);
      // repeat the edge pixels into the border (sides, then corners)
      ctx.drawImage(s, 0, 0, 1, h, x - G, y, G, h);
      ctx.drawImage(s, w - 1, 0, 1, h, x + w, y, G, h);
      ctx.drawImage(s, 0, 0, w, 1, x, y - G, w, G);
      ctx.drawImage(s, 0, h - 1, w, 1, x, y + h, w, G);
      ctx.drawImage(s, 0, 0, 1, 1, x - G, y - G, G, G);
      ctx.drawImage(s, w - 1, 0, 1, 1, x + w, y - G, G, G);
      ctx.drawImage(s, 0, h - 1, 1, 1, x - G, y + h, G, G);
      ctx.drawImage(s, w - 1, h - 1, 1, 1, x + w, y + h, G, G);
      rects[items[i][0]] = { uv: [x / AW, 1 - y / canvas.height, (x + w) / AW, 1 - (y + h) / canvas.height], w, h };
    });
    srcs.forEach((s) => s?.close?.());
    if (this.disposed) return key;
    return this.addCanvas(key, canvas, 0, 0, { free: true, rects, restore: () => this.loadAtlas(key, items) });
  }
  /**
   * v0.23: text blocks (drawn exactly like Text2D) side by side in one texture, without mipmaps;
   * `entries` = [{ name, text, style, pad }]. Drawn again once the web font has arrived.
   */
  textAtlas(key, entries, res = this.dpr) {
    this.atlases.set(key, () => this.textAtlas(key, entries, res));
    this._hookFonts();
    const GAP = 2,
      maxW = 512,
      cells = entries.map((e) => {
        const style = { fontFamily: "sans-serif", fontSize: "16px", color: "#ffffff", stroke: null, strokeThickness: 0, backgroundColor: null, align: "left", ...e.style },
          pad = e.pad || [0, 0, 0, 0],
          M = measureText(e.text, style, pad);
        return { e, style, pad, M, cw: Math.ceil(M.w * res), ch: Math.ceil(M.h * res) };
      });
    let x = GAP,
      y = GAP,
      rowH = 0,
      AW = 0;
    for (const c of cells) {
      if (x + c.cw + GAP > maxW && x > GAP) {
        x = GAP;
        y += rowH + GAP;
        rowH = 0;
      }
      c.x = x;
      c.y = y;
      x += c.cw + GAP;
      rowH = Math.max(rowH, c.ch);
      AW = Math.max(AW, x);
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, AW);
    canvas.height = Math.max(1, y + rowH + GAP);
    const ctx = canvas.getContext("2d"),
      rects = {};
    for (const c of cells) {
      paintText(ctx, c.M, c.style, c.pad, res, c.x, c.y);
      rects[c.e.name] = { uv: [c.x / canvas.width, 1 - c.y / canvas.height, (c.x + c.cw) / canvas.width, 1 - (c.y + c.ch) / canvas.height], w: c.M.w, h: c.M.h };
    }
    // edge pixels repeated one pixel outwards, so bilinear filtering at the edges matches a texture of its own
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    for (const c of cells) {
      const { x, y, cw, ch } = c;
      ctx.drawImage(canvas, x, y, 1, ch, x - 1, y, 1, ch);
      ctx.drawImage(canvas, x + cw - 1, y, 1, ch, x + cw, y, 1, ch);
      ctx.drawImage(canvas, x - 1, y, cw + 2, 1, x - 1, y - 1, cw + 2, 1);
      ctx.drawImage(canvas, x - 1, y + ch - 1, cw + 2, 1, x - 1, y + ch, cw + 2, 1);
    }
    return this.addCanvas(key, canvas, 0, 0, { mipmaps: false, free: true, rects, restore: () => this.atlases.get(key)?.() });
  }
  /** Frame rectangle in UV space (canvases and images are uploaded with invertY, ImageBitmaps top-down). */
  _uv(key, frame, out = [0, 0, 0, 0]) {
    const t = this.textures.get(key);
    if (!t) {
      out[0] = 0;
      out[1] = 1;
      out[2] = 1;
      out[3] = 0;
      return out;
    }
    if (t.uvRect) {
      for (let k = 0; k < 4; k++) out[k] = t.uvRect[k];
      return out;
    }
    const i = Math.max(0, frame | 0),
      fx = (i % t.cols) * t.fw,
      fy = Math.floor(i / t.cols) * t.fh;
    out[0] = fx / t.w;
    out[1] = t.top ? fy / t.h : 1 - fy / t.h;
    out[2] = (fx + t.fw) / t.w;
    out[3] = t.top ? (fy + t.fh) / t.h : 1 - (fy + t.fh) / t.h;
    return out;
  }
  _material(kind, key, blend) {
    const id = `${key}|${kind}|${blend}`;
    let m = this.materials.get(id);
    if (m) return m;
    const image = kind === "image";
    m = new B.ShaderMaterial(
      "m:" + id,
      this.scene,
      { vertex: image ? "f2dImage" : "f2dShape", fragment: image ? "f2dImage" : "f2dShape" },
      { attributes: image ? ["position", "uv", "color", "fill"] : ["position", "color"], uniforms: ["worldViewProjection"], samplers: image ? ["tex"] : [], needAlphaBlending: true },
    );
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    m.alphaMode = blend === BLEND.ADD ? B.Constants.ALPHA_ONEONE : B.Constants.ALPHA_PREMULTIPLIED;
    if (image) {
      const t = this.textures.get(key);
      if (t) m.setTexture("tex", t.tex);
    }
    this.materials.set(id, m);
    return m;
  }
  graphics() {
    return new Graphics(this);
  }
  image(x, y, key, frame) {
    return new Image2D(this, x, y, key, frame);
  }
  /** v0.23: a batch of textured quads drawn in one call. */
  sprites(key) {
    return new Sprites2D(this, key);
  }
  text(x, y, text, style) {
    const t = new Text2D(this, x, y, text, style);
    (this.texts ||= new Set()).add(t);
    this._hookFonts();
    return t;
  }
  _hookFonts() {
    if (!this.fontHook && document.fonts) {
      // canvas text drawn before the web font arrived is drawn again once it is there
      this.fontHook = () => {
        this.texts?.forEach((x) => !x.destroyed && x.refresh());
        if (!this.disposed) this.atlases.forEach((again) => again()); // v0.23
      };
      document.fonts.addEventListener?.("loadingdone", this.fontHook);
      document.fonts.ready?.then(this.fontHook);
    }
  }
}

/** Shared bits of every drawable: depth, visibility, data. */
class Node2D {
  constructor(stage) {
    this.stage = stage;
    this.mesh = new B.Mesh("n2d", stage.scene);
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;
    this.depth = 0;
    this.visible = true;
    this.data = new Map();
  }
  setDepth(d) {
    this.depth = d;
    this.mesh.alphaIndex = d;
    return this;
  }
  setVisible(v) {
    this.visible = !!v;
    this.mesh.isVisible = this.visible && this._hasContent();
    return this;
  }
  _hasContent() {
    return true;
  }
  setData(k, v) {
    this.data.set(k, v);
    return this;
  }
  getData(k) {
    return this.data.get(k);
  }
  _dirty() {
    this.stage.dirty.add(this);
  }
  destroy() {
    this.stage.dirty.delete(this);
    this.mesh.dispose(false, false);
    this.destroyed = true;
  }
}

// ---- vector graphics ---------------------------------------------------------------------
// v0.23: points live in flat, reused buffers ({ a: Float64Array of x,y pairs, n: point count}), so drawing
// a circle or a line no longer allocates arrays every frame. The geometry is computed as before.
const flat = (size = 256) => ({ a: new Float64Array(size * 2), n: 0 });
/**
 * v0.23: draw only the first `count` indices. The submesh then no longer counts as "global", so it gets the
 * mesh's bounding info (the same one the global submesh used, so the depth sort stays as it was).
 */
function drawRange(mesh, count) {
  const sm = mesh.subMeshes?.[0];
  if (!sm) return;
  sm.indexCount = count;
  if (!sm._f2dBounds) {
    sm.setBoundingInfo(mesh.getBoundingInfo());
    sm._f2dBounds = true;
  }
}
const PTS = flat(),
  LEFT = flat(),
  RIGHT = flat();
function pushPt(buf, x, y) {
  if (buf.n * 2 + 2 > buf.a.length) {
    const a = new Float64Array(buf.a.length * 2);
    a.set(buf.a);
    buf.a = a;
  }
  buf.a[buf.n * 2] = x;
  buf.a[buf.n * 2 + 1] = y;
  buf.n++;
}
const setRgb = (out, color, alpha) => {
  out[0] = ((color >> 16) & 255) / 255;
  out[1] = ((color >> 8) & 255) / 255;
  out[2] = (color & 255) / 255;
  out[3] = alpha;
  return out;
};
export class Graphics extends Node2D {
  constructor(stage) {
    super(stage);
    this.blend = BLEND.NORMAL;
    this.cap = 0;
    this.n = 0;
    this.pos = new Float32Array(0);
    this.col = new Float32Array(0);
    this.fc = [1, 1, 1, 1];
    this.lc = [1, 1, 1, 1];
    this.lw = 1;
    this.grad = null;
    this.path = flat(64);
    this.mesh.material = stage._material("shape", "", this.blend);
    this.mesh.isVisible = false;
  }
  setBlendMode(mode) {
    this.blend = mode;
    this.mesh.material = this.stage._material("shape", "", mode);
    return this;
  }
  _hasContent() {
    return this.n > 0;
  }
  clear() {
    this.n = 0;
    this.path.n = 0;
    this._dirty();
    return this;
  }
  fillStyle(color, alpha = 1) {
    setRgb(this.fc, color, alpha);
    this.grad = null;
    return this;
  }
  lineStyle(width, color, alpha = 1) {
    this.lw = width;
    setRgb(this.lc, color, alpha);
    return this;
  }
  /** Corner colours for the next fills: top-left, top-right, bottom-left, bottom-right. */
  fillGradientStyle(tl, tr, bl, br, alpha = 1) {
    this.grad = [tl, tr, bl, br].map((c) => [...rgbOf(c), alpha]);
    return this;
  }
  _grow(extra) {
    if (this.n + extra <= this.cap) return;
    let cap = Math.max(96, this.cap * 2);
    while (cap < this.n + extra) cap *= 2;
    const pos = new Float32Array(cap * 3),
      col = new Float32Array(cap * 4);
    pos.set(this.pos.subarray(0, this.n * 3));
    col.set(this.col.subarray(0, this.n * 4));
    this.pos = pos;
    this.col = col;
    this.cap = cap;
    this.resized = true;
  }
  _v(x, y, c) {
    const i = this.n++,
      p = this.pos,
      k = this.col;
    p[i * 3] = x;
    p[i * 3 + 1] = -y;
    p[i * 3 + 2] = 0;
    k[i * 4] = c[0];
    k[i * 4 + 1] = c[1];
    k[i * 4 + 2] = c[2];
    k[i * 4 + 3] = c[3];
  }
  _tri(x1, y1, x2, y2, x3, y3, c1, c2 = c1, c3 = c1) {
    this._grow(3);
    this._v(x1, y1, c1);
    this._v(x2, y2, c2);
    this._v(x3, y3, c3);
    this._dirty();
  }
  /** Convex polygon as a fan around its centre. */
  _fillPoly(buf, c) {
    const n = buf.n,
      a = buf.a;
    if (n < 3) return;
    let cx = 0,
      cy = 0;
    for (let i = 0; i < n; i++) {
      cx += a[i * 2];
      cy += a[i * 2 + 1];
    }
    cx /= n;
    cy /= n;
    this._grow(n * 3);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this._v(cx, cy, c);
      this._v(a[i * 2], a[i * 2 + 1], c);
      this._v(a[j * 2], a[j * 2 + 1], c);
    }
    this._dirty();
  }
  /** Polyline of width lw with mitred joins (bevel past a sharp angle). */
  _stroke(buf, closed) {
    const w = this.lw / 2,
      c = this.lc,
      n = buf.n,
      P = buf.a;
    if (n < 2 || w <= 0) return;
    const segs = closed ? n : n - 1;
    // offset points per vertex (left/right), mitred where neighbouring segments meet
    LEFT.n = RIGHT.n = 0;
    for (let i = 0; i < n; i++) {
      const prev = i > 0 ? i - 1 : closed ? n - 1 : -1,
        next = i < n - 1 ? i + 1 : closed ? 0 : -1,
        px = P[i * 2],
        py = P[i * 2 + 1];
      let nx, ny;
      if (prev >= 0 && next >= 0) {
        // normal of prev -> p and of p -> next
        let dx = px - P[prev * 2],
          dy = py - P[prev * 2 + 1],
          l = Math.hypot(dx, dy) || 1;
        const n1x = -dy / l,
          n1y = dx / l;
        dx = P[next * 2] - px;
        dy = P[next * 2 + 1] - py;
        l = Math.hypot(dx, dy) || 1;
        const n2x = -dy / l,
          n2y = dx / l;
        let mx = n1x + n2x,
          my = n1y + n2y;
        const ml = Math.hypot(mx, my);
        if (ml < 1e-4) {
          mx = n1x;
          my = n1y;
        } else {
          mx /= ml;
          my /= ml;
        }
        const k = 1 / Math.max(0.25, mx * n1x + my * n1y);
        nx = mx * Math.min(k, 4);
        ny = my * Math.min(k, 4);
      } else {
        const a = prev >= 0 ? prev : i,
          b = prev >= 0 ? i : next,
          dx = P[b * 2] - P[a * 2],
          dy = P[b * 2 + 1] - P[a * 2 + 1],
          l = Math.hypot(dx, dy) || 1;
        nx = -dy / l;
        ny = dx / l;
      }
      pushPt(LEFT, px + nx * w, py + ny * w);
      pushPt(RIGHT, px - nx * w, py - ny * w);
    }
    this._grow(segs * 6);
    const L = LEFT.a,
      R = RIGHT.a;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      this._v(L[i * 2], L[i * 2 + 1], c);
      this._v(R[i * 2], R[i * 2 + 1], c);
      this._v(L[j * 2], L[j * 2 + 1], c);
      this._v(L[j * 2], L[j * 2 + 1], c);
      this._v(R[i * 2], R[i * 2 + 1], c);
      this._v(R[j * 2], R[j * 2 + 1], c);
    }
    this._dirty();
  }
  /** Ellipse (or arc) points appended to `buf`. */
  _ellipsePts(buf, x, y, rx, ry, a0 = 0, a1 = Math.PI * 2) {
    const r = Math.max(rx, ry),
      steps = Math.max(10, Math.min(72, Math.round(r * 0.7) + 10)),
      span = a1 - a0,
      count = Math.max(2, Math.ceil((steps * Math.abs(span)) / (Math.PI * 2)));
    const full = Math.abs(span) >= Math.PI * 2 - 1e-6;
    for (let i = 0; i < (full ? count : count + 1); i++) {
      const a = a0 + (span * i) / count;
      pushPt(buf, x + Math.cos(a) * rx, y + Math.sin(a) * ry);
    }
    return buf;
  }
  _roundRectPts(buf, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (r < 0.5) {
      pushPt(buf, x, y);
      pushPt(buf, x + w, y);
      pushPt(buf, x + w, y + h);
      pushPt(buf, x, y + h);
      return buf;
    }
    const seg = Math.max(3, Math.min(10, Math.round(r / 1.5))),
      arc = (cx, cy, from) => {
        for (let i = 0; i <= seg; i++) {
          const a = from + (Math.PI / 2) * (i / seg);
          pushPt(buf, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
      };
    arc(x + w - r, y + r, -Math.PI / 2);
    arc(x + w - r, y + h - r, 0);
    arc(x + r, y + h - r, Math.PI / 2);
    arc(x + r, y + r, Math.PI);
    return buf;
  }
  fillRect(x, y, w, h) {
    if (this.grad) {
      const [tl, tr, bl, br] = this.grad;
      this._tri(x, y, x + w, y, x, y + h, tl, tr, bl);
      this._tri(x + w, y, x + w, y + h, x, y + h, tr, br, bl);
    } else {
      this._tri(x, y, x + w, y, x, y + h, this.fc);
      this._tri(x + w, y, x + w, y + h, x, y + h, this.fc);
    }
    return this;
  }
  fillTriangle(x1, y1, x2, y2, x3, y3) {
    this._tri(x1, y1, x2, y2, x3, y3, this.fc);
    return this;
  }
  fillCircle(x, y, r) {
    PTS.n = 0;
    this._fillPoly(this._ellipsePts(PTS, x, y, r, r), this.fc);
    return this;
  }
  fillEllipse(x, y, w, h) {
    PTS.n = 0;
    this._fillPoly(this._ellipsePts(PTS, x, y, w / 2, h / 2), this.fc);
    return this;
  }
  fillRoundedRect(x, y, w, h, r = 20) {
    PTS.n = 0;
    this._fillPoly(this._roundRectPts(PTS, x, y, w, h, r), this.fc);
    return this;
  }
  strokeRect(x, y, w, h) {
    PTS.n = 0;
    pushPt(PTS, x, y);
    pushPt(PTS, x + w, y);
    pushPt(PTS, x + w, y + h);
    pushPt(PTS, x, y + h);
    this._stroke(PTS, true);
    return this;
  }
  strokeRoundedRect(x, y, w, h, r = 20) {
    PTS.n = 0;
    this._stroke(this._roundRectPts(PTS, x, y, w, h, r), true);
    return this;
  }
  strokeCircle(x, y, r) {
    PTS.n = 0;
    this._stroke(this._ellipsePts(PTS, x, y, r, r), true);
    return this;
  }
  strokeEllipse(x, y, w, h) {
    PTS.n = 0;
    this._stroke(this._ellipsePts(PTS, x, y, w / 2, h / 2), true);
    return this;
  }
  lineBetween(x1, y1, x2, y2) {
    PTS.n = 0;
    pushPt(PTS, x1, y1);
    pushPt(PTS, x2, y2);
    this._stroke(PTS, false);
    return this;
  }
  beginPath() {
    this.path.n = 0;
    return this;
  }
  moveTo(x, y) {
    pushPt(this.path, x, y);
    return this;
  }
  lineTo(x, y) {
    pushPt(this.path, x, y);
    return this;
  }
  arc(x, y, r, start, end) {
    this._ellipsePts(this.path, x, y, r, r, start, end);
    return this;
  }
  strokePath() {
    this._stroke(this.path, false);
    this.path.n = 0;
    return this;
  }
  _flush() {
    const mesh = this.mesh;
    if (this.destroyed) return;
    if (this.n === 0) {
      mesh.isVisible = false;
      return;
    }
    if (this.resized || !this.uploaded) {
      this.uploaded = true;
      mesh.setVerticesData(B.VertexBuffer.PositionKind, this.pos, true, 3);
      mesh.setVerticesData(B.VertexBuffer.ColorKind, this.col, true, 4);
      const idx = new Uint32Array(this.cap);
      for (let i = 0; i < this.cap; i++) idx[i] = i;
      mesh.setIndices(idx, this.cap, true);
      this.resized = false;
    } else {
      // v0.23: only the used vertices go to the GPU ...
      mesh.updateVerticesData(B.VertexBuffer.PositionKind, this.pos.subarray(0, this.n * 3), false, false);
      mesh.updateVerticesData(B.VertexBuffer.ColorKind, this.col.subarray(0, this.n * 4), false, false);
    }
    // ... and only they are drawn (was: the whole capacity, the rest collapsed to nothing)
    drawRange(mesh, this.n);
    mesh.isVisible = this.visible;
  }
}

// ---- images ------------------------------------------------------------------------------
const ROWS = 5;
const QUAD_INDICES = [];
for (let r = 0; r < ROWS - 1; r++) {
  const a = 2 * r;
  QUAD_INDICES.push(a, a + 1, a + 3, a, a + 3, a + 2);
}
export class Image2D extends Node2D {
  constructor(stage, x, y, key, frame) {
    super(stage);
    this.x = x;
    this.y = y;
    this.ox = 0.5;
    this.oy = 0.5;
    this.sx = 1;
    this.sy = 1;
    this.rot = 0;
    this.flipX = false;
    this.tint = [1, 1, 1];
    this.fill = 0;
    this.tintMode = TINT.MULTIPLY;
    this.alpha = 1;
    this.blend = BLEND.NORMAL;
    this.texture = { key: null };
    this.frame = { name: 0 };
    // v0.09: five rows of two vertices, so a figure can bend above its pedestal (attack poses)
    this.pos = new Float32Array(ROWS * 2 * 3);
    this.uvs = new Float32Array(ROWS * 2 * 2);
    this.colors = new Float32Array(ROWS * 2 * 4);
    this.fills = new Float32Array(ROWS * 2);
    this.bend = null;
    this.vs = new Float64Array(ROWS); // v0.23: row positions, reused
    this.mesh.setVerticesData(B.VertexBuffer.PositionKind, this.pos, true, 3);
    this.mesh.setVerticesData(B.VertexBuffer.UVKind, this.uvs, true, 2);
    this.mesh.setVerticesData(B.VertexBuffer.ColorKind, this.colors, true, 4);
    this.mesh.setVerticesData("fill", this.fills, true, 1);
    this.mesh.setIndices(QUAD_INDICES);
    this.setTexture(key, frame);
  }
  get width() {
    return this.stage.frameSize(this.texture.key).w;
  }
  get height() {
    return this.stage.frameSize(this.texture.key).h;
  }
  /** v0.23: the material is looked up only when texture or blend mode change (it was a string key per frame). */
  _useMaterial() {
    this._mk = this.texture.key;
    this._mb = this.blend;
    this.mesh.material = this.stage._material("image", this._mk, this._mb);
  }
  setTexture(key, frame) {
    if (key !== this.texture.key) {
      this._use(key); // v0.23a
      this.texture.key = key;
      this._useMaterial();
    }
    this.frame.name = frame ?? 0;
    this.uvDirty = true;
    this._dirty();
    return this;
  }
  /** v0.23a: keep the stage's list of images per texture key (see _setTexture). */
  _use(key) {
    const users = this.stage.users,
      old = this.texture.key;
    if (old != null) users.get(old)?.delete(this);
    if (key != null) {
      let set = users.get(key);
      if (!set) users.set(key, (set = new Set()));
      set.add(this);
    }
  }
  destroy() {
    this._use(null); // v0.23a
    super.destroy();
  }
  setFrame(frame) {
    this.frame.name = frame;
    this.uvDirty = true;
    this._dirty();
    return this;
  }
  setBlendMode(mode) {
    this.blend = mode;
    this._useMaterial();
    return this;
  }
  setOrigin(ox, oy = ox) {
    if (ox !== this.ox || oy !== this.oy) {
      this.ox = ox;
      this.oy = oy;
      this._dirty();
    }
    return this;
  }
  setPosition(x, y) {
    if (x !== this.x || y !== this.y) {
      this.x = x;
      this.y = y;
      this._dirty();
    }
    return this;
  }
  setScale(sx, sy = sx) {
    if (sx !== this.sx || sy !== this.sy) {
      this.sx = sx;
      this.sy = sy;
      this._dirty();
    }
    return this;
  }
  setDisplaySize(w, h) {
    const f = this.stage.frameSize(this.texture.key);
    return this.setScale(w / f.w, h / f.h);
  }
  setAngle(deg) {
    return this.setRotation((deg * Math.PI) / 180);
  }
  setRotation(rad) {
    if (rad !== this.rot) {
      this.rot = rad;
      this._dirty();
    }
    return this;
  }
  /**
   * v0.09: bend the part of the image above `hinge` (0..1 of the frame height): its top moves
   * `dx` frame pixels sideways (on screen, whatever the flip), growing with height squared, and
   * it is stretched vertically by `sy`. The part below the hinge (the pedestal) stays put.
   */
  setBend(hinge, dx = 0, sy = 1) {
    const b = this.bend;
    if (!hinge || (Math.abs(dx) < 0.01 && Math.abs(sy - 1) < 0.001)) {
      if (b) {
        this.bend = null;
        this.uvDirty = true;
        this._dirty();
      }
      return this;
    }
    if (!b || b.hinge !== hinge || b.dx !== dx || b.sy !== sy) {
      const n = (this.bend = this._bend ||= {}); // v0.23a: one object per image (design variants bend every figure each frame)
      n.hinge = hinge;
      n.dx = dx;
      n.sy = sy;
      this.uvDirty = true;
      this._dirty();
    }
    return this;
  }
  setFlipX(flip) {
    if (!!flip !== this.flipX) {
      this.flipX = !!flip;
      this._dirty();
    }
    return this;
  }
  setTint(color) {
    const r = ((color >> 16) & 255) / 255,
      g = ((color >> 8) & 255) / 255,
      b = (color & 255) / 255,
      t = this.tint;
    if (r !== t[0] || g !== t[1] || b !== t[2]) {
      t[0] = r;
      t[1] = g;
      t[2] = b;
      this.colorDirty = true;
      this._dirty();
    }
    return this;
  }
  clearTint() {
    this.setTintMode(TINT.MULTIPLY);
    return this.setTint(0xffffff);
  }
  setTintMode(mode) {
    const fill = mode === TINT.FILL ? 1 : 0;
    if (fill !== this.fill) {
      this.fill = fill;
      this.colorDirty = true;
      this._dirty();
    }
    this.tintMode = mode;
    return this;
  }
  /** v0.27ztF: partial fill 0..1: blends the figure towards its tint colour (frosty overlay); 0 = plain multiply */
  setTintFill(amount) {
    if (amount !== this.fill) {
      this.fill = amount;
      this.colorDirty = true;
      this._dirty();
    }
    this.tintMode = amount >= 1 ? TINT.FILL : TINT.MULTIPLY;
    return this;
  }
  setAlpha(a) {
    if (a !== this.alpha) {
      this.alpha = a;
      this.colorDirty = true;
      this._dirty();
    }
    return this;
  }
  /** v0.23i: drawn by a sprite batch instead (creeps): the own mesh stays hidden and is not updated. */
  setBatched(on) {
    on = !!on;
    if (this.batched !== on) {
      this.batched = on;
      if (!on) {
        this.uvDirty = true;
        this.colorDirty = true;
      }
      this._dirty();
    }
    return this;
  }
  _flush() {
    if (this.destroyed) return;
    if (this.batched) {
      this.mesh.isVisible = false;
      return;
    }
    const t = this.stage.textures.get(this.texture.key),
      fw = t ? t.fw : 1,
      fh = t ? t.fh : 1,
      sx = this.sx * (this.flipX ? -1 : 1),
      w = fw * sx,
      h = fh * this.sy,
      x0 = -this.ox * w,
      cos = Math.cos(this.rot),
      sin = Math.sin(this.rot),
      bend = this.bend,
      hinge = bend ? bend.hinge : 1,
      // row positions in the frame: three rows up to the hinge, the hinge, the bottom edge
      vs = this.vs;
    vs[0] = 0;
    vs[1] = hinge / 3;
    vs[2] = (2 * hinge) / 3;
    vs[3] = hinge;
    vs[4] = 1;
    for (let r = 0; r < ROWS; r++) {
      const v = vs[r];
      let ly = (v - this.oy) * h,
        shift = 0;
      if (bend && v < hinge) {
        const k = (hinge - v) / hinge;
        ly = (hinge - this.oy) * h - (hinge - v) * h * bend.sy;
        shift = bend.dx * k * k * Math.abs(this.sx);
      }
      for (let c = 0; c < 2; c++) {
        const lx = x0 + c * w + shift,
          i = (2 * r + c) * 3;
        this.pos[i] = this.x + lx * cos - ly * sin;
        this.pos[i + 1] = -(this.y + lx * sin + ly * cos);
      }
    }
    this.mesh.updateVerticesData(B.VertexBuffer.PositionKind, this.pos);
    // v0.23: UVs follow a texture that arrived (or was replaced) after they were set
    if (this.uvDirty || this._uvFor !== t) {
      const [u0, v0, u1, v1] = this.stage._uv(this.texture.key, this.frame.name, SCRATCH_UV);
      for (let r = 0; r < ROWS; r++) {
        const vv = v0 + (v1 - v0) * vs[r];
        this.uvs[r * 4] = u0;
        this.uvs[r * 4 + 1] = vv;
        this.uvs[r * 4 + 2] = u1;
        this.uvs[r * 4 + 3] = vv;
      }
      this.mesh.updateVerticesData(B.VertexBuffer.UVKind, this.uvs);
      this.uvDirty = false;
      this._uvFor = t;
    }
    if (this.colorDirty !== false) {
      const c = this.colors;
      for (let i = 0; i < ROWS * 2; i++) {
        c[i * 4] = this.tint[0];
        c[i * 4 + 1] = this.tint[1];
        c[i * 4 + 2] = this.tint[2];
        c[i * 4 + 3] = this.alpha;
        this.fills[i] = this.fill;
      }
      this.mesh.updateVerticesData(B.VertexBuffer.ColorKind, this.colors);
      this.mesh.updateVerticesData("fill", this.fills);
      this.colorDirty = false;
    }
    // a texture that has not arrived yet draws nothing
    this.mesh.isVisible = this.visible && !!t && this.alpha > 0;
    if (this._mk !== this.texture.key || this._mb !== this.blend) this._useMaterial();
  }
  setVisible(v) {
    this.visible = !!v;
    this._dirty();
    return this;
  }
}

// ---- v0.23: sprite batches ---------------------------------------------------------------
/**
 * Many quads of one texture (or atlas) drawn in a single call: the meadow, the path tiles, level badges.
 * Quads draw in the order they were added; each has its own position, size, origin, rotation, flip,
 * tint, alpha and fill, computed like an Image2D.
 */
export class Sprites2D extends Node2D {
  constructor(stage, key) {
    super(stage);
    this.key = key;
    this.blend = BLEND.NORMAL;
    this.n = 0;
    this.cap = 0;
    this.mesh.material = stage._material("image", key, this.blend);
    this.mesh.isVisible = false;
  }
  _hasContent() {
    return this.n > 0;
  }
  clear() {
    if (this.n) this._dirty();
    this.n = 0;
    return this;
  }
  _grow() {
    if (this.n < this.cap) return;
    const cap = Math.max(16, this.cap * 2),
      grow = (old, k) => {
        const a = new Float32Array(cap * 4 * k);
        if (old) a.set(old);
        return a;
      };
    this.pos = grow(this.pos, 3);
    this.uvs = grow(this.uvs, 2);
    this.colors = grow(this.colors, 4);
    this.fills = grow(this.fills, 1);
    this.cap = cap;
    this.resized = true;
  }
  /**
   * One quad of display size w × h with its origin (ox, oy) at (x, y); `uv` = [u0, v0, u1, v1]
   * (an atlas rect, else the whole texture).
   */
  quad(x, y, w, h, ox = 0.5, oy = 0.5, rot = 0, flipX = false, tint = 0xffffff, alpha = 1, uv = null, fill = 0) {
    this._grow();
    const q = this.n++,
      [u0, v0, u1, v1] = uv || this.stage._uv(this.key, 0, SCRATCH_UV),
      ww = w * (flipX ? -1 : 1),
      x0 = -ox * ww,
      cos = Math.cos(rot),
      sin = Math.sin(rot),
      r = ((tint >> 16) & 255) / 255,
      g = ((tint >> 8) & 255) / 255,
      b = (tint & 255) / 255;
    for (let row = 0; row < 2; row++) {
      const ly = (row - oy) * h;
      for (let c = 0; c < 2; c++) {
        const lx = x0 + c * ww,
          v = q * 4 + row * 2 + c;
        this.pos[v * 3] = x + lx * cos - ly * sin;
        this.pos[v * 3 + 1] = -(y + lx * sin + ly * cos);
        this.pos[v * 3 + 2] = 0;
        this.uvs[v * 2] = c ? u1 : u0;
        this.uvs[v * 2 + 1] = row ? v1 : v0;
        this.colors[v * 4] = r;
        this.colors[v * 4 + 1] = g;
        this.colors[v * 4 + 2] = b;
        this.colors[v * 4 + 3] = alpha;
        this.fills[v] = fill;
      }
    }
    this._dirty();
    return this;
  }
  _flush() {
    const mesh = this.mesh;
    if (this.destroyed) return;
    if (!this.n || !this.stage.hasTexture(this.key)) {
      mesh.isVisible = false;
      return;
    }
    const vn = this.n * 4;
    if (this.resized || !this.uploaded) {
      this.uploaded = true;
      this.resized = false;
      mesh.setVerticesData(B.VertexBuffer.PositionKind, this.pos, true, 3);
      mesh.setVerticesData(B.VertexBuffer.UVKind, this.uvs, true, 2);
      mesh.setVerticesData(B.VertexBuffer.ColorKind, this.colors, true, 4);
      mesh.setVerticesData("fill", this.fills, true, 1);
      const idx = new Uint32Array(this.cap * 6);
      for (let q = 0; q < this.cap; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 3, q * 4, q * 4 + 3, q * 4 + 2], q * 6);
      mesh.setIndices(idx, this.cap * 4, true);
    } else {
      mesh.updateVerticesData(B.VertexBuffer.PositionKind, this.pos.subarray(0, vn * 3), false, false);
      mesh.updateVerticesData(B.VertexBuffer.UVKind, this.uvs.subarray(0, vn * 2), false, false);
      mesh.updateVerticesData(B.VertexBuffer.ColorKind, this.colors.subarray(0, vn * 4), false, false);
      mesh.updateVerticesData("fill", this.fills.subarray(0, vn), false, false);
    }
    drawRange(mesh, this.n * 6);
    mesh.isVisible = this.visible;
  }
}

// ---- text --------------------------------------------------------------------------------
let textId = 0;
export class Text2D extends Image2D {
  constructor(stage, x, y, text, style = {}) {
    const key = "text#" + ++textId;
    super(stage, x, y, key, 0);
    this.key = key;
    this.style = { fontFamily: "sans-serif", fontSize: "16px", color: "#ffffff", stroke: null, strokeThickness: 0, backgroundColor: null, align: "left", ...style };
    this.pad = [0, 0, 0, 0];
    this.text = String(text ?? "");
    this.res = style.resolution || stage.dpr || 1;
    this.textDirty = true;
    this.setOrigin(0, 0);
    this._dirty();
  }
  setText(s) {
    s = String(s ?? "");
    if (s !== this.text) {
      this.text = s;
      this.textDirty = true;
      this._dirty();
    }
    return this;
  }
  _restyle(k, v) {
    if (this.style[k] !== v) {
      this.style[k] = v;
      this.textDirty = true;
      this._dirty();
    }
    return this;
  }
  setColor(c) {
    return this._restyle("color", c);
  }
  setFontSize(px) {
    return this._restyle("fontSize", typeof px === "number" ? px + "px" : px);
  }
  setAlign(a) {
    return this._restyle("align", a);
  }
  /** v0.22j1: outline colour and thickness (Bounty Bonus pop-ups get a thicker one). */
  setStroke(color, thickness) {
    this._restyle("stroke", color);
    return this._restyle("strokeThickness", thickness);
  }
  setBackgroundColor(c) {
    return this._restyle("backgroundColor", c);
  }
  setPadding(l, t = l, r = l, b = t) {
    this.pad = [l, t, r, b];
    this.textDirty = true;
    this._dirty();
    return this;
  }
  /** Re-render after the web font arrived. */
  refresh() {
    this.textDirty = true;
    this._dirty();
  }
  _render() {
    const M = measureText(this.text, this.style, this.pad),
      { w, h } = M,
      canvas = this.canvas || (this.canvas = document.createElement("canvas")),
      r = this.res,
      cw = Math.ceil(w * r),
      ch = Math.ceil(h * r),
      // v0.23: the canvas (and texture) comes in a few sizes, the text sits in its top left corner
      bw = bucket(cw),
      bh = bucket(ch);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    paintText(ctx, M, this.style, this.pad, r);
    // same canvas size: refresh the texture in place; otherwise make a new one (no mipmaps for text)
    const old = this.stage.textures.get(this.key);
    if (old && old.pw === canvas.width && old.ph === canvas.height) old.tex.update(true, true);
    else this.stage.addCanvas(this.key, canvas, 0, 0, { mipmaps: false });
    const t = this.stage.textures.get(this.key);
    // the text is the canvas's top left cw × ch device pixels; display it at CSS size
    t.pw = canvas.width;
    t.ph = canvas.height;
    t.fw = w;
    t.fh = h;
    t.w = w;
    t.h = h;
    t.uvRect = [0, 1, cw / bw, 1 - ch / bh];
    this.texture.key = this.key;
    this._useMaterial();
    this.uvDirty = true;
    this.textDirty = false;
  }
  _flush() {
    if (this.destroyed) return;
    if (this.textDirty) this._render();
    super._flush();
  }
  destroy() {
    super.destroy();
    this.stage.texts?.delete(this);
    this.stage.textures.get(this.key)?.tex.dispose();
    this.stage.textures.delete(this.key);
    for (const [id, m] of this.stage.materials)
      if (id.startsWith(this.key + "|")) {
        m.dispose();
        this.stage.materials.delete(id);
      }
  }
}
