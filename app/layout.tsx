import type { Metadata } from "next"

import type { ReactNode } from "react"
import { Geist_Mono, Inter } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { VaultApp } from "@/components/vault/vault-app"
import { cn } from "@/lib/utils"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "UNG Password Manager",
  description: "A secure and accessible password-manager project.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "font-sans antialiased",
        fontMono.variable,
        inter.variable
      )}
    >
      <body>
        <ThemeProvider>
          <VaultApp>{children}</VaultApp>
        </ThemeProvider>
      </body>
    </html>
  )
}
