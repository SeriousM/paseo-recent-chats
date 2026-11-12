import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, SidebarRow } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, Pressable, Text, useWindowDimensions, View, type ScrollView as NativeScrollView, type ViewStyle } from "react-native";
import { scoreRow } from "./fuzzy";
import { openPluginSettings } from "./runtime";
import { SearchBox } from "./search-box";
import { HostFilter, ledColor, TriageList, type TriageListProps } from "./triage-list";
import { openChat, useRecents } from "./use-recents";
import { ProjectsView, ViewModeBar } from "./projects-view";
import { resolvedView, updateViewMode, useViewMode } from "./view-mode";
import { attachVerticalDrag, attachWheelScroll } from "./web";

export const RECENT_SCREEN_ID = "recent";

/**
 * The host sidebar stacks its items above a scrolling project list that takes whatever height is left.
 * A tall list here would leave that list no height at all, and nothing could scroll. The list gets its
 * own scroll area of a set share of the window height (prefs, separate for phone drawer and wide sidebar),
 * also when the chats would fit in less. Host chips and search box scroll with it. The grip drags that share.
 */
const MIN_LIST_HEIGHT = 100;
const HEIGHT_PERCENT = { min: 15, max: 85 };

// Stops a touch screen from scrolling the drawer while the grip is dragged; resize cursor on desktop. React Native Web only.
const GRIP_WEB = { touchAction: "none", cursor: "row-resize" } as unknown as ViewStyle;

// The search box stays open (or closed) until the search button is pressed again, also across remounts.
let searchOpen = false;

