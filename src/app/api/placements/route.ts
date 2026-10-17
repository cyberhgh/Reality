import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { isAdminRequest } from "@/lib/admin";
import { distanceMeters, pointInCircle } from "@/lib/geo";
import { getStore, updateStore } from "@/lib/store";
import {
  NEARBY_RADIUS_METERS,
  PRESENCE_RADIUS_METERS,
  type Placement,
} from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const radius = Number(searchParams.get("radius") ?? NEARBY_RADIUS_METERS);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { error: "lat and lng are required" },
      { status: 400 },
    );
  }

  const store = await getStore();
  const nearby = store.placements
    .map((p) => ({
      ...p,
      distanceMeters: distanceMeters(lat, lng, p.lat, p.lng),
    }))
    .filter((p) => p.distanceMeters <= radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  return NextResponse.json({ placements: nearby });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    emoji?: string;
    label?: string;
    lat?: number;
    lng?: number;
    userLat?: number;
    userLng?: number;
    createdBy?: string;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const emoji = (body.emoji ?? "🗿").slice(0, 8);
  const label = (body.label ?? "Untitled").slice(0, 40);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const userLat = Number(body.userLat);
  const userLng = Number(body.userLng);
  const createdBy = (body.createdBy ?? "anonymous").slice(0, 40);
  const admin = isAdminRequest(request);

  if (![lat, lng, userLat, userLng].every(Number.isFinite)) {
    return NextResponse.json(
      { error: "lat, lng, userLat, and userLng are required" },
      { status: 400 },
    );
  }

  const distanceFromUser = distanceMeters(userLat, userLng, lat, lng);
  if (!admin && distanceFromUser > PRESENCE_RADIUS_METERS) {
    return NextResponse.json(
      {
        error: `You must be within ${PRESENCE_RADIUS_METERS}m of the placement spot (you are ${Math.round(distanceFromUser)}m away).`,
        code: "NOT_PRESENT",
      },
      { status: 403 },
    );
  }

  const store = await getStore();
  const banned = store.zones.find((z) =>
    pointInCircle(lat, lng, z.lat, z.lng, z.radiusMeters),
  );
  if (banned) {
    return NextResponse.json(
      {
        error: `Placement blocked: "${banned.name}" is a no-placement zone.`,
        code: "BANNED_ZONE",
        zone: banned,
      },
      { status: 403 },
    );
  }

  const placement: Placement = {
    id: randomUUID(),
    emoji,
    label,
    lat,
    lng,
    createdAt: new Date().toISOString(),
    createdBy,
    byAdmin: admin,
  };

  await updateStore((current) => ({
    ...current,
    placements: [placement, ...current.placements].slice(0, 500),
  }));

  return NextResponse.json({ placement }, { status: 201 });
}

export async function DELETE(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Admin only" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await updateStore((current) => ({
    ...current,
    placements: current.placements.filter((p) => p.id !== id),
  }));

  return NextResponse.json({ ok: true });
}
