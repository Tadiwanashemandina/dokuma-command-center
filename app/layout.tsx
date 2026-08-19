import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans-body" });
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-serif-heading" });

export const metadata: Metadata = {
  title: "Dokuma Command Centre",
  description: "Dokuma AI Executive Command Centre — a live view of projects, finance, people and risk across the company.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn(sans.variable, serif.variable)}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
