// The mark, as one component — the native twin of components/Logo.jsx.
//
// The launch screen drew a teal L built from two rectangles, standing in
// for artwork that already existed (public/logo), with the word
// "Loudentify" set in type beneath it. That put the name on screen twice
// in two different letterforms, and neither of them was the brand.
//
// NAMED BY THE SURFACE, NOT BY THE INK, exactly as the web component is:
// `onDark` means "this sits ON a dark background", so it loads the
// porcelain file. Naming the files by their own colour makes every call
// site a small puzzle, and getting it backwards gives a navy mark on
// navy — invisible, and invisible in the way a screenshot would not
// catch.
//
// NEVER STRETCHED. Width is derived from height and there is no width
// prop, so the aspect cannot be overridden by a caller in a hurry.
import { View, Image } from 'react-native';

/** The artwork is 4.56:1: the whale sits inside the O and it carries its own padding. */
export const WORDMARK_ASPECT = 1168 / 256;

// Below this the signal arc stops resolving into three bands and reads
// as a coloured smudge. components/Logo.jsx records the sizes that were
// looked at to settle on it.
export const WORDMARK_MIN_HEIGHT = 32;

const FILES = {
  dark: require('../../assets/wordmark-on-dark.png'),
  light: require('../../assets/wordmark-on-light.png'),
};

export function Wordmark({ height = 44, onDark = true, style }) {
  const h = Math.max(WORDMARK_MIN_HEIGHT, height);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Loudentify" style={style}>
      <Image
        source={onDark ? FILES.dark : FILES.light}
        style={{ width: h * WORDMARK_ASPECT, height: h }}
        resizeMode="contain"
        fadeDuration={0}
      />
    </View>
  );
}
