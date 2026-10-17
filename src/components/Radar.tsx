"use client";

import { useMemo } from "react";
import { bearingDegrees, normalizeHeadingDelta } from "@/lib/geo";

type RadarItem = {
  id: string;
  emoji: string;
  lat: number;
  lng: number;
  distanceMeters: number;
};

export default function Radar({
  userLat,
  userLng,
  heading,
  items,
  selectedId,
}: {
  userLat: number;
  userLng: number;
  heading: number | null;
  items: RadarItem[];
  selectedId: string | null;
}) {
  const dots = useMemo(() => {
    const maxR = 80;
    return items.slice(0, 12).map((item) => {
      const bearing = bearingDegrees(userLat, userLng, item.lat, item.lng);
      const rel =
        heading != null ? normalizeHeadingDelta(bearing - heading) : bearing;
      const rad = (rel * Math.PI) / 180;
      const clamped = Math.min(item.distanceMeters, maxR);
      const r = (clamped / maxR) * 42;
      return {
        ...item,
        x: 50 + Math.sin(rad) * r,
        y: 50 - Math.cos(rad) * r,
      };
    });
  }, [items, userLat, userLng, heading]);

  return (
    <div className="relative mx-auto h-28 w-28 rounded-full border border-cyan-300/40 bg-black/45">
      <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300" />
      <div className="absolute left-1/2 top-2 -translate-x-1/2 text-[9px] text-cyan-200/80">
        N
      </div>
      {dots.map((d) => (
        <div
          key={d.id}
          className={`absolute -translate-x-1/2 -translate-y-1/2 text-[10px] ${
            selectedId === d.id ? "scale-125" : "opacity-80"
          }`}
          style={{ left: `${d.x}%`, top: `${d.y}%` }}
          title={`${Math.round(d.distanceMeters)}m`}
        >
          {d.emoji}
        </div>
      ))}
    </div>
  );
}
