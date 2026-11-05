import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Fragment, useMemo, useRef, useState, type ReactElement } from "react";
import { PanResponder, Pressable, Text, TextInput, View, type ViewStyle } from "react-native";
import { MAX_TOKEN_CHARS, type RowToken, type RowTokenId } from "../shared/layout";
import { dropTarget, markerY, type DragGeometry, type Drop } from "./drag-target";
import { PREVIEW_HOST_COLORS, PREVIEW_ROWS } from "./preview-data";
import {
  columnChars,
  linesOf,
  moveToken,
  ownLine,
  placeToken,
  placeTokenOnNewLine,
  resetLayout,
  setEnabled,
  setMaxChars,
  visibleLines,
} from "./row-layout";
import { FullNamesCard, HostHeading, TriageRowView } from "./triage-list";

const LABELS: Record<RowTokenId, string> = {
  host: "Host",
  led: "Status light",
  project: "Project",
  workspace: "Workspace",
  title: "Tab name",
  branch: "Branch",
  agent: "Agent name",
};

const HINTS: Record<RowTokenId, string> = {
  host: "Tag in the colour set for the host in Paseo. Hidden when only one host is listed.",
  led: "Unread, running or inactive.",
  project: "Project of the chat's workspace.",
  workspace: "Workspace name.",
  title: "The chat's tab name.",
  branch: "Git branch of the workspace. Empty for folders that are not a repository.",
  agent: "Model the chat runs on, e.g. opus-5.5.",
};

// Web-only styles that keep a drag from selecting text or scrolling a touch screen.
const NO_SELECT_NO_SCROLL = { touchAction: "none", userSelect: "none", cursor: "grab" } as unknown as ViewStyle;

interface EditorProps {
  theme: PluginTheme;
  compact: boolean;
  layout: readonly RowToken[];
  onChange(layout: RowToken[]): void;
}

/** Live preview: the real row component on sample data, so every change shows immediately. */
export function LayoutPreview({
  theme,
  compact,
  layout,
  groupByHost,
}: Omit<EditorProps, "onChange"> & { groupByHost: boolean }): ReactElement {
  const lines = useMemo(() => visibleLines(layout), [layout]);
  const columns = useMemo(() => columnChars(PREVIEW_ROWS, layout), [layout]);
  const rows = useMemo(
    () => (groupByHost ? [...PREVIEW_ROWS].sort((a, b) => a.hostId.localeCompare(b.hostId)) : PREVIEW_ROWS),
    [groupByHost],
  );
  const frame = useMemo(
    () => ({
      card: {
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        padding: 6,
      },
      empty: { padding: 12, color: theme.colors.foregroundMuted, fontSize: 13 },
    }),
    [theme],
  );
  return (
    <View style={frame.card}>
      {lines.length === 0 ? (
        <Text style={frame.empty}>Every item is switched off. Switch one on to see the row.</Text>
      ) : (
        rows.map((row, index) => (
          <Fragment key={row.key}>
            {groupByHost && rows[index - 1]?.hostId !== row.hostId ? (
              <HostHeading
                theme={theme}
                label={row.hostLabel}
                colorName={PREVIEW_HOST_COLORS[row.hostId]}
                unread={rows.filter((other) => other.hostId === row.hostId && other.bucket === "unread").length}
              />
            ) : null}
            <TriageRowView
              row={row}
              theme={theme}
              compact={compact}
              showHost={!groupByHost}
              hostColor={PREVIEW_HOST_COLORS[row.hostId]}
              lines={lines}
              columns={columns}
              current={false}
              fullNames={false}
              onOpen={() => {}}
              onMarkRead={() => {}}
              onMarkUnread={() => {}}
              onSetPinned={() => {}}
            />
          </Fragment>
        ))
      )}
    </View>
  );
}

