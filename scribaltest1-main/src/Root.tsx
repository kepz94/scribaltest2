import { useEffect, useState } from "react";
import App from "./App";
import MobileApp from "./MobileApp";
import InstallGate from "./components/InstallGate";
import RoomViewer from "./components/RoomViewer";
import {
  useIsNarrow,
  useIsStandalone,
  useIsCoarsePointer,
} from "./pwa/usePlatform";
import { registerServiceWorker, unregisterServiceWorker } from "./pwa/registerSW";
import { loadScriptures, scripturesReady } from "./data/scripturesStore";

export default function Root() {
  const narrow = useIsNarrow();
  const coarse = useIsCoarsePointer();
  const standalone = useIsStandalone();
  const [updateReady, setUpdateReady] = useState(false);
  // Scriptures load at runtime (they're no longer inside the JS bundle, so the
  // app itself opens fast). Everything gates on this; failure shows a retry.
  const [scriptState, setScriptState] = useState<"loading" | "ready" | "error">(
    scripturesReady() ? "ready" : "loading"
  );
  useEffect(() => {
    if (scriptState !== "loading") return;
    let alive = true;
    loadScriptures()
      .then(() => alive && setScriptState("ready"))
      .catch(() => alive && setScriptState("error"));
    return () => {
      alive = false;
    };
  }, [scriptState]);

  // A scanned present-room QR (?room=CODE) opens the follower page directly —
  // on ANY device, browser tab or not, with no install gate in the way.
  const roomCode = new URLSearchParams(window.location.search).get("room");

  // Phones only: a touch device on a narrow screen.
  const isPhone = narrow && coarse;

  useEffect(() => {
    // The PWA/offline layer is mobile-only. Register the service worker on
    // phones (so the app is installable and works offline); on desktop, make
    // sure no service worker or stale cache lingers.
    if (isPhone) registerServiceWorker(() => setUpdateReady(true));
    else unregisterServiceWorker();
  }, [isPhone]);

  if (scriptState !== "ready") {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "14px",
          background: "#f6f4ee",
          color: "#1d1c18",
          fontFamily: "Georgia, serif",
          padding: "24px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "26px", fontWeight: 700, letterSpacing: "0.5px" }}>
          Scribal
        </div>
        {scriptState === "loading" ? (
          <div style={{ fontSize: "14px", opacity: 0.65 }}>
            Opening the scriptures…
          </div>
        ) : (
          <>
            <div style={{ fontSize: "14px", opacity: 0.75, maxWidth: "320px", lineHeight: 1.5 }}>
              The scriptures couldn't load — check your connection and try
              again.
            </div>
            <button
              onClick={() => setScriptState("loading")}
              style={{
                fontFamily: "system-ui, sans-serif",
                fontSize: "14px",
                fontWeight: 600,
                border: "1.5px solid #1d1c18",
                background: "transparent",
                color: "#1d1c18",
                borderRadius: "999px",
                padding: "10px 24px",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </>
        )}
      </div>
    );
  }

  if (roomCode) return <RoomViewer code={roomCode.toUpperCase()} />;

  // In a browser tab → gate to install. Installed (standalone) → mobile app.
  const gated = isPhone && !standalone;

  return (
    <>
      {gated ? (
        <InstallGate />
      ) : isPhone && standalone ? (
        <MobileApp />
      ) : (
        <App />
      )}

      {updateReady && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: "16px",
            transform: "translateX(-50%)",
            zIndex: 6000,
            display: "flex",
            alignItems: "center",
            gap: "12px",
            backgroundColor: "#1d1c18",
            color: "#f6f4ee",
            borderRadius: "999px",
            padding: "8px 10px 8px 16px",
            fontSize: "13px",
            fontFamily: "system-ui, sans-serif",
            boxShadow: "0 8px 28px rgba(0,0,0,0.3)",
          }}
        >
          A new version is ready
          <button
            onClick={() => window.location.reload()}
            style={{
              backgroundColor: "#f6f4ee",
              color: "#1d1c18",
              border: "none",
              borderRadius: "999px",
              padding: "6px 14px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </div>
      )}
    </>
  );
}
