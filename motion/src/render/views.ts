import * as THREE from "three";
import type { Doc, Layer, TextLayer, ShapeLayer, ImageLayer, DeviceLayer, ClonerLayer, GradientLayer, HtmlLayer, PathLayer, MeshLayer, SkyLayer, GroupLayer, ShadowT, GlassT } from "../fmd/schema";
import { displayText, type LayerFrame } from "../runtime/evaluate";
import { quadMaterial, gradientMaterial, coverUv, sizeQuad, UNIT_PLANE, type QuadMat } from "./materials";
import { ensureFont, glyphTexture, layoutText } from "./glyphs";
import { buildDevice, disposeDevice, placeholderScreen, deviceSize, type DeviceParts } from "./device";
import { assetTexture } from "../assets/assets";
import { htmlTexture, fillVars } from "./html";
import { skyMaterial } from "./sky";
import { meshGeometry, applyMaterial } from "./mesh3d";
import { samplePath, trim, strokeGeometry, fillGeometry, strokeMaterial } from "./pathgeo";

export const DEG = Math.PI / 180;

export function resolveColor(doc: Doc, c: string | undefined, fallback = "#ffffff"): string {
  if (!c) return fallback;
  if (c.startsWith("$")) return doc.brand.colors[c.slice(1)] ?? fallback;
  return c;
}

export interface Ctx {
  doc: Doc;
  camera: THREE.PerspectiveCamera;
  /** device pixels per comp pixel for the current render (texture resolution hint) */
  pxScale: number;
  textResolution: number;
  /** camera offset from its rest pose, normalised by comp height (sky parallax) */
  camOffset: THREE.Vector3;
}

export interface View {
  type: Layer["type"];
  root: THREE.Object3D;
  update(L: Layer, f: LayerFrame, ctx: Ctx): void;
  setOrder(order: number, depth: boolean): void;
  setOpacity(o: number): void;
  dispose(): void;
  /** quad materials that sample the backdrop (frosted glass) */
  glassMats?(): QuadMat[];
  /** the stencil-writing mask mesh of a clip group */
  clipMesh?: THREE.Mesh;
}

export function tag(o: THREE.Object3D, id: string) {
  o.userData.layerId = id;
}
function applyQuadOrder(mats: THREE.Material[], meshes: THREE.Object3D[], order: number, depth: boolean) {
  mats.forEach((m) => {
    m.depthTest = depth;
    m.depthWrite = depth;
  });
  meshes.forEach((m) => (m.renderOrder = order));
}

/** Shadow + glass uniforms shared by shapes, images and html cards. */
function applySurface(m: QuadMat, doc: Doc, f: LayerFrame, shadow: ShadowT | undefined, glass: GlassT | undefined) {
  const u = m.uniforms;
  if (shadow) {
    u.uShadowA.value = f.props["shadow.opacity"] ?? shadow.opacity;
    u.uShadowOff.value.set(shadow.x, shadow.y);
    u.uShadowBlur.value = f.props["shadow.blur"] ?? shadow.blur;
    u.uShadowColor.value.set(resolveColor(doc, shadow.color, "#000000"));
  } else u.uShadowA.value = 0;
  if (glass) {
    u.uGlass.value = 1;
    u.uTint.value.set(resolveColor(doc, glass.tint, "#ffffff"));
    u.uTintAmt.value = f.props["glass.amount"] ?? glass.amount;
    u.uRim.value = glass.rim;
  } else u.uGlass.value = 0;
}

