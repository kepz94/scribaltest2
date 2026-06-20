import { useState } from "react";
import { SAMPLE_JOHN1_MARKS } from "../data/sampleStudy";
import { Tab, Tool, MarkColor } from "../types";
import VerseViewer from "./VerseViewer";
import CompileAnimation from "./CompileAnimation";
import Outline from "./Outline";
import Charting from "./Charting";
import Distilled from "./Distilled";
import Covenants from "./Covenants";
import SpotlightTour from "./SpotlightTour";
import { EXAMPLE_TOUR, READING_TOUR } from "../data/exampleTour";

const ACCENT = "#8b5cf6";

interface Props {
  dark: boolean;
  onClose: () => void;
  // Handoff: close the example and open John 1 in the real reader to mark it.
  onTryIt: () => void;
}

// Illustrative theme names a reader might choose for the three colors. In a real
// study these are yours to name; here they show a finished compile (the app
// never assigns meaning on its own).
const EXAMPLE_LABELS: Record<number, string> = {
  1: "The Word",
  2: "Light & Life",
  3: "The Witness",
};

// John = New Testament (volume 1), book index 3, chapter index 0.
const JOHN_TAB: Tab = {
  id: "example-john1",
  volume: 1,
  book: 3,
  chapter: 0,
  bookId: "master",
};

type CView = "outline" | "charting" | "distilled" | "covenants";

export default function DesktopExample({ dark, onClose, onTryIt }: Props) {
  const [step, setStep] = useState<"marks" | "animating" | "compile">("marks");
  const [view, setView] = useState<CView>("outline");
  const [tourDone, setTourDone] = useState(false);
  const [readTourDone, setReadTourDone] = useState(false);
  // The toolbar is real (VerseViewer's), but marking is inert in the example —
  // these just let the tool/color selection and toolbar drag respond locally.
  const [pen, setPen] = useState<{ tool: Tool; color: MarkColor }>({
    tool: "highlight",
    color: 1,
  });
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number }>({
    x: 24,
    y: 160,
  });
  const [toolbarOrient, setToolbarOrient] = useState<
    "vertical" | "horizontal"
  >("vertical");

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
              data-tour="ex-formats"
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
          <span data-tour="ex-tryit">
            {primaryBtn("Mark John 1 yourself →", onTryIt)}
          </span>
        </div>

        {!tourDone && (
          <SpotlightTour
            steps={EXAMPLE_TOUR}
            label="How this works"
            onClose={() => setTourDone(true)}
            onDone={() => setTourDone(true)}
          />
        )}
      </>
    );
  }

  // ---- Marked beat — the real reading surface (VerseViewer: verses + the
  // floating toolbar), read-only. Stays mounted during the animation. ----
  return overlay(
    <>
      <div
        style={{
          flexShrink: 0,
          borderBottom: "1px solid var(--border)",
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
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
            Example · John 1 · nothing here is saved
          </div>
        </div>
        <button
          data-tour="ex-compile"
          onClick={() => setStep("animating")}
          aria-label="Compile this study"
          style={{
            background: "var(--text)",
            color: "var(--bg)",
            border: "none",
            borderRadius: "999px",
            padding: "10px 20px",
            fontSize: "13.5px",
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          Compile
        </button>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          position: "relative",
        }}
      >
        <div style={{ maxWidth: "820px", margin: "0 auto", padding: "24px 20px" }}>
          <VerseViewer
            selectedVolume={1}
            selectedBook={3}
            selectedChapter={0}
            onChange={() => {}}
            selectedTool={pen.tool}
            selectedColor={pen.color}
            onChangeTool={(t) => setPen((p) => ({ ...p, tool: t }))}
            onChangeColor={(c) => setPen((p) => ({ ...p, color: c }))}
            onMark={() => {}}
            onEraseMark={() => {}}
            onMarkMany={() => {}}
            marks={SAMPLE_JOHN1_MARKS}
            showToolbar
            toolbarPos={toolbarPos}
            onToolbarPos={setToolbarPos}
            toolbarOrient={toolbarOrient}
            onToolbarOrient={setToolbarOrient}
            panelMode={false}
            fontScale={1}
            lineScale={1.85}
            warm={false}
            dark={dark}
            sidebarOpen={false}
            jumpTarget={null}
            onJumpHandled={() => {}}
          />
        </div>
      </div>

      {step === "animating" && (
        <CompileAnimation duration={1400} onDone={() => setStep("compile")} />
      )}

      {!readTourDone && (
        <SpotlightTour
          steps={READING_TOUR}
          label="How this works"
          onClose={() => setReadTourDone(true)}
          onDone={() => {
            setReadTourDone(true);
            setStep("animating");
          }}
        />
      )}
    </>
  );
}
