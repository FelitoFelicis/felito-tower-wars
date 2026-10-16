/**
 * 3D core (mobile-3d branch): low-poly figures built in code, one lit vertex-colour shader with
 * per-instance animation, ground decals and camera-facing sprites. Everything is drawn with thin
 * instances, so a whole army of one model costs one draw call.
 *
 * Babylon comes from vendor/babylon-felito.js (a subset build: Engine, Scene, FreeCamera, Mesh,
 * VertexData, ShaderMaterial, textures, maths). No Babylon lights or standard materials are used.
 *
 * Model conventions (see docs/models.md):
 *  - 1 unit = 1 board cell. +Y is up, the figure faces +Z (towards the camera / viewer).
 *  - Tower figures stand on y = 0, which is the top of the round plate the renderer draws.
 *  - Creeps stand on y = 0 (the ground) with their feet; flyers are lifted by the renderer.
 */
export const B = globalThis.BABYLON;

/** Animated parts. Pivots are given as [y, z] of the joint (hip, shoulder, wing root …). */
export const PART = Object.freeze({
  BODY: 0, // static
  LEG_L: 1, // swings forward/back around X at the hip while walking
  LEG_R: 2,
  ARM_L: 3, // swings opposite to the legs
  ARM_R: 4,
  WING_L: 5, // flaps around the Z axis at the wing root height (left = negative x)
  WING_R: 6,
  HEAD: 7, // small bob
  SPIN: 8, // turns around the model's Y axis (x = 0, z = 0); speed from opts.spin (rad/s)
  FLOAT: 9, // hovers up and down
  TAIL: 10, // sways left/right around Y at the pivot z
});

export const PLATE_H = 0.12; // height of the round tower plate; figures stand on it
/** The game draws tower figures this much larger than modelled and leans every figure back towards the camera. */
export const FIG_SCALE = 1.2;
export const FIG_TILT = -0.45;
/** Camera pitch above the horizon used by the game (radians). */
export const CAM_PITCH = 0.98;

// ---------------------------------------------------------------------------------------------
// colours

/** 0xRRGGBB or [r, g, b] (0..1) → [r, g, b] */
export function rgb(c) {
  if (Array.isArray(c)) return c;
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}
/** Mix two 0xRRGGBB colours (t = 0 → a). */
export function mix(a, b, t) {
  const x = rgb(a),
    y = rgb(b);
  return x.map((v, i) => v + (y[i] - v) * t);
}
/** Scale a colour's brightness. */
export function shade(c, k) {
  return rgb(c).map((v) => Math.min(1, v * k));
}
/** Element colours used across the game (plate rims, magic, projectiles). */
export const ELEMENT_COLORS = Object.freeze({
  neutral: 0xd9b45a,
  water: 0x56b8ff,
  fire: 0xff7a2e,
  storm: 0x9a7cff,
  earth: 0xd99a3c,
  arcane: 0xf06ad8,
  plague: 0x8fdc3a,
});

// ---------------------------------------------------------------------------------------------
// geometry builder

const TAU = Math.PI * 2;

/** Rotation matrix (3×3, row-major) for Euler angles applied X, then Y, then Z. */
function rotMatrix(rx = 0, ry = 0, rz = 0) {
  const cx = Math.cos(rx),
    sx = Math.sin(rx),
    cy = Math.cos(ry),
    sy = Math.sin(ry),
    cz = Math.cos(rz),
    sz = Math.sin(rz);
  // R = Rz * Ry * Rx (column vectors)
  return [
    cz * cy,
    cz * sy * sx - sz * cx,
    cz * sy * cx + sz * sx,
    sz * cy,
    sz * sy * sx + cz * cx,
    sz * sy * cx - cz * sx,
    -sy,
    cy * sx,
    cy * cx,
  ];
}

/**
 * A mesh under construction. Every primitive takes an options object:
 *   at:    [x, y, z]  centre of the primitive (default [0, 0, 0])
 *   rot:   [rx, ry, rz] radians, applied X, then Y, then Z
 *   scale: number or [sx, sy, sz], applied before rotation
 *   color: 0xRRGGBB or [r, g, b]
 *   team:  0..1 share of the player's team colour replacing `color`
 *   glow:  0..1 self-lit amount (fire, crystals, eyes, magic)
 *   part:  PART.* for animation, pivot: [y, z] of the joint
 *   spin:  turn speed in rad/s for PART.SPIN (negative turns the other way)
 *   flat:  true for faceted (flat-shaded) surfaces
 */
