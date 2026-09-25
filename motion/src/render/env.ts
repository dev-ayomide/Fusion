import * as THREE from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";

/**
 * Image-based lighting from CC0 HDRIs (@pmndrs/assets, Poly Haven originals). Loaded lazily, one
 * equirect per name, then PMREM-filtered per renderer. Until one arrives, the procedural room is used.
 */
const LOADERS: Record<string, () => Promise<{ default: string }>> = {
  studio: () => import("@pmndrs/assets/hdri/studio.exr.js"),
  city: () => import("@pmndrs/assets/hdri/city.exr.js"),
  sky: () => import("@pmndrs/assets/hdri/sky.exr.js"),
  sunset: () => import("@pmndrs/assets/hdri/sunset.exr.js"),
  dawn: () => import("@pmndrs/assets/hdri/dawn.exr.js"),
  night: () => import("@pmndrs/assets/hdri/night.exr.js"),
  park: () => import("@pmndrs/assets/hdri/park.exr.js"),
  warehouse: () => import("@pmndrs/assets/hdri/warehouse.exr.js"),
  lobby: () => import("@pmndrs/assets/hdri/lobby.exr.js"),
  forest: () => import("@pmndrs/assets/hdri/forest.exr.js"),
};
export const ENV_NAMES = Object.keys(LOADERS);

const equirects = new Map<string, Promise<THREE.DataTexture | null>>();
const ready = new Map<string, THREE.DataTexture>();
const listeners = new Set<() => void>();
export function onEnvReady(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function loadEnv(name: string): Promise<THREE.DataTexture | null> {
  let p = equirects.get(name);
  if (!p) {
    const loader = LOADERS[name];
    p = loader
      ? loader()
          .then((m) => new EXRLoader().loadAsync(m.default))
          .then((tex) => {
            tex.mapping = THREE.EquirectangularReflectionMapping;
            ready.set(name, tex);
            listeners.forEach((f) => f());
            return tex;
          })
          .catch(() => null)
      : Promise.resolve(null);
    equirects.set(name, p);
  }
  return p;
}

/** The equirect for a name if loaded (kicks off loading otherwise). */
export function envEquirect(name: string): THREE.DataTexture | null {
  const t = ready.get(name);
  if (!t) void loadEnv(name);
  return t ?? null;
}
