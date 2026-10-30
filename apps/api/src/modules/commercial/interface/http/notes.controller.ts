import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated, RequiresGrant } from '../../../../shared/interface/grant.decorator';
import type { RichTextDoc } from '../../../../shared/domain/rich-text';
import { ArchiveNote } from '../../application/use-cases/archive-note.use-case';
import { AttachNoteFile } from '../../application/use-cases/attach-note-file.use-case';
import { CreateNote } from '../../application/use-cases/create-note.use-case';
import { GetNote } from '../../application/use-cases/get-note.use-case';
import { LinkNote } from '../../application/use-cases/link-note.use-case';
import { ListNotes } from '../../application/use-cases/list-notes.use-case';
import type { NoteDetail, NoteListRow } from '../../application/use-cases/note-support';
import { PinNote } from '../../application/use-cases/pin-note.use-case';
import { RestoreNote } from '../../application/use-cases/restore-note.use-case';
import { UnlinkNote } from '../../application/use-cases/unlink-note.use-case';
import { UpdateNote } from '../../application/use-cases/update-note.use-case';
import {
  ArchivedNoteDto,
  AttachNoteFileDto,
  CreateNoteDto,
  ListNotesQueryDto,
  NoteDetailDto,
  NoteIdParamsDto,
  NoteLinkTargetDto,
  NoteListResponseDto,
  PinNoteDto,
  RestoredNoteDto,
  UpdateNoteDto,
} from './dto/notes.dto';

const refOf = (ref: NoteDetail['links'][number]) => ({
  id: ref.id,
  type: ref.type,
  label: ref.label,
  ...(ref.code !== undefined ? { code: ref.code } : {}),
});

const commonOf = (note: NoteDetail | NoteListRow) => ({
  id: note.id,
  title: note.title,
  author: note.author,
  pinned: note.pinned,
  tags: note.tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
  links: note.links.map(refOf),
  createdAt: note.createdAt.toISOString(),
  updatedAt: note.updatedAt.toISOString(),
  archivedAt: note.archivedAt ? note.archivedAt.toISOString() : null,
});

function toDetail(note: NoteDetail): NoteDetailDto {
  return {
    ...commonOf(note),
    content: note.content as RichTextDoc as unknown as Record<string, unknown>,
    contentText: note.contentText,
    attachments: note.attachments.map((file) => ({
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      status: file.status,
      uploadedById: file.uploadedById,
      createdAt: file.createdAt.toISOString(),
    })),
  };
}

/**
 * Notes (PRD §8.10, HU-23). Every route is guarded by the matrix row of `note`; the use case runs `can()`
 * again as the authority (C13). Archiving is `@Authenticated()` because a Member may delete only their own
 * notes, which the route guard (no record in hand) cannot express: the use case checks the author.
 */
@ApiTags('notes')
@Controller('notes')
export class NotesController {
  constructor(
    private readonly listNotes: ListNotes,
    private readonly getNote: GetNote,
    private readonly createNote: CreateNote,
    private readonly updateNote: UpdateNote,
    private readonly pinNote: PinNote,
    private readonly linkNote: LinkNote,
    private readonly unlinkNote: UnlinkNote,
    private readonly attachNoteFile: AttachNoteFile,
    private readonly archiveNote: ArchiveNote,
    private readonly restoreNote: RestoreNote,
  ) {}

