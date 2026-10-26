import type { Metadata } from "next";
import { Fredoka, Rubik } from "next/font/google";
import "./globals.css";

// Display — chunky rounded bubbles that match the clay. Hero + short headers ONLY.
const fredoka = Fredoka({
  subsets: ["latin"],
  variable: "--font-fredoka",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Body + UI — rounded but legible at small sizes. Carries all body, labels, captions.
const rubik = Rubik({
  subsets: ["latin"],
  variable: "--font-rubik",
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Verdure — Step Outside. Connect Within.",
  description:
    "Verdure is a gamified community-discovery platform that helps young people find local events, outdoor spaces, and opportunities to connect with their community.",
  keywords: [
    "outdoor exploration",
    "community",
    "gamification",
    "neighborhood",
    "adventure",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${fredoka.variable} ${rubik.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
