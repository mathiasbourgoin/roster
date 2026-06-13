import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import GitLab from "next-auth/providers/gitlab";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";

const gitlabBase = process.env.GITLAB_BASE_URL ?? "https://gitlab.com";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "database" },
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      // `repo` is required to read private repositories; `read:org` helps list org repos.
      authorization: { params: { scope: "read:user user:email repo read:org" } },
    }),
    GitLab({
      clientId: process.env.AUTH_GITLAB_ID,
      clientSecret: process.env.AUTH_GITLAB_SECRET,
      authorization: {
        url: `${gitlabBase}/oauth/authorize`,
        params: { scope: "read_user read_api read_repository" },
      },
      token: `${gitlabBase}/oauth/token`,
      userinfo: `${gitlabBase}/api/v4/user`,
    }),
  ],
  pages: { signIn: "/" },
  callbacks: {
    // database strategy: expose the user id on the session for server routes.
    session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
});
