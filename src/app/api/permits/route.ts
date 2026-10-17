import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { connection } from "next/server";
import { isAdminRequest } from "@/lib/admin";
import type { LandPermit } from "@/lib/publicPlace";
import { listPermits, savePermit } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await connection();
  const { searchParams } = new URL(request.url);
  const ownerId = searchParams.get("ownerId");
  const status = searchParams.get("status");
  let permits = await listPermits();
  if (ownerId) permits = permits.filter((p) => p.ownerId === ownerId);
  if (status) permits = permits.filter((p) => p.status === status);
  permits.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return NextResponse.json({ permits });
}

export async function POST(request: Request) {
  await connection();
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    lat?: number;
    lng?: number;
    radiusMeters?: number;
    ownerId?: string;
    ownerName?: string;
    allowedUserIds?: string[];
    makePublic?: boolean;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (![lat, lng].every(Number.isFinite)) {
    return NextResponse.json({ error: "lat/lng required" }, { status: 400 });
  }

  const admin = isAdminRequest(request);
  const permit: LandPermit = {
    id: randomUUID(),
    name: (body.name ?? "Private land").slice(0, 80),
    lat,
    lng,
    radiusMeters: Math.min(Math.max(Number(body.radiusMeters ?? 40), 10), 500),
    ownerId: (body.ownerId ?? "anonymous").slice(0, 40),
    ownerName: (body.ownerName ?? "Owner").slice(0, 24),
    allowedUserIds: body.allowedUserIds?.map((id) => id.slice(0, 40)) ?? [],
    status: admin ? "approved" : "pending",
    makePublic: body.makePublic !== false,
    createdAt: new Date().toISOString(),
    approvedAt: admin ? new Date().toISOString() : null,
  };

  await savePermit(permit);
  return NextResponse.json({ permit }, { status: 201 });
}

export async function PATCH(request: Request) {
  await connection();
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Admin only" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    id?: string;
    status?: "approved" | "revoked" | "pending";
  } | null;

  if (!body?.id || !body.status) {
    return NextResponse.json(
      { error: "id and status required" },
      { status: 400 },
    );
  }

  const permits = await listPermits();
  const existing = permits.find((p) => p.id === body.id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated: LandPermit = {
    ...existing,
    status: body.status,
    approvedAt:
      body.status === "approved" ? new Date().toISOString() : existing.approvedAt,
  };
  await savePermit(updated);
  return NextResponse.json({ permit: updated });
}
