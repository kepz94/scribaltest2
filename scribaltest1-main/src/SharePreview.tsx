import { useEffect, useState } from "react";
import {
  renderVerseCard,
  renderCompilationCard,
  renderVersesCard,
  canvasURL,
  shareCanvas,
  CompTheme,
  VersesCardEntry,
  VersesSynthesis,
} from "./shareCard";

interface CC {
  bg: string;
  panel: string;
  soft: string;
  text: string;
  muted: string;
  border: string;
}

interface VerseData {
  phrase: string;
  reference: string;
  theme: string;
  style: string;
  color: number;
}
interface CompData {
  scopeTitle: string;
  studyLabel: string;
  dateStr: string;
  totalMarks: number;
  passages: number;
  themes: CompTheme[];
  candidates: { text: string; reference: string; style: string; color: number }[];
  defaultFeatured: number;
}

interface Props {
  C: CC;
  appDark: boolean;
  kind: "verse" | "compilation" | "verses";
  verse?: VerseData;
  comp?: CompData;
  verses?: VersesCardEntry[];
  syntheses?: VersesSynthesis[];
  onClose: () => void;
  onFlash: (m: string) => void;
}

export default function SharePreview({
  C,
  appDark,
  kind,
  verse,
  comp,
  verses,
  syntheses,
  onClose,
  onFlash,
}: Props) {
  const [cardDark, setCardDark] = useState(appDark);
  const [featured, setFeatured] = useState(comp ? comp.defaultFeatured : 0);
  const [showNotes, setShowNotes] = useState(true);
  const [showSynthesis, setShowSynthesis] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const hasNotes = !!verses && verses.some((v) => (v.note || "").trim());
  const hasSynth = !!syntheses && syntheses.some((s) => s.text.trim());

  const build = (): HTMLCanvasElement | null => {
    if (kind === "verse" && verse) {
      return renderVerseCard({ ...verse, dark: cardDark });
    }
    if (kind === "verses" && verses) {
      return renderVersesCard({
        verses,
        dark: cardDark,
        showNotes,
        showSynthesis,
        syntheses,
      });
    }
    if (kind === "compilation" && comp) {
      const hero =
        comp.candidates.length > 0
          ? comp.candidates[
              Math.max(0, Math.min(featured, comp.candidates.length - 1))
            ]
          : null;
      return renderCompilationCard({
        scopeTitle: comp.scopeTitle,
        studyLabel: comp.studyLabel,
        dateStr: comp.dateStr,
        totalMarks: comp.totalMarks,
        passages: comp.passages,
        hero,
        themes: comp.themes,
        dark: cardDark,
      });
    }
    return null;
  };

  useEffect(() => {
    const c = build();
    if (c) setUrl(canvasURL(c));
    // eslint: re-render preview when inputs change
  }, [cardDark, featured, kind, showNotes, showSynthesis]);

  const doShare = async () => {
    const c = build();
    if (!c) {
      onFlash("Couldn't create image");
      return;
    }
    setBusy(true);
    const caption =
      kind === "verse" && verse
        ? verse.phrase + " — " + verse.reference
        : kind === "verses" && verses
        ? verses.map((v) => v.reference).join(", ") + " — Scribal"
        : comp
        ? comp.scopeTitle +
          (comp.studyLabel.trim() ? " · " + comp.studyLabel.trim() : "") +
          " — a study in Scribal"
        : "Scribal";
    const r = await shareCanvas(
      c,
      kind === "verse"
        ? "scribal-verse.png"
        : kind === "verses"
        ? "scribal-verses.png"
        : "scribal-study.png",
      caption
    );
    setBusy(false);
    if (r === "downloaded") {
      onFlash("Image saved");
      onClose();
    } else if (r === "failed") {
      onFlash("Couldn't create image");
    } else {
      onClose();
    }
  };

  const seg = (on: boolean) => ({
    flex: 1,
    padding: "10px",
    borderRadius: "9px",
    border: "1px solid " + C.border,
    background: on ? C.text : "transparent",
    color: on ? C.bg : C.text,
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  });
  const cyc = {
    width: "40px",
    height: "40px",
    borderRadius: "9px",
    border: "1px solid " + C.border,
    background: "transparent",
    color: C.text,
    fontSize: "20px",
    cursor: "pointer",
    fontFamily: "inherit",
    flexShrink: 0,
  } as const;

  const candCount = comp ? comp.candidates.length : 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        animation: "mob-fadein 0.18s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "360px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "16px",
        }}
      >
        {url ? (
          <img
            src={url}
            alt="Share preview"
            style={{
              width: "78%",
              maxWidth: "300px",
              borderRadius: "14px",
              boxShadow: "0 14px 44px rgba(0,0,0,0.45)",
            }}
          />
        ) : (
          <div style={{ color: "#fff", padding: "40px" }}>Rendering…</div>
        )}

        <div
          style={{
            width: "100%",
            background: C.panel,
            color: C.text,
            borderRadius: "16px",
            padding: "14px",
            boxShadow: "0 -2px 20px rgba(0,0,0,0.2)",
          }}
        >
          {kind === "compilation" && candCount > 0 && (
            <>
              <div
                style={{
                  fontSize: "11px",
                  color: C.muted,
                  marginBottom: "8px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Featured verse
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  marginBottom: "14px",
                }}
              >
                <button
                  onClick={() =>
                    setFeatured((f) => (f - 1 + candCount) % candCount)
                  }
                  style={cyc}
                  aria-label="Previous verse"
                >
                  ‹
                </button>
                <div
                  style={{
                    flex: 1,
                    textAlign: "center",
                    fontSize: "13.5px",
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {comp!.candidates[
                    Math.max(0, Math.min(featured, candCount - 1))
                  ].reference}
                </div>
                <button
                  onClick={() => setFeatured((f) => (f + 1) % candCount)}
                  style={cyc}
                  aria-label="Next verse"
                >
                  ›
                </button>
              </div>
            </>
          )}

          {kind === "verses" && (hasNotes || hasSynth) && (
            <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
              {hasNotes && (
                <button
                  onClick={() => setShowNotes((s) => !s)}
                  style={seg(showNotes)}
                >
                  {showNotes ? "\u2713 Notes" : "Notes"}
                </button>
              )}
              {hasSynth && (
                <button
                  onClick={() => setShowSynthesis((s) => !s)}
                  style={seg(showSynthesis)}
                >
                  {showSynthesis ? "\u2713 Synthesis" : "Synthesis"}
                </button>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
            <button onClick={() => setCardDark(false)} style={seg(!cardDark)}>
              Light
            </button>
            <button onClick={() => setCardDark(true)} style={seg(cardDark)}>
              Dark
            </button>
          </div>

          <button
            onClick={doShare}
            disabled={busy}
            style={{
              width: "100%",
              padding: "14px",
              borderRadius: "10px",
              border: "none",
              background: C.text,
              color: C.bg,
              fontSize: "15px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              opacity: busy ? 0.6 : 1,
              marginBottom: "8px",
            }}
          >
            {busy ? "Sharing…" : "Share"}
          </button>
          <button
            onClick={onClose}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: "10px",
              border: "1px solid " + C.border,
              background: "transparent",
              color: C.text,
              fontSize: "13px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
