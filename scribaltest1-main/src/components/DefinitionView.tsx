// Shared 1828 definition view. Rendered identically on mobile and desktop;
// only the `colors` palette differs per shell (mobile passes its hex palette,
// desktop passes an object of CSS-var strings). The container (bottom sheet on
// mobile, popover on desktop) is provided by the caller — this is just the
// inner content. The Tag toggle is shown only when onToggleTag is supplied
// (Phase B); Phase A renders the lookup read-only.

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
}

export default function DefinitionView({
  word,
  result,
  colors,
  tagged,
  onToggleTag,
}: DefinitionViewProps) {
  const display = word ? word.charAt(0).toUpperCase() + word.slice(1) : "";
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

      {result ? (
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
          {tagged ? "\u2713 Tagged" : "Tag this word"}
        </button>
      )}
    </div>
  );
}
