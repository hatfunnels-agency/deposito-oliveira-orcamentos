import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orçamentos - Depósito Oliveira",
    description: "Sistema de orçamentos do Depósito L & J Oliveira",
    };

    export default function RootLayout({
      children,
      }: Readonly<{
        children: React.ReactNode;
        }>) {
          return (
              <html lang="pt-BR">
                    <body className="bg-gray-50 min-h-screen">
                            {children}
                                  </body>
                                      </html>
                                        );
                                        }