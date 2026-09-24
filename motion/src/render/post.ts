import * as THREE from "three";

/**
 * Compositor: the part of the renderer that works on whole images instead of objects.
 * Everything is linear-light, half-float, and premultiplied once it leaves the scene pass.
 *
 *   main (MSAA)  ← scene batches are drawn here in document order
 *   layer (MSAA) ← an isolated layer that needs an effect (blur) before it's composited
 *   accum        ← motion-blur subframes are averaged here
 *   pool         ← scratch targets for blurs, bloom, adjustment layers
 *   final        → exposure / contrast / saturation / bloom / vignette / grain → sRGB canvas
 */

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function mat(frag: string, uniforms: Record<string, THREE.IUniform>, blending: THREE.Blending = THREE.NoBlending, extra: Partial<THREE.ShaderMaterialParameters> = {}) {
  return new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: frag, uniforms, blending, depthTest: false, depthWrite: false, transparent: blending !== THREE.NoBlending, ...extra });
}

export interface PostSettings {
  bloom?: number;
  bloomThreshold?: number;
  exposure?: number;
  contrast?: number;
  saturation?: number;
  vignette?: number;
  grain?: number;
}

export interface AdjustSettings {
  blur: number;
  exposure: number;
  contrast: number;
  saturation: number;
  fade: number;
  fadeColor: THREE.Color;
  opacity: number;
}

export class Compositor {
  w = 1;
  h = 1;
  /** ping-pong pair so adjustment layers can read one and write the other */
  private mains: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private mainIdx = 0;
  layer: THREE.WebGLRenderTarget;
  accum: THREE.WebGLRenderTarget;
  private pool = new Map<string, THREE.WebGLRenderTarget>();
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private m: Record<string, THREE.ShaderMaterial>;

