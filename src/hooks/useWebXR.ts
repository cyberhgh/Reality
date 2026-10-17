"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Optional WebXR immersive-AR hit-test for devices that support it.
 * Falls back silently when unavailable (most mobile browsers today).
 */
export function useWebXR() {
  const [supported, setSupported] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const xr = (
      navigator as Navigator & {
        xr?: { isSessionSupported?: (m: string) => Promise<boolean> };
      }
    ).xr;
    if (!xr?.isSessionSupported) return;
    void xr
      .isSessionSupported("immersive-ar")
      .then((ok) => setSupported(Boolean(ok)))
      .catch(() => setSupported(false));
  }, []);

  const probeHitTest = useCallback(async () => {
    const xr = (
      navigator as Navigator & {
        xr?: {
          requestSession?: (
            mode: string,
            opts?: object,
          ) => Promise<{ end: () => Promise<void> }>;
        };
      }
    ).xr;

    if (!xr?.requestSession) {
      setMessage("WebXR AR is not available on this browser.");
      return null;
    }

    try {
      const session = await xr.requestSession("immersive-ar", {
        requiredFeatures: ["hit-test", "local-floor"],
      });
      setMessage(
        "WebXR session started — use the system AR view if prompted. Closing probe.",
      );
      // Probe only: end quickly so we don't trap the user in a blank session
      // until we build a full WebXR renderer.
      await session.end();
      return true;
    } catch (err) {
      setMessage(
        err instanceof Error
          ? err.message
          : "Could not start WebXR hit-test session.",
      );
      return null;
    }
  }, []);

  return { supported, message, probeHitTest };
}