export class Geo {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
    this.u = [];
    this.u2 = [];
    this.i = [];
  }
  get vertexCount() {
    return this.p.length / 3;
  }
  get triangleCount() {
    return this.i.length / 3;
  }
  /** Append raw local geometry with a transform and attributes. */
  _add(pos, nrm, idx, o = {}) {
    const at = o.at || [0, 0, 0],
      s = typeof o.scale === "number" ? [o.scale, o.scale, o.scale] : o.scale || [1, 1, 1],
      R = rotMatrix(...(o.rot || [0, 0, 0])),
      col = rgb(o.color ?? 0xcccccc),
      team = o.team || 0,
      part = o.part || 0,
      piv = o.pivot || [0, 0],
      glow = o.glow || 0,
      extra = part === PART.SPIN ? (o.spin ?? 1.5) : piv[1];
    const flat = !!o.flat;
    const tp = [],
      tn = [];
    for (let k = 0; k < pos.length; k += 3) {
      const x = pos[k] * s[0],
        y = pos[k + 1] * s[1],
        z = pos[k + 2] * s[2];
      tp.push(R[0] * x + R[1] * y + R[2] * z + at[0], R[3] * x + R[4] * y + R[5] * z + at[1], R[6] * x + R[7] * y + R[8] * z + at[2]);
      let nx = nrm[k] / s[0],
        ny = nrm[k + 1] / s[1],
        nz = nrm[k + 2] / s[2];
      const rx = R[0] * nx + R[1] * ny + R[2] * nz,
        ry = R[3] * nx + R[4] * ny + R[5] * nz,
        rz = R[6] * nx + R[7] * ny + R[8] * nz,
        l = Math.hypot(rx, ry, rz) || 1;
      tn.push(rx / l, ry / l, rz / l);
    }
    const push = (px, py, pz, nx, ny, nz) => {
      this.p.push(px, py, pz);
      this.n.push(nx, ny, nz);
      this.c.push(col[0], col[1], col[2], team);
      this.u.push(part, piv[0]);
      this.u2.push(glow, extra);
    };
    if (flat) {
      for (let k = 0; k < idx.length; k += 3) {
        const a = idx[k] * 3,
          b = idx[k + 1] * 3,
          c = idx[k + 2] * 3;
        const ux = tp[b] - tp[a],
          uy = tp[b + 1] - tp[a + 1],
          uz = tp[b + 2] - tp[a + 2],
          vx = tp[c] - tp[a],
          vy = tp[c + 1] - tp[a + 1],
          vz = tp[c + 2] - tp[a + 2];
        let nx = uy * vz - uz * vy,
          ny = uz * vx - ux * vz,
          nz = ux * vy - uy * vx;
        // keep the face normal pointing the same way as the smooth normals
        const sx = tn[a] + tn[b] + tn[c],
          sy = tn[a + 1] + tn[b + 1] + tn[c + 1],
          sz = tn[a + 2] + tn[b + 2] + tn[c + 2];
        if (nx * sx + ny * sy + nz * sz < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const l = Math.hypot(nx, ny, nz) || 1;
        const base = this.vertexCount;
        for (const v of [a, b, c]) push(tp[v], tp[v + 1], tp[v + 2], nx / l, ny / l, nz / l);
        this.i.push(base, base + 1, base + 2);
      }
    } else {
      const base = this.vertexCount;
      for (let k = 0; k < tp.length; k += 3) push(tp[k], tp[k + 1], tp[k + 2], tn[k], tn[k + 1], tn[k + 2]);
      for (const v of idx) this.i.push(base + v);
    }
    return this;
  }

  /** Axis-aligned box, w × h × d. */
  box(w, h, d, o = {}) {
    const x = w / 2,
      y = h / 2,
      z = d / 2,
      pos = [],
      nrm = [],
      idx = [];
    const face = (n, a, b, c, dd) => {
      const k = pos.length / 3;
      pos.push(...a, ...b, ...c, ...dd);
      for (let i = 0; i < 4; i++) nrm.push(...n);
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    };
    face([0, 0, 1], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]);
    face([0, 0, -1], [x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]);
    face([1, 0, 0], [x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]);
    face([-1, 0, 0], [-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]);
    face([0, 1, 0], [-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]);
    face([0, -1, 0], [-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]);
    return this._add(pos, nrm, idx, o);
  }

  /** Box with bevelled (rounded-looking) edges: a box plus a chamfer of size b. */
  roundBox(w, h, d, b, o = {}) {
    b = Math.min(b, w / 2.01, h / 2.01, d / 2.01);
    const pts = [];
    // 8 corner groups of 3 points each give a chamfered box via a convex hull-like layout
    const X = w / 2,
      Y = h / 2,
      Z = d / 2;
    const P = (sx, sy, sz) => [
      [sx * (X - b), sy * Y, sz * (Z - b)],
      [sx * X, sy * (Y - b), sz * (Z - b)],
      [sx * (X - b), sy * (Y - b), sz * Z],
    ];
    const signs = [-1, 1];
    const corner = {};
    for (const sx of signs) for (const sy of signs) for (const sz of signs) corner[sx + "," + sy + "," + sz] = P(sx, sy, sz);
    const pos = [],
      nrm = [],
      idx = [];
    const quad = (a, b2, c, d2, n) => {
      const k = pos.length / 3;
      pos.push(...a, ...b2, ...c, ...d2);
      for (let i = 0; i < 4; i++) nrm.push(...n);
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    };
    const tri = (a, b2, c, n) => {
      const k = pos.length / 3;
      pos.push(...a, ...b2, ...c);
      for (let i = 0; i < 3; i++) nrm.push(...n);
      idx.push(k, k + 1, k + 2);
    };
    const C = (sx, sy, sz, i) => corner[sx + "," + sy + "," + sz][i];
    // main faces
    for (const sy of signs) quad(C(-1, sy, -1, 0), C(1, sy, -1, 0), C(1, sy, 1, 0), C(-1, sy, 1, 0), [0, sy, 0]);
    for (const sx of signs) quad(C(sx, -1, -1, 1), C(sx, 1, -1, 1), C(sx, 1, 1, 1), C(sx, -1, 1, 1), [sx, 0, 0]);
    for (const sz of signs) quad(C(-1, -1, sz, 2), C(1, -1, sz, 2), C(1, 1, sz, 2), C(-1, 1, sz, 2), [0, 0, sz]);
    // edge chamfers
    const n2 = (a, b2, c) => {
      const l = Math.hypot(a, b2, c);
      return [a / l, b2 / l, c / l];
    };
    for (const sx of signs)
      for (const sy of signs) quad(C(sx, sy, -1, 0), C(sx, sy, 1, 0), C(sx, sy, 1, 1), C(sx, sy, -1, 1), n2(sx, sy, 0));
    for (const sy of signs)
      for (const sz of signs) quad(C(-1, sy, sz, 0), C(1, sy, sz, 0), C(1, sy, sz, 2), C(-1, sy, sz, 2), n2(0, sy, sz));
    for (const sx of signs)
      for (const sz of signs) quad(C(sx, -1, sz, 1), C(sx, 1, sz, 1), C(sx, 1, sz, 2), C(sx, -1, sz, 2), n2(sx, 0, sz));
    for (const sx of signs) for (const sy of signs) for (const sz of signs) tri(C(sx, sy, sz, 0), C(sx, sy, sz, 1), C(sx, sy, sz, 2), n2(sx, sy, sz));
    return this._add(pos, nrm, idx, o);
  }

  /** UV sphere of radius r (use scale for ellipsoids). opts.seg (10), opts.rings (7), opts.half for a dome (top half), opts.open leaves the dome's base open. */
  sphere(r, o = {}) {
    const seg = o.seg || 10,
      rings = o.rings || 7,
      top = 0,
      bottom = o.half ? Math.ceil(rings / 2) : rings,
      pos = [],
      nrm = [],
      idx = [];
    for (let j = top; j <= bottom; j++) {
      const v = (j / rings) * Math.PI,
        y = Math.cos(v),
        rr = Math.sin(v);
      for (let i = 0; i <= seg; i++) {
        const u = (i / seg) * TAU,
          x = Math.cos(u) * rr,
          z = Math.sin(u) * rr;
        pos.push(x * r, y * r, z * r);
        nrm.push(x, y, z);
      }
    }
    for (let j = 0; j < bottom - top; j++)
      for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i,
          b = a + seg + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    if (o.half && !o.open) {
      // close the dome with a flat bottom
      const k = pos.length / 3;
      pos.push(0, 0, 0);
      nrm.push(0, -1, 0);
      const ring0 = (bottom - top) * (seg + 1);
      for (let i = 0; i <= seg; i++) {
        pos.push(pos[(ring0 + i) * 3], pos[(ring0 + i) * 3 + 1], pos[(ring0 + i) * 3 + 2]);
        nrm.push(0, -1, 0);
      }
      for (let i = 0; i < seg; i++) idx.push(k, k + 1 + i, k + 2 + i);
    }
    return this._add(pos, nrm, idx, o);
  }

  /** Cylinder (or frustum) along Y, centred. rTop = 0 makes a cone. opts.seg (10), opts.open (no caps). */
  cylinder(rTop, rBottom, h, o = {}) {
    const seg = o.seg || 10,
      y0 = -h / 2,
      y1 = h / 2,
      slope = (rBottom - rTop) / h,
      ny = slope / Math.hypot(1, slope),
      nr = 1 / Math.hypot(1, slope),
      pos = [],
      nrm = [],
      idx = [];
    for (let i = 0; i <= seg; i++) {
      const u = (i / seg) * TAU,
        x = Math.cos(u),
        z = Math.sin(u);
      pos.push(x * rBottom, y0, z * rBottom, x * rTop, y1, z * rTop);
      nrm.push(x * nr, ny, z * nr, x * nr, ny, z * nr);
    }
    for (let i = 0; i < seg; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    if (!o.open) {
      for (const [y, r, s] of [
        [y1, rTop, 1],
        [y0, rBottom, -1],
      ]) {
        if (r <= 0) continue;
        const k = pos.length / 3;
        pos.push(0, y, 0);
        nrm.push(0, s, 0);
        for (let i = 0; i <= seg; i++) {
          const u = (i / seg) * TAU;
          pos.push(Math.cos(u) * r, y, Math.sin(u) * r);
          nrm.push(0, s, 0);
        }
        for (let i = 0; i < seg; i++) idx.push(k, k + 1 + i, k + 2 + i);
      }
    }
    return this._add(pos, nrm, idx, o);
  }

  /** Cone with its tip up, centred. */
  cone(r, h, o = {}) {
    return this.cylinder(0, r, h, o);
  }

  /** Torus around the Y axis (lying in the XZ plane). opts.arc (radians, from +X), opts.seg (16), opts.tube (6). */
  torus(R, r, o = {}) {
    const seg = o.seg || 16,
      tube = o.tube || 6,
      arc = o.arc ?? TAU,
      pos = [],
      nrm = [],
      idx = [];
    for (let i = 0; i <= seg; i++) {
      const u = (i / seg) * arc,
        cu = Math.cos(u),
        su = Math.sin(u);
      for (let j = 0; j <= tube; j++) {
        const v = (j / tube) * TAU,
          cv = Math.cos(v),
          sv = Math.sin(v);
        pos.push((R + r * cv) * cu, r * sv, (R + r * cv) * su);
        nrm.push(cv * cu, sv, cv * su);
      }
    }
    for (let i = 0; i < seg; i++)
      for (let j = 0; j < tube; j++) {
        const a = i * (tube + 1) + j,
          b = a + tube + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    return this._add(pos, nrm, idx, o);
  }

  /**
   * Surface of revolution around Y. profile: [[radius, y], …] from bottom to top.
   * opts.seg (10), opts.caps (true: closes ends whose radius > 0).
   */
  lathe(profile, o = {}) {
    const seg = o.seg || 10,
      pos = [],
      nrm = [],
      idx = [];
    const m = profile.length;
    // smooth profile normals
    const pn = profile.map((p, k) => {
      const a = profile[Math.max(0, k - 1)],
        b = profile[Math.min(m - 1, k + 1)];
      const dr = b[0] - a[0],
        dy = b[1] - a[1],
        l = Math.hypot(dr, dy) || 1;
      return [dy / l, -dr / l];
    });
    for (let i = 0; i <= seg; i++) {
      const u = (i / seg) * TAU,
        cu = Math.cos(u),
        su = Math.sin(u);
      for (let k = 0; k < m; k++) {
        pos.push(profile[k][0] * cu, profile[k][1], profile[k][0] * su);
        nrm.push(pn[k][0] * cu, pn[k][1], pn[k][0] * su);
      }
    }
    for (let i = 0; i < seg; i++)
      for (let k = 0; k < m - 1; k++) {
        const a = i * m + k,
          b = a + m;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    if (o.caps !== false)
      for (const [k, s] of [
        [m - 1, 1],
        [0, -1],
      ]) {
        const [r, y] = profile[k];
        if (r <= 1e-4) continue;
        const c = pos.length / 3;
        pos.push(0, y, 0);
        nrm.push(0, s, 0);
        for (let i = 0; i <= seg; i++) {
          const u = (i / seg) * TAU;
          pos.push(Math.cos(u) * r, y, Math.sin(u) * r);
          nrm.push(0, s, 0);
        }
        for (let i = 0; i < seg; i++) idx.push(c, c + 1 + i, c + 2 + i);
      }
    return this._add(pos, nrm, idx, o);
  }

  /** Faceted crystal: a bipyramid of height h, radius r, opts.seg sides (6), opts.mid (0.35: share of h below the girdle). */
  crystal(r, h, o = {}) {
    const seg = o.seg || 6,
      mid = o.mid ?? 0.35,
      yb = -h / 2,
      yg = yb + h * mid,
      yt = h / 2,
      pos = [0, yt, 0, 0, yb, 0],
      nrm = [0, 1, 0, 0, -1, 0],
      idx = [];
    for (let i = 0; i < seg; i++) {
      const u = (i / seg) * TAU;
      pos.push(Math.cos(u) * r, yg, Math.sin(u) * r);
      nrm.push(Math.cos(u), 0, Math.sin(u));
    }
    for (let i = 0; i < seg; i++) {
      const a = 2 + i,
        b = 2 + ((i + 1) % seg);
      idx.push(0, b, a, 1, a, b);
    }
    return this._add(pos, nrm, idx, { flat: true, ...o });
  }

  /** Capsule along Y: a cylinder of length h with half-spheres of radius r on both ends. */
  capsule(r, h, o = {}) {
    const seg = o.seg || 10,
      rings = 4,
      profile = [];
    for (let j = 0; j <= rings; j++) {
      const a = -Math.PI / 2 + (j / rings) * (Math.PI / 2);
      profile.push([Math.cos(a) * r, -h / 2 + Math.sin(a) * r]);
    }
    for (let j = 0; j <= rings; j++) {
      const a = (j / rings) * (Math.PI / 2);
      profile.push([Math.cos(a) * r, h / 2 + Math.sin(a) * r]);
    }
    profile[0][0] = 0;
    profile[profile.length - 1][0] = 0;
    return this.lathe(profile, { seg, caps: false, ...o });
  }

  /**
   * Flat shape extruded along Z: points [[x, y], …] (a simple polygon, best star-shaped around
   * its centroid), depth = thickness. Good for blades, wings, banners, leaves, flames.
   */
  prism(points, depth, o = {}) {
    const n = points.length,
      z = depth / 2,
      cx = points.reduce((s, p) => s + p[0], 0) / n,
      cy = points.reduce((s, p) => s + p[1], 0) / n,
      pos = [],
      nrm = [],
      idx = [];
    // front and back caps as fans around the centroid
    for (const s of [1, -1]) {
      const k = pos.length / 3;
      pos.push(cx, cy, z * s);
      nrm.push(0, 0, s);
      for (const p of points) {
        pos.push(p[0], p[1], z * s);
        nrm.push(0, 0, s);
      }
      for (let i = 0; i < n; i++) idx.push(k, k + 1 + i, k + 1 + ((i + 1) % n));
    }
    // sides
    for (let i = 0; i < n; i++) {
      const a = points[i],
        b = points[(i + 1) % n],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        l = Math.hypot(dx, dy) || 1;
      let nx = dy / l,
        ny = -dx / l;
      // outward: away from the centroid
      const mx = (a[0] + b[0]) / 2 - cx,
        my = (a[1] + b[1]) / 2 - cy;
      if (nx * mx + ny * my < 0) {
        nx = -nx;
        ny = -ny;
      }
      const k = pos.length / 3;
      pos.push(a[0], a[1], z, b[0], b[1], z, b[0], b[1], -z, a[0], a[1], -z);
      for (let j = 0; j < 4; j++) nrm.push(nx, ny, 0);
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    return this._add(pos, nrm, idx, o);
  }

  /** A tube along a polyline of points [[x, y, z], …] with radius r (number or per-point array). */
  tube(points, r, o = {}) {
    const seg = o.seg || 6,
      pos = [],
      nrm = [],
      idx = [],
      m = points.length;
    for (let k = 0; k < m; k++) {
      const a = points[Math.max(0, k - 1)],
        b = points[Math.min(m - 1, k + 1)];
      let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const tl = Math.hypot(...t) || 1;
      t = t.map((v) => v / tl);
      // any vector not parallel to t
      const up = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let n1 = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]];
      const l1 = Math.hypot(...n1);
      n1 = n1.map((v) => v / l1);
      const n2 = [t[1] * n1[2] - t[2] * n1[1], t[2] * n1[0] - t[0] * n1[2], t[0] * n1[1] - t[1] * n1[0]];
      const rr = Array.isArray(r) ? r[k] : r;
      for (let i = 0; i <= seg; i++) {
        const u = (i / seg) * TAU,
          cu = Math.cos(u),
          su = Math.sin(u),
          nx = n1[0] * cu + n2[0] * su,
          ny = n1[1] * cu + n2[1] * su,
          nz = n1[2] * cu + n2[2] * su;
        pos.push(points[k][0] + nx * rr, points[k][1] + ny * rr, points[k][2] + nz * rr);
        nrm.push(nx, ny, nz);
      }
    }
    for (let k = 0; k < m - 1; k++)
      for (let i = 0; i < seg; i++) {
        const a = k * (seg + 1) + i,
          b = a + seg + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    return this._add(pos, nrm, idx, o);
  }

  /** Copy another Geo into this one with an extra transform (at/rot/scale) and optional overrides. */
  merge(other, o = {}) {
    const at = o.at || [0, 0, 0],
      s = typeof o.scale === "number" ? [o.scale, o.scale, o.scale] : o.scale || [1, 1, 1],
      R = rotMatrix(...(o.rot || [0, 0, 0])),
      base = this.vertexCount;
    for (let k = 0; k < other.p.length; k += 3) {
      const x = other.p[k] * s[0],
        y = other.p[k + 1] * s[1],
        z = other.p[k + 2] * s[2];
      this.p.push(R[0] * x + R[1] * y + R[2] * z + at[0], R[3] * x + R[4] * y + R[5] * z + at[1], R[6] * x + R[7] * y + R[8] * z + at[2]);
      let nx = other.n[k] / s[0],
        ny = other.n[k + 1] / s[1],
        nz = other.n[k + 2] / s[2];
      const rx = R[0] * nx + R[1] * ny + R[2] * nz,
        ry = R[3] * nx + R[4] * ny + R[5] * nz,
        rz = R[6] * nx + R[7] * ny + R[8] * nz,
        l = Math.hypot(rx, ry, rz) || 1;
      this.n.push(rx / l, ry / l, rz / l);
    }
    this.c.push(...other.c);
    this.u.push(...other.u);
    this.u2.push(...other.u2);
    for (const v of other.i) this.i.push(base + v);
    return this;
  }

  /** Mirror copy across the YZ plane (x → −x), e.g. to build the right half from the left. */
  mirrored(swapParts = true) {
    const g = new Geo();
    g.p = this.p.map((v, k) => (k % 3 === 0 ? -v : v));
    g.n = this.n.map((v, k) => (k % 3 === 0 ? -v : v));
    g.c = this.c.slice();
    const swap = { [PART.LEG_L]: PART.LEG_R, [PART.LEG_R]: PART.LEG_L, [PART.ARM_L]: PART.ARM_R, [PART.ARM_R]: PART.ARM_L, [PART.WING_L]: PART.WING_R, [PART.WING_R]: PART.WING_L };
    g.u = this.u.map((v, k) => (k % 2 === 0 && swapParts && swap[v] !== undefined ? swap[v] : v));
    g.u2 = this.u2.slice();
    // flip winding to keep faces consistent
    for (let k = 0; k < this.i.length; k += 3) g.i.push(this.i[k], this.i[k + 2], this.i[k + 1]);
    return g;
  }

  /** Bounding box {min:[…], max:[…]}. */
  bounds() {
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < this.p.length; k += 3)
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], this.p[k + a]);
        max[a] = Math.max(max[a], this.p[k + a]);
      }
    return { min, max };
  }

  toVertexData() {
    const vd = new B.VertexData();
    vd.positions = new Float32Array(this.p);
    vd.normals = new Float32Array(this.n);
    vd.colors = new Float32Array(this.c);
    vd.uvs = new Float32Array(this.u);
    vd.uvs2 = new Float32Array(this.u2);
    vd.indices = this.vertexCount > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i);
    return vd;
  }
}

