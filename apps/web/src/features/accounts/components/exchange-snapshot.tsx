import { getLocale, getTranslations } from "next-intl/server";
import { formatDateTime } from "@/lib/dates";
import { getAccountExchangeSnapshot } from "@/features/accounts/queries";

type ExchangeSnapshotProps = {
  accountId: string;
  accountType: string;
};

/**
 * The Binance balances of a wallet account, shown beside its system balance (6.4). Read-only: every amount is the
 * BE string, shown unchanged (C15) with no currency format and no computed figure. Renders nothing for a non-wallet
 * account (not requested), when Binance is off (`snapshot: null`, DT-193) or when the read fails, so the page
 * never breaks on it.
 */
export async function ExchangeSnapshot({ accountId, accountType }: ExchangeSnapshotProps) {
  if (accountType !== "WALLET_CRIPTO") return null;

  let snapshot;
  try {
    snapshot = (await getAccountExchangeSnapshot(accountId)).snapshot;
  } catch {
    // Any failed read hides the block; the balance card and the rest of the page stay usable.
    return null;
  }
  if (!snapshot) return null;

  const [t, locale] = await Promise.all([getTranslations("accounts.snapshot"), getLocale()]);

  return (
    <section
      aria-labelledby="exchange-snapshot-title"
      className="flex flex-col gap-2 border-t pt-4"
    >
      <div className="flex flex-col gap-0.5">
        <h3 id="exchange-snapshot-title" className="font-medium">
          {t("title")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      {snapshot.balances.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {snapshot.balances.map((balance) => (
            <li key={balance.asset} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
              <span className="min-w-16 font-medium">{balance.asset}</span>
              <span className="text-xs text-muted-foreground">
                {t("columns.free")}{" "}
                <span className="text-foreground tabular-nums">{balance.free}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {t("columns.locked")}{" "}
                <span className="text-foreground tabular-nums">{balance.locked}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        {t("syncedAt")}: {formatDateTime(new Date(snapshot.syncedAt), locale, "short")}
      </p>
    </section>
  );
}
