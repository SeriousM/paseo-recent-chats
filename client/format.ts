// Display helpers for list rows. Pure.

/** Cut to `max` characters, ending with an ellipsis when something was removed. */
export function ellipsize(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}\u2026` : text;
}

/**
 * Paseo's own identity palette (host colours in Settings > Host). The plugin SDK does not expose a
 * host's configured colour, so the names come from the app's saved host list (see web.ts) and are
 * mapped here to the same values the app uses.
 */
const HOST_PALETTE = {
  violet: { light: "#6d49b5", dark: "#a392d5", tint: "#7a6aa8" },
  sky: { light: "#3d6985", dark: "#6aa6ce", tint: "#3d7ea6" },
  emerald: { light: "#3e6e5d", dark: "#6cae96", tint: "#388068" },
  orange: { light: "#845838", dark: "#cc8f64", tint: "#a4673a" },
  pink: { light: "#974168", dark: "#d87da3", tint: "#b05c80" },
  indigo: { light: "#5251c2", dark: "#9299d5", tint: "#6a70b8" },
  teal: { light: "#3e6d6c", dark: "#6cacab", tint: "#368080" },
  red: { light: "#9c4243", dark: "#d88381", tint: "#b06260" },
  amber: { light: "#716239", dark: "#b29d64", tint: "#8f7838" },
  blue: { light: "#39649e", dark: "#7ba1d5", tint: "#5179b0" },
} as const;

export interface HostColors {
  text: string;
  background: string;
}

/** Colours for a configured host colour name; null for "none" and unknown names. */
export function hostColors(name: string | undefined, dark: boolean): HostColors | null {
  const entry = name && name in HOST_PALETTE ? HOST_PALETTE[name as keyof typeof HOST_PALETTE] : null;
  return entry ? { text: dark ? entry.dark : entry.light, background: `${entry.tint}2e` } : null;
}

/** serverId -> colour name from the app's saved host list (JSON). Hosts without a colour are left out. */
export function parseHostColorNames(raw: string | null): Record<string, string> {
  const names: Record<string, string> = {};
  if (!raw) return names;
  try {
    const hosts: unknown = JSON.parse(raw);
    if (!Array.isArray(hosts)) return names;
    for (const host of hosts) {
      const color = host?.appearance?.color;
      if (typeof host?.serverId === "string" && typeof color === "string" && color in HOST_PALETTE) {
        names[host.serverId] = color;
      }
    }
  } catch {
    // Unreadable list: no colours.
  }
  return names;
}

/** Short agent name for a row: the model's last path segment ("vendor/claude/opus-5.5" -> "opus-5.5"), else the provider. */
export function agentLabel(model: string | null | undefined, provider: string): string {
  const last = model?.split("/").filter(Boolean).pop()?.trim();
  return last || provider;
}

/** Title for a row; chats without a title show provider and a short id. */
export function chatTitle(title: string | null, provider: string, agentId: string): string {
  const trimmed = title?.trim();
  return trimmed ? trimmed : `${provider} ${agentId.slice(0, 6)}`;
}

/**
 * Same colour with an alpha channel, for "#rgb" and "#rrggbb". `alpha` is clamped to 0..1.
 * Other colour formats are returned unchanged (they cannot be made see-through here).
 */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match?.[1]) return color;
  const hex = match[1].length === 3 ? Array.from(match[1], (char) => char + char).join("") : match[1];
  const value = parseInt(hex, 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${a})`;
}
