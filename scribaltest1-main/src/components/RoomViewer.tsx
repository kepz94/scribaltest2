import { useEffect, useState } from "react";
import StudyTablePresent from "./StudyTablePresent";
import MarkedVerse from "./MarkedVerse";
import { watchRoom, themesKey, RoomDoc } from "../presentRoom";
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
    const un = watchRoom(code, (r) => setRoom(r));
    return un;
  }, [code]);

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

  let table: StudyTable | null = null;
  let marks: Mark[] = [];
  let themes: Record<string, { color: number; label: string }[]> = {};
  try {
    table = JSON.parse(room.tableJson) as StudyTable;
    marks = JSON.parse(room.marksJson || "[]") as Mark[];
    themes = JSON.parse(room.themesJson || "{}");
  } catch {
    table = null;
  }
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
