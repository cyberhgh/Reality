import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { connection } from "next/server";
import { isAdminRequest } from "@/lib/admin";
import { getStore, updateStore } from "@/lib/store";
import type { BanZone } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await connection();
  const store = await getStore();
  return NextResponse.json({ zones: store.zones });
}

export async function POST(request: Request) {
  await connection();
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Admin only" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    lat?: number;
    lng?: number;
    radiusMeters?: number;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = (body.name ?? "Restricted area").slice(0, 60);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const radiusMeters = Math.min(
    Math.max(Number(body.radiusMeters ?? 40), 10),
    2000,
  );

  if (![lat, lng].every(Number.isFinite)) {
    return NextResponse.json(
      { error: "lat and lng are required" },
      { status: 400 },
    );
  }

  const zone: BanZone = {
    id: randomUUID(),
    name,
    lat,
    lng,
    radiusMeters,
    createdAt: new Date().toISOString(),
  };

  try {
    await updateStore((current) => ({
      ...current,
      zones: [zone, ...current.zones].slice(0, 200),
    }));
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to persist zone",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ zone }, { status: 201 });
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

  try {
    await updateStore((current) => ({
      ...current,
      zones: current.zones.filter((z) => z.id !== id),
    }));
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to persist delete",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true });
}
