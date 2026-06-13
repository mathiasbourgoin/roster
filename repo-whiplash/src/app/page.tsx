import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const hasGitHub = !!process.env.AUTH_GITHUB_ID;
  const hasGitLab = !!process.env.AUTH_GITLAB_ID;

  return (
    <main className="container">
      <div className="hero">
        <div className="kicker">AI Engineering Report · on your own repos</div>
        <h1>The Acceleration Whiplash, measured.</h1>
        <p>
          Connect your GitHub and GitLab repositories — including private ones — and reproduce the
          metrics from the 2026 AI Engineering Report against your real history. Throughput, code
          complexity, review load, flow, and production quality. Per repo, aggregated, and evolving
          over time.
        </p>
        <div className="row" style={{ justifyContent: "center" }}>
          {hasGitHub && (
            <form
              action={async () => {
                "use server";
                await signIn("github", { redirectTo: "/dashboard" });
              }}
            >
              <button className="btn btn-primary" type="submit">
                Connect GitHub
              </button>
            </form>
          )}
          {hasGitLab && (
            <form
              action={async () => {
                "use server";
                await signIn("gitlab", { redirectTo: "/dashboard" });
              }}
            >
              <button className="btn" type="submit">
                Connect GitLab
              </button>
            </form>
          )}
        </div>
        {!hasGitHub && !hasGitLab && (
          <p className="faint" style={{ marginTop: 24 }}>
            No OAuth providers configured. Copy <code>.env.example</code> to <code>.env</code> and set
            the GitHub / GitLab client IDs and secrets, then restart.
          </p>
        )}
      </div>
    </main>
  );
}
