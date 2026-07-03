import { useState } from "react";
import { getScriptures, volumesProxy } from "../data/scripturesStore";
import { SAMPLE_JOHN1_MARKS } from "../data/sampleStudy";
import { COLORS, COLOR_MAP, HIGHLIGHT_MAP, MarkColor, Tool } from "../types";
import MobileVerse from "../MobileVerse";
import CompileAnimation from "./CompileAnimation";
import MobileCompile from "../MobileCompile";
import SpotlightTour from "./SpotlightTour";
import { EXAMPLE_TOUR, READING_TOUR } from "../data/exampleTour";

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
  // Handoff: close the example and drop the reader into John 1 to mark for real.
  onTryIt: () => void;
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
  getScriptures().volumes.forEach((vol: any) =>
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

// Lazy: johnOneVerses reads the runtime-loaded scripture data, so this must
// not run at module scope (it black-screens the whole app before React mounts).
let _sampleVerses: VRow[] | null = null;
const SAMPLE_VERSES_GET = (): VRow[] =>
  _sampleVerses || (_sampleVerses = johnOneVerses());

// The five marking styles, mirroring the reader's pen tray (eraser is left out
// of the example since there is nothing to erase).
const STYLE_LABELS: { tool: Tool; label: string }[] = [
  { tool: "highlight", label: "Highlight" },
  { tool: "underline", label: "Underline" },
  { tool: "bold", label: "Bold" },
  { tool: "italic", label: "Italic" },
  { tool: "circle", label: "Circle" },
];

export default function ExampleStudy({ C, dark, onClose, onTryIt }: Props) {
  const [step, setStep] = useState<"marks" | "animating" | "compile">("marks");
  const [tourDone, setTourDone] = useState(false);
  const [readTourDone, setReadTourDone] = useState(false);
  // The pen tray is cosmetic in the example (marking is off); this just lets the
  // color/style selection respond so the tray feels like the real one.
  const [pen, setPen] = useState<{ tool: Tool; color: MarkColor }>({
    tool: "highlight",
    color: 1,
  });

  // Sort marks within the chapter by verse number (e.g. "John 1:5" -> 5).
  const orderOf = (ref: string) => {
    const n = parseInt(ref.split(":")[1] || "0", 10);
    return Number.isNaN(n) ? 0 : n;
  };

  const selBg = dark ? "rgba(234,231,222,0.20)" : "rgba(29,28,24,0.12)";

  const navBtn = (disabled: boolean) => ({
    width: "44px",
    height: "44px",
    background: "transparent",
    border: "none",
    color: disabled ? C.muted : C.text,
    fontSize: "24px",
    lineHeight: 1,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
    flexShrink: 0,
    fontFamily: "inherit",
  });

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
          onTryIt={onTryIt}
          tryItLabel="Mark John 1 yourself →"
        />
        {!tourDone && (
          <SpotlightTour
            steps={EXAMPLE_TOUR}
            label="How this works"
            colors={{
              panel: C.panel,
              text: C.text,
              border: C.border,
              muted: C.muted,
            }}
            onClose={() => setTourDone(true)}
            onDone={() => setTourDone(true)}
          />
        )}
      </div>
    );
  }

  // The "before" — laid out like the real mobile reader (same header, the same
  // MobileVerse rendering, the same pen tray) so the example feels continuous
  // with the app. Verses stay mounted during "animating" so the gather
  // animation blurs over them.
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
      {/* Header — mirrors the reader: home/close, chapter nav, Compile */}
      <div
        style={{
          flexShrink: 0,
          paddingTop: "calc(env(safe-area-inset-top) + 6px)",
          backgroundColor: C.bg,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            padding: "0 10px",
          }}
        >
          <button
            onClick={onClose}
            aria-label="Close example"
            style={navBtn(false)}
          >
            ×
          </button>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={navBtn(true)}>‹</span>
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: C.text,
                fontSize: "16px",
                fontWeight: 700,
                padding: "0 4px",
              }}
            >
              John 1
            </span>
            <span style={navBtn(true)}>›</span>
          </div>
          <button
            data-tour="ex-compile"
            onClick={() => setStep("animating")}
            aria-label="Compile this study"
            style={{
              flexShrink: 0,
              background: C.text,
              color: C.bg,
              border: "none",
              borderRadius: "999px",
              padding: "8px 16px",
              fontSize: "12.5px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Compile
          </button>
        </div>
        <div
          style={{
            textAlign: "center",
            color: C.muted,
            fontSize: "11px",
            letterSpacing: "0.04em",
            padding: "2px 10px 8px",
            borderBottom: "1px solid " + C.border,
          }}
        >
          Example · nothing here is saved
        </div>
      </div>

      {/* Verses — the exact reader rendering (MobileVerse), read-only */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          padding: "18px 16px 150px",
        }}
      >
        <div
          style={{
            fontFamily: '"Times New Roman", Times, serif',
            fontSize: "19px",
            lineHeight: 1.85,
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          {SAMPLE_VERSES_GET().map((v) => (
            <MobileVerse
              key={v.reference}
              reference={v.reference}
              verseNumber={v.verse}
              text={v.text}
              marks={SAMPLE_JOHN1_MARKS}
              selBg={selBg}
              onTap={() => {}}
              onRange={() => {}}
              onManage={() => {}}
              editMarkId={null}
              editingActive={false}
              onEnterEdit={() => {}}
              onAdjust={() => {}}
              showConditionals={false}
              dark={dark}
            />
          ))}
        </div>
      </div>

      {/* Pen tray — mirrors the reader (colors + styles); cosmetic here */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 5,
          padding: "0 14px calc(14px + env(safe-area-inset-bottom))",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            pointerEvents: "auto",
            backgroundColor: C.panel,
            border: "1px solid " + C.border,
            borderRadius: "16px",
            boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
            overflow: "hidden",
            paddingBottom: "12px",
          }}
        >
          <div style={{ padding: "12px 14px 0", display: "flex", gap: "8px" }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setPen((p) => ({ ...p, color: c }))}
                aria-label={"Color " + c}
                style={{
                  flex: 1,
                  height: "30px",
                  borderRadius: "8px",
                  background:
                    pen.tool === "highlight" ? HIGHLIGHT_MAP[c] : COLOR_MAP[c],
                  border:
                    pen.color === c
                      ? "2px solid " + C.text
                      : "1px solid " + C.border,
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
          <div style={{ padding: "8px 14px 0", display: "flex", gap: "8px" }}>
            {STYLE_LABELS.map((s) => {
              const active = pen.tool === s.tool;
              return (
                <button
                  key={s.tool}
                  onClick={() => setPen((p) => ({ ...p, tool: s.tool }))}
                  aria-label={s.label}
                  title={s.label}
                  style={{
                    flex: 1,
                    height: "30px",
                    borderRadius: "8px",
                    border: "1px solid " + (active ? C.text : C.border),
                    background: active ? C.text : "transparent",
                    color: active ? C.bg : C.text,
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {s.label.charAt(0)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {step === "animating" && (
        <CompileAnimation duration={1400} onDone={() => setStep("compile")} />
      )}

      {!readTourDone && (
        <SpotlightTour
          steps={READING_TOUR}
          label="How this works"
          colors={{
            panel: C.panel,
            text: C.text,
            border: C.border,
            muted: C.muted,
          }}
          onClose={() => setReadTourDone(true)}
          onDone={() => {
            setReadTourDone(true);
            setStep("animating");
          }}
        />
      )}
    </div>
  );
}
