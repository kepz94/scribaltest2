// Registers the Scribal service worker and reports when a new version is
// ready, so the UI can offer a refresh.

export function registerServiceWorker(onUpdate?: () => void) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    const base = process.env.PUBLIC_URL || "";
    const swUrl = base + "/service-worker.js";
    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => {
        reg.onupdatefound = () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.onstatechange = () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller &&
              onUpdate
            ) {
              // A new version has been fetched while an old one is in control.
              onUpdate();
            }
          };
        };
      })
      .catch(() => {
        // Registration failures are non-fatal — the app still runs online.
      });
  });
}

// Used on non-phone (desktop) clients: the PWA/offline layer is mobile-only,
// so make sure no service worker or cache lingers and interferes with desktop.
export function unregisterServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {});
  if (typeof caches !== "undefined") {
    caches
      .keys()
      .then((keys) => keys.forEach((k) => caches.delete(k)))
      .catch(() => {});
  }
}