/* ------------------------------- quad ------------------------------ */
class QuadView implements View {
  root = new THREE.Group();
  mesh: THREE.Mesh<THREE.PlaneGeometry, QuadMat>;
  constructor(public type: Layer["type"], private id: string) {
    this.mesh = new THREE.Mesh(UNIT_PLANE as THREE.PlaneGeometry, quadMaterial());
    tag(this.mesh, id);
    this.root.add(this.mesh);
  }
  update(L: Layer, f: LayerFrame, ctx: Ctx) {
    const m = this.mesh.material;
    const u = m.uniforms;
    if (L.type === "shape") {
      const s = L as ShapeLayer;
      applySurface(m, ctx.doc, f, s.shadow, s.glass);
      u.uRadius.value = f.props.radius;
      u.uEllipse.value = s.shape === "ellipse" ? 1 : 0;
      u.uColor.value.set(resolveColor(ctx.doc, s.fill, "#7c6cff"));
      u.uMapMode.value = 0;
      u.uStrokeW.value = s.stroke ? s.strokeWidth ?? 4 : 0;
      if (s.stroke) u.uStroke.value.set(resolveColor(ctx.doc, s.stroke));
      sizeQuad(this.mesh, m, f.props.w, f.props.h);
      this.mesh.visible = true;
    } else if (L.type === "image") {
      const im = L as ImageLayer;
      applySurface(m, ctx.doc, f, im.shadow, im.glass);
      const t = assetTexture(im.src);
      const w = f.props.w;
      const h = im.h ?? (t ? (w * t.h) / t.w : w);
      u.uRadius.value = f.props.radius;
      u.uEllipse.value = 0;
      if (t) {
        u.uMap.value = t.tex;
        u.uMapMode.value = 1;
        coverUv(m, t.w, t.h, w, h);
      } else {
        u.uMapMode.value = 0;
        u.uColor.value.set("#2a2c36");
      }
      sizeQuad(this.mesh, m, w, h);
      this.mesh.visible = true;
    } else if (L.type === "html") {
      const hl = L as HtmlLayer;
      applySurface(m, ctx.doc, f, hl.shadow, hl.glass);
      const vars: Record<string, number> = {};
      for (const k of Object.keys(hl.vars ?? {})) vars[k] = f.props["vars." + k];
      const w = f.props.w, h = f.props.h;
      const tex = htmlTexture(this.id, fillVars(hl.html, vars), Math.round(w), Math.round(h), ctx.pxScale * 1.25);
      u.uRadius.value = f.props.radius;
      u.uEllipse.value = 0;
      u.uUvScale.value.set(1, 1);
      u.uUvOffset.value.set(0, 0);
      if (tex) {
        u.uMap.value = tex;
        u.uMapMode.value = 1;
      }
      sizeQuad(this.mesh, m, w, h);
      this.mesh.visible = !!tex || !!hl.glass;
      if (!tex && hl.glass) u.uMapMode.value = 0;
    }
  }
  glassMats() {
    return this.mesh.material.uniforms.uGlass.value > 0.5 ? [this.mesh.material] : [];
  }
  setOrder(order: number, depth: boolean) {
    applyQuadOrder([this.mesh.material], [this.mesh], order, depth);
  }
  setOpacity(o: number) {
    this.mesh.material.uniforms.uOpacity.value = o;
    if (o <= 0.001) this.mesh.visible = false;
  }
  dispose() {
    this.mesh.material.dispose();
  }
}

/* ------------------------------- text ------------------------------ */
class TextView implements View {
  type = "text" as const;
  root = new THREE.Group();
  glyphs: THREE.Mesh<THREE.PlaneGeometry, QuadMat>[] = [];
  opacity = 1;
  order = 0;
  depth = false;
  constructor(private id: string) {}
  update(Lx: Layer, f: LayerFrame, ctx: Ctx) {
    const L = Lx as TextLayer;
    const weight = L.weight ?? 600;
    const font = L.font ?? ctx.doc.brand.font;
    ensureFont(font, weight);
    for (const sp of L.spans ?? []) ensureFont(sp.font ?? font, sp.weight ?? (sp.font ? 400 : weight));
    const size = f.props.size;
    const text = displayText(L, f.props.value);
    const spans = L.spans?.map((sp) => ({ ...sp, color: sp.color ? resolveColor(ctx.doc, sp.color) : undefined, size: sp.size ? (sp.size * size) / L.size : undefined }));
    const layout = layoutText(text, font, weight, size, L.align ?? "center", f.props.tracking, L.lineHeight ?? 1.08, spans);
    const n = layout.glyphs.length;
    while (this.glyphs.length < n) {
      const m = new THREE.Mesh(UNIT_PLANE as THREE.PlaneGeometry, quadMaterial());
      m.material.uniforms.uMapMode.value = 2;
      tag(m, this.id);
      this.root.add(m);
      this.glyphs.push(m);
    }
    while (this.glyphs.length > n) {
      const m = this.glyphs.pop()!;
      m.material.dispose();
      this.root.remove(m);
    }
    const baseColor = resolveColor(ctx.doc, L.color ?? "$ink", "#ffffff");
    const res = ctx.textResolution;
    layout.glyphs.forEach((lg, i) => {
      const m = this.glyphs[i];
      const gs = f.glyphs?.[i] ?? { dx: 0, dy: 0, s: 1, rz: 0, o: 1, wipe: 0 };
      const space = /\s/.test(lg.ch);
      m.visible = !space && gs.o > 0.001 && gs.s > 0.0001 && gs.wipe < 0.999;
      if (!m.visible) return;
      const g = glyphTexture(lg.ch, lg.style.font, lg.style.weight, lg.style.size, res);
      const u = m.material.uniforms;
      u.uMap.value = g.tex;
      u.uColor.value.set(lg.style.color ?? baseColor);
      u.uOpacity.value = gs.o * this.opacity;
      u.uSize.value.set(g.w, g.h);
      u.uQuad.value.set(g.w, g.h);
      u.uWipe.value = gs.wipe;
      m.position.set(lg.x + gs.dx, lg.y + gs.dy, 0);
      m.scale.set(g.w * gs.s, g.h * gs.s, 1);
      m.rotation.z = gs.rz * DEG;
      m.userData.glyphOpacity = gs.o;
    });
    this.setOrder(this.order, this.depth);
  }
  setOrder(order: number, depth: boolean) {
    this.order = order;
    this.depth = depth;
    applyQuadOrder(this.glyphs.map((g) => g.material), this.glyphs, order, depth);
  }
  setOpacity(o: number) {
    this.opacity = o;
    for (const g of this.glyphs) g.material.uniforms.uOpacity.value = (g.userData.glyphOpacity ?? 1) * o;
  }
  dispose() {
    this.glyphs.forEach((g) => g.material.dispose());
  }
}

