"use client";

import { useCallback, useMemo } from "react";
import { useQueryStates } from "nuqs";
import type { ListQueryPatch } from "./types";
import { patchToUrlState, tableUrlParsers, urlStateToListQuery } from "./table-url-state";

export {
  guardPageSize,
  listQueryToUrlState,
  patchToUrlState,
  tableUrlParsers,
  urlStateToListQuery,
  type TableUrlState,
} from "./table-url-state";

/** Table state bound to the URL. `query` is always valid; `setQuery` writes a patch and resets the page on changes. */
export function useTableUrlState() {
  const [state, setState] = useQueryStates(tableUrlParsers, { history: "replace" });
  const query = useMemo(() => urlStateToListQuery(state), [state]);

  const setQuery = useCallback(
    (patch: ListQueryPatch) => {
      void setState(patchToUrlState(query, patch));
    },
    [query, setState],
  );

  return { query, setQuery };
}
