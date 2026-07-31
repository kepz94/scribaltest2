import { useEffect, useState } from "react";
import { isLoaded, loadWebster } from "./webster";

// The dictionary is a 5MB file fetched on demand, and everything that resolves a
// tag to its text — a verse's chosen definitions, the note editor's list of
// definitions you can link — silently returns nothing until it lands. A
// component that reads the dictionary during render therefore has to re-render
// when it arrives, or it shows an empty result forever. (That is exactly how the
// note toolbar's "Link definition" button went missing: its own gate was
// computed from a dictionary that had never been loaded.)
//
// One fetch for the whole app, then every waiter is woken.
const waiters = new Set<() => void>();
let requested = false;

function whenReady(cb: () => void): () => void {
  waiters.add(cb);
  if (!requested) {
    requested = true;
    loadWebster().then(() => {
      const waiting = Array.from(waiters);
      waiters.clear();
      waiting.forEach((f) => f());
    });
  }
  return () => waiters.delete(cb);
}

// True once the dictionary is in memory. Pass `false` to opt out entirely, so a
// surface with nothing to look up never triggers the download.
export function useWebsterReady(enabled = true): boolean {
  const [ready, setReady] = useState(isLoaded());
  useEffect(() => {
    if (!enabled || ready) return;
    return whenReady(() => setReady(true));
  }, [enabled, ready]);
  return ready || isLoaded();
}
