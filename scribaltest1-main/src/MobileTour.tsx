import { useState } from "react";
import { COLORS, COLOR_MAP, MarkColor } from "./types";

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
  driveConfigured: boolean;
  onSync: () => void;
  onLocal: () => void;
}

const SERIF = '"Times New Roman", Times, serif';
const HL = "rgba(139,92,246,0.30)";
const DOT = "rgba(120,120,120,0.45)";

const KEYFRAMES = `
@keyframes stour-tapdot {
  0%,55% { opacity:0; transform:translate(-50%,-50%) scale(1.5); }
  63% { opacity:1; transform:translate(-50%,-50%) scale(1); }
  72% { transform:translate(-50%,-50%) scale(0.8); }
  80% { transform:translate(-50%,-50%) scale(1); }
  92%,100% { opacity:0; }
}
@keyframes stour-taphl {
  0%,68% { opacity:0; }
  80%,90% { opacity:1; }
  100% { opacity:0; }
}
@keyframes stour-swdot {
  0%,12% { opacity:0; left:14%; }
  20% { opacity:1; }
  66% { opacity:1; left:82%; }
  80% { opacity:0; left:82%; }
  100% { opacity:0; left:14%; }
}
@keyframes stour-swhl {
  0%,16% { width:0; }
  64%,86% { width:100%; }
  100% { width:0; }
}
@keyframes stour-scrlines {
  0%,12% { transform:translateY(0); }
  58%,86% { transform:translateY(-44px); }
  100% { transform:translateY(0); }
}
@keyframes stour-scrdot {
  0%,12% { opacity:0; top:74%; }
  20% { opacity:1; }
  58% { opacity:1; top:28%; }
  80% { opacity:0; top:28%; }
  100% { opacity:0; top:74%; }
}
@keyframes stour-rise {
  0% { opacity:0; transform:translateY(10px); }
  100% { opacity:1; transform:translateY(0); }
}
@keyframes stour-penpulse {
  0%,100% { box-shadow:0 0 0 0 rgba(139,92,246,0); }
  50% { box-shadow:0 0 0 6px rgba(139,92,246,0.20); }
}
@keyframes stour-fadein {
  0%,25% { opacity:0; transform:translateY(5px); }
  55%,100% { opacity:1; transform:translateY(0); }
}
@keyframes stour-gather {
  0% { opacity:0; transform:translateX(16px); }
  100% { opacity:1; transform:translateX(0); }
}
@keyframes stour-linkpulse {
  0%,100% { transform:scale(1); }
  50% { transform:scale(1.16); }
}
@keyframes stour-ripple {
  0% { transform:translate(-50%,-50%) scale(0.4); opacity:0.55; }
  100% { transform:translate(-50%,-50%) scale(1.7); opacity:0; }
}
@keyframes stour-undo {
  0%,100% { transform:translateX(0); }
  20% { transform:translateX(-5px); }
  40% { transform:translateX(-5px); }
}
@keyframes stour-slideout {
  0%,35% { opacity:0; transform:translateY(7px) scale(0.94); }
  65%,100% { opacity:1; transform:translateY(0) scale(1); }
}
@keyframes stour-twinkle {
  0%,100% { opacity:0.5; }
  50% { opacity:1; }
}
@keyframes stour-linkbar {
  0%,18% { transform:scaleX(0); opacity:0; }
  40% { opacity:0.4; }
  70%,86% { transform:scaleX(1); opacity:0.4; }
  100% { transform:scaleX(0); opacity:0; }
}
@keyframes stour-flipcard {
  0%,28% { transform:rotateY(0deg); }
  50%,78% { transform:rotateY(180deg); }
  100% { transform:rotateY(0deg); }
}
`;