// ---------------------------------------------------------------------------------------------
// model registry

/** key → { build(ctx) → Geo, meta } ; ctx = { tier: 1 | 2 | 3 } */
export const MODELS = new Map();
/**
 * Register a model. meta: { kind: "tower" | "creep" | "prop", height, flying, size (footprint, 1) }.
 * build(ctx) returns a Geo. ctx.tier is 1 (levels 1–2), 2 (levels 3–4) or 3 (level 5 and up):
 * higher tiers may add trims, gold and glow, but keep the same silhouette.
 */
export function defineModel(key, build, meta = {}) {
  MODELS.set(key, { build, meta: { kind: "tower", ...meta } });
}

// ---------------------------------------------------------------------------------------------
// shaders

const S = B.ShaderStore.ShadersStore;

S.k3FigVertexShader = `precision highp float;
attribute vec3 position; attribute vec3 normal; attribute vec4 color; attribute vec2 uv; attribute vec2 uv2;
#ifdef INSTANCES
attribute vec4 world0; attribute vec4 world1; attribute vec4 world2; attribute vec4 world3;
attribute vec4 instA; attribute vec4 instB; attribute vec4 instC;
#endif
uniform mat4 world; uniform mat4 viewProjection; uniform float time;
varying vec3 vN; varying vec3 vCol; varying vec3 vW; varying vec4 vFx; varying vec3 vTint; varying float vY;
vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }
vec3 rotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }
vec3 unpackRGB(float v) { float r = floor(v / 65536.0); float g = floor((v - r * 65536.0) / 256.0); float b = v - r * 65536.0 - g * 256.0; return vec3(r, g, b) / 255.0; }
void main() {
  mat4 W = world;
  vec4 A = vec4(0.0, 0.0, 0.0, 1.0);
  vec4 T = vec4(0.4, 0.6, 1.0, 0.0);
  vec4 C = vec4(16777215.0, 0.0, 0.0, 1.0);
#ifdef INSTANCES
  W = world * mat4(world0, world1, world2, world3);
  A = instA; T = instB; C = instC;
#endif
  vec3 p = position;
  vec3 n = normal;
  float id = floor(uv.x + 0.5);
  float ph = A.x, amp = A.y;
  vec3 piv = vec3(0.0, uv.y, uv2.y);
  if (id == 1.0 || id == 2.0) {
    float a = sin(ph) * 0.65 * amp * (id == 1.0 ? 1.0 : -1.0);
    p = rotX(p - piv, a) + piv; n = rotX(n, a);
  } else if (id == 3.0 || id == 4.0) {
    float a = -sin(ph) * 0.5 * amp * (id == 3.0 ? 1.0 : -1.0);
    p = rotX(p - piv, a) + piv; n = rotX(n, a);
  } else if (id == 5.0 || id == 6.0) {
    float f = sin(time * (3.0 + 6.0 * amp) + ph * 0.37) * (0.35 + 0.25 * amp) + 0.1;
    float a = f * (id == 5.0 ? 1.0 : -1.0);
    vec3 q = vec3(0.0, uv.y, 0.0);
    p = rotZ(p - q, a) + q; n = rotZ(n, a);
  } else if (id == 7.0) {
    p.y += sin(time * 2.1 + ph * 0.3) * 0.006 + abs(sin(ph)) * 0.018 * amp;
  } else if (id == 8.0) {
    float a = time * uv2.y;
    p = rotY(p, a); n = rotY(n, a);
  } else if (id == 9.0) {
    p.y += sin(time * 2.3 + ph * 0.31 + p.x * 3.0) * 0.03;
  } else if (id == 10.0) {
    float a = sin(time * 3.0 + ph * 0.5) * 0.22;
    vec3 q = vec3(0.0, 0.0, uv2.y);
    p = rotY(p - q, a) + q; n = rotY(n, a);
  }
  // walk bob, attack lean (towards +z) and stretch above the feet
  float h = max(p.y, 0.0);
  p.y = h * A.w + min(p.y, 0.0) + abs(sin(ph)) * 0.035 * amp;
  p.z += A.z * h * h * 0.55;
  vec4 wp = W * vec4(p, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(W) * n);
  vCol = mix(color.rgb, T.rgb, color.a);
  vTint = unpackRGB(C.x);
  vFx = vec4(uv2.x, T.w, C.w, C.y);
  vY = position.y * C.z;
  gl_Position = viewProjection * wp;
}`;

