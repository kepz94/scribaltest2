import { useEffect, useMemo, useState } from "react";
import StudyTablePresent from "./StudyTablePresent";
import MarkedVerse from "./MarkedVerse";
import { watchRoom, themesKey, roomExpired, RoomDoc } from "../presentRoom";
import { getVerse } from "../data/verseIndex";
import { StudyTable } from "../hooks/useStudyTables";
import { Mark } from "../types";

// The follower page a scanned QR opens: subscribes to the room and renders the
// presentation in follow mode. Fully self-contained — the room document carries
// the table, the marks its verses need, and the theme names, so a viewer needs
// no account and no local data.

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#2e2a20",
        color: "#f6f1e2",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        fontFamily: SANS,
      }}
    >
      <div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 14, opacity: 0.75, marginTop: 8, lineHeight: 1.5 }}>
          {body}
        </div>
      </div>
    </div>
  );
}

export default function RoomViewer({ code }: { code: string }) {
  const [room, setRoom] = useState<RoomDoc | null | "loading">("loading");

  useEffect(() => {
    const un = watchRoom(code, (r) =>
      // An expired room reads as ended — same calm closing screen.
      setRoom(r && roomExpired(r) ? { ...r, ended: true } : r)
    );
    return un;
  }, [code]);

  // Every beat change delivers a fresh snapshot, but the heavy payload (the
  // table, all its marks, the theme names) only changes if the table itself
  // does — so parse it ONCE per payload, not on every page turn. Re-parsing
  // megabyte JSON per beat is what made phones lag behind the presenter.
  const tableJson = room !== "loading" && room ? room.tableJson : "";
  const marksJson = room !== "loading" && room ? room.marksJson || "[]" : "[]";
  const themesJson =
    room !== "loading" && room ? room.themesJson || "{}" : "{}";
  const parsed = useMemo(() => {
    if (!tableJson)
      return {
        table: null as StudyTable | null,
        marks: [] as Mark[],
        themes: {} as Record<string, { color: number; label: string }[]>,
      };
    try {
      return {
        table: JSON.parse(tableJson) as StudyTable,
        marks: JSON.parse(marksJson) as Mark[],
        themes: JSON.parse(themesJson) as Record<
          string,
          { color: number; label: string }[]
        >,
      };
    } catch {
      return {
        table: null as StudyTable | null,
        marks: [] as Mark[],
        themes: {} as Record<string, { color: number; label: string }[]>,
      };
    }
  }, [tableJson, marksJson, themesJson]);
  const { table, marks, themes } = parsed;

  if (room === "loading")
    return <Notice title="Joining…" body={"Connecting to room " + code + "."} />;
  if (!room)
    return (
      <Notice
        title="Room not found"
        body="Check the code with the presenter — the room may have been mistyped or removed."
      />
    );
  if (room.ended)
    return (
      <Notice
        title="The presentation has ended"
        body="Thanks for following along."
      />
    );

  if (!table)
    return (
      <Notice
        title="Couldn’t load the presentation"
        body="The room's data didn't come through — ask the presenter to restart the room."
      />
    );

  return (
    <StudyTablePresent
      table={table}
      renderVerse={(reference) => {
        const rec = getVerse(reference);
        if (!rec) return <span>{reference}</span>;
        return (
          <MarkedVerse
            reference={reference}
            verseNumber={rec.verse}
            text={rec.text}
            marks={marks}
          />
        );
      }}
      themesFor={(refs, bookId) => themes[themesKey(refs, bookId)] || []}
      follow={{ i: room.i || 0, revealed: room.revealed || [] }}
      onClose={() => {
        // Nothing behind this page — send the viewer to the app's front door.
        window.location.href =
          window.location.origin + window.location.pathname;
      }}
    />
  );
}
