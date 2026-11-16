import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, Text, useWindowDimensions, View, type ViewStyle } from "react-native";
import { useFontScale } from "./font-scale";
import { HeaderControls, RecentPanel } from "./recent-panel";
import { useSidebarViewShown } from "./sidebar-view-state";
import { useRecents } from "./use-recents";
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
  useEffect(() => attachVerticalDrag(gripNode.current, drag), [drag, expanded, viewShown]);

  if (viewShown) return null;
  const target = { openScreen };
  return (
    <View>
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
          <RecentPanel
            theme={theme}
            compact={layout.compact}
            target={target}
            listHeight={listHeight}
            onShowAll={(q) => openScreen({ screenId: RECENT_SCREEN_ID, params: q ? { q } : {} })}
          />
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