S.k3FigFragmentShader = `precision highp float;
varying vec3 vN; varying vec3 vCol; varying vec3 vW; varying vec4 vFx; varying vec3 vTint; varying float vY;
uniform vec3 lightDir; uniform vec3 eye; uniform vec3 fogColor; uniform vec3 fogRange;
void main() {
  vec3 n = normalize(vN);
  vec3 L = normalize(lightDir);
  vec3 V = normalize(eye - vW);
  if (dot(n, V) < -0.2) n = -n;
  float d = dot(n, L);
  float diff = clamp(d * 0.62 + 0.38, 0.0, 1.0);
  diff = diff * diff;
  vec3 sky = vec3(0.70, 0.76, 0.90), gnd = vec3(0.42, 0.36, 0.30);
  vec3 amb = mix(gnd, sky, n.y * 0.5 + 0.5);
  vec3 base = vCol;
  vec3 col = base * (amb * 0.60 + vec3(1.0, 0.96, 0.86) * diff * 0.80);
  float rim = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0) * 0.22;
  col += rim * vec3(1.0, 0.96, 0.9);
  col += pow(clamp(dot(reflect(-L, n), V), 0.0, 1.0), 20.0) * 0.14;
  col *= mix(0.72, 1.0, clamp(vY * 6.0 + step(vY, 0.0001), 0.0, 1.0));
  col = mix(col, base * 1.2 + 0.1, vFx.x);
  col = mix(col, col * vTint * 1.15, vFx.w);
  col = mix(col, vec3(1.0), vFx.y);
  float fog = clamp((length(vW - eye) - fogRange.x) / (fogRange.y - fogRange.x), 0.0, 1.0);
  col = mix(col, fogColor, fog * fog);
  gl_FragColor = vec4(col, vFx.z);
}`;

