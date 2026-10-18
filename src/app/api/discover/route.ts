import { NextResponse } from "next/server";
import { connection } from "next/server";
import { distanceMeters } from "@/lib/geo";
import { canViewerSeePlacement, getStore, listFinds } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await connection();
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const viewerId = searchParams.get("viewerId");
  const store = await getStore();
  const finds = await listFinds();

  const visible = store.placements.filter((p) =>
    canViewerSeePlacement(p, viewerId),
  );

  const recent = [...visible]
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 30)
    .map((p) => ({
      ...p,
      distanceMeters:
        Number.isFinite(lat) && Number.isFinite(lng)
          ? distanceMeters(lat, lng, p.lat, p.lng)
          : null,
    }));

  const popular = [...visible]
    .filter((p) => (p.visibility ?? "public") === "public")
    .sort((a, b) => (b.findCount ?? 0) - (a.findCount ?? 0))
    .slice(0, 20);

  const activity = finds
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 40)
    .map((f) => {
      const p = visible.find((x) => x.id === f.placementId);
      if (!p) return null;
      return {
        ...f,
        emoji: p.emoji ?? "🗿",
        label: p.label ?? "Object",
      };
    })
    .filter(Boolean);

  return NextResponse.json({ recent, popular, activity });
}
