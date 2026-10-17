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

export class Stage {
  constructor(container, { background = "#0b201d", dpr = 1 } = {}) {
    this.dpr = dpr;
    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, { display: "block", width: "100%", height: "100%", touchAction: "none", outline: "none" });
    container.appendChild(this.canvas);
    this.engine = new B.Engine(this.canvas, true, { stencil: false, preserveDrawingBuffer: false, premultipliedAlpha: false, alpha: false, powerPreference: "high-performance" }, false);
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
    this.textures = new Map(); // key -> { tex, w, h, fw, fh, cols, frames, source }
    this.materials = new Map();
    this.dirty = new Set();
    this.shakeUntil = 0;
    this.shakeAmount = 0;
    this.resize();
    this.scene.onBeforeRenderObservable.add(() => {
      for (const o of this.dirty) o._flush();
      this.dirty.clear();
      this._placeCamera();
    });
  }
  get width() {
    return this.canvas.clientWidth || 1;
  }
  get height() {
    return this.canvas.clientHeight || 1;
  }
  resize() {
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
  start(update) {
    const t0 = performance.now();
    let last = t0;
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      update(now - t0, now - last);
      last = now;
      this.scene.render();
    });
  }
  dispose() {
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
    this.canvas.remove();
  }
  // ---- textures -----------------------------------------------------------------------
  hasTexture(key) {
    return this.textures.has(key);
  }
  sourceImage(key) {
    return this.textures.get(key)?.source || null;
  }
  frameSize(key) {
    const t = this.textures.get(key);
    return t ? { w: t.fw, h: t.fh } : { w: 1, h: 1 };
  }
  /** A canvas (or loaded image) as a texture; with frame size it becomes a sprite sheet. */
  addCanvas(key, source, frameWidth = 0, frameHeight = 0) {
    let canvas = source;
    if (!(source instanceof HTMLCanvasElement)) {
      canvas = document.createElement("canvas");
      canvas.width = source.naturalWidth || source.width;
      canvas.height = source.naturalHeight || source.height;
      canvas.getContext("2d").drawImage(source, 0, 0);
    }
    const tex = new B.DynamicTexture("t:" + key, canvas, this.scene, true, B.Texture.TRILINEAR_SAMPLINGMODE);
    tex.wrapU = tex.wrapV = B.Texture.CLAMP_ADDRESSMODE;
    tex.hasAlpha = true;
    tex.update(true, true);
    const w = canvas.width,
      h = canvas.height,
      fw = frameWidth || w,
      fh = frameHeight || h;
    this.textures.get(key)?.tex.dispose();
    this.textures.set(key, { tex, w, h, fw, fh, cols: Math.max(1, Math.floor(w / fw)), source });
    for (const [k, m] of this.materials) if (k.startsWith(key + "|")) m.setTexture("tex", tex);
    return key;
  }
  loadImage(key, url, frameWidth = 0, frameHeight = 0) {
    if (this.textures.has(key)) return Promise.resolve(key);
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(this.addCanvas(key, img, frameWidth, frameHeight));
      img.onerror = () => {
        console.warn("Bild fehlt:", url);
        resolve(null);
      };
      img.src = url;
    });
  }
  /** Frame rectangle in UV space (DynamicTexture is uploaded with invertY). */
  _uv(key, frame) {
    const t = this.textures.get(key);
    if (!t) return [0, 1, 1, 0];
    const i = Math.max(0, frame | 0),
      fx = (i % t.cols) * t.fw,
      fy = Math.floor(i / t.cols) * t.fh;
    return [fx / t.w, 1 - fy / t.h, (fx + t.fw) / t.w, 1 - (fy + t.fh) / t.h];
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
  text(x, y, text, style) {
    const t = new Text2D(this, x, y, text, style);
    (this.texts ||= new Set()).add(t);
    if (!this.fontHook && document.fonts) {
      // canvas text drawn before the web font arrived is drawn again once it is there
      this.fontHook = () => this.texts.forEach((x) => !x.destroyed && x.refresh());
      document.fonts.addEventListener?.("loadingdone", this.fontHook);
      document.fonts.ready?.then(this.fontHook);
    }
    return t;
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
    this.path = [];
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
    this.path = [];
    this._dirty();
    return this;
  }
  fillStyle(color, alpha = 1) {
    this.fc = [...rgbOf(color), alpha];
    this.grad = null;
    return this;
  }
  lineStyle(width, color, alpha = 1) {
    this.lw = width;
    this.lc = [...rgbOf(color), alpha];
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
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = -y;
    this.pos[i * 3 + 2] = 0;
    this.col.set(c, i * 4);
  }
  _tri(x1, y1, x2, y2, x3, y3, c1, c2 = c1, c3 = c1) {
    this._grow(3);
    this._v(x1, y1, c1);
    this._v(x2, y2, c2);
    this._v(x3, y3, c3);
    this._dirty();
  }
  /** Convex polygon as a fan around its centre. */
  _fillPoly(pts, c) {
    if (pts.length < 3) return;
    let cx = 0,
      cy = 0;
    for (const p of pts) {
      cx += p[0];
      cy += p[1];
    }
    cx /= pts.length;
    cy /= pts.length;
    this._grow(pts.length * 3);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i],
        b = pts[(i + 1) % pts.length];
      this._v(cx, cy, c);
      this._v(a[0], a[1], c);
      this._v(b[0], b[1], c);
    }
    this._dirty();
  }
  /** Polyline of width lw with mitred joins (bevel past a sharp angle). */
  _stroke(pts, closed) {
    const w = this.lw / 2,
      c = this.lc;
    if (pts.length < 2 || w <= 0) return;
    const n = pts.length,
      segs = closed ? n : n - 1;
    const normal = (a, b) => {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        l = Math.hypot(dx, dy) || 1;
      return [-dy / l, dx / l];
    };
    // offset points per vertex (left/right), mitred where neighbouring segments meet
    const left = [],
      right = [];
    for (let i = 0; i < n; i++) {
      const prev = i > 0 ? pts[i - 1] : closed ? pts[n - 1] : null,
        next = i < n - 1 ? pts[i + 1] : closed ? pts[0] : null,
        p = pts[i];
      let nx, ny;
      if (prev && next) {
        const n1 = normal(prev, p),
          n2 = normal(p, next);
        let mx = n1[0] + n2[0],
          my = n1[1] + n2[1];
        const ml = Math.hypot(mx, my);
        if (ml < 1e-4) [mx, my] = n1;
        else {
          mx /= ml;
          my /= ml;
        }
        const k = 1 / Math.max(0.25, mx * n1[0] + my * n1[1]);
        nx = mx * Math.min(k, 4);
        ny = my * Math.min(k, 4);
      } else [nx, ny] = prev ? normal(prev, p) : normal(p, next);
      left.push([p[0] + nx * w, p[1] + ny * w]);
      right.push([p[0] - nx * w, p[1] - ny * w]);
    }
    this._grow(segs * 6);
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      const a = left[i],
        b = right[i],
        d = left[j],
        e = right[j];
      this._v(a[0], a[1], c);
      this._v(b[0], b[1], c);
      this._v(d[0], d[1], c);
      this._v(d[0], d[1], c);
      this._v(b[0], b[1], c);
      this._v(e[0], e[1], c);
    }
    this._dirty();
  }
  _ellipsePts(x, y, rx, ry, a0 = 0, a1 = Math.PI * 2) {
    const r = Math.max(rx, ry),
      steps = Math.max(10, Math.min(72, Math.round(r * 0.7) + 10)),
      span = a1 - a0,
      count = Math.max(2, Math.ceil((steps * Math.abs(span)) / (Math.PI * 2))),
      pts = [];
    const full = Math.abs(span) >= Math.PI * 2 - 1e-6;
    for (let i = 0; i < (full ? count : count + 1); i++) {
      const a = a0 + (span * i) / count;
      pts.push([x + Math.cos(a) * rx, y + Math.sin(a) * ry]);
    }
    return pts;
  }
  _roundRectPts(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (r < 0.5) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    const pts = [],
      seg = Math.max(3, Math.min(10, Math.round(r / 1.5))),
      arc = (cx, cy, from) => {
        for (let i = 0; i <= seg; i++) {
          const a = from + (Math.PI / 2) * (i / seg);
          pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
      };
    arc(x + w - r, y + r, -Math.PI / 2);
    arc(x + w - r, y + h - r, 0);
    arc(x + r, y + h - r, Math.PI / 2);
    arc(x + r, y + r, Math.PI);
    return pts;
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
    this._fillPoly(this._ellipsePts(x, y, r, r), this.fc);
    return this;
  }
  fillEllipse(x, y, w, h) {
    this._fillPoly(this._ellipsePts(x, y, w / 2, h / 2), this.fc);
    return this;
  }
  fillRoundedRect(x, y, w, h, r = 20) {
    this._fillPoly(this._roundRectPts(x, y, w, h, r), this.fc);
    return this;
  }
  strokeRect(x, y, w, h) {
    this._stroke([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
    return this;
  }
  strokeRoundedRect(x, y, w, h, r = 20) {
    this._stroke(this._roundRectPts(x, y, w, h, r), true);
    return this;
  }
  strokeCircle(x, y, r) {
    this._stroke(this._ellipsePts(x, y, r, r), true);
    return this;
  }
  strokeEllipse(x, y, w, h) {
    this._stroke(this._ellipsePts(x, y, w / 2, h / 2), true);
    return this;
  }
  lineBetween(x1, y1, x2, y2) {
    this._stroke([[x1, y1], [x2, y2]], false);
    return this;
  }
  beginPath() {
    this.path = [];
    return this;
  }
  moveTo(x, y) {
    this.path.push([x, y]);
    return this;
  }
  lineTo(x, y) {
    this.path.push([x, y]);
    return this;
  }
  arc(x, y, r, start, end) {
    for (const p of this._ellipsePts(x, y, r, r, start, end)) this.path.push(p);
    return this;
  }
  strokePath() {
    this._stroke(this.path, false);
    this.path = [];
    return this;
  }
  _flush() {
    const mesh = this.mesh;
    if (this.destroyed) return;
    if (this.n === 0) {
      mesh.isVisible = false;
      return;
    }
    // shapes from a longer earlier frame collapse to nothing (the whole buffer is drawn)
    if ((this.prevN || 0) > this.n) {
      this.pos.fill(0, this.n * 3, this.prevN * 3);
      this.col.fill(0, this.n * 4, this.prevN * 4);
    }
    this.prevN = this.n;
    if (this.resized || !this.uploaded) {
      this.uploaded = true;
      mesh.setVerticesData(B.VertexBuffer.PositionKind, this.pos, true, 3);
      mesh.setVerticesData(B.VertexBuffer.ColorKind, this.col, true, 4);
      const idx = new Uint32Array(this.cap);
      for (let i = 0; i < this.cap; i++) idx[i] = i;
      mesh.setIndices(idx, this.cap, true);
      this.resized = false;
    } else {
      mesh.updateVerticesData(B.VertexBuffer.PositionKind, this.pos, false, false);
      mesh.updateVerticesData(B.VertexBuffer.ColorKind, this.col, false, false);
    }
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
  setTexture(key, frame) {
    if (key !== this.texture.key) {
      this.texture = { key };
      this.mesh.material = this.stage._material("image", key, this.blend);
    }
    this.frame = { name: frame ?? 0 };
    this.uvDirty = true;
    this._dirty();
    return this;
  }
  setFrame(frame) {
    this.frame = { name: frame };
    this.uvDirty = true;
    this._dirty();
    return this;
  }
  setBlendMode(mode) {
    this.blend = mode;
    this.mesh.material = this.stage._material("image", this.texture.key, mode);
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
      this.bend = { hinge, dx, sy };
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
    const t = rgbOf(color);
    if (t[0] !== this.tint[0] || t[1] !== this.tint[1] || t[2] !== this.tint[2]) {
      this.tint = t;
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
  setAlpha(a) {
    if (a !== this.alpha) {
      this.alpha = a;
      this.colorDirty = true;
      this._dirty();
    }
    return this;
  }
  _flush() {
    if (this.destroyed) return;
    const f = this.stage.frameSize(this.texture.key),
      sx = this.sx * (this.flipX ? -1 : 1),
      w = f.w * sx,
      h = f.h * this.sy,
      x0 = -this.ox * w,
      cos = Math.cos(this.rot),
      sin = Math.sin(this.rot),
      bend = this.bend,
      hinge = bend ? bend.hinge : 1,
      // row positions in the frame: three rows up to the hinge, the hinge, the bottom edge
      vs = [0, hinge / 3, (2 * hinge) / 3, hinge, 1];
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
    if (this.uvDirty) {
      const [u0, v0, u1, v1] = this.stage._uv(this.texture.key, this.frame.name);
      for (let r = 0; r < ROWS; r++) {
        const vv = v0 + (v1 - v0) * vs[r];
        this.uvs.set([u0, vv, u1, vv], r * 4);
      }
      this.mesh.updateVerticesData(B.VertexBuffer.UVKind, this.uvs);
      this.uvDirty = false;
    }
    if (this.colorDirty !== false) {
      for (let i = 0; i < ROWS * 2; i++) {
        this.colors.set([this.tint[0], this.tint[1], this.tint[2], this.alpha], i * 4);
        this.fills[i] = this.fill;
      }
      this.mesh.updateVerticesData(B.VertexBuffer.ColorKind, this.colors);
      this.mesh.updateVerticesData("fill", this.fills);
      this.colorDirty = false;
    }
    // a texture that has not arrived yet draws nothing
    this.mesh.isVisible = this.visible && this.stage.hasTexture(this.texture.key) && this.alpha > 0;
    if (this.mesh.material !== this.stage._material("image", this.texture.key, this.blend)) this.mesh.material = this.stage._material("image", this.texture.key, this.blend);
  }
  setVisible(v) {
    this.visible = !!v;
    this._dirty();
    return this;
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
    const s = this.style,
      size = parseFloat(s.fontSize) || 16,
      font = `${size}px ${s.fontFamily}`,
      lines = this.text.split("\n"),
      stroke = s.stroke ? s.strokeThickness || 0 : 0,
      [pl, pt, pr, pb] = this.pad,
      probe = (Text2D.probe ||= document.createElement("canvas").getContext("2d"));
    probe.font = font;
    const m = probe.measureText("ÉMgy|"),
      ascent = Math.ceil(m.actualBoundingBoxAscent || size * 0.8),
      descent = Math.ceil(m.actualBoundingBoxDescent || size * 0.25),
      lineH = ascent + descent + stroke,
      widths = lines.map((l) => Math.ceil(probe.measureText(l).width));
    const w = Math.max(1, Math.max(...widths) + stroke + pl + pr),
      h = Math.max(1, lineH * lines.length + pt + pb),
      canvas = this.canvas || (this.canvas = document.createElement("canvas")),
      r = this.res;
    canvas.width = Math.ceil(w * r);
    canvas.height = Math.ceil(h * r);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (s.backgroundColor) {
      ctx.fillStyle = cssColor(s.backgroundColor);
      ctx.fillRect(0, 0, w, h);
    }
    ctx.font = font;
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
    // same canvas size: refresh the texture in place; otherwise make a new one
    const old = this.stage.textures.get(this.key);
    if (old && old.pw === canvas.width && old.ph === canvas.height) old.tex.update(true, true);
    else this.stage.addCanvas(this.key, canvas);
    const t = this.stage.textures.get(this.key);
    // the texture is the canvas at device resolution; display it at CSS size
    t.pw = canvas.width;
    t.ph = canvas.height;
    t.fw = w;
    t.fh = h;
    t.w = w;
    t.h = h;
    this.mesh.material = this.stage._material("image", this.key, this.blend);
    this.texture = { key: this.key };
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
