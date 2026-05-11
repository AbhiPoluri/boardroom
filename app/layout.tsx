import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader, JetBrains_Mono } from "next/font/google";
import AppShell from "@/components/AppShell";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Warm-editorial cockpit stack: Newsreader for serif moments, JetBrains Mono everywhere else.
const newsreader = Newsreader({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Boardroom — Agent Orchestration",
  description: "Spin up and manage Claude Code / Codex agents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="claude" className="dark h-full">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} ${jetBrainsMono.variable} antialiased bg-[var(--br-bg-primary)] text-[var(--br-text-primary)] h-full`}
      >
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
