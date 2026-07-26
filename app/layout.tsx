import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Reply Desk",
  description: "AI-powered reply management for all EmailBison workspaces",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="antialiased h-full font-sans">
        {children}
      </body>
    </html>
  );
}
