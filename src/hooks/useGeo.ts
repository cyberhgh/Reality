"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type GeoState = {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  heading: number | null;
  hasCompass: boolean;
  quality: "searching" | "poor" | "ok" | "good";
  samples: number;
  error: string | null;
  loading: boolean;
};

type Sample = { lat: number; lng: number; accuracy: number; t: number };

function headingFromOrientation(e: DeviceOrientationEvent): number | null {
  const webkit = (
    e as DeviceOrientationEvent & { webkitCompassHeading?: number }
  ).webkitCompassHeading;
  if (typeof webkit === "number" && !Number.isNaN(webkit)) {
    return webkit;
  }
  if (typeof e.alpha === "number" && !Number.isNaN(e.alpha)) {
    return (360 - e.alpha) % 360;
  }
  return null;
}

function qualityFromAccuracy(accuracy: number | null): GeoState["quality"] {
  if (accuracy == null) return "searching";
  if (accuracy <= 12) return "good";
  if (accuracy <= 30) return "ok";
  return "poor";
}

/** Inverse-accuracy weighted average of recent samples. */
function blend(samples: Sample[]): { lat: number; lng: number; accuracy: number } {
  let wLat = 0;
  let wLng = 0;
  let wSum = 0;
  let bestAcc = Infinity;
  for (const s of samples) {
    const w = 1 / Math.max(s.accuracy, 3);
    wLat += s.lat * w;
    wLng += s.lng * w;
    wSum += w;
    bestAcc = Math.min(bestAcc, s.accuracy);
  }
  return {
    lat: wLat / wSum,
    lng: wLng / wSum,
    accuracy: bestAcc,
  };
}

export function useGeo() {
  const [state, setState] = useState<GeoState>({
    lat: null,
    lng: null,
    accuracy: null,
    heading: null,
    hasCompass: false,
    quality: "searching",
    samples: 0,
    error: null,
    loading: true,
  });
  const samplesRef = useRef<Sample[]>([]);

  const applyPosition = useCallback((pos: GeolocationPosition) => {
    const accuracy = pos.coords.accuracy;
    const now = Date.now();

    // Ignore clearly useless fixes (indoors / cold start spikes).
    if (!Number.isFinite(accuracy) || accuracy > 250) {
      setState((prev) => ({
        ...prev,
        loading: false,
        quality: "poor",
        error:
          prev.lat == null
            ? "Waiting for a clearer GPS fix — step outside if you can."
            : prev.error,
      }));
      return;
    }

    const nextSample: Sample = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy,
      t: now,
    };

    // Keep recent samples; drop old ones and worse outliers.
    const kept = samplesRef.current
      .filter((s) => now - s.t < 15000)
      .filter((s) => s.accuracy <= accuracy * 2.5 + 15);
    kept.push(nextSample);
    kept.sort((a, b) => a.accuracy - b.accuracy);
    samplesRef.current = kept.slice(0, 8);

    const blended = blend(samplesRef.current);

    setState((prev) => ({
      ...prev,
      lat: blended.lat,
      lng: blended.lng,
      accuracy: blended.accuracy,
      samples: samplesRef.current.length,
      quality: qualityFromAccuracy(blended.accuracy),
      heading:
        pos.coords.heading != null &&
        !Number.isNaN(pos.coords.heading) &&
        pos.coords.speed != null &&
        pos.coords.speed > 0.8
          ? pos.coords.heading
          : prev.heading,
      error:
        blended.accuracy > 40
          ? "GPS is coarse right now — move outdoors and hold still a few seconds."
          : null,
      loading: false,
    }));
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setState((s) => ({
        ...s,
        loading: false,
        error: "Geolocation is not supported on this device/browser.",
      }));
      return;
    }

    // Kick a fresh high-accuracy read, then watch continuously.
    navigator.geolocation.getCurrentPosition(applyPosition, () => undefined, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    });

    const watchId = navigator.geolocation.watchPosition(
      applyPosition,
      (err) => {
        setState((s) => ({
          ...s,
          loading: false,
          error: err.message || "Location permission denied.",
        }));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );

    const onOrient = (e: DeviceOrientationEvent) => {
      const heading = headingFromOrientation(e);
      if (heading == null) return;
      setState((s) => ({ ...s, heading, hasCompass: true }));
    };

    window.addEventListener("deviceorientation", onOrient, true);
    window.addEventListener(
      "deviceorientationabsolute" as keyof WindowEventMap,
      onOrient as EventListener,
      true,
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.removeEventListener("deviceorientation", onOrient, true);
      window.removeEventListener(
        "deviceorientationabsolute" as keyof WindowEventMap,
        onOrient as EventListener,
        true,
      );
    };
  }, [applyPosition]);

  const requestOrientationPermission = useCallback(async () => {
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (typeof DOE.requestPermission === "function") {
      try {
        const result = await DOE.requestPermission();
        if (result !== "granted") {
          setState((s) => ({
            ...s,
            error:
              "Motion/compass permission denied. Enable it for turn guidance.",
          }));
        }
      } catch {
        setState((s) => ({
          ...s,
          error: "Could not enable compass on this browser.",
        }));
      }
    }
  }, []);

  return { ...state, requestOrientationPermission };
}
