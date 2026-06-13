import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { connectedProviders, getProviderToken, makeClient } from "@/lib/providers";

// GET /api/repos — live list of the user's repos across connected providers,
// merged with which ones are currently selected/synced locally.
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const providers = await connectedProviders(userId);
  const selected = await db.repo.findMany({ where: { userId } });
  const selectedMap = new Map(selected.map((r) => [`${r.provider}:${r.fullName}`, r]));

  const lists = await Promise.all(
    providers.map(async (provider) => {
      const token = await getProviderToken(userId, provider);
      if (!token) return [];
      try {
        const repos = await makeClient(provider, token).listRepos();
        return repos.map((r) => {
          const local = selectedMap.get(`${provider}:${r.fullName}`);
          return {
            ...r,
            selected: local?.selected ?? false,
            lastSyncedAt: local?.lastSyncedAt ?? null,
          };
        });
      } catch (e) {
        return [{ provider, error: String(e) } as any];
      }
    }),
  );

  return NextResponse.json({ providers, repos: lists.flat() });
}

// POST /api/repos — set the selected set. Body: { repos: [{provider, fullName, externalId, private}] }
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    repos: { provider: string; fullName: string; externalId?: string; private?: boolean }[];
  };
  const wanted = new Set(body.repos.map((r) => `${r.provider}:${r.fullName}`));

  // Deselect repos no longer wanted.
  const existing = await db.repo.findMany({ where: { userId } });
  for (const r of existing) {
    const key = `${r.provider}:${r.fullName}`;
    if (!wanted.has(key) && r.selected) {
      await db.repo.update({ where: { id: r.id }, data: { selected: false } });
    }
  }
  // Upsert wanted repos as selected.
  for (const r of body.repos) {
    await db.repo.upsert({
      where: { userId_provider_fullName: { userId, provider: r.provider, fullName: r.fullName } },
      create: {
        userId,
        provider: r.provider,
        fullName: r.fullName,
        externalId: r.externalId ?? r.fullName,
        private: r.private ?? false,
        selected: true,
      },
      update: { selected: true, private: r.private ?? false },
    });
  }

  return NextResponse.json({ ok: true });
}
