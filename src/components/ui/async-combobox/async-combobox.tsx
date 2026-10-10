"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type {
  AsyncComboboxMultiProps,
  AsyncComboboxOption,
  AsyncComboboxProps,
  AsyncComboboxSecondaryInput,
  AsyncComboboxSingleProps,
} from "./types";
import { useAsyncOptions } from "./use-async-options";

/**
 * Relational combobox with async search (frontend-patterns §6). Base: **Base UI** through the registry
 * `combobox` (DT-56). Filtering is the server's (`filter={null}`): the list is whatever `loadOptions`
 * returns for the debounced query. Keyboard navigation, highlight and ARIA come from Base UI.
 */

const DEFAULT_DEBOUNCE_MS = 250;
const CREATE_VALUE = "\u0000create";
const NO_GROUP = "";
const CREATE_GROUP = "\u0000create-group";

interface OptionGroup {
  value: string;
  items: AsyncComboboxOption[];
}

const itemToLabel = (option: AsyncComboboxOption) => option.label;
const sameOption = (a: AsyncComboboxOption, b: AsyncComboboxOption) => a.value === b.value;
const isCreateItem = (option: AsyncComboboxOption) => option.value === CREATE_VALUE;

function buildGroups(options: AsyncComboboxOption[], createItem: AsyncComboboxOption | null) {
  const groups = new Map<string, AsyncComboboxOption[]>();
  for (const option of options) {
    const name = option.group ?? NO_GROUP;
    groups.set(name, [...(groups.get(name) ?? []), option]);
  }
  const list: OptionGroup[] = [...groups].map(([value, items]) => ({ value, items }));
  if (createItem) list.push({ value: CREATE_GROUP, items: [createItem] });
  return list;
}

