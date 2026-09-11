import type { Metadata } from "next";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { Toaster } from "react-hot-toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eitekh WorkOS | Multi-Tenant Work & Issue Tracking Platform",
  description: "Enterprise project management, issue tracking, and agile workflows.",
  icons: {
    icon: "/leaf-logo.png",
    shortcut: "/leaf-logo.png",
    apple: "/leaf-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased min-h-screen bg-background text-foreground" suppressHydrationWarning>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
