"use client";

import { useCallback, useEffect, useState } from "react";

export type GeoState = {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  heading: number | null;
  hasCompass: boolean;
  error: string | null;
  loading: boolean;
};

function headingFromOrientation(e: DeviceOrientationEvent): number | null {
  const webkit = (
    e as DeviceOrientationEvent & { webkitCompassHeading?: number }
  ).webkitCompassHeading;
  if (typeof webkit === "number" && !Number.isNaN(webkit)) {
    return webkit;
  }

  // Absolute events expose compass degrees via alpha on many Androids.
  const absolute = (e as DeviceOrientationEvent & { absolute?: boolean })
    .absolute;
  if (typeof e.alpha === "number" && !Number.isNaN(e.alpha)) {
    if (absolute) return (360 - e.alpha) % 360;
    return (360 - e.alpha) % 360;
  }
  return null;
}

export function useGeo() {
  const [state, setState] = useState<GeoState>({
    lat: null,
    lng: null,
    accuracy: null,
    heading: null,
    hasCompass: false,
    error: null,
    loading: true,
  });

  const applyPosition = useCallback((pos: GeolocationPosition) => {
    setState((prev) => ({
      ...prev,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      heading:
        pos.coords.heading != null &&
        !Number.isNaN(pos.coords.heading) &&
        pos.coords.speed != null &&
        pos.coords.speed > 0.5
          ? pos.coords.heading
          : prev.heading,
      error: null,
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

    const watchId = navigator.geolocation.watchPosition(
      applyPosition,
      (err) => {
        setState((s) => ({
          ...s,
          loading: false,
          error: err.message || "Location permission denied.",
        }));
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
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
              "Motion/compass permission denied. Objects will still appear when very close.",
          }));
        }
      } catch {
        setState((s) => ({
          ...s,
          error: "Could not enable compass. Close objects will still show.",
        }));
      }
    }
  }, []);

  return { ...state, requestOrientationPermission };
}
