import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { connectedProviders } from "@/lib/providers";
import DashboardClient from "@/components/DashboardClient";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const providers = await connectedProviders(session.user.id);

  return (
    <main className="container">
      <header className="row spread" style={{ marginBottom: 8 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>Repo Whiplash</h1>
          <div className="faint">
            Signed in as {session.user.name ?? session.user.email} · connected:{" "}
            {providers.join(", ") || "none"}
          </div>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button className="btn" type="submit">
            Sign out
          </button>
        </form>
      </header>
      <DashboardClient />
    </main>
  );
}
