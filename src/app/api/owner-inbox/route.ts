import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pending drops waiting for this property owner's approval. */
export async function GET(request: Request) {
  await connection();
  const ownerId = new URL(request.url).searchParams.get("ownerId");
  if (!ownerId) {
    return NextResponse.json({ error: "ownerId required" }, { status: 400 });
  }

  const store = await getStore();
  const pending = store.placements
    .filter(
      (p) =>
        p.visibility === "pending_owner" && p.landOwnerId === ownerId,
    )
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  return NextResponse.json({ pending });
}
