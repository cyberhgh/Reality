import { NextResponse } from "next/server";
import { connection } from "next/server";
import { isAdminRequest } from "@/lib/admin";
import { evaluatePublicPlace } from "@/lib/publicPlace";
import { listPermits } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Preview whether a lat/lng is eligible before the user commits a drop. */
export async function GET(request: Request) {
  await connection();
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const userId = (searchParams.get("userId") ?? "anonymous").slice(0, 40);

  if (![lat, lng].every(Number.isFinite)) {
    return NextResponse.json(
      { error: "lat and lng required" },
      { status: 400 },
    );
  }

  const permits = await listPermits();
  const eligibility = await evaluatePublicPlace({
    lat,
    lng,
    userId,
    isAdmin: isAdminRequest(request),
    permits,
  });

  return NextResponse.json({
    eligibility,
    policy:
      (process.env.PUBLIC_PLACE_POLICY ?? "on").toLowerCase() !== "off"
        ? "on"
        : "off",
    streetViewConfigured: Boolean(process.env.GOOGLE_MAPS_API_KEY),
  });
}
