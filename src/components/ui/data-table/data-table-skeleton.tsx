"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableRow } from "@/components/ui/table";

export const SKELETON_ROWS = 8;

/** Skeleton body rows shown while a page loads; `columnCount` is the number of visible columns. */
export function DataTableSkeleton({ columnCount }: { columnCount: number }) {
  return (
    <TableBody aria-busy="true">
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <TableRow key={row} className="hover:bg-transparent">
          {Array.from({ length: Math.max(1, columnCount) }, (_, column) => (
            <TableCell key={column}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}
