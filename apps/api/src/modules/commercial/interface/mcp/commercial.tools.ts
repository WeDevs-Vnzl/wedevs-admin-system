import type { Type } from '@nestjs/common';
import { z, type ZodType } from 'zod';
import type { CurrentUser } from '../../../../shared/application/current-user';
import { idSchema } from '../../../../shared/interface/common.schemas';
import type { McpToolDefinition } from '../../../../shared/interface/mcp-tool-registry';
import { CreateClient } from '../../application/use-cases/create-client.use-case';
import { CreateContact } from '../../application/use-cases/create-contact.use-case';
import { CreateNote } from '../../application/use-cases/create-note.use-case';
import { GetClient } from '../../application/use-cases/get-client.use-case';
import { GetNote } from '../../application/use-cases/get-note.use-case';
import { GetProject } from '../../application/use-cases/get-project.use-case';
import { LinkNote } from '../../application/use-cases/link-note.use-case';
import { ListClients } from '../../application/use-cases/list-clients.use-case';
import { ListContacts } from '../../application/use-cases/list-contacts.use-case';
import { ListNotes } from '../../application/use-cases/list-notes.use-case';
import { ListProjects } from '../../application/use-cases/list-projects.use-case';
import { PinNote } from '../../application/use-cases/pin-note.use-case';
import { SetClientStatus } from '../../application/use-cases/set-client-status.use-case';
import { SetPrimaryContact } from '../../application/use-cases/set-primary-contact.use-case';
import { UnlinkNote } from '../../application/use-cases/unlink-note.use-case';
import { UpdateClient } from '../../application/use-cases/update-client.use-case';
import { UpdateContact } from '../../application/use-cases/update-contact.use-case';
import { UpdateNote } from '../../application/use-cases/update-note.use-case';
import {
  ClientIdParamsDto,
  CreateClientDto,
  ListClientsQueryDto,
  SetClientStatusDto,
  UpdateClientDto,
  toClientDetailResponse,
  toClientListRowResponse,
} from '../http/dto/clients.dto';
import {
  ContactIdParamsDto,
  CreateContactDto,
  ListContactsQueryDto,
  UpdateContactDto,
  toContactResponse,
} from '../http/dto/contacts.dto';
import {
  CreateNoteDto,
  ListNotesQueryDto,
  NoteIdParamsDto,
  PinNoteDto,
  UpdateNoteDto,
  noteLinkTargetSchema,
  toNoteDetailResponse,
  toNoteListRowResponse,
} from '../http/dto/notes.dto';
import {
  ListProjectsQueryDto,
  ProjectIdParamsDto,
  toProjectDetailResponse,
  toProjectRowResponse,
} from '../http/dto/projects.dto';

/** Resolves an application use case of the booted app (the feature modules do not export them). */
export type ResolveUseCase = <T>(token: Type<T>) => T;

interface ToolSpec<S extends ZodType> {
  readonly name: string;
  readonly description: string;
  readonly input: S;
  /** The grant of the tool's HTTP route (DT-195). */
  readonly grant: McpToolDefinition['grant'];
  readonly run: (actor: CurrentUser, input: z.output<S>) => Promise<unknown>;
}

/** The server validates `input` before the handler runs, so the cast only restores the parsed type. */
function tool<S extends ZodType>(spec: ToolSpec<S>): McpToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    input: spec.input,
    grant: spec.grant,
    handler: (actor, input) => spec.run(actor, input as z.output<S>),
  };
}

/** Route params and body (or query) of an HTTP route, flattened into one argument object. */
const both = <A extends ZodType, B extends ZodType>(a: A, b: B) => z.intersection(a, b);

/**
 * MCP tools of the `commercial` context (DT-188): reads, and the non-money writes on clients, contacts and
 * notes. Each calls the use case of its HTTP route with that route's input schema and answers that route's
 * body; the grant is the route's. Not exposed on purpose (DT-198): archive and restore of clients, contacts
 * and notes, and `AttachNoteFile`.
 */
