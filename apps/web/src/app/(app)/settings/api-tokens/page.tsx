import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ApiTokensView } from "@/features/api-tokens/components/api-tokens-view";
import { getApiTokens } from "@/features/api-tokens/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("apiTokens");
  return { title: t("page.title") };
}

// Settings → Tokens de API (DT-189): every signed-in role manages their own personal access tokens, so the page
// has no permission gate; the API only ever returns and changes the caller's tokens.
export default async function ApiTokensPage() {
  return <ApiTokensView initialTokens={await getApiTokens()} />;
}