export function RecentSidebarItem({ theme, layout, currentScreen, openScreen }: PluginSidebarItemProps) {
  const { store, snapshot, result } = useRecents();
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(searchOpen);
  // Remembered in prefs, so the list stays open (or closed) across drawer remounts and app restarts.
  const expanded = snapshot.prefs.sidebarExpanded;
  const { unread, running } = result.counts;
  const { height: windowHeight } = useWindowDimensions();
  const viewMode = useViewMode();
  const projects = resolvedView(viewMode, layout.compact) === "projects";
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
  const [hostsOpen, setHostsOpen] = useState(false);
  const scroll = useRef<NativeScrollView>(null);
  // The wheel scrolls the list even before the panel has been clicked once.
  useEffect(() => attachWheelScroll(scroll.current), [expanded]);

  // Triage: every matching chat, in its section, uncapped.
  const matches = useMemo(
    () => (searching ? result.all.filter((row) => scoreRow(searchText, row) !== null) : undefined),
    [searching, searchText, result],
  );
  const heightKey = layout.compact ? "sidebarHeightPhone" : "sidebarHeightDesktop";
  const savedPercent = snapshot.prefs[heightKey];
  // Percent while the grip is dragged; saved once on release so a drag is one settings write.
  const [dragPercent, setDragPercent] = useState<number | null>(null);
  const percent = dragPercent ?? savedPercent;
  const listHeight = Math.max(MIN_LIST_HEIGHT, Math.round((windowHeight * percent) / 100));
  const live = useRef({ windowHeight, savedPercent, heightKey, updatePrefs: store.updatePrefs });
  live.current = { windowHeight, savedPercent, heightKey, updatePrefs: store.updatePrefs };
  // One drag model for both input paths: React Native's responder on phones, pointer events on the web.
  const drag = useMemo(() => {
    let startPercent = 0;
    let current = 0;
    return {
      start() {
        startPercent = live.current.savedPercent;
        current = startPercent;
        setDragPercent(startPercent);
      },
      move(dy: number) {
        const next = Math.round(startPercent + (dy / live.current.windowHeight) * 100);
        current = Math.min(HEIGHT_PERCENT.max, Math.max(HEIGHT_PERCENT.min, next));
        setDragPercent(current);
      },
      end() {
        const { heightKey: key, savedPercent: saved, updatePrefs } = live.current;
        if (current !== saved) updatePrefs({ [key]: current });
        setDragPercent(null);
      },
    };
  }, []);
  const grip = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => Platform.OS !== "web",
        onMoveShouldSetPanResponder: () => Platform.OS !== "web",
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: drag.start,
        onPanResponderMove: (_event, gesture) => drag.move(gesture.dy),
        onPanResponderRelease: drag.end,
        onPanResponderTerminate: drag.end,
      }),
    [drag],
  );
  const gripNode = useRef<View>(null);
  useEffect(() => attachVerticalDrag(gripNode.current, drag), [drag, expanded]);

  const toggle = () => store.updatePrefs({ sidebarExpanded: !expanded });
  const listProps: TriageListProps = {
    theme,
    compact: layout.compact,
    result,
    rows: matches,
    snapshot,
    onToggleHost: store.toggleHost,
    onToggleGroupByHost: () => store.updatePrefs({ groupByHost: !snapshot.prefs.groupByHost }),
    onToggleSort: store.toggleSort,
    onOpen: (row) => open(row),
    onMarkRead: store.markRead,
    onMarkUnread: store.markUnread,
    onSetPinned: store.setPinned,
    onRename: store.renameChat,
    hideHostFilter: true,
    onShowAll: () => openScreen({ screenId: RECENT_SCREEN_ID, params: searching ? { q: searchText } : {} }),
  };

  const cog = layout.compact ? 36 : 24;
  const summary = (
    <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
      {unread > 0 ? (
        <Text style={{ color: ledColor(theme, result.worstUnread ?? "finished"), fontWeight: "600", fontSize: 12 }}>
          {unread}
        </Text>
      ) : null}
      {running > 0 ? (
        <Text style={{ color: ledColor(theme, "running"), fontWeight: "600", fontSize: 12 }}>{running}</Text>
      ) : null}
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>{expanded ? "\u25BE" : "\u25B8"}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Recent Chats settings"
        onPress={openPluginSettings}
        style={{ width: cog, height: cog, alignItems: "center", justifyContent: "center", borderRadius: 6 }}
      >
        <Icon name="Settings" size={14} color={theme.colors.foregroundMuted} />
      </Pressable>
    </View>
  );

  const toggleSearch = () => {
    searchOpen = !showSearch;
    setShowSearch(searchOpen);
    if (!searchOpen) setQuery("");
  };

  const open = (row: Parameters<typeof openChat>[1]) => {
    setQuery("");
    openChat(store, row, { openScreen });
  };

  return (
    <View>
      <SidebarRow
        icon="Inbox"
        label="Recent Chats"
        active={currentScreen?.screenId === RECENT_SCREEN_ID}
        onPress={toggle}
        trailing={summary}
      />
      {expanded ? (
        <View>
          <ViewModeBar
            theme={theme}
            compact={layout.compact}
            showHosts={snapshot.hosts.length >= 2}
            hostsOpen={hostsOpen}
            onHosts={() => setHostsOpen(!hostsOpen)}
            searchOpen={showSearch}
            onSearch={toggleSearch}
          />
          {hostsOpen && snapshot.hosts.length >= 2 ? (
            <HostFilter
              theme={theme}
              compact={layout.compact}
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
                compact={layout.compact}
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
            style={{ height: listHeight }}
          >
          {projects ? (
            <ProjectsView
              query={searchText}
              snapshot={snapshot}
              rows={result.all}
              rowShared={{
                theme,
                compact: layout.compact,
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
          <View
            ref={gripNode}
            {...grip.panHandlers}
            accessibilityRole="adjustable"
            accessibilityLabel="Recent Chats list height"
            accessibilityValue={{ min: HEIGHT_PERCENT.min, max: HEIGHT_PERCENT.max, now: percent }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(event) => {
              const step = event.nativeEvent.actionName === "increment" ? 5 : -5;
              const next = Math.min(HEIGHT_PERCENT.max, Math.max(HEIGHT_PERCENT.min, savedPercent + step));
              if (next !== savedPercent) store.updatePrefs({ [heightKey]: next });
            }}
            style={[{ height: layout.compact ? 24 : 12, alignItems: "center", justifyContent: "center" }, GRIP_WEB]}
          >
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: dragPercent === null ? theme.colors.border : theme.colors.accent,
              }}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}
