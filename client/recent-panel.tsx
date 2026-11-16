// The body both sidebar surfaces share: the first row (view switch, Hosts, search), the host filter, the
// search box and the Projects or Triage list in a scroll area. The 0.15 sidebar item gives it a set height
// under its own row; the 0.16 sidebar view lets it fill the sidebar.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type ScrollView as NativeScrollView } from "react-native";
import { moveInHistory, useChatHistory } from "./chat-history";
import { useFontScale } from "./font-scale";
import { scoreRow } from "./fuzzy";
import { ProjectsView, ViewModeBar } from "./projects-view";
import { openPluginSettings } from "./runtime";
import { SearchBox } from "./search-box";
import type { TriageRow } from "./triage";
import { HostFilter, ledColor, TriageList, type TriageListProps } from "./triage-list";
import { openChat, openChatByKey, useRecents, type OpenTarget } from "./use-recents";
import { resolvedView, updateViewMode, useViewMode } from "./view-mode";
import { attachWheelScroll, excludeFromWindowDrag } from "./web";

// The search box stays open (or closed) until the search button is pressed again, also across remounts.
let searchOpen = false;

/** Back and forward through the chats you had open. `onNavigate` runs before a chat opens (a popup closes). */
export function HistoryButtons({
  theme,
  compact,
  target,
  onNavigate,
}: {
  theme: PluginTheme;
  compact: boolean;
  target: OpenTarget;
  onNavigate?: () => void;
}) {
  const { store, result } = useRecents();
  const history = useChatHistory();
  const size = compact ? 36 : 24;
  const go = (by: -1 | 1) => {
    const key = moveInHistory(by);
    if (!key) return;
    onNavigate?.();
    openChatByKey(store, result.all, key, target);
  };
  const button = (by: -1 | 1, enabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={by < 0 ? "Back to the previous chat" : "Forward to the next chat"}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={() => go(by)}
      hitSlop={4}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center", borderRadius: 6, opacity: enabled ? 1 : 0.35 }}
    >
      <Icon name={by < 0 ? "ArrowLeft" : "ArrowRight"} size={14} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
  return (
    <>
      {button(-1, history.index > 0)}
      {button(1, history.index < history.entries.length - 1)}
    </>
  );
}

/** Back and forward through visited chats, the unread and running counts, and the settings cog. */
export function HeaderControls({
  theme,
  compact,
  target,
  children,
}: {
  theme: PluginTheme;
  compact: boolean;
  target: OpenTarget;
  /** Placed between the counts and the cog (the sidebar item's open/closed caret). */
  children?: React.ReactNode;
}) {
  const { result } = useRecents();
  const { unread, running } = result.counts;
  const fs = useFontScale();
  const size = compact ? 36 : 24;
  return (
    <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
      {unread > 0 ? (
        <Text style={{ color: ledColor(theme, result.worstUnread ?? "finished"), fontWeight: "600", fontSize: fs(12) }}>{unread}</Text>
      ) : null}
      {running > 0 ? <Text style={{ color: ledColor(theme, "running"), fontWeight: "600", fontSize: fs(12) }}>{running}</Text> : null}
      {children}
      <HistoryButtons theme={theme} compact={compact} target={target} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Recent Chats settings"
        onPress={openPluginSettings}
        style={{ width: size, height: size, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
      >
        <Icon name="Settings" size={14} color={theme.colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}

export function RecentPanel({
  theme,
  compact,
  target,
  listHeight,
  onShowAll,
  headerExtra,
}: {
  theme: PluginTheme;
  compact: boolean;
  /** How a chat is opened from this surface. */
  target: OpenTarget;
  /** A set height for the scroll area; without one it fills the space it is given. */
  listHeight?: number;
  /** Opens the full list; without it Triage lists every chat itself. */
  onShowAll?: (query: string) => void;
  /** Controls at the end of the first row (the sidebar view puts back, forward, counts and cog there). */
  headerExtra?: React.ReactNode;
}) {
  const { store, snapshot, result } = useRecents();
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(searchOpen);
  const [hostsOpen, setHostsOpen] = useState(false);
  const viewMode = useViewMode();
  const projects = resolvedView(viewMode, compact) === "projects";
  // Project and workspace pins made while pins were kept on this device: moved to the synced settings once.
  useEffect(() => {
    if (!viewMode.legacyPins.length) return;
    const pins = snapshot.prefs.treePins;
    store.updatePrefs({ treePins: [...pins, ...viewMode.legacyPins.filter((pin) => !pins.includes(pin))] });
    updateViewMode({ legacyPins: [] });
  }, [viewMode.legacyPins, snapshot.prefs.treePins, store]);
  // Search filters what either view shows, drawn the same way.
  const searchText = showSearch ? query : "";
  const searching = searchText.trim().length > 0;
  const scroll = useRef<NativeScrollView>(null);
  const area = useRef<View>(null);
  // Out of the desktop window's drag area (which would swallow drags and the wheel), and the wheel
  // scrolls the list anywhere over it, even before the panel has been clicked once.
  useEffect(() => {
    excludeFromWindowDrag(area.current);
    return attachWheelScroll(scroll.current, area.current);
  }, []);
  // Triage: every matching chat while searching; every chat when there is no full list to show the rest.
  const rows = useMemo(
    () => (searching ? result.all.filter((row) => scoreRow(searchText, row) !== null) : onShowAll ? undefined : result.all),
    [searching, searchText, result, onShowAll],
  );
  const open = (row: TriageRow) => {
    setQuery("");
    openChat(store, row, target);
  };
  const listProps: TriageListProps = {
    theme,
    compact,
    result,
    rows,
    snapshot,
    onToggleHost: store.toggleHost,
    onToggleGroupByHost: () => store.updatePrefs({ groupByHost: !snapshot.prefs.groupByHost }),
    onToggleSort: store.toggleSort,
    onOpen: open,
    onMarkRead: store.markRead,
    onMarkUnread: store.markUnread,
    onSetPinned: store.setPinned,
    onRename: store.renameChat,
    hideHostFilter: true,
    onShowAll: onShowAll ? () => onShowAll(searching ? searchText : "") : undefined,
  };
  const toggleSearch = () => {
    searchOpen = !showSearch;
    setShowSearch(searchOpen);
    if (!searchOpen) setQuery("");
  };

  return (
    <View ref={area} style={listHeight === undefined ? { flex: 1, minHeight: 0 } : null}>
      <ViewModeBar
        theme={theme}
        compact={compact}
        showHosts={snapshot.hosts.length >= 2}
        hostsOpen={hostsOpen}
        onHosts={() => setHostsOpen(!hostsOpen)}
        searchOpen={showSearch}
        onSearch={toggleSearch}
        extra={headerExtra}
      />
      {hostsOpen && snapshot.hosts.length >= 2 ? (
        <HostFilter
          theme={theme}
          compact={compact}
          hosts={snapshot.hosts}
          hostColors={snapshot.hostColors}
          onToggle={store.toggleHost}
          groupByHost={projects ? snapshot.prefs.projectsGroupByHost : snapshot.prefs.groupByHost}
          onToggleGroupByHost={() =>
            projects
              ? store.updatePrefs({ projectsGroupByHost: !snapshot.prefs.projectsGroupByHost })
              : store.updatePrefs({ groupByHost: !snapshot.prefs.groupByHost })
          }
        />
      ) : null}
      {showSearch ? (
        <View style={{ paddingHorizontal: 8, paddingBottom: 4 }}>
          <SearchBox
            theme={theme}
            compact={compact}
            value={query}
            onChange={setQuery}
            placeholder={projects ? "Filter projects, workspaces, chats" : "Filter chats"}
            autoFocus
          />
        </View>
      ) : null}
      <ScrollView
        ref={scroll}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={listHeight === undefined ? { flex: 1 } : { height: listHeight }}
      >
        {projects ? (
          <ProjectsView
            query={searchText}
            snapshot={snapshot}
            rows={result.all}
            rowShared={{
              theme,
              compact,
              fullNames: snapshot.prefs.showTooltip,
              cardTransparency: snapshot.prefs.tooltipTransparency,
              onOpen: open,
              onMarkRead: store.markRead,
              onMarkUnread: store.markUnread,
              onSetPinned: store.setPinned,
              onRename: store.renameChat,
            }}
          />
        ) : (
          <TriageList {...listProps} footer="none" />
        )}
      </ScrollView>
      {/* Outside the scroll area, so the chips, Mark all read and All chats stay at the bottom of the list. */}
      {projects || searching ? null : <TriageList {...listProps} footer="only" />}
    </View>
  );
}
