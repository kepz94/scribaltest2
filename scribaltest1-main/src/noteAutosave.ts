// When an open note editor should write its text back to the store.
//
// A note used to reach state ONLY when Done was pressed. Everything else in the
// app commits as you go — a mark is in the reducer (and in localStorage, and on
// its way to the cloud) the instant you make it — so a synthesis you had typed
// but not "finished" lived nowhere but the editor's own memory. Leaving the
// screen unmounted the editor and the words went with it, which reads exactly
// like a save that silently failed. This module holds the rule that decides
// what an editor state is worth writing, so the rule is one thing and can be
// tested; RichNoteField cannot be unit-tested at all, because jest cannot
// resolve @lexical/react's export map (the same reason cardText.ts exists).
//
// The asymmetry below is the whole point. Autosave may only ever ADD text. Only
// a deliberate act — Done on an editor the user emptied, or Delete — may write
// a blank, because a blank write is a deletion and under last-write-wins a
// deletion travels. An autosave firing mid-edit (select-all, then a pause
// before retyping) must never be able to erase a note on another device.

export type CommitReason =
  // A pause in typing, a blur, leaving the screen, the tab going away.
  | "typing"
  // The user pressed Done.
  | "done";

// The visible words in an editor's HTML — what decides "is this note empty",
// as opposed to a document holding one empty paragraph and nothing else.
export function plainTextOf(html: string): string {
  return String(html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/ /g, " ")
    .trim();
}

export interface NoteCommit {
  save: boolean;
  text: string;
}

// `html` is the editor's current serialization, `stored` the value the field was
// handed (and the value we believe is in the store right now).
export function noteCommit(
  html: string,
  stored: string,
  reason: CommitReason
): NoteCommit {
  const text = plainTextOf(html);
  if (text) {
    // Identical text is not a save. The reducer stamps every write and the
    // stamp decides merges, so re-writing what is already there would hand this
    // device a "newer" copy of a note it never edited — enough to beat a real
    // edit made somewhere else.
    if (html === stored) return { save: false, text: html };
    return { save: true, text: html };
  }
  // The editor is empty. Emptying text the user could actually see is a real
  // clear, but only when they said so: an editor that opened empty and is still
  // empty has nothing to say, and writing "" for it is how an untouched Done
  // used to erase a note the editor had simply never been handed.
  if (reason === "done" && plainTextOf(stored)) return { save: true, text: "" };
  return { save: false, text: "" };
}

// How long a pause counts as "stopped typing", and the longest anyone can type
// without a commit. The pause is what normally fires; the ceiling exists so an
// unbroken stretch of writing is not one long unsaved window.
export const AUTOSAVE_PAUSE_MS = 600;
export const AUTOSAVE_MAX_WAIT_MS = 4000;

// Whether a pending edit should be written now or after another pause.
// `since` is when the oldest uncommitted keystroke arrived.
export function autosaveDueNow(now: number, since: number): boolean {
  return now - since >= AUTOSAVE_MAX_WAIT_MS;
}
