import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Repo Whiplash — AI Engineering impact analyzer",
  description:
    "Connect GitHub & GitLab repositories and measure the Acceleration Whiplash on your own code — per repo, aggregated, and over time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
