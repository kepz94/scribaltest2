import { useState } from "react";
import scriptures from "../data/scriptures.json";
import { SAMPLE_JOHN1_MARKS } from "../data/sampleStudy";
import MarkedVerse from "./MarkedVerse";
import MobileCompile from "../MobileCompile";

interface Palette {
  bg: string;
  panel: string;
  soft: string;
  text: string;
  muted: string;
  border: string;
}

interface Props {
  C: Palette;
  dark: boolean;
  onClose: () => void;
}

interface VRow {
  reference: string;
  verse: number;
  text: string;
}

// Pull John 1's verses straight from the bundled scripture text — the words are
// never stored in the sample; only the markings are.
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

// Illustrative theme names a reader might give the three colors in this study.
// In a real study these are yours to name; here they show what a finished
// compile looks like (the app never assigns meaning on its own).
const EXAMPLE_LABELS: Record<number, string> = {
  1: "The Word",
  2: "Light & Life",
  3: "The Witness",
};

const SAMPLE_VERSES = johnOneVerses();

export default function ExampleStudy({ C, dark, onClose }: Props) {
  const [step, setStep] = useState<"marks" | "compile">("marks");

  // Sort marks within the chapter by verse number (e.g. "John 1:5" -> 5).
  const orderOf = (ref: string) => {
    const n = parseInt(ref.split(":")[1] || "0", 10);
    return Number.isNaN(n) ? 0 : n;
  };

  // The "after" — the real compile engine, run on the sample marks. Read-only:
  // nothing is written, nothing syncs.
  if (step === "compile") {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 400,
          backgroundColor: C.bg,
        }}
      >
        <MobileCompile
          marks={SAMPLE_JOHN1_MARKS}
          studyScopes={["John 1"]}
          colorLabels={EXAMPLE_LABELS}
          C={C}
          orderOf={orderOf}
          sessionNew={new Set<string>()}
          onJump={() => setStep("marks")}
          notes={{}}
          setNote={() => {}}
          onSave={() => {}}
          defaultName="John 1"
          onClose={() => setStep("marks")}
          dark={dark}
          title="John 1"
          scope="John 1"
          onFlash={() => {}}
          readOnly
        />
      </div>
    );
  }

  // The "before" — the marked chapter, so the transformation is visible.
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        backgroundColor: C.bg,
        color: C.text,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: "calc(env(safe-area-inset-top) + 10px) 16px 12px",
          borderBottom: "1px solid " + C.border,
          backgroundColor: C.bg,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={onClose}
            aria-label="Close example"
            style={{
              width: "36px",
              height: "36px",
              marginLeft: "-6px",
              background: "transparent",
              border: "none",
              color: C.text,
              fontSize: "24px",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ×
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: "11px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: C.muted,
              }}
            >
              Example
            </div>
            <div
              style={{
                fontFamily: '"Times New Roman", Times, serif',
                fontSize: "20px",
                fontWeight: 700,
              }}
            >
              John 1
            </div>
          </div>
        </div>
        <div
          style={{
            fontSize: "13px",
            color: C.muted,
            lineHeight: 1.5,
            marginTop: "8px",
          }}
        >
          This chapter is already marked. In Scribal you read and mark what
          stands out, then gather those marks into a study. Look over the marks,
          then compile them below.
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          padding: "18px 20px 8px",
          fontFamily: '"Times New Roman", Times, serif',
          fontSize: "19px",
          lineHeight: 1.7,
          color: C.text,
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

      <div
        style={{
          flexShrink: 0,
          padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
          borderTop: "1px solid " + C.border,
          backgroundColor: C.bg,
        }}
      >
        <button
          onClick={() => setStep("compile")}
          style={{
            width: "100%",
            background: C.text,
            color: C.bg,
            border: "none",
            borderRadius: "999px",
            padding: "13px 18px",
            fontSize: "14px",
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Compile these marks →
        </button>
      </div>
    </div>
  );
}
