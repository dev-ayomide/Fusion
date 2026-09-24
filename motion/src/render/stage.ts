import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Doc, Layer, TextLayer, ShapeLayer, ImageLayer, DeviceLayer, ClonerLayer, GradientLayer } from "../fmd/schema";
import type { Frame, LayerFrame } from "../runtime/evaluate";
import { quadMaterial, gradientMaterial, coverUv, UNIT_PLANE, type QuadMat } from "./materials";
import { ensureFont, glyphTexture, layoutText } from "./glyphs";
import { buildDevice, disposeDevice, placeholderScreen, type DeviceParts } from "./device";
import { assetTexture } from "../assets/assets";

const DEG = Math.PI / 180;

export function resolveColor(doc: Doc, c: string | undefined, fallback = "#ffffff"): string {
  if (!c) return fallback;
  if (c.startsWith("$")) return doc.brand.colors[c.slice(1)] ?? fallback;
  return c;
}

interface View {
  type: Layer["type"];
  root: THREE.Object3D;
  /** meshes that can be clicked, all tagged with userData.layerId */
  update(L: Layer, f: LayerFrame, ctx: Ctx): void;
  setOrder(order: number, depth: boolean): void;
  setOpacity(o: number): void;
  dispose(): void;
}
interface Ctx { doc: Doc; camera: THREE.Camera; stage: Stage }

function tag(o: THREE.Object3D, id: string) {
  o.userData.layerId = id;
}
function applyQuadOrder(mats: QuadMat[], meshes: THREE.Object3D[], order: number, depth: boolean) {
  mats.forEach((m) => {
    m.depthTest = depth;
    m.depthWrite = depth;
  });
  meshes.forEach((m) => (m.renderOrder = order));
}

