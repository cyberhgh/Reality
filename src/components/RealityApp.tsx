"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  adminHeaders,
  getDeviceId,
  getDisplayName,
  setDisplayName,
  getAdminPinClient,
  setAdminPinClient,
  getFoundIds,
  markFoundLocal,
} from "@/lib/client";
import {
  bearingDegrees,
  distanceMeters,
  normalizeHeadingDelta,
  offsetLatLng,
} from "@/lib/geo";
import {
  DEFAULT_EMOJIS,
  FIND_RADIUS_METERS,
  MAX_PLACE_ACCURACY_M,
  PRESENCE_RADIUS_METERS,
  REACTION_EMOJIS,
  type Placement,
} from "@/lib/types";
import { useGeo } from "@/hooks/useGeo";
import { useWebXR } from "@/hooks/useWebXR";
import Radar from "@/components/Radar";

type NearbyPlacement = Placement & { distanceMeters: number };

type DiscoverPayload = {
  recent: Array<Placement & { distanceMeters: number | null }>;
  popular: Placement[];
  activity: Array<{
    id: string;
    finderName: string;
    emoji: string;
    label: string;
    method: string;
    createdAt: string;
    placementId: string;
  }>;
};

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
  const [note, setNote] = useState("");
  const [nudgeN, setNudgeN] = useState(0);
  const [nudgeE, setNudgeE] = useState(0);
  const [panel, setPanel] = useState<
    "explore" | "place" | "list" | "me" | "admin"
  >("explore");
  const [adminPin, setAdminPin] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [zoneName, setZoneName] = useState("Private property");
  const [zoneRadius, setZoneRadius] = useState(50);
  const [zones, setZones] = useState<
    { id: string; name: string; lat: number; lng: number; radiusMeters: number }[]
  >([]);
  const [persistence, setPersistence] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [displayName, setDisplayNameState] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [foundIds, setFoundIds] = useState<string[]>([]);
  const [discover, setDiscover] = useState<DiscoverPayload | null>(null);
  const [snapInput, setSnapInput] = useState("");
  const [lastPlaced, setLastPlaced] = useState<Placement | null>(null);
  const [leaderboard, setLeaderboard] = useState<{
    topFinders: Array<{ name: string; finds: number }>;
    topDroppers: Array<{ name: string; drops: number; foundByOthers: number }>;
  } | null>(null);
  const [hideFound, setHideFound] = useState(true);
  const [myFinds, setMyFinds] = useState<
    Array<{ placementId: string; method: string; createdAt: string }>
  >([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [selectedComments, setSelectedComments] = useState<
    Array<{ id: string; userName: string; text: string }>
  >([]);
  const xr = useWebXR();

  async function sharePlacement(p: Placement) {
    const url = `${window.location.origin}/o/${p.id}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${p.emoji} ${p.label}`,
          text: `Find this Reality drop by ${p.createdByName}`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setStatus("Link copied");
      }
    } catch {
      await navigator.clipboard.writeText(url);
      setStatus("Link copied");
    }
  }

  async function uploadLandmark(placementId: string, file: File) {
    const body = new FormData();
    body.set("placementId", placementId);
    body.set("file", file);
    setBusy(true);
    try {
      const res = await fetch("/api/landmarks", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) setStatus(data.error ?? "Landmark upload failed");
      else {
        setStatus("Landmark photo attached");
        if (lastPlaced?.id === placementId) {
          setLastPlaced({ ...lastPlaced, landmarkUrl: data.url });
        }
        await refreshNearby();
      }
    } finally {
      setBusy(false);
    }
  }

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
      setCameraError(e instanceof Error ? e.message : "Could not open camera.");
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
    setNearby(
      rows
        .map((p) => ({
          ...p,
          distanceMeters: distanceMeters(geo.lat!, geo.lng!, p.lat, p.lng),
        }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters),
    );
  }, [geo.lat, geo.lng]);

  const refreshDiscover = useCallback(async () => {
    const params = new URLSearchParams({ _: String(Date.now()) });
    if (geo.lat != null && geo.lng != null) {
      params.set("lat", String(geo.lat));
      params.set("lng", String(geo.lng));
    }
    const res = await fetch(`/api/discover?${params}`, { cache: "no-store" });
    const data = (await res.json()) as DiscoverPayload;
    setDiscover(data);
  }, [geo.lat, geo.lng]);

  const refreshZones = useCallback(async () => {
    const res = await fetch("/api/zones");
    const data = await res.json();
    setZones(data.zones ?? []);
  }, []);

  const refreshLeaderboard = useCallback(async () => {
    const res = await fetch(`/api/leaderboard?_=${Date.now()}`, {
      cache: "no-store",
    });
    setLeaderboard(await res.json());
  }, []);

  const refreshMyFinds = useCallback(async () => {
    const res = await fetch(`/api/finds?_=${Date.now()}`, { cache: "no-store" });
    const data = await res.json();
    const mine = ((data.finds ?? []) as Array<{
      finderId: string;
      placementId: string;
      method: string;
      createdAt: string;
    }>).filter((f) => f.finderId === getDeviceId());
    setMyFinds(mine);
  }, []);

  async function reportPlacement(placementId: string) {
    const reason = window.prompt("Why report this drop?")?.trim();
    if (!reason) return;
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        placementId,
        reporterId: getDeviceId(),
        reason,
      }),
    });
    setStatus(res.ok ? "Report submitted" : "Could not submit report");
  }

  useEffect(() => {
    const name = getDisplayName();
    setDisplayNameState(name);
    setNameDraft(name);
    setAdminPin(getAdminPinClient());
    setIsAdmin(Boolean(getAdminPinClient()));
    setFoundIds(getFoundIds());
    void fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setPersistence(d.persistence ?? null))
      .catch(() => undefined);

    const params = new URLSearchParams(window.location.search);
    const snap = params.get("snap");
    if (snap) setSnapInput(snap.toUpperCase());
    const focus = params.get("focus");
    if (focus) setSelectedId(focus);
  }, []);

  useEffect(() => {
    void refreshNearby();
    void refreshZones();
    void refreshDiscover();
    void refreshLeaderboard();
    void refreshMyFinds();
    const id = setInterval(() => {
      void refreshNearby();
      void refreshDiscover();
      void refreshLeaderboard();
      void refreshMyFinds();
    }, 8000);
    return () => clearInterval(id);
  }, [
    refreshNearby,
    refreshZones,
    refreshDiscover,
    refreshLeaderboard,
    refreshMyFinds,
  ]);

  const selected = useMemo(
    () => nearby.find((p) => p.id === selectedId) ?? null,
    [nearby, selectedId],
  );

  const focusTurn = useMemo(() => {
    if (!selected || geo.lat == null || geo.lng == null || geo.heading == null) {
      return null;
    }
    const bearing = bearingDegrees(geo.lat, geo.lng, selected.lat, selected.lng);
    return normalizeHeadingDelta(bearing - geo.heading);
  }, [selected, geo.lat, geo.lng, geo.heading]);

  const browseOverlays = useMemo(() => {
    if (selectedId || geo.lat == null || geo.lng == null) return [];
    return nearby
      .filter((p) => p.distanceMeters < 60)
      .slice(0, 3)
      .map((p) => {
        const bearing = bearingDegrees(geo.lat!, geo.lng!, p.lat, p.lng);
        const turn =
          geo.heading != null
            ? normalizeHeadingDelta(bearing - geo.heading)
            : null;
        if (p.distanceMeters < 15) {
          return { ...p, x: 50, y: 42, scale: 1.8, turn };
        }
        if (turn == null) {
          return { ...p, x: 50, y: 32, scale: 1.2, turn };
        }
        const inView = Math.abs(turn) <= 35;
        return {
          ...p,
          x: inView ? Math.min(90, Math.max(10, 50 + turn)) : turn < 0 ? 8 : 92,
          y: inView ? 55 : 38,
          scale: inView ? 1.3 : 0.9,
          turn,
        };
      });
  }, [nearby, geo.lat, geo.lng, geo.heading, selectedId]);

  function directionHint(p: NearbyPlacement) {
    if (geo.lat == null || geo.lng == null) return "Find in camera";
    if (p.distanceMeters < 15) return "You are on top of it — mark Found";
    const bearing = bearingDegrees(geo.lat, geo.lng, p.lat, p.lng);
    if (geo.heading == null) {
      const cardinals = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
      return `Face ${cardinals[Math.round(bearing / 45) % 8]} · ${Math.round(p.distanceMeters)}m`;
    }
    const delta = normalizeHeadingDelta(bearing - geo.heading);
    if (Math.abs(delta) < 12) return `Straight ahead · ${Math.round(p.distanceMeters)}m`;
    if (delta < 0) return `Turn left ${Math.round(Math.abs(delta))}° · ${Math.round(p.distanceMeters)}m`;
    return `Turn right ${Math.round(delta)}° · ${Math.round(p.distanceMeters)}m`;
  }

  async function saveName() {
    const clean = nameDraft.trim().slice(0, 24);
    if (clean.length < 2) {
      setStatus("Pick a display name (2+ characters).");
      return;
    }
    setDisplayName(clean);
    setDisplayNameState(clean);
    setStatus(`Welcome, ${clean}`);
  }

  async function placeHere() {
    if (!displayName) {
      setStatus("Set your display name in Me first.");
      setPanel("me");
      return;
    }
    if (geo.lat == null || geo.lng == null) {
      setStatus("Waiting for GPS…");
      return;
    }
    if (!isAdmin && geo.accuracy != null && geo.accuracy > MAX_PLACE_ACCURACY_M) {
      setStatus(
        `GPS too coarse (±${Math.round(geo.accuracy)}m). Wait outdoors or fine-tune / use admin.`,
      );
      return;
    }

    const shifted = offsetLatLng(geo.lat, geo.lng, nudgeN, nudgeE);
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/placements", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify({
          emoji,
          label: label || `${emoji} drop`,
          note,
          lat: shifted.lat,
          lng: shifted.lng,
          altitude: geo.altitude,
          userLat: geo.lat,
          userLng: geo.lng,
          createdBy: getDeviceId().slice(0, 8),
          createdByName: displayName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error ?? "Placement failed");
      } else {
        const placed = data.placement as Placement;
        setLastPlaced(placed);
        setNearby((prev) => [
          { ...placed, distanceMeters: Math.hypot(nudgeN, nudgeE) },
          ...prev.filter((p) => p.id !== placed.id),
        ]);
        setStatus(`Dropped ${placed.emoji} · snap ${placed.snapCode}`);
        setLabel("");
        setNote("");
        setNudgeN(0);
        setNudgeE(0);
        await refreshNearby();
        await refreshDiscover();
      }
    } finally {
      setBusy(false);
    }
  }

  async function markFound(
    placement: Placement,
    method: "gps" | "snap" | "manual" = "gps",
  ) {
    if (!displayName) {
      setStatus("Set your display name in Me first.");
      setPanel("me");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/finds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placementId: placement.id,
          snapCode: method === "snap" ? placement.snapCode : undefined,
          finderId: getDeviceId(),
          finderName: displayName,
          lat: geo.lat,
          lng: geo.lng,
          method,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error ?? "Could not mark found");
      } else {
        markFoundLocal(placement.id);
        setFoundIds(getFoundIds());
        setStatus(
          data.alreadyFound
            ? `Already in your finds: ${placement.emoji}`
            : `Found ${placement.emoji}! (+1)`,
        );
        await refreshNearby();
        await refreshDiscover();
        await refreshMyFinds();
      }
    } finally {
      setBusy(false);
    }
  }

  async function reactTo(placementId: string, reactionEmoji: string) {
    if (!displayName) {
      setPanel("me");
      setStatus("Set your display name to react.");
      return;
    }
    await fetch("/api/reactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        placementId,
        emoji: reactionEmoji,
        userId: getDeviceId(),
        userName: displayName,
      }),
    });
    setStatus(`Reacted ${reactionEmoji}`);
    await refreshDiscover();
    await refreshNearby();
  }

  async function redeemSnap() {
    const code = snapInput.trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/snap/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error ?? "Invalid snap code");
        return;
      }
      const placement = data.placement as Placement;
      setSelectedId(placement.id);
      setNearby((prev) => {
        const dist =
          geo.lat != null && geo.lng != null
            ? distanceMeters(geo.lat, geo.lng, placement.lat, placement.lng)
            : 0;
        return [
          { ...placement, distanceMeters: dist },
          ...prev.filter((p) => p.id !== placement.id),
        ];
      });
      await markFound(placement, "snap");
      setStatus(`Snap locked ${placement.emoji} — precise find via code`);
      if (!cameraReady) void startCamera();
    } finally {
      setBusy(false);
    }
  }

  function focusPlacement(p: NearbyPlacement) {
    setSelectedId(p.id);
    setStatus(`${p.emoji} ${directionHint(p)}`);
    if (!cameraReady) void startCamera();
  }

  async function loadComments(placementId: string) {
    const res = await fetch(
      `/api/comments?placementId=${placementId}&_=${Date.now()}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    setSelectedComments(data.comments ?? []);
  }

  async function postComment(placementId: string) {
    if (!displayName || !commentDraft.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placementId,
          userId: getDeviceId(),
          userName: displayName,
          text: commentDraft,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setStatus(data.error ?? "Comment failed");
        return;
      }
      setCommentDraft("");
      await loadComments(placementId);
      setStatus("Comment posted");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!selected) {
      setSelectedComments([]);
      return;
    }
    setStatus(`${selected.emoji} ${directionHint(selected)}`);
    void loadComments(selected.id);
  }, [selected, geo.lat, geo.lng, geo.heading]);

  async function saveAdminPin() {
    setAdminPinClient(adminPin.trim());
    setIsAdmin(Boolean(adminPin.trim()));
    setStatus(adminPin.trim() ? "Admin pin saved." : "Admin pin cleared.");
  }

  async function addBanZoneHere() {
    if (geo.lat == null || geo.lng == null) return;
    setBusy(true);
    try {
      const res = await fetch("/api/zones", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
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
        setStatus(`Banned zone: ${data.zone.name}`);
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
    await refreshDiscover();
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
  const shareOrigin =
    typeof window !== "undefined" ? window.location.origin : "";

  if (!displayName) {
    return (
      <div className="flex min-h-[100dvh] flex-col justify-center bg-[#0b1220] px-6 text-white">
        <p className="text-4xl font-semibold tracking-tight">Reality</p>
        <p className="mt-2 max-w-sm text-sm text-white/70">
          Drop digital objects in the real world. Other members hunt them down —
          then react, share, and climb the find count.
        </p>
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          placeholder="Choose a display name"
          className="mt-6 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none"
        />
        <button
          type="button"
          onClick={() => void saveName()}
          className="mt-3 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-[#06202b]"
        >
          Enter Reality
        </button>
      </div>
    );
  }

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
              Hi {displayName} — open the camera to hunt nearby drops, or browse
              Discover below.
            </p>
            <button
              type="button"
              onClick={() => void startCamera()}
              className="rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-[#06202b]"
            >
              Open camera & sensors
            </button>
            {cameraError && (
              <p className="text-sm text-rose-300">{cameraError}</p>
            )}
          </div>
        )}

        {cameraReady && geo.lat != null && geo.lng != null && (
          <div className="pointer-events-none absolute right-3 top-[18%] z-[6]">
            <Radar
              userLat={geo.lat}
              userLng={geo.lng}
              heading={geo.heading}
              selectedId={selectedId}
              items={nearby}
            />
          </div>
        )}

        {cameraReady && selected && (
          <div className="pointer-events-none absolute inset-x-0 top-[18%] z-[6] flex flex-col items-center px-4 pr-32">
            <div className="rounded-2xl bg-black/60 px-4 py-3 text-center backdrop-blur-md">
              <p className="text-4xl leading-none">{selected.emoji}</p>
              <p className="mt-2 text-sm font-medium">{selected.label}</p>
              <p className="text-[11px] text-white/60">
                by {selected.createdByName} · {selected.findCount} finds
              </p>
              <p className="mt-1 text-xs text-cyan-100">
                {directionHint(selected)}
              </p>
              {focusTurn != null && Math.abs(focusTurn) >= 12 && (
                <p
                  className="mt-3 text-5xl text-cyan-300"
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
            </div>
          </div>
        )}

        {cameraReady &&
          !selectedId &&
          browseOverlays.map((o) => (
            <div
              key={o.id}
              className="pointer-events-none absolute z-[5] text-center"
              style={{
                left: `${o.x}%`,
                top: `${o.y}%`,
                transform: `translate(-50%, -50%) scale(${o.scale})`,
              }}
            >
              <div className="text-5xl leading-none">{o.emoji}</div>
              <div className="mt-1 rounded-full bg-black/65 px-2 py-0.5 text-[10px]">
                {Math.round(o.distanceMeters)}m
              </div>
            </div>
          ))}
      </div>

      <header className="relative z-10 flex items-start justify-between gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div>
          <p className="text-lg font-semibold tracking-tight">Reality</p>
          <p className="text-xs text-white/70">
            GPS {accuracyLabel} ({geo.quality}
            {geo.usingDeadReckoning ? " · steps" : ""})
            {geo.hasCompass ? ` · ${Math.round(geo.heading ?? 0)}°` : " · compass off"}
            {persistence ? ` · ${persistence}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="rounded-full bg-black/45 px-3 py-1 text-xs backdrop-blur">
            {foundIds.length} finds · {nearby.length} near
          </div>
          {cameraReady && !geo.hasCompass && (
            <button
              type="button"
              onClick={() => void geo.requestOrientationPermission()}
              className="rounded-full bg-cyan-400/90 px-3 py-1 text-[11px] font-semibold text-[#06202b]"
            >
              Enable sensors
            </button>
          )}
        </div>
      </header>

      {(geo.error || status || selectedId) && (
        <div className="relative z-10 mx-4 rounded-xl bg-black/55 px-3 py-2 text-xs backdrop-blur">
          {geo.error && <p className="text-amber-200">{geo.error}</p>}
          {status && <p className="text-cyan-100">{status}</p>}
          {selected && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void markFound(selected, "gps")}
                  className="rounded-lg bg-emerald-400/90 px-2 py-1 text-[11px] font-semibold text-[#062b18]"
                >
                  Mark found
                </button>
                {REACTION_EMOJIS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => void reactTo(selected.id, r)}
                    className="rounded-lg bg-white/10 px-2 py-1 text-[11px]"
                  >
                    {r}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    setStatus("Browsing nearby drops");
                  }}
                  className="rounded-lg bg-white/10 px-2 py-1 text-[11px]"
                >
                  Clear focus
                </button>
              </div>
              <div className="max-h-16 space-y-1 overflow-y-auto">
                {selectedComments.slice(0, 4).map((c) => (
                  <p key={c.id} className="text-[11px] text-white/65">
                    <span className="text-white/90">{c.userName}</span>: {c.text}
                  </p>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  placeholder="Say something…"
                  className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] outline-none"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void postComment(selected.id)}
                  className="rounded-lg bg-cyan-400/90 px-2 py-1 text-[11px] font-semibold text-[#06202b]"
                >
                  Post
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="relative z-10 mt-auto rounded-t-3xl bg-[#0f172a]/94 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
        <div className="mb-3 grid grid-cols-5 gap-1">
          {(["explore", "place", "list", "me", "admin"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setPanel(tab)}
              className={`rounded-xl px-1 py-2 text-[11px] font-medium capitalize ${
                panel === tab
                  ? "bg-cyan-400 text-[#06202b]"
                  : "bg-white/10 text-white/80"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {panel === "explore" && (
          <div className="max-h-64 space-y-3 overflow-y-auto">
            <div className="flex gap-2">
              <input
                value={snapInput}
                onChange={(e) => setSnapInput(e.target.value.toUpperCase())}
                placeholder="SNAP code"
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void redeemSnap()}
                className="rounded-xl bg-cyan-400 px-3 py-2 text-xs font-semibold text-[#06202b]"
              >
                Snap
              </button>
            </div>
            <p className="text-[11px] text-white/50">
              Snap codes beat GPS: scan a posted QR / enter the code at the spot
              for a precise find.
            </p>
            <p className="text-xs font-semibold text-white/80">Recent drops</p>
            {(discover?.recent ?? []).slice(0, 8).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  focusPlacement({
                    ...p,
                    distanceMeters: p.distanceMeters ?? 9999,
                  })
                }
                className="flex w-full items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-left"
              >
                <span className="truncate text-sm">
                  {p.emoji} {p.label}{" "}
                  <span className="text-white/45">by {p.createdByName}</span>
                </span>
                <span className="text-[11px] text-cyan-200">
                  {p.distanceMeters != null
                    ? `${Math.round(p.distanceMeters)}m`
                    : `${p.findCount} finds`}
                </span>
              </button>
            ))}
            <p className="text-xs font-semibold text-white/80">Live finds</p>
            {(discover?.activity ?? []).slice(0, 6).map((a) => (
              <p key={a.id} className="text-[11px] text-white/65">
                {a.finderName} found {a.emoji} {a.label} via {a.method}
              </p>
            ))}
          </div>
        )}

        {panel === "place" && (
          <div className="max-h-64 space-y-3 overflow-y-auto">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {DEFAULT_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl ${
                    emoji === e
                      ? "bg-cyan-400/30 ring-2 ring-cyan-300"
                      : "bg-white/10"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Title"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Hint for finders (optional)"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
            />
            <div>
              <p className="mb-1 text-[11px] text-white/55">
                Fine-tune without GPS (± meters)
              </p>
              <div className="grid grid-cols-3 gap-2">
                <span />
                <button
                  type="button"
                  onClick={() => {
                    setNudgeN((n) => n + 1);
                    geo.nudge(1, 0);
                  }}
                  className="rounded-lg bg-white/10 py-2 text-xs"
                >
                  N +1m
                </button>
                <span />
                <button
                  type="button"
                  onClick={() => {
                    setNudgeE((n) => n - 1);
                    geo.nudge(0, -1);
                  }}
                  className="rounded-lg bg-white/10 py-2 text-xs"
                >
                  W
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNudgeN(0);
                    setNudgeE(0);
                  }}
                  className="rounded-lg bg-white/10 py-2 text-[10px]"
                >
                  {nudgeN.toFixed(0)},{nudgeE.toFixed(0)}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNudgeE((n) => n + 1);
                    geo.nudge(0, 1);
                  }}
                  className="rounded-lg bg-white/10 py-2 text-xs"
                >
                  E
                </button>
                <span />
                <button
                  type="button"
                  onClick={() => {
                    setNudgeN((n) => n - 1);
                    geo.nudge(-1, 0);
                  }}
                  className="rounded-lg bg-white/10 py-2 text-xs"
                >
                  S +1m
                </button>
              </div>
            </div>
            <button
              type="button"
              disabled={busy || geo.lat == null}
              onClick={() => void placeHere()}
              className="w-full rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-[#06202b] disabled:opacity-50"
            >
              Drop {emoji} here
            </button>
            {lastPlaced && (
              <div className="rounded-xl bg-white/5 p-3 text-[11px] text-white/75">
                <p>
                  Snap code: <strong>{lastPlaced.snapCode}</strong>
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/qr/${lastPlaced.snapCode}`}
                  alt={`QR for ${lastPlaced.snapCode}`}
                  className="mx-auto mt-2 h-40 w-40 rounded-lg bg-white p-2"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void sharePlacement(lastPlaced)}
                    className="rounded-lg bg-cyan-400/90 px-2 py-1 font-semibold text-[#06202b]"
                  >
                    Share
                  </button>
                  <label className="cursor-pointer rounded-lg bg-white/10 px-2 py-1">
                    Add landmark photo
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadLandmark(lastPlaced.id, file);
                      }}
                    />
                  </label>
                </div>
                <p className="mt-2 break-all">
                  Share: {shareOrigin}/o/{lastPlaced.id}
                </p>
                <p className="mt-1 break-all">
                  Snap: {shareOrigin}/snap/{lastPlaced.snapCode}
                </p>
              </div>
            )}
            {xr.supported && (
              <button
                type="button"
                onClick={() => void xr.probeHitTest()}
                className="w-full rounded-xl bg-white/10 px-4 py-2 text-xs"
              >
                Probe WebXR hit-test (experimental)
              </button>
            )}
            {xr.message && (
              <p className="text-[11px] text-amber-200">{xr.message}</p>
            )}
            <p className="text-[11px] text-white/45">
              GPS ≤{MAX_PLACE_ACCURACY_M}m required (admins exempt). Presence{" "}
              {PRESENCE_RADIUS_METERS}m. Extra accuracy: step dead-reckoning,
              manual fine-tune, snap QR, optional WebXR.
            </p>
          </div>
        )}

        {panel === "list" && (
          <div className="max-h-64 space-y-2 overflow-y-auto">
            <label className="flex items-center gap-2 text-[11px] text-white/60">
              <input
                type="checkbox"
                checked={hideFound}
                onChange={(e) => setHideFound(e.target.checked)}
              />
              Hide already found
            </label>
            {nearby.filter((p) => !(hideFound && foundIds.includes(p.id)))
              .length === 0 && (
              <p className="text-sm text-white/60">No objects within 250m.</p>
            )}
            {nearby
              .filter((p) => !(hideFound && foundIds.includes(p.id)))
              .map((p) => (
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
                      {p.emoji} {p.label}{" "}
                      {foundIds.includes(p.id) ? "✓" : ""}
                    </p>
                    <p className="text-[11px] text-white/60">
                      {directionHint(p)} · {p.findCount} finds
                    </p>
                    {p.note ? (
                      <p className="truncate text-[11px] text-white/45">
                        Hint: {p.note}
                      </p>
                    ) : null}
                  </div>
                  <span className="text-[11px] text-cyan-200">View</span>
                </button>
                {p.landmarkUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.landmarkUrl}
                    alt="Landmark"
                    className="mt-2 h-20 w-full rounded-lg object-cover"
                  />
                ) : null}
                <div className="mt-2 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void markFound(p, "gps")}
                    className="text-[11px] text-emerald-300"
                  >
                    Found ({FIND_RADIUS_METERS}m)
                  </button>
                  <button
                    type="button"
                    onClick={() => void sharePlacement(p)}
                    className="text-[11px] text-cyan-200"
                  >
                    Share
                  </button>
                  <a
                    href={`/o/${p.id}`}
                    className="text-[11px] text-white/70 underline"
                  >
                    Page
                  </a>
                  <a
                    href={`https://maps.apple.com/?ll=${p.lat},${p.lng}&q=${encodeURIComponent(p.label)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-white/70 underline"
                  >
                    Maps
                  </a>
                  <button
                    type="button"
                    onClick={() => void reportPlacement(p.id)}
                    className="text-[11px] text-amber-200"
                  >
                    Report
                  </button>
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

        {panel === "me" && (
          <div className="max-h-64 space-y-3 overflow-y-auto text-sm">
            <p>
              Signed in as <strong>{displayName}</strong>
            </p>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => void saveName()}
              className="w-full rounded-xl bg-white/10 px-4 py-2 text-sm"
            >
              Update name
            </button>
            <p className="text-xs text-white/60">
              Your finds: {myFinds.length} (device) / {foundIds.length} (local)
            </p>
            <p className="text-xs font-semibold text-white/80">Your collection</p>
            {myFinds.slice(0, 8).map((f) => (
              <a
                key={f.placementId + f.createdAt}
                href={`/o/${f.placementId}`}
                className="block text-[11px] text-cyan-200 underline"
              >
                {f.method} find · {new Date(f.createdAt).toLocaleString()}
              </a>
            ))}
            {myFinds.length === 0 && (
              <p className="text-[11px] text-white/45">
                No finds yet — hunt nearby drops or redeem a snap code.
              </p>
            )}
            <p className="text-xs font-semibold text-white/80">Top finders</p>
            {(leaderboard?.topFinders ?? []).slice(0, 5).map((r) => (
              <p key={r.name + r.finds} className="text-[11px] text-white/65">
                {r.name} · {r.finds}
              </p>
            ))}
            <p className="text-xs font-semibold text-white/80">Top droppers</p>
            {(leaderboard?.topDroppers ?? []).slice(0, 5).map((r) => (
              <p key={r.name + r.drops} className="text-[11px] text-white/65">
                {r.name} · {r.drops} drops · {r.foundByOthers} found
              </p>
            ))}
            <p className="text-[11px] leading-relaxed text-white/45">
              Accuracy stack: GPS blend + compass + step dead-reckoning + manual
              N/E fine-tune + snap QR codes + WebXR when the device supports it.
            </p>
          </div>
        )}

        {panel === "admin" && (
          <div className="max-h-64 space-y-3 overflow-y-auto">
            <input
              value={adminPin}
              onChange={(e) => setAdminPin(e.target.value)}
              placeholder="Admin PIN"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => void saveAdminPin()}
              className="w-full rounded-xl bg-white/10 px-4 py-2 text-sm"
            >
              Save admin PIN
            </button>
            <div className="grid grid-cols-[1fr_90px] gap-2">
              <input
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
              />
              <input
                type="number"
                value={zoneRadius}
                onChange={(e) => setZoneRadius(Number(e.target.value))}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none"
              />
            </div>
            <button
              type="button"
              disabled={!isAdmin || busy || geo.lat == null}
              onClick={() => void addBanZoneHere()}
              className="w-full rounded-xl bg-rose-400 px-4 py-2 text-sm font-semibold text-[#2a0a10] disabled:opacity-50"
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