// Ground decals: a unit quad in the XZ plane, the shape is drawn in the fragment shader.
S.k3DecalVertexShader = `precision highp float;
attribute vec3 position; attribute vec2 uv;
#ifdef INSTANCES
attribute vec4 world0; attribute vec4 world1; attribute vec4 world2; attribute vec4 world3;
attribute vec4 instA; attribute vec4 instB;
#endif
uniform mat4 world; uniform mat4 viewProjection;
varying vec2 vUV; varying vec4 vColor; varying vec4 vP;
void main() {
  mat4 W = world;
  vec4 A = vec4(1.0), P = vec4(0.0);
#ifdef INSTANCES
  W = world * mat4(world0, world1, world2, world3);
  A = instA; P = instB;
#endif
  vUV = uv; vColor = A; vP = P;
  gl_Position = viewProjection * (W * vec4(position, 1.0));
}`;
S.k3DecalFragmentShader = `precision highp float;
varying vec2 vUV; varying vec4 vColor; varying vec4 vP;
uniform float additive;
float box(vec2 q, vec2 b, float r) { vec2 d = abs(q) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
void main() {
  vec2 q = vUV * 2.0 - 1.0;
  float r = length(q);
  float a = 0.0;
  float shape = floor(vP.x + 0.5);
  float e = max(vP.z, 0.015);
  if (shape == 0.0) { a = pow(clamp(1.0 - r, 0.0, 1.0), 1.3); }
  else if (shape == 1.0) { float t = vP.y; a = smoothstep(1.0 - t - e, 1.0 - t, r) * (1.0 - smoothstep(1.0 - e, 1.0, r)); }
  else if (shape == 2.0) { float dd = box(q, vec2(1.0), vP.y); float border = vP.z; a = (1.0 - smoothstep(-0.02, 0.02, dd)) * mix(vP.w, 1.0, smoothstep(-border - 0.03, -border, dd)); }
  else if (shape == 3.0) { vec2 c = vec2(abs(q.x), q.y); float dd = abs(c.y + c.x * 0.9 - 0.15) - 0.17; a = (1.0 - smoothstep(-0.03, 0.03, dd)) * step(c.x, 0.75) * step(-0.85, q.y) ; }
  else if (shape == 4.0) { float t = vP.z; a = (1.0 - smoothstep(1.0 - 0.02, 1.0, r)) * mix(vP.y, 1.0, smoothstep(1.0 - t - 0.02, 1.0 - t, r)); }
  else if (shape == 5.0) { float t = vP.z; float ang = atan(q.x, -q.y) / 6.2831853 + 0.5; a = smoothstep(1.0 - t - 0.04, 1.0 - t, r) * (1.0 - smoothstep(0.96, 1.0, r)) * step(ang, vP.y); }
  else if (shape == 6.0) { a = pow(clamp(1.0 - r, 0.0, 1.0), 2.0); }
  if (a <= 0.003) discard;
  float alpha = a * vColor.a;
  if (additive > 0.5) gl_FragColor = vec4(vColor.rgb * alpha, 1.0);
  else gl_FragColor = vec4(vColor.rgb, alpha);
}`;

