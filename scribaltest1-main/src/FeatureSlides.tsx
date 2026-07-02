import { useState } from "react";
import { COLOR_MAP } from "./types";

/**
 * "How Scribal works" — a swipeable slide deck off the main menu.
 *
 * Each slide SHOWS the real UI as a faithful mock (same shapes, colors, and
 * text the live screens use) with two or three lines of plain words. No
 * detection, no overlays fighting real sheets — a calm reference the user can
 * open any time. Covers the core loop, then the power features: link colors,
 * the Link sheet + jump, keyword studies, combined studies, and Screens.
 */

interface Palette {
  bg: string;
  panel: string;
  soft: string;
  text: string;
  muted: string;
  border: string;
}

const RED = "#ef4444";
const BLUE = "#3b82f6";
const PURPLE = "#8b5cf6";

const Chain = ({ color, size = 15 }: { color: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 13a5 5 0 0 0 7.07 0l2-2a5 5 0 0 0-7.07-7.07l-1 1" />
    <path d="M14 11a5 5 0 0 0-7.07 0l-2 2a5 5 0 0 0 7.07 7.07l1-1" />
  </svg>
);

export default function FeatureSlides({
  C,
  onClose,
}: {
  C: Palette;
  onClose: () => void;
}) {
  const [i, setI] = useState(0);
  const [touchX, setTouchX] = useState<number | null>(null);

  const serif = '"Times New Roman", Times, serif';

  // ── shared mock pieces ────────────────────────────────────────────────────
  const linkPill = (color: string, label: string) => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        border: "1px solid " + C.border,
        borderRadius: "999px",
        padding: "5px 12px",
        background: C.panel,
      }}
    >
      <Chain color={color} />
      <span style={{ fontSize: "12px", fontWeight: 700, color }}>{label}</span>
    </span>
  );

  const mockCard = (children: React.ReactNode) => (
    <div
      style={{
        border: "1px solid " + C.border,
        borderRadius: "14px",
        background: C.panel,
        padding: "14px",
        width: "100%",
        maxWidth: "340px",
        margin: "0 auto",
        boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
      }}
    >
      {children}
    </div>
  );

  const dotRow = (color: string, label: string, sub?: string) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 4px",
        borderBottom: "1px solid " + C.border,
      }}
    >
      <span
        style={{
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, fontSize: "14px", fontWeight: 600, color: C.text }}>
        {label}
      </span>
      {sub && <span style={{ fontSize: "12px", color: C.muted }}>{sub}</span>}
      <span style={{ color: C.muted, fontSize: "14px" }}>›</span>
    </div>
  );

  // ── the slides ────────────────────────────────────────────────────────────
  const slides: { title: string; body: string; visual: React.ReactNode }[] = [
    {
      title: "Your finger is the pen",
      body: "Swipe straight across words to mark them — no press-and-hold, no menus. Five tools, ten colors, letter-level precision.",
      visual: mockCard(
        <div style={{ fontFamily: serif, fontSize: "16px", lineHeight: 1.8, color: C.text }}>
          <span style={{ color: C.muted, fontSize: "12px", marginRight: "6px" }}>7</span>
          And it came to pass that{" "}
          <span style={{ background: COLOR_MAP[2], padding: "0 2px", borderRadius: "2px" }}>
            I will go and do
          </span>{" "}
          the things which{" "}
          <span
            style={{
              textDecoration: "underline",
              textDecorationColor: COLOR_MAP[5],
              textDecorationThickness: "2.5px",
            }}
          >
            the Lord hath commanded
          </span>
          …
        </div>
      ),
    },
    {
      title: "Each color is a theme — you name it",
      body: "In your compiled study, every color becomes a group. Tap the dashed title and call it what YOU see. Scribal never names a theme for you.",
      visual: mockCard(
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
            <span style={{ width: "15px", height: "15px", borderRadius: "50%", background: COLOR_MAP[2] }} />
            <span style={{ fontSize: "16px", fontWeight: 700, color: C.text }}>Faith</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ width: "15px", height: "15px", borderRadius: "50%", background: COLOR_MAP[5] }} />
            <span
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: C.muted,
                borderBottom: "1px dashed " + C.border,
                paddingBottom: "2px",
              }}
            >
              Name this theme…
            </span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
            </svg>
          </div>
        </div>
      ),
    },
    {
      title: "Compile — marking becomes notes",
      body: "One tap gathers every mark into a study: your themes as headings, your verses beneath, your emphasis kept. Verse cards flip for per-verse notes; the dotted + holds each theme's conclusion.",
      visual: mockCard(
        <div>
          <div
            style={{
              display: "inline-block",
              border: "none",
              borderRadius: "999px",
              background: C.text,
              color: C.bg,
              fontSize: "13px",
              fontWeight: 700,
              padding: "9px 20px",
              marginBottom: "12px",
            }}
          >
            Compile
          </div>
          <div style={{ borderTop: "1px solid " + C.border, paddingTop: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ width: "11px", height: "11px", borderRadius: "50%", background: COLOR_MAP[2] }} />
              <span style={{ fontSize: "14px", fontWeight: 700, color: C.text }}>Faith</span>
            </div>
            <div style={{ fontSize: "12px", color: C.muted, paddingLeft: "19px" }}>
              1 Nephi 1:7 · 1 Nephi 1:20 · + your conclusion
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "The chain speaks in color",
      body: "The Link pill in the reading header tells you what a chapter belongs to at a glance.",
      visual: (
        <div style={{ display: "grid", gap: "12px", justifyItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {linkPill(RED, "Linked")}
            <span style={{ fontSize: "13px", color: C.muted }}>chapter study</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {linkPill(BLUE, "Linked")}
            <span style={{ fontSize: "13px", color: C.muted }}>keyword study</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {linkPill(PURPLE, "Linked")}
            <span style={{ fontSize: "13px", color: C.muted }}>combined — both</span>
          </div>
        </div>
      ),
    },
    {
      title: "Link chapters — study them as ONE",
      body: "Tap Link and pick chapters: they compile together, themes carrying across. The sheet lists every member with the group's colored dot — tap a chapter there to JUMP straight to it.",
      visual: mockCard(
        <div>
          <div style={{ fontSize: "12px", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "6px" }}>
            Linked chapters
          </div>
          {dotRow(PURPLE, "1 Nephi 1", "you are here")}
          {dotRow(PURPLE, "1 Nephi 2", "tap to jump")}
          <div style={{ ...{ padding: "10px 4px" }, fontSize: "13px", color: C.muted }}>
            + Link another chapter…
          </div>
        </div>
      ),
    },
    {
      title: "Keyword studies — built from a word",
      body: "From the magnifier, search any word across all scripture, gather the verses you choose, and save. A study with no chapter — it carries blue.",
      visual: mockCard(
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              border: "1px solid " + C.border,
              borderRadius: "10px",
              background: C.soft,
              padding: "8px 12px",
              marginBottom: "10px",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <span style={{ fontSize: "14px", color: C.text }}>faith</span>
          </div>
          <div style={{ fontSize: "12.5px", color: C.muted, marginBottom: "10px" }}>
            Alma 32:21 · Ether 12:6 · Hebrews 11:1 …
          </div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              borderRadius: "999px",
              border: "1px solid " + BLUE,
              color: BLUE,
              fontSize: "12.5px",
              fontWeight: 700,
              padding: "6px 14px",
            }}
          >
            <Chain color={BLUE} size={12} /> Save as study
          </span>
        </div>
      ),
    },
    {
      title: "Combined — when red meets blue",
      body: "Link a keyword study into a chapter study and they merge: chapter verses plus gathered verses, one set of themes. The chain turns purple.",
      visual: (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px" }}>
          <Chain color={RED} size={26} />
          <span style={{ fontSize: "18px", color: C.muted }}>+</span>
          <Chain color={BLUE} size={26} />
          <span style={{ fontSize: "18px", color: C.muted }}>→</span>
          <span
            style={{
              display: "inline-flex",
              padding: "10px",
              borderRadius: "50%",
              background: "rgba(139,92,246,0.12)",
            }}
          >
            <Chain color={PURPLE} size={30} />
          </span>
        </div>
      ),
    },
    {
      title: "The dictionary lives under your finger",
      body: "Tap any single word while reading to look it up — 1828 Webster's, the language of the text. Tag a definition and the word stays quietly marked wherever it appears in your study.",
      visual: mockCard(
        <div>
          <div style={{ fontFamily: serif, fontSize: "16px", lineHeight: 1.8, color: C.text, marginBottom: "10px" }}>
            …to be learned is good if they{" "}
            <span style={{ borderBottom: "2px dotted " + PURPLE, fontWeight: 600 }}>hearken</span>{" "}
            unto the counsels of God.
          </div>
          <div style={{ borderTop: "1px solid " + C.border, paddingTop: "10px" }}>
            <div style={{ fontSize: "14px", fontWeight: 800, color: C.text }}>HEARKEN</div>
            <div style={{ fontSize: "12.5px", color: C.muted, lineHeight: 1.5 }}>
              v.i. — To listen; to lend the ear; to attend to what is uttered…
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "Master & Sessions — books of marks",
      body: "Your Master Book is the life copy — marks that stay. A Session is a fresh, clean copy for a class, a talk, or an experiment. Every study belongs to the book it was marked in.",
      visual: mockCard(
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 4px", borderBottom: "1px solid " + C.border }}>
            <span style={{ fontSize: "14px", fontWeight: 700, color: C.text, flex: 1 }}>Master Book</span>
            <span style={{ fontSize: "11.5px", color: C.muted }}>1,204 marks</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 4px", borderBottom: "1px solid " + C.border }}>
            <span style={{ fontSize: "14px", fontWeight: 600, color: C.text, flex: 1 }}>Sunday lesson</span>
            <span style={{ fontSize: "11.5px", color: C.muted }}>36 marks</span>
          </div>
          <div style={{ padding: "9px 4px", fontSize: "13px", color: C.muted }}>
            + New session…
          </div>
        </div>
      ),
    },
    {
      title: "Screens — up to 8 places at once",
      body: "The tab row above the chapter title holds your open Screens. Each keeps its own book, chapter, and scroll — study in one, cross-reference in another. Tap + for a fresh one.",
      visual: mockCard(
        <div style={{ display: "flex", gap: "7px", flexWrap: "wrap" }}>
          <span style={{ borderRadius: "999px", background: C.text, color: C.bg, fontSize: "12.5px", fontWeight: 700, padding: "6px 13px" }}>
            1 Nephi 1
          </span>
          <span style={{ borderRadius: "999px", border: "1px solid " + C.border, color: C.muted, fontSize: "12.5px", fontWeight: 600, padding: "6px 13px" }}>
            Alma 32
          </span>
          <span style={{ borderRadius: "999px", border: "1px solid " + C.border, color: C.muted, fontSize: "12.5px", fontWeight: 600, padding: "6px 13px" }}>
            John 1
          </span>
          <span style={{ borderRadius: "999px", border: "1.5px dashed " + C.border, color: C.muted, fontSize: "12.5px", fontWeight: 700, padding: "6px 12px" }}>
            +
          </span>
        </div>
      ),
    },
  ];

  const last = slides.length - 1;
  const sl = slides[i];

  return (
    <div
      onTouchStart={(e) => setTouchX(e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        if (touchX == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
        if (dx < -48 && i < last) setI(i + 1);
        else if (dx > 48 && i > 0) setI(i - 1);
        setTouchX(null);
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 480,
        background: C.bg,
        color: C.text,
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding:
          "calc(14px + env(safe-area-inset-top)) 20px calc(18px + env(safe-area-inset-bottom))",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: C.muted }}>
          How Scribal works
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ background: "transparent", border: "none", color: C.muted, fontSize: "17px", cursor: "pointer", padding: "8px", fontFamily: "inherit" }}
        >
          ✕
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "26px", minHeight: 0 }}>
        <div>{sl.visual}</div>
        <div style={{ textAlign: "center", maxWidth: "360px", margin: "0 auto" }}>
          <div style={{ fontSize: "20px", fontWeight: 800, marginBottom: "8px" }}>{sl.title}</div>
          <div style={{ fontSize: "14px", lineHeight: 1.6, color: C.muted }}>{sl.body}</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <button
          onClick={() => setI(Math.max(0, i - 1))}
          disabled={i === 0}
          style={{ border: "1px solid " + C.border, background: "transparent", color: i === 0 ? C.border : C.muted, borderRadius: "999px", padding: "11px 18px", fontSize: "13.5px", fontWeight: 700, cursor: i === 0 ? "default" : "pointer", fontFamily: "inherit" }}
        >
          Back
        </button>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", gap: "5px" }}>
          {slides.map((_, k) => (
            <span
              key={k}
              style={{
                width: k === i ? "16px" : "6px",
                height: "6px",
                borderRadius: "999px",
                background: k === i ? PURPLE : C.border,
                transition: "width .2s",
              }}
            />
          ))}
        </div>
        <button
          onClick={() => (i === last ? onClose() : setI(i + 1))}
          style={{ border: "none", background: C.text, color: C.bg, borderRadius: "999px", padding: "11px 20px", fontSize: "13.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
        >
          {i === last ? "Done" : "Next"}
        </button>
      </div>
    </div>
  );
}
