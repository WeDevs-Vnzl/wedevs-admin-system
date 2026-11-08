import { ClerkProvider } from "@clerk/nextjs";
import { getLocale } from "next-intl/server";
import { clerkLocalization } from "@/app/(auth)/sign-in/clerk-appearance";

// The sign-in group gets its own `ClerkProvider`: the root layout has none, so the public portal loads no Clerk script.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return <ClerkProvider localization={clerkLocalization(locale)}>{children}</ClerkProvider>;
}
