"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminHeaders, getDeviceId, getAdminPinClient, setAdminPinClient } from "@/lib/client";
import { bearingDegrees, distanceMeters, normalizeHeadingDelta } from "@/lib/geo";
import { DEFAULT_EMOJIS, PRESENCE_RADIUS_METERS, type Placement } from "@/lib/types";
import { useGeo } from "@/hooks/useGeo";

type NearbyPlacement = Placement & { distanceMeters: number };

type Overlay = NearbyPlacement & {
  xPercent: number;
  yPercent: number;
  scale: number;
  visible: boolean;
  mode: "ar" | "here" | "billboard";
  turnDelta: number | null;
};

const MAX_PLACE_ACCURACY_M = 35;

export default function RealityApp() {
  const geo = useGeo();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<NearbyPlacement[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emoji, setEmoji] = useState(DEFAULT_EMOJIS[0]);
  const [label, setLabel] = useState("");
  const [panel, setPanel] = useState<"place" | "list" | "admin">("place");
  const [adminPin, setAdminPin] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [zoneName, setZoneName] = useState("Private property");
  const [zoneRadius, setZoneRadius] = useState(50);
  const [zones, setZones] = useState<
    { id: string; name: string; lat: number; lng: number; radiusMeters: number }[]
  >([]);
  const [persistence, setPersistence] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
      setCameraError(null);
      await geo.requestOrientationPermission();
    } catch (e) {
      setCameraError(
        e instanceof Error ? e.message : "Could not open camera.",
      );
    }
  }, [geo]);

  const refreshNearby = useCallback(async () => {
    if (geo.lat == null || geo.lng == null) return;
    const res = await fetch(
      `/api/placements?lat=${geo.lat}&lng=${geo.lng}&radius=250&_=${Date.now()}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    const rows = (data.placements ?? []) as NearbyPlacement[];
    // Recompute distance from the smoothed client GPS fix.
    setNearby(
      rows
        .map((p) => ({
          ...p,
          distanceMeters: distanceMeters(geo.lat!, geo.lng!, p.lat, p.lng),
        }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters),
    );
  }, [geo.lat, geo.lng]);

  const refreshZones = useCallback(async () => {
    const res = await fetch("/api/zones");
    const data = await res.json();
    setZones(data.zones ?? []);
  }, []);

  useEffect(() => {
    setAdminPin(getAdminPinClient());
    setIsAdmin(Boolean(getAdminPinClient()));
    void fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setPersistence(d.persistence ?? null))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void refreshNearby();
    void refreshZones();
    const id = setInterval(() => {
      void refreshNearby();
    }, 5000);
    return () => clearInterval(id);
  }, [refreshNearby, refreshZones]);

  const selected = useMemo(
    () => nearby.find((p) => p.id === selectedId) ?? null,
    [nearby, selectedId],
  );

  const overlays: Overlay[] = useMemo(() => {
    if (geo.lat == null || geo.lng == null) return [];

    // Focus mode: ONLY the selected object — never stack other nearby markers.
    const candidates = selectedId
      ? nearby.filter((p) => p.id === selectedId)
      : nearby.filter((p) => p.distanceMeters < 60).slice(0, 3);

    return candidates.map((p, index) => {
      const dist = Math.max(p.distanceMeters, 0);
      const bearing = bearingDegrees(geo.lat!, geo.lng!, p.lat, p.lng);
      const turnDelta =
        geo.heading != null
          ? normalizeHeadingDelta(bearing - geo.heading)
          : null;

      if (dist < 15) {
        return {
          ...p,
          xPercent: 50,
          yPercent: 40,
          scale: 2,
          visible: true,
          mode: "here" as const,
          turnDelta,
        };
      }

      if (turnDelta == null) {
        return {
          ...p,
          xPercent: 50,
          yPercent: selectedId ? 36 : 26 + index * 14,
          scale: 1.4,
          visible: true,
          mode: "billboard" as const,
          turnDelta,
        };
      }

      const fov = 70;
      const inView = Math.abs(turnDelta) <= fov / 2;
      const xPercent = Math.min(
        90,
        Math.max(10, 50 + (turnDelta / (fov / 2)) * 40),
      );
      const yPercent = Math.min(68, Math.max(30, 66 - Math.min(dist / 3.5, 34)));
      const scale = Math.max(0.85, Math.min(2.1, 15 / Math.sqrt(dist)));

      return {
        ...p,
        xPercent: inView ? xPercent : turnDelta < 0 ? 8 : 92,
        yPercent: inView ? yPercent : 38,
        scale: inView ? scale : 0.9,
        visible: true,
        mode: "ar" as const,
        turnDelta,
      };
    });
  }, [nearby, geo.lat, geo.lng, geo.heading, selectedId]);

  async function placeHere() {
    if (geo.lat == null || geo.lng == null) {
      setStatus("Waiting for GPS…");
      return;
    }
    if (
      !isAdmin &&
      geo.accuracy != null &&
      geo.accuracy > MAX_PLACE_ACCURACY_M
    ) {
      setStatus(
        `GPS too coarse (±${Math.round(geo.accuracy)}m). Wait for ≤${MAX_PLACE_ACCURACY_M}m outdoors, or use admin PIN.`,
      );
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/placements", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({
          emoji,
          label: label || `${emoji} landmark`,
          lat: geo.lat,
          lng: geo.lng,
          userLat: geo.lat,
          userLng: geo.lng,
          createdBy: getDeviceId().slice(0, 8),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error ?? "Placement failed");
      } else {
        const placed = data.placement as Placement;
        setNearby((prev) => {
          const next = [
            { ...placed, distanceMeters: 0 },
            ...prev.filter((p) => p.id !== placed.id),
          ];
          return next;
        });
        setStatus(`Placed ${placed.emoji} at your location`);
        setLabel("");
        await refreshNearby();
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveAdminPin() {
    setAdminPinClient(adminPin.trim());
    setIsAdmin(Boolean(adminPin.trim()));
    setStatus(
      adminPin.trim()
        ? "Admin pin saved on this device (bypass presence check)."
        : "Admin pin cleared.",
    );
  }

  async function addBanZoneHere() {
    if (geo.lat == null || geo.lng == null) return;
    setBusy(true);
    try {
      const res = await fetch("/api/zones", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({
          name: zoneName,
          lat: geo.lat,
          lng: geo.lng,
          radiusMeters: zoneRadius,
        }),
      });
      const data = await res.json();
      if (!res.ok) setStatus(data.error ?? "Could not create zone");
      else {
        setStatus(`Banned zone created: ${data.zone.name}`);
        await refreshZones();
      }
    } finally {
      setBusy(false);
    }
  }

  async function removePlacement(id: string) {
    const res = await fetch(`/api/placements?id=${id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    if (!res.ok) {
      const data = await res.json();
      setStatus(data.error ?? "Delete failed");
      return;
    }
    await refreshNearby();
  }

  async function removeZone(id: string) {
    const res = await fetch(`/api/zones?id=${id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    if (!res.ok) {
      const data = await res.json();
      setStatus(data.error ?? "Delete failed");
      return;
    }
    await refreshZones();
  }

  const accuracyLabel =
    geo.accuracy != null ? `±${Math.round(geo.accuracy)}m` : "—";

  function directionHint(p: NearbyPlacement) {
    if (geo.lat == null || geo.lng == null) return "Find in camera";
    if (p.distanceMeters < 15) return "Look around — you are on top of it";
    const bearing = bearingDegrees(geo.lat, geo.lng, p.lat, p.lng);
    if (geo.heading == null) {
      const cardinals = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
      const idx = Math.round(bearing / 45) % 8;
      return `Face ${cardinals[idx]} · ${Math.round(p.distanceMeters)}m`;
    }
    const delta = normalizeHeadingDelta(bearing - geo.heading);
    if (Math.abs(delta) < 12) return `Straight ahead · ${Math.round(p.distanceMeters)}m`;
    if (delta < 0) return `Turn left ${Math.round(Math.abs(delta))}° · ${Math.round(p.distanceMeters)}m`;
    return `Turn right ${Math.round(delta)}° · ${Math.round(p.distanceMeters)}m`;
  }

  function mapsUrl(p: NearbyPlacement) {
    const q = `${p.lat},${p.lng}`;
    return `https://maps.apple.com/?ll=${q}&q=${encodeURIComponent(p.label || p.emoji)}`;
  }

  function focusPlacement(p: NearbyPlacement) {
    setSelectedId(p.id);
    setStatus(`${p.emoji} ${directionHint(p)}`);
    if (!cameraReady) {
      void startCamera();
    }
  }

  // Keep turn guidance live while a list item is selected.
  useEffect(() => {
    if (!selected) return;
    setStatus(`${selected.emoji} ${directionHint(selected)}`);
  }, [selected, geo.lat, geo.lng, geo.heading, geo.hasCompass]);

  const focusTurn = selected?.id
    ? overlays.find((o) => o.id === selected.id)?.turnDelta ?? null
    : null;

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-[#0b1220] text-white">
      <div className="absolute inset-0 overflow-hidden bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="h-full w-full object-cover"
        />
        {!cameraReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_top,#1e3a5f,#0b1220)] px-6 text-center">
            <p className="text-4xl font-semibold tracking-tight">Reality</p>
            <p className="max-w-sm text-sm text-white/75">
              Mount digital objects at real-world coordinates. Others can see
              them when they arrive with their phone camera.
            </p>
            <button
              type="button"
              onClick={() => void startCamera()}
              className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-[#06202b]"
            >
              Open camera & GPS
            </button>
            {cameraError && (
              <p className="text-sm text-rose-300">{cameraError}</p>
            )}
          </div>
        )}

        {cameraReady && selected && (
          <div className="pointer-events-none absolute inset-x-0 top-[22%] z-[6] flex flex-col items-center px-4">
            <div className="rounded-2xl bg-black/55 px-4 py-3 text-center backdrop-blur-md">
              <p className="text-4xl leading-none">{selected.emoji}</p>
              <p className="mt-2 text-sm font-medium">{selected.label}</p>
              <p className="mt-1 text-xs text-cyan-100">
                {directionHint(selected)}
              </p>
              {focusTurn != null && Math.abs(focusTurn) >= 12 && (
                <p
                  className="mt-3 text-5xl text-cyan-300 transition-transform"
                  style={{ transform: `rotate(${focusTurn}deg)` }}
                >
                  ↑
                </p>
              )}
              {focusTurn != null && Math.abs(focusTurn) < 12 && (
                <p className="mt-3 text-sm font-semibold text-emerald-300">
                  Ahead of you
                </p>
              )}
              {focusTurn == null && (
                <p className="mt-3 text-[11px] text-white/70">
                  Enable compass for live turn arrow
                </p>
              )}
            </div>
          </div>
        )}

        {cameraReady &&
          !selectedId &&
          overlays
            .filter((o) => o.visible)
            .map((o) => (
              <div
                key={o.id}
                className="pointer-events-none absolute z-[5] text-center drop-shadow-[0_4px_12px_rgba(0,0,0,0.85)]"
                style={{
                  left: `${o.xPercent}%`,
                  top: `${o.yPercent}%`,
                  transform: `translate(-50%, -50%) scale(${o.scale})`,
                }}
              >
                {o.mode === "ar" && (o.xPercent <= 10 || o.xPercent >= 90) && (
                  <div className="mb-1 text-lg text-cyan-200">
                    {o.xPercent <= 10 ? "◀" : "▶"}
                  </div>
                )}
                <div className="text-5xl leading-none">{o.emoji}</div>
                <div className="mt-1 whitespace-nowrap rounded-full bg-black/65 px-2 py-0.5 text-[10px] text-white/95">
                  {Math.round(o.distanceMeters)}m · {o.label}
                </div>
              </div>
            ))}

        {cameraReady &&
          selectedId &&
          overlays
            .filter((o) => o.visible && o.mode === "here")
            .map((o) => (
              <div
                key={o.id}
                className="pointer-events-none absolute z-[5] text-center"
                style={{
                  left: "50%",
                  top: "58%",
                  transform: "translate(-50%, -50%) scale(1.8)",
                }}
              >
                <div className="text-6xl leading-none">{o.emoji}</div>
              </div>
            ))}
      </div>

      <header className="relative z-10 flex items-start justify-between gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div>
          <p className="text-lg font-semibold tracking-tight">Reality</p>
          <p className="text-xs text-white/70">
            GPS {accuracyLabel} ({geo.quality}
            {geo.samples > 0 ? ` · ${geo.samples} samples` : ""})
            {geo.hasCompass && geo.heading != null
              ? ` · heading ${Math.round(geo.heading)}°`
              : " · compass off"}
            {isAdmin ? " · admin" : ""}
            {persistence ? ` · store:${persistence}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="rounded-full bg-black/45 px-3 py-1 text-xs backdrop-blur">
            {nearby.length} nearby
          </div>
          {cameraReady && !geo.hasCompass && (
            <button
              type="button"
              onClick={() => void geo.requestOrientationPermission()}
              className="rounded-full bg-cyan-400/90 px-3 py-1 text-[11px] font-semibold text-[#06202b]"
            >
              Enable compass
            </button>
          )}
        </div>
      </header>

      {(geo.error || status || selectedId) && (
        <div className="relative z-10 mx-4 rounded-xl bg-black/55 px-3 py-2 text-xs backdrop-blur">
          {geo.error && <p className="text-amber-200">{geo.error}</p>}
          {status && <p className="text-cyan-100">{status}</p>}
          {selectedId && (
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setStatus("Showing up to 3 nearby objects ahead");
              }}
              className="mt-1 text-[11px] font-medium text-white/70 underline underline-offset-2"
            >
              Clear focus · browse nearby
            </button>
          )}
        </div>
      )}

      <div className="relative z-10 mt-auto rounded-t-3xl bg-[#0f172a]/92 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
        <div className="mb-3 grid grid-cols-3 gap-2">
          {(["place", "list", "admin"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setPanel(tab)}
              className={`rounded-xl px-3 py-2 text-xs font-medium capitalize ${
                panel === tab
                  ? "bg-cyan-400 text-[#06202b]"
                  : "bg-white/10 text-white/80"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {panel === "place" && (
          <div className="space-y-3">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {DEFAULT_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl ${
                    emoji === e ? "bg-cyan-400/30 ring-2 ring-cyan-300" : "bg-white/10"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Optional label"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none placeholder:text-white/40"
            />
            <button
              type="button"
              disabled={busy || geo.lat == null || geo.quality === "searching"}
              onClick={() => void placeHere()}
              className="w-full rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-[#06202b] disabled:opacity-50"
            >
              Place {emoji} here
            </button>
            <p className="text-[11px] leading-relaxed text-white/55">
              Best outdoors with clear sky. Placement needs GPS ≤{MAX_PLACE_ACCURACY_M}m
              (admins exempt). Presence check: {PRESENCE_RADIUS_METERS}m.
            </p>
          </div>
        )}

        {panel === "list" && (
          <div className="max-h-56 space-y-2 overflow-y-auto">
            {nearby.length === 0 && (
              <p className="text-sm text-white/60">No objects within 250m yet.</p>
            )}
            {nearby.map((p) => (
              <div
                key={p.id}
                className={`rounded-xl px-3 py-2 ${
                  selectedId === p.id
                    ? "bg-cyan-400/20 ring-1 ring-cyan-300/60"
                    : "bg-white/5"
                }`}
              >
                <button
                  type="button"
                  onClick={() => focusPlacement(p)}
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {p.emoji} {p.label}
                    </p>
                    <p className="text-[11px] text-white/60">
                      {directionHint(p)}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] font-medium text-cyan-200">
                    View
                  </span>
                </button>
                <div className="mt-2 flex items-center gap-3">
                  <a
                    href={mapsUrl(p)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-white/70 underline underline-offset-2"
                  >
                    Open in Maps
                  </a>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => void removePlacement(p.id)}
                      className="text-[11px] text-rose-300"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {panel === "admin" && (
          <div className="max-h-64 space-y-3 overflow-y-auto">
            <input
              value={adminPin}
              onChange={(e) => setAdminPin(e.target.value)}
              placeholder="Admin PIN"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => void saveAdminPin()}
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-sm"
            >
              Save admin PIN on this device
            </button>
            <p className="text-[11px] text-white/50">
              Default PIN for this MVP: <code>reality-admin</code> (override with{" "}
              <code>ADMIN_PIN</code> env).
            </p>
            <div className="grid grid-cols-[1fr_90px] gap-2">
              <input
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                placeholder="Zone name"
              />
              <input
                type="number"
                value={zoneRadius}
                onChange={(e) => setZoneRadius(Number(e.target.value))}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
                placeholder="m"
              />
            </div>
            <button
              type="button"
              disabled={!isAdmin || busy || geo.lat == null}
              onClick={() => void addBanZoneHere()}
              className="w-full rounded-xl bg-rose-400 px-4 py-3 text-sm font-semibold text-[#2a0a10] disabled:opacity-50"
            >
              Ban placement here
            </button>
            {zones.map((z) => (
              <div
                key={z.id}
                className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-sm"
              >
                <span>
                  {z.name} · {z.radiusMeters}m
                </span>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => void removeZone(z.id)}
                    className="text-xs text-rose-300"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
