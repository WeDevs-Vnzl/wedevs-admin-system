import "server-only";
import { listAccounts } from "@/features/accounts/queries";
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
  return {
    mapping: unwrapOrBoundary(mapping),
    accounts: accounts.map(toOption),
    walletAccounts: accounts.filter((account) => account.type === "WALLET_CRIPTO").map(toOption),
    methods: methods.map((method) => ({ id: method.id, label: catalogLabel(method, locale) })),
  };
}
