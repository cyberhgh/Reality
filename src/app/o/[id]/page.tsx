import Link from "next/link";
import { getPlacementById, listFinds, listReactions } from "@/lib/store";

export const dynamic = "force-dynamic";

async function loadComments(placementId: string) {
  const { list } = await import("@vercel/blob");
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL) return [];
  try {
    const { blobs } = await list({ prefix: "comments/", limit: 500 });
    const rows = [];
    for (const blob of blobs) {
      const res = await fetch(`${blob.url}?v=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) continue;
      const c = (await res.json()) as {
        id: string;
        placementId: string;
        userName: string;
        text: string;
        createdAt: string;
      };
      if (c.placementId === placementId) rows.push(c);
    }
    return rows.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  } catch {
    return [];
  }
}

export default async function ObjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const placement = await getPlacementById(id);
  if (!placement) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-lg flex-col justify-center px-6 text-white">
        <p className="text-2xl font-semibold">Object not found</p>
        <Link href="/" className="mt-4 text-cyan-300 underline">
          Back to Reality
        </Link>
      </main>
    );
  }

  const [finds, reactions, comments] = await Promise.all([
    listFinds(id),
    listReactions(id),
    loadComments(id),
  ]);

  return (
    <main className="mx-auto min-h-[100dvh] max-w-lg px-6 py-10 text-white">
      <p className="text-6xl">{placement.emoji}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        {placement.label}
      </h1>
      <p className="mt-2 text-sm text-white/70">
        Dropped by {placement.createdByName}
      </p>
      {placement.note ? (
        <p className="mt-4 rounded-2xl bg-white/5 p-4 text-sm text-white/80">
          Hint: {placement.note}
        </p>
      ) : null}
      {placement.landmarkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={placement.landmarkUrl}
          alt="Landmark"
          className="mt-4 h-48 w-full rounded-2xl object-cover"
        />
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3 text-sm text-white/70">
        <span>{placement.findCount} finds</span>
        <span>{placement.reactionCount} reactions</span>
        <span>Snap {placement.snapCode}</span>
      </div>
      <div className="mt-6 flex flex-col gap-3">
        <Link
          href={`/?focus=${placement.id}`}
          className="rounded-xl bg-cyan-400 px-4 py-3 text-center text-sm font-semibold text-[#06202b]"
        >
          Open in camera
        </Link>
        <Link
          href={`/snap/${placement.snapCode}`}
          className="rounded-xl bg-white/10 px-4 py-3 text-center text-sm"
        >
          Snap page
        </Link>
        <a
          href={`https://maps.apple.com/?ll=${placement.lat},${placement.lng}&q=${encodeURIComponent(placement.label)}`}
          className="rounded-xl bg-white/10 px-4 py-3 text-center text-sm"
        >
          Open in Maps
        </a>
      </div>
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-white/80">Recent finds</h2>
        <ul className="mt-2 space-y-1 text-xs text-white/60">
          {finds.slice(0, 12).map((f) => (
            <li key={f.id}>
              {f.finderName} via {f.method}
            </li>
          ))}
          {finds.length === 0 && <li>No finds yet — be the first.</li>}
        </ul>
      </section>
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-white/80">Reactions</h2>
        <p className="mt-2 text-lg">
          {reactions
            .slice(0, 40)
            .map((r) => r.emoji)
            .join(" ") || "—"}
        </p>
      </section>
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-white/80">Comments</h2>
        <ul className="mt-2 space-y-2 text-sm text-white/70">
          {comments.slice(0, 20).map((c) => (
            <li key={c.id} className="rounded-xl bg-white/5 px-3 py-2">
              <span className="text-white/90">{c.userName}</span>: {c.text}
            </li>
          ))}
          {comments.length === 0 && (
            <li className="text-xs text-white/45">No comments yet.</li>
          )}
        </ul>
      </section>
    </main>
  );
}
