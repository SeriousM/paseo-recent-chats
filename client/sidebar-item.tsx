import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, SidebarRow } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
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
 * own scroll area, at most this share of the window height. Host chips and search box scroll with it.
 */
/** A phone drawer is short and also holds the project list; a desktop sidebar has room. */
const MAX_LIST_SHARE = { compact: 0.25, wide: 0.5 };
const MIN_LIST_HEIGHT = 100;

// Survives the item remounting; the stored preference only decides the first state.
let userExpanded: boolean | null = null;
// The search box stays open (or closed) until the search button is pressed again, also across remounts.
let searchOpen = false;

export function RecentSidebarItem({ theme, layout, currentScreen, openScreen }: PluginSidebarItemProps) {
  const { store, snapshot, result } = useRecents();
  const [override, setOverride] = useState(userExpanded);
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(searchOpen);
  // A phone drawer has little room: the list starts collapsed there, so the projects below stay reachable.
  const expanded = override ?? (layout.compact ? false : snapshot.prefs.sidebarExpanded);
  const { unread, running } = result.counts;
  const { height: windowHeight } = useWindowDimensions();
  const searching = showSearch && query.trim().length > 0;

  const matches = useMemo(() => (searching ? searchRows(query, result.all) : []), [searching, query, result]);

  const toggle = () => {
    userExpanded = !expanded;
    setOverride(userExpanded);
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
          <ScrollView
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: Math.max(MIN_LIST_HEIGHT, Math.round(windowHeight * (layout.compact ? MAX_LIST_SHARE.compact : MAX_LIST_SHARE.wide))) }}
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
