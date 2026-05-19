import type { Metadata } from "next";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  display: "swap",
});

export const viewport = {
  themeColor: "#1e6075",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://yuugen.bot"),
  title: "Yuugen — Manage Your Discord Community with Elegance",
  description: "A gorgeous modern Discord bot with immersive high-quality music, a balanced global economy, and comprehensive server management tools.",
  applicationName: "Yuugen",
  authors: [{ name: "Yuugen Team" }],
  keywords: ["Discord Bot", "Music Player", "Economy", "Dashboard", "Yuugen", "Lavalink"],
  openGraph: {
    title: "Yuugen — The Premium Discord Bot",
    description: "Immersive high-quality music, balanced global economy, and elegant server management.",
    url: "https://yuugen.bot",
    siteName: "Yuugen",
    images: [
      {
        url: "/logo.svg",
        width: 512,
        height: 512,
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Yuugen — The Premium Discord Bot",
    description: "Immersive high-quality music, balanced global economy, and elegant server management.",
    images: ["/logo.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${plusJakartaSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-brand-bg-darker text-white" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

