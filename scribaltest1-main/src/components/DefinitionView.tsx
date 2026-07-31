// Shared 1828 definition view. Rendered identically on mobile and desktop;
// only the `colors` palette differs per shell (mobile passes its hex palette,
// desktop passes an object of CSS-var strings). The container (bottom sheet on
// mobile, popover on desktop) is provided by the caller — this is just the
// inner content. The Tag toggle is shown only when onToggleTag is supplied
// (Phase B); Phase A renders the lookup read-only.

import { parseSenses } from "../webster";

export interface DefinitionColors {
  text: string;
  muted: string;
  border: string;
  soft: string;
  accent?: string;
}

interface DefinitionViewProps {
  word: string; // the word the user looked up (shown as the headword)
  result: { key: string; definition: string } | null;
  colors: DefinitionColors;
  tagged?: boolean;
  onToggleTag?: () => void;
  // Which numbered senses the reader wants carried into their study. Supplied
  // (with onPickSenses) turns the entry into a checkable list; omitted leaves
  // the panel exactly as it was — a plain read-only lookup.
  senses?: number[];
  onPickSenses?: (senses: number[]) => void;
}

export default function DefinitionView({
  word,
  result,
  colors,
  tagged,
  onToggleTag,
  senses,
  onPickSenses,
}: DefinitionViewProps) {
  const display = word ? word.charAt(0).toUpperCase() + word.slice(1) : "";
  // The picker only appears when the caller wants it AND the entry actually has
  // numbered senses to choose between — a single-sense word has nothing to pick.
  const parsed = result && onPickSenses ? parseSenses(result.definition) : null;
  const pickable = parsed && parsed.senses.length > 1 ? parsed : null;
  const chosen = senses || [];
  const toggleSense = (n: number) => {
    if (!onPickSenses) return;
    onPickSenses(
      chosen.includes(n)
        ? chosen.filter((x) => x !== n)
        : chosen.concat(n).sort((a, b) => a - b)
    );
  };
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "10px",
          marginBottom: "10px",
        }}
      >
        <span style={{ fontSize: "22px", fontWeight: 700, color: colors.text }}>
          {display}
        </span>
        <span
          style={{
            fontSize: "11px",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: colors.muted,
          }}
        >
          Webster's 1828
        </span>
      </div>

      {result && pickable ? (
        // The whole entry stays visible and in the dictionary's own order —
        // nothing hidden, nothing ranked. The reader ticks what belongs in this
        // study; the system never decides which sense is the relevant one.
        <div
          style={{
            maxHeight: "46vh",
            overflowY: "auto",
            paddingRight: "4px",
          }}
        >
          {pickable.header && (
            <div
              style={{
                whiteSpace: "pre-wrap",
                fontSize: "13.5px",
                fontStyle: "italic",
                lineHeight: 1.55,
                color: colors.muted,
                marginBottom: "10px",
              }}
            >
              {pickable.header}
            </div>
          )}
          {pickable.senses.map((s) => {
            const on = chosen.includes(s.n);
            return (
              <button
                key={s.n}
                onClick={() => toggleSense(s.n)}
                data-sense={s.n}
                aria-pressed={on}
                style={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "flex-start",
                  width: "100%",
                  textAlign: "left",
                  background: on ? colors.soft : "transparent",
                  border:
                    "1px solid " + (on ? colors.accent || colors.text : "transparent"),
                  borderRadius: "9px",
                  padding: "8px 9px",
                  marginBottom: "3px",
                  cursor: "pointer",
                  color: colors.text,
                  font: "inherit",
                  fontSize: "14.5px",
                  lineHeight: 1.55,
                }}
              >
                <span
                  style={{
                    width: "18px",
                    height: "18px",
                    borderRadius: "5px",
                    border: "2px solid " + (on ? colors.accent || colors.text : colors.border),
                    background: on ? colors.accent || colors.text : "transparent",
                    color: "#fff",
                    flexShrink: 0,
                    marginTop: "2px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "11px",
                  }}
                >
                  {on ? "✓" : ""}
                </span>
                <span style={{ flex: 1, whiteSpace: "pre-wrap" }}>{s.text}</span>
              </button>
            );
          })}
        </div>
      ) : result ? (
        <div
          style={{
            maxHeight: "46vh",
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            fontSize: "15px",
            lineHeight: 1.6,
            color: colors.text,
            paddingRight: "4px",
          }}
        >
          {result.definition}
        </div>
      ) : (
        <div style={{ fontSize: "15px", color: colors.muted, lineHeight: 1.6 }}>
          No 1828 entry for &ldquo;{word}&rdquo;. The 1828 dictionary doesn&rsquo;t
          include proper names and a few rare words.
        </div>
      )}

      {onToggleTag && result && (
        <button
          onClick={onToggleTag}
          style={{
            marginTop: "14px",
            width: "100%",
            padding: "12px",
            borderRadius: "12px",
            border: "1px solid " + colors.border,
            background: tagged ? colors.accent || colors.text : "transparent",
            color: tagged ? "#ffffff" : colors.text,
            fontSize: "15px",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {tagged
            ? chosen.length
              ? "\u2713 Tagged with " +
                chosen.length +
                (chosen.length === 1 ? " definition" : " definitions")
              : "\u2713 Tagged"
            : chosen.length
            ? "Tag with " +
              chosen.length +
              (chosen.length === 1 ? " definition" : " definitions")
            : "Tag this word"}
        </button>
      )}

      {pickable && (
        <div
          style={{
            marginTop: "9px",
            fontSize: "12px",
            color: colors.muted,
            textAlign: "center",
          }}
        >
          {chosen.length
            ? chosen.length + " of " + pickable.senses.length + " definitions carry into your study"
            : "Tick the definitions to carry into your study \u00b7 " +
              pickable.senses.length +
              " in this entry"}
        </div>
      )}
    </div>
  );
}
