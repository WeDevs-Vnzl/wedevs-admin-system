import type { TagChipDTO } from "@/lib/validators/tags";
import { readableTextColor } from "./color-swatches";

/** Coloured chips of tags. The text colour is chosen for contrast on each tag's own colour. */
export function TagChips({ tags }: { tags: readonly TagChipDTO[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li
          key={tag.id}
          className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
          style={{ backgroundColor: tag.color, color: readableTextColor(tag.color) }}
        >
          {tag.name}
        </li>
      ))}
    </ul>
  );
}
