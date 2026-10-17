"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { offsetLatLng } from "@/lib/geo";

export type GeoState = {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  heading: number | null;
  hasCompass: boolean;
  quality: "searching" | "poor" | "ok" | "good";
  samples: number;
  /** True when position is refined by step dead-reckoning since last GPS */
  usingDeadReckoning: boolean;
  altitude: number | null;
  error: string | null;
  loading: boolean;
};

type Sample = { lat: number; lng: number; accuracy: number; t: number };

function headingFromOrientation(e: DeviceOrientationEvent): number | null {
  const webkit = (
    e as DeviceOrientationEvent & { webkitCompassHeading?: number }
  ).webkitCompassHeading;
  if (typeof webkit === "number" && !Number.isNaN(webkit)) return webkit;
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

function blend(samples: Sample[]) {
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
  return { lat: wLat / wSum, lng: wLng / wSum, accuracy: bestAcc };
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
    usingDeadReckoning: false,
    altitude: null,
    error: null,
    loading: true,
  });
  const samplesRef = useRef<Sample[]>([]);
  const headingRef = useRef<number | null>(null);
  const lastStepAt = useRef(0);
  const lastAccel = useRef(0);
  const drOffset = useRef({ north: 0, east: 0 });
  const gpsAnchor = useRef<{ lat: number; lng: number; accuracy: number } | null>(
    null,
  );

  const publish = useCallback(() => {
    const anchor = gpsAnchor.current;
    if (!anchor) return;
    const shifted = offsetLatLng(
      anchor.lat,
      anchor.lng,
      drOffset.current.north,
      drOffset.current.east,
    );
    const drDist = Math.hypot(drOffset.current.north, drOffset.current.east);
    setState((prev) => ({
      ...prev,
      lat: shifted.lat,
      lng: shifted.lng,
      accuracy: Math.max(anchor.accuracy * 0.85, 4),
      usingDeadReckoning: drDist > 0.4,
      quality: qualityFromAccuracy(anchor.accuracy),
      loading: false,
    }));
  }, []);

  const applyPosition = useCallback(
    (pos: GeolocationPosition) => {
      const accuracy = pos.coords.accuracy;
      const now = Date.now();
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
      const kept = samplesRef.current
        .filter((s) => now - s.t < 15000)
        .filter((s) => s.accuracy <= accuracy * 2.5 + 15);
      kept.push(nextSample);
      kept.sort((a, b) => a.accuracy - b.accuracy);
      samplesRef.current = kept.slice(0, 8);
      const blended = blend(samplesRef.current);

      // Reset dead-reckoning when GPS is good enough to re-anchor.
      if (
        !gpsAnchor.current ||
        blended.accuracy <= (gpsAnchor.current.accuracy ?? 999) + 5
      ) {
        gpsAnchor.current = blended;
        drOffset.current = { north: 0, east: 0 };
      }

      setState((prev) => ({
        ...prev,
        lat: blended.lat + 0, // will be overwritten by publish if DR active
        lng: blended.lng + 0,
        accuracy: blended.accuracy,
        altitude:
          pos.coords.altitude != null && !Number.isNaN(pos.coords.altitude)
            ? pos.coords.altitude
            : prev.altitude,
        samples: samplesRef.current.length,
        quality: qualityFromAccuracy(blended.accuracy),
        usingDeadReckoning: false,
        heading:
          pos.coords.heading != null &&
          !Number.isNaN(pos.coords.heading) &&
          pos.coords.speed != null &&
          pos.coords.speed > 0.8
            ? pos.coords.heading
            : prev.heading,
        error:
          blended.accuracy > 40
            ? "GPS is coarse — walking helps dead-reckoning fill gaps."
            : null,
        loading: false,
      }));
      publish();
    },
    [publish],
  );

  useEffect(() => {
    if (!navigator.geolocation) {
      setState((s) => ({
        ...s,
        loading: false,
        error: "Geolocation is not supported on this device/browser.",
      }));
      return;
    }

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
      headingRef.current = heading;
      setState((s) => ({ ...s, heading, hasCompass: true }));
    };

    // Step-based dead reckoning between GPS fixes (non-GPS accuracy aid).
    const onMotion = (e: DeviceMotionEvent) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc || acc.z == null || acc.y == null) return;
      const mag = Math.hypot(acc.x ?? 0, acc.y ?? 0, acc.z ?? 0);
      const delta = mag - lastAccel.current;
      lastAccel.current = mag;
      const now = Date.now();
      // Peak detection ~ walking step
      if (delta > 1.6 && now - lastStepAt.current > 320) {
        lastStepAt.current = now;
        const heading = headingRef.current;
        if (heading == null || !gpsAnchor.current) return;
        const stepMeters = 0.72;
        const rad = (heading * Math.PI) / 180;
        drOffset.current = {
          north: drOffset.current.north + Math.cos(rad) * stepMeters,
          east: drOffset.current.east + Math.sin(rad) * stepMeters,
        };
        // Cap DR drift until next GPS anchor
        const dist = Math.hypot(drOffset.current.north, drOffset.current.east);
        if (dist > 40) {
          const scale = 40 / dist;
          drOffset.current.north *= scale;
          drOffset.current.east *= scale;
        }
        publish();
      }
    };

    window.addEventListener("deviceorientation", onOrient, true);
    window.addEventListener(
      "deviceorientationabsolute" as keyof WindowEventMap,
      onOrient as EventListener,
      true,
    );
    window.addEventListener("devicemotion", onMotion, true);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.removeEventListener("deviceorientation", onOrient, true);
      window.removeEventListener(
        "deviceorientationabsolute" as keyof WindowEventMap,
        onOrient as EventListener,
        true,
      );
      window.removeEventListener("devicemotion", onMotion, true);
    };
  }, [applyPosition, publish]);

  const requestOrientationPermission = useCallback(async () => {
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    const DME = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    try {
      if (typeof DOE.requestPermission === "function") {
        const result = await DOE.requestPermission();
        if (result !== "granted") {
          setState((s) => ({
            ...s,
            error: "Motion/compass permission denied.",
          }));
        }
      }
      if (typeof DME.requestPermission === "function") {
        await DME.requestPermission();
      }
    } catch {
      setState((s) => ({
        ...s,
        error: "Could not enable motion sensors on this browser.",
      }));
    }
  }, []);

  const nudge = useCallback(
    (northMeters: number, eastMeters: number) => {
      drOffset.current = {
        north: drOffset.current.north + northMeters,
        east: drOffset.current.east + eastMeters,
      };
      if (!gpsAnchor.current && state.lat != null && state.lng != null) {
        gpsAnchor.current = {
          lat: state.lat,
          lng: state.lng,
          accuracy: state.accuracy ?? 25,
        };
      }
      publish();
    },
    [publish, state.lat, state.lng, state.accuracy],
  );

  return { ...state, requestOrientationPermission, nudge };
}
