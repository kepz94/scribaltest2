import { useState, CSSProperties } from "react";

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
  onClose: () => void;
}

const SERIF = '"Times New Roman", Times, serif';
const PURP = "#8b5cf6"; // combined
const RED = "#ef4444"; // chapter
const BLUE = "#3b82f6"; // keyword
const TEAL = "#4ca5a0"; // screens
const GOLD = "#e0a32e"; // dictionary
const GREEN = "#3a9d4e"; // vault
const HL = "rgba(139,92,246,0.30)";

const SECTION_ORDER = ["Search & combine", "While you read", "Your library"];

const KEYFRAMES = `
@keyframes sfg-pulse {0%,100%{opacity:.45;transform:scale(.9)}50%{opacity:1;transform:scale(1.1)}}
@keyframes sfg-jump {0%,100%{transform:translateX(-30px)}50%{transform:translateX(30px)}}
@keyframes sfg-pop {0%{opacity:0;transform:scale(.3)}60%{transform:scale(1.2)}100%{opacity:1;transform:scale(1)}}
@keyframes sfg-rise {0%{opacity:0;transform:translateY(10px) scale(.96)}100%{opacity:1;transform:translateY(0) scale(1)}}
@keyframes sfg-slide {0%{opacity:0;transform:translateX(18px)}100%{opacity:1;transform:translateX(0)}}
@keyframes sfg-caret {0%,100%{opacity:0}50%{opacity:1}}
@keyframes sfg-glow {0%,100%{opacity:.4}50%{opacity:1}}
@keyframes sfg-switch {0%,100%{transform:translateX(0)}33%{transform:translateX(64px)}66%{transform:translateX(128px)}}
`;