/* ------------------------------ device ----------------------------- */
class DeviceView implements View {
  type = "device" as const;
  root = new THREE.Group();
  parts: DeviceParts | null = null;
  shadow: THREE.Mesh<THREE.PlaneGeometry, QuadMat>;
  constructor(private id: string) {
    this.shadow = new THREE.Mesh(UNIT_PLANE as THREE.PlaneGeometry, quadMaterial());
    this.shadow.material.uniforms.uMapMode.value = 3;
    tag(this.shadow, id);
    this.root.add(this.shadow);
  }
  update(Lx: Layer, f: LayerFrame, ctx: Ctx) {
    const L = Lx as DeviceLayer;
    const w = Math.round(f.props.w);
    if (!this.parts || this.parts.model !== L.model || Math.abs(this.parts.w - w) > 0.5) {
      if (this.parts) {
        this.root.remove(this.parts.group);
        disposeDevice(this.parts);
      }
      this.parts = buildDevice(L.model, w);
      this.parts.group.traverse((o) => tag(o, this.id));
      this.root.add(this.parts.group);
    }
    const p = this.parts;
    p.body.material.color.set(resolveColor(ctx.doc, L.color, "#1b1c21"));
    const t = assetTexture(L.screen) ?? placeholderScreen(resolveColor(ctx.doc, "$accent", "#7c6cff"), L.model);
    const su = p.screen.material.uniforms;
    su.uMap.value = t.tex;
    su.uMapMode.value = 1;
    coverUv(p.screen.material, t.w, t.h, p.screenW, p.screenH);
    // soft drop shadow behind the body
    const sh = L.shadow;
    const m = this.shadow.material;
    m.uniforms.uShadowA.value = sh ? f.props["shadow.opacity"] ?? sh.opacity : 0;
    this.shadow.visible = !!sh;
    if (sh) {
      m.uniforms.uShadowOff.value.set(sh.x, sh.y);
      m.uniforms.uShadowBlur.value = sh.blur;
      m.uniforms.uShadowColor.value.set(resolveColor(ctx.doc, sh.color, "#000000"));
      m.uniforms.uRadius.value = w * 0.16;
      sizeQuad(this.shadow, m, w * 0.96, deviceSize(L.model, w).h * 0.97);
      this.shadow.position.set(0, 0, -w * 0.06);
    }
  }
  setOrder(order: number, depth: boolean) {
    if (!this.parts) return;
    this.root.traverse((o) => (o.renderOrder = order));
    const m = this.parts.body.material;
    m.depthTest = depth;
    m.depthWrite = depth;
    [this.parts.screen, ...this.parts.details].forEach((x) => {
      x.material.depthTest = true;
      x.material.depthWrite = depth;
    });
    this.shadow.material.depthTest = depth;
  }
  setOpacity(o: number) {
    if (!this.parts) return;
    this.parts.body.material.opacity = o;
    this.parts.body.material.transparent = o < 0.999;
    this.parts.screen.material.uniforms.uOpacity.value = o;
    this.parts.details.forEach((d) => (d.material.uniforms.uOpacity.value = o));
    this.shadow.material.uniforms.uOpacity.value = o;
  }
  dispose() {
    if (this.parts) disposeDevice(this.parts);
    this.shadow.material.dispose();
  }
}

