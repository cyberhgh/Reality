import { NextResponse } from "next/server";
import { connection } from "next/server";
import { isAdminRequest } from "@/lib/admin";
import {
  canViewerSeePlacement,
  getPlacementById,
  listFinds,
  listReactions,
  updatePlacement,
} from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await connection();
  const { id } = await context.params;
  const viewerId = new URL(request.url).searchParams.get("viewerId");
  const placement = await getPlacementById(id);
  if (!placement) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canViewerSeePlacement(placement, viewerId)) {
    return NextResponse.json(
      {
        error:
          "This drop is private or waiting for the property owner to approve public visibility.",
        code: "NOT_VISIBLE",
      },
      { status: 403 },
    );
  }
  const [finds, reactions] = await Promise.all([
    listFinds(id),
    listReactions(id),
  ]);
  return NextResponse.json({ placement, finds, reactions });
}

/**
 * Property owner (or admin) approves/rejects public visibility for a pending drop.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await connection();
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    action?: "approve_public" | "keep_private";
    actorId?: string;
  } | null;

  if (!body?.action || !body.actorId) {
    return NextResponse.json(
      { error: "action and actorId required" },
      { status: 400 },
    );
  }

  const placement = await getPlacementById(id);
  if (!placement) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = isAdminRequest(request);
  const isOwner = placement.landOwnerId === body.actorId;
  if (!admin && !isOwner) {
    return NextResponse.json(
      { error: "Only the property owner can change visibility" },
      { status: 401 },
    );
  }

  if (placement.visibility === "public" && body.action === "approve_public") {
    return NextResponse.json({ placement, alreadyPublic: true });
  }

  const updated = {
    ...placement,
    visibility:
      body.action === "approve_public"
        ? ("public" as const)
        : ("private" as const),
  };
  await updatePlacement(updated);

  return NextResponse.json({
    placement: updated,
    message:
      body.action === "approve_public"
        ? "Drop is now visible to everyone."
        : "Drop kept private (only the creator can see it).",
  });
}
