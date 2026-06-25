import { useEffect, useState } from "react";

// Running as an installed/home-screen app (vs a browser tab).
// This doesn't change at runtime, so compute once.
export function useIsStandalone(): boolean {
  const [standalone] = useState(
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true
  );
  return standalone;
}

// Narrow viewport (phone-ish width).
export function useIsNarrow(breakpoint = 768): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return narrow;
}

// Touch device (coarse pointer). Lets us avoid gating a narrowed desktop window.
export function useIsCoarsePointer(): boolean {
  const [coarse] = useState(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches
  );
  return coarse;
}

export function isIOS(): boolean {
  const ua = window.navigator.userAgent;
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS reports as Mac with touch
    (window.navigator.platform === "MacIntel" &&
      window.navigator.maxTouchPoints > 1)
  );
}
