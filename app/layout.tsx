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

// Runs before React hydrates — reads saved theme + applies data-theme/dark class
// so the first paint matches the user's saved choice. Prevents FOUC.
const THEME_INIT_SCRIPT = `(function(){try{var k='boardroom:theme';var t=localStorage.getItem(k)||'claude';var light=t==='light';var el=document.documentElement;el.setAttribute('data-theme',t);if(light){el.classList.remove('dark');}else{el.classList.add('dark');}if(t!=='claude'&&t!=='dark'&&t!=='light'&&t!=='midnight'&&t!=='emerald'){var raw=localStorage.getItem('boardroom:custom-themes');if(raw){var list=JSON.parse(raw);var c=list.find(function(x){return x.id===t;});if(c){el.setAttribute('data-theme','custom');for(var k2 in c.colors){el.style.setProperty(k2,c.colors[k2]);}}}}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="claude" className="dark h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
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