/** The full-names card as it will look, on a patterned background so transparency is visible. */
export function TooltipPreview({
  theme,
  transparency,
}: {
  theme: PluginTheme;
  transparency: number;
}): ReactElement {
  const row = PREVIEW_ROWS[0];
  const stripes = Array.from({ length: 12 }, (_, i) => i);
  return (
    <View style={{ borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden", padding: 10 }}>
      <View pointerEvents="none" style={{ position: "absolute", inset: 0, flexDirection: "row" }}>
        {stripes.map((i) => (
          <View key={i} style={{ flex: 1, backgroundColor: i % 2 === 0 ? theme.colors.accent : theme.colors.statusWarning, opacity: 0.55 }} />
        ))}
      </View>
      {row ? <FullNamesCard row={row} theme={theme} showHost transparency={transparency} floating={false} /> : null}
    </View>
  );
}

function IconButton({
  theme,
  compact,
  label,
  icon,
  disabled,
  onPress,
}: {
  theme: PluginTheme;
  compact: boolean;
  label: string;
  icon: string;
  disabled: boolean;
  onPress(): void;
}) {
  const size = compact ? 40 : 30;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Icon name={icon} size={16} color={theme.colors.foreground} />
    </Pressable>
  );
}

interface DragHandlers {
  start(id: RowTokenId): void;
  move(id: RowTokenId, dy: number): void;
  end(id: RowTokenId, dy: number): void;
  cancel(): void;
}

function TokenRow({
  theme,
  compact,
  token,
  isFirst,
  isLast,
  layout,
  dragDy,
  onChange,
  onMeasure,
  drag,
}: {
  theme: PluginTheme;
  compact: boolean;
  token: RowToken;
  isFirst: boolean;
  isLast: boolean;
  layout: readonly RowToken[];
  /** Vertical offset while this row is being dragged, otherwise null. */
  dragDy: number | null;
  onChange(layout: RowToken[]): void;
  onMeasure(id: RowTokenId, y: number, height: number): void;
  drag: DragHandlers;
}) {
  const box = compact ? 28 : 22;
  const hasLength = token.id !== "led";
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => dragRef.current.start(token.id),
        onPanResponderMove: (_event, gesture) => dragRef.current.move(token.id, gesture.dy),
        onPanResponderRelease: (_event, gesture) => dragRef.current.end(token.id, gesture.dy),
        onPanResponderTerminate: () => dragRef.current.cancel(),
      }),
    [token.id],
  );
  const dragging = dragDy !== null;
  return (
    <View
      onLayout={(event) => onMeasure(token.id, event.nativeEvent.layout.y, event.nativeEvent.layout.height)}
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 4,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        opacity: dragging ? 0.92 : token.enabled ? 1 : 0.55,
        backgroundColor: dragging ? theme.colors.surface2 : "transparent",
        borderRadius: dragging ? 8 : 0,
        zIndex: dragging ? 10 : 0,
        ...(dragDy === null ? null : { transform: [{ translateY: dragDy }] }),
      }}
    >
      <View
        accessibilityLabel={`Drag ${LABELS[token.id]} to reorder`}
        {...pan.panHandlers}
        style={[
          { width: compact ? 36 : 24, height: compact ? 40 : 30, alignItems: "center", justifyContent: "center" },
          NO_SELECT_NO_SCROLL,
        ]}
      >
        <Icon name="GripVertical" size={18} color={theme.colors.foregroundMuted} />
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`Show ${LABELS[token.id]}`}
        accessibilityState={{ checked: token.enabled }}
        onPress={() => onChange(setEnabled(layout, token.id, !token.enabled))}
        style={{ flexDirection: "row", alignItems: "center", gap: 10, flexGrow: 1, flexBasis: 130, minHeight: box + 8 }}
      >
        <View
          style={{
            width: box,
            height: box,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: token.enabled ? theme.colors.accent : theme.colors.border,
            backgroundColor: token.enabled ? theme.colors.accent : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {token.enabled ? <Icon name="Check" size={14} color={theme.colors.accentForeground} /> : null}
        </View>
        <View style={{ flexShrink: 1 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>{LABELS[token.id]}</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{HINTS[token.id]}</Text>
        </View>
      </Pressable>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {hasLength ? (
          <View style={{ alignItems: "center" }}>
            <TextInput
              accessibilityLabel={`${LABELS[token.id]} maximum characters, 0 is unlimited`}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={String(MAX_TOKEN_CHARS).length}
              value={String(token.maxChars)}
              onChangeText={(text) => {
                const digits = text.replace(/\D/g, "");
                onChange(setMaxChars(layout, token.id, digits === "" ? 0 : Number(digits)));
              }}
              selectTextOnFocus
              style={{
                width: 56,
                height: compact ? 40 : 30,
                textAlign: "center",
                borderRadius: 8,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface0,
                color: theme.colors.foreground,
                paddingVertical: 0,
              }}
            />
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>
              {token.maxChars === 0 ? "unlimited" : "chars"}
            </Text>
          </View>
        ) : null}
        <IconButton
          theme={theme}
          compact={compact}
          label={`Move ${LABELS[token.id]} up`}
          icon="ChevronUp"
          disabled={isFirst}
          onPress={() => onChange(moveToken(layout, token.id, -1))}
        />
        <IconButton
          theme={theme}
          compact={compact}
          label={`Move ${LABELS[token.id]} down`}
          icon="ChevronDown"
          disabled={isLast}
          onPress={() => onChange(moveToken(layout, token.id, 1))}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Put ${LABELS[token.id]} on its own line`}
          onPress={() => onChange(ownLine(layout, token.id))}
          style={{
            height: compact ? 40 : 30,
            paddingHorizontal: 10,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>Own line</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface DragState {
  id: RowTokenId;
  dy: number;
  drop: Drop;
}

/**
 * The lines of a row as ordered lists. Each item: show, characters, drag handle (or the arrow
 * buttons), and "Own line". Any number of lines; drop below the last line to start a new one.
 */
export function LayoutEditor({ theme, compact, layout, onChange }: EditorProps): ReactElement {
  const lines = useMemo(() => linesOf(layout), [layout]);
  const sectionTops = useRef<Record<number, number>>({});
  const rowBoxes = useRef<Record<string, { y: number; h: number }>>({});
  const zoneTop = useRef(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const startCenter = useRef(0);
  const latest = useRef({ layout, onChange, lines });
  latest.current = { layout, onChange, lines };

  const geometry = (): DragGeometry => {
    const current = latest.current.lines;
    const rows = current.flatMap((line) =>
      line.map((token) => {
        const section = sectionTops.current[token.line] ?? 0;
        const box = rowBoxes.current[token.id] ?? { y: 0, h: 0 };
        return { id: token.id, line: token.line, top: section + box.y, height: box.h };
      }),
    );
    return {
      rows,
      lineTops: current.map((_line, index) => sectionTops.current[index + 1] ?? 0),
      newLineTop: zoneTop.current,
    };
  };

  const handlers: DragHandlers = {
    start(id) {
      const row = geometry().rows.find((candidate) => candidate.id === id);
      startCenter.current = row ? row.top + row.height / 2 : 0;
      setDrag({ id, dy: 0, drop: dropTarget(startCenter.current, geometry(), id) });
    },
    move(id, dy) {
      const geo = geometry();
      setDrag({ id, dy, drop: dropTarget(startCenter.current + dy, geo, id) });
    },
    end(id, dy) {
      const drop = dropTarget(startCenter.current + dy, geometry(), id);
      setDrag(null);
      const { layout: now, onChange: emit } = latest.current;
      emit("newLineAt" in drop ? placeTokenOnNewLine(now, id, drop.newLineAt) : placeToken(now, id, drop.line, drop.index));
    },
    cancel: () => setDrag(null),
  };

  const heading = { color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.7 };
  const marker = drag ? markerY(drag.drop, geometry(), drag.id) : 0;
  const total = lines.reduce((sum, line) => sum + line.length, 0);
  let position = 0;
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        Drag the grip to reorder, or use the arrows. Drop below the last line to start a new line. Changes apply after Save.
      </Text>
      <View style={{ position: "relative" }}>
        {lines.map((tokens, lineIndex) => (
          <View
            key={lineIndex}
            onLayout={(event) => {
              sectionTops.current[lineIndex + 1] = event.nativeEvent.layout.y;
            }}
            style={{ paddingBottom: 8 }}
          >
            <Text style={heading}>{`LINE ${lineIndex + 1}`}</Text>
            {tokens.map((token) => {
              position += 1;
              return (
                <TokenRow
                  key={token.id}
                  theme={theme}
                  compact={compact}
                  token={token}
                  isFirst={position === 1}
                  isLast={position === total}
                  layout={layout}
                  dragDy={drag?.id === token.id ? drag.dy : null}
                  onChange={onChange}
                  onMeasure={(id, y, height) => {
                    rowBoxes.current[id] = { y, h: height };
                  }}
                  drag={handlers}
                />
              );
            })}
          </View>
        ))}
        <View
          onLayout={(event) => {
            zoneTop.current = event.nativeEvent.layout.y;
          }}
          style={{
            minHeight: compact ? 56 : 40,
            marginTop: 4,
            borderRadius: 8,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: drag && "newLineAt" in drag.drop ? theme.colors.accent : theme.colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Drop here for a new line</Text>
        </View>
        {drag ? (
          <View
            pointerEvents="none"
            style={{ position: "absolute", left: 0, right: 0, top: marker - 2, height: 3, borderRadius: 2, backgroundColor: theme.colors.accent }}
          />
        ) : null}
      </View>
      <Pressable accessibilityRole="button" onPress={() => onChange(resetLayout())} style={{ alignSelf: "flex-start" }}>
        <Text style={{ color: theme.colors.accent, paddingVertical: 8 }}>Reset to default layout</Text>
      </Pressable>
    </View>
  );
}
