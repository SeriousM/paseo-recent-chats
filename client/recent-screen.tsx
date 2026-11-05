import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useMemo, useState } from "react";
import { searchRows } from "./fuzzy";
import { SearchBox } from "./search-box";
import { SettingsCog, TriageList } from "./triage-list";
import { openChat, useRecents } from "./use-recents";

/** Every chat in triage order, with search. The escape hatch behind the "+N more" chips. */
export function RecentScreen({ theme, layout, navigation, params }: PluginScreenProps) {
  const { store, snapshot, result } = useRecents();
  const [query, setQuery] = useState(params.q ?? "");
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
          searching={searching}
          onOpen={(row) => openChat(store, row, navigation ? { navigation } : {})}
          onMarkRead={store.markRead}
          onMarkUnread={store.markUnread}
          onSetPinned={store.setPinned}
        />
      </ScrollView>
    </View>
  );
}
