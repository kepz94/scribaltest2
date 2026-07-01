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

export default function Root() {
  const narrow = useIsNarrow();
  const coarse = useIsCoarsePointer();
  const standalone = useIsStandalone();
  const [updateReady, setUpdateReady] = useState(false);

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
