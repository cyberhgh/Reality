import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { connection } from "next/server";
import { distance3DMeters } from "@/lib/geo";
import {
  addFind,
  getPlacementById,
  getPlacementBySnapCode,
  listFinds,
  updatePlacement,
} from "@/lib/store";
import { FIND_RADIUS_METERS, type FindEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await connection();
  const { searchParams } = new URL(request.url);
  const placementId = searchParams.get("placementId") ?? undefined;
  const finds = await listFinds(placementId);
  finds.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return NextResponse.json({ finds: finds.slice(0, 100) });
}

export async function POST(request: Request) {
  await connection();
  const body = (await request.json().catch(() => null)) as {
    placementId?: string;
    snapCode?: string;
    finderId?: string;
    finderName?: string;
    lat?: number;
    lng?: number;
    altitude?: number | null;
    method?: "gps" | "snap" | "manual";
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const method = body.method ?? (body.snapCode ? "snap" : "gps");
  let placement = body.placementId
    ? await getPlacementById(body.placementId)
    : null;
  if (!placement && body.snapCode) {
    placement = await getPlacementBySnapCode(body.snapCode);
  }
  if (!placement) {
    return NextResponse.json({ error: "Placement not found" }, { status: 404 });
  }

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const altitude =
    body.altitude != null && Number.isFinite(Number(body.altitude))
      ? Number(body.altitude)
      : null;
  const finderId = (body.finderId ?? "anonymous").slice(0, 40);
  const finderName = (body.finderName ?? "Explorer").slice(0, 24);

  if (method === "gps") {
    if (![lat, lng].every(Number.isFinite)) {
      return NextResponse.json(
        { error: "lat/lng required for GPS finds" },
        { status: 400 },
      );
    }
    const dist = distance3DMeters(
      lat,
      lng,
      placement.lat,
      placement.lng,
      altitude,
      placement.altitude,
    );
    if (dist > FIND_RADIUS_METERS) {
      return NextResponse.json(
        {
          error: `Get closer to mark as found (within ${FIND_RADIUS_METERS}m, you are ${Math.round(dist)}m away).`,
          code: "TOO_FAR",
          distanceMeters: dist,
        },
        { status: 403 },
      );
    }
  }

  const existing = await listFinds(placement.id);
  if (existing.some((f) => f.finderId === finderId)) {
    return NextResponse.json({
      ok: true,
      alreadyFound: true,
      placement,
      finds: existing,
    });
  }

  const find: FindEvent = {
    id: randomUUID(),
    placementId: placement.id,
    finderId,
    finderName,
    method,
    lat: Number.isFinite(lat) ? lat : placement.lat,
    lng: Number.isFinite(lng) ? lng : placement.lng,
    createdAt: new Date().toISOString(),
  };

  await addFind(find);
  const updated = {
    ...placement,
    findCount: (placement.findCount ?? 0) + 1,
  };
  await updatePlacement(updated);

  return NextResponse.json(
    { ok: true, find, placement: updated },
    { status: 201 },
  );
}
