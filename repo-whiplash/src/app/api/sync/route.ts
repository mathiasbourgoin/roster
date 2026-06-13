import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { syncRepo } from "@/lib/sync";
import type { Provider } from "@/lib/providers";

// POST /api/sync — fetch + cache data for the user's selected repos.
// Body (optional): { months?: number, maxPages?: number, repoIds?: string[] }
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    months?: number;
    maxPages?: number;
    repoIds?: string[];
  };

  const repos = await db.repo.findMany({
    where: { userId, selected: true, ...(body.repoIds ? { id: { in: body.repoIds } } : {}) },
    select: { provider: true, fullName: true },
  });
  if (repos.length === 0) {
    return NextResponse.json({ error: "no selected repositories" }, { status: 400 });
  }

  const results = [];
  const errors = [];
  for (const r of repos) {
    try {
      results.push(
        await syncRepo(userId, r.provider as Provider, r.fullName, {
          months: body.months,
          maxPages: body.maxPages,
        }),
      );
    } catch (e) {
      errors.push({ repo: r.fullName, error: String(e) });
    }
  }

  return NextResponse.json({ ok: errors.length === 0, results, errors });
}
