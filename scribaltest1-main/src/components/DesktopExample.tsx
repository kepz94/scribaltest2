import { useState } from "react";
import scriptures from "../data/scriptures.json";
import { SAMPLE_JOHN1_MARKS } from "../data/sampleStudy";
import { Tab } from "../types";
import MarkedVerse from "./MarkedVerse";
import CompileAnimation from "./CompileAnimation";
import Outline from "./Outline";
import Charting from "./Charting";
import Distilled from "./Distilled";
import Covenants from "./Covenants";

const ACCENT = "#8b5cf6";

interface Props {
  onClose: () => void;
  // Handoff: close the example and open John 1 in the real reader to mark it.
  onTryIt: () => void;
}

interface VRow {
  reference: string;
  verse: number;
  text: string;
}

// John 1's verses come from the bundled scripture text — the sample stores only
// the markings, never the words.
function johnOneVerses(): VRow[] {
  const out: VRow[] = [];
  (scriptures as any).volumes.forEach((vol: any) =>
    vol.books.forEach((bk: any) => {
      if (bk.book !== "John") return;
      bk.chapters.forEach((ch: any) => {
        if (ch.chapter !== 1) return;
        ch.verses.forEach((v: any) =>
          out.push({ reference: v.reference, verse: v.verse, text: v.text })
        );
      });
    })
  );
  return out;
}

// Illustrative theme names a reader might choose for the three colors. In a real
// study these are yours to name; here they show a finished compile (the app
// never assigns meaning on its own).
const EXAMPLE_LABELS: Record<number, string> = {
  1: "The Word",
  2: "Light & Life",
  3: "The Witness",
};

const SAMPLE_VERSES = johnOneVerses();

// John = New Testament (volume 1), book index 3, chapter index 0.
const JOHN_TAB: Tab = {
  id: "example-john1",
  volume: 1,
  book: 3,
  chapter: 0,
  bookId: "master",
};

type CView = "outline" | "charting" | "distilled" | "covenants";

export default function DesktopExample({ onClose, onTryIt }: Props) {
  const [step, setStep] = useState<"marks" | "animating" | "compile">("marks");
  const [view, setView] = useState<CView>("outline");

  // The same prop shape the real desktop compile views receive — built here from
  // the sample marks. Every setter is inert: nothing is written, nothing syncs.
  const shared = {
    tabs: [JOHN_TAB],
    compileTabs: [JOHN_TAB],
    compileSelection: [JOHN_TAB.id],
    onToggleCompileTab: () => {},
    hideTabPicker: true,
    marks: SAMPLE_JOHN1_MARKS,
    colorLabels: EXAMPLE_LABELS,
    setColorLabel: () => {},
    onJumpToReference: () => setStep("marks"),
  };

  const overlay = (children: React.ReactNode) => (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        backgroundColor: "var(--bg)",
        color: "var(--text)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );

  const closeBtn = (
    <button
      onClick={onClose}
      aria-label="Close example"
      style={{
        width: "36px",
        height: "36px",
        background: "transparent",
        border: "none",
        color: "var(--text)",
        fontSize: "24px",
        cursor: "pointer",
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      ×
    </button>
  );

  const primaryBtn = (label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      style={{
        background: "var(--text)",
        color: "var(--bg)",
        border: "none",
        borderRadius: "999px",
        padding: "11px 22px",
        fontSize: "14px",
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );

  const quietBtn = (label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        color: "var(--text)",
        border: "1px solid var(--border)",
        borderRadius: "999px",
        padding: "10px 18px",
        fontSize: "13.5px",
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );

  const viewTab = (v: CView, label: string) => (
    <button
      onClick={() => setView(v)}
      style={{
        padding: "9px 18px",
        border: "none",
        cursor: "pointer",
        fontSize: "13.5px",
        fontWeight: view === v ? 600 : 400,
        backgroundColor: view === v ? ACCENT : "transparent",
        color: view === v ? "#fff" : "var(--muted)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );

  // ---- Compiled beat (the real desktop views, on the sample marks) ----
  if (step === "compile") {
    return overlay(
      <>
        <div
          style={{
            flexShrink: 0,
            borderBottom: "1px solid var(--border)",
            padding: "12px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {closeBtn}
            <div
              style={{
                fontSize: "11px",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--muted)",
              }}
            >
              Example · John 1
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div
              style={{
                display: "flex",
                border: "1px solid var(--border)",
                borderRadius: "999px",
                overflow: "hidden",
                backgroundColor: "var(--panel)",
                flexWrap: "wrap",
              }}
            >
              {viewTab("outline", "Outline")}
              {viewTab("charting", "Charting")}
              {viewTab("distilled", "Distilled")}
              {viewTab("covenants", "Relational")}
            </div>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "24px 20px",
          }}
        >
          <div style={{ maxWidth: "760px", margin: "0 auto" }}>
            {view === "outline" && (
              <Outline {...shared} notes={{}} setNote={() => {}} />
            )}
            {view === "charting" && <Charting {...shared} />}
            {view === "distilled" && <Distilled {...shared} />}
            {view === "covenants" && <Covenants {...shared} />}
          </div>
        </div>

        <div
          style={{
            flexShrink: 0,
            borderTop: "1px solid var(--border)",
            padding: "14px 20px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "12px",
          }}
        >
          {quietBtn("‹ Back to the marked chapter", () => setStep("marks"))}
          {primaryBtn("Mark John 1 yourself →", onTryIt)}
        </div>
      </>
    );
  }

  // ---- Marked beat (the "before"); verses stay mounted during the animation ----
  return overlay(
    <>
      <div
        style={{
          flexShrink: 0,
          borderBottom: "1px solid var(--border)",
          padding: "12px 20px",
        }}
      >
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {closeBtn}
            <div>
              <div
                style={{
                  fontSize: "11px",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                }}
              >
                Example
              </div>
              <div
                style={{
                  fontFamily: '"Iowan Old Style", Georgia, serif',
                  fontSize: "22px",
                  fontWeight: 700,
                }}
              >
                John 1
              </div>
            </div>
          </div>
          <div
            style={{
              fontSize: "13.5px",
              color: "var(--muted)",
              lineHeight: 1.5,
              marginTop: "8px",
            }}
          >
            This chapter is already marked. In Scribal you read and mark what
            stands out, then gather those marks into a study. Look over the
            marks, then compile them below to see the same marks become an
            Outline, Charting, Distilled, and Relational study.
          </div>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "24px 20px",
        }}
      >
        <div
          style={{
            maxWidth: "760px",
            margin: "0 auto",
            fontFamily: '"Iowan Old Style", Georgia, serif',
            fontSize: "19px",
            lineHeight: 1.75,
            color: "var(--text)",
          }}
        >
          {SAMPLE_VERSES.map((v) => (
            <MarkedVerse
              key={v.reference}
              reference={v.reference}
              verseNumber={v.verse}
              text={v.text}
              marks={SAMPLE_JOHN1_MARKS}
            />
          ))}
        </div>
      </div>

      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid var(--border)",
          padding: "14px 20px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        {primaryBtn("Compile these marks →", () => setStep("animating"))}
      </div>

      {step === "animating" && (
        <CompileAnimation duration={1400} onDone={() => setStep("compile")} />
      )}
    </>
  );
}
