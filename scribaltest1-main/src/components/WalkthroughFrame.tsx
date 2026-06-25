interface WalkthroughFrameProps {
  label: string;
  caption: string;
  onSkip: () => void;
  onNext?: () => void;
  nextLabel?: string;
  children: React.ReactNode;
}

export default function WalkthroughFrame({
  label,
  caption,
  onSkip,
  onNext,
  nextLabel,
  children,
}: WalkthroughFrameProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 4500,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "560px",
          backgroundColor: "var(--panel)",
          color: "var(--text)",
          borderRadius: "18px",
          border: "1px solid var(--border)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            {label}
          </span>
          <button
            onClick={onSkip}
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Skip
          </button>
        </div>

        {/* Stage */}
        <div style={{ padding: "22px 22px 6px", minHeight: "252px" }}>
          {children}
        </div>

        {/* Caption + controls */}
        <div style={{ padding: "8px 22px 22px" }}>
          <p
            style={{
              fontSize: "14px",
              lineHeight: 1.55,
              color: "var(--muted)",
              minHeight: "62px",
              margin: "0 0 14px 0",
            }}
          >
            {caption}
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <button
              onClick={onSkip}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                fontSize: "13px",
                padding: 0,
              }}
            >
              Skip the tour
            </button>
            {onNext && (
              <button
                onClick={onNext}
                style={{
                  backgroundColor: "#8b5cf6",
                  color: "#fff",
                  border: "none",
                  borderRadius: "9px",
                  padding: "10px 22px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {nextLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
