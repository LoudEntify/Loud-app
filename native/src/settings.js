// native/src/settings.js — the one piece of furniture every settings
// screen needed and the design system does not have.
//
// Twelve boards in design/*.dc.html draw toggles, sliders and radio
// groups for settings that have no column, no route and no capturer
// behind them yet. The rule for this rebuild is that a control which
// cannot save must not look like it saved, so those controls are not
// drawn at all: the heading and the board's own explanation stay, and
// this notice goes where the control would have been.
//
// It is deliberately NOT in native/src/ui. The kit is the approved
// design system and this is a sentence about the state of the build, so
// it lives beside the screens that say it. It is composed only of kit
// pieces, and if the system ever grows an equivalent this file goes.
import { View, Text } from 'react-native';
import { Icon, color, space, radius, surface, text } from './ui';

/**
 * "This is not stored yet", in plain words, with what would have to
 * exist for it to be. One sentence, no apology, no code — the error
 * voice from StatesPatterns.dc.html applied to a missing feature rather
 * than a failed request.
 */
export function NotStored({ children, testID }) {
  return (
    <View
      testID={testID}
      accessibilityRole="summary"
      style={{
        flexDirection: 'row', gap: space.s, padding: space.m,
        borderRadius: radius.field, backgroundColor: surface.quiet,
      }}
    >
      <Icon.Warning size={20} color={surface.errorIcon} />
      <Text style={[text.supporting, { flex: 1, color: color.ink }]}>{children}</Text>
    </View>
  );
}
