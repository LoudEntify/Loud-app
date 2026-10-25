// native/src/PasswordInput.js — the password box with the show/hide eye,
// the native twin of components/viewer/PasswordField.jsx. Same behaviour on
// both apps, because a password box that behaves differently in one place is
// how a person ends up locked out of their own account.
import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { styles } from './theme';

export default function PasswordInput({ value, onChangeText, placeholder = 'Password', label, error, autoComplete = 'current-password', testID = 'password' }) {
  const [shown, setShown] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={{ fontWeight: '700', fontSize: 14 }}>{label}</Text> : null}
      <View style={{ position: 'relative', justifyContent: 'center' }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#c9cfd1"
          secureTextEntry={!shown}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={autoComplete}
          textContentType={autoComplete === 'new-password' ? 'newPassword' : 'password'}
          testID={testID}
          style={[styles.field, { paddingRight: 64 }]}
        />
        <Pressable
          onPress={() => setShown((s) => !s)}
          accessibilityRole="button"
          accessibilityLabel={shown ? 'Hide password' : 'Show password'}
          accessibilityState={{ selected: shown }}
          testID={`${testID}-toggle`}
          hitSlop={8}
          style={{ position: 'absolute', right: 6, height: 44, width: 52, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontWeight: '700', fontSize: 14 }}>{shown ? 'Hide' : 'Show'}</Text>
        </Pressable>
      </View>
      {error ? <Text style={{ color: '#e71d36' }}>{error}</Text> : null}
    </View>
  );
}
