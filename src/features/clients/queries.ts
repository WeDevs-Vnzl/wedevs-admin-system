import "server-only";
import {
  clientFilterSchema,
  clientIdInputSchema,
  getClientsOverviewInputSchema,
  type ClientFilterInput,
} from "@/lib/validators/clients";
import * as clients from "@/mocks/services/clients";
import { getServiceContext } from "@/server/context";

// Reads for the clients pages (RSC). Every read follows the action sequence's first steps: the session
// resolves in `getServiceContext`, input is parsed with the contract schema. Pages call `notFound()` when
// `getClient` throws a `ServiceError` with code `NOT_FOUND`.

export async function listClients(input: ClientFilterInput = {}) {
  return clients.listClients(await getServiceContext(), clientFilterSchema.parse(input));
}

export async function getClient(id: string) {
  return clients.getClient(await getServiceContext(), clientIdInputSchema.parse({ id }));
}

export async function getClientFinancials(id: string) {
  return clients.getClientFinancials(await getServiceContext(), clientIdInputSchema.parse({ id }));
}

export async function getClientsOverview() {
  return clients.getClientsOverview(
    await getServiceContext(),
    getClientsOverviewInputSchema.parse({}),
  );
}
