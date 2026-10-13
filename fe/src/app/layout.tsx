import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ThemeProvider } from "@/components/app/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

// Root providers (frontend-patterns §2): i18n, theme (class strategy), URL state, toasts and tooltips.
export async function generateMetadata() {
  const t = await getTranslations("common.app");
  return { title: t("name") };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();

  return (
    <html lang={locale} suppressHydrationWarning className={cn("font-sans", inter.variable)}>
      <body>
        <NextIntlClientProvider>
          <ThemeProvider>
            <NuqsAdapter>
              <TooltipProvider>
                {children}
                <Toaster />
              </TooltipProvider>
            </NuqsAdapter>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