export function commercialTools(resolve: ResolveUseCase): McpToolDefinition[] {
  return [
    tool({
      name: 'list_clients',
      description: 'List clients (paged; money fields are null without access to financials).',
      input: ListClientsQueryDto.schema,
      grant: { resource: 'client', action: 'read' },
      run: async (actor, input) => {
        const page = await resolve(ListClients).execute(actor, input);
        return { ...page, items: page.items.map(toClientListRowResponse) };
      },
    }),
    tool({
      name: 'get_client',
      description: 'One client with its live contacts.',
      input: ClientIdParamsDto.schema,
      grant: { resource: 'client', action: 'read' },
      run: async (actor, input) =>
        toClientDetailResponse(await resolve(GetClient).execute(actor, { id: input.id })),
    }),
    tool({
      name: 'create_client',
      description: 'Create a client (code CLI-####).',
      input: CreateClientDto.schema,
      grant: { resource: 'client', action: 'create' },
      run: async (actor, input) =>
        toClientDetailResponse(await resolve(CreateClient).execute(actor, input)),
    }),
    tool({
      name: 'update_client',
      description: 'Replace the editable fields of a client.',
      input: both(ClientIdParamsDto.schema, UpdateClientDto.schema),
      grant: { resource: 'client', action: 'update' },
      run: async (actor, input) =>
        toClientDetailResponse(await resolve(UpdateClient).execute(actor, input)),
    }),
    tool({
      name: 'set_client_status',
      description: 'Change the status of a client.',
      input: both(ClientIdParamsDto.schema, SetClientStatusDto.schema),
      grant: { resource: 'client', action: 'update' },
      run: async (actor, input) =>
        toClientDetailResponse(
          await resolve(SetClientStatus).execute(actor, { id: input.id, status: input.status }),
        ),
    }),
    tool({
      name: 'list_contacts',
      description: 'Contacts of a client, primary first.',
      input: both(z.object({ clientId: idSchema }), ListContactsQueryDto.schema),
      grant: { resource: 'contact', action: 'read' },
      run: async (actor, { clientId, ...query }) => {
        const page = await resolve(ListContacts).execute(actor, { clientId, query });
        return { ...page, items: page.items.map(toContactResponse) };
      },
    }),
    tool({
      name: 'create_contact',
      description: 'Create a contact of a live client.',
      input: both(z.object({ clientId: idSchema }), CreateContactDto.schema),
      grant: { resource: 'contact', action: 'create' },
      run: async (actor, input) =>
        toContactResponse(await resolve(CreateContact).execute(actor, input)),
    }),
    tool({
      name: 'update_contact',
      description: 'Replace the editable fields of a contact.',
      input: both(ContactIdParamsDto.schema, UpdateContactDto.schema),
      grant: { resource: 'contact', action: 'update' },
      run: async (actor, input) =>
        toContactResponse(await resolve(UpdateContact).execute(actor, input)),
    }),
    tool({
      name: 'set_primary_contact',
      description: 'Make a contact the primary one of its client.',
      input: ContactIdParamsDto.schema,
      grant: { resource: 'contact', action: 'update' },
      run: async (actor, input) =>
        toContactResponse(await resolve(SetPrimaryContact).execute(actor, { id: input.id })),
    }),
    tool({
      name: 'list_projects',
      description: 'List projects (paged).',
      input: ListProjectsQueryDto.schema,
      grant: { resource: 'project', action: 'read' },
      run: async (actor, input) => {
        const page = await resolve(ListProjects).execute(actor, input);
        return { ...page, items: page.items.map(toProjectRowResponse) };
      },
    }),
    tool({
      name: 'get_project',
      description: 'One project with its clients, stack, links and billing flag.',
      input: ProjectIdParamsDto.schema,
      grant: { resource: 'project', action: 'read' },
      run: async (actor, input) =>
        toProjectDetailResponse(await resolve(GetProject).execute(actor, input.id)),
    }),
    tool({
      name: 'list_notes',
      description: 'Notes table, or the feed of one record (entityType + entityId).',
      input: ListNotesQueryDto.schema,
      grant: { resource: 'note', action: 'read' },
      run: async (actor, input) => {
        const page = await resolve(ListNotes).execute(actor, input);
        return {
          ...page,
          items: page.items.map(toNoteListRowResponse),
        };
      },
    }),
    tool({
      name: 'get_note',
      description: 'One note with its content, links and attachments.',
      input: NoteIdParamsDto.schema,
      grant: { resource: 'note', action: 'read' },
      run: async (actor, input) =>
        toNoteDetailResponse(await resolve(GetNote).execute(actor, { id: input.id })),
    }),
    tool({
      name: 'create_note',
      description: 'Create a note linked to at least one record (the token user is the author).',
      input: CreateNoteDto.schema,
      grant: { resource: 'note', action: 'create' },
      run: async (actor, input) =>
        toNoteDetailResponse(await resolve(CreateNote).execute(actor, input)),
    }),
    tool({
      name: 'update_note',
      description: 'Edit the title, content or tags of a note.',
      input: both(NoteIdParamsDto.schema, UpdateNoteDto.schema),
      grant: { resource: 'note', action: 'update' },
      run: async (actor, input) =>
        toNoteDetailResponse(await resolve(UpdateNote).execute(actor, input)),
    }),
    tool({
      name: 'pin_note',
      description: 'Pin or unpin a note.',
      input: both(NoteIdParamsDto.schema, PinNoteDto.schema),
      grant: { resource: 'note', action: 'update' },
      run: async (actor, input) =>
        toNoteDetailResponse(
          await resolve(PinNote).execute(actor, { id: input.id, pinned: input.pinned }),
        ),
    }),
    tool({
      name: 'link_note',
      description: 'Link a note to one more record.',
      input: both(NoteIdParamsDto.schema, noteLinkTargetSchema),
      grant: { resource: 'note', action: 'update' },
      run: async (actor, { id, ...target }) =>
        toNoteDetailResponse(await resolve(LinkNote).execute(actor, { noteId: id, target })),
    }),
    tool({
      name: 'unlink_note',
      description: 'Remove one link of a note.',
      input: both(NoteIdParamsDto.schema, noteLinkTargetSchema),
      grant: { resource: 'note', action: 'update' },
      run: async (actor, { id, ...target }) =>
        toNoteDetailResponse(await resolve(UnlinkNote).execute(actor, { noteId: id, target })),
    }),
  ];
}
