import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Animated, Easing, Platform, Pressable, Text, View, type ViewStyle } from "react-native";
import { chatTitle, hostColors, withAlpha } from "./format";
import { columnChars, tokenMono, tokenText, tokenValue, visibleLines } from "./row-layout";
import { openPluginSettings } from "./runtime";
import type { Bucket, Led, TriageResult, TriageRow } from "./triage";
import type { RowToken, RowTokenId } from "../shared/layout";
import type { StoreSnapshot } from "./store";
import { hostGroupKey, sectionGroupKey, toggleCollapsed, useCollapsed } from "./collapsed";
import { useOpenChat } from "./open-chat";
import { RenameField } from "./rename-field";
import { onDoubleClick } from "./web";
import { useFontScale } from "./font-scale";
import type { Section } from "../shared/sections";

const HEADINGS: Record<Section, string> = {
  pinned: "Pinned",
  unread: "Needs you",
  running: "Running",
  inactive: "Inactive",
};

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, Consolas, monospace" });

/** The native animation driver does not exist on web; react-native-web would warn and fall back anyway. */
const NATIVE_DRIVER = Platform.OS !== "web";

/** Hex surface colour -> true when it is a dark theme. Unparseable values count as dark. */
export function isDark(hex: string): boolean {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return true;
  const value = parseInt(match[1], 16);
  const luminance = 0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255);
  return luminance < 140;
}

/**
 * Paseo's own sidebar status-dot colours (`statusDot*` in the app's styles/theme.ts, mapped by its
 * getStatusDotColor). The plugin theme does not carry them, so they are copied here per light and dark.
 */
const STATUS_DOT = {
  light: { asking: "#b37824", failed: "#f12e2f", running: "#268ae0", ready: "#299f51" },
  dark: { asking: "#db932e", failed: "#f7796d", running: "#5caaf6", ready: "#35c264" },
} as const;

/** As in Paseo: asking (a question or permission) amber, failed red, running blue, ready (finished, unseen) green; inactive grey. */
export function ledColor(theme: PluginTheme, led: Led): string {
  const dots = STATUS_DOT[isDark(theme.colors.surface0) ? "dark" : "light"];
  switch (led) {
    case "permission":
      return dots.asking;
    case "error":
      return dots.failed;
    case "running":
      return dots.running;
    case "finished":
      return dots.ready;
    default:
      return theme.colors.foregroundMuted;
  }
}

/** Paseo's running ring: one turn in 0.9 s, as in its session tabs (app components/status-ring). */
const RING_PERIOD_MS = 900;
/** The "?" of a chat asking you fades out and back in this slowly. */
const ASK_PULSE_MS = 900;

// Done and failed as 12x12 SVG paths. Done is a plain tick: bold while the agent is loaded, thin once released.
// Failed: a filled triangle with the "!" cut out (even-odd) while loaded, outlined once released.
const GLYPHS = {
  done: {
    loaded: (c: string) =>
      `<path d="M2 6.4 4.8 9.2 10 3.4" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
    released: (c: string) =>
      `<path d="M2.3 6.4 4.8 8.9 9.7 3.6" fill="none" stroke="${c}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  failed: {
    loaded: (c: string) =>
      `<path fill="${c}" fill-rule="evenodd" d="M6 .6 11.5 10.9H.5ZM5.25 4.2h1.5v3.4h-1.5ZM6 8.25a.8.8 0 1 0 0 1.6a.8.8 0 1 0 0-1.6Z"/>`,
    released: (c: string) =>
      `<path d="M6 1.3 11 10.5H1Z" fill="none" stroke="${c}" stroke-width="1.2" stroke-linejoin="round"/><path d="M6 4.6V7.1" stroke="${c}" stroke-width="1.3" stroke-linecap="round"/><circle cx="6" cy="8.8" r=".75" fill="${c}"/>`,
  },
} as const;

function useLoop(active: boolean, duration: number, run: (value: Animated.Value) => Animated.CompositeAnimation) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    value.setValue(0);
    const loop = Animated.loop(run(value));
    loop.start();
    return () => loop.stop();
    // `run` only builds the animation; the loop restarts when the state or its timing changes.
  }, [active, duration, value]);
  return value;
}

/**
 * A chat's state as a symbol: Paseo's turning ring while it runs, a pulsing "?" while it asks you (a
 * question or permission request), a check when done, a warning triangle when failed. Done and failed are
 * filled while the agent is in memory and outlined once Paseo has released it. Inactive chats show how
 * they last ended, in grey.
 */
