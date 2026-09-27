import { create } from "zustand";

/**
 * UI state for music (kept out of the editor store): whether the picker is open and which audio
 * track the picker/timeline is focused on (null = the first track, or "add a new one").
 */
interface MusicUI {
  open: boolean;
  target: string | null;
  /** bumps when decoded audio arrives, so canvases redraw */
  loaded: number;
}
export const useMusicUI = create<MusicUI>(() => ({ open: false, target: null, loaded: 0 }));
export const openMusic = (target?: string | null) => useMusicUI.setState((s) => ({ open: true, target: target === undefined ? s.target : target }));
export const closeMusic = () => useMusicUI.setState({ open: false });
export const focusTrack = (target: string | null) => useMusicUI.setState({ target });
