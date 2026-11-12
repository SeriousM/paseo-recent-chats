// Text in the sidebar list follows the interface font size set in Paseo (Settings, Appearance), like
// Paseo's own workspace list. Paseo scales its type ramp by that size over its default of 14 px; the
// list's sizes are authored for 14 px and scale the same way. The app does not announce a change, so
// the setting is re-read every few seconds while a list is on screen.
import { useSyncExternalStore } from "react";
import { readUiFontSize } from "./web";

/** Paseo's default interface font size on web and desktop, the size this plugin's text is authored for. */
const BASE_UI_FONT_SIZE = 14;
const POLL_MS = 3000;

let scale = 1;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function refresh(): void {
  const next = (readUiFontSize() ?? BASE_UI_FONT_SIZE) / BASE_UI_FONT_SIZE;
  if (next === scale) return;
  scale = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    refresh();
    timer = setInterval(refresh, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** A font size authored for Paseo's default, scaled to the interface size the user chose. */
export type FontSizer = (size: number) => number;

const sizers = new Map<number, FontSizer>();
function sizerFor(value: number): FontSizer {
  let sizer = sizers.get(value);
  if (!sizer) {
    sizer = (size) => Math.round(size * value * 2) / 2;
    sizers.set(value, sizer);
  }
  return sizer;
}

export function useFontScale(): FontSizer {
  const value = useSyncExternalStore(subscribe, () => scale);
  return sizerFor(value);
}