  @Get()
  @RequiresGrant('note', 'read')
  @ApiOperation({
    operationId: 'listNotes',
    summary: 'Notes table, or the feed of one record (entityType + entityId)',
  })
  @ApiOkResponse({ type: NoteListResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL')
  async list(
    @CurrentUser() user: CurrentUserModel,
    @Query() query: ListNotesQueryDto,
  ): Promise<NoteListResponseDto> {
    const page = await this.listNotes.execute(user, query);
    return {
      ...page,
      items: page.items.map((row) => ({
        ...commonOf(row),
        excerpt: row.excerpt,
        attachmentCount: row.attachmentCount,
      })),
    };
  }

  @Post()
  @RequiresGrant('note', 'create')
  @ApiOperation({ operationId: 'createNote', summary: 'Create a note (the caller is the author)' })
  @ApiBody({ type: CreateNoteDto })
  @ApiCreatedResponse({ type: NoteDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async create(
    @CurrentUser() user: CurrentUserModel,
    @Body() body: CreateNoteDto,
  ): Promise<NoteDetailDto> {
    return toDetail(await this.createNote.execute(user, body));
  }

  @Get(':id')
  @RequiresGrant('note', 'read')
  @ApiOperation({
    operationId: 'getNote',
    summary: 'One note (archived ones for trash roles only)',
  })
  @ApiOkResponse({ type: NoteDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async get(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: NoteIdParamsDto,
  ): Promise<NoteDetailDto> {
    return toDetail(await this.getNote.execute(user, { id: params.id }));
  }

  @Patch(':id')
  @RequiresGrant('note', 'update')
  @ApiOperation({ operationId: 'updateNote', summary: 'Edit title, content and tags' })
  @ApiBody({ type: UpdateNoteDto })
  @ApiOkResponse({ type: NoteDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async update(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: NoteIdParamsDto,
    @Body() body: UpdateNoteDto,
  ): Promise<NoteDetailDto> {
    return toDetail(await this.updateNote.execute(user, { ...body, id: params.id }));
  }

  @Post(':id/pin')
  @HttpCode(200)
  @RequiresGrant('note', 'update')
  @ApiOperation({ operationId: 'pinNote', summary: 'Pin or unpin a note' })
  @ApiBody({ type: PinNoteDto })
  @ApiOkResponse({ type: NoteDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async pin(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: NoteIdParamsDto,
    @Body() body: PinNoteDto,
  ): Promise<NoteDetailDto> {
    return toDetail(await this.pinNote.execute(user, { id: params.id, pinned: body.pinned }));
  }

  @Post(':id/links')
  @RequiresGrant('note', 'update')
  @ApiOperation({ operationId: 'linkNote', summary: 'Hang the note from one more record' })
  @ApiBody({ type: NoteLinkTargetDto })
  @ApiCreatedResponse({ type: NoteDetailDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INTERNAL',
  )
  async link(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: NoteIdParamsDto,
    @Body() body: NoteLinkTargetDto,
  ): Promise<NoteDetailDto> {
    return toDetail(await this.linkNote.execute(user, { noteId: params.id, target: body }));
  }

  @Post(':id/unlink')
  @HttpCode(200)
  @RequiresGrant('note', 'update')
  @ApiOperation({
    operationId: 'unlinkNote',
    summary: 'Remove a link (a note keeps at least one)',
  })
  @ApiBody({ type: NoteLinkTargetDto })
  @ApiOkResponse({ type: NoteDetailDto })
  @ApiErrorResponses(
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'INTEGRITY_LOCK',
    'INTERNAL',
  )
  async unlink(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: NoteIdParamsDto,
    @Body() body: NoteLinkTargetDto,
  ): Promise<NoteDetailDto> {
    return toDetail(await this.unlinkNote.execute(user, { noteId: params.id, target: body }));
  }

  @Post(':id/attachments')
  @RequiresGrant('note', 'update')
  @ApiOperation({ operationId: 'attachNoteFile', summary: 'Attach an uploaded (READY) file' })
  @ApiBody({ type: AttachNoteFileDto })
  @ApiCreatedResponse({ type: NoteDetailDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async attach(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: NoteIdParamsDto,
    @Body() body: AttachNoteFileDto,
  ): Promise<NoteDetailDto> {
    return toDetail(
      await this.attachNoteFile.execute(user, { noteId: params.id, fileId: body.fileId }),
    );
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Authenticated()
  @ApiOperation({
    operationId: 'archiveNote',
    summary: 'Archive a note (Owner/Admin any; a Member only their own)',
  })
  @ApiOkResponse({ type: ArchivedNoteDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async archive(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: NoteIdParamsDto,
  ): Promise<ArchivedNoteDto> {
    const result = await this.archiveNote.execute(user, { id: params.id });
    return { id: result.id, archivedAt: result.archivedAt.toISOString() };
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequiresGrant('note', 'restore')
  @ApiOperation({ operationId: 'restoreNote', summary: 'Restore an archived note (trash roles)' })
  @ApiOkResponse({ type: RestoredNoteDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'INTERNAL')
  async restore(
    @CurrentUser() user: CurrentUserModel,
    @Param() params: NoteIdParamsDto,
  ): Promise<RestoredNoteDto> {
    return refOf(await this.restoreNote.execute(user, { id: params.id }));
  }
}
