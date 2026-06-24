import { CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import scriptures from "../data/scriptures.json";
import {
  Mark,
  MarkColor,
  MarkStyle,
  COLORS,
  COLOR_MAP,
  markStyleCSS,
} from "../types";
import { Tab } from "../types";
import {
  renderCovenantCard,
  canvasURL,
  shareCanvas,
  CovenantPairData,
} from "../shareCard";

interface CovenantsProps {
  tabs: Tab[];
  compileTabs: Tab[];
  compileSelection: string[];
  onToggleCompileTab: (id: string) => void;
  hideTabPicker?: boolean;
  marks: Mark[];
  colorLabels: Record<number, string>;
  setColorLabel: (color: MarkColor, label: string) => void;
  onJumpToReference: (reference: string) => void;
  shareSignal?: number;
  // This study's saved condition/promise roles (by lens), from the synced data
  // layer — so each study keeps its own pair and it travels across devices.
  savedRoles?: Record<string, { a: number; b: number }>;
  // Persist a role change for this study (the parent writes it to the synced
  // per-scope store).
  onRoles?: (roles: Record<string, { a: number; b: number }>) => void;
  // This study's saved relational lens (covenant/contrast/type/question), and a
  // setter to persist a change — so the lens you chose is what you reopen to.
  savedLens?: string;
  onLens?: (lens: string) => void;
}

type Lens = "covenant" | "contrast" | "type" | "question";

interface LensCfg {
  id: Lens;
  chip: string;
  label: string;
  intro: string;
  caveat: string;
  leftLabel: string;
  rightLabel: string;
  leftHeader: string;
  rightHeader: string;
  connector: string;
  cardHeading: string;
  defA: MarkColor;
  defB: MarkColor;
}

const LENSES: LensCfg[] = [
  {
    id: "covenant",
    chip: "Covenant",
    label: "Covenant Ledger",
    intro:
      "This lens tracks the conditional, covenantal relationships in scripture — the If → Then promises. Mark a condition and the promise it unlocks, and the pair appears here.",
    caveat:
      "Only passages with covenant language will have anything to pair, so this lens stays empty for the rest.",
    leftLabel: "Mark conditions",
    rightLabel: "Mark promises",
    leftHeader: "If",
    rightHeader: "Then",
    connector: "→",
    cardHeading: "Covenant Ledger",
    defA: 1,
    defB: 2,
  },
  {
    id: "contrast",
    chip: "Contrasts",
    label: "Contrasts",
    intro:
      "This lens sets opposites side by side — pride and humility, light and dark, life and death. Mark the two sides and they pair here.",
    caveat: "Only passages that hold a clear contrast will have anything to pair.",
    leftLabel: "Mark one side",
    rightLabel: "Mark the opposite",
    leftHeader: "This",
    rightHeader: "Opposite",
    connector: "↔",
    cardHeading: "Contrasts",
    defA: 1,
    defB: 5,
  },
  {
    id: "type",
    chip: "Type",
    label: "Type → Fulfillment",
    intro:
      "This lens links a symbol, or type, to what it points to — the brass serpent to Christ, the Liahona to the word. Mark the type and its fulfillment and they pair here.",
    caveat:
      "Only passages where a type and its fulfillment both appear will have anything to pair.",
    leftLabel: "Mark the type",
    rightLabel: "Mark the fulfillment",
    leftHeader: "Type",
    rightHeader: "Fulfillment",
    connector: "→",
    cardHeading: "Type → Fulfillment",
    defA: 6,
    defB: 4,
  },
  {
    id: "question",
    chip: "Q & A",
    label: "Question → Answer",
    intro:
      "This lens pairs a question with the answer the text gives it. Mark both and they line up here.",
    caveat: "Only passages with a question and its answer will have anything to pair.",
    leftLabel: "Mark the question",
    rightLabel: "Mark the answer",
    leftHeader: "Question",
    rightHeader: "Answer",
    connector: "→",
    cardHeading: "Question → Answer",
    defA: 3,
    defB: 5,
  },
];

const vols = scriptures.volumes;
// Legacy flat map = one global condition/promise pair. Read ONLY as the
// starting default for a study that has no roles of its own yet; the real
// per-study roles now live in the synced data layer (passed in via props).
const ROLES_KEY = "scribal_relational_roles";
const OLD_KEY = "scribal_covenant_roles";

function clampColor(x: unknown, d: MarkColor): MarkColor {
  return COLORS.indexOf(x as MarkColor) >= 0 ? (x as MarkColor) : d;
}

type RoleMap = Record<Lens, { a: MarkColor; b: MarkColor }>;

function defaultsRoleMap(): RoleMap {
  const out = {} as RoleMap;
  LENSES.forEach((l) => {
    out[l.id] = { a: l.defA, b: l.defB };
  });
  return out;
}

// The fallback pair for a study that hasn't set its own roles: the legacy
// global map, or the older key, or the per-lens defaults.
function readGlobalDefault(): RoleMap {
  const out = defaultsRoleMap();
  try {
    const raw = localStorage.getItem(ROLES_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      LENSES.forEach((l) => {
        if (p && p[l.id])
          out[l.id] = {
            a: clampColor(p[l.id].a, l.defA),
            b: clampColor(p[l.id].b, l.defB),
          };
      });
    } else {
      const old = localStorage.getItem(OLD_KEY);
      if (old) {
        const o = JSON.parse(old);
        out.covenant = {
          a: clampColor(o.condition, 1),
          b: clampColor(o.promise, 2),
        };
      }
    }
  } catch {
    // ignore malformed storage
  }
  return out;
}

// Starting roles for this study: its saved roles (synced) over the default.
function rolesFromSaved(
  saved?: Record<string, { a: number; b: number }>
): RoleMap {
  const out = readGlobalDefault();
  if (saved) {
    LENSES.forEach((l) => {
      const r = saved[l.id];
      if (r)
        out[l.id] = { a: clampColor(r.a, l.defA), b: clampColor(r.b, l.defB) };
    });
  }
  return out;
}

type Frag = {
  text: string;
  style: MarkStyle;
  color: MarkColor;
  gapBefore: boolean;
};

export default function Covenants(props: CovenantsProps) {
  const { compileTabs, marks, colorLabels, onJumpToReference } = props;
  const onRoles = props.onRoles;
  // Only the colors actually used in this study's compiled marks — so the role
  // pickers offer the themes that exist here, not all seven.
  const usedColors = COLORS.filter((c) => marks.some((m) => m.color === c));
  // The chapter list is collapsed by default for multi-chapter studies so it
  // doesn't swallow the screen; tap to reveal.
  const [showChapters, setShowChapters] = useState(false);

  const [lens, setLens] = useState<Lens>(() =>
    props.savedLens && LENSES.some((l) => l.id === props.savedLens)
      ? (props.savedLens as Lens)
      : "covenant"
  );
  // Seeded from THIS study's saved roles (synced data layer); falls back to the
  // default pair for a study that hasn't set its own. The parent remounts this
  // per study, so opening another study re-seeds from its roles.
  const [roles, setRoles] = useState<RoleMap>(() =>
    rolesFromSaved(props.savedRoles)
  );
  const cfg = LENSES.find((l) => l.id === lens) || LENSES[0];
  const a = roles[lens].a;
  const b = roles[lens].b;
  // Saving on change goes to the synced, per-study store via onRoles — so each
  // study keeps its own pair and it travels across devices.
  const setA = (c: MarkColor) => {
    const next: RoleMap = { ...roles, [lens]: { ...roles[lens], a: c } };
    setRoles(next);
    onRoles?.(next);
  };
  const setB = (c: MarkColor) => {
    const next: RoleMap = { ...roles, [lens]: { ...roles[lens], b: c } };
    setRoles(next);
    onRoles?.(next);
  };

  // The parent remounts this per study (key={scope}), so the useState above
  // normally seeds the right pair. But if this study's saved roles aren't ready
  // at that first mount — the synced data layer resolves a beat later, the active
  // book settles, or a remote device's pair arrives via sync — re-seed from them
  // so the relational lens fills in without the user re-picking. Guarded by a ref
  // and a truthiness check so a transient empty value never wipes a live pair.
  const savedSeedRef = useRef(props.savedRoles);
  useEffect(() => {
    if (props.savedRoles === savedSeedRef.current) return;
    savedSeedRef.current = props.savedRoles;
    if (props.savedRoles) setRoles(rolesFromSaved(props.savedRoles));
  }, [props.savedRoles]);

  // ----- share state: ONE sheet that does pick + preview + share together -----
  const [shareOpen, setShareOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [cardDark, setCardDark] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [shareMsg, setShareMsg] = useState("");
  // In-session curation of the two-column collect: which one-sided verses to
  // show. null = show all (default). Resets on reopen; this never touches the
  // synced data layer. (Persist a curated contrast via Save as a study.)
  const [curating, setCurating] = useState(false);
  const [picked, setPicked] = useState<string[] | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const openRef = useRef<() => void>(() => {});

  const externalTrigger = props.shareSignal !== undefined;
  useEffect(() => {
    if (props.shareSignal && props.shareSignal > 0) openRef.current();
  }, [props.shareSignal]);

  const tabLabel = (t: Tab) =>
    vols[t.volume].books[t.book].book +
    " " +
    vols[t.volume].books[t.book].chapters[t.chapter].chapter;

  type Entry = {
    reference: string;
    verse: number;
    text: string;
    v: number;
    b: number;
    c: number;
  };
  const entries: Entry[] = [];
  compileTabs.forEach((t) => {
    const book = vols[t.volume].books[t.book];
    const chapter = book.chapters[t.chapter];
    chapter.verses.forEach((vv) => {
      entries.push({
        reference: vv.reference,
        verse: vv.verse,
        text: vv.text,
        v: t.volume,
        b: t.book,
        c: t.chapter,
      });
    });
  });
  entries.sort(
    (a2, b2) => a2.v - b2.v || a2.b - b2.b || a2.c - b2.c || a2.verse - b2.verse
  );

  const fragmentsForRole = (
    reference: string,
    text: string,
    color: MarkColor
  ): Frag[] => {
    const ms = marks
      .filter((m) => m.reference === reference && m.color === color)
      .slice()
      .sort((x, y) => x.startIndex - y.startIndex || y.endIndex - x.endIndex);
    const frags: Frag[] = [];
    let covered = 0;
    ms.forEach((m) => {
      const start = Math.max(0, Math.min(m.startIndex, text.length));
      const end = Math.max(start, Math.min(m.endIndex, text.length));
      const from = Math.max(start, covered);
      if (end <= from) return;
      const piece = text.slice(from, end).replace(/\s+/g, " ").trim();
      const gapBefore = frags.length > 0 && start > covered;
      covered = end;
      if (!piece) return;
      frags.push({ text: piece, style: m.style, color: m.color, gapBefore });
    });
    return frags;
  };

  const sameColor = a === b;

  type Row = { reference: string; left: Frag[]; right: Frag[] };
  type Half = {
    reference: string;
    side: "left" | "right";
    frags: Frag[];
  };
  const rows: Row[] = [];
  const half: Half[] = [];
  if (!sameColor) {
    entries.forEach((e) => {
      const lf = fragmentsForRole(e.reference, e.text, a);
      const rf = fragmentsForRole(e.reference, e.text, b);
      if (lf.length && rf.length)
        rows.push({ reference: e.reference, left: lf, right: rf });
      else if (lf.length)
        half.push({ reference: e.reference, side: "left", frags: lf });
      else if (rf.length)
        half.push({ reference: e.reference, side: "right", frags: rf });
    });
  }

  // ----- in-session curation of the collect -----
  const allHalfRefs = half.map((h) => h.reference);
  const isPicked = (ref: string) => picked == null || picked.includes(ref);
  const pickedShownCount = picked
    ? picked.filter((r) => allHalfRefs.includes(r)).length
    : allHalfRefs.length;
  const togglePick = (ref: string) =>
    setPicked((prev) => {
      const base = prev == null ? allHalfRefs : prev;
      return base.includes(ref)
        ? base.filter((r) => r !== ref)
        : [...base, ref];
    });
  const startCurate = () => {
    if (picked == null) setPicked(allHalfRefs);
    setCurating(true);
  };
  const showAllCollect = () => {
    setPicked(null);
    setCurating(false);
  };

  const renderFrags = (frags: Frag[]) =>
    frags.map((f, i) => (
      <span key={i}>
        {f.gapBefore && (
          <span
            style={{
              color: "var(--muted)",
              margin: "0 5px",
              fontFamily: "system-ui, sans-serif",
              fontSize: "0.8em",
            }}
          >
            …
          </span>
        )}
        {i > 0 && !f.gapBefore && " "}
        <span style={markStyleCSS(f.style, f.color)}>{f.text}</span>
      </span>
    ));

  const swatch = (color: MarkColor, on: boolean, onClick: () => void) => (
    <button
      key={color}
      onClick={onClick}
      title={colorLabels[color] || "Color " + color}
      style={{
        width: "26px",
        height: "26px",
        borderRadius: "7px",
        background: COLOR_MAP[color],
        border: on ? "3px solid var(--text)" : "3px solid transparent",
        boxShadow: on ? "0 0 0 1px var(--border)" : "none",
        cursor: "pointer",
        padding: 0,
      }}
    />
  );

  const dot = (color: MarkColor) => (
    <span
      style={{
        display: "inline-block",
        width: "14px",
        height: "14px",
        borderRadius: "4px",
        background: COLOR_MAP[color],
        verticalAlign: "middle",
        margin: "0 2px",
      }}
    />
  );

  const card = (frags: Frag[], color: MarkColor) => (
    <div
      style={{
        flex: "1 1 240px",
        background: "var(--soft)",
        borderLeft: "3px solid " + COLOR_MAP[color],
        borderRadius: "8px",
        padding: "12px 14px",
        fontFamily: '"Times New Roman", Times, serif',
        fontSize: "16px",
        lineHeight: 1.7,
        color: "var(--text)",
      }}
    >
      {renderFrags(frags)}
    </div>
  );

  // ----- share helpers -----
  const rowKey = (r: Row, i: number) => r.reference + "_" + i;

  const fragsForCard = (frags: Frag[]) =>
    frags.map((f) => ({
      text: f.text,
      style: f.style,
      color: f.color,
      gapBefore: f.gapBefore,
    }));

  const chosenFromKeys = (keys: string[]): CovenantPairData[] => {
    const out: CovenantPairData[] = [];
    rows.forEach((r, i) => {
      if (keys.includes(rowKey(r, i)))
        out.push({
          reference: r.reference,
          ifFrags: fragsForCard(r.left),
          thenFrags: fragsForCard(r.right),
        });
    });
    return out;
  };

  const renderPreview = (keys: string[], dark: boolean) => {
    const canvas = renderCovenantCard({
      pairs: chosenFromKeys(keys),
      conditionColor: a,
      promiseColor: b,
      dark,
      heading: cfg.cardHeading,
    });
    previewCanvasRef.current = canvas;
    setPreviewUrl(canvasURL(canvas));
  };

  const openShare = () => {
    const keys = rows.slice(0, 3).map((r, i) => rowKey(r, i));
    setSelected(keys);
    setCardDark(true);
    setShareMsg("");
    renderPreview(keys, true);
    setShareOpen(true);
  };
  openRef.current = openShare;

  const toggleChip = (key: string) => {
    let next: string[];
    if (selected.includes(key)) next = selected.filter((k) => k !== key);
    else if (selected.length >= 3) return;
    else next = [...selected, key];
    setSelected(next);
    renderPreview(next, cardDark);
  };

  const toggleDark = () => {
    const d = !cardDark;
    setCardDark(d);
    renderPreview(selected, d);
  };

  const doShare = async () => {
    const canvas = previewCanvasRef.current;
    if (!canvas || sharing || selected.length === 0) return;
    setSharing(true);
    setShareMsg("Preparing…");
    const res = await shareCanvas(
      canvas,
      "scribal-" + lens + ".png",
      cfg.label + " · Scribal"
    );
    setSharing(false);
    setShareMsg(
      res === "shared"
        ? "Shared."
        : res === "downloaded"
        ? "Saved to your device."
        : res === "cancelled"
        ? ""
        : "Couldn't share — try again."
    );
  };

  const closeShare = () => {
    setShareOpen(false);
    setPreviewUrl("");
    previewCanvasRef.current = null;
    setShareMsg("");
  };

  const shareBtnStyle: CSSProperties = {
    border: "1px solid var(--border)",
    background: "var(--soft)",
    color: "var(--text)",
    fontSize: "12.5px",
    fontWeight: 600,
    padding: "8px 14px",
    borderRadius: "9px",
    cursor: "pointer",
    fontFamily: "inherit",
  };
  const solidBtn: CSSProperties = {
    flex: 1,
    border: "none",
    background: "#ffffff",
    color: "#111111",
    fontSize: "13px",
    fontWeight: 700,
    padding: "12px 18px",
    borderRadius: "10px",
    cursor: "pointer",
    fontFamily: "inherit",
  };
  const ghostBtn: CSSProperties = {
    border: "1px solid rgba(255,255,255,0.5)",
    background: "transparent",
    color: "#ffffff",
    fontSize: "13px",
    fontWeight: 600,
    padding: "12px 14px",
    borderRadius: "10px",
    cursor: "pointer",
    fontFamily: "inherit",
  };

  const roleRow = (labelText: string, color: MarkColor, set: (c: MarkColor) => void) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: "12.5px",
          fontWeight: 600,
          width: "132px",
          color: "var(--text)",
        }}
      >
        {labelText}
      </span>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {COLORS.filter((c) => usedColors.includes(c) || c === color).map((c) =>
          swatch(c, c === color, () => set(c))
        )}
      </div>
    </div>
  );

  return (
    <div
      style={{ padding: "20px 20px 90px", maxWidth: "820px", margin: "0 auto" }}
    >
      <div
        style={{
          fontSize: "11px",
          letterSpacing: "2px",
          textTransform: "uppercase",
          color: "var(--muted)",
          fontWeight: 700,
          marginBottom: "6px",
        }}
      >
        Relational
      </div>
      {compileTabs.length === 0 ? (
        <h2 style={{ margin: "0 0 12px 0", fontWeight: 500 }}>
          Nothing selected
        </h2>
      ) : compileTabs.length <= 1 ? (
        <h2 style={{ margin: "0 0 12px 0", fontWeight: 500 }}>
          {compileTabs.map(tabLabel).join("  ·  ")}
        </h2>
      ) : null}

      <div
        style={{
          display: "flex",
          gap: "6px",
          marginBottom: "16px",
        }}
      >
        {LENSES.map((l) => (
          <button
            key={l.id}
            onClick={() => {
              setLens(l.id);
              props.onLens?.(l.id);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: "center",
              whiteSpace: "nowrap",
              border:
                "1px solid " + (l.id === lens ? "var(--text)" : "var(--border)"),
              background: l.id === lens ? "var(--text)" : "transparent",
              color: l.id === lens ? "var(--panel)" : "var(--muted)",
              fontSize: "12px",
              fontWeight: 600,
              padding: "7px 4px",
              borderRadius: "999px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {l.chip}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          padding: "14px 16px",
          background: "var(--soft)",
          borderRadius: "12px",
          marginBottom: "24px",
        }}
      >
        {roleRow(cfg.leftLabel, a, setA)}
        {roleRow(cfg.rightLabel, b, setB)}
      </div>

      {compileTabs.length === 0 && (
        <p style={{ color: "var(--muted)", textAlign: "center", padding: "40px" }}>
          Select at least one chapter.
        </p>
      )}

      {compileTabs.length > 0 && sameColor && (
        <p
          style={{
            color: "var(--muted)",
            textAlign: "center",
            padding: "30px 20px",
          }}
        >
          Choose two <em>different</em> colors for the two sides.
        </p>
      )}

      {compileTabs.length > 0 && !sameColor && rows.length === 0 && half.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "36px 20px",
            color: "var(--muted)",
            lineHeight: 1.8,
          }}
        >
          <div style={{ marginBottom: "8px" }}>Nothing marked yet.</div>
          <div style={{ fontSize: "13.5px" }}>
            Mark one side {dot(a)} and the other {dot(b)} — together in a verse
            to pair them, or in separate verses to line them up side by side.
          </div>
        </div>
      )}

      {rows.length > 0 && !externalTrigger && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: "10px",
          }}
        >
          <button onClick={openShare} style={shareBtnStyle}>
            Share image
          </button>
        </div>
      )}

      {rows.length > 0 && (
        <div>
          <div
            style={{
              display: "flex",
              gap: "12px",
              alignItems: "center",
              padding: "0 4px 8px",
              fontSize: "11px",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 700,
            }}
          >
            <div style={{ flex: 1 }}>{cfg.leftHeader}</div>
            <div style={{ width: "22px" }} />
            <div style={{ flex: 1 }}>{cfg.rightHeader}</div>
            <div style={{ width: "64px" }} />
          </div>
          {rows.map((r, i) => (
            <div
              key={rowKey(r, i)}
              data-vref={r.reference}
              style={{
                display: "flex",
                gap: "12px",
                alignItems: "stretch",
                marginBottom: "10px",
                flexWrap: "wrap",
              }}
            >
              {card(r.left, a)}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "22px",
                  color: "var(--muted)",
                  fontSize: "18px",
                }}
              >
                {cfg.connector}
              </div>
              {card(r.right, b)}
              <button
                onClick={() => onJumpToReference(r.reference)}
                title="Open in reading view"
                style={{
                  width: "64px",
                  border: "none",
                  background: "transparent",
                  color: "var(--muted)",
                  fontSize: "11px",
                  cursor: "pointer",
                  textDecoration: "underline",
                  textDecorationStyle: "dotted",
                  padding: 0,
                  alignSelf: "center",
                  fontFamily: "inherit",
                }}
              >
                {r.reference}
              </button>
            </div>
          ))}
        </div>
      )}

      {half.length > 0 && (
        <div style={{ marginTop: "26px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: "10px",
              marginBottom: "10px",
            }}
          >
            {picked != null && !curating && (
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                Showing {pickedShownCount} of {allHalfRefs.length}
              </span>
            )}
            {curating ? (
              <button
                onClick={() => setCurating(false)}
                style={{
                  padding: "6px 14px",
                  borderRadius: "999px",
                  border: "none",
                  background: "#0d9488",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  fontFamily: "inherit",
                }}
              >
                Done
              </button>
            ) : (
              <button
                onClick={startCurate}
                style={{
                  padding: "6px 12px",
                  borderRadius: "999px",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text)",
                  cursor: "pointer",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  fontFamily: "inherit",
                }}
              >
                Pick verses
              </button>
            )}
            {picked != null && (
              <button
                onClick={showAllCollect}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  color: "var(--muted)",
                  fontSize: "12px",
                  fontFamily: "inherit",
                  textDecoration: "underline",
                  textDecorationStyle: "dotted",
                }}
              >
                Show all
              </button>
            )}
          </div>
          <div
            style={{
              display: "flex",
              gap: "12px",
              padding: "0 4px 8px",
              fontSize: "11px",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 700,
            }}
          >
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {dot(a)}
              {cfg.leftHeader}
            </div>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {dot(b)}
              {cfg.rightHeader}
            </div>
          </div>
          <div
            style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}
          >
            {[
              { side: "left" as "left" | "right", color: a },
              { side: "right" as "left" | "right", color: b },
            ].map((col) => {
              const sideAll = half.filter((h) => h.side === col.side);
              const items = curating
                ? sideAll
                : sideAll.filter((h) => isPicked(h.reference));
              return (
                <div
                  key={col.side}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  {items.length === 0 ? (
                    <div
                      style={{
                        color: "var(--muted)",
                        fontSize: "12.5px",
                        fontStyle: "italic",
                        padding: "6px 2px",
                      }}
                    >
                      {sideAll.length === 0 ? "None marked." : "None picked."}
                    </div>
                  ) : (
                    items.map((h, i) => {
                      const on = isPicked(h.reference);
                      return (
                        <div
                          key={h.reference + "_" + col.side + "_" + i}
                          data-vref={h.reference}
                          onClick={
                            curating
                              ? () => togglePick(h.reference)
                              : undefined
                          }
                          style={{
                            background: "var(--soft)",
                            borderLeft: "3px solid " + COLOR_MAP[col.color],
                            borderRadius: "8px",
                            padding: "10px 12px",
                            cursor: curating ? "pointer" : "default",
                            opacity: curating && !on ? 0.45 : 1,
                            outline:
                              curating && on
                                ? "2px solid " + COLOR_MAP[col.color]
                                : "none",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            {curating && (
                              <span
                                style={{
                                  width: "16px",
                                  height: "16px",
                                  borderRadius: "4px",
                                  flexShrink: 0,
                                  border:
                                    "2px solid " +
                                    (on
                                      ? COLOR_MAP[col.color]
                                      : "var(--border)"),
                                  background: on
                                    ? COLOR_MAP[col.color]
                                    : "transparent",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#fff",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                }}
                              >
                                {on ? "\u2713" : ""}
                              </span>
                            )}
                            {curating ? (
                              <span
                                style={{
                                  color: "var(--muted)",
                                  fontSize: "11px",
                                }}
                              >
                                {h.reference}
                              </span>
                            ) : (
                              <button
                                onClick={() => onJumpToReference(h.reference)}
                                title="Open in reading view"
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  color: "var(--muted)",
                                  cursor: "pointer",
                                  textDecoration: "underline",
                                  textDecorationStyle: "dotted",
                                  padding: 0,
                                  fontSize: "11px",
                                  fontFamily: "inherit",
                                }}
                              >
                                {h.reference}
                              </button>
                            )}
                          </div>
                          <div
                            style={{
                              fontFamily: '"Times New Roman", Times, serif',
                              fontSize: "15px",
                              lineHeight: 1.6,
                              color: "var(--text)",
                              marginTop: "4px",
                              overflowWrap: "break-word",
                            }}
                          >
                            {renderFrags(h.frags)}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {compileTabs.length > 1 && (
        <div style={{ marginTop: "28px" }}>
          <button
            onClick={() => setShowChapters((s) => !s)}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: "inherit",
              color: "var(--muted)",
              fontSize: "13px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {compileTabs.length + " chapters in this study"}
            <span style={{ fontSize: "10px" }}>{showChapters ? "▲" : "▾"}</span>
          </button>
          {showChapters && (
            <div
              style={{
                marginTop: "8px",
                fontSize: "13px",
                lineHeight: 1.5,
                color: "var(--muted)",
              }}
            >
              {compileTabs.map(tabLabel).join("  ·  ")}
            </div>
          )}
        </div>
      )}

      <p
        style={{
          fontSize: "12.5px",
          color: "var(--muted)",
          marginTop: "28px",
          marginBottom: "12px",
          lineHeight: 1.55,
        }}
      >
        {cfg.intro}
      </p>
      <p
        style={{
          fontSize: "11.5px",
          fontStyle: "italic",
          color: "var(--muted)",
          marginBottom: "8px",
          lineHeight: 1.5,
          opacity: 0.85,
        }}
      >
        {cfg.caveat}
      </p>

      {shareOpen &&
        createPortal(
          <div
            onClick={closeShare}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 2000000000,
              background: "rgba(0,0,0,0.92)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding:
                "calc(env(safe-area-inset-top) + 12px) 14px calc(env(safe-area-inset-bottom) + 12px)",
            }}
          >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "600px",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              background: "#1d1c19",
              borderRadius: "16px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                flexShrink: 0,
                padding: "14px 16px 10px",
                color: "#e7e2d6",
                fontSize: "13px",
                fontWeight: 700,
                textAlign: "center",
              }}
            >
              Share{" "}
              <span style={{ color: "#8d8a82", fontWeight: 500 }}>
                · {selected.length}/3 pairs selected
              </span>
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 16px",
                overflow: "hidden",
                background: "#121110",
              }}
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Share card"
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                    borderRadius: "10px",
                  }}
                />
              ) : (
                <div style={{ color: "#8d8a82", fontSize: "13px", padding: "40px" }}>
                  Pick a pair below to build the card.
                </div>
              )}
            </div>

            <div
              style={{
                flexShrink: 0,
                padding: "12px 14px calc(12px + env(safe-area-inset-bottom))",
                borderTop: "1px solid #343229",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                  justifyContent: "center",
                  maxHeight: "26vh",
                  overflowY: "auto",
                  paddingBottom: "2px",
                }}
              >
                {rows.map((r, i) => {
                  const key = rowKey(r, i);
                  const sel = selected.includes(key);
                  const idx = selected.indexOf(key);
                  const full = !sel && selected.length >= 3;
                  return (
                    <button
                      key={key}
                      onClick={() => toggleChip(key)}
                      style={{
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                        padding: "10px 16px",
                        borderRadius: "999px",
                        fontSize: "14px",
                        fontWeight: 600,
                        cursor: full ? "default" : "pointer",
                        fontFamily: "inherit",
                        border: sel
                          ? "1px solid #ffffff"
                          : "1px solid rgba(255,255,255,0.32)",
                        background: sel ? "#ffffff" : "transparent",
                        color: sel ? "#111111" : "#e7e2d6",
                        opacity: full ? 0.4 : 1,
                      }}
                    >
                      {sel ? idx + 1 + ". " : ""}
                      {r.reference}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <button onClick={toggleDark} style={ghostBtn}>
                  {cardDark ? "Light" : "Dark"}
                </button>
                <button
                  onClick={doShare}
                  disabled={sharing || selected.length === 0}
                  style={{
                    ...solidBtn,
                    opacity: sharing || selected.length === 0 ? 0.55 : 1,
                  }}
                >
                  {sharing ? "Preparing…" : "Share / Save"}
                </button>
                <button onClick={closeShare} style={ghostBtn}>
                  Close
                </button>
              </div>

              {shareMsg ? (
                <div
                  style={{
                    color: "#ffffff",
                    fontSize: "12.5px",
                    opacity: 0.9,
                    textAlign: "center",
                  }}
                >
                  {shareMsg}
                </div>
              ) : null}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