/* ------------------------------ cloner ----------------------------- */
class ClonerView implements View {
  type = "cloner" as const;
  root = new THREE.Group();
  items: THREE.Mesh<THREE.PlaneGeometry, QuadMat>[] = [];
  opacity = 1;
  order = 0;
  depth = true;
  private tmpQ = new THREE.Quaternion();
  constructor(private id: string) {}
  update(Lx: Layer, f: LayerFrame, ctx: Ctx) {
    const L = Lx as ClonerLayer;
    const clones = f.clones ?? [];
    while (this.items.length < clones.length) {
      const m = new THREE.Mesh(UNIT_PLANE as THREE.PlaneGeometry, quadMaterial());
      tag(m, this.id);
      this.root.add(m);
      this.items.push(m);
    }
    while (this.items.length > clones.length) {
      const m = this.items.pop()!;
      m.material.dispose();
      this.root.remove(m);
    }
    const c = L.child;
    const cw = c.w, ch = c.h ?? c.w;
    const colors = (c.colors?.length ? c.colors : [c.fill ?? "$accent"]).map((x) => resolveColor(ctx.doc, x, "#7c6cff"));
    // image children may cycle through several assets: src "a,b,c"
    const srcs = (c.src ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const texs = c.kind === "image" ? srcs.map((s) => assetTexture(s)) : [];
    const glyph = c.kind === "text" ? glyphTexture(c.text ?? "•", ctx.doc.brand.font, 700, cw, ctx.textResolution) : null;
    this.root.updateWorldMatrix(true, false);
    const parentQ = new THREE.Quaternion();
    this.root.getWorldQuaternion(parentQ);
    const camQ = new THREE.Quaternion();
    ctx.camera.getWorldQuaternion(camQ);
    this.tmpQ.copy(parentQ).invert().multiply(camQ);
    clones.forEach((k, i) => {
      const m = this.items[i];
      const u = m.material.uniforms;
      m.visible = k.o > 0.001 && k.s > 0.0001;
      m.position.set(k.x, k.y, k.z);
      if (L.billboard !== false) m.quaternion.copy(this.tmpQ);
      else m.quaternion.identity();
      if (k.rz) m.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), k.rz * DEG));
      const tex = texs.length ? texs[i % texs.length] : null;
      if (glyph) {
        m.scale.set(glyph.w * k.s, glyph.h * k.s, 1);
        u.uSize.value.set(glyph.w, glyph.h);
        u.uQuad.value.set(glyph.w, glyph.h);
        u.uMap.value = glyph.tex;
        u.uMapMode.value = 2;
      } else {
        m.scale.set(cw * k.s, ch * k.s, 1);
        u.uSize.value.set(cw, ch);
        u.uQuad.value.set(cw, ch);
        u.uRadius.value = c.radius ?? (c.shape === "rect" ? cw * 0.2 : 0);
        u.uEllipse.value = c.kind === "shape" && (c.shape ?? "ellipse") === "ellipse" ? 1 : 0;
        if (tex) {
          u.uMap.value = tex.tex;
          u.uMapMode.value = 1;
          u.uRadius.value = c.radius ?? 0;
          coverUv(m.material, tex.w, tex.h, cw, ch);
        } else u.uMapMode.value = c.kind === "image" ? 3 : 0;
      }
      u.uColor.value.set(colors[i % colors.length]);
      u.uOpacity.value = k.o * this.opacity;
      m.userData.cloneOpacity = k.o;
    });
    this.setOrder(this.order, this.depth);
  }
  setOrder(order: number, depth: boolean) {
    this.order = order;
    this.depth = depth;
    applyQuadOrder(this.items.map((i) => i.material), this.items, order, depth);
  }
  setOpacity(o: number) {
    this.opacity = o;
    for (const m of this.items) m.material.uniforms.uOpacity.value = (m.userData.cloneOpacity ?? 1) * o;
  }
  dispose() {
    this.items.forEach((m) => m.material.dispose());
  }
}

