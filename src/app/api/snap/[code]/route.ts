import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getPlacementBySnapCode, listFinds, listReactions } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  await connection();
  const { code } = await context.params;
  const placement = await getPlacementBySnapCode(code);
  if (!placement) {
    return NextResponse.json({ error: "Snap code not found" }, { status: 404 });
  }
  const [finds, reactions] = await Promise.all([
    listFinds(placement.id),
    listReactions(placement.id),
  ]);
  return NextResponse.json({ placement, finds, reactions });
}
