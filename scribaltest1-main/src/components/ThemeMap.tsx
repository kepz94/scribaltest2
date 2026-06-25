import { useState } from "react";
import { MarkColor, MarkStyle, markStyleCSS, COLOR_MAP } from "../types";

// One marked verse under a theme. Carries its own text + span so it can render
// the marking inline without re-reading scripture.
export type ThemeHit = {
  reference: string;
  verseText: string;
  markedText: string;
  startIndex: number;
  endIndex: number;
  style: MarkStyle;
  color: MarkColor;
};

export type ThemeBookGroup = { book: string; hits: ThemeHit[] };

// A theme = a distinct color-label name. The same name can span more than one
// color (rare), so colors is a list; count + groups summarize where it appears.
export type ThemeEntry = {
  name: string;
  colors: MarkColor[];
  count: number;
  groups: ThemeBookGroup[];
};

interface Props {
  themes: ThemeEntry[];
  onClose: () => void;
}

function Swatch({ color }: { color: MarkColor }) {
  return (
    <span
      style={{
        width: "11px",
        height: "11px",
        borderRadius: "50%",
        backgroundColor: COLOR_MAP[color],
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

function HitText({ hit }: { hit: ThemeHit }) {
  const { verseText, startIndex, endIndex, style, color, markedText } = hit;
  const ok =
    startIndex >= 0 &&
    endIndex > startIndex &&
    endIndex <= verseText.length &&
    verseText.slice(startIndex, endIndex) === markedText;
  if (!ok) {
    // Indices don't line up with the stored text — show the verse plainly so
    // nothing is mis-highlighted.
    return <span>{verseText}</span>;
  }
  return (
    <span>
      {verseText.slice(0, startIndex)}
      <span style={markStyleCSS(style, color)}>
        {verseText.slice(startIndex, endIndex)}
      </span>
      {verseText.slice(endIndex)}
    </span>
  );
}

export default function ThemeMap({ themes, onClose }: Props) {
  const [selectedName, setSelectedName] = useState<string | null>(
    themes.length ? themes[0].name : null
  );
  const selected =
    themes.find((t) => t.name === selectedName) || themes[0] || null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 390,
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
          Themes across scripture
        </div>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text)",
            borderRadius: "999px",
            padding: "8px 14px",
            fontSize: "13px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Close
        </button>
      </div>

      <div
        style={{
          maxWidth: "760px",
          margin: "0 auto",
          padding: "18px 16px 64px",
        }}
      >
        {themes.length === 0 ? (
          <div
            style={{
              color: "var(--muted)",
              fontSize: "14px",
              lineHeight: 1.6,
              padding: "32px 4px",
              textAlign: "center",
            }}
          >
            No named themes yet. Give your marking colors names (in the color
            key) and the verses you mark with them will gather here, grouped by
            book across all of scripture.
          </div>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                marginBottom: "22px",
              }}
            >
              {themes.map((t) => {
                const active = selected != null && t.name === selected.name;
                return (
                  <button
                    key={t.name}
                    onClick={() => setSelectedName(t.name)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "7px",
                      padding: "7px 12px",
                      borderRadius: "999px",
                      border: active
                        ? "1px solid transparent"
                        : "1px solid var(--border)",
                      background: active ? "var(--text)" : "transparent",
                      color: active ? "var(--bg)" : "var(--text)",
                      fontSize: "13px",
                      fontFamily: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    <Swatch color={t.colors[0]} />
                    {t.name}
                    <span style={{ opacity: 0.6 }}>{t.count}</span>
                  </button>
                );
              })}
            </div>

            {selected && (
              <div>
                <div
                  style={{
                    fontSize: "13px",
                    color: "var(--muted)",
                    marginBottom: "14px",
                  }}
                >
                  {selected.count}{" "}
                  {selected.count === 1 ? "verse" : "verses"} ·{" "}
                  {selected.groups.length}{" "}
                  {selected.groups.length === 1 ? "book" : "books"}
                </div>

                {selected.groups.map((g) => (
                  <div key={g.book} style={{ marginBottom: "22px" }}>
                    <div
                      style={{
                        fontSize: "13px",
                        fontWeight: 700,
                        color: "var(--text)",
                        borderBottom: "1px solid var(--border)",
                        paddingBottom: "5px",
                        marginBottom: "10px",
                      }}
                    >
                      {g.book}{" "}
                      <span
                        style={{
                          fontWeight: 400,
                          color: "var(--muted)",
                        }}
                      >
                        · {g.hits.length}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                      }}
                    >
                      {g.hits.map((hit) => (
                        <div key={hit.reference}>
                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--muted)",
                              marginBottom: "2px",
                            }}
                          >
                            {hit.reference}
                          </div>
                          <div
                            style={{
                              fontSize: "15px",
                              lineHeight: 1.55,
                            }}
                          >
                            <HitText hit={hit} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
