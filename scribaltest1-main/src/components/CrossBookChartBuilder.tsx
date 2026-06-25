import { useState } from "react";
import scriptures from "../data/scriptures.json";

const vols = scriptures.volumes;

interface Props {
  // Receives the chosen chapter scopes ("Genesis 1", "1 Nephi 3", …) and a name.
  onCreate: (scopes: string[], name: string) => void;
  onClose: () => void;
}

type Picked = { scope: string; order: number };

export default function CrossBookChartBuilder({ onCreate, onClose }: Props) {
  const [vol, setVol] = useState(0);
  const [bk, setBk] = useState(0);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [name, setName] = useState("");

  const book = vols[vol].books[bk];
  const scopeOf = (chapterNum: number | string) => book.book + " " + chapterNum;
  const orderOfPick = (ci: number) => vol * 1_000_000 + bk * 1_000 + ci;

  const isPicked = (scope: string) => picked.some((p) => p.scope === scope);

  const toggle = (ci: number) => {
    const scope = scopeOf(vols[vol].books[bk].chapters[ci].chapter);
    setPicked((prev) =>
      prev.some((p) => p.scope === scope)
        ? prev.filter((p) => p.scope !== scope)
        : [...prev, { scope, order: orderOfPick(ci) }]
    );
  };

  const remove = (scope: string) =>
    setPicked((prev) => prev.filter((p) => p.scope !== scope));

  const sorted = [...picked].sort((a, b) => a.order - b.order);

  const pill = {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: "999px",
    padding: "8px 14px",
    fontSize: "13px",
    cursor: "pointer",
    fontFamily: "inherit",
  } as React.CSSProperties;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 392,
        background: "var(--bg)",
        color: "var(--text)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "14px 18px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        <div style={{ flex: 1, fontSize: "16px", fontWeight: 700 }}>
          New mixed-book chart
        </div>
        <button onClick={onClose} style={pill}>
          Close
        </button>
      </div>

      <div
        style={{ maxWidth: "760px", margin: "0 auto", padding: "18px 16px 64px" }}
      >
        <div
          style={{
            color: "var(--muted)",
            fontSize: "13.5px",
            lineHeight: 1.6,
            marginBottom: "20px",
          }}
        >
          Pick chapters from any books — they'll be charted together and saved as
          a study you can reopen. Themes line up across every chapter you choose.
        </div>

        {/* Volume + book selectors */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            flexWrap: "wrap",
            marginBottom: "16px",
          }}
        >
          <select
            value={vol}
            onChange={(e) => {
              setVol(Number(e.target.value));
              setBk(0);
            }}
            style={{
              padding: "9px 12px",
              borderRadius: "10px",
              border: "1px solid var(--border)",
              background: "var(--soft)",
              color: "var(--text)",
              fontSize: "14px",
              fontFamily: "inherit",
            }}
          >
            {vols.map((v, i) => (
              <option key={i} value={i}>
                {v.volume}
              </option>
            ))}
          </select>
          <select
            value={bk}
            onChange={(e) => setBk(Number(e.target.value))}
            style={{
              padding: "9px 12px",
              borderRadius: "10px",
              border: "1px solid var(--border)",
              background: "var(--soft)",
              color: "var(--text)",
              fontSize: "14px",
              fontFamily: "inherit",
              flex: 1,
              minWidth: "160px",
            }}
          >
            {vols[vol].books.map((b, i) => (
              <option key={i} value={i}>
                {b.book}
              </option>
            ))}
          </select>
        </div>

        {/* Chapter grid */}
        <div
          style={{
            fontSize: "11px",
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            color: "var(--muted)",
            marginBottom: "10px",
          }}
        >
          Chapters in {book.book}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "7px",
            marginBottom: "24px",
          }}
        >
          {book.chapters.map((c, ci) => {
            const scope = scopeOf(c.chapter);
            const on = isPicked(scope);
            return (
              <button
                key={ci}
                onClick={() => toggle(ci)}
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "9px",
                  border: on
                    ? "1px solid transparent"
                    : "1px solid var(--border)",
                  background: on ? "var(--text)" : "var(--soft)",
                  color: on ? "var(--bg)" : "var(--text)",
                  fontSize: "14px",
                  fontWeight: on ? 700 : 400,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {c.chapter}
              </button>
            );
          })}
        </div>

        {/* Selected */}
        <div
          style={{
            fontSize: "11px",
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            color: "var(--muted)",
            marginBottom: "10px",
          }}
        >
          Selected ({picked.length})
        </div>
        {picked.length === 0 ? (
          <div
            style={{
              color: "var(--muted)",
              fontSize: "13.5px",
              padding: "4px 0 22px",
            }}
          >
            Nothing picked yet. Tap chapter numbers above — switch books and keep
            adding.
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
              marginBottom: "24px",
            }}
          >
            {sorted.map((p) => (
              <button
                key={p.scope}
                onClick={() => remove(p.scope)}
                title="Remove"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "7px 12px",
                  borderRadius: "999px",
                  border: "1px solid var(--border)",
                  background: "var(--soft)",
                  color: "var(--text)",
                  fontSize: "13px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {p.scope}
                <span style={{ color: "var(--muted)", fontSize: "15px" }}>
                  ×
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Name + create */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            alignItems: "center",
            flexWrap: "wrap",
            borderTop: "1px solid var(--border)",
            paddingTop: "20px",
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this chart"
            style={{
              flex: 1,
              minWidth: "200px",
              padding: "11px 14px",
              borderRadius: "10px",
              border: "1px solid var(--border)",
              background: "var(--soft)",
              color: "var(--text)",
              fontSize: "14px",
              fontFamily: "inherit",
              outline: "none",
            }}
          />
          <button
            disabled={picked.length === 0}
            onClick={() => onCreate(sorted.map((p) => p.scope), name.trim())}
            style={{
              padding: "11px 20px",
              borderRadius: "10px",
              border: "none",
              background: picked.length === 0 ? "var(--soft)" : "var(--text)",
              color: picked.length === 0 ? "var(--muted)" : "var(--bg)",
              fontSize: "14px",
              fontWeight: 600,
              cursor: picked.length === 0 ? "default" : "pointer",
              fontFamily: "inherit",
            }}
          >
            Create chart
          </button>
        </div>
      </div>
    </div>
  );
}
