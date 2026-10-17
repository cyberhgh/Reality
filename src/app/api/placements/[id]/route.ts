import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getPlacementById, listFinds, listReactions } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await connection();
  const { id } = await context.params;
  const placement = await getPlacementById(id);
  if (!placement) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [finds, reactions] = await Promise.all([
    listFinds(id),
    listReactions(id),
  ]);
  return NextResponse.json({ placement, finds, reactions });
}
