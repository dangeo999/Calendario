// src/app/layout.tsx
import './globals.css'

export const metadata = {
  manifest: "/manifest.json",
  themeColor: "#0D9488",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png"
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <head>
        {/* Roboto + Material Symbols */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0"
          rel="stylesheet"
        />
        {/* CSS FullCalendar (una sola volta qui) */}
        <link rel="stylesheet" href="/fc/core.css" />
        <link rel="stylesheet" href="/fc/daygrid.css" />
        <link rel="stylesheet" href="/fc/timegrid.css" />
      </head>
      <body>{children}</body>
    </html>
  )
}
