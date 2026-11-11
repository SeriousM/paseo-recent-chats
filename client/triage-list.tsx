import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Animated, Platform, Pressable, Text, View, type ViewStyle } from "react-native";
import { chatTitle, hostColors, withAlpha } from "./format";
import { columnChars, tokenMono, tokenText, tokenValue, visibleLines } from "./row-layout";
import { openPluginSettings } from "./runtime";
import type { Bucket, Led, TriageResult, TriageRow } from "./triage";
import type { RowToken, RowTokenId } from "../shared/layout";
import type { StoreSnapshot } from "./store";
import { hostGroupKey, sectionGroupKey, toggleCollapsed, useCollapsed } from "./collapsed";
import { useOpenChat } from "./open-chat";
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
function isDark(hex: string): boolean {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return true;
  const value = parseInt(match[1], 16);
  const luminance = 0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255);
  return luminance < 140;
}

export function ledColor(theme: PluginTheme, led: Led): string {
  switch (led) {
    case "permission":
      return theme.colors.statusWarning;
    case "error":
      return theme.colors.statusDanger;
    case "finished":
      return theme.colors.accent;
    case "running":
      return theme.colors.statusSuccess;
    default:
      return theme.colors.foregroundMuted;
  }
}

export function LedDot({ led, theme, size = 10 }: { led: Led; theme: PluginTheme; size?: number }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (led !== "running") {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [led, pulse]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: ledColor(theme, led),
        opacity: led === "idle" ? 0.55 : pulse,
      }}
    />
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
  /** False lays the card out in the flow (settings preview) instead of floating under a row. */
  floating?: boolean;
}) {
  const title = chatTitle(row.title, row.provider, row.agentId);
  const alpha = 1 - Math.min(90, Math.max(0, transparency)) / 100;
  const style = useMemo(
    () => ({
      ...(floating
        ? { position: "absolute" as const, top: "100%" as const, left: 18, right: 6, zIndex: 30, elevation: 6, marginTop: 2 }
        : null),
      padding: 8,
      gap: 2,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: withAlpha(theme.colors.border, alpha),
      backgroundColor: withAlpha(theme.colors.surface2, alpha),
    }),
    [theme, alpha, floating],
  );
  const line = { fontSize: 12, color: theme.colors.foreground };
  const label = { color: theme.colors.foregroundMuted };
  return (
    <View pointerEvents="none" style={style}>
      {showHost ? (
        <Text style={line}>
          <Text style={label}>Host </Text>
          {row.hostLabel}
        </Text>
      ) : null}
      <Text style={line}>
        <Text style={label}>Project </Text>
        {row.projectName || "-"}
      </Text>
      <Text style={line}>
        <Text style={label}>Workspace </Text>
        {row.workspaceName || "-"}
      </Text>
      {row.branch ? (
        <Text style={line}>
          <Text style={label}>Branch </Text>
          {row.branch}
        </Text>
      ) : null}
      <Text style={line}>
        <Text style={label}>Agent </Text>
        {row.agentName}
      </Text>
      <Text style={line}>{title}</Text>
    </View>
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
}: RowViewProps) {
  const hostTint = hostColors(hostColor, isDark(theme.colors.surface0));
  const title = chatTitle(row.title, row.provider, row.agentId);
  const fontSize = compact ? 14 : 13;
  const smallFont = compact ? 12 : 11;
  const gap = compact ? 8 : 6;
  const styles = useMemo(
    () => ({
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap,
        minHeight: compact ? 48 : 32,
        paddingVertical: 3,
        // A 3px bar on the left marks the open chat; every row keeps the same width for it.
        paddingLeft: (compact ? 10 : 8) - 3,
        paddingRight: 6,
        borderRadius: 8,
        borderLeftWidth: 3,
        borderLeftColor: current ? theme.colors.accent : "transparent",
        backgroundColor: current ? theme.colors.surface2 : "transparent",
      },
      body: { flex: 1, minWidth: 0, gap: 2 },
      line: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, columnGap: gap, rowGap: 2 },
      host: { paddingVertical: 1, paddingHorizontal: 5, borderRadius: 5, alignItems: "center" as const },
      hostText: { fontSize: 10, fontWeight: "600" as const },
      check: {
        width: compact ? 36 : 26,
        height: compact ? 36 : 26,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
    }),
    [theme, compact, current, gap],
  );
  const state = row.bucket === "unread" ? "unread" : row.bucket === "running" ? "running" : "inactive";
  // The full names appear while the pointer rests on the row (desktop) or after a long press (touch).
  const [showFull, setShowFull] = useState(false);
  const renderToken = (token: RowToken): ReactElement | null => {
    if (token.id === "led") return <LedDot key="led" led={row.led} theme={theme} />;
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
      accessibilityRole="button"
      accessibilityLabel={`${row.hostLabel}, ${row.projectName}, ${row.workspaceName}, ${title}, ${state}`}
      onPress={() => {
        setShowFull(false);
        onOpen(row);
      }}
      onHoverIn={fullNames ? () => setShowFull(true) : undefined}
      onHoverOut={fullNames ? () => setShowFull(false) : undefined}
      onLongPress={fullNames ? () => setShowFull((value) => !value) : undefined}
      style={[styles.row, showFull ? { position: "relative", zIndex: 20 } : null]}
    >
      <View style={styles.body}>
        {lines.map((line, index) =>
          index === 0 || hasContent(line) ? (
            <View key={index} style={[styles.line, index === 0 ? null : { paddingLeft: indent }]}>
              {line.map(renderToken)}
            </View>
          ) : null,
        )}
      </View>
      {row.bucket === "unread" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Mark ${title} read`}
          onPress={() => onMarkRead([row.key])}
          style={styles.check}
        >
          <Icon name="Check" size={14} color={theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}
      {row.bucket === "inactive" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Later: mark ${title} unread`}
          onPress={() => onMarkUnread(row.key)}
          style={styles.check}
        >
          <Icon name="Clock" size={14} color={theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.pinned ? `Unpin ${title}` : `Pin ${title} to the top`}
        accessibilityState={{ selected: row.pinned }}
        onPress={() => onSetPinned(row.key, !row.pinned)}
        style={[styles.check, row.pinned ? { borderColor: theme.colors.accent } : null]}
      >
        <Icon name={row.pinned ? "PinOff" : "Pin"} size={14} color={row.pinned ? theme.colors.accent : theme.colors.foregroundMuted} />
      </Pressable>
      {showFull && fullNames ? <FullNamesCard row={row} theme={theme} showHost={showHost} transparency={cardTransparency} /> : null}
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
  search,
}: {
  theme: PluginTheme;
  compact: boolean;
  hosts: StoreSnapshot["hosts"];
  hostColors: Readonly<Record<string, string>>;
  onToggle(hostId: string): void;
  groupByHost: boolean;
  onToggleGroupByHost(): void;
  /** Search button at the right end of the row; the caller shows the search box while `open`. */
  search?: { open: boolean; onToggle(): void };
}) {
  const dark = isDark(theme.colors.surface0);
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
          style={{ fontSize: 11, fontWeight: "600", color: groupByHost ? theme.colors.accent : theme.colors.foregroundMuted }}
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
                fontSize: 11,
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
      {search ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={search.open ? "Close search" : "Search chats"}
          accessibilityState={{ expanded: search.open }}
          onPress={search.onToggle}
          style={{
            marginLeft: "auto",
            width: compact ? 36 : 24,
            height: compact ? 36 : 24,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 12,
            borderWidth: 1,
            borderColor: search.open ? theme.colors.accent : theme.colors.border,
            backgroundColor: search.open ? theme.colors.surface2 : "transparent",
          }}
        >
          <Icon name="Search" size={12} color={search.open ? theme.colors.accent : theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}
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
        <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "700", color: tint?.text ?? theme.colors.foreground }}>
          {label}
        </Text>
      </View>
      {unread > 0 ? (
        <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>{`${unread} unread`}</Text>
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
  const styles = useMemo(
    () => ({
      headingRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 10,
        paddingTop: 8,
        paddingBottom: 2,
      },
      heading: {
        fontSize: 10.5,
        letterSpacing: 0.7,
        textTransform: "uppercase" as const,
        fontWeight: "600" as const,
        color: theme.colors.foregroundMuted,
      },
      muted: { padding: 12, fontSize: 13, color: theme.colors.foregroundMuted },
      error: { paddingHorizontal: 12, paddingVertical: 4, fontSize: 12, color: theme.colors.statusDanger },
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
      chipText: { fontSize: 12, color: theme.colors.foreground },
      link: { fontSize: 12, color: theme.colors.accent, paddingVertical: compact ? 10 : 4, paddingHorizontal: 4 },
    }),
    [theme, compact],
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
          <LedDot led={chip.led} theme={theme} size={8} />
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
    <View>
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
                  {foldable ? <CollapseChevron theme={theme} collapsed={sectionFolded} /> : null}
                </HeadingRow>
              ) : null}
              {hostFolded || sectionFolded ? null : (
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
              />
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
    </View>
  );
}
