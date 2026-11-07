import "server-only";
import { listAccounts } from "@/features/accounts/queries";
import { getFiscalSettings, listPaymentMethods } from "@/features/catalogs/queries";
import { listClients } from "@/features/clients/queries";
import type {
  PaymentFormAccount,
  PaymentFormClient,
  PaymentFormMethod,
  PaymentFormProps,
} from "./components/payment-form";

// The options the payment form picks from, read on the server so the client component receives plain values. The
// create page offers active accounts and methods only (a payment enters an active account); the edit page also
// reads the inactive ones so the payment's own account or method is not blanked (rule 23).

export type PaymentFormOptions = {
  clients: PaymentFormClient[];
  accounts: PaymentFormAccount[];
  methods: PaymentFormMethod[];
  fiscal: PaymentFormProps["fiscal"];
};

export async function getPaymentFormOptions(
  options: { includeInactive?: boolean } = {},
): Promise<PaymentFormOptions> {
  const includeInactive = options.includeInactive ?? false;
  const [clients, accounts, methods, fiscal] = await Promise.all([
    listClients({ pageSize: 100 }),
    listAccounts({ pageSize: 100 }),
    listPaymentMethods(includeInactive ? { includeInactive: true } : {}),
    getFiscalSettings(),
  ]);
  return {
    clients: clients.items.map((client) => ({ id: client.id, name: client.tradeName })),
    accounts: accounts.items
      .filter((account) => includeInactive || account.active)
      .map(({ id, name, currency, active }) => ({ id, name, currency, active })),
    methods: methods
      .filter((method) => includeInactive || method.active)
      .map(({ id, code, name, nameEn, requiresReference, suggestsIgtf, active }) => ({
        id,
        code,
        name,
        nameEn,
        requiresReference,
        suggestsIgtf,
        active,
      })),
    // IGTF is proposed from the method flag or the fiscal currency list, never from a per-method code list (DT-70).
    fiscal: { igtfRate: fiscal.igtfRate, igtfCurrencies: fiscal.igtfCurrencies },
  };
}
