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
const PURP = "#8b5cf6";
const TEAL = "#0d9488";
const HL = "rgba(139,92,246,0.30)";

const KEYFRAMES = `
@keyframes sfg-pulse {0%,100%{opacity:.45;transform:scale(.9)}50%{opacity:1;transform:scale(1.1)}}
@keyframes sfg-jump {0%,100%{transform:translateX(-30px)}50%{transform:translateX(30px)}}
@keyframes sfg-pop {0%{opacity:0;transform:scale(.3)}60%{transform:scale(1.2)}100%{opacity:1;transform:scale(1)}}
@keyframes sfg-rise {0%{opacity:0;transform:translateY(10px) scale(.96)}100%{opacity:1;transform:translateY(0) scale(1)}}
@keyframes sfg-flip {0%,40%{transform:rotateY(0)}60%,100%{transform:rotateY(180deg)}}
@keyframes sfg-slide {0%{opacity:0;transform:translateX(18px)}100%{opacity:1;transform:translateX(0)}}
@keyframes sfg-caret {0%,100%{opacity:0}50%{opacity:1}}
@keyframes sfg-glow {0%,100%{opacity:.35}50%{opacity:1}}
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
  const layersIcon = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <path d="M12 3 3 8l9 5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </svg>
  );
  const sparkIcon = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8z" />
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

  // ---- small building blocks for the demos ----
  const chapCard = (label: string) => (
    <div
      style={{
        border: "1px solid " + C.border,
        borderTop: "3px solid " + PURP,
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

  const tick = (color: string) => (
    <span
      style={{
        width: "16px",
        height: "16px",
        borderRadius: "5px",
        background: color,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg {...stroke("#fff", 11, 2.4)}>
        <path d="M4 12l5 5L20 6" />
      </svg>
    </span>
  );

  const resultRow = (checked: boolean, delay: number) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "7px",
        width: "120px",
        padding: "6px 8px",
        borderRadius: "8px",
        border: "1px solid " + C.border,
        background: C.soft,
      }}
    >
      {checked ? (
        <span style={{ animation: `sfg-pop .5s ease both`, animationDelay: delay + "s" }}>
          {tick(TEAL)}
        </span>
      ) : (
        <span
          style={{
            width: "16px",
            height: "16px",
            borderRadius: "5px",
            border: "1.5px solid " + C.muted,
            flexShrink: 0,
          }}
        />
      )}
      <span
        style={{
          flex: 1,
          height: "6px",
          borderRadius: "3px",
          background: C.border,
        }}
      />
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
      <span style={{ display: "inline-flex", flexShrink: 0 }}>
        {chainIcon(color, 15)}
      </span>
      <span style={{ fontSize: "12.5px", fontWeight: 600, color: C.text }}>
        {label}
      </span>
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

  // ---- one illustration per feature ----
  const linkIllo = (
    <div style={box}>
      <div
        style={{ position: "relative", display: "flex", alignItems: "center", gap: "46px" }}
      >
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
          {chainIcon(PURP, 22)}
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
            background: PURP,
            animation: "sfg-jump 2.4s ease-in-out infinite",
          }}
        />
      </div>
    </div>
  );

  const linkStudyIllo = (
    <div style={box}>
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {resultRow(true, 0)}
          {resultRow(false, 0)}
          {resultRow(true, 0.35)}
        </div>
        <span style={{ display: "inline-flex", animation: "sfg-pulse 1.8s ease-in-out infinite" }}>
          {chainIcon(TEAL, 20)}
        </span>
        <div
          style={{
            borderRadius: "10px",
            border: "1px solid " + C.border,
            borderLeft: "3px solid " + TEAL,
            background: C.soft,
            padding: "12px 14px",
            fontSize: "12px",
            fontWeight: 700,
            color: C.text,
            animation: "sfg-rise .6s ease both",
            animationDelay: ".55s",
          }}
        >
          Study
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

  const compileIllo = (
    <div style={box}>
      <div
        style={{
          width: "196px",
          height: "92px",
          position: "relative",
          transformStyle: "preserve-3d",
          WebkitTransformStyle: "preserve-3d",
          animation: "sfg-flip 4.4s infinite",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            boxSizing: "border-box",
            borderRadius: "10px",
            border: "1px solid " + C.border,
            borderLeft: "3px solid " + PURP,
            background: C.soft,
            padding: "10px 12px",
            textAlign: "left",
          }}
        >
          <div style={{ fontSize: "10.5px", fontWeight: 700, color: C.text, marginBottom: "5px" }}>
            Alma 32:21
          </div>
          <div style={{ fontFamily: SERIF, fontSize: "12.5px", lineHeight: 1.4, color: C.text }}>
            “faith is not to have a{" "}
            <span style={{ background: HL, borderRadius: "3px", padding: "0 2px" }}>
              perfect knowledge
            </span>
            ”
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            WebkitTransform: "rotateY(180deg)",
            boxSizing: "border-box",
            borderRadius: "10px",
            border: "1px solid " + C.border,
            background: C.soft,
            padding: "10px 12px",
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
            gap: "5px",
          }}
        >
          <span style={{ fontSize: "9.5px", fontWeight: 700, color: PURP }}>YOUR NOTE</span>
          <span style={{ fontSize: "11.5px", color: C.muted, lineHeight: 1.4 }}>
            Belief comes before the witness…
          </span>
        </div>
      </div>
    </div>
  );

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
          <span
            style={{
              width: "2px",
              height: "14px",
              background: C.text,
              animation: "sfg-caret 1.1s step-end infinite",
            }}
          />
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
          <span
            style={{
              fontSize: "9px",
              fontWeight: 700,
              color: "#fff",
              background: PURP,
              borderRadius: "5px",
              padding: "1px 5px",
            }}
          >
            YOUR MARK
          </span>
          <span style={{ fontSize: "11px", color: C.muted }}>Moroni 7:26</span>
        </div>
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
            color: C.muted,
            animation: "sfg-glow 2.4s ease-in-out infinite",
          }}
        >
          <svg {...stroke(C.muted, 20)}>
            <rect x="4" y="10" width="16" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        </span>
        {bookSpine("Master", PURP, true)}
        {bookSpine("Session", C.muted, false)}
      </div>
    </div>
  );

  // ---- the guide content ----
  const FEATURES: {
    id: string;
    title: string;
    sub: string;
    icon: JSX.Element;
    pages: { illo: JSX.Element; heading: string; lines: string[] }[];
  }[] = [
    {
      id: "linking",
      title: "Linking chapters",
      sub: "Join chapters & jump between them",
      icon: chainIcon(PURP, 20),
      pages: [
        {
          illo: linkIllo,
          heading: "Link two chapters",
          lines: [
            "Some chapters belong together — a prophecy and its fulfillment, a teaching echoed in another book. Linking joins them into one study.",
            "Open a chapter, tap the chain button in the top bar, then either “Link with next” or pick any chapter from the list. Scribal links them and takes you there.",
          ],
        },
        {
          illo: linkIllo,
          heading: "Jump back and forth",
          lines: [
            "Tap the chain button again and you'll see every chapter in the group. Hit “Go to →” to hop straight to a partner — no scrolling, no searching.",
            "When you Compile a linked chapter, the marks from every chapter in the group gather together. You can Unlink any chapter from the same panel.",
          ],
        },
      ],
    },
    {
      id: "linkstudy",
      title: "Link verses into a study",
      sub: "Build a study from search results",
      icon: chainIcon(TEAL, 20),
      pages: [
        {
          illo: linkStudyIllo,
          heading: "Gather verses from anywhere",
          lines: [
            "A keyword study is a hand-picked set of verses pulled from different chapters — every verse about a covenant, say — kept together so you can mark and compile them as one.",
          ],
        },
        {
          illo: linkStudyIllo,
          heading: "How to make one",
          lines: [
            "Open Search, find a word, then tap the green “Link verses into a study” button. Tap the verses you want, give the study a name, and save.",
            "It then appears under Studies. Open it to mark those verses together, and Compile to gather their themes — just like a chapter.",
          ],
        },
      ],
    },
    {
      id: "find",
      title: "Finding your studies",
      sub: "Where linked & keyword studies live",
      icon: layersIcon(PURP, 20),
      pages: [
        {
          illo: findIllo,
          heading: "All your studies in one place",
          lines: [
            "Tap “Studies” on the home screen. Everything you've compiled lives here in three groups: Chapter studies, Linked studies (chapters you've joined), and Keyword studies (verses linked from search).",
          ],
        },
        {
          illo: findIllo,
          heading: "Open or peek",
          lines: [
            "Tap a study to jump straight to its compiled notes. Tap the ⓘ to peek at what it covers and its themes without leaving the list.",
            "Linked and keyword studies both carry the chain icon, so the studies you built by linking are easy to spot.",
          ],
        },
      ],
    },
    {
      id: "compile",
      title: "Compile & notes",
      sub: "Cards, notes, and sharing",
      icon: sparkIcon(PURP, 20),
      pages: [
        {
          illo: compileIllo,
          heading: "Your marks, gathered by theme",
          lines: [
            "Compile sweeps up everything you've marked in a chapter or study and lays it out as cards, grouped by color theme — your outline, built for you.",
            "Give the study a name at the top and tap “Save to Studies” to keep it on your list.",
          ],
        },
        {
          illo: compileIllo,
          heading: "Notes & sharing cards",
          lines: [
            "Tap a card to flip it over and write a private note for that verse; a small flag marks the verses that carry one.",
            "Tap Share to turn a verse — or a whole theme — into a clean card you can send, with or without your notes.",
          ],
        },
      ],
    },
    {
      id: "search",
      title: "Keyword search",
      sub: "Search scripture & your marks",
      icon: searchIcon(PURP, 20),
      pages: [
        {
          illo: searchIllo,
          heading: "Search two ways",
          lines: [
            "Scribal searches the scripture text and your own marks. Toggle between “Scripture” and “My marks” at the top, and narrow to one book or search them all.",
          ],
        },
        {
          illo: searchIllo,
          heading: "From results to a study",
          lines: [
            "Searching Scripture? Tap “Link verses into a study” to bundle the matches into a keyword study you can mark and compile together.",
            "Searching “My marks” is the fast way back to something you highlighted weeks ago.",
          ],
        },
      ],
    },
    {
      id: "books",
      title: "Study books & the Vault",
      sub: "Master, sessions, and storage",
      icon: bookIcon(PURP, 20),
      pages: [
        {
          illo: booksIllo,
          heading: "Master & session books",
          lines: [
            "Your Master book holds your main, ongoing study. Open a session book any time you want a fresh layer — a class, a topic, a separate pass — without touching the Master.",
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
          <div style={{ flex: 1, fontSize: "19px", fontWeight: 800 }}>Features guide</div>
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
          <div style={{ fontSize: "13.5px", color: C.muted, lineHeight: 1.5, marginBottom: "16px" }}>
            Pick a feature to learn it in depth, with a quick animated walkthrough.
          </div>
          {FEATURES.map((f) => (
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
                <span style={{ display: "block", fontSize: "15px", fontWeight: 700 }}>
                  {f.title}
                </span>
                <span style={{ fontSize: "12.5px", color: C.muted }}>{f.sub}</span>
              </span>
              <span style={{ color: C.muted, fontSize: "18px" }}>›</span>
            </button>
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
        <div style={{ fontSize: "21px", fontWeight: 800, marginBottom: "16px" }}>
          {pg.heading}
        </div>
        {pg.illo}
        {pg.lines.map((t, i) => (
          <div
            key={i}
            style={{ fontSize: "14.5px", color: C.text, lineHeight: 1.6, marginBottom: "14px" }}
          >
            {t}
          </div>
        ))}
      </div>

      <div style={{ padding: "10px 20px calc(14px + env(safe-area-inset-bottom))" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "6px",
            marginBottom: "12px",
          }}
        >
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
