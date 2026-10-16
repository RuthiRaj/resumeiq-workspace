import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "ResumeIQ Workspace — Your truth, in every resume",
  description:
    "Maintain your career information once, keep your standard resume synchronized, and generate tailored, evidence-based resumes for every application.",
};

/**
 * Root layout is a pure server component: fonts, grain, nothing else.
 * Client providers live per route group — (app)/ mounts QueryProvider +
 * Toaster, so marketing routes ship neither @tanstack/react-query, zustand
 * toasts, nor the dev MSW starter.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/* Cinematic film grain overlay (static, ~3.5% opacity, PRD §7.2). */}
        <div className="grain-overlay" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
