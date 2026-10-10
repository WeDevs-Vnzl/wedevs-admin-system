import { ArrowRight, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { BrandMark } from "@/components/app/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Sign-in mock (wireframe 4.1, DT-48, OP-04): the split layout of the brand, with no counters or live data.
// Hito 1 only: both entries navigate to the dashboard. Clerk's <SignIn /> replaces this page in Hito 2.
export async function generateMetadata() {
  const t = await getTranslations("auth.signIn");
  return { title: t("title") };
}

export default async function SignInPage() {
  const t = await getTranslations("auth.signIn");
  const tCommon = await getTranslations("common.app");
  const tFooter = await getTranslations("shell.footer");

  return (
    <div className="grid min-h-dvh bg-muted lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-neutral-950 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <BrandMark inverse />
          <span className="text-base font-semibold tracking-tight">{tCommon("name")}</span>
        </div>

        <svg
          aria-hidden
          viewBox="0 0 400 400"
          className="pointer-events-none absolute right-0 bottom-0 h-3/5 w-3/5 text-white/25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        >
          <path d="M40 300 L120 220 L200 260 L280 160 L360 200 M120 220 L90 120 M200 260 L220 340 M280 160 L330 90 M360 200 L380 330 M90 120 L150 60 L220 110 L280 160" />
          <circle cx="120" cy="220" r="5" fill="currentColor" />
          <circle cx="200" cy="260" r="5" fill="currentColor" />
          <circle cx="280" cy="160" r="5" fill="currentColor" />
          <circle cx="90" cy="120" r="4" fill="currentColor" />
          <circle cx="150" cy="60" r="4" fill="currentColor" />
          <circle cx="330" cy="90" r="4" fill="currentColor" />
        </svg>

        <div className="relative max-w-md space-y-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-xs text-white/70">
            {t("restricted")}
          </span>
          <p className="text-4xl leading-tight font-semibold tracking-tight">{t("headline")}</p>
          <p className="text-lg text-white/60">{t("tagline")}</p>
        </div>

        <p className="relative text-xs text-white/50">
          {tFooter("copyright", { year: new Date().getFullYear() })}
        </p>
      </section>

      <main className="flex min-h-dvh flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl bg-card p-8 text-card-foreground shadow-sm">
          <div className="flex flex-col items-center gap-3 text-center">
            <BrandMark className="size-10 text-base" />
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-foreground/70">{t("subtitle")}</p>
          </div>

          <div className="mt-8 flex flex-col gap-4">
            <Button variant="outline" size="lg" className="w-full" asChild>
              <Link href="/dashboard">{t("google")}</Link>
            </Button>

            <div className="flex items-center gap-3 text-xs text-foreground/70">
              <span className="h-px flex-1 bg-border" />
              {t("or")}
              <span className="h-px flex-1 bg-border" />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="sign-in-email">{t("emailLabel")}</Label>
              <Input
                id="sign-in-email"
                type="email"
                autoComplete="email"
                placeholder={t("emailPlaceholder")}
              />
            </div>

            <Button size="lg" className="w-full" asChild>
              <Link href="/dashboard">
                {t("emailSubmit")}
                <ArrowRight aria-hidden />
              </Link>
            </Button>

            <p className="flex items-center justify-center gap-2 text-center text-xs text-foreground/70">
              <ShieldCheck aria-hidden className="size-4" />
              {t("verification")}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
