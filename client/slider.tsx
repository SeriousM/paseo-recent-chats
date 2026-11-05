import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, Text, View, type ViewStyle } from "react-native";

interface SliderProps {
  theme: PluginTheme;
  compact: boolean;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Text next to the slider, e.g. "40%". */
  display: string;
  onChange(value: number): void;
}

// Stops a touch screen from scrolling the page while the thumb is dragged. React Native Web only.
const NO_TOUCH_SCROLL = { touchAction: "none" } as ViewStyle;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const snap = (value: number, min: number, step: number) => min + Math.round((value - min) / step) * step;

/** Slider with a draggable thumb, tap-to-set track and minus/plus buttons for keyboard and screen readers. */
export function Slider({ theme, compact, label, value, min, max, step, display, onChange }: SliderProps) {
  const [width, setWidth] = useState(0);
  const start = useRef(value);
  const live = useRef({ width, value, min, max, step, onChange });
  live.current = { width, value, min, max, step, onChange };

  const pan = useMemo(() => {
    /** Value under pointer position `x` along the track, or null before the track is measured. */
    const valueAt = (x: number): number | null => {
      const { width: w, min: lo, max: hi, step: st } = live.current;
      if (w <= 0) return null;
      return clamp(snap(lo + (clamp(x, 0, w) / w) * (hi - lo), lo, st), lo, hi);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        // A press off the thumb sets the value there; dragging continues from that value, not the old one.
        const tapped = valueAt(event.nativeEvent.locationX);
        start.current = tapped ?? live.current.value;
        if (tapped !== null) live.current.onChange(tapped);
      },
      onPanResponderMove: (_event, gesture) => {
        const { width: w, min: lo, max: hi, step: st, onChange: emit } = live.current;
        if (w <= 0) return;
        emit(clamp(snap(start.current + (gesture.dx / w) * (hi - lo), lo, st), lo, hi));
      },
    });
  }, []);

  const button = compact ? 40 : 28;
  const fraction = max === min ? 0 : (value - min) / (max - min);
  const nudge = (direction: -1 | 1) => onChange(clamp(value + direction * step, min, max));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        onPress={() => nudge(-1)}
        style={{ width: button, height: button, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 16 }}>{"\u2212"}</Text>
      </Pressable>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value, text: display }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => nudge(event.nativeEvent.actionName === "increment" ? 1 : -1)}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        {...pan.panHandlers}
        style={[{ flexGrow: 1, flexBasis: 140, height: compact ? 40 : 28, justifyContent: "center" }, NO_TOUCH_SCROLL]}
      >
        <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.colors.border }} pointerEvents="none">
          <View style={{ width: `${fraction * 100}%`, height: 4, borderRadius: 2, backgroundColor: theme.colors.accent }} />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: Math.max(0, fraction * width - 9),
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: theme.colors.accent,
            borderWidth: 2,
            borderColor: theme.colors.surface0,
          }}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        onPress={() => nudge(1)}
        style={{ width: button, height: button, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 16 }}>+</Text>
      </Pressable>
      <Text style={{ color: theme.colors.foreground, fontSize: 13, minWidth: 40, textAlign: "right" }}>{display}</Text>
    </View>
  );
}