export function LedDot({
  led,
  theme,
  size = 12,
  released = false,
  failed = false,
}: {
  led: Led;
  theme: PluginTheme;
  size?: number;
  released?: boolean;
  failed?: boolean;
}) {
  const color = ledColor(theme, led);
  const spin = useLoop(led === "running", RING_PERIOD_MS, (value) =>
    Animated.timing(value, { toValue: 1, duration: RING_PERIOD_MS, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER }),
  );
  const pulse = useLoop(led === "permission", ASK_PULSE_MS, (value) =>
    Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: ASK_PULSE_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE_DRIVER }),
      Animated.timing(value, { toValue: 0, duration: ASK_PULSE_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE_DRIVER }),
    ]),
  );
  const glyph = led === "error" || (led === "idle" && failed) ? "failed" : "done";
  const svg = useMemo(
    () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12">${GLYPHS[glyph][released ? "released" : "loaded"](color)}</svg>`,
    [glyph, released, color],
  );
  const box = { width: size, height: size, alignItems: "center" as const, justifyContent: "center" as const };

  if (led === "running") {
    // Paseo's proportions: a centre dot of half the size, a faint track, and a brighter quarter turning on it.
    const stroke = size / 8;
    const circle = { position: "absolute" as const, width: size, height: size, borderRadius: size / 2, borderWidth: stroke };
    return (
      <View style={box}>
        <View style={[circle, { borderColor: color, opacity: 0.3 }]} />
        <Animated.View
          style={[
            circle,
            {
              borderColor: "transparent",
              borderTopColor: color,
              opacity: 0.9,
              transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
            },
          ]}
        />
        <View style={{ width: size / 2, height: size / 2, borderRadius: size / 4, backgroundColor: color }} />
      </View>
    );
  }
  if (led === "permission") {
    return (
      <View style={box}>
        <Animated.Text
          style={{
            color,
            fontSize: size + 2,
            lineHeight: size + 2,
            fontWeight: "800",
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] }),
          }}
        >
          ?
        </Animated.Text>
      </View>
    );
  }
  return (
    <View style={[box, led === "idle" ? { opacity: 0.7 } : null]}>
      <Icon icon={{ svg }} size={size} color={color} />
    </View>
  );
}

const MIN_FLEX_WIDTH = 56;
const BRANCH_ICON_SIZE = 11;
const BRANCH_ICON_GAP = 4;
const BRANCH_ICON_SPACE = BRANCH_ICON_SIZE + BRANCH_ICON_GAP;

/** Rough pixel width of `chars` characters; monospace tokens are exact, the others an average. */
function columnPixels(mono: boolean, chars: number, fontSize: number): number {
  return Math.ceil(chars * fontSize * (mono ? 0.6 : 0.56));
}

