import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Doc, Layer, AdjustLayer } from "../fmd/schema";
import { fitDistance } from "../fmd/schema";
import { evaluate, shutterOffsets, type Frame } from "../runtime/evaluate";
import { Compositor } from "./post";
import { envEquirect, loadEnv } from "./env";
import { ensureLibraryAssets } from "../assets/assets";
import { htmlIdle } from "./html";
import { makeView, resolveColor, FULLSCREEN, DEG, type View, type Ctx } from "./views";

export { resolveColor } from "./views";

export interface StageOptions { preserveDrawingBuffer?: boolean; alpha?: boolean; msaa?: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface RenderOptions {
  /** where to draw, in CSS px, GL convention (y from the bottom) — whole canvas if omitted */
  rect?: Rect;
  /** motion-blur subframes; undefined = the comp setting, 1 = off */
  samples?: number;
}

/**
 * Stage v2 — turns a document at a time into pixels.
 *
 *  sync()    reconcile Three objects with the document and apply one evaluated frame
 *  draw()    walk layers in order and plan passes:
 *              plain layers  → batched into the main target
 *              blur > 0      → rendered alone, blurred, composited
 *              glass         → main is blurred first and handed to the layer as its backdrop
 *              adjust        → an image operation on everything drawn so far
 *  renderFrame()  motion blur = several draw()s at shutter offsets, averaged; then post → canvas
 */
export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 16 / 9, 1, 60000);
  views = new Map<string, View>();
  comp: Compositor;
  /** glyph textures are rendered at this multiple of the font size */
  textResolution = 2;
  private roomEnv: THREE.Texture;
  private pmrem: THREE.PMREMGenerator;
  private envName = "";
  private envTex: THREE.Texture | null = null;
  private helpers: THREE.Object3D[] = [];
  private lastDoc: Doc | null = null;
  private opacity = new Map<string, number>();
  private raycaster = new THREE.Raycaster();
  private pxScale = 1;
  private camRest = new THREE.Vector3();

  constructor(public canvas: HTMLCanvasElement | OffscreenCanvas, opts: StageOptions = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas: canvas as HTMLCanvasElement, antialias: false, alpha: opts.alpha ?? false, preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false, powerPreference: "high-performance", stencil: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.sortObjects = true;
    this.renderer.autoClear = false;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.roomEnv = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.roomEnv;
    this.comp = new Compositor(this.renderer, opts.msaa ?? 4);
  }

  setSize(w: number, h: number, pixelRatio = 1) {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
  }

  private updateEnv(doc: Doc) {
    const name = doc.comp.env ?? "studio";
    if (name === this.envName) return;
    const eq = envEquirect(name);
    if (!eq) {
      this.scene.environment = this.envTex ?? this.roomEnv;
      return;
    }
    this.envTex?.dispose();
    this.envTex = this.pmrem.fromEquirectangular(eq).texture;
    this.scene.environment = this.envTex;
    this.envName = name;
  }

  /** Reconcile views with the document and apply the frame. */
  sync(doc: Doc, frame: Frame) {
    this.lastDoc = doc;
    this.updateEnv(doc);
    ensureLibraryAssets(doc.assets ?? {});
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
    for (const L of doc.layers) {
      const v = this.views.get(L.id);
      if (!v) continue;
      const parentView = L.parent ? this.views.get(L.parent) : undefined;
      const want = FULLSCREEN.has(L.type) ? this.scene : parentView?.root ?? this.scene;
      if (v.root.parent !== want) want.add(v.root);
    }
    this.applyCamera(doc, frame);
    const ctx: Ctx = {
      doc,
      camera: this.camera,
      pxScale: this.pxScale,
      textResolution: this.textResolution,
      camOffset: new THREE.Vector3().subVectors(this.camera.position, this.camRest).divideScalar(doc.comp.h),
    };
    // effective opacity (parents multiply)
    this.opacity.clear();
    const opacityOf = (L: Layer): number => {
      const hit = this.opacity.get(L.id);
      if (hit !== undefined) return hit;
      const f = frame.byId.get(L.id)!;
      let o = f.visible ? f.xf.o : 0;
      if (L.parent) {
        const p = doc.layers.find((x) => x.id === L.parent);
        if (p) o *= opacityOf(p);
      }
      this.opacity.set(L.id, o);
      return o;
    };
    let order = 0;
    let prevDepth = false;
    const orders = new Map<string, number>();
    doc.layers.forEach((L) => {
      const v = this.views.get(L.id);
      const f = frame.byId.get(L.id);
      if (!v || !f) return;
      const r = v.root;
      if (!FULLSCREEN.has(L.type)) {
        r.position.set(f.xf.x, f.xf.y, f.xf.z);
        r.rotation.set(f.xf.rx * DEG, f.xf.ry * DEG, f.xf.rz * DEG, "YXZ");
        r.scale.setScalar(f.xf.s);
      }
      const depth = L.depth ?? (L.type === "device" || L.type === "cloner" || L.type === "mesh");
      if (!(depth && prevDepth)) order++;
      prevDepth = depth;
      const o = FULLSCREEN.has(L.type) ? -1000 + order : order;
      orders.set(L.id, o);
      v.setOrder(o, depth);
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
    this.applyClips(doc, orders);
  }

  /** Stencil masks: each clip group gets a ref; its descendants only draw where the mask wrote it. */
  private applyClips(doc: Doc, orders: Map<string, number>) {
    const byId = new Map(doc.layers.map((l) => [l.id, l]));
    const refOf = new Map<string, number>();
    let next = 1;
    for (const L of doc.layers) if (L.type === "group" && L.clip) refOf.set(L.id, next++ % 255 || 1);
    const clipAncestor = (L: Layer): string | null => {
      let p = L.parent ? byId.get(L.parent) : undefined;
      while (p) {
        if (refOf.has(p.id)) return p.id;
        p = p.parent ? byId.get(p.parent) : undefined;
      }
      return null;
    };
    const minChildOrder = new Map<string, number>();
    for (const L of doc.layers) {
      const anc = clipAncestor(L);
      const ref = anc ? refOf.get(anc)! : 0;
      if (anc) minChildOrder.set(anc, Math.min(minChildOrder.get(anc) ?? Infinity, orders.get(L.id) ?? 0));
      const v = this.views.get(L.id);
      if (!v) continue;
      v.root.traverse((o) => {
        if (o.userData.layerId !== L.id || o.userData.clipOf) return;
        const mats = ((o as THREE.Mesh).material ? [].concat((o as THREE.Mesh).material as never) : []) as THREE.Material[];
        for (const m of mats) {
          m.stencilWrite = ref > 0;
          m.stencilRef = ref;
          m.stencilFunc = THREE.EqualStencilFunc;
          m.stencilZPass = THREE.KeepStencilOp;
        }
      });
    }
    for (const [id, ref] of refOf) {
      const v = this.views.get(id);
      if (!v?.clipMesh) continue;
      const m = v.clipMesh.material as THREE.Material;
      m.stencilRef = ref;
      v.clipMesh.renderOrder = (minChildOrder.get(id) ?? orders.get(id) ?? 0) - 0.5;
    }
  }

  private applyCamera(doc: Doc, frame: Frame) {
    const c = frame.camera;
    this.camera.fov = c.fov;
    this.camera.aspect = doc.comp.w / doc.comp.h;
    this.camera.position.set(c.x, c.y, c.z);
    this.camRest.set(0, 0, fitDistance(doc.comp.h, c.fov));
    if (c.target) this.camera.lookAt(new THREE.Vector3(...c.target));
    else this.camera.rotation.set(c.rx * DEG, c.ry * DEG, c.rz * DEG, "YXZ");
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /* --------------------------- pass planning -------------------------- */
  private draw(doc: Doc, frame: Frame) {
    const comp = this.comp;
    const r = this.renderer;
    comp.beginMain(new THREE.Color(resolveColor(doc, doc.comp.bg, "#000000")));
    const k = comp.h / doc.comp.h; // device px per comp px
    // drawables per layer, with their visibility as sync left it
    const drawables: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine) && o.userData.layerId) {
        o.userData.base = o.visible;
        drawables.push(o);
      }
    });
    const byId = new Map(doc.layers.map((l) => [l.id, l]));
    const kids = new Map<string, string[]>();
    for (const L of doc.layers) if (L.parent) kids.set(L.parent, [...(kids.get(L.parent) ?? []), L.id]);
    const subtree = (id: string): string[] => [id, ...(kids.get(id) ?? []).flatMap(subtree)];
    const ancestors = (id: string): string[] => {
      const out: string[] = [];
      let p = byId.get(id)?.parent;
      while (p) {
        out.push(p);
        p = byId.get(p)?.parent;
      }
      return out;
    };
    const renderSubset = (ids: Set<string>, target: THREE.WebGLRenderTarget) => {
      // clip masks of ancestors must draw too (they only write stencil)
      const clipIds = new Set<string>();
      for (const id of ids) for (const a of ancestors(id)) clipIds.add(a);
      for (const o of drawables) {
        const lid = o.userData.layerId as string;
        o.visible = !!o.userData.base && (o.userData.clipOf ? clipIds.has(lid) || ids.has(lid) : ids.has(lid));
      }
      r.setRenderTarget(target);
      r.clear(false, true, true);
      r.render(this.scene, this.camera);
    };
    let batch = new Set<string>();
    const flush = () => {
      if (batch.size) renderSubset(batch, comp.main);
      batch = new Set();
    };
    const consumed = new Set<string>();
    for (const L of doc.layers) {
      if (L.type === "camera" || consumed.has(L.id)) continue;
      const f = frame.byId.get(L.id);
      const op = this.opacity.get(L.id) ?? 0;
      if (!f || op <= 0.001) continue;
      if (L.type === "adjust") {
        flush();
        const A = L as AdjustLayer;
        comp.adjust({
          blur: (f.props.blur ?? 0) * k,
          exposure: f.props.exposure,
          contrast: f.props.contrast,
          saturation: f.props.saturation,
          fade: f.props.fade,
          fadeColor: new THREE.Color(resolveColor(doc, A.fadeColor, "#ffffff")),
          opacity: op,
        });
        continue;
      }
      const blur = f.props.blur ?? 0;
      if (blur > 0.3) {
        flush();
        const ids = new Set(subtree(L.id));
        ids.forEach((id) => consumed.add(id));
        comp.beginLayer();
        renderSubset(ids, comp.layer);
        comp.over(comp.blur(comp.layer.texture, blur * k, "layer"));
        continue;
      }
      const glass = this.views.get(L.id)?.glassMats?.() ?? [];
      if (glass.length) {
        flush();
        const radius = (f.props["glass.blur"] ?? 28) * k;
        const bd = comp.blur(comp.main.texture, radius, "glass");
        for (const m of glass) {
          m.uniforms.uBackdrop.value = bd;
          m.uniforms.uViewport.value.set(comp.w, comp.h);
        }
      }
      batch.add(L.id);
    }
    flush();
    for (const o of drawables) o.visible = !!o.userData.base;
  }

  /** Resolve async resources (HDRI, html rasters) a frame at `t` needs, so offline renders are exact. */
  async prepare(doc: Doc, t: number) {
    await loadEnv(doc.comp.env ?? "studio");
    this.envName = "";
    const offs = doc.comp.motionBlur ? shutterOffsets(doc) : [0];
    for (let pass = 0; pass < 2; pass++) {
      for (const off of offs) this.sync(doc, evaluate(doc, t, off));
      await htmlIdle();
      if (typeof document !== "undefined") await document.fonts?.ready;
    }
  }

  /** Evaluate + draw one finished frame (with motion blur and post) into the canvas. */
  renderFrame(doc: Doc, t: number, opts: RenderOptions = {}) {
    const dpr = this.renderer.getPixelRatio();
    const size = this.renderer.getSize(new THREE.Vector2());
    const rect = opts.rect;
    const w = (rect?.w ?? size.x) * dpr, h = (rect?.h ?? size.y) * dpr;
    this.comp.resize(w, h);
    this.pxScale = h / doc.comp.h;
    const offs = doc.comp.motionBlur ? shutterOffsets(doc, opts.samples) : [0];
    if (offs.length > 1) this.comp.clearAccum();
    for (const off of offs) {
      const frame = evaluate(doc, t, off);
      this.sync(doc, frame);
      this.draw(doc, frame);
      if (offs.length > 1) this.comp.accumulate(1 / offs.length);
    }
    const src = offs.length > 1 ? this.comp.accum.texture : this.comp.main.texture;
    this.comp.final(src, doc.comp.post ?? {}, t, rect);
    // leave the scene at the exact time so picking and bounds match what the user sees
    if (offs.length > 1) this.sync(doc, evaluate(doc, t));
  }

  /** Render the scene from a free "scene" camera with helpers (split view), no post. */
  renderSceneView(cam: THREE.PerspectiveCamera, rect: Rect) {
    const r = this.renderer;
    if (!this.helpers.length) {
      const grid = new THREE.GridHelper(4000, 20, 0x3a3f4b, 0x262a33);
      grid.rotation.x = Math.PI / 2;
      grid.position.z = -1;
      const frameLine = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0x8c9bff }));
      const helper = new THREE.CameraHelper(this.camera);
      this.helpers.push(grid, frameLine, helper);
      this.helpers.forEach((x) => {
        x.renderOrder = 10000;
        this.scene.add(x);
      });
    }
    const doc = this.lastDoc;
    if (doc) this.helpers[1].scale.set(doc.comp.w, doc.comp.h, 1);
    (this.helpers[2] as THREE.CameraHelper).update();
    this.helpers.forEach((x) => (x.visible = true));
    const bgs = [...this.views.values()].filter((v) => FULLSCREEN.has(v.type));
    bgs.forEach((g) => (g.root.visible = false));
    r.setRenderTarget(null);
    r.setScissorTest(true);
    r.setScissor(rect.x, rect.y, rect.w, rect.h);
    r.setViewport(rect.x, rect.y, rect.w, rect.h);
    r.setClearColor(0x14161b, 1);
    r.clear();
    r.render(this.scene, cam);
    r.setScissorTest(false);
    bgs.forEach((g) => (g.root.visible = true));
    this.helpers.forEach((x) => (x.visible = false));
  }

  /** Front-most layer under a point given in normalized device coords of the shot view. */
  pick(ndcX: number, ndcY: number): string | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const targets: THREE.Object3D[] = [];
    for (const v of this.views.values())
      if (!FULLSCREEN.has(v.type) && v.root.visible) v.root.traverse((o) => (o as THREE.Mesh).isMesh && o.visible && !o.userData.clipOf && targets.push(o));
    const hits = this.raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    hits.sort((a, b) => b.object.renderOrder - a.object.renderOrder || a.distance - b.distance);
    return (hits[0].object.userData.layerId as string) ?? null;
  }

  /** Screen-space bounds (0..1, y down) of a layer as seen by the shot camera. */
  bounds(id: string): { x: number; y: number; w: number; h: number } | null {
    const v = this.views.get(id);
    if (!v || FULLSCREEN.has(v.type)) return null;
    for (let o: THREE.Object3D | null = v.root; o; o = o.parent) if (!o.visible) return null;
    const box = new THREE.Box3();
    let any = false;
    v.root.updateWorldMatrix(true, true);
    v.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.visible && m.userData.layerId === id) {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
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

  /** World units per screen pixel at z=0 — used to turn mouse drags into position deltas. */
  worldPerScreen(viewHeightPx: number): number {
    const dist = this.camera.position.z;
    const visibleH = 2 * dist * Math.tan((this.camera.fov / 2) * DEG);
    return visibleH / viewHeightPx;
  }

  dispose() {
    this.views.forEach((v) => v.dispose());
    this.views.clear();
    this.roomEnv.dispose();
    this.envTex?.dispose();
    this.pmrem.dispose();
    this.comp.dispose();
    this.renderer.dispose();
  }
}
