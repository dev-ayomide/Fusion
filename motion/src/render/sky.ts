import * as THREE from "three";

/**
 * Procedural "photographic" background: sky gradient, domain-warped fbm clouds with self-shadowing,
 * sun glow, snowy mountain ridges, rolling hills and a grass field — each band parallaxes with the
 * camera so a camera move feels like it moves through a landscape. Fully deterministic in time.
 */
const frag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uTop, uHorizon, uHills, uGrass;
uniform float uClouds, uCloudScale, uTime, uSun, uHill, uMountains, uGrassOn, uSeed, uOpacity, uStars, uDrift, uMountainHeight;
uniform vec2 uAspect;
uniform vec3 uCam;   // camera offset from its rest pose, normalised by comp height

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32 + uSeed); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 6; i++) { v += a * noise(p); p = m * p; a *= 0.5; } return v; }
float ridge(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { float n = 1.0 - abs(noise(p) * 2.0 - 1.0); v += a * n * n; p *= 2.03; a *= 0.5; } return v; }

float terr(vec2 q) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { float n = 1.0 - abs(noise(q) * 2.0 - 1.0); v += a * n * n; q = mat2(1.7, 1.1, -1.1, 1.7) * q; a *= 0.5; }
  return v;
}
float mountainH(float x) {
  float v = 0.0, a = 0.55, f = 1.0;
  for (int i = 0; i < 6; i++) { float n = 1.0 - abs(noise(vec2(x * f, 3.1 + float(i))) * 2.0 - 1.0); v += a * n * n * n; f *= 2.1; a *= 0.48; }
  return v * (0.55 + 0.45 * noise(vec2(x * 0.4, 9.0)));
}

