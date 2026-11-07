import "server-only";
import { getAccount, listAccounts } from "@/features/accounts/queries";
import { catalogLabel } from "@/features/catalogs/components/catalog-label";
import { listPaymentMethods } from "@/features/catalogs/queries";
import { unwrapOrBoundary } from "@/features/settings/query-boundary";
import { getServerApi } from "@/lib/api/server";
import type { IntegrationMappingDto } from "@/lib/api/types/integrations";
import { getIntegrationMapping } from "./api";
import type { MappingAccountOption, MappingMethodOption } from "./components/integrations-form";

export type IntegrationsScreen = {
  mapping: IntegrationMappingDto;
  accounts: MappingAccountOption[];
  walletAccounts: MappingAccountOption[];
  methods: MappingMethodOption[];
};

/**
 * Everything Settings → Integraciones renders. The mapping read is the one that carries the grant: a role
 * without `settings` gets the in-shell not-found page (the BE answers `FORBIDDEN`). The pickers consume the
 * frozen account and payment-method reads unchanged; Binance wallets are the `WALLET_CRIPTO` accounts.
 */
export async function getIntegrationsScreen(locale: string): Promise<IntegrationsScreen> {
  const api = await getServerApi();
  const [mapping, accountPage, methods] = await Promise.all([
    getIntegrationMapping(api),
    listAccounts({ pageSize: 100 }),
    listPaymentMethods(),
  ]);
  const accounts = accountPage.items;
  const toOption = ({ id, name, currency }: (typeof accounts)[number]): MappingAccountOption => ({
    id,
    name,
    currency,
  });
  const resolved = unwrapOrBoundary(mapping);
  // The list omits inactive accounts: a mapped one is read by id and offered labelled inactive (rule 23).
  const mappedMissing = async (accountId: string | undefined) => {
    if (!accountId || accounts.some((account) => account.id === accountId)) return null;
    try {
      return await getAccount(accountId);
    } catch {
      return null;
    }
  };
  const [stripeMissing, binanceMissing] = await Promise.all([
    mappedMissing(resolved.stripe?.accountId),
    mappedMissing(resolved.binance?.accountId),
  ]);
  const inactiveOption = (account: NonNullable<typeof stripeMissing>): MappingAccountOption => ({
    ...toOption(account),
    inactive: true,
  });
  return {
    mapping: resolved,
    accounts: [
      ...accounts.map(toOption),
      ...(stripeMissing ? [inactiveOption(stripeMissing)] : []),
    ],
    walletAccounts: [
      ...accounts.filter((account) => account.type === "WALLET_CRIPTO").map(toOption),
      ...(binanceMissing ? [inactiveOption(binanceMissing)] : []),
    ],
    methods: methods.map((method) => ({ id: method.id, label: catalogLabel(method, locale) })),
  };
}
