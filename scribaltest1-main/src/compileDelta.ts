// How many marks a study has gained since the last time it was compiled.
//
// The gather animation is the act of pulling NEW marks into a study. Opening a
// study you have not marked since last time has nothing to gather, so it should
// open straight into the outline — an animation there is a delay dressed up as
// feedback.
//
// The count used to be global and shared across every study
// ("scribal_last_compile_count"), so marking anything anywhere re-armed the
// animation for everything, and compiling one study disarmed it for all the
// others. It is per study now, keyed by scope.

const PREFIX = "scribal_compile_count:";

export function compileCountKey(scopes: string[]): string {
  return PREFIX + scopes.slice().sort().join("+");
}

export function studyCountKey(studyId: string): string {
  return PREFIX + "study:" + studyId;
}

// Reads the stored count, records the new one, and returns how many were added.
// A study whose marks were DELETED since last compile returns 0 — nothing was
// gathered, so nothing flies.
export function compileDelta(
  key: string,
  count: number,
  store: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage !==
  "undefined"
    ? localStorage
    : null
): number {
  if (!store) return count;
  let last = 0;
  try {
    last = Number(store.getItem(key) || "0") || 0;
  } catch {
    /* storage unavailable — treat as a first compile */
  }
  try {
    store.setItem(key, String(count));
  } catch {
    /* ignore */
  }
  return Math.max(0, count - last);
}