void main() {
  vec2 uv = vUv;
  vec2 p = vec2((uv.x - 0.5) * uAspect.x, uv.y - 0.5);
  float hy = 0.34 + uCam.y * 0.15;                      // horizon line moves with camera tilt
  float above = uv.y - hy;
  // --- sky: gradient, brighter and paler toward the horizon, sun bloom
  float sy = clamp(above / (1.0 - hy), 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(sy, 0.55));
  vec2 sunP = vec2(-0.32 * uAspect.x, 0.42) - vec2(uCam.x * 0.05, 0.0);
  float sd = length(p - sunP);
  col += vec3(1.0, 0.96, 0.86) * uSun * (0.35 * exp(-sd * 6.0) + 0.18 * exp(-sd * 1.8));
  // --- stars (night skies): sparse hashed points that twinkle
  if (uStars > 0.0) {
    vec2 g = floor(uv * vec2(uAspect.x, 1.0) * 180.0);
    float h = hash(g + 3.7);
    float tw = 0.6 + 0.4 * sin(uTime * 3.0 + h * 40.0);
    col += vec3(0.9, 0.95, 1.0) * uStars * step(0.994, h) * tw * smoothstep(0.0, 0.2, above);
  }
  // --- clouds on a perspective plane: big and near overhead, small and hazy at the horizon.
  // Cumulus = domain-warped fbm, thresholded, with a density gradient toward the sun for bright
  // tops and grey flat-ish bases.
  if (above > -0.01) {
    float dz = 1.0 / (max(above, 0.0) + 0.09);
    for (int l = 0; l < 2; l++) {
      float fl = float(l);
      float sc = uCloudScale * (0.7 + fl * 0.5);
      vec2 sp = vec2(p.x * dz * 0.42 - uCam.x * (0.5 + fl * 0.4) + uTime * uDrift * (0.025 + fl * 0.02), dz * 0.42 + fl * 5.3 + uSeed * 1.7) * sc;
      vec2 w = vec2(fbm(sp * 0.5 + 3.1), fbm(sp * 0.5 + 7.7));
      vec2 q = sp + 1.1 * w;
      float n = fbm(q) + 0.35 * (fbm(q * 2.3 + 11.0) - 0.5);           // extra small puffs
      float cover = mix(0.66, 0.30, uClouds) + fl * 0.05;
      float dens = smoothstep(cover, cover + 0.07, n);
      dens *= 0.75 + 0.25 * smoothstep(cover, cover + 0.25, n);
      float nb = fbm(q + vec2(0.0, 0.18)) + 0.35 * (fbm((q + vec2(0.0, 0.18)) * 2.3 + 11.0) - 0.5);
      float lit = clamp(0.55 + (n - nb) * 4.0 + (n - cover) * 1.5, 0.0, 1.0);
      vec3 cc = mix(vec3(0.58, 0.64, 0.74), vec3(1.0, 0.995, 0.985), lit);
      cc += vec3(1.0, 0.97, 0.9) * uSun * 0.2 * exp(-length(p - sunP) * 3.0);
      // clouds are lit by the sky they sit in: dark, blue-grey at night, white by day
      float skyL = dot(uTop, vec3(0.2126, 0.7152, 0.0722));
      cc *= mix(uHorizon * 1.6 + 0.04, vec3(1.0), smoothstep(0.02, 0.12, skyL));
      float haze = smoothstep(0.0, 0.14, above);
      cc = mix(uHorizon * 1.05, cc, 0.4 + 0.6 * haze);
      col = mix(col, cc, dens * (0.97 - fl * 0.25) * smoothstep(-0.01, 0.03, above));
    }
  }
  // --- mountains: sharp ridged silhouette; faces lit by slope (sun from the left)
  if (uMountains > 0.5) {
    float mx = p.x * 1.1 - uCam.x * 0.12;
    float h0 = mountainH(mx);
    float mh = hy + 0.02 + 0.30 * uMountainHeight * h0;
    if (uv.y < mh + 0.004) {
      float depth = (mh - uv.y) / 0.16;
      // rock face as a 2D ridged heightfield; its normal is lit by a sun from the upper left
      vec2 q = vec2(mx * 3.2, uv.y * 4.4);
      float c = terr(q), cx = terr(q + vec2(0.012, 0.0)), cy = terr(q + vec2(0.0, 0.012));
      vec3 nrm = normalize(vec3(-(cx - c) * 60.0, -(cy - c) * 60.0, 1.0));
      float light = clamp(dot(nrm, normalize(vec3(-0.65, 0.45, 0.55))), 0.0, 1.0);
      vec3 rock = mix(vec3(0.16, 0.17, 0.18), vec3(0.80, 0.78, 0.73), pow(light, 1.3));
      rock *= 0.9 + 0.2 * noise(q * 30.0);
      float snow = smoothstep(0.22, 0.02, depth) * smoothstep(0.62, 0.85, nrm.y * 0.5 + 0.5 + 0.3 * c);
      vec3 green = mix(vec3(0.14, 0.22, 0.10), vec3(0.36, 0.48, 0.22), light);
      vec3 mcol = mix(rock, green, smoothstep(0.6, 1.1, depth + 0.3 * (c - 0.5)));
      mcol = mix(mcol, vec3(0.96, 0.97, 1.0) * (0.72 + 0.32 * light), snow);
      mcol = mix(mcol, uHorizon, 0.1);
      col = mix(col, mcol, smoothstep(0.0, 0.0025, mh - uv.y));
    }
  }
  // --- hills: two bands, far → near, hazier with distance
  for (int l = 0; l < 2; l++) {
    if (uHill < 0.0) break;
    float fl = float(l);
    float hx = p.x * (1.1 + fl * 0.9) - uCam.x * (0.2 + fl * 0.25);
    float hh = hy + uHill * (0.09 - fl * 0.055) + 0.05 * (fbm(vec2(hx, fl * 4.0)) - 0.5) * (1.0 + uHill);
    if (uv.y < hh) {
      vec3 hc = mix(uHills, uHorizon, 0.5 - fl * 0.3);
      hc *= 0.88 + 0.24 * fbm(vec2(hx * 14.0, uv.y * 24.0));
      col = mix(col, hc, smoothstep(0.0, 0.003, hh - uv.y));
    }
  }
  // --- grass: a perspective field; blades get taller and sharper toward the camera
  if (uGrassOn > 0.5) {
    float gy = hy - 0.012;
    float below = gy - uv.y;
    if (below > -0.03) {
      float dz = 1.0 / (max(below, 0.0) + 0.012);
      float d = clamp(below / gy, 0.0, 1.0);                         // 0 horizon → 1 bottom
      vec2 gp = vec2(p.x * dz * 0.5 - uCam.x * dz * 0.08, dz * 0.4);
      float patches = fbm(gp * 0.08 + 1.3);                           // light/dark meadow patches
      float streak = noise(vec2(gp.x * 6.0, gp.y * 0.6)) * 0.55 + noise(vec2(gp.x * 22.0, gp.y * 2.0)) * 0.45;
      vec3 gc = uGrass * (0.62 + 0.5 * patches) * (0.7 + 0.5 * streak);
      gc = mix(gc, gc * vec3(1.15, 1.1, 0.8), smoothstep(0.4, 0.8, patches) * 0.5); // sunlit, yellower tips
      gc = mix(gc, uHorizon, 0.45 * (1.0 - smoothstep(0.0, 0.18, d)));   // haze near horizon
      // near-camera blades: tall thin strokes rising from the bottom edge
      float bx = uv.x * uAspect.x * 90.0 - uCam.x * 30.0;
      float bid = floor(bx);
      float bh = 0.10 + 0.22 * hash(vec2(bid, 7.0));
      float lean = (hash(vec2(bid, 3.0)) - 0.5) * 0.6 + 0.08 * sin(uTime * 1.3 + bid);
      float fx = fract(bx + lean * (uv.y / bh) * 3.0) - 0.5;
      float blade = step(uv.y, bh) * (1.0 - smoothstep(0.06, 0.14 * (1.0 - uv.y / bh) + 0.06, abs(fx)));
      gc = mix(gc, uGrass * (0.45 + 0.6 * hash(vec2(bid, 1.0))), blade * 0.8 * step(0.35, hash(vec2(bid, 9.0))));
      float edge = smoothstep(-0.002, 0.004 + 0.015 * streak, below);
      col = mix(col, gc, edge);
    }
  }
  gl_FragColor = vec4(col, uOpacity);
  #include <colorspace_fragment>
}`;

export function skyMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: frag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color("#2f7fe0") },
      uHorizon: { value: new THREE.Color("#bcdcf5") },
      uHills: { value: new THREE.Color("#4f8a3c") },
      uGrass: { value: new THREE.Color("#4e9a2e") },
      uClouds: { value: 0.5 },
      uCloudScale: { value: 1 },
      uTime: { value: 0 },
      uSun: { value: 0.6 },
      uHill: { value: 0.25 },
      uMountains: { value: 0 },
      uGrassOn: { value: 0 },
      uSeed: { value: 0 },
      uOpacity: { value: 1 },
      uStars: { value: 0 },
      uDrift: { value: 1 },
      uMountainHeight: { value: 1 },
      uAspect: { value: new THREE.Vector2(16 / 9, 1) },
      uCam: { value: new THREE.Vector3() },
    },
  });
}