/** Card with the untruncated names of a row. Shown under the row while it is hovered or long-pressed. */
export function FullNamesCard({
  row,
  theme,
  showHost,
  transparency,
  floating = true,
}: {
  row: TriageRow;
  theme: PluginTheme;
  showHost: boolean;
  /** 0 = solid, 90 = almost see-through. */
  transparency: number;
  /** False lays the card out in the flow (settings preview, card layer) instead of floating under a row. */
  floating?: boolean;
}) {
  const title = chatTitle(row.title, row.provider, row.agentId);
  const alpha = 1 - Math.min(90, Math.max(0, transparency)) / 100;
  const fs = useFontScale();
  const muted = theme.colors.foregroundMuted;
  const small = { fontSize: fs(11.5), color: muted };
  const style = useMemo(
    () => ({
      ...(floating
        ? { position: "absolute" as const, top: "100%" as const, left: 18, right: 6, zIndex: 30, elevation: 6, marginTop: 2 }
        : null),
      paddingVertical: 8,
      paddingHorizontal: 10,
      gap: 5,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: withAlpha(theme.colors.border, alpha),
      backgroundColor: withAlpha(theme.colors.surface2, alpha),
    }),
    [theme, alpha, floating],
  );
  const place = [row.projectName, row.workspaceName].filter(Boolean).join(" \u203A ");
  return (
    <View pointerEvents="none" style={style}>
      <Text style={{ fontSize: fs(13), fontWeight: "600", color: theme.colors.foreground }}>{title}</Text>
      {place || showHost ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="Folder" size={11} color={muted} />
          <Text style={[small, { flex: 1 }]}>{place || "-"}</Text>
          {showHost ? <Text style={[small, { fontWeight: "600" }]}>{row.hostLabel}</Text> : null}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="Bot" size={11} color={muted} />
        <Text numberOfLines={1} style={[small, { flexShrink: 0 }]}>
          {row.agentName}
        </Text>
        {row.branch ? (
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
            <Icon name="GitBranch" size={11} color={muted} />
            <Text numberOfLines={1} style={[small, { flexShrink: 1, fontFamily: MONO }]}>
              {row.branch}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

interface CardLayerApi {
  /** "card": under the row, nearly its width. "tip": a small label under the owner, its right edge aligned. */
  show(owner: View, card: ReactNode, place?: "card" | "tip"): void;
  hide(owner: View): void;
}

const CardLayerContext = createContext<CardLayerApi | null>(null);

/**
 * Draws the full-names card of a hovered row, and button tooltips, above everything in the list. React
 * Native Web gives every view its own stacking order, so a card inside its row is covered by whatever comes
 * after the row's section or workspace, which looked like a see-through card. Wrap a whole list in this.
 */
export function CardLayer({ children }: { children: ReactNode }) {
  const container = useRef<View>(null);
  const containerWidth = useRef(0);
  const [card, setCard] = useState<{ owner: View; node: ReactNode; style: ViewStyle } | null>(null);
  const api = useMemo<CardLayerApi>(
    () => ({
      show(owner, node, place = "card") {
        const root = container.current;
        if (!root) return;
        owner.measureLayout(
          root,
          (x, y, width, height) =>
            setCard({
              owner,
              node,
              style:
                place === "tip"
                  ? { top: y + height + 4, right: Math.max(0, containerWidth.current - x - width) }
                  : { top: y + height + 2, left: x + 18, width: Math.max(160, width - 24) },
            }),
          () => {},
        );
      },
      hide(owner) {
        setCard((current) => (current?.owner === owner ? null : current));
      },
    }),
    [],
  );
  return (
    <CardLayerContext.Provider value={api}>
      <View
        ref={container}
        onLayout={(event) => {
          containerWidth.current = event.nativeEvent.layout.width;
        }}
      >
        {children}
        {card ? (
          <View pointerEvents="none" style={[{ position: "absolute", zIndex: 30 }, card.style]}>
            {card.node}
          </View>
        ) : null}
      </View>
    </CardLayerContext.Provider>
  );
}

/** Hover this long before a tooltip shows. */
const TIP_DELAY_MS = 600;

/**
 * An icon button whose label appears as a tooltip after the pointer rests on it (web and desktop). The
 * label is also its accessibility label. Needs a CardLayer around it for the tooltip.
 */
export function TipButton({
  theme,
  compact,
  icon,
  label,
  onPress,
}: {
  theme: PluginTheme;
  compact: boolean;
  icon: string;
  label: string;
  onPress(): void;
}) {
  const node = useRef<View>(null);
  const layer = useContext(CardLayerContext);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fs = useFontScale();
  const hide = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (node.current) layer?.hide(node.current);
  };
  useEffect(() => hide, []);
  const tip = (
    <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface2 }}>
      <Text numberOfLines={1} style={{ fontSize: fs(11), color: theme.colors.foreground }}>
        {label}
      </Text>
    </View>
  );
  return (
    <Pressable
      ref={node}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        hide();
        onPress();
      }}
      onHoverIn={() => {
        hide();
        timer.current = setTimeout(() => {
          if (node.current) layer?.show(node.current, tip, "tip");
        }, TIP_DELAY_MS);
      }}
      onHoverOut={hide}
      hitSlop={4}
      style={({ pressed }) => ({ padding: compact ? 8 : 4, borderRadius: 6, opacity: pressed ? 0.6 : 1 })}
    >
      <Icon name={icon} size={compact ? 14 : 12} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}

export interface RowViewProps {
  row: TriageRow;
  theme: PluginTheme;
  compact: boolean;
  showHost: boolean;
  /** Colour name the user picked for this row's host in Paseo; undefined when none. */
  hostColor: string | undefined;
  /** Enabled tokens per line, in display order. */
  lines: readonly (readonly RowToken[])[];
  /** Column widths in characters for capped tokens (see columnChars). */
  columns: Partial<Record<RowTokenId, number>>;
  current: boolean;
  /** Hover and long press reveal the full names. Off in the settings preview, which has no room for the card. */
  fullNames?: boolean;
  /** How see-through the full-names card is, 0-90 percent. */
  cardTransparency?: number;
  onOpen(row: TriageRow): void;
  onMarkRead(keys: readonly string[]): void;
  /** Later: mark an inactive chat unread. */
  onMarkUnread(key: string): void;
  /** Pin or unpin the chat. */
  onSetPinned(key: string, pinned: boolean): void;
  /** Present where chats can be renamed: long press (or double-click on the web) opens a title field. */
  onRename?: (key: string, title: string) => Promise<void>;
}

export function TriageRowView({
  row,
  theme,
  compact,
  showHost,
  hostColor,
  lines,
  columns,
  current,
  fullNames = true,
  cardTransparency = 0,
  onOpen,
  onMarkRead,
  onMarkUnread,
  onSetPinned,
  onRename,
}: RowViewProps) {
  const hostTint = hostColors(hostColor, isDark(theme.colors.surface0));
  const title = chatTitle(row.title, row.provider, row.agentId);
  const fs = useFontScale();
  const fontSize = fs(compact ? 14 : 13);
  const smallFont = fs(compact ? 12 : 11);
  const gap = compact ? 8 : 6;
  const styles = useMemo(
    () => ({
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap,
        minHeight: compact ? 48 : 32,
        paddingVertical: 3,
        paddingLeft: compact ? 10 : 8,
        paddingRight: 6,
        borderRadius: 8,
        // The open chat gets a faint accent wash: no line, so it does not compete with the Needs you frame.
        backgroundColor: current ? withAlpha(theme.colors.accent, 0.14) : "transparent",
      },
      body: { flex: 1, minWidth: 0, gap: 2 },
      line: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, columnGap: gap, rowGap: 2 },
      host: { paddingVertical: 1, paddingHorizontal: 5, borderRadius: 5, alignItems: "center" as const },
      hostText: { fontSize: fs(10), fontWeight: "600" as const },
      // Plain icons, the size of the tree's pin buttons: no outline, so they do not compete with the row.
      check: {
        width: compact ? 32 : 20,
        height: compact ? 32 : 20,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
    }),
    [theme, compact, current, gap, fs],
  );
  const state = row.bucket === "unread" ? "unread" : row.bucket === "running" ? "running" : "inactive";
  // The full names appear while the pointer rests on the row (desktop) or after a long press (touch, where
  // long press renames instead when renaming is offered).
  const [showFull, setShowFull] = useState(false);
  const [editing, setEditing] = useState(false);
  const rowNode = useRef<View>(null);
  const layer = useContext(CardLayerContext);
  const cardShown = showFull && fullNames === true && !editing;
  // In a card layer the card is drawn on top of the whole list; without one (settings preview) under the row.
  useEffect(() => {
    const owner = rowNode.current;
    if (!layer || !owner) return;
    if (!cardShown) {
      layer.hide(owner);
      return;
    }
    layer.show(owner, <FullNamesCard row={row} theme={theme} showHost={showHost} transparency={cardTransparency} floating={false} />);
    return () => layer.hide(owner);
  }, [layer, cardShown, row, theme, showHost, cardTransparency]);
  const startRename = onRename
    ? () => {
        setShowFull(false);
        setEditing(true);
      }
    : null;
  const latestStart = useRef(startRename);
  latestStart.current = startRename;
  useEffect(() => onDoubleClick(rowNode.current, () => latestStart.current?.()), []);
  const renderToken = (token: RowToken): ReactElement | null => {
    if (token.id === "led") return <LedDot key="led" led={row.led} released={row.released} failed={row.failed} theme={theme} />;
    if (token.id === "host" && !showHost) return null;
    const text = tokenText(row, token);
    const mono = tokenMono(token);
    const chars = columns[token.id];
    if (chars === 0) return null;
    if (token.id === "host") {
      return (
        <View
          key="host"
          style={[
            styles.host,
            {
              backgroundColor: hostTint?.background ?? theme.colors.surface2,
              ...(chars ? { width: Math.ceil(chars * 6.2) + 10 } : null),
            },
          ]}
        >
          <Text
            numberOfLines={1}
            style={[styles.hostText, { color: hostTint?.text ?? theme.colors.foregroundMuted, fontFamily: mono ? MONO : undefined }]}
          >
            {text}
          </Text>
        </View>
      );
    }
    // Unlimited text takes the rest of the line but never less than MIN_FLEX_WIDTH: below that it wraps to
    // the next visual line instead of vanishing.
    const fixed =
      chars === undefined
        ? { flexGrow: 1, flexShrink: 1, flexBasis: MIN_FLEX_WIDTH, minWidth: 0 }
        : { width: columnPixels(mono, chars, smallFont) };
    const isTitle = token.id === "title";
    if (token.id === "branch") {
      // No branch: no icon. A capped column keeps its width so the tokens after it stay in column.
      if (text.length === 0) {
        return chars === undefined ? null : (
          <View key="branch" style={{ width: columnPixels(mono, chars, smallFont) + BRANCH_ICON_SPACE }} />
        );
      }
      return (
        <View
          key="branch"
          style={[
            chars === undefined ? fixed : { width: columnPixels(mono, chars, smallFont) + BRANCH_ICON_SPACE },
            { flexDirection: "row", alignItems: "center", gap: BRANCH_ICON_GAP },
          ]}
        >
          <Icon name="GitBranch" size={BRANCH_ICON_SIZE} color={theme.colors.foregroundMuted} />
          <Text
            numberOfLines={1}
            style={{ flex: 1, minWidth: 0, fontSize: smallFont, fontFamily: mono ? MONO : undefined, color: theme.colors.foregroundMuted }}
          >
            {text}
          </Text>
        </View>
      );
    }
    return (
      <Text
        key={token.id}
        numberOfLines={1}
        style={[
          fixed,
          {
            fontSize: isTitle ? fontSize : smallFont,
            fontFamily: mono ? MONO : undefined,
            color: isTitle && row.bucket !== "inactive" ? theme.colors.foreground : theme.colors.foregroundMuted,
          },
        ]}
      >
        {text}
      </Text>
    );
  };

  // Lines after the first start under the first line's leading host tag and light, so text stays in column.
  const first = lines[0] ?? [];
  let indent = 0;
  for (const token of first) {
    if (token.id !== "host" && token.id !== "led") break;
    if (token.id === "led") indent += 10 + gap;
    else if (showHost) {
      const chars = columns.host;
      indent += (chars ? Math.ceil(chars * 6.2) + 10 : 44) + gap;
    }
  }
  const hasContent = (line: readonly RowToken[]) =>
    line.some((token) => token.id === "led" || (token.id === "host" ? showHost : tokenValue(row, token.id).length > 0));

  return (
    <Pressable
      ref={rowNode}
      accessibilityRole="button"
      accessibilityLabel={`${row.hostLabel}, ${row.projectName}, ${row.workspaceName}, ${title}, ${state}`}
      accessibilityHint={onRename ? "Long press to rename" : undefined}
      onPress={
        editing
          ? undefined
          : () => {
              setShowFull(false);
              onOpen(row);
            }
      }
      onHoverIn={fullNames && !editing ? () => setShowFull(true) : undefined}
      onHoverOut={fullNames ? () => setShowFull(false) : undefined}
      onLongPress={editing ? undefined : (startRename ?? (fullNames ? () => setShowFull((value) => !value) : undefined))}
      style={[styles.row, cardShown && !layer ? { position: "relative", zIndex: 20 } : null]}
    >
      {editing && onRename ? (
        <RenameField
          theme={theme}
          compact={compact}
          initial={row.title ?? ""}
          onSave={(next) => onRename(row.key, next)}
          onClose={() => setEditing(false)}
        />
      ) : (
      <View style={styles.body}>
        {lines.map((line, index) =>
          index === 0 || hasContent(line) ? (
            <View key={index} style={[styles.line, index === 0 ? null : { paddingLeft: indent }]}>
              {line.map(renderToken)}
            </View>
          ) : null,
        )}
      </View>
      )}
      {editing ? null : (
        <>
      {row.bucket === "unread" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Mark ${title} read`}
          onPress={() => onMarkRead([row.key])}
          hitSlop={6}
          style={styles.check}
        >
          <Icon name="Check" size={12} color={theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}
      {row.bucket === "inactive" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Later: mark ${title} unread`}
          onPress={() => onMarkUnread(row.key)}
          hitSlop={6}
          style={styles.check}
        >
          <Icon name="Clock" size={12} color={theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.pinned ? `Unpin ${title}` : `Pin ${title} to the top`}
        accessibilityState={{ selected: row.pinned }}
        onPress={() => onSetPinned(row.key, !row.pinned)}
        hitSlop={6}
        style={styles.check}
      >
        <Icon name={row.pinned ? "PinOff" : "Pin"} size={12} color={row.pinned ? theme.colors.accent : theme.colors.foregroundMuted} />
      </Pressable>
        </>
      )}
      {cardShown && !layer ? <FullNamesCard row={row} theme={theme} showHost={showHost} transparency={cardTransparency} /> : null}
    </Pressable>
  );
}

