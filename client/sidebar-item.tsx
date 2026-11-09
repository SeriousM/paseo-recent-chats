import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, SidebarRow } from "@getpaseo/plugin/client/ui";
import { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, Text, useWindowDimensions, View, type ViewStyle } from "react-native";
import { searchRows } from "./fuzzy";
import { openPluginSettings } from "./runtime";
import { SearchBox } from "./search-box";
import { HostFilter, ledColor, TriageList } from "./triage-list";
import { openChat, useRecents } from "./use-recents";

export const RECENT_SCREEN_ID = "recent";

/** Search results shown in the sidebar; the rest are reached through "All chats". */
const SEARCH_LIMIT = 15;

/**
 * The host sidebar stacks its items above a scrolling project list that takes whatever height is left.
 * A tall list here would leave that list no height at all, and nothing could scroll. The list gets its
 * own scroll area, at most a share of the window height (prefs, separate for phone drawer and wide
 * sidebar). Host chips and search box scroll with it. The grip under the list drags that share.
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
  const searching = showSearch && query.trim().length > 0;

  const matches = useMemo(() => (searching ? searchRows(query, result.all) : []), [searching, query, result]);
  const heightKey = layout.compact ? "sidebarHeightPhone" : "sidebarHeightDesktop";
  const savedPercent = snapshot.prefs[heightKey];
  // Percent while the grip is dragged; saved once on release so a drag is one settings write.
  const [dragPercent, setDragPercent] = useState<number | null>(null);
  const percent = dragPercent ?? savedPercent;
  const listHeight = Math.max(MIN_LIST_HEIGHT, Math.round((windowHeight * percent) / 100));
  const live = useRef({ windowHeight, savedPercent, heightKey, updatePrefs: store.updatePrefs });
  live.current = { windowHeight, savedPercent, heightKey, updatePrefs: store.updatePrefs };
  const grip = useMemo(() => {
    let startPercent = 0;
    let current = 0;
    const end = () => {
      const { heightKey: key, savedPercent: saved, updatePrefs } = live.current;
      if (current !== saved) updatePrefs({ [key]: current });
      setDragPercent(null);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        startPercent = live.current.savedPercent;
        current = startPercent;
        setDragPercent(startPercent);
      },
      onPanResponderMove: (_event, gesture) => {
        const next = Math.round(startPercent + (gesture.dy / live.current.windowHeight) * 100);
        current = Math.min(HEIGHT_PERCENT.max, Math.max(HEIGHT_PERCENT.min, next));
        setDragPercent(current);
      },
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    });
  }, []);

  const toggle = () => store.updatePrefs({ sidebarExpanded: !expanded });

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
          <ScrollView
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: listHeight }}
          >
          <HostFilter
            theme={theme}
            compact={layout.compact}
            hosts={snapshot.hosts}
            hostColors={snapshot.hostColors}
            onToggle={store.toggleHost}
            groupByHost={snapshot.prefs.groupByHost}
            onToggleGroupByHost={() => store.updatePrefs({ groupByHost: !snapshot.prefs.groupByHost })}
            search={{ open: showSearch, onToggle: toggleSearch }}
          />
          {showSearch ? (
            <View style={{ paddingHorizontal: 8, paddingBottom: 4 }}>
              <SearchBox theme={theme} compact={layout.compact} value={query} onChange={setQuery} autoFocus />
            </View>
          ) : null}
          <TriageList
            theme={theme}
            compact={layout.compact}
            result={result}
            rows={searching ? matches.slice(0, SEARCH_LIMIT) : undefined}
            snapshot={snapshot}
            onToggleHost={store.toggleHost}
            onToggleGroupByHost={() => store.updatePrefs({ groupByHost: !snapshot.prefs.groupByHost })}
            searching={searching}
            onOpen={open}
            onMarkRead={store.markRead}
            onMarkUnread={store.markUnread}
            onSetPinned={store.setPinned}
            hideHostFilter
            onShowAll={() => openScreen({ screenId: RECENT_SCREEN_ID, params: searching ? { q: query } : {} })}
          />
          </ScrollView>
          <View
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
          {searching && matches.length > SEARCH_LIMIT ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => openScreen({ screenId: RECENT_SCREEN_ID, params: { q: query } })}
              style={{ paddingHorizontal: 12, paddingVertical: layout.compact ? 12 : 6 }}
            >
              <Text style={{ color: theme.colors.accent, fontSize: 12 }}>
                {`+${matches.length - SEARCH_LIMIT} more matches in All chats`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
