import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getStore, listFinds } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await connection();
  const [store, finds] = await Promise.all([getStore(), listFinds()]);

  const finders = new Map<string, { name: string; finds: number }>();
  for (const f of finds) {
    const row = finders.get(f.finderId) ?? { name: f.finderName, finds: 0 };
    row.finds += 1;
    row.name = f.finderName;
    finders.set(f.finderId, row);
  }

  const droppers = new Map<
    string,
    { name: string; drops: number; foundByOthers: number }
  >();
  for (const p of store.placements) {
    const row = droppers.get(p.createdBy) ?? {
      name: p.createdByName,
      drops: 0,
      foundByOthers: 0,
    };
    row.drops += 1;
    row.foundByOthers += p.findCount ?? 0;
    row.name = p.createdByName;
    droppers.set(p.createdBy, row);
  }

  return NextResponse.json({
    topFinders: [...finders.values()]
      .sort((a, b) => b.finds - a.finds)
      .slice(0, 20),
    topDroppers: [...droppers.values()]
      .sort((a, b) => b.foundByOthers - a.foundByOthers || b.drops - a.drops)
      .slice(0, 20),
  });
}