  constructor(public renderer: THREE.WebGLRenderer, msaa = 4) {
    const mk = (samples: number) => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthBuffer: true, stencilBuffer: true, colorSpace: THREE.LinearSRGBColorSpace });
    this.mains = [mk(msaa), mk(msaa)];
    this.layer = mk(msaa);
    this.accum = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), undefined as unknown as THREE.ShaderMaterial);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.m = {
      copy: mat(`uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, vUv); }`, { tSrc: { value: null } }),
      // 4-tap box downsample (bilinear taps at ±0.5 texel of the destination = 16 source texels)
      down: mat(
        `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
         void main(){ vec2 o = uTexel * 0.5;
           gl_FragColor = 0.25 * (texture2D(tSrc, vUv + vec2(-o.x,-o.y)) + texture2D(tSrc, vUv + vec2(o.x,-o.y)) + texture2D(tSrc, vUv + vec2(-o.x,o.y)) + texture2D(tSrc, vUv + vec2(o.x,o.y))); }`,
        { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      ),
      // separable gaussian, weights computed from sigma, bilinear-pair sampling up to 32 texels each side
      gauss: mat(
        `uniform sampler2D tSrc; uniform vec2 uDir; uniform float uSigma; varying vec2 vUv;
         void main(){
           float s = max(uSigma, 0.001);
           vec4 acc = texture2D(tSrc, vUv); float wsum = 1.0;
           for (int i = 1; i <= 16; i++) {
             float x0 = float(2 * i - 1), x1 = float(2 * i);
             if (x0 > 3.0 * s) break;
             float w0 = exp(-x0 * x0 / (2.0 * s * s)), w1 = exp(-x1 * x1 / (2.0 * s * s));
             float w = w0 + w1; float off = (x0 * w0 + x1 * w1) / w;
             acc += w * (texture2D(tSrc, vUv + uDir * off) + texture2D(tSrc, vUv - uDir * off));
             wsum += 2.0 * w;
           }
           gl_FragColor = acc / wsum; }`,
        { tSrc: { value: null }, uDir: { value: new THREE.Vector2() }, uSigma: { value: 1 } },
      ),
      // premultiplied "over" composite
      over: mat(`uniform sampler2D tSrc; uniform float uOpacity; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, vUv) * uOpacity; }`, { tSrc: { value: null }, uOpacity: { value: 1 } }, THREE.CustomBlending, {
        blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      }),
      // additive weighted accumulation (motion blur)
      add: mat(`uniform sampler2D tSrc; uniform float uWeight; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, vUv) * uWeight; }`, { tSrc: { value: null }, uWeight: { value: 1 } }, THREE.CustomBlending, {
        blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
      }),
      adjust: mat(
        `uniform sampler2D tSrc; uniform sampler2D tBlur; uniform float uUseBlur; uniform float uExposure, uContrast, uSaturation, uFade, uOpacity; uniform vec3 uFadeColor; varying vec2 vUv;
         void main(){
           vec4 base = texture2D(tSrc, vUv);
           vec4 c = mix(base, texture2D(tBlur, vUv), uUseBlur);
           c.rgb *= exp2(uExposure);
           c.rgb = (c.rgb - 0.18) * (1.0 + uContrast) + 0.18;
           float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
           c.rgb = mix(vec3(l), c.rgb, 1.0 + uSaturation);
           c.rgb = mix(c.rgb, uFadeColor, uFade);
           gl_FragColor = mix(base, max(c, 0.0), uOpacity); }`,
        { tSrc: { value: null }, tBlur: { value: null }, uUseBlur: { value: 0 }, uExposure: { value: 0 }, uContrast: { value: 0 }, uSaturation: { value: 0 }, uFade: { value: 0 }, uFadeColor: { value: new THREE.Color() }, uOpacity: { value: 1 } },
      ),
      bright: mat(
        `uniform sampler2D tSrc; uniform float uThreshold; varying vec2 vUv;
         void main(){ vec3 c = texture2D(tSrc, vUv).rgb; float l = max(max(c.r, c.g), c.b);
           float k = max(l - uThreshold, 0.0) / max(l, 1e-4); gl_FragColor = vec4(c * k, 1.0); }`,
        { tSrc: { value: null }, uThreshold: { value: 0.8 } },
      ),
      final: mat(
        `uniform sampler2D tSrc; uniform sampler2D tB0; uniform sampler2D tB1; uniform sampler2D tB2; uniform float uBloom;
         uniform float uExposure, uContrast, uSaturation, uVignette, uGrain, uSeed; uniform vec2 uAspect; varying vec2 vUv;
         float hash(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
         void main(){
           vec4 s = texture2D(tSrc, vUv);
           vec3 c = s.rgb;
           if (uBloom > 0.0) c += uBloom * (0.5 * texture2D(tB0, vUv).rgb + 0.35 * texture2D(tB1, vUv).rgb + 0.25 * texture2D(tB2, vUv).rgb);
           c *= exp2(uExposure);
           c = (c - 0.18) * (1.0 + uContrast) + 0.18;
           float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
           c = mix(vec3(l), c, 1.0 + uSaturation);
           vec2 q = (vUv - 0.5) * uAspect;
           c *= mix(1.0, smoothstep(1.25, 0.25, length(q)), uVignette);
           c = max(c, 0.0);
           gl_FragColor = vec4(c, 1.0);
           #include <colorspace_fragment>
           gl_FragColor.rgb += (hash(vec3(gl_FragCoord.xy, uSeed)) - 0.5) * uGrain * 0.12;
         }`,
        { tSrc: { value: null }, tB0: { value: null }, tB1: { value: null }, tB2: { value: null }, uBloom: { value: 0 }, uExposure: { value: 0 }, uContrast: { value: 0 }, uSaturation: { value: 0 }, uVignette: { value: 0 }, uGrain: { value: 0 }, uSeed: { value: 0 }, uAspect: { value: new THREE.Vector2(1.6, 1) } },
      ),
    };
  }

  get main() {
    return this.mains[this.mainIdx];
  }

  resize(w: number, h: number) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.mains.forEach((m) => m.setSize(w, h));
    this.layer.setSize(w, h);
    this.accum.setSize(w, h);
    this.pool.forEach((t) => t.dispose());
    this.pool.clear();
  }

  private rt(key: string, w: number, h: number): THREE.WebGLRenderTarget {
    const k = `${key}:${w}x${h}`;
    let t = this.pool.get(k);
    if (!t) {
      t = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      this.pool.set(k, t);
    }
    return t;
  }

  pass(m: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = m;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  beginMain(clear: THREE.Color) {
    const r = this.renderer;
    r.setRenderTarget(this.main);
    r.setClearColor(clear, 1);
    r.clear(true, true, true);
  }

  beginLayer() {
    const r = this.renderer;
    r.setRenderTarget(this.layer);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
  }

  /**
   * Gaussian blur with `radius` in device pixels. Large radii are blurred at lower resolution
   * (successive 2× box downsamples first), so cost stays roughly constant with radius.
   */
  blur(src: THREE.Texture, radius: number, slot: string): THREE.Texture {
    if (radius < 0.5) return src;
    let w = this.w, h = this.h, level = 0;
    let cur = src;
    while (radius / 2 ** level > 10 && level < 5) {
      w = Math.max(2, Math.ceil(w / 2));
      h = Math.max(2, Math.ceil(h / 2));
      const t = this.rt(`${slot}-d${level}`, w, h);
      this.m.down.uniforms.tSrc.value = cur;
      this.m.down.uniforms.uTexel.value.set(1 / w, 1 / h);
      this.pass(this.m.down, t);
      cur = t.texture;
      level++;
    }
    const sigma = radius / 2 ** level / 2;
    const a = this.rt(`${slot}-a`, w, h), b = this.rt(`${slot}-b`, w, h);
    const g = this.m.gauss;
    g.uniforms.uSigma.value = sigma;
    g.uniforms.tSrc.value = cur;
    g.uniforms.uDir.value.set(1 / w, 0);
    this.pass(g, a);
    g.uniforms.tSrc.value = a.texture;
    g.uniforms.uDir.value.set(0, 1 / h);
    this.pass(g, b);
    return b.texture;
  }

  /** Composite a premultiplied texture over the main target. */
  over(tex: THREE.Texture, opacity = 1) {
    this.m.over.uniforms.tSrc.value = tex;
    this.m.over.uniforms.uOpacity.value = opacity;
    this.pass(this.m.over, this.main);
  }

  /** Adjustment layer: reads main, writes the other main, swaps. */
  adjust(a: AdjustSettings) {
    const src = this.main;
    const dst = this.mains[1 - this.mainIdx];
    const m = this.m.adjust;
    m.uniforms.tSrc.value = src.texture;
    m.uniforms.tBlur.value = a.blur > 0.5 ? this.blur(src.texture, a.blur, "adj") : src.texture;
    m.uniforms.uUseBlur.value = a.blur > 0.5 ? 1 : 0;
    m.uniforms.uExposure.value = a.exposure;
    m.uniforms.uContrast.value = a.contrast;
    m.uniforms.uSaturation.value = a.saturation;
    m.uniforms.uFade.value = a.fade;
    m.uniforms.uFadeColor.value.copy(a.fadeColor);
    m.uniforms.uOpacity.value = a.opacity;
    this.pass(m, dst);
    this.mainIdx = 1 - this.mainIdx;
  }

  clearAccum() {
    this.renderer.setRenderTarget(this.accum);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, false, false);
  }

  accumulate(weight: number) {
    this.m.add.uniforms.tSrc.value = this.main.texture;
    this.m.add.uniforms.uWeight.value = weight;
    this.pass(this.m.add, this.accum);
  }

  /** Grade + bloom + vignette + grain, into the canvas (optionally a sub-rectangle in CSS px). */
  final(src: THREE.Texture, post: PostSettings, seed: number, rect?: { x: number; y: number; w: number; h: number }) {
    const f = this.m.final;
    const bloom = post.bloom ?? 0;
    if (bloom > 0) {
      const hw = Math.max(2, Math.ceil(this.w / 2)), hh = Math.max(2, Math.ceil(this.h / 2));
      const bright = this.rt("bright", hw, hh);
      this.m.bright.uniforms.tSrc.value = src;
      this.m.bright.uniforms.uThreshold.value = post.bloomThreshold ?? 0.85;
      this.pass(this.m.bright, bright);
      const scale = this.h / 1080;
      f.uniforms.tB0.value = this.blurFrom(bright.texture, hw, hh, 6 * scale, "b0");
      f.uniforms.tB1.value = this.blurFrom(bright.texture, hw, hh, 24 * scale, "b1");
      f.uniforms.tB2.value = this.blurFrom(bright.texture, hw, hh, 80 * scale, "b2");
    }
    f.uniforms.tSrc.value = src;
    f.uniforms.uBloom.value = bloom;
    f.uniforms.uExposure.value = post.exposure ?? 0;
    f.uniforms.uContrast.value = post.contrast ?? 0;
    f.uniforms.uSaturation.value = post.saturation ?? 0;
    f.uniforms.uVignette.value = post.vignette ?? 0;
    f.uniforms.uGrain.value = post.grain ?? 0;
    f.uniforms.uSeed.value = (seed * 97.13) % 1000;
    f.uniforms.uAspect.value.set(this.w / this.h, 1);
    const r = this.renderer;
    this.quad.material = f;
    r.setRenderTarget(null);
    if (rect) {
      r.setScissorTest(true);
      r.setScissor(rect.x, rect.y, rect.w, rect.h);
      r.setViewport(rect.x, rect.y, rect.w, rect.h);
    } else {
      r.setScissorTest(false);
      const size = r.getSize(new THREE.Vector2());
      r.setViewport(0, 0, size.x, size.y);
    }
    r.render(this.scene, this.cam);
    r.setScissorTest(false);
  }

  /** Blur a texture that lives at a different resolution than the main target. */
  private blurFrom(src: THREE.Texture, w: number, h: number, radius: number, slot: string): THREE.Texture {
    const pw = this.w, ph = this.h;
    this.w = w;
    this.h = h;
    const out = this.blur(src, radius, slot);
    this.w = pw;
    this.h = ph;
    return out;
  }

  dispose() {
    this.mains.forEach((m) => m.dispose());
    this.layer.dispose();
    this.accum.dispose();
    this.pool.forEach((t) => t.dispose());
    Object.values(this.m).forEach((m) => m.dispose());
    this.quad.geometry.dispose();
  }
}