/** Cog button that opens this plugin's settings screen. */
export function SettingsCog({ theme, compact }: { theme: PluginTheme; compact: boolean }) {
  const size = compact ? 40 : 28;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Recent Chats settings"
      onPress={openPluginSettings}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center", borderRadius: 8 }}
    >
      <Icon name="Settings" size={16} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}

/** One chip per host (pressing it switches the host's chats on or off in every list), preceded by a toggle that groups rows by host. */
export function HostFilter({
  theme,
  compact,
  hosts,
  hostColors: colorNames,
  onToggle,
  groupByHost,
  onToggleGroupByHost,
}: {
  theme: PluginTheme;
  compact: boolean;
  hosts: StoreSnapshot["hosts"];
  hostColors: Readonly<Record<string, string>>;
  onToggle(hostId: string): void;
  groupByHost: boolean;
  onToggleGroupByHost(): void;
}) {
  const dark = isDark(theme.colors.surface0);
  const fs = useFontScale();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 6 }}>
      {hosts.length >= 2 ? (
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="Group rows by host"
        accessibilityState={{ checked: groupByHost }}
        onPress={onToggleGroupByHost}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          minHeight: compact ? 36 : 24,
          paddingHorizontal: 10,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: groupByHost ? theme.colors.accent : theme.colors.border,
          backgroundColor: groupByHost ? theme.colors.surface2 : "transparent",
        }}
      >
        <Icon name="Layers" size={12} color={groupByHost ? theme.colors.accent : theme.colors.foregroundMuted} />
        <Text
          style={{ fontSize: fs(11), fontWeight: "600", color: groupByHost ? theme.colors.accent : theme.colors.foregroundMuted }}
        >
          Group
        </Text>
      </Pressable>
      ) : null}
      {hosts.length >= 2 ? hosts.map((host) => {
        const tint = hostColors(colorNames[host.id], dark);
        const on = !host.hidden;
        return (
          <Pressable
            key={host.id}
            accessibilityRole="checkbox"
            accessibilityLabel={`Show chats of ${host.label}`}
            accessibilityState={{ checked: on }}
            onPress={() => onToggle(host.id)}
            style={{
              minHeight: compact ? 36 : 24,
              paddingHorizontal: 10,
              justifyContent: "center",
              borderRadius: 12,
              borderWidth: 1,
              borderColor: on ? (tint?.text ?? theme.colors.border) : theme.colors.border,
              backgroundColor: on ? (tint?.background ?? theme.colors.surface2) : "transparent",
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                fontSize: fs(11),
                fontWeight: "600",
                color: on ? (tint?.text ?? theme.colors.foreground) : theme.colors.foregroundMuted,
                textDecorationLine: on ? "none" : "line-through",
              }}
            >
              {host.label}
            </Text>
          </Pressable>
        );
      }) : null}
    </View>
  );
}

