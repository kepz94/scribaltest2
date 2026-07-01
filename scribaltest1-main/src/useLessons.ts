import { useEffect, useState } from "react";
import type { MarkColor } from "../types";

// A Lesson = a free-form board of cards (desktop) that reads as an ordered
// stack (mobile). It's a curated teaching artifact built ON TOP of marks and
// studies; the system never arranges it — placement is the interpreter's.
//
// Persistence + sync mirror useStudies exactly: one localStorage key, shared
// shape across desktop and mobile, and a last-write-wins merge with tombstones
// so a lesson built on one device shows up (and stays in step) on the other.
// The whole board is the sync unit — a lesson is edited on one device at a
// time — so content merges by updatedAt rather than per-card, which keeps the
// model simple and predictable. Rename and delete carry their own timestamps
// (nameAt / deletedAt) so those actions propagate independently of edits.

export type LessonCardKind =
  | "title"
  | "header"
  | "text"
  | "bullets"
  | "verse"
  | "question"
  | "quote"
  | "experience"
  | "invitation";

export interface LessonCard {
  id: string;
  kind: LessonCardKind;
  // Board placement. Position also drives the mobile stack order (top-to-bottom,
  // then left-to-right), so where a card sits is the only ordering signal.
  x: number;
  y: number;
  w: number;
  h: number;
  // Theme spine color, drawn from the marking palette (1-10). Absent/null = none.
  color?: MarkColor | null;
  // Content. Only the fields relevant to `kind` are set.
  text?: string; // title / header / text / bullets / question / quote / experience / invitation
  reference?: string; // verse card: scripture ref; marks render LIVE from the session below
  bookId?: string; // verse card: which marking session's marks to show ("master" by default)
  tag?: string; // question ladder step: factual | analytical | application | feeling
  attribution?: string; // quote source line
}

export type ConnectorKind = "supports" | "leads to" | "contrasts" | "fulfills";

export interface LessonConnector {
  id: string;
  from: string; // card id
  to: string; // card id
  kind: ConnectorKind;
}

export interface Lesson {
  id: string;
  name: string;
  cards: LessonCard[];
  connectors: LessonConnector[];
  createdAt: number;
  // Last content edit (cards/connectors/name). Drives last-write-wins on merge.
  updatedAt: number;
  // When the name was last set by the user. Lets a rename win a sync without a
  // plain edit's newer updatedAt clobbering it. Absent => treated as createdAt.
  nameAt?: number;
  // Tombstone. A lesson counts as deleted only while the delete is its newest
  // action (>= nameAt and updatedAt), so a later edit or rename revives it.
  deletedAt?: number;
}

// A lesson is hidden iff its delete is its newest action.
export const isLessonDeleted = (l: Lesson): boolean =>
  !!l.deletedAt &&
  l.deletedAt >= (l.nameAt || 0) &&
  l.deletedAt >= (l.updatedAt || 0);

const KEY = "scribal_lessons_v1";

const newId = (): string =>
  "lesson_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);

export function useLessons() {
  const [lessons, setLessons] = useState<Lesson[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(raw) ? (raw as Lesson[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(lessons));
    } catch {}
  }, [lessons]);

  // Create a blank lesson and return its id so the caller can open it.
  const createLesson = (name = "Untitled lesson"): string => {
    const now = Date.now();
    const id = newId();
    setLessons((prev) => [
      {
        id,
        name,
        cards: [],
        connectors: [],
        createdAt: now,
        updatedAt: now,
        nameAt: now,
      },
      ...prev,
    ]);
    return id;
  };

  // Save an edit to a lesson: any of cards / connectors / name. Always advances
  // updatedAt; advances nameAt only when the name actually changes, so a board
  // edit can't make a stale name win a rename sync.
  const updateLesson = (
    id: string,
    changes: Partial<Pick<Lesson, "name" | "cards" | "connectors">>
  ) => {
    setLessons((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const now = Date.now();
        const nameChanged =
          changes.name !== undefined && changes.name !== l.name;
        return {
          ...l,
          ...changes,
          updatedAt: now,
          nameAt: nameChanged ? now : l.nameAt || l.createdAt,
        };
      })
    );
  };

  const renameLesson = (id: string, name: string) => updateLesson(id, { name });

  // Soft-delete: tombstone the lesson (kept, stamped) so the deletion travels to
  // other devices. Filtered out of the returned list below.
  const deleteLesson = (id: string) =>
    setLessons((prev) =>
      prev.map((l) => (l.id === id ? { ...l, deletedAt: Date.now() } : l))
    );

  // Merge a remote lessons snapshot (another device's backup) into ours.
  //  - A lesson we've never seen (new id) is added.
  //  - A lesson we both have: NAME from whichever device set it most recently
  //    (nameAt); CONTENT (cards + connectors) from whichever edited most
  //    recently (updatedAt); updatedAt + deletedAt advance to the latest.
  // Idempotent: returns the previous array unchanged when nothing differs, so it
  // never churns the sync loop.
  const mergeRemote = (raw: string | null | undefined) => {
    if (!raw) return;
    let remote: Lesson[];
    try {
      const parsed = JSON.parse(raw);
      remote = Array.isArray(parsed) ? (parsed as Lesson[]) : [];
    } catch {
      return;
    }
    if (!remote.length) return;
    setLessons((prev) => {
      const byId = new Map<string, Lesson>(prev.map((l) => [l.id, l]));
      let changed = false;
      remote.forEach((r) => {
        if (!r || !r.id) return;
        const local = byId.get(r.id);
        if (!local) {
          byId.set(r.id, r);
          changed = true;
          return;
        }
        const lNameAt = local.nameAt || local.createdAt || 0;
        const rNameAt = r.nameAt || r.createdAt || 0;
        const name = rNameAt > lNameAt ? r.name : local.name;
        const nameAt = Math.max(lNameAt, rNameAt);
        const contentNewer = (r.updatedAt || 0) > (local.updatedAt || 0);
        const cards = contentNewer ? r.cards || [] : local.cards;
        const connectors = contentNewer
          ? r.connectors || []
          : local.connectors;
        const updatedAt = Math.max(local.updatedAt || 0, r.updatedAt || 0);
        const deletedAt = Math.max(local.deletedAt || 0, r.deletedAt || 0);
        const differs =
          name !== local.name ||
          nameAt !== (local.nameAt || 0) ||
          updatedAt !== (local.updatedAt || 0) ||
          deletedAt !== (local.deletedAt || 0) ||
          contentNewer;
        if (differs) {
          const merged: Lesson = {
            ...local,
            name,
            nameAt,
            cards,
            connectors,
            updatedAt,
          };
          if (deletedAt) merged.deletedAt = deletedAt;
          byId.set(r.id, merged);
          changed = true;
        }
      });
      if (!changed) return prev;
      return Array.from(byId.values()).sort(
        (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
      );
    });
  };

  // Consumers see only live lessons; the full list (with tombstones) is what's
  // persisted and synced, so deletions still propagate between devices.
  const visibleLessons = lessons.filter((l) => !isLessonDeleted(l));

  return {
    lessons: visibleLessons,
    createLesson,
    updateLesson,
    renameLesson,
    deleteLesson,
    setLessons,
    mergeRemote,
  };
}
