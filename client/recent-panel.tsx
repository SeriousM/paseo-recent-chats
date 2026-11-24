// The body both sidebar surfaces share: the first row (view switch, Hosts, search), the host filter, the
// search box and the Projects or Triage list in a scroll area. The 0.15 sidebar item gives it a set height
// under its own row; the 0.16 sidebar view lets it fill the sidebar.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, View, type ScrollView as NativeScrollView } from "react-native";
import { moveInHistory, useChatHistory } from "./chat-history";
import { useFontScale } from "./font-scale";
import { scoreRow } from "./fuzzy";
import { ProjectsView, ViewModeBar } from "./projects-view";
import { openPluginSettings } from "./runtime";
import { SearchBox } from "./search-box";
import type { TriageRow } from "./triage";
import { CardLayer, HostFilter, ledColor, TriageList, type TriageListProps } from "./triage-list";
import { isEntryGone, openChat, openChatByKey, useRecents, type OpenTarget } from "./use-recents";
import { resolvedView, updateViewMode, useViewMode } from "./view-mode";
import { attachWheelScroll, excludeFromWindowDrag, openPaseoProjectPicker } from "./web";
import { useTouchInput } from "./input";
import { TerminalSearchList } from "./terminal-rows";
import { TerminalFeed } from "./terminals";

// The search box stays open (or closed) until the search button is pressed again, also across remounts.
let searchOpen = false;

/** Back and forward through the chats you had open. `onNavigate` runs before a chat opens (a popup closes). */
export function HistoryButtons({
  theme,
  target,
  onNavigate,
}: {
  theme: PluginTheme;
  target: OpenTarget;
  onNavigate?: () => void;
}) {
  const { store, result } = useRecents();
  const history = useChatHistory();
  const size = useTouchInput() ? 36 : 24;
  const go = (by: -1 | 1) => {
    const key = moveInHistory(by, isEntryGone(store));
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
  target,
  children,
}: {
  theme: PluginTheme;
  target: OpenTarget;
  /** Placed between the counts and the cog (the sidebar item's open/closed caret). */
  children?: React.ReactNode;
}) {
  const { result } = useRecents();
  const { unread, running } = result.counts;
  const fs = useFontScale();
  return (
    <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
      {unread > 0 ? (
        <Text style={{ color: ledColor(theme, result.worstUnread ?? "finished"), fontWeight: "600", fontSize: fs(12) }}>{unread}</Text>
      ) : null}
      {running > 0 ? <Text style={{ color: ledColor(theme, "running"), fontWeight: "600", fontSize: fs(12) }}>{running}</Text> : null}
      {children}
      <HistoryButtons theme={theme} target={target} />
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
  /** Paseo's narrow (phone) layout: the default view and the phone row form follow it. Sizes follow the input. */
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
  const touch = useTouchInput();
  const fs = useFontScale();
  const hiddenHosts = snapshot.hosts.filter((host) => host.hidden);
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
    compact: touch,
    narrow: compact,
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
    <CardLayer style={listHeight === undefined ? { flex: 1, minHeight: 0 } : undefined}>
    <View ref={area} style={listHeight === undefined ? { flex: 1, minHeight: 0 } : null}>
      <ViewModeBar
        theme={theme}
        compact={touch}
        narrow={compact}
        showHosts={snapshot.hosts.length >= 2}
        hostsOpen={hostsOpen}
        onHosts={() => setHostsOpen(!hostsOpen)}
        searchOpen={showSearch}
        onSearch={toggleSearch}
        // Paseo's own Open project picker (Ctrl+O): it browses folders on the host and can create one. Only where
        // the shortcut can be sent (desktop and web); phones have Paseo's own button in the drawer.
        onAddProject={Platform.OS === "web" ? () => void openPaseoProjectPicker() : undefined}
        extra={headerExtra}
      />
      {/* Hosts switched off in the filter: said here, so a missing host's chats do not look lost. */}
      {hiddenHosts.length > 0 && !hostsOpen ? (
        <Text style={{ fontSize: fs(11.5), color: theme.colors.foregroundMuted, paddingHorizontal: 12, paddingBottom: 4 }}>
          {`${hiddenHosts.map((host) => host.label).join(", ")} switched off \u00B7 `}
          <Text accessibilityRole="button" onPress={() => store.updatePrefs({ hiddenHosts: [] })} style={{ color: theme.colors.accent }}>
            show all hosts
          </Text>
        </Text>
      ) : null}
      {hostsOpen && snapshot.hosts.length >= 2 ? (
        <HostFilter
          theme={theme}
          compact={touch}
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
            compact={touch}
            value={query}
            onChange={setQuery}
            placeholder={projects ? "Filter projects, workspaces, chats" : "Filter chats"}
            autoFocus
            onEscape={() => {
              searchOpen = false;
              setShowSearch(false);
              setQuery("");
            }}
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
              compact: touch,
              narrow: compact,
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
          <>
            <TriageList {...listProps} footer="none" />
            {searching ? (
              <TerminalSearchList
                theme={theme}
                compact={touch}
                query={searchText}
                hiddenHosts={hiddenHosts.map((host) => host.id)}
                workspaces={snapshot.workspaces}
                onOpen={() => setQuery("")}
              />
            ) : null}
          </>
        )}
      </ScrollView>
      <TerminalFeed />
      {/* Outside the scroll area, so the chips, Mark all read and All chats stay at the bottom of the list. */}
      {projects || searching ? null : <TriageList {...listProps} footer="only" />}
    </View>
    </CardLayer>
  );
}
