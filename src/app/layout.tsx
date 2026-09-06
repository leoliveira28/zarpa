import type { Metadata, Viewport } from "next";
import { Libre_Franklin } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/app/Providers";
import { APP_NAME, APP_TAGLINE } from "@/lib/ui/brand";
import { themeBootstrapScript } from "@/lib/ui/theme";

// Display: so titulo de pagina e capa de proposta. A interface segue em system-ui.
const display = Libre_Franklin({
  subsets: ["latin"],
  weight: ["300", "400", "600", "700", "800"],
  variable: "--font-libre-franklin",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_TAGLINE,
};

export const viewport: Viewport = {
  // sem maximumScale: bloquear zoom é retirar acessibilidade de quem enxerga mal
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f3f0" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1114" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`h-full ${display.variable}`} suppressHydrationWarning>
      <head>
        {/* Antes do primeiro paint: sem isso a tela pisca clara antes de escurecer. */}
        <script
          dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
        />
      </head>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
