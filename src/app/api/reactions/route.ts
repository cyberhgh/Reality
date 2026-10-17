import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { connection } from "next/server";
import {
  addReaction,
  getPlacementById,
  listReactions,
  updatePlacement,
} from "@/lib/store";
import { REACTION_EMOJIS, type Reaction } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await connection();
  const { searchParams } = new URL(request.url);
  const placementId = searchParams.get("placementId") ?? undefined;
  const reactions = await listReactions(placementId);
  return NextResponse.json({ reactions });
}

export async function POST(request: Request) {
  await connection();
  const body = (await request.json().catch(() => null)) as {
    placementId?: string;
    userId?: string;
    userName?: string;
    emoji?: string;
  } | null;

  if (!body?.placementId || !body.emoji) {
    return NextResponse.json(
      { error: "placementId and emoji required" },
      { status: 400 },
    );
  }

  if (!REACTION_EMOJIS.includes(body.emoji)) {
    return NextResponse.json({ error: "Invalid reaction" }, { status: 400 });
  }

  const placement = await getPlacementById(body.placementId);
  if (!placement) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const reaction: Reaction = {
    id: randomUUID(),
    placementId: body.placementId,
    userId: (body.userId ?? "anonymous").slice(0, 40),
    userName: (body.userName ?? "Explorer").slice(0, 24),
    emoji: body.emoji,
    createdAt: new Date().toISOString(),
  };

  await addReaction(reaction);
  const reactions = await listReactions(placement.id);
  const updated = { ...placement, reactionCount: reactions.length };
  await updatePlacement(updated);

  return NextResponse.json({ reaction, placement: updated }, { status: 201 });
}
