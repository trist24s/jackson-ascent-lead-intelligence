import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jackson Ascent Lead Intelligence",
  description:
    "Lead intelligence and prospect qualification for home-service businesses.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
