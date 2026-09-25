import * as THREE from "three";
import { quadMaterial, UNIT_PLANE, type QuadMat } from "./materials";
import { ensureFont, onFontsChanged } from "./glyphs";

onFontsChanged(() => clearPlaceholderScreens());

/** A device mockup: extruded body with a real PBR finish, an unlit screen, and model details. */
export interface DeviceParts {
  group: THREE.Group;
  body: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshPhysicalMaterial>;
  screen: THREE.Mesh<THREE.PlaneGeometry, QuadMat>;
  details: THREE.Mesh<THREE.PlaneGeometry, QuadMat>[];
  model: string;
  w: number;
  screenW: number;
  screenH: number;
}

function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function deviceSize(model: string, w: number): { w: number; h: number } {
  return model === "browser" ? { w, h: w * 0.64 } : { w, h: w * 2.06 };
}

export function buildDevice(model: string, w: number): DeviceParts {
  const group = new THREE.Group();
  const { h } = deviceSize(model, w);
  const phone = model !== "browser";
  const radius = phone ? w * 0.17 : w * 0.02;
  const depth = phone ? w * 0.075 : w * 0.02;
  const bevel = phone ? w * 0.018 : w * 0.006;
  const geo = new THREE.ExtrudeGeometry(roundedRect(w - bevel * 2, h - bevel * 2, Math.max(1, radius - bevel)), {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 24,
  });
  geo.translate(0, 0, -depth / 2);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0x1b1c21, metalness: 0.85, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2, transparent: true });
  const body = new THREE.Mesh(geo, mat);
  group.add(body);

  const bezel = phone ? w * 0.045 : w * 0.012;
  const topBar = phone ? 0 : w * 0.045;
  const screenW = w - bezel * 2;
  const screenH = h - bezel * 2 - topBar;
  const screenMat = quadMaterial();
  screenMat.uniforms.uSize.value.set(screenW, screenH);
  screenMat.uniforms.uRadius.value = phone ? radius - bezel : w * 0.008;
  screenMat.uniforms.uColor.value.set(0x0b0c10);
  screenMat.depthTest = true;
  const screen = new THREE.Mesh(UNIT_PLANE as THREE.PlaneGeometry, screenMat);
  screen.scale.set(screenW, screenH, 1);
  screen.position.set(0, -topBar / 2, depth / 2 + bevel + 0.6);
  group.add(screen);

  const details: THREE.Mesh<THREE.PlaneGeometry, QuadMat>[] = [];
  const detail = (dw: number, dh: number, x: number, y: number, color: number, r: number, ellipse = false) => {
    const m = quadMaterial();
    m.uniforms.uSize.value.set(dw, dh);
    m.uniforms.uRadius.value = r;
    m.uniforms.uEllipse.value = ellipse ? 1 : 0;
    m.uniforms.uColor.value.set(color);
    m.depthTest = true;
    const mesh = new THREE.Mesh(UNIT_PLANE as THREE.PlaneGeometry, m);
    mesh.scale.set(dw, dh, 1);
    mesh.position.set(x, y, depth / 2 + bevel + 1.2);
    group.add(mesh);
    details.push(mesh);
  };
  if (phone) detail(w * 0.3, w * 0.085, 0, h / 2 - bezel - w * 0.075, 0x000000, w * 0.0425);
  else {
    const y = h / 2 - bezel - topBar / 2;
    [0xff5f57, 0xfebc2e, 0x28c840].forEach((c, i) => detail(w * 0.014, w * 0.014, -w / 2 + bezel + w * 0.02 + i * w * 0.022, y, c, 0, true));
    detail(w * 0.4, w * 0.024, 0, y, 0x2a2c33, w * 0.012);
  }
  return { group, body, screen, details, model, w, screenW, screenH };
}

export function disposeDevice(d: DeviceParts) {
  d.body.geometry.dispose();
  d.body.material.dispose();
  d.screen.material.dispose();
  d.details.forEach((m) => m.material.dispose());
}

/* ------------------------------------------------------------------ *
 * Built-in placeholder screen so a device looks right before a user   *
 * uploads a screenshot. Drawn once per accent colour.                 *
 * ------------------------------------------------------------------ */