/* ------------------------ fullscreen backgrounds ------------------- */
class GradientView implements View {
  type = "gradient" as const;
  root = new THREE.Group();
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  constructor(id: string) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), gradientMaterial());
    this.mesh.frustumCulled = false;
    tag(this.mesh, id);
    this.root.add(this.mesh);
  }
  update(Lx: Layer, f: LayerFrame, ctx: Ctx) {
    const L = Lx as GradientLayer;
    const u = this.mesh.material.uniforms;
    const cs = L.colors.map((c) => resolveColor(ctx.doc, c, "#000000"));
    [u.uC0, u.uC1, u.uC2, u.uC3].forEach((x, i) => (x.value as THREE.Color).set(cs[Math.min(i, cs.length - 1)]));
    u.uCount.value = cs.length;
    u.uRadial.value = L.kind === "radial" ? 1 : 0;
    u.uAngle.value = f.props.angle;
    u.uNoise.value = f.props.noise;
    u.uAspect.value.set(ctx.doc.comp.w / ctx.doc.comp.h, 1);
  }
  setOrder(order: number) {
    this.mesh.renderOrder = order;
  }
  setOpacity(o: number) {
    this.mesh.material.uniforms.uOpacity.value = o;
    this.mesh.visible = o > 0.001;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

class SkyView implements View {
  type = "sky" as const;
  root = new THREE.Group();
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  constructor(id: string) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMaterial());
    this.mesh.frustumCulled = false;
    tag(this.mesh, id);
    this.root.add(this.mesh);
  }
  update(Lx: Layer, f: LayerFrame, ctx: Ctx) {
    const L = Lx as SkyLayer;
    const u = this.mesh.material.uniforms;
    u.uTop.value.set(resolveColor(ctx.doc, L.top, "#2f7fe0"));
    u.uHorizon.value.set(resolveColor(ctx.doc, L.horizon, "#bcdcf5"));
    u.uHills.value.set(resolveColor(ctx.doc, L.hills, "#4f8a3c"));
    u.uGrass.value.set(resolveColor(ctx.doc, L.grass, "#4e9a2e"));
    u.uGrassOn.value = L.grass ? 1 : 0;
    u.uMountains.value = L.mountains ? 1 : 0;
    u.uClouds.value = f.props.clouds;
    u.uCloudScale.value = L.cloudScale ?? 1;
    u.uTime.value = f.local * f.props.drift;
    u.uSun.value = f.props.sun;
    u.uHill.value = L.hills || L.mountains ? f.props.hillHeight : -1;
    u.uSeed.value = L.seed ?? 0;
    u.uAspect.value.set(ctx.doc.comp.w / ctx.doc.comp.h, 1);
    u.uCam.value.copy(ctx.camOffset);
  }
  setOrder(order: number) {
    this.mesh.renderOrder = order;
  }
  setOpacity(o: number) {
    this.mesh.material.uniforms.uOpacity.value = o;
    this.mesh.visible = o > 0.001;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/* ------------------------------- path ------------------------------ */
class PathView implements View {
  type = "path" as const;
  root = new THREE.Group();
  stroke: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  glow: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  fill: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private key = "";
  constructor(id: string) {
    this.fill = new THREE.Mesh(new THREE.BufferGeometry(), strokeMaterial(true));
    this.glow = new THREE.Mesh(new THREE.BufferGeometry(), strokeMaterial());
    this.stroke = new THREE.Mesh(new THREE.BufferGeometry(), strokeMaterial());
    for (const m of [this.fill, this.glow, this.stroke]) {
      tag(m, id);
      m.frustumCulled = false;
      this.root.add(m);
    }
  }
  update(Lx: Layer, f: LayerFrame, ctx: Ctx) {
    const L = Lx as PathLayer;
    const width = f.props.width;
    const key = JSON.stringify([L.points, L.smooth, L.closed, f.props.trimStart, f.props.trimEnd, width, f.props.glow, L.fillTo]);
    if (key !== this.key) {
      this.key = key;
      const pts = trim(samplePath(L.points, !!L.smooth, !!L.closed), f.props.trimStart, f.props.trimEnd);
      strokeGeometry(this.stroke.geometry, pts, width);
      if (f.props.glow > 0) strokeGeometry(this.glow.geometry, pts, width * 5);
      if (L.fillTo !== undefined) fillGeometry(this.fill.geometry, pts, L.fillTo);
    }
    const color = resolveColor(ctx.doc, L.stroke, "#ffffff");
    this.stroke.material.uniforms.uColor.value.set(color);
    this.glow.material.uniforms.uColor.value.set(color);
    this.glow.material.uniforms.uSoft.value = 0.9;
    this.glow.visible = f.props.glow > 0;
    this.fill.material.uniforms.uColor.value.set(resolveColor(ctx.doc, L.fill ?? L.stroke, color));
    this.fill.visible = L.fillTo !== undefined;
    this.glowAmt = f.props.glow;
  }
  private glowAmt = 0;
  setOrder(order: number, depth: boolean) {
    applyQuadOrder([this.fill.material, this.glow.material, this.stroke.material], [this.fill, this.glow, this.stroke], order, depth);
  }
  setOpacity(o: number) {
    this.stroke.material.uniforms.uOpacity.value = o;
    this.glow.material.uniforms.uOpacity.value = o * 0.45 * this.glowAmt;
    this.fill.material.uniforms.uOpacity.value = o;
  }
  dispose() {
    for (const m of [this.fill, this.glow, this.stroke]) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}

/* ------------------------------- mesh ------------------------------ */
class MeshView implements View {
  type = "mesh" as const;
  root = new THREE.Group();
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private geomKey = "";
  constructor(id: string) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshPhysicalMaterial({ transparent: true }));
    tag(this.mesh, id);
    this.root.add(this.mesh);
  }
  update(Lx: Layer, f: LayerFrame, ctx: Ctx) {
    const L = Lx as MeshLayer;
    if (this.geomKey !== L.geom) {
      this.geomKey = L.geom;
      this.mesh.geometry = meshGeometry(L.geom);
    }
    applyMaterial(this.mesh.material, L.material ?? "plastic", resolveColor(ctx.doc, L.color, "#dddddd"), L.roughness, L.metalness);
    const t = L.map ? assetTexture(L.map) : null;
    this.mesh.material.map = t?.tex ?? null;
    this.mesh.material.needsUpdate = this.mesh.material.userData.hadMap !== !!t;
    this.mesh.material.userData.hadMap = !!t;
    const s = f.props.size;
    this.mesh.scale.set(s, s, s);
  }
  setOrder(order: number, depth: boolean) {
    this.mesh.renderOrder = order;
    this.mesh.material.depthTest = depth;
    this.mesh.material.depthWrite = depth;
  }
  setOpacity(o: number) {
    this.mesh.material.opacity = o;
    this.mesh.visible = o > 0.001;
  }
  dispose() {
    this.mesh.material.dispose();
  }
}

