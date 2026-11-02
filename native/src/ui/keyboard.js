// How a screen gets out of the keyboard's way.
//
// Every screen with a field used `behavior={Platform.OS === 'ios' ?
// 'padding' : undefined}`, and undefined means KeyboardAvoidingView does
// nothing at all. On iOS the sheet rose; on Android the keyboard opened
// straight over the login form and an artist typing a password could not
// see the field they were typing into.
//
// 'height' is the Android answer, and it only works if the window itself
// resizes — so app.json pins android.softwareKeyboardLayoutMode to
// "resize" rather than leaving it to a default that could change. With
// "pan" the window slides AND the view shrinks, and the form jumps twice.
import { Platform } from 'react-native';

export const KEYBOARD_BEHAVIOR = Platform.OS === 'ios' ? 'padding' : 'height';

// The sheets sit at the bottom of a full-bleed dark screen, so there is
// no header for the keyboard to measure against and no offset to add.
export const KEYBOARD_OFFSET = 0;
