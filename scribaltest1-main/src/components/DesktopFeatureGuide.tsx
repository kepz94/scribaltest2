import { useState, ReactNode, CSSProperties } from "react";

const PURP = "#8b5cf6";
const TEAL = "#0d9488";
const AMBER = "#d97706";

interface Props {
  onClose: () => void;
}

export default function DesktopFeatureGuide({ onClose }: Props) {
  const [openId, setOpenId] = useState("linking");
  const [page, setPage] = useState(0);

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
  const searchIconSvg = (color: string, size = 18) => (
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
  const shareIcon = (color: string, size = 14) => (
    <svg {...stroke(color, size)}>
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
      <path d="M12 3v13" />
      <path d="m7 8 5-5 5 5" />
    </svg>
  );

  // ---- small building blocks ----
  const bar = (w: number | string, c = "var(--muted)", op = 0.45) => (
    <div
      style={{
        height: 6,
        width: typeof w === "number" ? w + "px" : w,
        borderRadius: 3,
        background: c,
        opacity: op,
      }}
    />
  );

  const frameStyle: CSSProperties = {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 16,
    minHeight: 150,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 10,
  };

  const tab = (label: string, active: boolean) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 8,
        borderLeft: "3px solid " + PURP,
        border: active ? "1px solid " + PURP : "1px solid var(--border)",
        background: active ? "var(--soft)" : "var(--panel)",
        fontSize: 11.5,
        fontWeight: 600,
        color: "var(--text)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
      {chainIcon(PURP, 12)}
    </div>
  );

  // ---- illustrations (drawn from desktop's own UI) ----
  const tabsIllo = (
    <div style={frameStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: "center",
        }}
      >
        {tab("Isaiah 53", true)}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: PURP + "22",
          }}
        >
          {chainIcon(PURP, 15)}
        </div>
        {tab("2 Nephi 7", false)}
      </div>
      <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)" }}>
        Linked — one shared set of marks
      </div>
    </div>
  );

  const searchLinkIllo = (
    <div style={frameStyle}>
      {[true, false, true].map((on, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 4,
              flexShrink: 0,
              border: "1.5px solid " + (on ? TEAL : "var(--border)"),
              background: on ? TEAL : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {on && (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )}
          </div>
          {bar(i === 1 ? "55%" : "72%", "var(--text)", 0.35)}
        </div>
      ))}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          alignSelf: "flex-start",
          marginTop: 2,
          padding: "5px 11px",
          borderRadius: 999,
          background: TEAL,
          color: "#fff",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {chainIcon("#fff", 12)}
        Link verses into a study
      </div>
    </div>
  );

  const sectionRow = (label: string, withChain: boolean) => (
    <div>
      <div
        style={{
          fontSize: 8.5,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--muted)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "6px 8px",
          borderRadius: 8,
          background: "var(--panel)",
          border: "1px solid var(--border)",
        }}
      >
        {withChain ? (
          chainIcon(TEAL, 12)
        ) : (
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: PURP }} />
        )}
        {bar("60%", "var(--text)", 0.4)}
      </div>
    </div>
  );

  const studiesIllo = (
    <div style={frameStyle}>
      {sectionRow("Chapter studies", false)}
      {sectionRow("Linked studies", true)}
      {sectionRow("Keyword studies", true)}
    </div>
  );

  const compileCard = (accent: string, flag: boolean) => (
    <div
      style={{
        position: "relative",
        padding: "9px 11px",
        borderRadius: 9,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderLeft: "4px solid " + accent,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {bar("40%", "var(--text)", 0.5)}
        {flag && (
          <span style={{ fontSize: 10, marginLeft: "auto", color: AMBER }}>⚑</span>
        )}
        {flag && shareIcon("var(--muted)", 13)}
      </div>
      {bar("82%")}
    </div>
  );

  const compileIllo = (
    <div style={frameStyle}>
      {compileCard(PURP, true)}
      {compileCard(TEAL, false)}
      {compileCard(AMBER, false)}
    </div>
  );

  const searchIllo = (
    <div style={frameStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 11px",
          borderRadius: 999,
          background: "var(--panel)",
          border: "1px solid var(--border)",
        }}
      >
        {searchIconSvg("var(--muted)", 14)}
        <span style={{ fontSize: 11.5, color: "var(--text)", fontWeight: 600 }}>
          faith & works
        </span>
      </div>
      <div style={{ display: "flex", gap: 7 }}>
        <span
          style={{
            padding: "4px 11px",
            borderRadius: 999,
            background: PURP,
            color: "#fff",
            fontSize: 10.5,
            fontWeight: 700,
          }}
        >
          Scripture
        </span>
        <span
          style={{
            padding: "4px 11px",
            borderRadius: 999,
            border: "1px solid var(--border)",
            color: "var(--muted)",
            fontSize: 10.5,
            fontWeight: 600,
          }}
        >
          My marks
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 2 }}>
        {bar("78%", "var(--text)", 0.32)}
        {bar("64%", "var(--text)", 0.32)}
      </div>
    </div>
  );

  const bookRow = (label: string, master: boolean, active: boolean) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 11px",
        borderRadius: 9,
        background: master ? "var(--text)" : "var(--panel)",
        color: master ? "var(--bg)" : "var(--text)",
        border:
          active && !master
            ? "1px solid " + PURP
            : "1px solid var(--border)",
        fontSize: 11.5,
        fontWeight: 600,
      }}
    >
      {bookIcon(master ? "var(--bg)" : PURP, 14)}
      {label}
      {active && !master && (
        <span
          style={{
            marginLeft: "auto",
            fontSize: 8,
            letterSpacing: "1px",
            color: PURP,
            border: "1px solid " + PURP,
            borderRadius: 999,
            padding: "1px 6px",
          }}
        >
          ACTIVE
        </span>
      )}
      {master && (
        <span style={{ marginLeft: "auto", fontSize: 10, opacity: 0.8 }}>
          permanent
        </span>
      )}
    </div>
  );

  const booksIllo = (
    <div style={frameStyle}>
      {bookRow("Master Book", true, false)}
      {bookRow("Session · Romans", false, true)}
      {bookRow("Session · Sunday class", false, false)}
    </div>
  );

  // ---- the six topics ----
  const FEATURES: {
    id: string;
    title: string;
    sub: string;
    icon: ReactNode;
    pages: { illo: ReactNode; heading: string; lines: string[] }[];
  }[] = [
    {
      id: "linking",
      title: "Linking chapters",
      sub: "Join chapters & jump between them",
      icon: chainIcon(PURP, 19),
      pages: [
        {
          illo: tabsIllo,
          heading: "Link two chapters",
          lines: [
            "Some chapters belong together — a prophecy and its fulfillment, or a teaching echoed elsewhere. Linking joins them so they share one set of marks.",
            "Open a chapter in a tab, click the purple chain on the tab, and choose another open tab to link it with.",
          ],
        },
        {
          illo: tabsIllo,
          heading: "Jump and compile together",
          lines: [
            "Click the chain again to see every chapter in the group and hop straight to a partner — no scrolling.",
            "Compile a linked chapter and the marks from every chapter in the group gather together. You can unlink any chapter from the same panel.",
          ],
        },
      ],
    },
    {
      id: "linkstudy",
      title: "Linking verses into a study",
      sub: "Build a study from search results",
      icon: chainIcon(TEAL, 19),
      pages: [
        {
          illo: searchLinkIllo,
          heading: "Gather verses from anywhere",
          lines: [
            "A keyword study is a hand-picked set of verses pulled from different chapters — every verse about a covenant, say — kept together so you can mark and compile them as one.",
          ],
        },
        {
          illo: searchLinkIllo,
          heading: "How to make one",
          lines: [
            "Open Search, find a word, then tick the verses you want and click the green “Link verses into a study”. Give it a name and save.",
            "It appears under Studies. Open it to mark those verses together, and Compile to gather their themes — just like a chapter.",
          ],
        },
      ],
    },
    {
      id: "find",
      title: "Finding your studies",
      sub: "Where every study lives",
      icon: layersIcon(PURP, 19),
      pages: [
        {
          illo: studiesIllo,
          heading: "All your studies in one place",
          lines: [
            "Click 📑 Studies in the top bar. Everything you've compiled lives here in three groups: Chapter studies, Linked studies, and Keyword studies.",
          ],
        },
        {
          illo: studiesIllo,
          heading: "Reopen any study",
          lines: [
            "Click a study to reopen its compiled view — live from your current marks, with its theme names intact.",
            "Linked and keyword studies both carry the chain icon, so the ones you built by linking are easy to spot.",
          ],
        },
      ],
    },
    {
      id: "compile",
      title: "Compile & notes",
      sub: "Cards, notes, and sharing",
      icon: sparkIcon(PURP, 19),
      pages: [
        {
          illo: compileIllo,
          heading: "Your marks, gathered by theme",
          lines: [
            "Compile sweeps up everything you've marked and lays it out four ways: Outline ranks verses by how heavily you marked them, Charting maps themes across verses in a grid, Distilled reads your marks back as flowing text, and Relational pairs them up — covenants, contrasts, types, and questions.",
            "Compiling a chapter or study saves it to your Studies automatically — there's no separate save step.",
          ],
        },
        {
          illo: compileIllo,
          heading: "Notes & sharing cards",
          lines: [
            "Add a private note to any verse; a small flag marks the verses that carry one.",
            "Click “⤴ Share image” to turn a verse — or a whole theme — into a clean card you can save or send, with or without your notes.",
          ],
        },
      ],
    },
    {
      id: "search",
      title: "Keyword search",
      sub: "Search scripture & your marks",
      icon: searchIconSvg(PURP, 19),
      pages: [
        {
          illo: searchIllo,
          heading: "Search two ways",
          lines: [
            "Scribal searches the scripture text and your own marks. Switch between “Scripture” and “My marks” at the top, and narrow to one book or search them all.",
          ],
        },
        {
          illo: searchIllo,
          heading: "Operators & studies",
          lines: [
            "Phrases match by default. Put & between words to require all of them (faith & works), and use * as a wildcard.",
            "Searching Scripture? Link the matches into a keyword study you can mark and compile together.",
          ],
        },
      ],
    },
    {
      id: "books",
      title: "Study books & the Vault",
      sub: "Master, sessions, and storage",
      icon: bookIcon(PURP, 19),
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
          heading: "Browse them in the Vault",
          lines: [
            "Open the Vault to switch between books or browse the studies inside each one.",
            "The Master is permanent; session books can be deleted when you're done with them.",
          ],
        },
      ],
    },
  ];

  const active = FEATURES.find((f) => f.id === openId) || FEATURES[0];
  const last = active.pages.length - 1;
  const cur = Math.min(page, last);
  const pg = active.pages[cur];

  const select = (id: string) => {
    setOpenId(id);
    setPage(0);
  };

  return (
    <div
      className="scribal-fade"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 4600,
        padding: "20px",
      }}
    >
      <div
        className="scribal-rise"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--panel)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          width: "100%",
          maxWidth: 760,
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Feature guide</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 1 }}>
              Pick a topic to see how it works.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              backgroundColor: PURP,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "8px 18px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>

        <div style={{ display: "flex", minHeight: 0, flex: 1 }}>
          {/* topic list */}
          <div
            style={{
              width: 224,
              flexShrink: 0,
              borderRight: "1px solid var(--border)",
              padding: 10,
              overflowY: "auto",
            }}
          >
            {FEATURES.map((f) => {
              const on = f.id === openId;
              return (
                <button
                  key={f.id}
                  onClick={() => select(f.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 11px",
                    marginBottom: 4,
                    borderRadius: 10,
                    border: "1px solid " + (on ? "var(--border)" : "transparent"),
                    background: on ? "var(--soft)" : "transparent",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    color: "var(--text)",
                  }}
                >
                  <span style={{ flexShrink: 0, display: "inline-flex" }}>
                    {f.icon}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{ fontSize: 13.5, fontWeight: 600, display: "block" }}
                    >
                      {f.title}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--muted)",
                        display: "block",
                        marginTop: 1,
                      }}
                    >
                      {f.sub}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* detail pane */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              padding: 22,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {pg.illo}

            <h3 style={{ margin: "18px 0 10px", fontSize: 17 }}>{pg.heading}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {pg.lines.map((ln, i) => (
                <p
                  key={i}
                  style={{
                    margin: 0,
                    fontSize: 13.5,
                    lineHeight: 1.6,
                    color: "var(--muted)",
                  }}
                >
                  {ln}
                </p>
              ))}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginTop: "auto",
                paddingTop: 20,
              }}
            >
              <div style={{ display: "flex", gap: 6, flex: 1 }}>
                {active.pages.map((_, i) => (
                  <div
                    key={i}
                    style={{
                      width: i === cur ? 20 : 7,
                      height: 7,
                      borderRadius: 999,
                      background: i === cur ? PURP : "var(--border)",
                      transition: "width 0.2s",
                    }}
                  />
                ))}
              </div>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={cur === 0}
                style={{
                  padding: "7px 15px",
                  borderRadius: 999,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: cur === 0 ? "var(--border)" : "var(--text)",
                  cursor: cur === 0 ? "default" : "pointer",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              >
                Back
              </button>
              <button
                onClick={() => setPage((p) => Math.min(last, p + 1))}
                disabled={cur === last}
                style={{
                  padding: "7px 17px",
                  borderRadius: 999,
                  border: "none",
                  background: cur === last ? "var(--soft)" : "var(--text)",
                  color: cur === last ? "var(--muted)" : "var(--bg)",
                  cursor: cur === last ? "default" : "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "inherit",
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
