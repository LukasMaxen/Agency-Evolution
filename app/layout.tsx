import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Master Inbox — EmailBison",
  description: "Centralized inbox for all EmailBison workspace replies",
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
