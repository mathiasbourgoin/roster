import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { computeAnalysis } from "@/lib/analysis/compute";

// GET /api/analysis?cutoff=YYYY-MM-DD&from=...&to=...&repoIds=a,b
export async function GET(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const repoIdsParam = url.searchParams.get("repoIds");
  const result = await computeAnalysis(userId, {
    cutoff: url.searchParams.get("cutoff") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    repoIds: repoIdsParam ? repoIdsParam.split(",").filter(Boolean) : undefined,
  });

  return NextResponse.json(result);
}
