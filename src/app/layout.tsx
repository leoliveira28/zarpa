import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/app/Providers";
import { APP_NAME, APP_TAGLINE } from "@/lib/ui/brand";
import { themeBootstrapScript } from "@/lib/ui/theme";

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
    { media: "(prefers-color-scheme: light)", color: "#f3f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0a131a" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className="h-full">
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
