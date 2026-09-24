import * as THREE from "three";

/**
 * Stroke geometry for `path` layers (AE shape stroke + Trim Paths). The polyline is optionally
 * Catmull-Rom smoothed, measured, trimmed to [start, end] of its length, then extruded into a
 * triangle strip with round caps. A per-vertex `side` attribute (-1..1) lets the shader antialias.
 */
export function samplePath(points: [number, number][], smooth: boolean, closed: boolean): THREE.Vector2[] {
  const pts = points.map(([x, y]) => new THREE.Vector2(x, y));
  if (closed) pts.push(pts[0].clone());
  if (!smooth || pts.length < 3) return densify(pts, 6);
  const curve = new THREE.SplineCurve(pts);
  return curve.getSpacedPoints(Math.max(32, pts.length * 24));
}

function densify(pts: THREE.Vector2[], step: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let k = 1; k <= n; k++) out.push(a.clone().lerp(b, k / n));
  }
  return out;
}

export function trim(pts: THREE.Vector2[], start: number, end: number): THREE.Vector2[] {
  if (pts.length < 2) return pts;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const L = cum[cum.length - 1];
  const a = Math.min(start, end) * L, b = Math.max(start, end) * L;
  if (b - a < 1e-3) return [];
  const at = (d: number) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const t = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return pts[i - 1].clone().lerp(pts[i], Math.min(1, Math.max(0, t)));
  };
  const out = [at(a)];
  for (let i = 0; i < pts.length; i++) if (cum[i] > a && cum[i] < b) out.push(pts[i]);
  out.push(at(b));
  return out;
}

/** Triangle strip with round caps. Writes into (and resizes) `geo`. */
export function strokeGeometry(geo: THREE.BufferGeometry, pts: THREE.Vector2[], width: number) {
  const pos: number[] = [], side: number[] = [], idx: number[] = [];
  const hw = width / 2;
  if (pts.length >= 2) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(n - 1, i + 1)];
      const dir = next.clone().sub(prev).normalize();
      const nrm = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(hw);
      pos.push(pts[i].x + nrm.x, pts[i].y + nrm.y, 0, pts[i].x - nrm.x, pts[i].y - nrm.y, 0);
      side.push(1, -1);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    // round caps as fans; side is the normalised distance from the centre
    const cap = (c: THREE.Vector2, d: THREE.Vector2) => {
      const base = pos.length / 3;
      pos.push(c.x, c.y, 0);
      side.push(0);
      const a0 = Math.atan2(d.y, d.x) - Math.PI / 2;
      for (let k = 0; k <= 12; k++) {
        const a = a0 + (Math.PI * k) / 12;
        pos.push(c.x + Math.cos(a) * hw, c.y + Math.sin(a) * hw, 0);
        side.push(1);
        if (k > 0) idx.push(base, base + k, base + k + 1);
      }
    };
    cap(pts[n - 1], pts[n - 1].clone().sub(pts[n - 2]).normalize());
    cap(pts[0], pts[0].clone().sub(pts[1]).normalize());
  }
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("side", new THREE.Float32BufferAttribute(side, 1));
  geo.setIndex(idx);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

/** Area under a line down to baseline y (for chart fills). */
export function fillGeometry(geo: THREE.BufferGeometry, pts: THREE.Vector2[], baseY: number) {
  const pos: number[] = [], fade: number[] = [], idx: number[] = [];
  const top = Math.max(...pts.map((p) => p.y), baseY + 1);
  pts.forEach((p, i) => {
    pos.push(p.x, p.y, 0, p.x, baseY, 0);
    fade.push((p.y - baseY) / (top - baseY), 0);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("side", new THREE.Float32BufferAttribute(fade, 1));
  geo.setIndex(idx);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

export function strokeMaterial(fill = false) {
  return new THREE.ShaderMaterial({
    vertexShader: `attribute float side; varying float vSide; void main(){ vSide = side; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `precision highp float; uniform vec3 uColor; uniform float uOpacity; uniform float uSoft; uniform float uFill; varying float vSide;
      void main(){
        float a;
        if (uFill > 0.5) a = pow(clamp(vSide, 0.0, 1.0), 1.4) * 0.45;
        else { float d = abs(vSide); float aa = max(fwidth(d), 1e-3) + uSoft; a = 1.0 - smoothstep(1.0 - aa, 1.0, d); if (uSoft > 0.0) a *= a; }
        a *= uOpacity; if (a < 0.003) discard;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
    uniforms: { uColor: { value: new THREE.Color("#ffffff") }, uOpacity: { value: 1 }, uSoft: { value: 0 }, uFill: { value: fill ? 1 : 0 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
