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
uniform vec2 uSize;
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

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = (vUv - 0.5) * uSize;
  float d;
  if (uEllipse > 0.5) {
    vec2 h = uSize * 0.5;
    d = (length(p / h) - 1.0) * min(h.x, h.y);
  } else {
    d = sdRoundBox(p, uSize * 0.5, min(uRadius, min(uSize.x, uSize.y) * 0.5));
  }
  float aa = max(fwidth(d), 1e-4);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  if (uMapMode == 2) inside = 1.0; // glyph quads carry their own alpha
  vec4 col = vec4(uColor, 1.0);
  if (uMapMode == 1) {
    vec4 t = texture2D(uMap, vUv * uUvScale + uUvOffset);
    col = t;
  } else if (uMapMode == 2) {
    col = vec4(uColor, texture2D(uMap, vUv).a);
  }
  if (uStrokeW > 0.0) {
    float band = 1.0 - smoothstep(-aa, aa, abs(d + uStrokeW * 0.5) - uStrokeW * 0.5);
    col.rgb = mix(col.rgb, uStroke, band);
  }
  float a = col.a * inside * uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(col.rgb, a);
  #include <colorspace_fragment>
}`;

export type QuadMat = THREE.ShaderMaterial & {
  uniforms: {
    uSize: { value: THREE.Vector2 };
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
    },
  }) as QuadMat;
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
  c += (hash(gl_FragCoord.xy) - 0.5) * uNoise * 0.25;
  gl_FragColor = vec4(c, uOpacity);
  #include <colorspace_fragment>
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
