import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useEffect, useMemo, useState } from "react";
import { searchRows } from "./fuzzy";
import { NavigationContext, type PaseoNavigation } from "./navigation";
import { RecentPanel } from "./recent-panel";
import { SearchBox } from "./search-box";
import { PHONE_ROW_ONLY } from "./sidebar-item";
import { SettingsCog, TriageList } from "./triage-list";
import { openChat, useRecents } from "./use-recents";
import { useFontScale } from "./font-scale";

/**
 * Phones on Paseo 0.16: the sidebar item is only a row that opens this screen, so the screen is the whole
 * list, Projects and Triage, as the sidebar shows it elsewhere.
 */
function PhoneScreen({ theme, layout, navigation }: PluginScreenProps) {
  const { store } = useRecents();
  const fs = useFontScale();
  const paseoNavigation = useMemo<PaseoNavigation | null>(() => {
    const openWorkspace = navigation?.openWorkspace;
    if (!openWorkspace) return null;
    const open = (hostId: string, workspaceId: string) => openWorkspace({ workspaceId, serverId: hostId });
    return {
      openWorkspace: open,
      async newWorkspace(hostId, projectId) {
        const workspaceId = await store.newWorktree(hostId, projectId);
        if (workspaceId) open(hostId, workspaceId);
      },
    };
  }, [navigation, store]);
  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 }}>
      <NavigationContext.Provider value={paseoNavigation}>
        <RecentPanel theme={theme} compact={layout.compact} target={navigation ? { navigation } : {}} />
      </NavigationContext.Provider>
      <Text style={{ fontSize: fs(11), color: theme.colors.foregroundMuted, paddingHorizontal: 12, paddingVertical: 8 }}>
        To have this list in the drawer instead: Paseo Settings, Sidebar, Sidebar view, Recent Chats.
      </Text>
    </View>
  );
}

/** Every chat in triage order, with search. The escape hatch behind the "+N more" chips. */
export function RecentScreen(props: PluginScreenProps) {
  if (props.layout.compact && PHONE_ROW_ONLY && !props.params.q) return <PhoneScreen {...props} />;
  return <TriageScreen {...props} />;
}

function TriageScreen({ theme, layout, navigation, params }: PluginScreenProps) {
  const { store, snapshot, result } = useRecents();
  const [query, setQuery] = useState(params.q ?? "");
  // Reopened with another query (the sidebar's "more matches" link) while this screen is already showing.
  useEffect(() => setQuery(params.q ?? ""), [params.q]);
  const searching = query.trim().length > 0;
  const rows = useMemo(() => searchRows(query, result.all), [result, query]);
  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: layout.compact ? 12 : 20, gap: 12 },
      bar: { flexDirection: "row" as const, gap: 10, alignItems: "center" as const },
      action: { color: theme.colors.accent, paddingVertical: 10, paddingHorizontal: 4 },
      summary: { color: theme.colors.foregroundMuted, fontSize: 12 },
    }),
    [theme, layout.compact],
  );
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.bar}>
          <View style={{ flex: 1 }}>
            <SearchBox
              theme={theme}
              compact={layout.compact}
              value={query}
              onChange={setQuery}
              placeholder="Search title, project, workspace, branch, agent or host"
            />
          </View>
          {result.counts.unread > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => store.markRead(result.all.filter((row) => row.bucket === "unread").map((row) => row.key))}
            >
              <Text style={styles.action}>Mark all read</Text>
            </Pressable>
          ) : null}
          <SettingsCog theme={theme} compact={layout.compact} />
        </View>
        <Text style={styles.summary}>
          {searching
            ? `${rows.length} of ${result.all.length} chats match`
            : `${result.counts.unread} unread, ${result.counts.running} running, ${result.counts.inactive} inactive`}
        </Text>
        <TriageList
          theme={theme}
          compact={layout.compact}
          result={result}
          rows={rows}
          snapshot={snapshot}
          onToggleHost={store.toggleHost}
          onToggleGroupByHost={() => store.updatePrefs({ groupByHost: !snapshot.prefs.groupByHost })}
          onToggleSort={store.toggleSort}
          searching={searching}
          onOpen={(row) => openChat(store, row, navigation ? { navigation } : {})}
          onMarkRead={store.markRead}
          onMarkUnread={store.markUnread}
          onSetPinned={store.setPinned}
          onRename={store.renameChat}
        />
      </ScrollView>
    </View>
  );
}
