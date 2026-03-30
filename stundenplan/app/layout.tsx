import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PHWT Studienplan",
  description: "Dein persönlicher Stundenplan",
  manifest: "/manifest.json",
  themeColor: "#0f1117",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0f1117" />
      </head>
      <body className="bg-[#0f1117]">{children}</body>
    </html>
  );
}
