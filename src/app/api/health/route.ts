import { NextResponse } from "next/server";
import { persistenceMode } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    persistence: persistenceMode(),
    time: new Date().toISOString(),
  });
}
