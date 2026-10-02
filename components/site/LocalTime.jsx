'use client';
// Times on the website are rendered in the visitor's own time zone
// ("Times shown in your own time zone", WebLiveUpcoming). The server does
// not know the zone, so it renders the ISO string and this swaps it in
// after hydration; before that the fallback is the UTC day and time.
import { useEffect, useState } from 'react';

export default function LocalTime({ iso, mode = 'time' }) {
  const [text, setText] = useState(null);
  useEffect(() => {
    const d = new Date(iso);
    if (mode === 'time') setText(d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    else if (mode === 'day') setText(d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }));
    else setText(d.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }));
  }, [iso, mode]);
  const fallback = mode === 'time' ? iso.slice(11, 16) + ' UTC' : iso.slice(0, 10);
  return <time dateTime={iso} suppressHydrationWarning>{text || fallback}</time>;
}