// Camera-facing sprites (particles, glows, sparks): the instance matrix gives centre and size.
S.k3SpriteVertexShader = `precision highp float;
attribute vec3 position; attribute vec2 uv;
#ifdef INSTANCES
attribute vec4 world0; attribute vec4 world1; attribute vec4 world2; attribute vec4 world3;
attribute vec4 instA; attribute vec4 instB;
#endif
uniform mat4 world; uniform mat4 viewProjection; uniform vec3 camRight; uniform vec3 camUp;
varying vec2 vUV; varying vec4 vColor; varying vec4 vP;
void main() {
  vec3 c = vec3(0.0); float s = 1.0;
  vec4 A = vec4(1.0), P = vec4(0.0);
#ifdef INSTANCES
  c = world3.xyz; s = world0.x;
  A = instA; P = instB;
#endif
  float ang = P.y;
  vec2 q = vec2(position.x * cos(ang) - position.y * sin(ang), position.x * sin(ang) + position.y * cos(ang));
  vec3 wp = c + (camRight * q.x + camUp * q.y) * s;
  vUV = uv; vColor = A; vP = P;
  gl_Position = viewProjection * vec4(wp, 1.0);
}`;
S.k3SpriteFragmentShader = `precision highp float;
varying vec2 vUV; varying vec4 vColor; varying vec4 vP;
uniform float additive;
void main() {
  vec2 q = vUV * 2.0 - 1.0;
  float r = length(q);
  float shape = floor(vP.x + 0.5);
  float a = 0.0;
  if (shape == 0.0) a = pow(clamp(1.0 - r, 0.0, 1.0), 2.2);
  else if (shape == 1.0) a = 1.0 - smoothstep(0.75, 1.0, r);
  else if (shape == 2.0) { float x = abs(q.x), y = abs(q.y); a = clamp(1.0 - (x * y * 18.0 + r * 0.9), 0.0, 1.0); a = max(a, pow(clamp(1.0 - r, 0.0, 1.0), 4.0)); }
  else if (shape == 3.0) a = smoothstep(0.62, 0.8, r) * (1.0 - smoothstep(0.85, 1.0, r));
  else if (shape == 4.0) { a = (1.0 - smoothstep(0.55, 0.7, r)); vec3 col = mix(vColor.rgb, vec3(1.0), (1.0 - smoothstep(0.0, 0.45, length(q + vec2(0.25, -0.3)))) * 0.6); if (a <= 0.003) discard; gl_FragColor = vec4(col, a * vColor.a); return; }
  if (a <= 0.003) discard;
  float alpha = a * vColor.a;
  if (additive > 0.5) gl_FragColor = vec4(vColor.rgb * alpha, 1.0);
  else gl_FragColor = vec4(vColor.rgb, alpha);
}`;

// ---------------------------------------------------------------------------------------------
// renderer

const quadData = (plane) => {
  const vd = new B.VertexData();
  vd.positions = plane === "xz" ? new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]) : new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
  vd.uvs = new Float32Array(plane === "xz" ? [0, 1, 1, 1, 1, 0, 0, 0] : [0, 0, 1, 0, 1, 1, 0, 1]);
  vd.normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  vd.indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  return vd;
};

/**
 * A thin-instanced mesh with growable per-instance buffers.
 * begin() → push(matrix, a, b, c) … → end() uploads and sets the count.
 */
export class Batch {
  constructor(scene, name, vertexData, material, extras = ["instA", "instB", "instC"], capacity = 32) {
    this.scene = scene;
    this.engine = scene.getEngine();
    this.mesh = new B.Mesh(name, scene);
    vertexData.applyToMesh(this.mesh, false);
    this.mesh.material = material;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.doNotSyncBoundingInfo = true;
    this.mesh.isPickable = false;
    this.extras = extras;
    this.n = 0;
    this.buffers = [];
    this._alloc(capacity);
  }
  // The Babylon subset has no thin-instance module, so instancing is done by hand: per-instance
  // vertex buffers (divisor 1) on the mesh and forcedInstanceCount for the draw call.
  _alloc(cap) {
    for (const b of this.buffers) b.dispose?.();
    this.cap = cap;
    this.mat = new Float32Array(cap * 16);
    this.ex = this.extras.map(() => new Float32Array(cap * 4));
    const vb0 = new B.VertexBuffer(this.engine, this.mat, "world0", { updatable: true, stride: 16, offset: 0, size: 4, instanced: true });
    this.matBuf = vb0.getWrapperBuffer();
    this.mesh.setVerticesBuffer(vb0);
    for (let k = 1; k < 4; k++) this.mesh.setVerticesBuffer(this.matBuf.createVertexBuffer("world" + k, k * 4, 4));
    this.exBufs = this.extras.map((kind, k) => {
      const vb = new B.VertexBuffer(this.engine, this.ex[k], kind, { updatable: true, stride: 4, size: 4, instanced: true });
      this.mesh.setVerticesBuffer(vb);
      return vb;
    });
    this.buffers = [this.matBuf, ...this.exBufs.map((v) => v.getWrapperBuffer())];
    this.mesh.forcedInstanceCount = 0;
  }
  begin() {
    this.n = 0;
  }
  /** Reserve one instance and return its index (write matrix and extras through the arrays). */
  next() {
    if (this.n >= this.cap) {
      const old = { mat: this.mat, ex: this.ex };
      this._alloc(this.cap * 2);
      this.mat.set(old.mat);
      old.ex.forEach((a, i) => this.ex[i].set(a));
    }
    return this.n++;
  }
  push(m, ...extra) {
    const i = this.next();
    this.mat.set(m, i * 16);
    for (let k = 0; k < extra.length && k < this.ex.length; k++) if (extra[k]) this.ex[k].set(extra[k], i * 4);
    return i;
  }
  end() {
    this.mesh.forcedInstanceCount = this.n;
    this.mesh.isVisible = this.n > 0;
    if (this.n) {
      this.matBuf.updateDirectly(this.mat, 0, this.n);
      this.exBufs.forEach((vb, k) => vb.getWrapperBuffer().updateDirectly(this.ex[k], 0, this.n));
    }
  }
  dispose() {
    for (const b of this.buffers) b.dispose?.();
    this.mesh.dispose();
  }
}

