import Link from "next/link";
import { getPlacementBySnapCode } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function SnapPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const placement = await getPlacementBySnapCode(code);

  if (!placement) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-lg flex-col justify-center px-6 text-white">
        <p className="text-2xl font-semibold">Unknown snap code</p>
        <Link href="/" className="mt-4 text-cyan-300 underline">
          Back to Reality
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-lg flex-col justify-center px-6 text-white">
      <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">
        Precise snap
      </p>
      <p className="mt-3 text-6xl">{placement.emoji}</p>
      <h1 className="mt-3 text-3xl font-semibold">{placement.label}</h1>
      <p className="mt-2 text-sm text-white/70">
        Code <strong>{placement.snapCode}</strong> unlocks this drop without
        relying on GPS accuracy — post this page/QR at the physical spot.
      </p>
      <Link
        href={`/?snap=${placement.snapCode}`}
        className="mt-8 rounded-xl bg-cyan-400 px-4 py-3 text-center text-sm font-semibold text-[#06202b]"
      >
        Claim find with this snap
      </Link>
      <Link
        href={`/o/${placement.id}`}
        className="mt-3 rounded-xl bg-white/10 px-4 py-3 text-center text-sm"
      >
        Object page
      </Link>
    </main>
  );
}
