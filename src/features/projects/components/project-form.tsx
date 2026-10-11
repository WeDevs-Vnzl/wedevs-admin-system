"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Controller,
  useForm,
  useWatch,
  type FieldValues,
  type Resolver,
  type ResolverOptions,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { FormPage } from "@/components/patterns/form-page";
import { SectionCard } from "@/components/patterns/section-card";
import { AsyncCombobox, type AsyncComboboxOption } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text";
import { Textarea } from "@/components/ui/textarea";
import { TagPicker } from "@/features/tags/components/tag-picker";
import { TechnologyPicker } from "@/features/technologies/components/technology-picker";
import { uploadAdapter } from "@/features/files/upload-adapter";
import { searchClientsAction } from "@/features/clients/actions";
import { createProjectAction, updateProjectAction, upsertProjectLinksAction, removeProjectLinkAction } from "@/features/projects/actions";
import type { ActionError, EntityRef } from "@/lib/validators/common";
import type { RichTextDoc } from "@/lib/validators/notes";
import type { TechnologyListRowDTO, TechnologyChipDTO } from "@/lib/validators/technologies";
import type { TagChipDTO } from "@/lib/validators/tags";
import {
  createProjectInputSchema,
  PROJECT_SUMMARY_MAX,
  projectLinkInputSchema,
  updateProjectInputSchema,
  type CreateProjectInput,
  type ProjectDetailDTO,
  type UpdateProjectInput,
} from "@/lib/validators/projects";
import { linkRowsFromDto, type ProjectLinkRow } from "../link-rows";
import { ProjectLinksEditor } from "./project-links-editor";

/** The form's own state; `toPayload` turns it into the action's input before the shared schema runs. */
interface ClientEntry {
  clientId: string;
  label: string;
  code: string;
  role: string;
}

interface ProjectFormValues {
  name: string;
  clients: ClientEntry[];
  summary: string;
  description: RichTextDoc | null;
  startDate: string;
  targetEndDate: string;
  endDate: string;
  technologyIds: string[];
  tagIds: string[];
}

export interface ProjectFormProps {
  mode: "create" | "edit";
  /** The project being edited; absent when creating. */
  project?: ProjectDetailDTO;
  /** Client prefilled from `/projects/new?clientId=` (HU-05 CA3). */
  initialClient?: EntityRef | null;
  technologies: readonly TechnologyListRowDTO[];
  /** Whether the user may create tags inline (computed on the server). */
  canCreateTags: boolean;
  /** Where Cancel and "Volver" go. */
  backHref: string;
}

/** Empty date inputs mean "not set"; the schema wants the key absent. */
const orUndefined = (value: string) => (value === "" ? undefined : value);

/** The schema input for the form: trims, drops empty optional fields, and adds the record id when editing. */
function toPayload(values: ProjectFormValues, projectId?: string) {
  return {
    ...(projectId ? { id: projectId } : {}),
    name: values.name,
    clients: values.clients.map((client) => ({
      clientId: client.clientId,
      role: client.role.trim() ? client.role.trim() : undefined,
    })),
    summary: values.summary,
    description: values.description ?? undefined,
    startDate: orUndefined(values.startDate),
    targetEndDate: orUndefined(values.targetEndDate),
    endDate: orUndefined(values.endDate),
    technologyIds: values.technologyIds,
    tagIds: values.tagIds,
  };
}

function linksPayload(rows: readonly ProjectLinkRow[]) {
  return rows.map((row) => ({
    ...(row.id ? { id: row.id } : {}),
    group: row.group,
    label: row.label,
    url: row.url,
    order: row.order,
  }));
}

/** Field of the form that a server `fieldErrors` key points at (`clients.0.clientId` → `clients`). */
const FORM_FIELDS = [
  "name",
  "clients",
  "summary",
  "description",
  "startDate",
  "targetEndDate",
  "endDate",
  "technologyIds",
  "tagIds",
] as const;
type FormField = (typeof FORM_FIELDS)[number];