/** Heading above one host's rows when rows are grouped by host. */
export function HostHeading({
  theme,
  label,
  colorName,
  unread,
  collapsed,
  onToggleCollapsed,
}: {
  theme: PluginTheme;
  label: string;
  colorName: string | undefined;
  unread: number;
  /** With a handler, the heading folds the host's rows away when pressed; a chevron shows the state. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const tint = hostColors(colorName, isDark(theme.colors.surface0));
  const fs = useFontScale();
  const content = (
    <>
      <View
        style={{
          paddingHorizontal: 8,
          paddingVertical: 2,
          borderRadius: 6,
          backgroundColor: tint?.background ?? theme.colors.surface2,
        }}
      >
        <Text numberOfLines={1} style={{ fontSize: fs(12), fontWeight: "700", color: tint?.text ?? theme.colors.foreground }}>
          {label}
        </Text>
      </View>
      {unread > 0 ? (
        <Text style={{ fontSize: fs(11), color: theme.colors.foregroundMuted }}>{`${unread} unread`}</Text>
      ) : null}
      {onToggleCollapsed ? <CollapseChevron theme={theme} collapsed={collapsed ?? false} /> : null}
    </>
  );
  const style = { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 2 };
  return (
    <HeadingRow style={style} label={label} collapsed={collapsed ?? false} onToggleCollapsed={onToggleCollapsed}>
      {content}
    </HeadingRow>
  );
}

/** A heading row; with a handler it folds its group when pressed. Buttons inside (the sort icon) keep their own press. */
function HeadingRow({
  label,
  collapsed,
  onToggleCollapsed,
  style,
  children,
}: {
  label: string;
  collapsed: boolean;
  onToggleCollapsed: (() => void) | undefined;
  style: ViewStyle;
  children: ReactNode;
}) {
  if (!onToggleCollapsed) return <View style={style}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${collapsed ? "Show" : "Hide"} ${label}`}
      accessibilityState={{ expanded: !collapsed }}
      onPress={onToggleCollapsed}
      style={({ pressed }) => [style, pressed ? { opacity: 0.6 } : null]}
    >
      {children}
    </Pressable>
  );
}

/** Chevron on the right of a heading: down while the group is open, right while it is folded. */
function CollapseChevron({ theme, collapsed }: { theme: PluginTheme; collapsed: boolean }) {
  return (
    <View style={{ marginLeft: "auto", padding: 2 }}>
      <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={14} color={theme.colors.foregroundMuted} />
    </View>
  );
}

export interface TriageListProps {
  theme: PluginTheme;
  compact: boolean;
  result: TriageResult;
  rows?: readonly TriageRow[];
  snapshot: StoreSnapshot;
  /** Switches a host on or off in the host filter. */
  onToggleHost(hostId: string): void;
  /** Switches grouping of rows by host on or off. */
  onToggleGroupByHost(): void;
  /** Switches a section between oldest first and newest first (the icon in its heading). */
  onToggleSort(section: Section): void;
  onOpen(row: TriageRow): void;
  onMarkRead(keys: readonly string[]): void;
  /** Later: mark an inactive chat unread. */
  onMarkUnread(key: string): void;
  /** Pin or unpin a chat. */
  onSetPinned(key: string, pinned: boolean): void;
  /** Sets a chat's title (long press or double-click on a row). */
  onRename(key: string, title: string): Promise<void>;
  /** The caller shows the host filter itself (the sidebar puts it above its search box). */
  hideHostFilter?: boolean;
  /** Present when the list is capped; shows the hidden-count chips and the all-chats link. */
  onShowAll?: () => void;
  /**
   * Where the footer (hidden-count chips, Mark all read, All chats) goes. "first": popups scroll as one
   * unit, so a footer at the end would be cut off below the fold. "none"/"only": the caller renders the
   * footer as a second TriageList outside its scroll area, so it stays at the bottom.
   */
  footer?: "first" | "last" | "none" | "only";
  /** The rows are search results: no group headings, no footer, host tag whenever several hosts are listed. */
  searching?: boolean;
  /** Adds a cog to the footer that opens the plugin settings. */
  showSettingsButton?: boolean;
}

export function TriageList({
  theme,
  compact,
  result,
  rows,
  snapshot,
  onToggleHost,
  onToggleGroupByHost,
  onToggleSort,
  onOpen,
  onMarkRead,
  onMarkUnread,
  onSetPinned,
  onRename,
  hideHostFilter = false,
  onShowAll,
  footer = "last",
  searching = false,
  showSettingsButton = false,
}: TriageListProps) {
  const folded = useCollapsed();
  // Highlighted wherever the list is shown: the chat whose composer is on screen.
  const openKey = useOpenChat();
  const shown = rows ?? result.rows;
  const { prefs, hostCount, hosts, hostColors: hostColorNames, loading, errors } = snapshot;
  const grouped = prefs.groupByHost && !searching;
  const showHost = hostCount > 1 && !grouped;
  const unreadByHost = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of result.all) if (row.bucket === "unread") counts[row.hostId] = (counts[row.hostId] ?? 0) + 1;
    return counts;
  }, [result]);
  const lines = useMemo(() => visibleLines(prefs.layout), [prefs.layout]);
  const columns = useMemo(() => columnChars(shown, prefs.layout), [shown, prefs.layout]);
  const fs = useFontScale();
  const styles = useMemo(
    () => ({
      // Same spacing as the Projects view's Pinned heading: chevron first, rows indented under it.
      headingRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: compact ? 8 : 4,
        marginTop: 4,
      },
      section: { paddingLeft: 12 },
      heading: {
        fontSize: fs(10.5),
        letterSpacing: 0.7,
        textTransform: "uppercase" as const,
        fontWeight: "600" as const,
        color: theme.colors.foregroundMuted,
      },
      muted: { padding: 12, fontSize: fs(13), color: theme.colors.foregroundMuted },
      error: { paddingHorizontal: 12, paddingVertical: 4, fontSize: fs(12), color: theme.colors.statusDanger },
      footer: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        marginTop: 4,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      },
      chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        minHeight: compact ? 36 : 24,
        paddingHorizontal: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      },
      chipText: { fontSize: fs(12), color: theme.colors.foreground },
      link: { fontSize: fs(12), color: theme.colors.accent, paddingVertical: compact ? 10 : 4, paddingHorizontal: 4 },
    }),
    [theme, compact, fs],
  );

  const chips: { bucket: Bucket; led: Led; text: string }[] = [];
  if (onShowAll) {
    if (result.hidden.unread)
      chips.push({ bucket: "unread", led: result.worstUnread ?? "finished", text: `+${result.hidden.unread} unread` });
    if (result.hidden.running)
      chips.push({ bucket: "running", led: "running", text: `+${result.hidden.running} running` });
    if (result.hidden.inactive)
      chips.push({ bucket: "inactive", led: "idle", text: `+${result.hidden.inactive} older` });
  }

  const footerNode = onShowAll && !searching ? (
    <View style={styles.footer}>
      {chips.map((chip) => (
        <Pressable key={chip.bucket} accessibilityRole="button" onPress={onShowAll} style={styles.chip}>
          <LedDot led={chip.led} theme={theme} size={10} />
          <Text style={styles.chipText}>{chip.text}</Text>
        </Pressable>
      ))}
      {result.counts.unread > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onMarkRead(result.all.filter((row) => row.bucket === "unread").map((row) => row.key))}
        >
          <Text style={styles.link}>Mark all read</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" onPress={onShowAll} style={{ marginLeft: "auto" }}>
        <Text style={styles.link}>All chats</Text>
      </Pressable>
      {showSettingsButton ? <SettingsCog theme={theme} compact={compact} /> : null}
    </View>
  ) : null;

  const emptyText = searching
    ? "No chat matches."
    : hostCount === 0 && hosts.length > 0
      ? "Every host is switched off above."
      : loading
        ? "Loading chats\u2026"
        : "Nothing to look at.";

  if (footer === "only") return footerNode;

  return (
    <CardLayer>
      {hosts.length >= 2 && !hideHostFilter ? (
        <HostFilter
          theme={theme}
          compact={compact}
          hosts={hosts}
          hostColors={hostColorNames}
          onToggle={onToggleHost}
          groupByHost={prefs.groupByHost}
          onToggleGroupByHost={onToggleGroupByHost}
        />
      ) : null}
      {footer === "first" ? footerNode : null}
      {shown.length === 0 ? (
        <Text style={styles.muted}>{emptyText}</Text>
      ) : (
        shown.map((row, index) => {
          const previous = shown[index - 1];
          const hostChanged = grouped && previous?.hostId !== row.hostId;
          const section = row.pinned ? "pinned" : row.bucket;
          const previousSection = previous ? (previous.pinned ? "pinned" : previous.bucket) : null;
          const hostKey = hostGroupKey(row.hostId);
          const hostFolded = grouped && folded.has(hostKey);
          const headings = prefs.groupHeadings && !searching;
          const sectionKey = sectionGroupKey(section, grouped ? row.hostId : null);
          // Needs you never folds away: it is what the list is for.
          const foldable = section !== "unread";
          const sectionFolded = headings && foldable && folded.has(sectionKey);
          return (
            <Fragment key={row.key}>
              {hostChanged ? (
                <HostHeading
                  theme={theme}
                  label={row.hostLabel}
                  colorName={hostColorNames[row.hostId]}
                  unread={unreadByHost[row.hostId] ?? 0}
                  collapsed={hostFolded}
                  onToggleCollapsed={() => toggleCollapsed(hostKey)}
                />
              ) : null}
              {headings && !hostFolded && (hostChanged || previousSection !== section) ? (
                <HeadingRow
                  style={styles.headingRow}
                  label={HEADINGS[section]}
                  collapsed={sectionFolded}
                  onToggleCollapsed={foldable ? () => toggleCollapsed(sectionKey) : undefined}
                >
                  {foldable ? (
                    <Icon name={sectionFolded ? "ChevronRight" : "ChevronDown"} size={12} color={theme.colors.foregroundMuted} />
                  ) : (
                    <View style={{ width: 12 }} />
                  )}
                  {/* Same icons as the sort toggle in the settings; pressing it switches the direction. */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${HEADINGS[section]}, ${prefs.sectionSort[section]} first. Switch.`}
                    onPress={() => onToggleSort(section)}
                    hitSlop={compact ? 12 : 6}
                    style={({ pressed }) => ({ padding: 2, borderRadius: 4, opacity: pressed ? 0.5 : 1 })}
                  >
                    <Icon
                      name={prefs.sectionSort[section] === "oldest" ? "ArrowDownNarrowWide" : "ArrowDownWideNarrow"}
                      size={compact ? 14 : 12}
                      color={theme.colors.foregroundMuted}
                    />
                  </Pressable>
                  <Text style={styles.heading}>{HEADINGS[section]}</Text>
                </HeadingRow>
              ) : null}
              {hostFolded || sectionFolded ? null : (
              <View style={headings ? styles.section : null}>
              <TriageRowView
                row={row}
                theme={theme}
                compact={compact}
                showHost={showHost}
                hostColor={hostColorNames[row.hostId]}
                lines={lines}
                columns={columns}
                current={row.key === openKey}
                fullNames={prefs.showTooltip}
                cardTransparency={prefs.tooltipTransparency}
                onOpen={onOpen}
                onMarkRead={onMarkRead}
                onMarkUnread={onMarkUnread}
                onSetPinned={onSetPinned}
                onRename={onRename}
              />
              </View>
              )}
            </Fragment>
          );
        })
      )}
      {errors.map((error) => (
        <Text key={error} style={styles.error}>
          {error}
        </Text>
      ))}
      {footer === "last" ? footerNode : null}
    </CardLayer>
  );
}
