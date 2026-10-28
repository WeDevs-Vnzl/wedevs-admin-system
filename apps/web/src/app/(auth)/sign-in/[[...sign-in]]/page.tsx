import { SignIn, SignOutButton } from "@clerk/nextjs";
import { getTranslations } from "next-intl/server";
import { BrandMark } from "@/components/app/brand-mark";
import { Button } from "@/components/ui/button";
import { signInAppearance } from "../clerk-appearance";

// Sign-in (wireframe 4.1, DT-48, OP-04): the split layout of the brand, with no counters or live data, around
// Clerk's <SignIn /> (Google + e-mail code, invitation only). `?reason=no-access` is a Clerk user the BE answers
// 401 (Q-BE1-2): the form is replaced by the no-access message and a sign-out action.
export async function generateMetadata() {
  const t = await getTranslations("auth.signIn");
  return { title: t("title") };
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const noAccess = reason === "no-access";
  const t = await getTranslations("auth.signIn");
  const tCommon = await getTranslations("common.app");
  const tFooter = await getTranslations("shell.footer");

  return (
    <div className="grid min-h-dvh bg-muted lg:grid-cols-2">
      <section className="relative hidden flex-col overflow-hidden bg-neutral-950 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <BrandMark inverse />
          <span className="text-base font-semibold tracking-tight">{tCommon("name")}</span>
        </div>

        {/* Decorative network: it owns the free space between the brand and the headline, so its lines never run
            behind any text (D5). The stroke is light on the dark panel in both themes. */}
        <div
          aria-hidden
          className="pointer-events-none flex min-h-0 flex-1 items-center justify-end py-8"
        >
          <svg
            aria-hidden
            viewBox="0 0 400 400"
            className="h-full max-h-80 w-auto max-w-full text-white/30"
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
        </div>

        <div className="max-w-md space-y-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-xs text-white/70">
            {t("restricted")}
          </span>
          <p className="text-4xl leading-tight font-semibold tracking-tight">{t("headline")}</p>
          <p className="text-lg text-white/60">{t("tagline")}</p>
        </div>

        <p className="mt-12 text-xs text-white/50">
          {tFooter("copyright", { year: new Date().getFullYear() })}
        </p>
      </section>

      <main className="flex min-h-dvh flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl bg-card p-8 text-card-foreground shadow-sm ring-1 ring-border">
          <div className="flex flex-col items-center gap-3 text-center">
            <BrandMark className="size-10 text-base" />
            <h1 className="text-2xl font-semibold tracking-tight">
              {noAccess ? t("noAccess.title") : t("title")}
            </h1>
            <p className="text-sm text-foreground/70">
              {noAccess ? t("noAccess.description") : t("subtitle")}
            </p>
          </div>

          <div className="mt-8">
            {noAccess ? (
              <SignOutButton redirectUrl="/sign-in">
                <Button variant="outline" size="lg" className="w-full">
                  {t("noAccess.action")}
                </Button>
              </SignOutButton>
            ) : (
              <SignIn appearance={signInAppearance} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
