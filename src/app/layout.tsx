import type { Metadata, Viewport } from "next";
import { Manrope, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Reality — geo AR placements",
  description:
    "Mount digital objects at real-world coordinates and view them on-site with your phone camera.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Reality",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0b1220",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#0b1220] font-[family-name:var(--font-manrope)] text-white">
        {children}
      </body>
    </html>
  );
}
