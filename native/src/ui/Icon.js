// native/src/ui/Icon.js — the icon set, traced from the boards.
//
// "Icons are stroked at 1.8, in 20, 22, 24 or 26." Every path below is
// copied from the `<svg class="i">` markup in design/*.dc.html so the app
// and the boards cannot diverge: the boards are the source, this is the
// transcription.
//
// They are deliberately plain components rather than a lookup by name, so
// a typo is a build error instead of an invisible blank square.
import Svg, { Path, Circle, Rect, Line, Polyline } from 'react-native-svg';
import { icon, color as token } from './tokens';

function Glyph({ size = 24, color = token.ink, children, fill = 'none' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={icon.stroke} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  );
}

export const Eye = (p) => <Glyph {...p}><Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><Circle cx="12" cy="12" r="3" /></Glyph>;
export const Search = (p) => <Glyph {...p}><Circle cx="11" cy="11" r="7" /><Path d="M20 20l-3.5-3.5" /></Glyph>;
export const Bell = (p) => <Glyph {...p}><Path d="M18 16H6l1.5-2.5V10a4.5 4.5 0 0 1 9 0v3.5z" /><Path d="M10 19a2 2 0 0 0 4 0" /></Glyph>;
export const Home = (p) => <Glyph {...p}><Path d="M4 11l8-6 8 6v8H4z" /></Glyph>;
export const Plus = (p) => <Glyph {...p}><Path d="M12 5v14M5 12h14" /></Glyph>;
export const Person = (p) => <Glyph {...p}><Circle cx="12" cy="8" r="4" /><Path d="M4 20a8 8 0 0 1 16 0" /></Glyph>;
export const Camera = (p) => <Glyph {...p}><Path d="M4 8h3l2-3h6l2 3h3v11H4z" /><Circle cx="12" cy="13" r="3.5" /></Glyph>;
export const Chat = (p) => <Glyph {...p}><Path d="M4 5h16v11H9l-5 4z" /></Glyph>;
export const Chart = (p) => <Glyph {...p}><Path d="M6 20V10M12 20V4M18 20v-7" /></Glyph>;
export const Wrench = (p) => <Glyph {...p}><Path d="M15 4a5 5 0 0 0-4.6 6.9L4 17.3V20h2.7l6.4-6.4A5 5 0 0 0 20 9l-3 1-2-2 1-3z" /></Glyph>;
export const Stop = (p) => <Glyph {...p}><Rect x="6" y="6" width="12" height="12" rx="2" /></Glyph>;
export const Sparkle = (p) => <Glyph {...p}><Path d="M4 20L15 9" /><Path d="M16 3l1.2 2.8L20 7l-2.8 1.2L16 11l-1.2-2.8L12 7l2.8-1.2z" /></Glyph>;
export const Chevron = (p) => <Glyph {...p}><Path d="M9 5l7 7-7 7" /></Glyph>;
export const Back = (p) => <Glyph {...p}><Path d="M15 5l-7 7 7 7" /></Glyph>;
export const Close = (p) => <Glyph {...p}><Path d="M6 6l12 12M18 6L6 18" /></Glyph>;
export const Check = (p) => <Glyph {...p}><Polyline points="5 13 10 18 19 6" /></Glyph>;
export const Warning = (p) => <Glyph {...p}><Path d="M12 4l9 16H3z" /><Line x1="12" y1="10" x2="12" y2="14" /><Circle cx="12" cy="17" r="0.6" fill={p?.color || token.ink} /></Glyph>;
export const Cloud = (p) => <Glyph {...p}><Path d="M7 18a4 4 0 0 1 .6-8 5 5 0 0 1 9.5 1.4A3.5 3.5 0 0 1 17 18z" /></Glyph>;
export const Refresh = (p) => <Glyph {...p}><Path d="M20 12a8 8 0 1 1-2.3-5.7" /><Path d="M20 4v5h-5" /></Glyph>;
export const Rotate = (p) => <Glyph {...p}><Path d="M4 12a8 8 0 0 1 13.7-5.7" /><Path d="M18 3v4h-4" /><Path d="M20 12a8 8 0 0 1-13.7 5.7" /><Path d="M6 21v-4h4" /></Glyph>;
export const Mic = (p) => <Glyph {...p}><Rect x="9" y="3" width="6" height="11" rx="3" /><Path d="M5 11a7 7 0 0 0 14 0" /><Path d="M12 18v3" /></Glyph>;
export const Film = (p) => <Glyph {...p}><Rect x="3" y="5" width="18" height="14" rx="2" /><Path d="M8 5v14M16 5v14" /></Glyph>;
export const Heart = (p) => <Glyph {...p}><Path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9z" /></Glyph>;
export const Share = (p) => <Glyph {...p}><Circle cx="18" cy="6" r="2.5" /><Circle cx="6" cy="12" r="2.5" /><Circle cx="18" cy="18" r="2.5" /><Path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6" /></Glyph>;
export const Flag = (p) => <Glyph {...p}><Path d="M6 21V4h11l-2 4 2 4H6" /></Glyph>;
export const Coin = (p) => <Glyph {...p}><Circle cx="12" cy="12" r="8" /><Path d="M12 8v8M9.5 10h4a1.8 1.8 0 0 1 0 3.6h-3a1.8 1.8 0 0 0 0 3.6h4" /></Glyph>;
export const Expand = (p) => <Glyph {...p}><Path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" /></Glyph>;
export const Gear = (p) => <Glyph {...p}><Circle cx="12" cy="12" r="3.2" /><Path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" /></Glyph>;
export const Calendar = (p) => <Glyph {...p}><Rect x="4" y="5" width="16" height="15" rx="2" /><Path d="M4 10h16M9 3v4M15 3v4" /></Glyph>;
export const Play = (p) => <Glyph {...p}><Path d="M7 5l12 7-12 7z" /></Glyph>;
export const Pause = (p) => <Glyph {...p}><Path d="M8 5v14M16 5v14" /></Glyph>;
export const Send = (p) => <Glyph {...p}><Path d="M4 12l16-7-6 7 6 7z" /></Glyph>;
export const Pin = (p) => <Glyph {...p}><Path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" /><Circle cx="12" cy="10" r="2.6" /></Glyph>;
export const Note = (p) => <Glyph {...p}><Circle cx="8" cy="18" r="3" /><Path d="M11 18V5l8-2v12" /><Circle cx="16" cy="15" r="3" /></Glyph>;
export const Doc = (p) => <Glyph {...p}><Path d="M7 3h7l5 5v13H7z" /><Path d="M14 3v5h5M10 13h7M10 17h7" /></Glyph>;
