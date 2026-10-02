'use client';
import { useEffect, useState } from 'react';
export function useViewport() {
  const [vp, setVp] = useState({ width: 390, height: 844, ready: false });
  useEffect(() => {
    const read = () => setVp({ width: window.innerWidth, height: window.innerHeight, ready: true });
    read();
    window.addEventListener('resize', read);
    window.visualViewport?.addEventListener('resize', read);
    return () => { window.removeEventListener('resize', read); window.visualViewport?.removeEventListener('resize', read); };
  }, []);
  return vp;
}
