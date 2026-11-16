import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, Text, useWindowDimensions, View, type ViewStyle } from "react-native";
import { useFontScale } from "./font-scale";
import { HeaderControls, RecentPanel } from "./recent-panel";
import { useSidebarViewShown } from "./sidebar-view-state";
import { GO_SCREEN_ID, useRecents } from "./use-recents";
import { NavigationContext, type PaseoNavigation } from "./navigation";
import { attachVerticalDrag } from "./web";

export const RECENT_SCREEN_ID = "recent";

/**
 * The host sidebar stacks its items above a scrolling project list that takes whatever height is left.
 * A tall list here would leave that list no height at all, and nothing could scroll. The list gets its
 * own scroll area of a set share of the window height (prefs, separate for phone drawer and wide sidebar),
 * also when the chats would fit in less. Host chips and search box scroll with it. The grip drags that share.
 */
const MIN_LIST_HEIGHT = 100;
const HEIGHT_PERCENT = { min: 15, max: 85 };
/** Phone drawer height outside the scroll area that holds its header rows: status bar, title, footer. */
const DRAWER_CHROME = 220;

// Stops a touch screen from scrolling the drawer while the grip is dragged; resize cursor on desktop. React Native Web only.
const GRIP_WEB = { touchAction: "none", cursor: "row-resize" } as unknown as ViewStyle;

/**
 * Recent Chats in the sidebar's header area, the only way before Paseo 0.16. On 0.16 the same list can be
 * the whole sidebar (Settings, Sidebar, Sidebar view); while it is, this item stands aside.
 */
export function RecentSidebarItem({ theme, layout, currentScreen, openScreen }: PluginSidebarItemProps) {
  const { store, snapshot } = useRecents();
  const viewShown = useSidebarViewShown();
  // Remembered in prefs, so the list stays open (or closed) across drawer remounts and app restarts.
  const expanded = snapshot.prefs.sidebarExpanded;
  const { height: windowHeight } = useWindowDimensions();
  const fs = useFontScale();
  const heightKey = layout.compact ? "sidebarHeightPhone" : "sidebarHeightDesktop";
  const savedPercent = snapshot.prefs[heightKey];
  // Percent while the grip is dragged; saved once on release so a drag is one settings write.
  const [dragPercent, setDragPercent] = useState<number | null>(null);
  const percent = dragPercent ?? savedPercent;
  // Phones (Paseo 0.16): the drawer puts its header rows, this item among them, in a scroll area of at most
  // half the drawer. A taller item pushes the grip out of sight, so the list is held to what fits there:
  // half the drawer, less what sits above the list (Paseo's rows, this row, the first row) and the grip.
  const [fit, setFit] = useState({ top: 0, overhead: 0 });
  const fitMax = layout.compact ? Math.round((windowHeight - DRAWER_CHROME) / 2) - fit.top - fit.overhead : Number.POSITIVE_INFINITY;
  const maxPercent = Math.min(HEIGHT_PERCENT.max, Math.max(HEIGHT_PERCENT.min, Math.floor((fitMax / windowHeight) * 100)));
  const listHeight = Math.max(MIN_LIST_HEIGHT, Math.min(fitMax, Math.round((windowHeight * percent) / 100)));
  const live = useRef({ windowHeight, savedPercent, heightKey, maxPercent, updatePrefs: store.updatePrefs });
  live.current = { windowHeight, savedPercent, heightKey, maxPercent, updatePrefs: store.updatePrefs };
  // One drag model for both input paths: React Native's responder on phones, pointer events on the web.
  const drag = useMemo(() => {
    let startPercent = 0;
    let current = 0;
    return {
      start() {
        startPercent = Math.min(live.current.savedPercent, live.current.maxPercent);
        current = startPercent;
        setDragPercent(startPercent);
      },
      move(dy: number) {
        const next = Math.round(startPercent + (dy / live.current.windowHeight) * 100);
        current = Math.min(live.current.maxPercent, Math.max(HEIGHT_PERCENT.min, next));
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
  useEffect(() => attachVerticalDrag(gripNode.current, drag), [drag, expanded, viewShown]);
  // The ⋮ menus open and start workspaces: this item has no navigation, so it goes through the go screen,
  // and a new workspace is created here (a worktree off the default branch) before it is opened.
  const navigation = useMemo<PaseoNavigation>(() => {
    const openWorkspace = (hostId: string, workspaceId: string) =>
      openScreen({ screenId: GO_SCREEN_ID, params: { workspaceId, serverId: hostId } });
    return {
      openWorkspace,
      async newWorkspace(hostId, projectId) {
        const workspaceId = await store.newWorktree(hostId, projectId);
        if (workspaceId) openWorkspace(hostId, workspaceId);
      },
    };
  }, [openScreen, store]);

  if (viewShown) return null;
  const target = { openScreen };
  return (
    <View
      onLayout={(event) => {
        const { y, height } = event.nativeEvent.layout;
        const overhead = expanded ? height - listHeight : fit.overhead;
        if (y !== fit.top || overhead !== fit.overhead) setFit({ top: y, overhead });
      }}
    >
      <SidebarRow
        icon="Inbox"
        label="Recent Chats"
        active={currentScreen?.screenId === RECENT_SCREEN_ID}
        onPress={() => store.updatePrefs({ sidebarExpanded: !expanded })}
        trailing={
          <HeaderControls theme={theme} compact={layout.compact} target={target}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: fs(10) }}>{expanded ? "\u25BE" : "\u25B8"}</Text>
          </HeaderControls>
        }
      />
      {expanded ? (
        <View>
          <NavigationContext.Provider value={navigation}>
            <RecentPanel
              theme={theme}
              compact={layout.compact}
              target={target}
              listHeight={listHeight}
              onShowAll={(q) => openScreen({ screenId: RECENT_SCREEN_ID, params: q ? { q } : {} })}
            />
          </NavigationContext.Provider>
          <View
            ref={gripNode}
            {...grip.panHandlers}
            accessibilityRole="adjustable"
            accessibilityLabel="Recent Chats list height"
            accessibilityValue={{ min: HEIGHT_PERCENT.min, max: HEIGHT_PERCENT.max, now: percent }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(event) => {
              const step = event.nativeEvent.actionName === "increment" ? 5 : -5;
              const next = Math.min(maxPercent, Math.max(HEIGHT_PERCENT.min, savedPercent + step));
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
