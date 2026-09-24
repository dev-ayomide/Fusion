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
uniform float uClouds, uCloudScale, uTime, uSun, uHill, uMountains, uGrassOn, uSeed, uOpacity;
uniform vec2 uAspect;
uniform vec3 uCam;   // camera offset from its rest pose, normalised by comp height

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32 + uSeed); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 6; i++) { v += a * noise(p); p = m * p; a *= 0.5; } return v; }
float ridge(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { float n = 1.0 - abs(noise(p) * 2.0 - 1.0); v += a * n * n; p *= 2.03; a *= 0.5; } return v; }

void main() {
  vec2 uv = vUv;
  vec2 p = vec2((uv.x - 0.5) * uAspect.x, uv.y - 0.5);
  // --- sky
  float hy = 0.34 + uCam.y * 0.15;                     // horizon line moves with camera tilt
  float sy = clamp((uv.y - hy) / (1.0 - hy), 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(sy, 0.65));
  vec2 sunP = vec2(0.28 * uAspect.x, 0.36) - vec2(uCam.x * 0.05, 0.0);
  float sd = length(p - sunP);
  col += vec3(1.0, 0.96, 0.85) * uSun * (0.55 * exp(-sd * 5.0) + 0.25 * exp(-sd * 1.6));
  // --- clouds: two layers, domain warped, lit from the sun side
  for (int l = 0; l < 2; l++) {
    float fl = float(l);
    float sc = uCloudScale * (1.4 + fl * 1.1);
    vec2 q = vec2(p.x * sc + uTime * (0.012 + fl * 0.008) - uCam.x * (0.08 + fl * 0.06), (p.y + 0.2) * sc * 2.2 + fl * 7.3 - uCam.y * 0.2);
    vec2 w = vec2(fbm(q + vec2(1.7, 9.2)), fbm(q + vec2(8.3, 2.8)));
    float n = fbm(q + 1.6 * w);
    float cover = mix(0.72, 0.38, uClouds);
    float c = smoothstep(cover, cover + 0.22, n) * smoothstep(hy - 0.02, hy + 0.12, uv.y);
    float shade = fbm(q + 1.6 * w + vec2(0.05, -0.08));
    vec3 cloudCol = mix(vec3(0.72, 0.78, 0.88), vec3(1.0), smoothstep(0.25, 0.75, n - shade + 0.5));
    col = mix(col, cloudCol, c * (0.9 - fl * 0.25));
  }
  // --- mountains
  if (uMountains > 0.5) {
    float mx = p.x * 1.6 - uCam.x * 0.12;
    float mh = hy + 0.03 + 0.20 * ridge(vec2(mx, 3.1)) * (0.6 + 0.4 * noise(vec2(mx * 0.3, 1.0)));
    if (uv.y < mh) {
      float t = (mh - uv.y) / 0.25;
      vec3 rock = mix(vec3(0.62, 0.64, 0.66), vec3(0.34, 0.38, 0.40), fbm(vec2(mx * 18.0, uv.y * 30.0)));
      float snow = smoothstep(0.03, 0.0, t) * smoothstep(0.55, 0.75, fbm(vec2(mx * 9.0, uv.y * 14.0)));
      vec3 mcol = mix(rock, vec3(0.96), snow);
      mcol = mix(mcol, uHorizon, 0.35);                     // aerial haze
      mcol *= 0.85 + 0.3 * smoothstep(-0.2, 0.3, fbm(vec2(mx * 5.0 + uv.y * 4.0, 2.0)) - 0.5); // light/shadow facets
      col = mix(col, mcol, smoothstep(0.0, 0.004, mh - uv.y));
    }
  }
  // --- hills (two bands, far → near)
  for (int l = 0; l < 2; l++) {
    float fl = float(l);
    float par = 0.2 + fl * 0.25;
    float hx = p.x * (1.2 + fl * 0.8) - uCam.x * par;
    float hh = hy + uHill * (0.10 - fl * 0.06) + 0.05 * (fbm(vec2(hx, fl * 4.0)) - 0.5);
    if (uv.y < hh) {
      vec3 hc = mix(uHills, uHorizon, 0.45 - fl * 0.3);
      hc *= 0.9 + 0.2 * fbm(vec2(hx * 12.0, uv.y * 20.0));
      col = mix(col, hc, smoothstep(0.0, 0.003, hh - uv.y));
    }
  }
  // --- grass field: perspective streaks, darker and denser toward the camera
  if (uGrassOn > 0.5) {
    float gy = hy - 0.02;
    if (uv.y < gy) {
      float d = (gy - uv.y) / gy;                         // 0 at horizon → 1 at bottom
      float gx = (p.x - uCam.x * (0.4 + d)) / (0.08 + d * 0.9);
      float blades = fbm(vec2(gx * 38.0, uv.y * 3.0 + d * 8.0)) * 0.6 + noise(vec2(gx * 140.0, uv.y * 40.0)) * 0.4;
      vec3 gc = mix(uGrass * 1.25, uGrass * 0.55, d);
      gc *= 0.75 + 0.55 * blades;
      gc = mix(gc, uHorizon, 0.35 * (1.0 - smoothstep(0.0, 0.25, d)));   // haze near horizon
      float edge = smoothstep(0.0, 0.004 + 0.02 * blades, gy - uv.y);
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
      uAspect: { value: new THREE.Vector2(16 / 9, 1) },
      uCam: { value: new THREE.Vector3() },
    },
  });
}