export default function MobileFeatureGuide({ C, onClose }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const box: CSSProperties = {
    position: "relative",
    height: "150px",
    borderRadius: "14px",
    border: "1px solid " + C.border,
    background: C.panel,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: "18px",
  };

  const stroke = (color: string, size = 18, sw = 2) => ({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: sw,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  });

  // ---- icons ----
  const chainIcon = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  );
  const combinedIcon = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <circle cx="8.5" cy="12" r="5.5" />
      <circle cx="15.5" cy="12" r="5.5" />
    </svg>
  );
  const screensIcon = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <rect x="3" y="7" width="13" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
    </svg>
  );
  const searchIcon = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
  const bookIcon = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
  const layersIcon = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <path d="M12 3 3 8l9 5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </svg>
  );
  const vaultIcon = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );

  // ---- building blocks ----
  const chapCard = (label: string) => (
    <div
      style={{
        border: "1px solid " + C.border,
        borderTop: "3px solid " + RED,
        borderRadius: "9px",
        background: C.soft,
        padding: "12px 14px",
        fontFamily: SERIF,
        fontSize: "13px",
        fontWeight: 700,
        color: C.text,
      }}
    >
      {label}
    </div>
  );

  const kwCard = (label: string) => (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        border: "1px solid " + C.border,
        borderTop: "3px solid " + BLUE,
        borderRadius: "9px",
        background: C.soft,
        padding: "12px 14px",
        fontSize: "13px",
        fontWeight: 700,
        color: C.text,
      }}
    >
      {searchIcon(BLUE, 13)}
      <span style={{ fontFamily: SERIF }}>{label}</span>
    </div>
  );

  const listRow = (label: string, color: string, delay: number) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "9px",
        padding: "9px 11px",
        borderRadius: "9px",
        border: "1px solid " + C.border,
        background: C.soft,
        animation: "sfg-slide .5s ease both",
        animationDelay: delay + "s",
      }}
    >
      <span style={{ display: "inline-flex", flexShrink: 0 }}>{chainIcon(color, 15)}</span>
      <span style={{ fontSize: "12.5px", fontWeight: 600, color: C.text }}>{label}</span>
      <span style={{ marginLeft: "auto", color: C.muted, fontSize: "15px" }}>›</span>
    </div>
  );

  const bookSpine = (label: string, color: string, permanent: boolean) => (
    <div
      style={{
        width: "44px",
        height: "62px",
        borderRadius: "6px",
        border: "1px solid " + C.border,
        borderLeft: "4px solid " + color,
        background: C.soft,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: "0 0 6px",
        fontSize: "9.5px",
        fontWeight: 700,
        color: C.text,
      }}
    >
      {label}
      {permanent && <span style={{ marginLeft: "2px", color }}>★</span>}
    </div>
  );

  const tabPill = (label: string, active: boolean) => (
    <div
      style={{
        flex: 1,
        padding: "7px 4px",
        borderRadius: "8px",
        border: "1px solid " + (active ? TEAL : C.border),
        background: active ? C.soft : "transparent",
        fontSize: "10.5px",
        fontWeight: 700,
        color: active ? C.text : C.muted,
        textAlign: "center",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {label}
    </div>
  );

  const skel = (w: string) => (
    <span style={{ display: "block", height: "6px", width: w, borderRadius: "3px", background: C.border, marginBottom: "7px" }} />
  );

  // ---- illustrations ----
  const searchIllo = (
    <div style={box}>
      <div style={{ width: "184px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "7px",
            padding: "8px 10px",
            borderRadius: "9px",
            border: "1px solid " + C.border,
            background: C.soft,
          }}
        >
          {searchIcon(C.muted, 14)}
          <span style={{ fontFamily: SERIF, fontSize: "13px", color: C.text }}>faith</span>
          <span style={{ width: "2px", height: "14px", background: C.text, animation: "sfg-caret 1.1s step-end infinite" }} />
        </div>
        <div
          style={{
            padding: "8px 10px",
            borderRadius: "8px",
            border: "1px solid " + C.border,
            background: C.soft,
            fontSize: "11px",
            color: C.muted,
            animation: "sfg-glow 2.2s ease-in-out infinite",
          }}
        >
          Alma 32 · scripture
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 10px",
            borderRadius: "8px",
            border: "1px solid " + C.border,
            background: C.soft,
            animation: "sfg-glow 2.2s ease-in-out infinite",
            animationDelay: ".4s",
          }}
        >
          <span style={{ fontSize: "9px", fontWeight: 700, color: "#fff", background: PURP, borderRadius: "5px", padding: "1px 5px" }}>
            YOUR MARK
          </span>
          <span style={{ fontSize: "11px", color: C.muted }}>Moroni 7:26</span>
        </div>
      </div>
    </div>
  );

  const linkIllo = (
    <div style={box}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "46px" }}>
        {chapCard("1 Ne 1")}
        {chapCard("1 Ne 2")}
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            marginLeft: "-11px",
            marginTop: "-11px",
            display: "inline-flex",
            animation: "sfg-pulse 1.8s ease-in-out infinite",
          }}
        >
          {chainIcon(RED, 22)}
        </span>
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: "-4px",
            marginLeft: "-5px",
            width: "10px",
            height: "10px",
            borderRadius: "50%",
            background: RED,
            animation: "sfg-jump 2.4s ease-in-out infinite",
          }}
        />
      </div>
    </div>
  );

  const combinedIllo = (
    <div style={box}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          {chapCard("1 Ne 1")}
          <span style={{ display: "inline-flex", animation: "sfg-pulse 1.8s ease-in-out infinite" }}>
            {chainIcon(PURP, 20)}
          </span>
          {kwCard("Faith")}
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            border: "1px solid " + C.border,
            borderLeft: "3px solid " + PURP,
            borderRadius: "9px",
            background: C.soft,
            padding: "7px 12px",
            fontSize: "11.5px",
            fontWeight: 700,
            color: PURP,
            animation: "sfg-rise .6s ease both",
            animationDelay: ".5s",
          }}
        >
          {combinedIcon(PURP, 14)} Combined study
        </div>
      </div>
    </div>
  );

  const screensIllo = (
    <div style={box}>
      <div style={{ width: "204px" }}>
        <div style={{ position: "relative", display: "flex", gap: "5px", marginBottom: "9px" }}>
          {tabPill("1 Ne 1", true)}
          {tabPill("Alma 32", false)}
          {tabPill("Faith", false)}
          <span
            style={{
              position: "absolute",
              left: "0",
              bottom: "-4px",
              width: "60px",
              height: "3px",
              borderRadius: "2px",
              background: TEAL,
              animation: "sfg-switch 4s ease-in-out infinite",
            }}
          />
        </div>
        <div style={{ border: "1px solid " + C.border, borderRadius: "9px", background: C.soft, padding: "12px 13px" }}>
          {skel("100%")}
          {skel("86%")}
          {skel("64%")}
        </div>
      </div>
    </div>
  );

  const dictIllo = (
    <div style={box}>
      <div style={{ width: "212px" }}>
        <div style={{ fontFamily: SERIF, fontSize: "14px", color: C.text, marginBottom: "11px" }}>
          made whole by thy{" "}
          <span style={{ background: HL, borderRadius: "3px", padding: "0 3px", borderBottom: "2px dotted " + GOLD }}>
            faith
          </span>
        </div>
        <div
          style={{
            border: "1px solid " + C.border,
            borderLeft: "3px solid " + GOLD,
            borderRadius: "10px",
            background: C.soft,
            padding: "10px 12px",
            animation: "sfg-rise .6s ease both",
            animationDelay: ".3s",
          }}
        >
          <span style={{ fontSize: "9px", fontWeight: 700, color: GOLD, letterSpacing: "0.06em" }}>WEBSTER 1828</span>
          <div style={{ fontFamily: SERIF, fontSize: "12.5px", lineHeight: 1.4, color: C.text, marginTop: "4px" }}>
            <strong>FAITH</strong>, n. Belief; the assent of the mind to the truth of what is declared by another.
          </div>
        </div>
      </div>
    </div>
  );

  const findIllo = (
    <div style={box}>
      <div style={{ width: "172px", display: "flex", flexDirection: "column", gap: "8px" }}>
        {listRow("Faith", PURP, 0)}
        {listRow("Covenants", TEAL, 0.15)}
        {listRow("Alma 32 + 34", PURP, 0.3)}
      </div>
    </div>
  );

  const booksIllo = (
    <div style={box}>
      <div
        style={{
          position: "relative",
          display: "flex",
          gap: "12px",
          alignItems: "flex-end",
          padding: "16px 20px 14px",
          borderRadius: "12px",
          border: "1px dashed " + C.border,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "-11px",
            right: "-9px",
            display: "inline-flex",
            animation: "sfg-glow 2.4s ease-in-out infinite",
          }}
        >
          {vaultIcon(GREEN, 20)}
        </span>
        {bookSpine("Master", PURP, true)}
        {bookSpine("Session", C.muted, false)}
      </div>
    </div>
  );

  // ---- the guide content ----
  const FEATURES: {
    id: string;
    section: string;
    title: string;
    sub: string;
    icon: JSX.Element;
    pages: { illo: JSX.Element; heading: string; lines: string[] }[];
  }[] = [
    {
      id: "search",
      section: "Search & combine",
      title: "Keyword search",
      sub: "Search scripture & your marks",
      icon: searchIcon(BLUE, 20),
      pages: [
        {
          illo: searchIllo,
          heading: "Search two ways",
          lines: [
            "Scribal searches the scripture text and your own marks. Toggle between “Scripture” and “My marks” at the top, and choose how words combine — every word, any word, or the exact phrase.",
            "Use * as a wildcard: baptiz* finds baptize, baptism, and baptized in one search.",
          ],
        },
        {
          illo: searchIllo,
          heading: "From results to a study",
          lines: [
            "Searching Scripture, you can pick the verses you want from the results and link them into a keyword study — marked and compiled together, like a chapter.",
            "Searching “My marks” is the fast way back to something you highlighted weeks ago.",
          ],
        },
      ],
    },
    {
      id: "linking",
      section: "Search & combine",
      title: "Link chapters",
      sub: "Join chapters & study them as one",
      icon: chainIcon(RED, 20),
      pages: [
        {
          illo: linkIllo,
          heading: "Link two chapters",
          lines: [
            "Some chapters belong together — a prophecy and its fulfillment, a teaching echoed in another book. Linking joins them into one study.",
            "Open a chapter, tap the Link button in the top bar, then “Link with next” or pick any chapter from the list.",
          ],
        },
        {
          illo: linkIllo,
          heading: "They compile as one",
          lines: [
            "Compile a linked chapter and the marks from every chapter in the group gather together — a single outline across all of them.",
            "Tap the Link button again to jump between linked chapters, or unlink any of them.",
          ],
        },
      ],
    },
    {
      id: "combined",
      section: "Search & combine",
      title: "Combined studies",
      sub: "A chapter + a keyword study, joined",
      icon: combinedIcon(PURP, 20),
      pages: [
        {
          illo: combinedIllo,
          heading: "Chapter + keyword, joined",
          lines: [
            "A chapter study (red) and a keyword study (blue) can be linked into one combined study (purple) — so a chapter and the verses you've gathered on its theme sit and compile side by side.",
          ],
        },
        {
          illo: combinedIllo,
          heading: "From either side",
          lines: [
            "From a chapter, add a keyword search into it. Or from a keyword study, link a chapter in. Either way you land on the same combined study.",
            "Mark and compile it as one — the chapter's marks and the gathered verses, together.",
          ],
        },
      ],
    },
    {
      id: "screens",
      section: "While you read",
      title: "Screens",
      sub: "Several chapters or studies, at once",
      icon: screensIcon(TEAL, 20),
      pages: [
        {
          illo: screensIllo,
          heading: "Keep your place in several texts",
          lines: [
            "A Screen is an open chapter or study. Keep several going at once — the chapter you're reading, a study you're building, a passage you're comparing — and switch between them with a tap.",
          ],
        },
        {
          illo: screensIllo,
          heading: "Open and close",
          lines: [
            "Tap the Screens button to see them all, open a new one, or jump between them.",
            "You can hold up to eight at a time; close one to make room for another.",
          ],
        },
      ],
    },
    {
      id: "dictionary",
      section: "While you read",
      title: "The dictionary",
      sub: "Webster's 1828, and tagging words",
      icon: bookIcon(GOLD, 20),
      pages: [
        {
          illo: dictIllo,
          heading: "A word's 1828 meaning",
          lines: [
            "Arm the dictionary, then tap any word to see how it was defined in Webster's 1828 — often closer to what the text meant than today's usage.",
          ],
        },
        {
          illo: dictIllo,
          heading: "Tag a word to keep it",
          lines: [
            "Tap “Tag this word” in the definition to bookmark it; a small marker appears by the word so you can reopen the meaning any time.",
            "Close the card by tapping the dimmed area above it.",
          ],
        },
      ],
    },
    {
      id: "studies",
      section: "Your library",
      title: "Studies",
      sub: "Where every study is filed",
      icon: layersIcon(C.text, 20),
      pages: [
        {
          illo: findIllo,
          heading: "All your studies in one place",
          lines: [
            "Tap “Studies” on the home screen. Everything you've compiled lives here in three groups: Chapter studies, Combined studies, and Keyword studies.",
          ],
        },
        {
          illo: findIllo,
          heading: "Open or peek",
          lines: [
            "Tap a study to jump straight to its compiled notes, or tap the ⓘ to peek at what it covers and its themes without leaving the list.",
          ],
        },
      ],
    },
    {
      id: "books",
      section: "Your library",
      title: "Master & Sessions",
      sub: "Your books, kept in the Vault",
      icon: vaultIcon(GREEN, 20),
      pages: [
        {
          illo: booksIllo,
          heading: "Master & session books",
          lines: [
            "Your Master book holds your main, ongoing study. Open a session book any time you want a separate layer — a class, a topic, a fresh pass — without touching the Master.",
          ],
        },
        {
          illo: booksIllo,
          heading: "Kept in the Vault",
          lines: [
            "Every book lives in the Vault. Open it from home to switch books or peek at the studies inside each one.",
            "The Master is permanent; session books can be deleted when you're done with them.",
          ],
        },
      ],
    },
  ];

  const active = FEATURES.find((f) => f.id === open) || null;

  // ---- list view ----
  if (!active) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 4000,
          background: C.bg,
          color: C.text,
          display: "flex",
          flexDirection: "column",
          fontFamily: "system-ui, -apple-system, sans-serif",
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "12px 14px",
            borderBottom: "1px solid " + C.border,
          }}
        >
          <div style={{ flex: 1, fontSize: "19px", fontWeight: 800 }}>Advanced tutorial</div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: "40px",
              height: "40px",
              background: "transparent",
              border: "none",
              color: C.text,
              fontSize: "24px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 28px" }}>
          <div style={{ fontSize: "13.5px", color: C.muted, lineHeight: 1.5, marginBottom: "18px" }}>
            Pick a feature to learn it in depth, with a quick animated walkthrough.
          </div>
          {SECTION_ORDER.map((secName) => (
            <div key={secName}>
              <div
                style={{
                  fontSize: "11px",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: C.muted,
                  fontWeight: 700,
                  margin: "6px 2px 11px",
                }}
              >
                {secName}
              </div>
              {FEATURES.filter((f) => f.section === secName).map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setOpen(f.id);
                    setPage(0);
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: "13px",
                    textAlign: "left",
                    background: C.panel,
                    border: "1px solid " + C.border,
                    borderRadius: "14px",
                    padding: "15px 14px",
                    marginBottom: "11px",
                    color: C.text,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <span
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "11px",
                      background: C.soft,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {f.icon}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: "15px", fontWeight: 700 }}>{f.title}</span>
                    <span style={{ fontSize: "12.5px", color: C.muted }}>{f.sub}</span>
                  </span>
                  <span style={{ color: C.muted, fontSize: "18px" }}>›</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---- walkthrough view ----
  const last = active.pages.length - 1;
  const pg = active.pages[Math.min(page, last)];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 4000,
        background: C.bg,
        color: C.text,
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, -apple-system, sans-serif",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <style>{KEYFRAMES}</style>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "10px 12px",
          borderBottom: "1px solid " + C.border,
        }}
      >
        <button
          onClick={() => setOpen(null)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "3px",
            background: "transparent",
            border: "none",
            color: C.muted,
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            padding: "6px 4px",
          }}
        >
          ‹ All features
        </button>
        <span style={{ flex: 1 }} />
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            width: "36px",
            height: "36px",
            background: "transparent",
            border: "none",
            color: C.text,
            fontSize: "22px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 24px" }}>
        <div style={{ fontSize: "12px", fontWeight: 700, color: PURP, marginBottom: "4px" }}>
          {active.title.toUpperCase()}
        </div>
        <div style={{ fontSize: "21px", fontWeight: 800, marginBottom: "16px" }}>{pg.heading}</div>
        {pg.illo}
        {pg.lines.map((t, i) => (
          <div key={i} style={{ fontSize: "14.5px", color: C.text, lineHeight: 1.6, marginBottom: "14px" }}>
            {t}
          </div>
        ))}
      </div>

      <div style={{ padding: "10px 20px calc(14px + env(safe-area-inset-bottom))" }}>
        <div style={{ display: "flex", justifyContent: "center", gap: "6px", marginBottom: "12px" }}>
          {active.pages.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === Math.min(page, last) ? "20px" : "7px",
                height: "7px",
                borderRadius: "4px",
                background: i === Math.min(page, last) ? PURP : C.border,
                transition: "width .2s",
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          {page > 0 && (
            <button
              onClick={() => setPage(page - 1)}
              style={{
                flex: 1,
                padding: "14px",
                borderRadius: "12px",
                border: "1px solid " + C.border,
                background: "transparent",
                color: C.text,
                fontSize: "15px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Back
            </button>
          )}
          {page < last ? (
            <button
              onClick={() => setPage(page + 1)}
              style={{
                flex: 2,
                padding: "14px",
                borderRadius: "12px",
                border: "none",
                background: C.text,
                color: C.bg,
                fontSize: "15px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Next
            </button>
          ) : (
            <button
              onClick={() => setOpen(null)}
              style={{
                flex: 2,
                padding: "14px",
                borderRadius: "12px",
                border: "none",
                background: C.text,
                color: C.bg,
                fontSize: "15px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
