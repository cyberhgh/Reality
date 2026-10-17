import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { connection } from "next/server";
import { getPlacementById, updatePlacement } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await connection();
  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart form" }, { status: 400 });
  }

  const placementId = String(form.get("placementId") ?? "");
  const file = form.get("file");
  if (!placementId || !(file instanceof File)) {
    return NextResponse.json(
      { error: "placementId and file required" },
      { status: 400 },
    );
  }

  if (file.size > 2_500_000) {
    return NextResponse.json({ error: "Max image size 2.5MB" }, { status: 400 });
  }

  const placement = await getPlacementById(placementId);
  if (!placement) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL) {
    return NextResponse.json(
      { error: "Blob storage not configured for landmarks" },
      { status: 503 },
    );
  }

  const ext = file.type.includes("png") ? "png" : "jpg";
  const blob = await put(`landmarks/${placementId}.${ext}`, file, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: file.type || "image/jpeg",
  });

  const updated = {
    ...placement,
    landmarkUrl: blob.url,
  };
  await updatePlacement(updated);

  return NextResponse.json({ url: blob.url, placement: updated });
}
