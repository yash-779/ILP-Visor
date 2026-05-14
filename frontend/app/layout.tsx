import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ILP-Visor — Cycle-Accurate OoOE Visualizer",
description:
"An educational x86-64 Out-of-Order Execution simulator visualizing the Reorder Buffer, superscalar dispatch, data forwarding, and branch misprediction flushes cycle-by-cycle.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}