function fieldOf(key: string): FormField | undefined {
  const root = key.split(".")[0];
  return (FORM_FIELDS as readonly string[]).includes(root ?? "") ? (root as FormField) : undefined;
}

/**
 * Create and edit of a project (PRD §8.3, HU-05 to HU-07). Status is not here: the transition dialog owns it.
 * The resolver runs the create or update schema of the actions, so a field error on the form is the same
 * error the action would return. Links save after the record: a removed link, then the changed ones.
 */
export function ProjectForm({
  mode,
  project,
  initialClient,
  technologies,
  canCreateTags,
  backHref,
}: ProjectFormProps) {
  const t = useTranslations("projects");
  const tRoot = useTranslations();
  const router = useRouter();
  const schema = mode === "create" ? createProjectInputSchema : updateProjectInputSchema;

  const initialLinks = project ? linkRowsFromDto(project.links) : [];
  const [links, setLinks] = useState<ProjectLinkRow[]>(initialLinks);
  const [tagChips, setTagChips] = useState<TagChipDTO[]>(project?.tags ?? []);
  const [stackRows] = useState<readonly TechnologyChipDTO[]>(project?.stack ?? []);

  const defaults: ProjectFormValues = project
    ? {
        name: project.name,
        clients: project.clients.map((client) => ({
          clientId: client.client.id,
          label: client.client.label,
          code: client.client.code ?? "",
          role: client.role ?? "",
        })),
        summary: project.summary,
        description: project.description,
        startDate: project.startDate ?? "",
        targetEndDate: project.targetEndDate ?? "",
        endDate: project.endDate ?? "",
        technologyIds: project.stack.map((tech) => tech.id),
        tagIds: project.tags.map((tag) => tag.id),
      }
    : {
        name: "",
        clients: initialClient
          ? [{ clientId: initialClient.id, label: initialClient.label, code: initialClient.code ?? "", role: "" }]
          : [],
        summary: "",
        description: null,
        startDate: "",
        targetEndDate: "",
        endDate: "",
        technologyIds: [],
        tagIds: [],
      };

  // The schema is the action's: values go through `toPayload` first, and the parsed output (the action's input)
  // reaches `onValid`, so the form never submits a shape the action would reject.
  const validate = zodResolver(schema) as unknown as Resolver<FieldValues>;
  const form = useForm<ProjectFormValues>({
    defaultValues: defaults,
    resolver: (values, context, options) =>
      validate(toPayload(values, project?.id), context, options as unknown as ResolverOptions<FieldValues>) as never,
  });

  const summary = useWatch({ control: form.control, name: "summary", defaultValue: defaults.summary });
  const linksDirty = JSON.stringify(linksPayload(links)) !== JSON.stringify(linksPayload(initialLinks));
  const dirty = form.formState.isDirty || linksDirty;
  const linksInvalid = links.some(
    (row) =>
      !projectLinkInputSchema.safeParse({ id: row.id, group: row.group, label: row.label, url: row.url, order: row.order })
        .success,
  );

  function applyError(error: ActionError) {
    if (error.fieldErrors) {
      for (const [key, messages] of Object.entries(error.fieldErrors)) {
        const field = fieldOf(key);
        const message = messages[0];
        if (field && message) form.setError(field, { message: tRoot(message as never) as unknown as string });
      }
      return;
    }
    toast.error(tRoot(`common.errors.${error.code}` as never));
  }

  async function saveLinks(projectId: string) {
    const removed = initialLinks.filter((link) => !links.some((row) => row.id === link.id));
    for (const link of removed) {
      if (link.id) await removeProjectLinkAction({ projectId, linkId: link.id });
    }
    const changed = links.filter(
      (row) =>
        !initialLinks.some(
          (old) =>
            old.id === row.id &&
            old.group === row.group &&
            old.label === row.label &&
            old.url === row.url &&
            old.order === row.order,
        ),
    );
    if (changed.length === 0) return null;
    return upsertProjectLinksAction({ projectId, links: linksPayload(changed) as never });
  }

  async function onValid(payload: CreateProjectInput | UpdateProjectInput) {
    if (linksInvalid) {
      toast.error(tRoot("common.errors.VALIDATION" as never));
      return;
    }

    if (mode === "create") {
      const result = await createProjectAction({ ...(payload as CreateProjectInput), links: linksPayload(links) as never });
      if (!result.ok) return applyError(result.error);
      toast.success(t("toast.created", { code: result.data.code }));
      router.push(`/projects/${result.data.id}`);
      router.refresh();
      return;
    }

    const updated = await updateProjectAction(payload as UpdateProjectInput);
    if (!updated.ok) return applyError(updated.error);
    const linkResult = await saveLinks(updated.data.id);
    if (linkResult && !linkResult.ok) {
      toast.error(tRoot(`common.errors.${linkResult.error.code}` as never));
      return;
    }
    toast.success(t("toast.updated"));
    router.push(`/projects/${updated.data.id}`);
    router.refresh();
  }

  const clientValues = useWatch({ control: form.control, name: "clients", defaultValue: defaults.clients });
  const clientOptions: AsyncComboboxOption[] = clientValues.map((client) => ({
    value: client.clientId,
    label: client.label,
    description: client.code,
    secondary: client.role,
  }));

  async function loadClients(query: string): Promise<AsyncComboboxOption[]> {
    const result = await searchClientsAction({ q: query });
    if (!result.ok) return [];
    return result.data.map((ref) => ({ value: ref.id, label: ref.label, description: ref.code }));
  }

  return (
    <form
      id="project-form"
      noValidate
      onSubmit={form.handleSubmit(
        (payload) => onValid(payload as unknown as CreateProjectInput | UpdateProjectInput),
        () => toast.error(tRoot("common.errors.VALIDATION" as never)),
      )}
    >
      <FormPage
        title={mode === "create" ? t("form.createTitle") : t("form.editTitle")}
        description={mode === "create" ? t("form.createDescription") : t("form.editDescription")}
        backHref={backHref}
        dirty={dirty}
        footer={
          <>
            <Button variant="outline" asChild>
              <Link href={backHref}>{t("form.cancel")}</Link>
            </Button>
            <Button type="submit" form="project-form" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t("form.saving") : t("form.save")}
            </Button>
          </>
        }
      >
        <h1 className="sr-only">{mode === "create" ? t("form.createTitle") : t("form.editTitle")}</h1>
        <SectionCard title={t("form.name")}>
          <Field data-invalid={form.formState.errors.name ? true : undefined}>
            <FieldLabel htmlFor="project-name">{t("form.name")}</FieldLabel>
            <Input
              id="project-name"
              maxLength={120}
              aria-invalid={form.formState.errors.name ? true : undefined}
              aria-describedby={form.formState.errors.name ? "project-name-error" : undefined}
              {...form.register("name")}
            />
            {form.formState.errors.name ? (
              <FieldError id="project-name-error">{tRoot(form.formState.errors.name.message as never)}</FieldError>
            ) : null}
          </Field>
        </SectionCard>

        <SectionCard title={t("form.clients")} description={t("form.clientsHelp")}>
          <Controller
            control={form.control}
            name="clients"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.error ? true : undefined}>
                <FieldLabel htmlFor="project-clients">{t("form.clients")}</FieldLabel>
                <AsyncCombobox
                  id="project-clients"
                  multiple
                  aria-label={t("form.clients")}
                  aria-invalid={fieldState.error ? true : undefined}
                  loadOptions={loadClients}
                  value={clientOptions}
                  secondaryInput={{ label: t("form.clientRole"), placeholder: t("form.clientRolePlaceholder"), maxLength: 80 }}
                  onChange={(options) =>
                    field.onChange(
                      options.map((option) => ({
                        clientId: option.value,
                        label: option.label,
                        code: option.description ?? "",
                        role: option.secondary ?? "",
                      })),
                    )
                  }
                />
                {fieldState.error ? <FieldError id="project-clients-error">{t("form.clientsRequired")}</FieldError> : null}
              </Field>
            )}
          />
        </SectionCard>

        <SectionCard title={t("form.summary")}>
          <Field data-invalid={form.formState.errors.summary ? true : undefined}>
            <FieldLabel htmlFor="project-summary">{t("form.summary")}</FieldLabel>
            <Textarea
              id="project-summary"
              rows={3}
              maxLength={PROJECT_SUMMARY_MAX}
              aria-invalid={form.formState.errors.summary ? true : undefined}
              aria-describedby={
                form.formState.errors.summary
                  ? "project-summary-counter project-summary-error"
                  : "project-summary-counter"
              }
              {...form.register("summary")}
            />
            <FieldDescription id="project-summary-counter" className="tabular-nums">
              {t("form.summaryCounter", { count: summary.length, max: PROJECT_SUMMARY_MAX })}
            </FieldDescription>
            {form.formState.errors.summary ? (
              <FieldError id="project-summary-error">{tRoot(form.formState.errors.summary.message as never)}</FieldError>
            ) : null}
          </Field>
        </SectionCard>

        <SectionCard title={t("form.description")}>
          <Controller
            control={form.control}
            name="description"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.error ? true : undefined}>
                <FieldLabel htmlFor="project-description">{t("form.description")}</FieldLabel>
                <RichTextEditor
                  id="project-description"
                  value={field.value}
                  uploadAdapter={uploadAdapter}
                  aria-label={t("form.description")}
                  aria-invalid={fieldState.error ? true : undefined}
                  aria-describedby={fieldState.error ? "project-description-error" : undefined}
                  onChange={(value) => field.onChange(value)}
                  onInvalid={() =>
                    form.setError("description", { message: tRoot("forms.richText.invalid" as never) as unknown as string })
                  }
                  onBlur={field.onBlur}
                />
                {fieldState.error ? <FieldError id="project-description-error">{tRoot(fieldState.error.message as never)}</FieldError> : null}
              </Field>
            )}
          />
        </SectionCard>

        <SectionCard title={t("detail.datesTitle")}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Controller
              control={form.control}
              name="startDate"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="project-start-date">{t("form.startDate")}</FieldLabel>
                  <DateField id="project-start-date" value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="targetEndDate"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="project-target-date">{t("form.targetEndDate")}</FieldLabel>
                  <DateField id="project-target-date" value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
                </Field>
              )}
            />
            {mode === "edit" && project?.endDate ? (
              <Field>
                <FieldLabel>{t("detail.endDate")}</FieldLabel>
                <p className="text-sm tabular-nums">{project.endDate}</p>
                <FieldDescription>{t("transition.endDate")}</FieldDescription>
              </Field>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title={t("form.stack")} description={t("form.stackHelp")}>
          <Controller
            control={form.control}
            name="technologyIds"
            render={({ field }) => (
              <TechnologyPicker
                id="project-stack"
                value={field.value}
                onChange={field.onChange}
                technologies={technologies}
                selected={stackRows}
              />
            )}
          />
        </SectionCard>

        <SectionCard title={t("form.links")}>
          <ProjectLinksEditor rows={links} onChange={setLinks} editable reorderable />
        </SectionCard>

        <SectionCard title={t("form.tags")}>
          <TagPicker
            id="project-tags"
            aria-label={t("form.tags")}
            value={tagChips}
            canCreate={canCreateTags}
            onChange={(next) => {
              setTagChips(next);
              form.setValue("tagIds", next.map((tag) => tag.id), { shouldDirty: true });
            }}
          />
        </SectionCard>

      </FormPage>
    </form>
  );
}