function useListModel(props: AsyncComboboxProps) {
  const t = useTranslations("forms.asyncCombobox");
  const state = useAsyncOptions(props.loadOptions, props.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  const trimmed = state.query.trim();
  const showCreate =
    props.onCreate !== undefined &&
    trimmed !== "" &&
    !state.loading &&
    !state.options.some((option) => option.label.toLowerCase() === trimmed.toLowerCase());
  const createItem: AsyncComboboxOption | null = showCreate
    ? { value: CREATE_VALUE, label: t("create", { query: trimmed }) }
    : null;
  const items = createItem ? [...state.options, createItem] : state.options;
  const grouped = state.options.some((option) => option.group !== undefined);

  async function create() {
    const created = await props.onCreate?.(trimmed);
    state.setQuery("");
    return created ?? null;
  }

  return {
    ...state,
    t,
    items,
    groups: grouped ? buildGroups(state.options, createItem) : null,
    create,
    emptyText: state.loading ? t("loading") : t("empty"),
  };
}

function OptionRow({ option }: { option: AsyncComboboxOption }) {
  return (
    <ComboboxItem value={option} disabled={option.disabled}>
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{option.label}</span>
        {option.description ? (
          <span className="truncate text-xs text-muted-foreground">{option.description}</span>
        ) : null}
      </span>
    </ComboboxItem>
  );
}

function OptionsList({ model }: { model: ReturnType<typeof useListModel> }) {
  return (
    <>
      <ComboboxEmpty>{model.emptyText}</ComboboxEmpty>
      <ComboboxList>
        {model.groups
          ? (group: OptionGroup) => (
              <ComboboxGroup key={group.value} items={group.items}>
                {group.value !== NO_GROUP && group.value !== CREATE_GROUP ? (
                  <ComboboxLabel>{group.value}</ComboboxLabel>
                ) : null}
                <ComboboxCollection>
                  {(option: AsyncComboboxOption) => <OptionRow key={option.value} option={option} />}
                </ComboboxCollection>
              </ComboboxGroup>
            )
          : (option: AsyncComboboxOption) => <OptionRow key={option.value} option={option} />}
      </ComboboxList>
    </>
  );
}

function SecondaryInputs({
  config,
  selected,
  onChange,
  disabled,
}: {
  config: AsyncComboboxSecondaryInput;
  selected: readonly AsyncComboboxOption[];
  onChange: (next: AsyncComboboxOption[]) => void;
  disabled?: boolean;
}) {
  if (selected.length === 0) return null;
  return (
    <ul data-slot="async-combobox-secondary" className="mt-2 flex flex-col gap-1.5">
      {selected.map((option) => (
        <li key={option.value} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm">{option.label}</span>
          <Input
            className="h-8 w-40"
            aria-label={`${config.label}: ${option.label}`}
            placeholder={config.placeholder}
            maxLength={config.maxLength}
            disabled={disabled}
            value={option.secondary ?? ""}
            onChange={(event) =>
              onChange(
                selected.map((item) =>
                  item.value === option.value ? { ...item, secondary: event.target.value } : item,
                ),
              )
            }
          />
        </li>
      ))}
    </ul>
  );
}

function SingleCombobox(props: AsyncComboboxSingleProps) {
  const model = useListModel(props);
  const { t } = model;

  return (
    <div data-slot="async-combobox" className={cn("flex flex-col", props.className)}>
      <Combobox<AsyncComboboxOption, false>
        items={model.groups ?? model.items}
        filter={null}
        value={props.value}
        onValueChange={async (next) => {
          if (next && isCreateItem(next)) {
            const created = await model.create();
            if (created) props.onChange(created);
            return;
          }
          model.setQuery("");
          props.onChange(next);
        }}
        itemToStringLabel={itemToLabel}
        isItemEqualToValue={sameOption}
        open={model.open}
        onOpenChange={model.setOpen}
        onInputValueChange={(text, details) => {
          if (details.reason === "input-change") model.setQuery(text);
        }}
        disabled={props.disabled}
      >
        <ComboboxInput
          id={props.id}
          placeholder={props.placeholder ?? t("placeholder")}
          aria-label={props["aria-label"]}
          aria-invalid={props["aria-invalid"]}
          showTrigger={false}
        >
          {props.value && !props.disabled ? (
            <InputGroupAddon align="inline-end">
              <ComboboxPrimitive.Clear
                aria-label={t("clear")}
                render={<InputGroupButton variant="ghost" size="icon-xs" />}
              >
                <XIcon className="pointer-events-none" />
              </ComboboxPrimitive.Clear>
            </InputGroupAddon>
          ) : null}
        </ComboboxInput>
        <ComboboxContent>
          <OptionsList model={model} />
        </ComboboxContent>
      </Combobox>
      {props.secondaryInput && props.value ? (
        <SecondaryInputs
          config={props.secondaryInput}
          selected={[props.value]}
          disabled={props.disabled}
          onChange={([next]) => props.onChange(next ?? props.value)}
        />
      ) : null}
    </div>
  );
}

function MultiCombobox(props: AsyncComboboxMultiProps) {
  const model = useListModel(props);
  const anchor = useComboboxAnchor();
  const { t } = model;

  return (
    <div data-slot="async-combobox" className={cn("flex flex-col", props.className)}>
      <Combobox<AsyncComboboxOption, true>
        multiple
        items={model.groups ?? model.items}
        filter={null}
        value={[...props.value]}
        onValueChange={async (next) => {
          const created = next.find(isCreateItem);
          const chosen = next.filter((option) => !isCreateItem(option));
          if (created) {
            const option = await model.create();
            props.onChange(option ? [...chosen, option] : chosen);
            return;
          }
          model.setQuery("");
          props.onChange(chosen);
        }}
        itemToStringLabel={itemToLabel}
        isItemEqualToValue={sameOption}
        open={model.open}
        onOpenChange={model.setOpen}
        onInputValueChange={(text, details) => {
          if (details.reason === "input-change") model.setQuery(text);
        }}
        disabled={props.disabled}
      >
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {(selected: AsyncComboboxOption[]) => (
              <>
                {selected.map((option) => (
                  <ComboboxChip key={option.value} aria-label={option.label} showRemove={false}>
                    {option.label}
                    <ComboboxPrimitive.ChipRemove
                      aria-label={t("remove", { label: option.label })}
                      render={<Button variant="ghost" size="icon-xs" className="-ml-1" />}
                    >
                      <XIcon className="pointer-events-none" />
                    </ComboboxPrimitive.ChipRemove>
                  </ComboboxChip>
                ))}
                <ComboboxChipsInput
                  id={props.id}
                  placeholder={selected.length === 0 ? (props.placeholder ?? t("placeholder")) : ""}
                  aria-label={props["aria-label"]}
                  aria-invalid={props["aria-invalid"]}
                />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <OptionsList model={model} />
        </ComboboxContent>
      </Combobox>
      {props.secondaryInput ? (
        <SecondaryInputs
          config={props.secondaryInput}
          selected={props.value}
          disabled={props.disabled}
          onChange={props.onChange}
        />
      ) : null}
    </div>
  );
}

export function AsyncCombobox(props: AsyncComboboxProps) {
  return props.multiple ? <MultiCombobox {...props} /> : <SingleCombobox {...props} />;
}
