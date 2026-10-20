"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import type { SearchResultDTO, SearchResultsDTO } from "@/lib/validators/search";
import type { RecentRecord } from "../recent-records";
import { SEARCH_ENTITY_ICONS, SEARCH_STATUS_ENUMS, searchHitHref } from "../search-entities";

/** cmdk value prefix of a search hit: the menu's filter always keeps these (the service already matched). */
export const SEARCH_HIT_VALUE_PREFIX = "hit:";

// Cmd+K hits grouped by entity type, in the service's order, each "mostrando icono, código, título,
// subtítulo y estado" (PRD §7.6). A hit without a route of its own (contacts) is listed but disabled.
export function SearchResultGroups({
  results,
  onOpen,
}: {
  results: SearchResultsDTO;
  onOpen: (hit: SearchResultDTO, href: string) => void;
}) {
  const t = useTranslations("search");
  const tEnums = useTranslations("enums");

  const statusLabel = (hit: SearchResultDTO) => {
    const enumName = SEARCH_STATUS_ENUMS[hit.entityType];
    if (!hit.status) return null;
    const key = `${enumName}.${hit.status}`;
    return enumName && tEnums.has(key as never) ? tEnums(key as never) : hit.status;
  };

  return results.groups.map((group) => {
    const Icon = SEARCH_ENTITY_ICONS[group.entityType];
    return (
      <CommandGroup key={group.entityType} heading={t(`types.${group.entityType}`)}>
        {group.items.map((hit) => {
          const href = searchHitHref(hit);
          const status = statusLabel(hit);
          return (
            <CommandItem
              key={hit.entityId}
              value={`${SEARCH_HIT_VALUE_PREFIX}${hit.entityType}:${hit.entityId}`}
              disabled={href === null}
              onSelect={() => href && onOpen(hit, href)}
            >
              <Icon aria-hidden data-entity-icon={hit.entityType} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-baseline gap-2">
                  {hit.code ? (
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {hit.code}
                    </span>
                  ) : null}
                  <span className="truncate">{hit.title}</span>
                  {hit.archived ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{t("archived")}</span>
                  ) : null}
                </span>
                {hit.subtitle ? (
                  <span className="truncate text-xs text-muted-foreground">{hit.subtitle}</span>
                ) : null}
              </span>
              {status ? (
                <Badge variant="outline" className="shrink-0">
                  {status}
                </Badge>
              ) : null}
            </CommandItem>
          );
        })}
      </CommandGroup>
    );
  });
}

// "Los registros visitados recientemente" (PRD §7.6), shown while the query is empty.
export function RecentRecordsGroup({
  records,
  onOpen,
}: {
  records: RecentRecord[];
  onOpen: (record: RecentRecord) => void;
}) {
  const t = useTranslations("search");
  if (records.length === 0) return null;
  return (
    <CommandGroup heading={t("recent")}>
      {records.map((record) => {
        const Icon = SEARCH_ENTITY_ICONS[record.entityType];
        return (
          <CommandItem
            key={`${record.entityType}:${record.entityId}`}
            value={`recent:${record.entityType}:${record.entityId}`}
            keywords={[record.title, ...(record.code ? [record.code] : [])]}
            onSelect={() => onOpen(record)}
          >
            <Icon aria-hidden data-entity-icon={record.entityType} />
            {record.code ? (
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {record.code}
              </span>
            ) : null}
            <span className="truncate">{record.title}</span>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