/* ------------------------------- quad ------------------------------ */
class QuadView implements View {
  root = new THREE.Group();
  mesh: THREE.Mesh<THREE.PlaneGeometry, QuadMat>;
  opacity = 1;
  constructor(public type: Layer["type"], id: string) {
    this.mesh = new THREE.Mesh(UNIT_PLANE as THREE.PlaneGeometry, quadMaterial());
    tag(this.mesh, id);
    this.root.add(this.mesh);
  }
  update(L: Layer, f: LayerFrame, ctx: Ctx) {
    const u = this.mesh.material.uniforms;
    if (L.type === "shape") {
      const s = L as ShapeLayer;
      const w = f.props.w, h = f.props.h;
      this.mesh.scale.set(w, h, 1);
      u.uSize.value.set(w, h);
      u.uRadius.value = f.props.radius;
      u.uEllipse.value = s.shape === "ellipse" ? 1 : 0;
      u.uColor.value.set(resolveColor(ctx.doc, s.fill, "#7c6cff"));
      u.uMapMode.value = 0;
      u.uStrokeW.value = s.stroke ? s.strokeWidth ?? 4 : 0;
      if (s.stroke) u.uStroke.value.set(resolveColor(ctx.doc, s.stroke));
    } else if (L.type === "image") {
      const im = L as ImageLayer;
      const t = assetTexture(im.src);
      const w = f.props.w;
      const h = im.h ?? (t ? (w * t.h) / t.w : w);
      this.mesh.scale.set(w, h, 1);
      u.uSize.value.set(w, h);
      u.uRadius.value = f.props.radius;
      u.uEllipse.value = 0;
      if (t) {
        u.uMap.value = t.tex;
        u.uMapMode.value = 1;
        coverUv(this.mesh.material, t.w, t.h, w, h);
      } else {
        u.uMapMode.value = 0;
        u.uColor.value.set("#2a2c36");
      }
    }
  }
  setOrder(order: number, depth: boolean) {
    applyQuadOrder([this.mesh.material], [this.mesh], order, depth);
  }
  setOpacity(o: number) {
    this.mesh.material.uniforms.uOpacity.value = o;
    this.mesh.visible = o > 0.001;
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
    const size = f.props.size;
    const layout = layoutText(L.text, font, weight, size, L.align ?? "center", f.props.tracking, L.lineHeight ?? 1.08);
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
    const color = resolveColor(ctx.doc, L.color ?? "$ink", "#ffffff");
    const res = ctx.stage.textResolution;
    layout.glyphs.forEach((lg, i) => {
      const m = this.glyphs[i];
      const gs = f.glyphs?.[i] ?? { dx: 0, dy: 0, s: 1, rz: 0, o: 1 };
      const space = /\s/.test(lg.ch);
      m.visible = !space && gs.o > 0.001 && gs.s > 0.0001;
      if (!m.visible) return;
      const g = glyphTexture(lg.ch, font, weight, size, res);
      const u = m.material.uniforms;
      u.uMap.value = g.tex;
      u.uColor.value.set(color);
      u.uOpacity.value = gs.o * this.opacity;
      u.uSize.value.set(g.w, g.h);
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
  constructor(private id: string) {}
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
  }
  setOrder(order: number, depth: boolean) {
    if (!this.parts) return;
    this.parts.group.traverse((o) => (o.renderOrder = order));
    const m = this.parts.body.material;
    m.depthTest = depth;
    m.depthWrite = depth;
    // screen and details always depth-test against their own body
    [this.parts.screen, ...this.parts.details].forEach((x) => {
      x.material.depthTest = true;
      x.material.depthWrite = depth;
    });
  }
  setOpacity(o: number) {
    if (!this.parts) return;
    this.parts.body.material.opacity = o;
    this.parts.body.material.transparent = o < 0.999;
    this.parts.screen.material.uniforms.uOpacity.value = o;
    this.parts.details.forEach((d) => (d.material.uniforms.uOpacity.value = o));
    this.root.visible = o > 0.001;
  }
  dispose() {
    if (this.parts) disposeDevice(this.parts);
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
    const tex = c.kind === "image" ? assetTexture(c.src) : null;
    const glyph = c.kind === "text" ? glyphTexture(c.text ?? "•", ctx.doc.brand.font, 700, cw, ctx.stage.textResolution) : null;
    // billboard: undo the parent rotation, then face the camera
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
      if (glyph) {
        m.scale.set(glyph.w * k.s, glyph.h * k.s, 1);
        u.uSize.value.set(glyph.w, glyph.h);
        u.uMap.value = glyph.tex;
        u.uMapMode.value = 2;
      } else {
        m.scale.set(cw * k.s, ch * k.s, 1);
        u.uSize.value.set(cw, ch);
        u.uRadius.value = c.radius ?? (c.shape === "rect" ? cw * 0.2 : 0);
        u.uEllipse.value = c.kind === "shape" && (c.shape ?? "ellipse") === "ellipse" ? 1 : 0;
        if (tex) {
          u.uMap.value = tex.tex;
          u.uMapMode.value = 1;
          coverUv(m.material, tex.w, tex.h, cw, ch);
        } else u.uMapMode.value = 0;
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

/* ----------------------------- gradient ---------------------------- */
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

class GroupView implements View {
  root = new THREE.Group();
  constructor(public type: Layer["type"]) {}
  update() {}
  setOrder() {}
  setOpacity() {}
  dispose() {}
}

function makeView(L: Layer): View {
  switch (L.type) {
    case "shape":
    case "image":
      return new QuadView(L.type, L.id);
    case "text":
      return new TextView(L.id);
    case "device":
      return new DeviceView(L.id);
    case "cloner":
      return new ClonerView(L.id);
    case "gradient":
      return new GradientView(L.id);
    default:
      return new GroupView(L.type);
  }
}

/* ------------------------------------------------------------------ *
 * Stage                                                              *
 * ------------------------------------------------------------------ */
export interface StageOptions { preserveDrawingBuffer?: boolean; alpha?: boolean }

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 16 / 9, 1, 40000);
  views = new Map<string, View>();
  /** glyph textures are rendered at this multiple of the font size */
  textResolution = 2;
  private envTex: THREE.Texture;
  private helpers: THREE.Object3D[] = [];
  private lastDoc: Doc | null = null;
  private raycaster = new THREE.Raycaster();

  constructor(public canvas: HTMLCanvasElement | OffscreenCanvas, opts: StageOptions = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas: canvas as HTMLCanvasElement, antialias: true, alpha: opts.alpha ?? false, preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.sortObjects = true;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;
  }

  setSize(w: number, h: number, pixelRatio = 1) {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
  }

  /** Reconcile views with the document and apply the frame. */
  sync(doc: Doc, frame: Frame) {
    this.lastDoc = doc;
    const ctx: Ctx = { doc, camera: this.camera, stage: this };
    const alive = new Set<string>();
    for (const L of doc.layers) {
      if (L.type === "camera") continue;
      alive.add(L.id);
      let v = this.views.get(L.id);
      if (v && v.type !== L.type) {
        v.root.removeFromParent();
        v.dispose();
        v = undefined;
      }
      if (!v) {
        v = makeView(L);
        this.views.set(L.id, v);
      }
    }
    for (const [id, v] of this.views)
      if (!alive.has(id)) {
        v.root.removeFromParent();
        v.dispose();
        this.views.delete(id);
      }
    // hierarchy
    for (const L of doc.layers) {
      const v = this.views.get(L.id);
      if (!v) continue;
      const parentView = L.parent ? this.views.get(L.parent) : undefined;
      const want = L.type === "gradient" ? this.scene : parentView?.root ?? this.scene;
      if (v.root.parent !== want) want.add(v.root);
    }
    this.applyCamera(doc, frame);
    // transforms first (billboards need world matrices), then content
    const effOpacity = new Map<string, number>();
    const opacityOf = (L: Layer): number => {
      const hit = effOpacity.get(L.id);
      if (hit !== undefined) return hit;
      const f = frame.byId.get(L.id)!;
      let o = f.visible ? f.xf.o : 0;
      if (L.parent) {
        const p = doc.layers.find((x) => x.id === L.parent);
        if (p) o *= opacityOf(p);
      }
      effOpacity.set(L.id, o);
      return o;
    };
    let order = 0;
    let prevDepth = false;
    doc.layers.forEach((L) => {
      const v = this.views.get(L.id);
      const f = frame.byId.get(L.id);
      if (!v || !f) return;
      const r = v.root;
      if (L.type !== "gradient") {
        r.position.set(f.xf.x, f.xf.y, f.xf.z);
        r.rotation.set(f.xf.rx * DEG, f.xf.ry * DEG, f.xf.rz * DEG, "YXZ");
        const s = f.xf.s;
        r.scale.set(s, s, s);
      }
      const depth = L.depth ?? (L.type === "device" || L.type === "cloner");
      // 3D layers that sit next to each other share an order so they depth-sort together
      if (!(depth && prevDepth)) order++;
      prevDepth = depth;
      v.setOrder(L.type === "gradient" ? -1000 + order : order, depth);
    });
    this.scene.updateMatrixWorld(true);
    doc.layers.forEach((L) => {
      const v = this.views.get(L.id);
      const f = frame.byId.get(L.id);
      if (!v || !f) return;
      const o = opacityOf(L);
      if (o > 0.001) v.update(L, f, ctx);
      v.setOpacity(o);
      v.root.visible = o > 0.001 || L.type === "group" || doc.layers.some((c) => c.parent === L.id);
    });
  }

  private applyCamera(doc: Doc, frame: Frame) {
    const c = frame.camera;
    this.camera.fov = c.fov;
    this.camera.aspect = doc.comp.w / doc.comp.h;
    this.camera.position.set(c.x, c.y, c.z);
    if (c.target) this.camera.lookAt(new THREE.Vector3(...c.target));
    else this.camera.rotation.set(c.rx * DEG, c.ry * DEG, c.rz * DEG, "YXZ");
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** Render the shot camera (optionally into a sub-rectangle of the canvas). */
  render(rect?: { x: number; y: number; w: number; h: number }, clear = true) {
    const r = this.renderer;
    const bg = this.lastDoc ? resolveColor(this.lastDoc, this.lastDoc.comp.bg, "#000000") : "#000000";
    r.setClearColor(bg, 1);
    this.helpers.forEach((h) => (h.visible = false));
    if (rect) {
      r.setScissorTest(true);
      r.setScissor(rect.x, rect.y, rect.w, rect.h);
      r.setViewport(rect.x, rect.y, rect.w, rect.h);
    } else {
      r.setScissorTest(false);
      const size = r.getSize(new THREE.Vector2());
      r.setViewport(0, 0, size.x, size.y);
    }
    if (clear) r.clear();
    r.render(this.scene, this.camera);
    r.setScissorTest(false);
  }

  /** Render the scene from a free "scene" camera with helpers (split view). */
  renderSceneView(cam: THREE.PerspectiveCamera, rect: { x: number; y: number; w: number; h: number }) {
    const r = this.renderer;
    if (!this.helpers.length) {
      const grid = new THREE.GridHelper(4000, 20, 0x3a3f4b, 0x262a33);
      grid.rotation.x = Math.PI / 2;
      grid.position.z = -1;
      const frameGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1));
      const frameLine = new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({ color: 0x8c9bff }));
      frameLine.name = "comp-frame";
      const helper = new THREE.CameraHelper(this.camera);
      helper.name = "shot-helper";
      this.helpers.push(grid, frameLine, helper);
      this.helpers.forEach((h) => {
        h.renderOrder = 10000;
        this.scene.add(h);
      });
    }
    const doc = this.lastDoc;
    const frameLine = this.helpers[1];
    if (doc) frameLine.scale.set(doc.comp.w, doc.comp.h, 1);
    (this.helpers[2] as THREE.CameraHelper).update();
    this.helpers.forEach((h) => (h.visible = true));
    // gradients are screen-space; hide them in the scene view so the grid reads
    const grads = [...this.views.values()].filter((v) => v.type === "gradient");
    grads.forEach((g) => (g.root.visible = false));
    r.setScissorTest(true);
    r.setScissor(rect.x, rect.y, rect.w, rect.h);
    r.setViewport(rect.x, rect.y, rect.w, rect.h);
    r.setClearColor(0x14161b, 1);
    r.clear();
    r.render(this.scene, cam);
    r.setScissorTest(false);
    grads.forEach((g) => (g.root.visible = true));
    this.helpers.forEach((h) => (h.visible = false));
  }

  /** Front-most layer under a point given in normalized device coords of the shot view. */
  pick(ndcX: number, ndcY: number): string | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const targets: THREE.Object3D[] = [];
    for (const v of this.views.values()) if (v.type !== "gradient" && v.root.visible) v.root.traverse((o) => (o as THREE.Mesh).isMesh && o.visible && targets.push(o));
    const hits = this.raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    hits.sort((a, b) => b.object.renderOrder - a.object.renderOrder || a.distance - b.distance);
    return (hits[0].object.userData.layerId as string) ?? null;
  }

  /** Screen-space bounds (0..1, y down) of a layer as seen by the shot camera. */
  bounds(id: string): { x: number; y: number; w: number; h: number } | null {
    const v = this.views.get(id);
    if (!v || v.type === "gradient") return null;
    for (let o: THREE.Object3D | null = v.root; o; o = o.parent) if (!o.visible) return null;
    const box = new THREE.Box3();
    let any = false;
    v.root.updateWorldMatrix(true, true);
    v.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.visible) {
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
        box.union(b);
        any = true;
      }
    });
    if (!any || box.isEmpty()) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(this.camera);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    return { x: (minX + 1) / 2, y: (1 - maxY) / 2, w: (maxX - minX) / 2, h: (maxY - minY) / 2 };
  }

  /** Pixels on screen per world pixel at z=0 — used to turn mouse drags into position deltas. */
  worldPerScreen(viewHeightPx: number): number {
    const dist = this.camera.position.z;
    const visibleH = 2 * dist * Math.tan((this.camera.fov / 2) * DEG);
    return visibleH / viewHeightPx;
  }

  dispose() {
    this.views.forEach((v) => v.dispose());
    this.views.clear();
    this.envTex.dispose();
    this.renderer.dispose();
  }
}