export default function MobileTour({ C, driveConfigured, onSync, onLocal }: Props) {
  const [step, setStep] = useState(0);
  const LAST = 7; // sign-in step index

  const dot: React.CSSProperties = {
    position: "absolute",
    width: "26px",
    height: "26px",
    borderRadius: "50%",
    backgroundColor: DOT,
    border: "2px solid rgba(120,120,120,0.6)",
    pointerEvents: "none",
  };

  const demoBox: React.CSSProperties = {
    position: "relative",
    height: "84px",
    borderRadius: "12px",
    border: "1px solid " + C.border,
    backgroundColor: C.panel,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: "8px",
  };

  const caption = (t: string) => (
    <div style={{ fontSize: "13px", color: C.muted, marginBottom: "18px" }}>{t}</div>
  );

  const word: React.CSSProperties = {
    position: "relative",
    fontFamily: SERIF,
    fontSize: "18px",
  };

  // ---- gesture demos ----
  const tapDemo = (
    <>
      <div style={demoBox}>
        <div style={{ position: "relative", display: "flex", gap: "8px" }}>
          <span style={word}>covenant</span>
          <span style={word}>
            <span
              style={{
                position: "absolute",
                inset: "-3px -5px",
                borderRadius: "4px",
                backgroundColor: HL,
                animation: "stour-taphl 2.6s infinite",
              }}
            />
            <span style={{ position: "relative" }}>people</span>
          </span>
          <span style={word}>of</span>
        </div>
        <div
          style={{ ...dot, left: "50%", top: "50%", animation: "stour-tapdot 2.6s infinite" }}
        />
      </div>
      {caption("Tap a word to mark it in your pen.")}
    </>
  );

  const swipeDemo = (
    <>
      <div style={demoBox}>
        <div style={{ position: "relative", display: "inline-flex", gap: "8px" }}>
          <span
            style={{
              position: "absolute",
              left: "-4px",
              top: "-3px",
              bottom: "-3px",
              borderRadius: "4px",
              backgroundColor: HL,
              animation: "stour-swhl 2.8s infinite",
            }}
          />
          <span style={word}>serve</span>
          <span style={word}>one</span>
          <span style={word}>another</span>
        </div>
        <div
          style={{ ...dot, top: "50%", marginTop: "-13px", animation: "stour-swdot 2.8s infinite" }}
        />
      </div>
      {caption("Swipe sideways across words to mark a whole phrase.")}
    </>
  );

  const scrollDemo = (
    <>
      <div style={demoBox}>
        <div style={{ animation: "stour-scrlines 3s infinite", textAlign: "center" }}>
          {[
            "In the beginning",
            "God created the",
            "heaven and the earth",
            "and the Spirit of God",
            "moved upon the waters",
          ].map((l, i) => (
            <div
              key={i}
              style={{ fontFamily: SERIF, fontSize: "15px", lineHeight: "22px", color: C.text }}
            >
              {l}
            </div>
          ))}
        </div>
        <div style={{ ...dot, left: "76%", animation: "stour-scrdot 3s infinite" }} />
      </div>
      {caption("Swipe up or down anywhere to scroll — your marks stay put.")}
    </>
  );

  // ---- step content ----
  const monogram = (
    <svg width="72" height="72" viewBox="0 0 84 84" style={{ marginBottom: "18px" }}>
      <rect width="84" height="84" rx="20" fill={C.text} />
      <text
        x="42"
        y="54"
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="46"
        fontWeight="700"
        fill={C.bg}
      >
        S
      </text>
      <rect x="24" y="62" width="36" height="4" rx="2" fill="#8b5cf6" />
    </svg>
  );

  const title = (t: string) => (
    <h1 style={{ fontSize: "24px", fontWeight: 700, margin: "0 0 12px" }}>{t}</h1>
  );
  const body = (t: string) => (
    <p style={{ fontSize: "15px", lineHeight: 1.6, color: C.muted, margin: "0 0 8px" }}>{t}</p>
  );

  const panel: React.CSSProperties = {
    border: "1px solid " + C.border,
    backgroundColor: C.panel,
    borderRadius: "14px",
    padding: "16px",
    marginBottom: "18px",
  };

  const pill: React.CSSProperties = {
    backgroundColor: C.soft,
    borderRadius: "999px",
    padding: "8px 14px",
    fontSize: "13px",
    color: C.text,
  };

  // Pens & themes
  const penDemo = (
    <div style={panel}>
      <div
        style={{
          display: "flex",
          gap: "10px",
          justifyContent: "center",
          marginBottom: "16px",
        }}
      >
        {COLORS.map((c) => (
          <span
            key={c}
            style={{
              width: "20px",
              height: "20px",
              borderRadius: "50%",
              backgroundColor: COLOR_MAP[c as MarkColor],
              boxShadow:
                c === 4 ? "0 0 0 2px " + C.panel + ", 0 0 0 4px " + C.text : "none",
              animation: c === 4 ? "stour-penpulse 2.2s infinite" : "none",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <span
          style={{
            ...pill,
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            animation: "stour-fadein 2.4s infinite",
          }}
        >
          <span
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              backgroundColor: COLOR_MAP[4 as MarkColor],
            }}
          />
          Covenant
        </span>
      </div>
    </div>
  );

  // Outline & Vault
  const compileDemo = (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <span
          style={{
            width: "13px",
            height: "13px",
            borderRadius: "50%",
            backgroundColor: COLOR_MAP[4 as MarkColor],
          }}
        />
        <span style={{ fontSize: "13px", fontWeight: 700, color: C.text, flex: 1 }}>
          Covenant
        </span>
        <span style={{ fontSize: "10.5px", color: C.muted }}>3 marks</span>
      </div>
      <div
        style={{
          fontFamily: SERIF,
          fontSize: "13px",
          fontStyle: "italic",
          color: C.muted,
          lineHeight: 1.5,
          marginBottom: "10px",
          animation: "stour-gather 0.5s ease both",
          animationDelay: "0.15s",
        }}
      >
        “These verses tie God's promises to our faithfulness…”
      </div>
      {[90, 70].map((w, i) => (
        <div
          key={i}
          style={{
            height: "9px",
            width: w + "%",
            borderRadius: "5px",
            backgroundColor: C.soft,
            marginBottom: "6px",
            animation: "stour-gather 0.5s ease both",
            animationDelay: 0.3 + i * 0.15 + "s",
          }}
        />
      ))}
    </div>
  );

  // More to discover — animated feature montage
  const featRow = (
    glyph: React.ReactNode,
    label: string,
    sub: string,
    delay: number
  ) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "10px 0",
        borderBottom: "1px solid " + C.border,
        animation: "stour-gather 0.5s ease both",
        animationDelay: delay + "s",
      }}
    >
      <div
        style={{
          width: "38px",
          height: "38px",
          borderRadius: "10px",
          backgroundColor: C.soft,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {glyph}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "13.5px", fontWeight: 700, color: C.text }}>
          {label}
        </div>
        <div style={{ fontSize: "12px", color: C.muted, lineHeight: 1.4 }}>
          {sub}
        </div>
      </div>
    </div>
  );

  const linkGlyph = (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#8b5cf6"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ animation: "stour-linkpulse 1.8s infinite" }}
    >
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  );
  const editGlyph = (
    <>
      <span
        style={{
          fontFamily: SERIF,
          fontSize: "14px",
          color: C.text,
          backgroundColor: HL,
          padding: "0 3px",
          borderRadius: "3px",
        }}
      >
        word
      </span>
      <span
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "30px",
          height: "30px",
          borderRadius: "50%",
          border: "2px solid #8b5cf6",
          animation: "stour-ripple 1.7s infinite",
        }}
      />
    </>
  );
  const undoGlyph = (
    <div style={{ display: "flex", gap: "4px", animation: "stour-undo 1.6s infinite" }}>
      <span
        style={{
          width: "9px",
          height: "9px",
          borderRadius: "50%",
          backgroundColor: DOT,
        }}
      />
      <span
        style={{
          width: "9px",
          height: "9px",
          borderRadius: "50%",
          backgroundColor: DOT,
        }}
      />
    </div>
  );
  const searchGlyph = (
    <span
      style={{
        fontSize: "19px",
        color: C.muted,
        animation: "stour-twinkle 1.8s infinite",
      }}
    >
      ⌕
    </span>
  );
  const shareGlyph = (
    <div
      style={{
        width: "16px",
        height: "20px",
        borderRadius: "3px",
        border: "1.5px solid #8b5cf6",
        animation: "stour-slideout 2.2s infinite",
      }}
    />
  );
  const comfortGlyph = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "1px",
        animation: "stour-twinkle 2s infinite",
      }}
    >
      <span style={{ fontSize: "11px", color: C.text }}>A</span>
      <span style={{ fontSize: "17px", color: C.text, fontWeight: 700 }}>A</span>
    </span>
  );

  const linkDemo = (
    <div style={panel}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          marginBottom: "10px",
        }}
      >
        <span
          style={{
            ...pill,
            fontFamily: SERIF,
            fontSize: "14px",
            animation: "stour-gather 0.5s ease both",
          }}
        >
          Matthew 5
        </span>
        <span
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            backgroundColor: C.soft,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {linkGlyph}
        </span>
        <span
          style={{
            ...pill,
            fontFamily: SERIF,
            fontSize: "14px",
            animation: "stour-gather 0.5s ease both",
            animationDelay: "0.12s",
          }}
        >
          3 Nephi 12
        </span>
      </div>
      <div style={{ position: "relative", height: "22px" }}>
        <div
          style={{
            position: "absolute",
            left: "12%",
            right: "12%",
            top: "10px",
            height: "3px",
            borderRadius: "2px",
            backgroundColor: "#8b5cf6",
            transformOrigin: "center",
            animation: "stour-linkbar 2.8s infinite",
          }}
        />
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: "1px",
            transform: "translateX(-50%)",
            backgroundColor: C.panel,
            padding: "0 8px",
            fontSize: "10.5px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "#8b5cf6",
            animation: "stour-fadein 2.8s infinite",
          }}
        >
          ONE STUDY
        </span>
      </div>
    </div>
  );

  const noteDemo = (
    <div
      style={{
        ...panel,
        perspective: "1000px",
        display: "flex",
        justifyContent: "center",
        paddingTop: "20px",
        paddingBottom: "20px",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "212px",
          height: "98px",
          transformStyle: "preserve-3d",
          WebkitTransformStyle: "preserve-3d",
          animation: "stour-flipcard 4.5s infinite",
        }}
      >
        {/* FRONT — a verse card */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            boxSizing: "border-box",
            borderRadius: "10px",
            border: "1px solid " + C.border,
            borderLeft: "3px solid #8b5cf6",
            backgroundColor: C.soft,
            padding: "10px 12px",
            textAlign: "left",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "6px",
            }}
          >
            <span style={{ fontSize: "11px", fontWeight: 700, color: C.text }}>
              Alma 32:21
            </span>
            <span
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: "3px",
                fontSize: "9.5px",
                fontWeight: 700,
                color: "#8b5cf6",
              }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                <path d="M5.5 6.5h5M5.5 9.5h3" />
              </svg>
              note
            </span>
          </div>
          <div style={{ fontFamily: SERIF, fontSize: "13px", lineHeight: 1.45, color: C.text }}>
            “faith is not to have a{" "}
            <span style={{ backgroundColor: HL, borderRadius: "3px", padding: "0 2px" }}>
              perfect knowledge
            </span>
            ”
          </div>
        </div>
        {/* BACK — the note */}
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
            backgroundColor: C.soft,
            padding: "10px 12px",
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          <span
            style={{
              fontSize: "9.5px",
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: C.muted,
            }}
          >
            NOTE · ALMA 32:21
          </span>
          <span
            style={{
              fontFamily: SERIF,
              fontSize: "12.5px",
              fontStyle: "italic",
              lineHeight: 1.45,
              color: C.text,
            }}
          >
            Faith grows as I act on it — like a seed I choose to plant.
          </span>
        </div>
      </div>
    </div>
  );

  const moreDemo = (
    <div style={{ marginBottom: "14px" }}>
      {featRow(
        editGlyph,
        "Fine-tune a mark",
        "Double-tap any mark to nudge its edges.",
        0.12
      )}
      {featRow(
        undoGlyph,
        "Undo in a tap",
        "Two-finger tap the page to undo your last mark.",
        0.19
      )}
      {featRow(
        searchGlyph,
        "Find anything",
        "Search scripture and your own marks — try “faith OR hope”.",
        0.26
      )}
      {featRow(
        shareGlyph,
        "Share as an image",
        "Turn any verse, or a whole study, into a card to share.",
        0.33
      )}
      {featRow(
        comfortGlyph,
        "Make it yours",
        "Set text size and a warm reading tone in Settings.",
        0.4
      )}
    </div>
  );

  // Sync
  const syncDemo = (
    <div
      style={{
        ...panel,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
      }}
    >
      <span style={pill}>This phone</span>
      <span style={{ color: C.muted, fontSize: "20px" }}>⇄</span>
      <span style={pill}>Google</span>
    </div>
  );

  const content = () => {
    switch (step) {
      case 0:
        return (
          <div style={{ textAlign: "center" }}>
            {monogram}
            {title("Welcome to Scribal")}
            {body(
              "A quiet place to read scripture and mark it with intention. This phone app is a stripped-down Scribal — built for studying and taking notes on the go."
            )}
          </div>
        );
      case 1:
        return (
          <div>
            {title("Marking is all touch")}
            {tapDemo}
            {swipeDemo}
            {scrollDemo}
          </div>
        );
      case 2:
        return (
          <div>
            {title("Arm a pen, name a theme")}
            {penDemo}
            {body(
              "Open the pen tray at the bottom, pick a color and a style — that's your pen. Tap or swipe to mark in it."
            )}
            {body(
              "Give each color a theme name (Covenant, Faith, Mercy…) so every mark carries meaning."
            )}
          </div>
        );
      case 3:
        return (
          <div>
            {title("Each chapter, its own study")}
            {compileDemo}
            {body(
              "Open Compile and this chapter's marks gather by theme — write a short synthesis for each."
            )}
            {body(
              "Every chapter is separate. Save one to your Vault as a single file; come back and add more anytime and it updates that same file."
            )}
          </div>
        );
      case 4:
        return (
          <div>
            {title("Link chapters into one study")}
            {linkDemo}
            {body(
              "Studying a theme across books? Open the link by the chapter name, pick another chapter, and Scribal takes you there — the two now read as one study."
            )}
            {body(
              "Open that link anytime to jump between the chapters, or unlink any one. Compile then gathers every linked chapter's marks together, by theme."
            )}
          </div>
        );
      case 5:
        return (
          <div>
            {title("Note your thoughts on a verse")}
            {noteDemo}
            {body(
              "In Compile, tap a verse to flip it over and write a private note — your own thinking, kept right with that verse."
            )}
            {body(
              "Verses with a note show a small flag, and notes save as you type. You can even include them when you share a verse card."
            )}
          </div>
        );
      case 6:
        return (
          <div>
            {title("More as you go")}
            {moreDemo}
            {body(
              "No need to memorize these — the full gesture guide opens right after this, and it's always in Settings."
            )}
          </div>
        );
      case 7:
        return (
          <div>
            {title("Sync, or keep it local")}
            {syncDemo}
            {body(
              "Sign in to keep your study in step with Scribal on your computer — or just use it here on your phone."
            )}
            {body(
              "Local works fully offline, and you can connect Google later in Settings. On a computer, Scribal opens into the full workbench: side-by-side study, every compile view, and the Vault."
            )}
          </div>
        );
      default:
        return null;
    }
  };

  const primaryBtn = (text: string, onClick: () => void) => (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        padding: "15px",
        borderRadius: "12px",
        border: "none",
        backgroundColor: C.text,
        color: C.bg,
        fontSize: "15px",
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {text}
    </button>
  );

  const ghostBtn = (text: string, onClick: () => void) => (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        padding: "14px",
        borderRadius: "12px",
        border: "1px solid " + C.border,
        backgroundColor: "transparent",
        color: C.text,
        fontSize: "14px",
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        marginTop: "10px",
      }}
    >
      {text}
    </button>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 5000,
        backgroundColor: C.bg,
        color: C.text,
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, -apple-system, sans-serif",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <style>{KEYFRAMES}</style>

      {/* top row: skip */}
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 14px" }}>
        {step < LAST && (
          <button
            onClick={() => setStep(LAST)}
            style={{
              background: "transparent",
              border: "none",
              color: C.muted,
              fontSize: "14px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Skip
          </button>
        )}
      </div>

      {/* body */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding: "8px 26px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div key={step} style={{ animation: "stour-rise 0.32s ease" }}>
          {content()}
        </div>
      </div>

      {/* progress dots */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "7px",
          padding: "8px 0 14px",
        }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <span
            key={i}
            style={{
              width: i === step ? "20px" : "7px",
              height: "7px",
              borderRadius: "999px",
              backgroundColor: i === step ? C.text : C.border,
              transition: "width 0.2s",
            }}
          />
        ))}
      </div>

      {/* nav */}
      <div style={{ padding: "0 24px 24px" }}>
        {step === 0 && primaryBtn("Take the quick tour", () => setStep(1))}
        {step === 0 && ghostBtn("Skip", () => setStep(LAST))}

        {step > 0 && step < LAST && (
          <>
            {primaryBtn("Next", () => setStep(step + 1))}
            {ghostBtn("Back", () => setStep(step - 1))}
          </>
        )}

        {step === LAST && (
          <>
            {primaryBtn(
              driveConfigured ? "Sync with Google" : "Google sync unavailable",
              () => {
                if (driveConfigured) onSync();
              }
            )}
            {ghostBtn("Use on this phone", onLocal)}
          </>
        )}
      </div>
    </div>
  );
}