const screens = new Map<string, THREE.CanvasTexture>();
export function placeholderScreen(accent: string, model: string): { tex: THREE.CanvasTexture; w: number; h: number } {
  const key = accent + model;
  const W = model === "browser" ? 1600 : 780;
  const H = model === "browser" ? 960 : 1690;
  let tex = screens.get(key);
  if (!tex) {
    ensureFont("Inter Variable", 700);
    ensureFont("Inter Variable", 500);
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    const F = `"Inter Variable", Inter, system-ui, sans-serif`;
    g.fillStyle = "#0e0f14";
    g.fillRect(0, 0, W, H);
    const grad = g.createRadialGradient(W * 0.8, 0, 10, W * 0.8, 0, W);
    grad.addColorStop(0, accent + "55");
    grad.addColorStop(1, accent + "00");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H * 0.5);
    if (model === "browser") {
      g.fillStyle = "#fff";
      g.font = `700 64px ${F}`;
      g.fillText("Ledger", 80, 140);
      g.fillStyle = "#9a9fb0";
      g.font = `500 30px ${F}`;
      g.fillText("Overview · Budgets · Reports", 80, 200);
      [0.35, 0.6, 0.45, 0.8, 0.55, 0.92, 0.7, 0.5].forEach((v, i) => {
        g.fillStyle = i === 5 ? accent : "#262833";
        g.beginPath();
        g.roundRect(80 + i * 100, 820 - v * 480, 64, v * 480, 14);
        g.fill();
      });
      g.fillStyle = "#171821";
      g.beginPath();
      g.roundRect(960, 280, 560, 540, 32);
      g.fill();
      g.fillStyle = "#fff";
      g.font = `700 88px ${F}`;
      g.fillText("$12,480", 1010, 420);
      g.fillStyle = accent;
      g.font = `600 34px ${F}`;
      g.fillText("+4.2% this month", 1010, 480);
    } else {
      g.fillStyle = "#fff";
      g.font = `700 44px ${F}`;
      g.fillText("Ledger", 56, 190);
      g.fillStyle = "#9a9fb0";
      g.font = `500 32px ${F}`;
      g.fillText("Total balance", 56, 300);
      g.fillStyle = "#fff";
      g.font = `700 104px ${F}`;
      g.fillText("$12,480", 56, 410);
      g.fillStyle = accent;
      g.font = `600 34px ${F}`;
      g.fillText("+4.2% this month", 56, 470);
      g.fillStyle = "#171821";
      g.beginPath();
      g.roundRect(40, 530, W - 80, 400, 40);
      g.fill();
      [0.35, 0.6, 0.45, 0.8, 0.55, 0.92, 0.7].forEach((v, i) => {
        const bw = 60, gap = (W - 160 - 7 * bw) / 6;
        g.fillStyle = i === 5 ? accent : "#2a2c38";
        g.beginPath();
        g.roundRect(80 + i * (bw + gap), 890 - v * 300, bw, v * 300, 14);
        g.fill();
      });
      [["Groceries", "−$84.10"], ["Rent", "−$1,450.00"], ["Salary", "+$4,200.00"], ["Coffee", "−$4.50"]].forEach(([a, b], i) => {
        const y = 980 + i * 140;
        g.fillStyle = "#171821";
        g.beginPath();
        g.roundRect(40, y, W - 80, 116, 30);
        g.fill();
        g.fillStyle = "#2a2c38";
        g.beginPath();
        g.arc(110, y + 58, 32, 0, 7);
        g.fill();
        g.fillStyle = "#eceef4";
        g.font = `500 36px ${F}`;
        g.fillText(a, 170, y + 70);
        g.textAlign = "right";
        g.fillStyle = b.startsWith("+") ? accent : "#eceef4";
        g.fillText(b, W - 80, y + 70);
        g.textAlign = "left";
      });
    }
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    screens.set(key, tex);
  }
  return { tex, w: W, h: H };
}
export function clearPlaceholderScreens() {
  screens.forEach((t) => t.dispose());
  screens.clear();
}
