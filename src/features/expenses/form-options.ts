import "server-only";
import { getLocale } from "next-intl/server";
import { listAccounts } from "@/features/accounts/queries";
import { listCurrencies, listExpenseCategories } from "@/features/catalogs/queries";
import { listProjects } from "@/features/projects/queries";

// The options the expense forms pick from. They are read here, on the server, so the client components receive
// plain values and never import the services (C9). Categories are flattened from the two-level tree: a leaf
// category is selectable, and a root without children is selectable too.

export type ExpenseOption = { id: string; label: string };
export type ExpenseAccountOption = { id: string; name: string; currency: string };
export type ExpenseCurrencyOption = { code: string; name: string };

export type ExpenseFormOptions = {
  categories: ExpenseOption[];
  accounts: ExpenseAccountOption[];
  projects: ExpenseOption[];
  currencies: ExpenseCurrencyOption[];
};

export async function getExpenseFormOptions(): Promise<ExpenseFormOptions> {
  const [locale, tree, accounts, projects, currencies] = await Promise.all([
    getLocale(),
    listExpenseCategories(),
    listAccounts({ pageSize: 100 }),
    listProjects({ pageSize: 100 }),
    listCurrencies(),
  ]);
  const english = locale === "en";
  const categories = tree.flatMap((root) => {
    const rootName = english && root.nameEn ? root.nameEn : root.name;
    if (root.children.length === 0) return [{ id: root.id, label: rootName }];
    return root.children.map((child) => {
      const childName = english && child.nameEn ? child.nameEn : child.name;
      return { id: child.id, label: `${rootName} → ${childName}` };
    });
  });
  return {
    categories,
    accounts: accounts.items
      .filter((account) => account.active)
      .map(({ id, name, currency }) => ({ id, name, currency })),
    projects: projects.items.map((project) => ({ id: project.id, label: project.name })),
    currencies: currencies.map(({ code, name }) => ({ code, name })),
  };
}
