import { CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getScriptures, volumesProxy } from "../data/scripturesStore";
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
  // User-declared verse pairs, per lens: "this half connects to that half",
  // across any distance — verses, chapters, books. The system never invents a
  // thread; it only renders the ones the user tied.
  savedThreads?: Record<string, { a: string | string[]; b: string | string[] }[]>;
  onThreads?: (t: Record<string, { a: string | string[]; b: string | string[] }[]>) => void;
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

const vols = volumesProxy;
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
  // Threads for THIS lens, plus the arming state for connecting two halves:
  // tap Thread on one half, then tap a half on the other side.
  const allThreads = props.savedThreads || {};
  const threads = allThreads[lens] || [];
  // Threading is a SELECTION: toggle any number of halves on each side, then
  // "Create thread" in the floating bar ties them all into one pair. Old
  // single-ref threads still load (refsOf normalizes both shapes).
  const refsOf = (x: string | string[]): string[] =>
    Array.isArray(x) ? x : [x];
  const [threadSel, setThreadSel] = useState<{
    left: string[];
    right: string[];
  }>({ left: [], right: [] });
  const toggleThreadSel = (side: "left" | "right", reference: string) =>
    setThreadSel((p) => ({
      ...p,
      [side]: p[side].includes(reference)
        ? p[side].filter((r) => r !== reference)
        : [...p[side], reference],
    }));
  // The web's geometry: each card's box, measured relative to the web
  // container, so the SVG can draw the thread curves. Re-measured whenever the
  // data or viewport changes.
  const webRef = useRef<HTMLDivElement | null>(null);
  const cardEls = useRef(new Map<string, HTMLElement>());
  const [webPos, setWebPos] = useState<
    Record<string, { x: number; y: number; w: number; h: number }>
  >({});
  const webSig =
    lens + "|" + a + "|" + b + "|" + threads.length + "|" +
    marks.length + "|" + compileTabs.length;
  useEffect(() => {
    const measure = () => {
      const host = webRef.current;
      if (!host) return;
      const hostRect = host.getBoundingClientRect();
      const next: Record<string, { x: number; y: number; w: number; h: number }> = {};
      cardEls.current.forEach((el, k) => {
        const r = el.getBoundingClientRect();
        next[k] = {
          x: r.left - hostRect.left,
          y: r.top - hostRect.top,
          w: r.width,
          h: r.height,
        };
      });
      setWebPos(next);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [webSig]);

  // Scripture position of a ref within this compile (for column ordering).
  const orderKey = (reference: string): number => {
    const i = entries.findIndex((e) => e.reference === reference);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  // The FULL verse, with this role's marked spans styled in its color — so a
  // card reads as the verse itself, the user's emphasis lit within it.
  const fullVerse = (reference: string, color: MarkColor) => {
    const text = textByRef.get(reference) || "";
    const ms = marks
      .filter((m) => m.reference === reference && m.color === color)
      .slice()
      .sort((x, y) => x.startIndex - y.startIndex);
    const out: React.ReactNode[] = [];
    let at = 0;
    ms.forEach((m, i) => {
      const start = Math.max(at, Math.min(m.startIndex, text.length));
      const end = Math.max(start, Math.min(m.endIndex, text.length));
      if (start > at)
        out.push(<span key={"p" + i}>{text.slice(at, start)}</span>);
      if (end > start)
        out.push(
          <span
            key={"m" + i}
            style={{ color: COLOR_MAP[color], fontWeight: 700 }}
          >
            {text.slice(start, end)}
          </span>
        );
      at = Math.max(at, end);
    });
    if (at < text.length) out.push(<span key="tail">{text.slice(at)}</span>);
    return out;
  };

  const addThread = (leftRefs: string[], rightRefs: string[]) => {
    props.onThreads?.({
      ...allThreads,
      [lens]: [...threads, { a: leftRefs, b: rightRefs }],
    });
    setThreadSel({ left: [], right: [] });
  };
  const removeThread = (i: number) => {
    props.onThreads?.({
      ...allThreads,
      [lens]: threads.filter((_, k) => k !== i),
    });
  };
  const rows: Row[] = [];
  const halfAll: Half[] = [];
  if (!sameColor) {
    entries.forEach((e) => {
      const lf = fragmentsForRole(e.reference, e.text, a);
      const rf = fragmentsForRole(e.reference, e.text, b);
      if (lf.length && rf.length)
        rows.push({ reference: e.reference, left: lf, right: rf });
      else if (lf.length)
        halfAll.push({ reference: e.reference, side: "left", frags: lf });
      else if (rf.length)
        halfAll.push({ reference: e.reference, side: "right", frags: rf });
    });
  }

  // Render-ready threads: fragments come from the live marks, so a thread
  // whose marking was erased simply drops out (and returns if re-marked).
  const textByRef = new Map<string, string>();
  entries.forEach((e) => textByRef.set(e.reference, e.text));
  type ThreadRow = {
    idx: number;
    aRefs: string[];
    bRefs: string[];
    left: Frag[];
    right: Frag[];
  };
  const sideFrags = (refs: string[], color: MarkColor): Frag[] => {
    const out: Frag[] = [];
    refs.forEach((r) => {
      const fr = fragmentsForRole(r, textByRef.get(r) || "", color);
      fr.forEach((f, i) => {
        // A gap marker opens each subsequent verse's fragments, so multi-verse
        // sides read as distinct pieces, not one run-on sentence.
        out.push(i === 0 && out.length > 0 ? { ...f, gapBefore: true } : f);
      });
    });
    return out;
  };
  const threadRows: ThreadRow[] = [];
  // Refs already living inside a thread (per side) — they leave the waiting
  // list below, so a threaded half can't be threaded twice.
  const threadedLeft = new Set<string>();
  const threadedRight = new Set<string>();
  if (!sameColor)
    threads.forEach((t, idx) => {
      const aRefs = refsOf(t.a);
      const bRefs = refsOf(t.b);
      aRefs.forEach((r) => threadedLeft.add(r));
      bRefs.forEach((r) => threadedRight.add(r));
      const left = sideFrags(aRefs, a);
      const right = sideFrags(bRefs, b);
      if (left.length && right.length)
        threadRows.push({ idx, aRefs, bRefs, left, right });
    });



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

      {compileTabs.length > 0 && !sameColor && rows.length === 0 && halfAll.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "36px 20px",
            color: "var(--muted)",
            lineHeight: 1.8,
          }}
        >
          <div style={{ marginBottom: "8px" }}>Nothing paired yet.</div>
          <div style={{ fontSize: "13.5px" }}>
            Mark one side {dot(a)} and the other {dot(b)} in the same verse, and
            the pair appears here. {cfg.caveat}
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


      {/* THE WEB — the two roles as facing columns, threads drawn as real
          curves converging at a tappable junction. Loose halves are dashed
          cards; tap one on each side and Create thread ties them. The system
          draws only what the user connected. */}
      {(halfAll.length > 0 || threadRows.length > 0 || rows.length > 0) && (
        <div style={{ marginTop: "26px" }}>
          <div
            style={{
              fontSize: "11px",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 700,
              marginBottom: "4px",
            }}
          >
            The web
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--muted)",
              marginBottom: "12px",
            }}
          >
            Tap a card on each side, then Create thread. Tap a thread's knot to
            untie it.
          </div>
          <div ref={webRef} style={{ position: "relative" }}>
            <div style={{ display: "flex", gap: "56px", alignItems: "flex-start" }}>
              {(["left", "right"] as const).map((side) => (
                <div
                  key={side}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: COLOR_MAP[(side === "left" ? a : b) as MarkColor],
                      textTransform: "uppercase",
                      letterSpacing: "1px",
                    }}
                  >
                    {side === "left" ? cfg.leftHeader : cfg.rightHeader}
                  </div>
                  {[
                    ...halfAll.filter((h) => h.side === side),
                    // Same-verse pairs live in the web too: the verse shows on
                    // BOTH sides, auto-bridged (the verse itself ties them).
                    ...rows.map((r) => ({
                      reference: r.reference,
                      side,
                      frags: side === "left" ? r.left : r.right,
                      inVerse: true as const,
                    })),
                  ]
                    .sort((x, y) => orderKey(x.reference) - orderKey(y.reference))
                    .map((h) => {
                      const inVerse = (h as { inVerse?: boolean }).inVerse === true;
                      const threaded =
                        inVerse ||
                        (side === "left"
                          ? threadedLeft.has(h.reference)
                          : threadedRight.has(h.reference));
                      const selected = threadSel[side].includes(h.reference);
                      const color = COLOR_MAP[
                        (side === "left" ? a : b) as MarkColor
                      ];
                      return (
                        <div
                          key={h.reference}
                          ref={(el) => {
                            const k = (side === "left" ? "L|" : "R|") + h.reference;
                            if (el) cardEls.current.set(k, el);
                            else cardEls.current.delete(k);
                          }}
                          onClick={() => {
                            if (threaded || !props.onThreads) return;
                            toggleThreadSel(side, h.reference);
                          }}
                          role="button"
                          title={
                            inVerse
                              ? "Related within the verse itself"
                              : threaded
                              ? "In a thread — tap its knot to untie"
                              : selected
                              ? "Tap to deselect"
                              : "Tap to select for a thread"
                          }
                          style={{
                            borderLeft:
                              side === "left"
                                ? "3px solid " + color
                                : "1px " +
                                  (threaded ? "solid" : "dashed") +
                                  " var(--border)",
                            borderRight:
                              side === "right"
                                ? "3px solid " + color
                                : "1px " +
                                  (threaded ? "solid" : "dashed") +
                                  " var(--border)",
                            borderTop:
                              "1px " +
                              (threaded ? "solid" : "dashed") +
                              " var(--border)",
                            borderBottom:
                              "1px " +
                              (threaded ? "solid" : "dashed") +
                              " var(--border)",
                            outline: selected
                              ? "2px solid var(--text)"
                              : undefined,
                            outlineOffset: selected ? 2 : undefined,
                            borderRadius: "12px",
                            background: "var(--panel)",
                            padding: "10px 11px",
                            cursor: threaded ? "default" : "pointer",
                          }}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onJumpToReference(h.reference);
                            }}
                            style={{
                              border: "none",
                              background: "transparent",
                              padding: 0,
                              marginBottom: "5px",
                              color: "var(--muted)",
                              fontSize: "11px",
                              fontWeight: 700,
                              cursor: "pointer",
                              textDecoration: "underline",
                              textDecorationStyle: "dotted",
                              fontFamily: "inherit",
                              display: "block",
                            }}
                          >
                            {h.reference}
                          </button>
                          <div
                            style={{
                              fontFamily: '"Times New Roman", Times, serif',
                              fontSize: "13.5px",
                              lineHeight: 1.55,
                              color: "var(--text)",
                            }}
                          >
                            {fullVerse(
                              h.reference,
                              (side === "left" ? a : b) as MarkColor
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
            {/* the threads: curves from each member to a shared knot */}
            <svg
              width="100%"
              height="100%"
              style={{
                position: "absolute",
                inset: 0,
                overflow: "visible",
                pointerEvents: "none",
              }}
            >
              {/* same-verse bridges: the verse itself ties these — a short
                  line with a solid dot (nothing to untie) */}
              {rows.map((r) => {
                const lp = webPos["L|" + r.reference];
                const rp = webPos["R|" + r.reference];
                if (!lp || !rp) return null;
                const sx = lp.x + lp.w;
                const sy = lp.y + lp.h / 2;
                const ex = rp.x;
                const ey = rp.y + rp.h / 2;
                return (
                  <g key={"bridge_" + r.reference}>
                    <path
                      d={
                        "M " + sx + " " + sy +
                        " C " + (sx + 20) + " " + sy + ", " +
                        (ex - 20) + " " + ey + ", " + ex + " " + ey
                      }
                      fill="none"
                      stroke="var(--muted)"
                      strokeWidth={1.6}
                      opacity={0.85}
                    />
                    <circle
                      cx={(sx + ex) / 2}
                      cy={(sy + ey) / 2}
                      r={4}
                      fill="var(--muted)"
                    />
                  </g>
                );
              })}
              {threadRows.map((tr) => {
                const pts: { x: number; y: number; from: "L" | "R" }[] = [];
                tr.aRefs.forEach((r) => {
                  const pos = webPos["L|" + r];
                  if (pos)
                    pts.push({ x: pos.x + pos.w, y: pos.y + pos.h / 2, from: "L" });
                });
                tr.bRefs.forEach((r) => {
                  const pos = webPos["R|" + r];
                  if (pos) pts.push({ x: pos.x, y: pos.y + pos.h / 2, from: "R" });
                });
                if (pts.length < 2) return null;
                const jx = pts.reduce((sum, p2) => sum + p2.x, 0) / pts.length;
                const jy = pts.reduce((sum, p2) => sum + p2.y, 0) / pts.length;
                return (
                  <g key={"web_" + tr.idx}>
                    {pts.map((p2, k) => (
                      <path
                        key={k}
                        d={
                          "M " + p2.x + " " + p2.y +
                          " C " + (p2.from === "L" ? p2.x + 26 : p2.x - 26) +
                          " " + p2.y + ", " +
                          (p2.from === "L" ? jx - 26 : jx + 26) + " " + jy +
                          ", " + jx + " " + jy
                        }
                        fill="none"
                        stroke="var(--muted)"
                        strokeWidth={1.6}
                        opacity={0.65}
                      />
                    ))}
                    <circle
                      cx={jx}
                      cy={jy}
                      r={10}
                      fill="var(--panel)"
                      stroke="var(--text)"
                      strokeWidth={1.6}
                      style={{ pointerEvents: "all", cursor: "pointer" }}
                      onClick={() => removeThread(tr.idx)}
                    >
                      <title>Untie this thread</title>
                    </circle>
                    <path
                      d={
                        "M " + (jx - 3.4) + " " + (jy - 3.4) +
                        " L " + (jx + 3.4) + " " + (jy + 3.4) +
                        " M " + (jx + 3.4) + " " + (jy - 3.4) +
                        " L " + (jx - 3.4) + " " + (jy + 3.4)
                      }
                      stroke="var(--muted)"
                      strokeWidth={1.4}
                      style={{ pointerEvents: "none" }}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {/* floating create-thread bar */}
      {threadSel.left.length + threadSel.right.length > 0 && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: "calc(18px + env(safe-area-inset-bottom))",
            transform: "translateX(-50%)",
            zIndex: 390,
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "999px",
            padding: "8px 10px 8px 16px",
            boxShadow: "0 14px 40px -12px rgba(0,0,0,.4)",
          }}
        >
          <span
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--text)",
              whiteSpace: "nowrap",
            }}
          >
            {threadSel.left.length} {cfg.leftHeader.toLowerCase()} ·{" "}
            {threadSel.right.length} {cfg.rightHeader.toLowerCase()}
          </span>
          <button
            onClick={() => setThreadSel({ left: [], right: [] })}
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--muted)",
              background: "transparent",
              border: "none",
              padding: "8px 6px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => addThread(threadSel.left, threadSel.right)}
            disabled={!threadSel.left.length || !threadSel.right.length}
            style={{
              fontSize: "13.5px",
              fontWeight: 700,
              color: "var(--panel)",
              background: "var(--text)",
              border: "none",
              borderRadius: "999px",
              padding: "9px 18px",
              opacity:
                threadSel.left.length && threadSel.right.length ? 1 : 0.45,
              cursor:
                threadSel.left.length && threadSel.right.length
                  ? "pointer"
                  : "default",
              fontFamily: "inherit",
            }}
          >
            Create thread
          </button>
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