/** Write a scale · yaw · translate matrix (Babylon layout) into out at offset o. */
export function composeYaw(out, o, x, y, z, yaw = 0, sx = 1, sy = sx, sz = sx, tilt = 0) {
  const c = Math.cos(yaw),
    s = Math.sin(yaw),
    ct = Math.cos(tilt),
    st = Math.sin(tilt);
  // scale, then yaw around Y, then tilt around the world X axis (negative tilt leans back)
  out[o] = sx * c;
  out[o + 1] = sx * s * st;
  out[o + 2] = -sx * s * ct;
  out[o + 3] = 0;
  out[o + 4] = 0;
  out[o + 5] = sy * ct;
  out[o + 6] = sy * st;
  out[o + 7] = 0;
  out[o + 8] = sz * s;
  out[o + 9] = -sz * c * st;
  out[o + 10] = sz * c * ct;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
  return out;
}
/** Matrix whose local +Z points along dir (for arrows, beams). */
export function composeDir(out, o, x, y, z, dx, dy, dz, sx = 1, sy = sx, sz = sx) {
  let l = Math.hypot(dx, dy, dz) || 1;
  const f = [dx / l, dy / l, dz / l];
  const up = Math.abs(f[1]) > 0.98 ? [1, 0, 0] : [0, 1, 0];
  let r = [up[1] * f[2] - up[2] * f[1], up[2] * f[0] - up[0] * f[2], up[0] * f[1] - up[1] * f[0]];
  l = Math.hypot(...r) || 1;
  r = r.map((v) => v / l);
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  out.set([r[0] * sx, r[1] * sx, r[2] * sx, 0, u[0] * sy, u[1] * sy, u[2] * sy, 0, f[0] * sz, f[1] * sz, f[2] * sz, 0, x, y, z, 1], o);
  return out;
}
/** Flat matrix for a decal on the ground: centre (x, z), height y, size w × d, yaw. */
export function composeDecal(out, o, x, y, z, w, d = w, yaw = 0) {
  return composeYaw(out, o, x, y, z, yaw, w, 1, d);
}
/** 0xRRGGBB packed as a float for the shader's tint channel. */
export const packRGB = (c) => (Array.isArray(c) ? Math.round(c[0] * 255) * 65536 + Math.round(c[1] * 255) * 256 + Math.round(c[2] * 255) : c & 0xffffff);

/**
 * The 3D view: engine, scene, camera, the three materials and caches for model batches.
 * Coordinates are world units (1 = one board cell).
 */
