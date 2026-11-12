import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useMemo, useRef, useState, type ReactElement } from "react";
import { PanResponder, Pressable, Text, View, type ViewStyle } from "react-native";
import type { Section } from "../shared/sections";
import type { Prefs } from "../shared/settings";
import { listDropIndex } from "./drag-target";
import { IconButton } from "./layout-editor";
import { measureIn } from "./measure";

const LABELS: Record<Section, string> = {
  pinned: "Pinned",
  unread: "Needs you",
  running: "Running",
  inactive: "Inactive",
};

/** What each section sorts its chats on. */
const SORT_HINTS: Record<Section, string> = {
  pinned: "By when it was pinned. Always listed in full.",
  unread: "By when it started waiting.",
  running: "By when its turn started.",
  inactive: "By its last message.",
};

type NumericPref = "maxUnread" | "maxRunning" | "maxInactive" | "inactiveWindowDays" | "unreadExpiryDays";

interface NumericSetting {
  key: NumericPref;
  label: string;
  hint: string;
  presets: readonly number[];
  unit?: string;
}

/** The size settings of each section, shown under it. */
const SIZE_SETTINGS: Record<Section, readonly NumericSetting[]> = {
  pinned: [],
  unread: [
    { key: "maxUnread", label: "Chats shown", hint: "The rest appear as a +N chip. Per host when grouped.", presets: [3, 4, 5, 6, 8, 10, 15, 20] },
    { key: "unreadExpiryDays", label: "Expiry", hint: "Chats waiting longer count as inactive.", presets: [1, 3, 7, 14, 30], unit: " days" },
  ],
  running: [
    { key: "maxRunning", label: "Chats shown", hint: "0 hides them (the +N chip still counts them).", presets: [0, 1, 2, 3, 4, 5, 8, 10] },
  ],
  inactive: [
    { key: "maxInactive", label: "Chats shown", hint: "0 hides them.", presets: [0, 2, 3, 4, 5, 8, 10, 15] },
    { key: "inactiveWindowDays", label: "Window", hint: "Chats older than this stay out of the short list. In Projects, the \u201CLast N days\u201D filter hides workspaces with nothing newer.", presets: [3, 7, 14, 30, 90], unit: " days" },
  ],
};

// Web-only styles that keep a drag from selecting text or scrolling a touch screen.
const NO_SELECT_NO_SCROLL = { touchAction: "none", userSelect: "none", cursor: "grab" } as unknown as ViewStyle;

/** Preset choices keep the screen usable on a phone and make invalid input impossible. */
function options(presets: readonly number[], current: number, unit = "") {
  const values = presets.includes(current) ? presets : [...presets, current].sort((a, b) => a - b);
  return values.map((value) => ({ label: `${value}${unit}`, value: String(value) }));
}

interface SectionEditorProps {
  theme: PluginTheme;
  compact: boolean;
  prefs: Prefs;
  onChange(patch: Partial<Prefs>): void;
}

/**
 * The list's sections in display order. Each one: drag grip, sort direction, up/down arrows, and its
 * size settings. Dragging moves the whole section; the marker shows where it lands.
 */
export function SectionEditor({ theme, compact, prefs, onChange }: SectionEditorProps): ReactElement {
  const order = prefs.sectionOrder;
  const boxes = useRef<Record<string, { top: number; height: number }>>({});
  const container = useRef<View>(null);
  const nodes = useRef(new Map<string, View | null>());
  const [drag, setDrag] = useState<{ section: Section; dy: number; to: number } | null>(null);
  const latest = useRef({ order, onChange });
  latest.current = { order, onChange };

  const measured = () => latest.current.order.map((section) => boxes.current[section] ?? { top: 0, height: 0 });
  const centre = (section: Section) => {
    const box = boxes.current[section] ?? { top: 0, height: 0 };
    return box.top + box.height / 2;
  };
  const moveTo = (section: Section, to: number) => {
    const next = latest.current.order.filter((candidate) => candidate !== section);
    next.splice(to, 0, section);
    if (next.some((candidate, index) => candidate !== latest.current.order[index])) latest.current.onChange({ sectionOrder: next });
  };

  const handlers = useRef({
    start(section: Section) {
      setDrag({ section, dy: 0, to: latest.current.order.indexOf(section) });
      measureIn(container.current, nodes.current, (fresh) => {
        for (const [key, box] of fresh) boxes.current[key] = box;
      });
    },
    move(section: Section, dy: number) {
      const from = latest.current.order.indexOf(section);
      setDrag({ section, dy, to: listDropIndex(measured(), from, centre(section) + dy) });
    },
    end(section: Section, dy: number) {
      const from = latest.current.order.indexOf(section);
      const to = listDropIndex(measured(), from, centre(section) + dy);
      setDrag(null);
      moveTo(section, to);
    },
    cancel: () => setDrag(null),
  }).current;

  // Where the marker goes: above the section that will follow the dropped one, or below the last.
  let marker = 0;
  if (drag) {
    const others = order.filter((section) => section !== drag.section);
    const after = others[drag.to];
    const last = others[others.length - 1];
    const box = after ? boxes.current[after] : last ? boxes.current[last] : undefined;
    marker = box ? (after ? box.top : box.top + box.height) : 0;
  }

  return (
    <View ref={container} style={{ position: "relative" }}>
      {order.map((section, index) => (
        <SectionBlock
          key={section}
          theme={theme}
          compact={compact}
          section={section}
          prefs={prefs}
          isFirst={index === 0}
          isLast={index === order.length - 1}
          dragDy={drag?.section === section ? drag.dy : null}
          onChange={onChange}
          onMove={(by) => moveTo(section, index + by)}
          onMeasure={(top, height) => {
            boxes.current[section] = { top, height };
          }}
          nodeRef={(node) => {
            nodes.current.set(section, node);
          }}
          drag={handlers}
        />
      ))}
      {drag ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: 0, right: 0, top: marker - 2, height: 3, borderRadius: 2, backgroundColor: theme.colors.accent }}
        />
      ) : null}
    </View>
  );
}

