import * as THREE from "three";

/**
 * One material for every flat thing: rounded rects, ellipses, images and glyphs.
 * Shapes are signed-distance fields so edges stay crisp at any zoom and under perspective.
 *   mapMode 0 = solid colour, 1 = image (cover-fit), 2 = alpha mask tinted by uColor
 */
const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uSize;       // shape size (px)
uniform vec2 uQuad;       // mesh size (px) — larger than the shape when a shadow needs room
uniform float uRadius;
uniform float uEllipse;
uniform vec3 uColor;
uniform float uOpacity;
uniform int uMapMode;
uniform sampler2D uMap;
uniform vec2 uUvScale;
uniform vec2 uUvOffset;
uniform vec3 uStroke;
uniform float uStrokeW;
// drop shadow
uniform float uShadowA;
uniform vec2 uShadowOff;
uniform float uShadowBlur;
uniform vec3 uShadowColor;
// frosted glass
uniform float uGlass;
uniform sampler2D uBackdrop;
uniform vec2 uViewport;
uniform vec3 uTint;
uniform float uTintAmt;
uniform float uRim;
// glyph write-on
uniform float uWipe;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float shapeSd(vec2 p) {
  if (uEllipse > 0.5) {
    vec2 h = uSize * 0.5;
    return (length(p / h) - 1.0) * min(h.x, h.y);
  }
  return sdRoundBox(p, uSize * 0.5, min(uRadius, min(uSize.x, uSize.y) * 0.5));
}

