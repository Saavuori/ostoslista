"use client";

import { useEffect } from "react";

/**
 * Registers the service worker.
 *
 * Only in production: in development it would serve stale bundles and make
 * every change look like it did not apply.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration is an enhancement; the app works without it.
      });
    };

    // Registering during load competes with the page's own resources.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
