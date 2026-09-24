import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { MeshLayer } from "../fmd/schema";

/**
 * 3D objects for `mesh` layers. Geometry is unit-sized (height 1) and scaled by `size` px.
 * Lathe shapes (pear, balloon) get subtle foil creases so reflections break up like the real thing.
 */
const cache = new Map<string, THREE.BufferGeometry>();

function lathe(profile: (y: number) => number, segs = 96, rows = 96, crease = 0): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= rows; i++) {
    const y = i / rows;
    pts.push(new THREE.Vector2(Math.max(0.0005, profile(y)), y - 0.5));
  }
  const g = new THREE.LatheGeometry(pts, segs);
  if (crease > 0) {
    // foil balloon creases: gentle vertical panels + horizontal ripples
    const pos = g.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const a = Math.atan2(v.z, v.x);
      const y = v.y + 0.5;
      const k = 1 + crease * (0.6 * Math.sin(a * 8) * Math.sin(y * Math.PI) + 0.4 * Math.sin(y * 42 + a * 3));
      pos.setXYZ(i, v.x * k, v.y, v.z * k);
    }
    g.computeVertexNormals();
  }
  return g;
}

function latheFromPoints(pts: THREE.Vector2[], segs: number, crease: number): THREE.BufferGeometry {
  const ys = pts.map((p) => p.y);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const norm = pts.map((p) => new THREE.Vector2(Math.max(0.0005, p.x), (p.y - y0) / (y1 - y0)));
  return lathe((y) => {
    let i = 1;
    while (i < norm.length - 1 && norm[i].y < y) i++;
    const a = norm[i - 1], b = norm[i];
    return a.x + (b.x - a.x) * Math.min(1, Math.max(0, (y - a.y) / Math.max(1e-6, b.y - a.y)));
  }, segs, pts.length - 1, crease);
}

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

export function meshGeometry(geom: MeshLayer["geom"]): THREE.BufferGeometry {
  const hit = cache.get(geom);
  if (hit) return hit;
  let g: THREE.BufferGeometry;
  switch (geom) {
    case "sphere":
      g = new THREE.SphereGeometry(0.5, 96, 64);
      break;
    case "box":
      g = new RoundedBoxGeometry(1, 1, 1, 6, 0.12);
      break;
    case "torus":
      g = new THREE.TorusGeometry(0.36, 0.14, 48, 128);
      break;
    case "ring":
      g = new THREE.TorusGeometry(0.44, 0.06, 32, 128);
      break;
    case "cylinder":
      g = new THREE.CylinderGeometry(0.4, 0.4, 1, 96, 1);
      break;
    case "capsule":
      g = new THREE.CapsuleGeometry(0.3, 0.4, 16, 64);
      break;
    case "cone":
      g = new THREE.ConeGeometry(0.45, 1, 96, 1);
      break;
    case "coin": {
      g = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 96, 1);
      g.rotateX(Math.PI / 2);
      break;
    }
    case "balloon":
      g = lathe((y) => 0.44 * Math.pow(Math.sin(Math.PI * Math.min(1, y * 1.02)), 0.72) * (1 - 0.18 * smooth(0.0, 0.25, 0.25 - y)) + (y < 0.05 ? 0.04 * (1 - y / 0.05) : 0), 96, 96, 0.012);
      break;
    case "pear": {
      // hand-drawn silhouette (r, y) through a Catmull-Rom spline: full bulb, soft concave neck,
      // rounded shoulder; the stem is a separate bent cylinder
      const prof: [number, number][] = [
        [0.0, 0], [0.16, 0.012], [0.3, 0.06], [0.4, 0.16], [0.435, 0.28], [0.415, 0.4], [0.35, 0.51],
        [0.27, 0.6], [0.225, 0.69], [0.21, 0.78], [0.18, 0.87], [0.115, 0.945], [0.04, 0.99], [0.0, 1],
      ];
      const curve = new THREE.SplineCurve(prof.map(([r, y]) => new THREE.Vector2(r, y)));
      const body = latheFromPoints(curve.getSpacedPoints(160), 128, 0.006);
      const stem = new THREE.CylinderGeometry(0.014, 0.026, 0.14, 16);
      stem.rotateZ(-0.3);
      stem.translate(0.02, 0.55, 0);
      g = mergeGeoms([body, stem]);
      break;
    }
  }
  cache.set(geom, g);
  return g;
}

function mergeGeoms(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let off = 0;
  for (const g0 of gs) {
    const g = g0.index ? g0 : g0;
    const p = g.attributes.position.array, n = g.attributes.normal.array, u = g.attributes.uv?.array;
    pos.push(...p);
    nor.push(...n);
    for (let i = 0; i < p.length / 3; i++) uv.push(u ? u[i * 2] : 0, u ? u[i * 2 + 1] : 0);
    const index = g.index ? Array.from(g.index.array) : Array.from({ length: p.length / 3 }, (_, i) => i);
    idx.push(...index.map((i) => i + off));
    off += p.length / 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/** PBR presets tuned to look right under a studio/sky HDRI. */
export function applyMaterial(m: THREE.MeshPhysicalMaterial, preset: MeshLayer["material"], color: string, roughness?: number, metalness?: number) {
  m.color.set(color);
  m.emissive.set(0x000000);
  m.emissiveIntensity = 0;
  m.transmission = 0;
  m.clearcoat = 0;
  m.iridescence = 0;
  m.envMapIntensity = 1;
  switch (preset) {
    case "chrome":
      m.metalness = 1;
      m.roughness = 0.08;
      m.envMapIntensity = 1.35;
      m.clearcoat = 1;
      m.clearcoatRoughness = 0.05;
      break;
    case "metal":
      m.metalness = 1;
      m.roughness = 0.32;
      break;
    case "gold":
      m.metalness = 1;
      m.roughness = 0.18;
      break;
    case "glass":
      m.metalness = 0;
      m.roughness = 0.04;
      m.transmission = 1;
      m.thickness = 0.4;
      m.ior = 1.45;
      m.iridescence = 0.3;
      break;
    case "plastic":
      m.metalness = 0;
      m.roughness = 0.32;
      m.clearcoat = 0.7;
      m.clearcoatRoughness = 0.15;
      break;
    case "matte":
      m.metalness = 0;
      m.roughness = 0.85;
      break;
    case "clay":
      m.metalness = 0;
      m.roughness = 1;
      break;
    case "emissive":
      m.metalness = 0;
      m.roughness = 0.5;
      m.emissive.set(color);
      m.emissiveIntensity = 2.2;
      break;
  }
  if (roughness !== undefined) m.roughness = roughness;
  if (metalness !== undefined) m.metalness = metalness;
}