void main() {
  vec2 p = (vUv - 0.5) * uQuad;
  vec2 suv = p / uSize + 0.5;           // uv within the shape box
  float d = shapeSd(p);
  float aa = max(fwidth(d), 1e-4);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  vec4 col = vec4(uColor, 1.0);
  if (uMapMode == 1) {
    col = texture2D(uMap, suv * uUvScale + uUvOffset);
  } else if (uMapMode == 2) {
    inside = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
    float a = texture2D(uMap, suv).a;
    if (uWipe > 0.0) a *= 1.0 - smoothstep(1.0 - uWipe - 0.04, 1.0 - uWipe + 0.04, suv.x);
    col = vec4(uColor, a);
  }
  if (uMapMode == 3) col.a = 0.0;   // shadow-only quad
  if (uGlass > 0.5) {
    vec3 bd = texture2D(uBackdrop, gl_FragCoord.xy / uViewport).rgb;
    vec4 content = uMapMode == 1 ? col : vec4(0.0);           // html/image content sits on the glass
    col.rgb = mix(bd * 1.06 + 0.015, uTint, uTintAmt);
    float edge = 1.0 - smoothstep(0.0, 2.2, -d);                 // thin bright rim
    float spec = clamp(dot(normalize(p + 1e-4), vec2(-0.55, 0.83)), 0.0, 1.0);
    col.rgb += uRim * edge * (0.25 + 0.75 * spec);
    col.rgb += uRim * 0.06 * smoothstep(uSize.y * 0.5, -uSize.y * 0.5, p.y); // soft top sheen
    col.rgb = mix(col.rgb, content.rgb, content.a);
    col.a = 1.0;
  }
  if (uStrokeW > 0.0) {
    float band = 1.0 - smoothstep(-aa, aa, abs(d + uStrokeW * 0.5) - uStrokeW * 0.5);
    col.rgb = mix(col.rgb, uStroke, band);
  }
  float a = col.a * inside;
  vec3 rgb = col.rgb;
  if (uShadowA > 0.0) {
    float ds = shapeSd(p - uShadowOff);
    float sb = max(uShadowBlur, 1.0);
    float sa = uShadowA * (1.0 - smoothstep(-sb * 0.5, sb, ds));
    float outA = a + sa * (1.0 - a);
    rgb = (rgb * a + uShadowColor * sa * (1.0 - a)) / max(outA, 1e-4);
    a = outA;
  }
  a *= uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(rgb, a);
  #include <colorspace_fragment>
}`;

export type QuadMat = THREE.ShaderMaterial & {
  uniforms: {
    uSize: { value: THREE.Vector2 };
    uQuad: { value: THREE.Vector2 };
    uRadius: { value: number };
    uEllipse: { value: number };
    uColor: { value: THREE.Color };
    uOpacity: { value: number };
    uMapMode: { value: number };
    uMap: { value: THREE.Texture | null };
    uUvScale: { value: THREE.Vector2 };
    uUvOffset: { value: THREE.Vector2 };
    uStroke: { value: THREE.Color };
    uStrokeW: { value: number };
    uShadowA: { value: number };
    uShadowOff: { value: THREE.Vector2 };
    uShadowBlur: { value: number };
    uShadowColor: { value: THREE.Color };
    uGlass: { value: number };
    uBackdrop: { value: THREE.Texture | null };
    uViewport: { value: THREE.Vector2 };
    uTint: { value: THREE.Color };
    uTintAmt: { value: number };
    uRim: { value: number };
    uWipe: { value: number };
  };
};

export function quadMaterial(): QuadMat {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    uniforms: {
      uSize: { value: new THREE.Vector2(100, 100) },
      uQuad: { value: new THREE.Vector2(100, 100) },
      uRadius: { value: 0 },
      uEllipse: { value: 0 },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 1 },
      uMapMode: { value: 0 },
      uMap: { value: null },
      uUvScale: { value: new THREE.Vector2(1, 1) },
      uUvOffset: { value: new THREE.Vector2(0, 0) },
      uStroke: { value: new THREE.Color(0, 0, 0) },
      uStrokeW: { value: 0 },
      uShadowA: { value: 0 },
      uShadowOff: { value: new THREE.Vector2(0, -20) },
      uShadowBlur: { value: 30 },
      uShadowColor: { value: new THREE.Color(0, 0, 0) },
      uGlass: { value: 0 },
      uBackdrop: { value: null },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uTintAmt: { value: 0.15 },
      uRim: { value: 0.5 },
      uWipe: { value: 0 },
    },
  }) as QuadMat;
}

/** Size a quad mesh for a shape of w×h, growing it so a drop shadow fits. */
export function sizeQuad(mesh: THREE.Mesh, m: QuadMat, w: number, h: number) {
  const u = m.uniforms;
  let pad = 0;
  if (u.uShadowA.value > 0) pad = u.uShadowBlur.value * 1.2 + Math.max(Math.abs(u.uShadowOff.value.x), Math.abs(u.uShadowOff.value.y));
  u.uSize.value.set(w, h);
  u.uQuad.value.set(w + pad * 2, h + pad * 2);
  mesh.scale.set(w + pad * 2, h + pad * 2, 1);
}

/** Cover-fit a texture of aspect `ta` into a quad of aspect `qa`. */
export function coverUv(mat: QuadMat, texW: number, texH: number, w: number, h: number) {
  const ta = texW / texH, qa = w / h;
  if (ta > qa) {
    const s = qa / ta;
    mat.uniforms.uUvScale.value.set(s, 1);
    mat.uniforms.uUvOffset.value.set((1 - s) / 2, 0);
  } else {
    const s = ta / qa;
    mat.uniforms.uUvScale.value.set(1, s);
    mat.uniforms.uUvOffset.value.set(0, (1 - s) / 2);
  }
}

export const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);

/* ------------------------- background gradient ------------------------ */
const bgFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
uniform int uCount;
uniform int uRadial;
uniform float uAngle;
uniform float uNoise;
uniform float uOpacity;
uniform vec2 uAspect;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 ramp(float u) {
  u = clamp(u, 0.0, 1.0);
  if (uCount == 2) return mix(uC0, uC1, u);
  if (uCount == 3) return u < 0.5 ? mix(uC0, uC1, u * 2.0) : mix(uC1, uC2, u * 2.0 - 1.0);
  float s = u * 3.0;
  if (s < 1.0) return mix(uC0, uC1, s);
  if (s < 2.0) return mix(uC1, uC2, s - 1.0);
  return mix(uC2, uC3, s - 2.0);
}
void main() {
  vec2 p = (vUv - 0.5) * uAspect;
  float u;
  if (uRadial == 1) {
    u = length(p) / (0.5 * length(uAspect)) * 1.25;
  } else {
    float a = radians(uAngle);
    vec2 dir = vec2(sin(a), -cos(a));
    float ext = 0.5 * (abs(dir.x) * uAspect.x + abs(dir.y) * uAspect.y);
    u = dot(p, dir) / (2.0 * ext) + 0.5;
  }
  vec3 c = ramp(u);
  gl_FragColor = vec4(c, uOpacity);
  #include <colorspace_fragment>
  // grain in display space so it reads the same in darks and lights
  gl_FragColor.rgb += (hash(gl_FragCoord.xy) - 0.5) * uNoise * 0.35;
}`;

export function gradientMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: bgFrag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uC3: { value: new THREE.Color() },
      uCount: { value: 2 }, uRadial: { value: 0 }, uAngle: { value: 90 }, uNoise: { value: 0 }, uOpacity: { value: 1 },
      uAspect: { value: new THREE.Vector2(16 / 9, 1) },
    },
  });
}
