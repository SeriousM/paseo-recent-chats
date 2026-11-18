// Whether the main input is a finger, which decides the size of buttons and hit targets. Asked of the device,
// not taken from the layout: a narrow desktop window still has a mouse, and a touch-screen laptop whose main
// input is a trackpad gets desktop sizes (as Paseo 0.16.1 does). Phones and tablets in Paseo's apps are touch.
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

interface MediaQueryList {
  matches: boolean;
  addEventListener?(type: "change", listener: () => void): void;
  removeEventListener?(type: "change", listener: () => void): void;
}

declare const window: { matchMedia?(query: string): MediaQueryList } | undefined;

const query = (): MediaQueryList | null =>
  Platform.OS === "web" && typeof window !== "undefined" && typeof window?.matchMedia === "function"
    ? window.matchMedia("(pointer: coarse)")
    : null;

function subscribe(listener: () => void): () => void {
  const list = query();
  list?.addEventListener?.("change", listener);
  return () => list?.removeEventListener?.("change", listener);
}

/** True on Paseo's phone and tablet apps, and on the web when the primary pointer is coarse (a finger). */
export function isTouchInput(): boolean {
  if (Platform.OS !== "web") return true;
  return query()?.matches ?? false;
}

export function useTouchInput(): boolean {
  return useSyncExternalStore(subscribe, isTouchInput, isTouchInput);
}
