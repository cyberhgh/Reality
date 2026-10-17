"use client";

import { useCallback, useEffect, useState } from "react";

export type GeoState = {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  heading: number | null;
  error: string | null;
  loading: boolean;
};

export function useGeo() {
  const [state, setState] = useState<GeoState>({
    lat: null,
    lng: null,
    accuracy: null,
    heading: null,
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
        pos.coords.heading != null && !Number.isNaN(pos.coords.heading)
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
      // iOS Safari: webkitCompassHeading; others: alpha (needs calibration)
      const webkit = (
        e as DeviceOrientationEvent & { webkitCompassHeading?: number }
      ).webkitCompassHeading;
      let heading: number | null = null;
      if (typeof webkit === "number") {
        heading = webkit;
      } else if (typeof e.alpha === "number") {
        heading = (360 - e.alpha) % 360;
      }
      if (heading != null) {
        setState((s) => ({ ...s, heading }));
      }
    };

    window.addEventListener("deviceorientation", onOrient, true);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.removeEventListener("deviceorientation", onOrient, true);
    };
  }, [applyPosition]);

  const requestOrientationPermission = useCallback(async () => {
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (typeof DOE.requestPermission === "function") {
      const result = await DOE.requestPermission();
      if (result !== "granted") {
        setState((s) => ({
          ...s,
          error: "Motion/compass permission denied.",
        }));
      }
    }
  }, []);

  return { ...state, requestOrientationPermission };
}