interface SectionDrag {
  start(section: Section): void;
  move(section: Section, dy: number): void;
  end(section: Section, dy: number): void;
  cancel(): void;
}

function SectionBlock({
  theme,
  compact,
  section,
  prefs,
  isFirst,
  isLast,
  dragDy,
  onChange,
  onMove,
  onMeasure,
  nodeRef,
  drag,
}: {
  theme: PluginTheme;
  compact: boolean;
  section: Section;
  prefs: Prefs;
  isFirst: boolean;
  isLast: boolean;
  /** Vertical offset while this section is dragged, otherwise null. */
  dragDy: number | null;
  onChange(patch: Partial<Prefs>): void;
  onMove(by: -1 | 1): void;
  onMeasure(top: number, height: number): void;
  /** The block's view, measured afresh when a drag starts. */
  nodeRef(node: View | null): void;
  drag: SectionDrag;
}) {
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => drag.start(section),
        onPanResponderMove: (_event, gesture) => drag.move(section, gesture.dy),
        onPanResponderRelease: (_event, gesture) => drag.end(section, gesture.dy),
        onPanResponderTerminate: () => drag.cancel(),
      }),
    [drag, section],
  );
  const direction = prefs.sectionSort[section];
  const dragging = dragDy !== null;
  return (
    <View
      ref={nodeRef}
      onLayout={(event) => onMeasure(event.nativeEvent.layout.y, event.nativeEvent.layout.height)}
      style={{
        borderTopWidth: isFirst ? 0 : 1,
        borderTopColor: theme.colors.border,
        backgroundColor: dragging ? theme.colors.surface2 : "transparent",
        borderRadius: dragging ? 8 : 0,
        opacity: dragging ? 0.92 : 1,
        zIndex: dragging ? 10 : 0,
        ...(dragDy === null ? null : { transform: [{ translateY: dragDy }] }),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 8, flexWrap: "wrap" }}>
        <View
          accessibilityLabel={`Drag ${LABELS[section]} to reorder`}
          {...pan.panHandlers}
          style={[{ width: compact ? 36 : 24, height: compact ? 40 : 30, alignItems: "center", justifyContent: "center" }, NO_SELECT_NO_SCROLL]}
        >
          <Icon name="GripVertical" size={18} color={theme.colors.foregroundMuted} />
        </View>
        <View style={{ flex: 1, minWidth: 120, gap: 2 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>{LABELS[section]}</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{SORT_HINTS[section]}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${LABELS[section]}: ${direction} first. Switch.`}
          onPress={() => onChange({ sectionSort: { ...prefs.sectionSort, [section]: direction === "oldest" ? "newest" : "oldest" } })}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            minHeight: compact ? 40 : 30,
            paddingHorizontal: 10,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Icon name={direction === "oldest" ? "ArrowDownNarrowWide" : "ArrowDownWideNarrow"} size={16} color={theme.colors.foreground} />
          <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{direction === "oldest" ? "Oldest first" : "Newest first"}</Text>
        </Pressable>
        <IconButton theme={theme} compact={compact} label={`Move ${LABELS[section]} up`} icon="ChevronUp" disabled={isFirst} onPress={() => onMove(-1)} />
        <IconButton theme={theme} compact={compact} label={`Move ${LABELS[section]} down`} icon="ChevronDown" disabled={isLast} onPress={() => onMove(1)} />
      </View>
      {SIZE_SETTINGS[section].map((setting) => (
        <SettingsSelect
          key={setting.key}
          label={setting.label}
          hint={setting.hint}
          value={String(prefs[setting.key])}
          options={options(setting.presets, prefs[setting.key], setting.unit)}
          onValueChange={(next) => onChange({ [setting.key]: Number(next) })}
        />
      ))}
    </View>
  );
}