export class View3D {
  constructor(canvas, { dpr = 1, clear = 0x0b201d } = {}) {
    this.canvas = canvas;
    this.engine = new B.Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false, premultipliedAlpha: false, alpha: false, powerPreference: "high-performance" }, false);
    this.engine.setHardwareScalingLevel(1 / dpr);
    this.scene = new B.Scene(this.engine);
    this.scene.useRightHandedSystem = true;
    this.scene.detachControl?.();
    this.scene.skipPointerMovePicking = true;
    this.scene.skipFrustumClipping = true;
    this.scene.autoClear = true;
    const c = rgb(clear);
    this.scene.clearColor = new B.Color4(c[0], c[1], c[2], 1);
    this.camera = new B.FreeCamera("k3-cam", new B.Vector3(0, 10, 10), this.scene);
    this.camera.inputs?.clear?.();
    this.camera.minZ = 0.2;
    this.camera.maxZ = 120;
    this.camera.fov = 0.62;
    this.time = 0;
    this.lightDir = [-0.45, 0.85, 0.35];
    this.fog = { color: rgb(clear), near: 30, far: 70 };
    this.models = new Map(); // key|tier → Batch
    this.fig = this._figMaterial("k3-fig", false);
    this.figGhost = this._figMaterial("k3-fig-ghost", true);
    this.decal = this._flatMaterial("k3Decal", false);
    this.decalAdd = this._flatMaterial("k3Decal", true);
    this.sprite = this._flatMaterial("k3Sprite", false);
    this.spriteAdd = this._flatMaterial("k3Sprite", true);
    this.decals = new Batch(this.scene, "k3-decals", quadData("xz"), this.decal, ["instA", "instB"], 64);
    this.decalsAdd = new Batch(this.scene, "k3-decals-add", quadData("xz"), this.decalAdd, ["instA", "instB"], 64);
    this.sprites = new Batch(this.scene, "k3-sprites", quadData("xy"), this.sprite, ["instA", "instB"], 64);
    this.spritesAdd = new Batch(this.scene, "k3-sprites-add", quadData("xy"), this.spriteAdd, ["instA", "instB"], 128);
    // draw order: opaque, then decals (ground), then sprites
    this.decals.mesh.alphaIndex = 1;
    this.decalsAdd.mesh.alphaIndex = 2;
    this.sprites.mesh.alphaIndex = 3;
    this.spritesAdd.mesh.alphaIndex = 4;
    this.tmp = new Float32Array(16);
    this.scene.onBeforeRenderObservable.add(() => this._uniforms());
  }
  _figMaterial(name, ghost) {
    const m = new B.ShaderMaterial(
      name,
      this.scene,
      { vertex: "k3Fig", fragment: "k3Fig" },
      {
        attributes: ["position", "normal", "color", "uv", "uv2", "instA", "instB", "instC"],
        uniforms: ["world", "viewProjection", "time", "lightDir", "eye", "fogColor", "fogRange"],
        needAlphaBlending: ghost,
      },
    );
    m.backFaceCulling = false;
    if (ghost) m.disableDepthWrite = false;
    return m;
  }
  _flatMaterial(shader, additive) {
    const m = new B.ShaderMaterial(
      shader + (additive ? "-add" : ""),
      this.scene,
      { vertex: shader, fragment: shader },
      {
        attributes: ["position", "uv", "instA", "instB"],
        uniforms: ["world", "viewProjection", "camRight", "camUp", "additive"],
        needAlphaBlending: true,
      },
    );
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    m.alphaMode = additive ? B.Constants.ALPHA_ONEONE : B.Constants.ALPHA_COMBINE;
    m.setFloat("additive", additive ? 1 : 0);
    return m;
  }
  _uniforms() {
    const cam = this.camera,
      eye = cam.position,
      L = this.lightDir,
      ll = Math.hypot(...L);
    const view = cam.getViewMatrix(),
      m = view.m;
    // camera right / up in world space = rows of the view matrix's rotation part (transposed)
    const right = new B.Vector3(m[0], m[4], m[8]),
      up = new B.Vector3(m[1], m[5], m[9]);
    for (const mat of [this.fig, this.figGhost]) {
      mat.setFloat("time", this.time);
      mat.setVector3("lightDir", new B.Vector3(L[0] / ll, L[1] / ll, L[2] / ll));
      mat.setVector3("eye", eye);
      mat.setColor3("fogColor", new B.Color3(...this.fog.color));
      mat.setVector3("fogRange", new B.Vector3(this.fog.near, this.fog.far, 0));
    }
    for (const mat of [this.sprite, this.spriteAdd]) {
      mat.setVector3("camRight", right);
      mat.setVector3("camUp", up);
    }
  }
  /** Batch for a registered model at a tier (built on first use). ghost: translucent copy. */
  model(key, tier = 1, ghost = false) {
    const id = key + "|" + tier + (ghost ? "|g" : "");
    let b = this.models.get(id);
    if (b) return b;
    const def = MODELS.get(key);
    if (!def) return null;
    let geo;
    try {
      geo = def.build({ tier });
    } catch (err) {
      console.warn("model failed", key, err);
      return null;
    }
    b = new Batch(this.scene, "k3-" + id, geo.toVertexData(), ghost ? this.figGhost : this.fig, ["instA", "instB", "instC"], 8);
    if (ghost) b.mesh.alphaIndex = 5;
    b.meta = def.meta;
    b.triangles = geo.triangleCount;
    this.models.set(id, b);
    return b;
  }
  /** Batch for a raw Geo (static scenery), drawn with the figure shader. */
  geoBatch(id, geo) {
    let b = this.models.get(id);
    if (b) {
      b.dispose();
      this.models.delete(id);
    }
    b = new Batch(this.scene, "k3-" + id, geo.toVertexData(), this.fig, ["instA", "instB", "instC"], 2);
    this.models.set(id, b);
    return b;
  }
  /** Begin a frame for every batch. */
  beginAll() {
    for (const b of this.models.values()) if (!b.static) b.begin();
    for (const b of [this.decals, this.decalsAdd, this.sprites, this.spritesAdd]) b.begin();
  }
  endAll() {
    for (const b of this.models.values()) if (!b.static) b.end();
    for (const b of [this.decals, this.decalsAdd, this.sprites, this.spritesAdd]) b.end();
  }
  /**
   * Add a figure instance.
   * o: { x, y, z, yaw, tilt, scale, sx, sy, sz, phase, walk, lean, stretch, team (0xRRGGBB), flash, tint, tintAmt, alpha, ao }
   */
  figure(batch, o) {
    if (!batch) return;
    const i = batch.next(),
      s = o.scale ?? 1;
    composeYaw(batch.mat, i * 16, o.x || 0, o.y || 0, o.z || 0, o.yaw || 0, o.sx ?? s, o.sy ?? s, o.sz ?? s, o.tilt || 0);
    const A = batch.ex[0],
      T = batch.ex[1],
      C = batch.ex[2],
      k = i * 4;
    A[k] = o.phase || 0;
    A[k + 1] = o.walk || 0;
    A[k + 2] = o.lean || 0;
    A[k + 3] = o.stretch ?? 1;
    const team = rgb(o.team ?? 0x4a8cff);
    T[k] = team[0];
    T[k + 1] = team[1];
    T[k + 2] = team[2];
    T[k + 3] = o.flash || 0;
    C[k] = packRGB(o.tint ?? 0xffffff);
    C[k + 1] = o.tintAmt || 0;
    C[k + 2] = o.ao ?? 1;
    C[k + 3] = o.alpha ?? 1;
  }
  /** Ground decal. shape: 0 blob, 1 ring, 2 rounded square, 3 chevron, 4 disc+edge, 5 arc, 6 glow. */
  decalAt(additive, x, y, z, w, d, yaw, color, alpha, shape, p1 = 0, p2 = 0, p3 = 0) {
    const b = additive ? this.decalsAdd : this.decals,
      i = b.next(),
      c = rgb(color),
      k = i * 4;
    composeDecal(b.mat, i * 16, x, y, z, w, d, yaw);
    b.ex[0][k] = c[0];
    b.ex[0][k + 1] = c[1];
    b.ex[0][k + 2] = c[2];
    b.ex[0][k + 3] = alpha;
    b.ex[1][k] = shape;
    b.ex[1][k + 1] = p1;
    b.ex[1][k + 2] = p2;
    b.ex[1][k + 3] = p3;
  }
  /** Camera-facing sprite. shape: 0 glow, 1 dot, 2 sparkle, 3 ring, 4 shaded ball. */
  spriteAt(additive, x, y, z, size, color, alpha, shape = 0, angle = 0) {
    const b = additive ? this.spritesAdd : this.sprites,
      i = b.next(),
      c = rgb(color),
      k = i * 4;
    composeYaw(b.mat, i * 16, x, y, z, 0, size, size, size);
    b.ex[0][k] = c[0];
    b.ex[0][k + 1] = c[1];
    b.ex[0][k + 2] = c[2];
    b.ex[0][k + 3] = alpha;
    b.ex[1][k] = shape;
    b.ex[1][k + 1] = angle;
    b.ex[1][k + 2] = 0;
    b.ex[1][k + 3] = 0;
  }
  /** Place the camera: look at target from a pitch (radians above the horizon) and distance. */
  look(tx, ty, tz, pitch, dist, yaw = 0) {
    const cp = Math.cos(pitch),
      sp = Math.sin(pitch);
    this.camera.position.set(tx + Math.sin(yaw) * cp * dist, ty + sp * dist, tz + Math.cos(yaw) * cp * dist);
    this.camera.setTarget(new B.Vector3(tx, ty, tz));
  }
  /** World point → CSS pixel position on the canvas ({x, y, depth}). */
  project(x, y, z) {
    const m = this.scene.getTransformMatrix().m,
      cx = m[0] * x + m[4] * y + m[8] * z + m[12],
      cy = m[1] * x + m[5] * y + m[9] * z + m[13],
      cw = m[3] * x + m[7] * y + m[11] * z + m[15],
      w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    return { x: (cx / cw * 0.5 + 0.5) * w, y: (1 - (cy / cw * 0.5 + 0.5)) * h, depth: cw };
  }
  /** CSS pixel → point on the ground plane y = h (or null). */
  unproject(px, py, h = 0) {
    const w = this.canvas.clientWidth,
      hh = this.canvas.clientHeight,
      nx = (px / w) * 2 - 1,
      ny = 1 - (py / hh) * 2;
    const inv = this.scene.getTransformMatrix().clone();
    inv.invert();
    const m = inv.m;
    const t = (x, y, z) => {
      const X = m[0] * x + m[4] * y + m[8] * z + m[12],
        Y = m[1] * x + m[5] * y + m[9] * z + m[13],
        Z = m[2] * x + m[6] * y + m[10] * z + m[14],
        W = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [X / W, Y / W, Z / W];
    };
    const a = t(nx, ny, -1),
      b = t(nx, ny, 1),
      dy = b[1] - a[1];
    if (Math.abs(dy) < 1e-6) return null;
    const k = (h - a[1]) / dy;
    if (k < 0) return null;
    return { x: a[0] + (b[0] - a[0]) * k, z: a[2] + (b[2] - a[2]) * k };
  }
  resize() {
    this.engine.resize();
  }
  render(dt) {
    this.time += dt;
    this.scene.render();
  }
  dispose() {
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}
