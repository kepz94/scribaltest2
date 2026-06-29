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

const SECTION_ORDER = ["Search & combine", "While you read", "Your library"];

const KEYFRAMES = `
@keyframes sfg-ring {0%,100%{opacity:.2;transform:scale(.96)}50%{opacity:.55;transform:scale(1.05)}}
@keyframes sfg-glow {0%,100%{opacity:.4}50%{opacity:1}}
@keyframes sfg-rip {0%{opacity:.7;transform:scale(.5)}100%{opacity:0;transform:scale(1.25)}}
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
  const sheetBox: CSSProperties = { ...box, alignItems: "flex-end", padding: 0 };
  const flatBox: CSSProperties = { ...box, alignItems: "stretch", padding: 0 };

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
  const chain = (color: string, size = 18, sw = 2) => (
    <svg {...stroke(color, size, sw)}>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  );
  const magnifier = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
  const layers = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <path d="M12 3 3 8l9 5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </svg>
  );
  const lock = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
  const bookGlyph = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
  const house = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
    </svg>
  );
  const stacked = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <rect x="8" y="3" width="13" height="13" rx="2.5" />
      <path d="M16 19v.5A1.5 1.5 0 0 1 14.5 21h-9A1.5 1.5 0 0 1 4 19.5v-9A1.5 1.5 0 0 1 5.5 9H6" />
    </svg>
  );
  const twoCircles = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <circle cx="8.5" cy="12" r="5.5" />
      <circle cx="15.5" cy="12" r="5.5" />
    </svg>
  );
  const eraser = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
    </svg>
  );
  const bookmark = (color: string, size = 18) => (
    <svg {...stroke(color, size)}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
  const infoGlyph = (size = 15) => (
    <svg {...stroke(C.muted, size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
  const trash = (size = 15) => (
    <svg {...stroke(C.muted, size)}>
      <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" />
    </svg>
  );

  // ---- shared bits ----
  const seclbl: CSSProperties = {
    fontSize: "9px",
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: C.muted,
    margin: "0 0 2px",
  };

  const tileWrap = (icon: JSX.Element, title: string, sub: string) => (
    <div style={box}>
      <div
        style={{
          width: "128px",
          height: "112px",
          border: "1px solid " + C.border,
          borderRadius: "14px",
          background: C.panel,
          padding: "14px 13px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <span style={{ color: PURP, display: "inline-flex" }}>{icon}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: "15px", fontWeight: 700, marginBottom: "3px" }}>{title}</span>
        <span style={{ fontSize: "11.5px", color: C.muted, lineHeight: 1.3 }}>{sub}</span>
      </div>
    </div>
  );

  const phead = (title: string) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "7px 8px",
        borderBottom: "1px solid " + C.border,
      }}
    >
      <span style={{ fontSize: "16px", color: C.text }}>‹</span>
      <span style={{ fontSize: "13px", fontWeight: 700 }}>{title}</span>
    </div>
  );

  const studyRow = (leading: JSX.Element, name: string, meta: string) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        borderTop: "1px solid " + C.border,
        padding: "7px 0",
      }}
    >
      <span style={{ flexShrink: 0, display: "inline-flex", marginLeft: "1px" }}>{leading}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: "12px", fontWeight: 600, color: C.text }}>{name}</span>
        <span style={{ fontSize: "9.5px", color: C.muted }}>{meta}</span>
      </span>
      {infoGlyph(15)}
      {trash(15)}
    </div>
  );

  const dot = (color: string) => (
    <span style={{ display: "block", width: "9px", height: "9px", borderRadius: "50%", background: color }} />
  );

  const bookRow = (iconColor: string, name: string, meta: string, withTrash: boolean) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        borderTop: "1px solid " + C.border,
        padding: "7px 0",
      }}
    >
      <span style={{ flexShrink: 0, display: "inline-flex", marginLeft: "1px" }}>{bookGlyph(iconColor, 16)}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: "12px", fontWeight: 600, color: C.text }}>{name}</span>
        <span style={{ fontSize: "9.5px", color: C.muted }}>{meta}</span>
      </span>
      {withTrash && trash(15)}
      <span style={{ color: C.muted, fontSize: "16px" }}>›</span>
    </div>
  );

  const legRow = (label: string, desc: string) => (
    <div style={{ marginBottom: "7px", fontSize: "11.5px", lineHeight: 1.45 }}>
      <span style={{ fontWeight: 700, color: C.text }}>{label}</span>
      <span style={{ color: C.muted }}>{" — " + desc}</span>
    </div>
  );

  // ================= ENTRY illustrations (page 1) =================
  const searchControls = (
    <div style={box}>
      <div style={{ width: "214px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 11px",
            borderRadius: "10px",
            border: "1px solid " + C.border,
            background: C.bg,
          }}
        >
          {magnifier(C.muted, 14)}
          <span style={{ fontFamily: SERIF, fontSize: "13px", color: C.muted }}>Search scripture…</span>
        </div>
        <div style={{ display: "flex", gap: "4px", background: C.soft, borderRadius: "9px", padding: "3px" }}>
          <span style={{ flex: 1, textAlign: "center", padding: "6px 0", borderRadius: "7px", background: C.text, color: C.bg, fontSize: "11px", fontWeight: 600 }}>
            Scripture
          </span>
          <span style={{ flex: 1, textAlign: "center", padding: "6px 0", fontSize: "11px", color: C.muted }}>My marks</span>
        </div>
        <div style={{ display: "flex", gap: "4px", background: C.soft, borderRadius: "9px", padding: "3px" }}>
          <span style={{ flex: 1, textAlign: "center", padding: "6px 0", borderRadius: "7px", background: C.text, color: C.bg, fontSize: "10px", fontWeight: 600 }}>
            All words
          </span>
          <span style={{ flex: 1, textAlign: "center", padding: "6px 0", fontSize: "10px", color: C.muted }}>Any word</span>
          <span style={{ flex: 1, textAlign: "center", padding: "6px 0", fontSize: "10px", color: C.muted }}>Phrase</span>
        </div>
      </div>
    </div>
  );
  const studiesEntry = tileWrap(layers(PURP, 22), "Studies", "Every study you've done");
  const booksEntry = tileWrap(lock(PURP, 22), "Vault", "2 session books");

  const linkEntry = (
    <div style={box}>
      <div style={{ width: "232px", display: "flex", alignItems: "center", gap: "8px" }}>
        <div
          style={{
            border: "1px solid " + C.border,
            borderRadius: "999px",
            padding: "5px 11px",
            fontSize: "12px",
            fontWeight: 700,
            flexShrink: 0,
            color: C.text,
          }}
        >
          Send verses
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
          <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: C.muted, flexShrink: 0 }} />
          <span
            style={{
              fontSize: "11px",
              color: C.muted,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Saved on this phone
          </span>
        </div>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <span
            style={{
              position: "absolute",
              inset: "-6px",
              borderRadius: "999px",
              border: "1.5px solid " + C.muted,
              opacity: 0.4,
              animation: "sfg-ring 1.9s ease-in-out infinite",
            }}
          />
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: "5px",
              border: "1px solid " + C.border,
              borderRadius: "999px",
              padding: "5px 11px",
            }}
          >
            {chain(RED, 14)}
            <span style={{ fontSize: "12px", fontWeight: 700, color: RED }}>Link</span>
          </div>
        </div>
      </div>
    </div>
  );

  const combinedEntry = (
    <div style={box}>
      <div style={{ width: "206px", display: "flex", flexDirection: "column", gap: "9px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            border: "1px solid " + C.border,
            borderTop: "3px solid " + RED,
            borderRadius: "9px",
            padding: "9px 11px",
          }}
        >
          <span style={{ fontFamily: SERIF, fontSize: "12px", fontWeight: 700, color: C.text }}>1 Nephi 1</span>
          <span style={{ marginLeft: "auto", fontSize: "9px", color: C.muted }}>chapter</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            border: "1px solid " + C.border,
            borderTop: "3px solid " + BLUE,
            borderRadius: "9px",
            padding: "9px 11px",
          }}
        >
          {magnifier(BLUE, 13)}
          <span style={{ fontFamily: SERIF, fontSize: "12px", fontWeight: 700, color: C.text }}>Faith</span>
          <span style={{ marginLeft: "auto", fontSize: "9px", color: C.muted }}>keyword</span>
        </div>
      </div>
    </div>
  );

  const navBtn: CSSProperties = {
    width: "34px",
    height: "34px",
    borderRadius: "9px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    position: "relative",
  };

  const screensEntry = (
    <div style={box}>
      <div style={{ width: "242px", display: "flex", alignItems: "center", gap: "4px" }}>
        <span style={navBtn}>{house(C.text, 19)}</span>
        <span style={{ ...navBtn, border: "1px solid " + TEAL }}>
          <span
            style={{
              position: "absolute",
              inset: "-5px",
              borderRadius: "12px",
              border: "1.5px solid " + TEAL,
              opacity: 0.45,
              animation: "sfg-ring 1.9s ease-in-out infinite",
            }}
          />
          {stacked(C.text, 19)}
          <span
            style={{
              position: "absolute",
              top: "2px",
              right: "1px",
              minWidth: "13px",
              height: "13px",
              padding: "0 3px",
              background: PURP,
              color: "#fff",
              borderRadius: "99px",
              fontSize: "8px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            2
          </span>
        </span>
        <span style={{ color: C.muted, fontSize: "18px", padding: "0 2px" }}>‹</span>
        <span
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: "14px",
            fontWeight: 700,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          1 Nephi 1
        </span>
        <span style={{ color: C.muted, fontSize: "18px", padding: "0 2px" }}>›</span>
        <span
          style={{
            flexShrink: 0,
            background: C.text,
            color: C.bg,
            borderRadius: "999px",
            padding: "6px 13px",
            fontSize: "11.5px",
            fontWeight: 700,
          }}
        >
          Compile
        </span>
      </div>
    </div>
  );

  const tool: CSSProperties = {
    flex: 1,
    height: "28px",
    borderRadius: "8px",
    border: "1px solid " + C.border,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: C.text,
  };
  const toolOn: CSSProperties = { ...tool, background: C.text, border: "1px solid " + C.text, color: C.bg };

  const dictEntry = (
    <div style={box}>
      <div style={{ width: "216px" }}>
        <div style={{ display: "flex", gap: "8px", marginBottom: "9px" }}>
          {["#ff7b72", "#f0a24b", "#7cb0e8", "#b794f6"].map((c, i) => (
            <span
              key={c}
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                background: c,
                flexShrink: 0,
                border: i === 2 ? "2px solid " + C.text : "1px solid " + C.border,
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex", gap: "6px", marginBottom: "9px" }}>
          <span style={tool}>
            <b style={{ fontSize: "12px" }}>B</b>
          </span>
          <span style={{ ...tool, textDecoration: "underline", fontSize: "12px", fontWeight: 700 }}>U</span>
          <span style={tool}>{eraser("currentColor", 14)}</span>
          <span style={{ ...toolOn, position: "relative" }}>
            <span
              style={{
                position: "absolute",
                inset: "-4px",
                borderRadius: "11px",
                border: "1.5px solid " + GOLD,
                opacity: 0.6,
                animation: "sfg-ring 1.9s ease-in-out infinite",
              }}
            />
            {magnifier("currentColor", 14)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ flex: 1, fontSize: "11px", color: C.muted }}>Define · tap a word to look it up</span>
          <span style={{ color: C.muted, fontSize: "12px" }}>▴</span>
        </div>
      </div>
    </div>
  );

  // ================= SCREEN illustrations (page 2) =================
  const searchLegend = (
    <div
      style={{
        borderRadius: "14px",
        border: "1px solid " + C.border,
        background: C.soft,
        padding: "13px 15px",
        marginBottom: "18px",
      }}
    >
      <div
        style={{
          fontSize: "10px",
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          color: C.muted,
          marginBottom: "9px",
        }}
      >
        How search works
      </div>
      {legRow("All / Any / Phrase", "how plain words combine: every word, any word, or the exact phrase.")}
      {legRow("faith & hope", "use & to require all the parts.")}
      {legRow("mercy OR grace", "use OR to match either side.")}
      {legRow("merc*", "a * after a stem matches mercy, merciful, mercies.")}
      {legRow("Scripture / My marks", "the full text, or only what you've marked.")}
      {legRow("Volume / Book", "limit results to a volume, or one book.")}
    </div>
  );

  const linkSheet = (
    <div style={sheetBox}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.28)" }} />
      <div
        style={{
          position: "relative",
          width: "100%",
          background: C.panel,
          borderRadius: "18px 18px 0 0",
          padding: "13px 15px",
        }}
      >
        <div style={seclbl}>Combine into a study</div>
        <div
          style={{
            background: RED,
            color: "#fff",
            borderRadius: "10px",
            padding: "11px",
            textAlign: "center",
            fontSize: "12.5px",
            fontWeight: 700,
            marginTop: "5px",
          }}
        >
          Link with next chapter (1 Nephi 2) →
        </div>
        <div style={{ ...seclbl, margin: "11px 0 5px" }}>Or add a keyword search</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            border: "1px solid " + C.border,
            borderRadius: "9px",
            padding: "9px 10px",
          }}
        >
          {magnifier(BLUE, 13)}
          <span style={{ fontSize: "11.5px", fontWeight: 700, color: BLUE }}>Add a keyword search to this study</span>
        </div>
      </div>
    </div>
  );

  const combinedFuse = (
    <div style={box}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
        <div style={{ position: "relative", width: "74px", height: "60px" }}>
          <span
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "60px",
              height: "60px",
              margin: "-30px 0 0 -30px",
              borderRadius: "50%",
              background: "radial-gradient(circle,rgba(139,92,246,0.35),transparent 68%)",
              animation: "sfg-glow 2s ease-in-out infinite",
            }}
          />
          <span
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "54px",
              height: "54px",
              margin: "-27px 0 0 -27px",
              borderRadius: "50%",
              border: "2px solid " + PURP,
              opacity: 0,
              animation: "sfg-rip 2.6s ease-out infinite",
            }}
          />
          <span style={{ position: "absolute", left: "14px", top: "18px", opacity: 0.85 }}>{chain(RED, 26, 2.2)}</span>
          <span style={{ position: "absolute", left: "34px", top: "18px", opacity: 0.85 }}>{chain(BLUE, 26, 2.2)}</span>
          <span style={{ position: "absolute", left: "24px", top: "18px" }}>{chain(PURP, 26, 2.4)}</span>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "14px", fontWeight: 800, color: C.text }}>Combined study</div>
          <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>Chapter + keyword linked</div>
        </div>
      </div>
    </div>
  );

  const miniCard = (active: boolean, head: JSX.Element, preview: string) => (
    <div
      style={{
        flex: 1,
        border: (active ? "2px solid " + PURP : "1px solid " + C.border),
        borderRadius: "11px",
        overflow: "hidden",
        background: C.panel,
      }}
    >
      <div
        style={{
          padding: "7px 8px 6px",
          borderBottom: "1px solid " + C.border,
          background: active ? "rgba(139,92,246,0.08)" : "transparent",
        }}
      >
        {head}
      </div>
      <div style={{ fontFamily: SERIF, padding: "6px 8px", fontSize: "8px", lineHeight: 1.4, color: C.muted }}>
        {preview}
      </div>
    </div>
  );

  const screensGrid = (
    <div style={box}>
      <div style={{ width: "216px", display: "flex", flexDirection: "column", gap: "7px" }}>
        <div style={{ fontSize: "11px", fontWeight: 800, textAlign: "center" }}>Screens</div>
        <div style={{ display: "flex", gap: "8px" }}>
          {miniCard(
            true,
            <>
              <div style={{ fontSize: "10.5px", fontWeight: 700, color: C.text }}>1 Nephi 1</div>
              <div style={{ fontSize: "8.5px", color: C.muted }}>Book of Mormon</div>
            </>,
            "I, Nephi, having been born of goodly parents…"
          )}
          {miniCard(
            false,
            <>
              <div
                style={{
                  fontSize: "8px",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: BLUE,
                  display: "flex",
                  alignItems: "center",
                  gap: "3px",
                }}
              >
                {magnifier(BLUE, 9)}Keyword study
              </div>
              <div style={{ fontSize: "10.5px", fontWeight: 700, color: C.text }}>Faith</div>
              <div style={{ fontSize: "8px", color: C.muted }}>12 verses · Master Book</div>
            </>,
            "faith is not to have a perfect…"
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span
            style={{
              border: "1px solid " + C.border,
              borderRadius: "999px",
              padding: "5px 12px",
              fontSize: "10px",
              fontWeight: 600,
              background: C.soft,
              color: C.text,
            }}
          >
            Close All
          </span>
          <span
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              background: PURP,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "19px",
              boxShadow: "0 4px 12px rgba(139,92,246,0.45)",
            }}
          >
            +
          </span>
        </div>
      </div>
    </div>
  );

  const dictSheet = (
    <div style={sheetBox}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.28)" }} />
      <div
        style={{
          position: "relative",
          width: "100%",
          background: C.panel,
          borderRadius: "18px 18px 0 0",
          padding: "16px",
        }}
      >
        <div style={{ fontFamily: SERIF, fontSize: "17px", fontWeight: 700, color: C.text }}>faith</div>
        <div style={{ fontFamily: SERIF, fontSize: "11.5px", lineHeight: 1.45, color: C.text, marginTop: "6px" }}>
          Belief; the assent of the mind to the truth of what is declared by another, resting on his authority and
          veracity.
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            marginTop: "11px",
            border: "1px solid " + C.border,
            borderRadius: "9px",
            padding: "7px 12px",
            fontSize: "11.5px",
            fontWeight: 700,
            color: C.text,
          }}
        >
          {bookmark(GOLD, 13)}Tag this word
        </div>
      </div>
    </div>
  );

  const studiesPage = (
    <div style={flatBox}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column" }}>
        {phead("Studies")}
        <div style={{ padding: "6px 12px 0" }}>
          <div style={{ ...seclbl, marginTop: "2px" }}>Chapter studies</div>
          {studyRow(dot(RED), "1 Nephi 1", "8 marks")}
          <div style={{ ...seclbl, marginTop: "5px" }}>Combined studies</div>
          {studyRow(chain(PURP, 15), "Alma 32", "5 verses")}
        </div>
      </div>
    </div>
  );

  const booksPage = (
    <div style={flatBox}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column" }}>
        {phead("Books")}
        <div style={{ padding: "8px 12px 0" }}>
          <div style={{ fontSize: "9px", color: C.muted, lineHeight: 1.4, marginBottom: "2px" }}>
            Master is permanent. Deleting a session book also deletes its marks and studies.
          </div>
          {bookRow(C.text, "Master Book  ·  permanent", "12 studies · 84 marks", false)}
          {bookRow(C.muted, "Sunday School", "3 studies · 12 marks", true)}
        </div>
      </div>
    </div>
  );

  // ================= the guide content =================
  const FEATURES: {
    id: string;
    section: string;
    color: string;
    title: string;
    sub: string;
    icon: JSX.Element;
    pages: { illo: JSX.Element; heading: string; lines: string[] }[];
  }[] = [
    {
      id: "search",
      section: "Search & combine",
      color: BLUE,
      title: "Keyword search",
      sub: "Search scripture & your marks",
      icon: magnifier(BLUE, 20),
      pages: [
        {
          illo: searchControls,
          heading: "Search two ways",
          lines: [
            "Open Search from the home screen. Search the scripture text or your own marks — switch at the top — then choose how the words combine: all of them, any of them, or the exact phrase.",
          ],
        },
        {
          illo: searchLegend,
          heading: "What each option finds",
          lines: [
            "From Scripture results, link the verses you want into a study to mark and compile together.",
          ],
        },
      ],
    },
    {
      id: "linking",
      section: "Search & combine",
      color: RED,
      title: "Link chapters",
      sub: "Join chapters & study them as one",
      icon: chain(RED, 20),
      pages: [
        {
          illo: linkEntry,
          heading: "Tap Link in the top bar",
          lines: [
            "Open a chapter and tap the Link button at the top right. Linking joins chapters that belong together — a prophecy and its fulfillment, a teaching echoed in another book.",
          ],
        },
        {
          illo: linkSheet,
          heading: "Link the next, or any chapter",
          lines: [
            "“Link with next chapter” joins the one after it, or pick any chapter from the list.",
            "Compile a linked chapter and the marks from the whole group gather as one. Unlink any of them from the same sheet.",
          ],
        },
      ],
    },
    {
      id: "combined",
      section: "Search & combine",
      color: PURP,
      title: "Combined studies",
      sub: "A chapter + a keyword study, joined",
      icon: twoCircles(PURP, 20),
      pages: [
        {
          illo: combinedEntry,
          heading: "Add a keyword search to a chapter",
          lines: [
            "From the same link sheet, search a word and link those verses into the chapter. A chapter study (red) and a keyword study (blue) become one combined study (purple).",
          ],
        },
        {
          illo: combinedFuse,
          heading: "Chapter + keyword, as one",
          lines: [
            "Scribal marks the moment with a quick fuse, then compiles the chapter's marks and the gathered verses side by side.",
          ],
        },
      ],
    },
    {
      id: "screens",
      section: "While you read",
      color: TEAL,
      title: "Screens",
      sub: "Several chapters or studies, at once",
      icon: stacked(TEAL, 20),
      pages: [
        {
          illo: screensEntry,
          heading: "Tap the stacked icon",
          lines: [
            "The stacked icon in the reading top bar opens your Screens — the badge shows how many you have open. A Screen is just an open chapter or study.",
          ],
        },
        {
          illo: screensGrid,
          heading: "Switch, open, or close",
          lines: [
            "Tap a screen to jump to it, “+” to open a new one, or close one to make room. You can keep up to eight at a time.",
          ],
        },
      ],
    },
    {
      id: "dictionary",
      section: "While you read",
      color: GOLD,
      title: "The dictionary",
      sub: "Webster's 1828, and tagging words",
      icon: bookGlyph(GOLD, 20),
      pages: [
        {
          illo: dictEntry,
          heading: "Arm the Define tool",
          lines: [
            "In the marking palette, tap the magnifier (Define). The bar reads “Define · tap a word to look it up.”",
          ],
        },
        {
          illo: dictSheet,
          heading: "Webster's 1828 — and tagging",
          lines: [
            "Tap any word for its 1828 meaning, often closer to what the text meant than today's usage.",
            "“Tag this word” bookmarks it; a small marker by the word reopens the meaning any time.",
          ],
        },
      ],
    },
    {
      id: "studies",
      section: "Your library",
      color: C.text,
      title: "Studies",
      sub: "Where every study is filed",
      icon: layers(C.text, 20),
      pages: [
        {
          illo: studiesEntry,
          heading: "Open Studies from home",
          lines: ["Tap the Studies tile on the home screen. Everything you've compiled is filed here."],
        },
        {
          illo: studiesPage,
          heading: "Filed by type",
          lines: [
            "Three groups: Chapter, Combined, and Keyword studies. Tap one to open its compiled notes, or the ⓘ to peek at its themes.",
          ],
        },
      ],
    },
    {
      id: "books",
      section: "Your library",
      color: GREEN,
      title: "Master & Sessions",
      sub: "Your books, kept in the Vault",
      icon: lock(GREEN, 20),
      pages: [
        {
          illo: booksEntry,
          heading: "Open the Vault from home",
          lines: ["Tap the Vault tile. It holds every book you've made."],
        },
        {
          illo: booksPage,
          heading: "Master & session books",
          lines: [
            "Your Master book is permanent and holds your main study. Session books are separate layers — a class, a topic — and can be deleted when you're done.",
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
            Pick a feature to learn it in depth — where to find it, then how it works.
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
        <div style={{ fontSize: "12px", fontWeight: 700, color: active.color, marginBottom: "4px" }}>
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
                background: i === Math.min(page, last) ? active.color : C.border,
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