/* --------------------------- group / clip -------------------------- */
class GroupView implements View {
  root = new THREE.Group();
  clipMesh?: THREE.Mesh<THREE.PlaneGeometry, QuadMat>;
  constructor(public type: Layer["type"], id: string) {
    if (type === "group") {
      const m = quadMaterial();
      m.colorWrite = false;
      m.depthTest = false;
      m.depthWrite = false;
      m.stencilWrite = true;
      m.stencilFunc = THREE.AlwaysStencilFunc;
      m.stencilZPass = THREE.ReplaceStencilOp;
      m.uniforms.uColor.value.set(0xffffff);
      this.clipMesh = new THREE.Mesh(UNIT_PLANE as THREE.PlaneGeometry, m);
      this.clipMesh.userData.clipOf = id;
      tag(this.clipMesh, id);
      this.root.add(this.clipMesh);
    }
  }
  update(Lx: Layer, f: LayerFrame) {
    if (!this.clipMesh) return;
    const L = Lx as GroupLayer;
    this.clipMesh.visible = !!L.clip;
    if (!L.clip) return;
    const m = this.clipMesh.material;
    m.uniforms.uRadius.value = f.props["clip.radius"];
    sizeQuad(this.clipMesh, m, f.props["clip.w"], f.props["clip.h"]);
  }
  setOrder() {}
  setOpacity() {}
  dispose() {
    this.clipMesh?.material.dispose();
  }
}

export function makeView(L: Layer): View {
  switch (L.type) {
    case "shape":
    case "image":
    case "html":
      return new QuadView(L.type, L.id);
    case "text":
      return new TextView(L.id);
    case "device":
      return new DeviceView(L.id);
    case "cloner":
      return new ClonerView(L.id);
    case "gradient":
      return new GradientView(L.id);
    case "sky":
      return new SkyView(L.id);
    case "path":
      return new PathView(L.id);
    case "mesh":
      return new MeshView(L.id);
    default:
      return new GroupView(L.type, L.id);
  }
}

/** Layers drawn as full-screen backgrounds (no transform). */
export const FULLSCREEN = new Set(["gradient", "sky"]);
