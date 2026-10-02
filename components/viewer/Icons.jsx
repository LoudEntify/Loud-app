// components/viewer/Icons.jsx — the stroke icons the boards use (24-box, 1.8 stroke).
const I = ({ size = 22, children, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{children}</svg>
);
export const Back = (p) => <I {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></I>;
export const Close = (p) => <I {...p}><path d="M6 6l12 12M18 6L6 18" /></I>;
export const Eye = (p) => <I {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></I>;
export const Person = (p) => <I {...p}><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" /></I>;
export const Play = (p) => <I {...p}><path d="M8 5l11 7-11 7z" /></I>;
export const Token = (p) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M14.5 9.5c-.4-.9-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2.1-.6-2.5-1.5M12 6.5V8M12 16v1.5" /></I>;
export const Share = (p) => <I {...p}><path d="M12 3v12" /><path d="M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></I>;
export const Bigger = (p) => <I {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></I>;
export const Smaller = (p) => <I {...p}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></I>;
export const Flag = (p) => <I {...p}><path d="M5 21V4" /><path d="M5 4h12l-2.5 4L17 12H5" /></I>;
export const Emoji = (p) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" /><path d="M9 9.5h.01M15 9.5h.01" /></I>;
export const Heart = (p) => <I {...p}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></I>;
export const Send = (p) => <I {...p}><path d="M4 12l16-8-6 16-2.5-6.5z" /></I>;
export const Bell = (p) => <I {...p}><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></I>;
export const Search = (p) => <I {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></I>;
export const Inbox = (p) => <I {...p}><path d="M4 6h16v12H4z" /><path d="M4 8l8 5 8-5" /></I>;
export const Check = (p) => <I {...p}><path d="M5 12l4 4L19 7" /></I>;
export const Home = (p) => <I {...p}><path d="M4 11l8-7 8 7v9H4z" /><path d="M10 20v-6h4v6" /></I>;
export const LiveDot = (p) => <I {...p}><circle cx="12" cy="12" r="3" /><path d="M7.5 7.5a6.5 6.5 0 0 0 0 9M16.5 7.5a6.5 6.5 0 0 1 0 9M4.5 4.5a10.5 10.5 0 0 0 0 15M19.5 4.5a10.5 10.5 0 0 1 0 15" /></I>;
export const Plus = (p) => <I {...p}><path d="M12 5v14M5 12h14" /></I>;
export const Clock = (p) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></I>;
export const Wifi = (p) => <I {...p}><path d="M2 9a16 16 0 0 1 20 0M5.5 12.5a11 11 0 0 1 13 0M9 16a5 5 0 0 1 6 0" /><circle cx="12" cy="19" r="1" /></I>;
export const Trash = (p) => <I {...p}><path d="M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13" /></I>;
export const Chevron = (p) => <I {...p}><path d="M9 6l6 6-6 6" /></I>;
export const Dots = (p) => <I {...p}><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></I>;
export const Wallet = (p) => <I {...p}><path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M3 7l2-3h12l2 3" /><circle cx="16" cy="14" r="1.5" /></I>;
export const Warn = (p) => <I {...p}><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 17.5v.5" /></I>;
export const Music = (p) => <I {...p}><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></I>;
