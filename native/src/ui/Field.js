// native/src/ui/Field.js — a labelled text input, with the eye on passwords.
//
// 48 high, 12 radius, ink at 7%. The label sits above rather than inside,
// because a placeholder that doubles as a label disappears the moment
// someone starts typing and they lose track of which box they are in.
//
// Errors are written under the field in plain words. "Never blame the
// user" is one of the six rules, so the caller passes a sentence, not a
// code, and this never writes one of its own.
import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { color, surface, radius, space, text, textOnDark, button } from './tokens';
import { Eye } from './Icon';

export function Field({
  label, value, onChangeText, placeholder, error, hint,
  secure = false, dark = false, style, inputStyle, testID, ...rest
}) {
  const [shown, setShown] = useState(false);
  const t = dark ? textOnDark : text;
  const fg = dark ? color.porcelain : color.ink;
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text style={[t.supporting, { fontWeight: '700', color: fg }]}>{label}</Text> : null}
      <View>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={dark ? surface.placeholderOnDark : surface.placeholderOnLight}
          secureTextEntry={secure && !shown}
          accessibilityLabel={label}
          testID={testID}
          style={[{
            height: 48,
            borderRadius: radius.field,
            backgroundColor: dark ? surface.quietDark : surface.quiet,
            paddingHorizontal: 14,
            paddingRight: secure ? 52 : 14,
            fontSize: 17,
            color: fg,
            borderWidth: error ? 2 : 0,
            borderColor: color.red,
          }, inputStyle]}
          {...rest}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: shown }}
            accessibilityLabel={shown ? 'Hide password' : 'Show password'}
            testID={testID ? `${testID}-toggle` : undefined}
            onPress={() => setShown((s) => !s)}
            style={{ position: 'absolute', right: 2, top: 2, width: button.medium.height, height: button.medium.height, alignItems: 'center', justifyContent: 'center' }}
          >
            <Eye size={20} color={fg} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={{ fontSize: 15, color: color.red }}>{error}</Text> : null}
      {!error && hint ? <Text style={t.supporting}>{hint}</Text> : null}
    </View>
  );
}
