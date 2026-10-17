import { NextResponse } from "next/server";
import { connection } from "next/server";
import { distanceMeters } from "@/lib/geo";
import { getStore, listFinds } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await connection();
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const store = await getStore();
  const finds = await listFinds();

  const recent = [...store.placements]
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 30)
    .map((p) => ({
      ...p,
      distanceMeters:
        Number.isFinite(lat) && Number.isFinite(lng)
          ? distanceMeters(lat, lng, p.lat, p.lng)
          : null,
    }));

  const popular = [...store.placements]
    .sort((a, b) => (b.findCount ?? 0) - (a.findCount ?? 0))
    .slice(0, 20);

  const activity = finds
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 40)
    .map((f) => {
      const p = store.placements.find((x) => x.id === f.placementId);
      return {
        ...f,
        emoji: p?.emoji ?? "🗿",
        label: p?.label ?? "Object",
      };
    });

  return NextResponse.json({ recent, popular, activity });
}
