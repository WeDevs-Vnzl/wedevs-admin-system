import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClientMetricsWriterPort } from '../../shared/application/ports/client-metrics-writer.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import { ExportSourceRegistry } from '../../shared/application/ports/export-source.port';
import { SearchReindexRegistry } from '../../shared/application/ports/search-reindex.port';
import { TransactionHost } from '../../shared/infrastructure/prisma/transaction-host';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import type { RowLocksPort } from '../../shared/application/ports/row-locks.port';
import type { SearchIndexPort } from '../../shared/application/ports/search-index.port';
import type { SequencePort } from '../../shared/application/ports/sequence.port';
import {
  ACTIVITY_LOG,
  AUTHORIZATION,
  CLIENT_METRICS_WRITER,
  CLOCK,
  ID_GENERATOR,
  ROW_LOCKS,
  SEARCH_INDEX,
  SEQUENCE,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import {
  RESTORE_HANDLER_REGISTRY,
  type RestoreHandler,
} from '../platform/application/ports/restore-handler.port';
import type { RestoreHandlerRegistry } from '../platform/application/restore-handler.registry';
import { FinanceDependentsModule } from '../finance/finance-dependents.module';
import { TrashModule } from '../platform/trash.module';
import {
  TAGGABLE_TARGET_REGISTRY,
  type TaggableTargetResolver,
} from '../settings/application/ports/taggable-target.port';
import { TagAssignments } from '../settings/application/tag-assignments';
import type { TaggableTargetRegistry } from '../settings/application/taggable-target.registry';
import { TagsModule } from '../settings/tags.module';
import {
  CLIENT_SEARCH_DEPENDENTS,
  type ClientSearchDependentsPort,
} from './application/ports/client-search-dependents.port';
import {
  PROJECT_REPOSITORY,
  type ProjectRepository,
} from './application/ports/project.repository.port';
import {
  CLIENT_FINANCE_DEPENDENTS,
  type ClientFinanceDependentsPort,
} from './application/ports/client-finance-dependents.port';
import {
  CLIENT_REPOSITORY,
  type ClientRepository,
} from './application/ports/client.repository.port';
import {
  CONTACT_REPOSITORY,
  type ContactRepository,
} from './application/ports/contact.repository.port';
import { ArchiveClients } from './application/use-cases/archive-clients.use-case';
import { ArchiveContact } from './application/use-cases/archive-contact.use-case';
import { CreateClient } from './application/use-cases/create-client.use-case';
import { CreateContact } from './application/use-cases/create-contact.use-case';
import { GetClient } from './application/use-cases/get-client.use-case';
import { ListClients } from './application/use-cases/list-clients.use-case';
import { ListContacts } from './application/use-cases/list-contacts.use-case';
import { RestoreClient } from './application/use-cases/restore-client.use-case';
import { RestoreContact } from './application/use-cases/restore-contact.use-case';
import { SearchClients } from './application/use-cases/search-clients.use-case';
import { SearchContacts } from './application/use-cases/search-contacts.use-case';
import { SetClientStatus } from './application/use-cases/set-client-status.use-case';
import { SetPrimaryContact } from './application/use-cases/set-primary-contact.use-case';
import { UpdateClient } from './application/use-cases/update-client.use-case';
import { UpdateContact } from './application/use-cases/update-contact.use-case';
import {
  ClientReindexSource,
  ContactReindexSource,
} from './infrastructure/commercial-reindex-sources';
import {
  ClientExportSource,
  ContactExportSource,
} from './infrastructure/commercial-export-sources';
import { ClientRestoreHandler } from './infrastructure/client-restore.handler';
import { ClientTaggableResolver } from './infrastructure/client-taggable.resolver';
import { ContactRestoreHandler } from './infrastructure/contact-restore.handler';
import { ContactTaggableResolver } from './infrastructure/contact-taggable.resolver';
import { PrismaClientRepository } from './infrastructure/prisma-client.repository';
import { PrismaContactRepository } from './infrastructure/prisma-contact.repository';
import { PrismaProjectRepository } from './infrastructure/prisma-project.repository';
import { ClientsController } from './interface/http/clients.controller';
import { ContactsController } from './interface/http/contacts.controller';

/**
 * Commercial → clients and contacts (PRD §8.2, HU-03, HU-04). Registers, from `onModuleInit`, the restore
 * handlers `CLIENT` / `CONTACT` in the trash registry and the taggable resolvers `CLIENT` / `CONTACT` in the
 * tag registry (the `FILE_ACCESS_REGISTRY` pattern). `ClientFinanceDependentsPort` comes from finance's
 * `FinanceDependentsModule` (open invoices lock the archive, C19). Not imported by `CommercialModule` here; package
 * 4.1 wires it.
 */
@Module({
  imports: [TagsModule, TrashModule, FinanceDependentsModule],
  controllers: [ClientsController, ContactsController],
  providers: [
    { provide: CLIENT_REPOSITORY, useClass: PrismaClientRepository },
    { provide: CONTACT_REPOSITORY, useClass: PrismaContactRepository },
    // The rename rewrites the client's projects' entries (DT-166); the repository is stateless over the
    // ambient transaction, so this instance serves the same rows `ProjectsModule`'s does.
    { provide: PROJECT_REPOSITORY, useClass: PrismaProjectRepository },
    {
      provide: ClientTaggableResolver,
      useFactory: (clients: ClientRepository) => new ClientTaggableResolver(clients),
      inject: [CLIENT_REPOSITORY],
    },
    {
      provide: ContactTaggableResolver,
      useFactory: (contacts: ContactRepository) => new ContactTaggableResolver(contacts),
      inject: [CONTACT_REPOSITORY],
    },
    {
      provide: ListClients,
      useFactory: (
        authorization: AuthorizationPort,
        clients: ClientRepository,
        assignments: TagAssignments,
      ) => new ListClients(authorization, clients, assignments),
      inject: [AUTHORIZATION, CLIENT_REPOSITORY, TagAssignments],
    },
    {
      provide: SearchClients,
      useFactory: (authorization: AuthorizationPort, clients: ClientRepository) =>
        new SearchClients(authorization, clients),
      inject: [AUTHORIZATION, CLIENT_REPOSITORY],
    },
    {
      provide: GetClient,
      useFactory: (
        authorization: AuthorizationPort,
        clients: ClientRepository,
        contacts: ContactRepository,
        assignments: TagAssignments,
      ) => new GetClient(authorization, clients, contacts, assignments),
      inject: [AUTHORIZATION, CLIENT_REPOSITORY, CONTACT_REPOSITORY, TagAssignments],
    },
    {
      provide: CreateClient,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        clients: ClientRepository,
        contacts: ContactRepository,
        assignments: TagAssignments,
        activityLog: ActivityLogPort,
        searchIndex: SearchIndexPort,
        metrics: ClientMetricsWriterPort,
        sequence: SequencePort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ) =>
        new CreateClient(
          authorization,
          uow,
          clients,
          contacts,
          assignments,
          activityLog,
          searchIndex,
          metrics,
          sequence,
          clock,
          ids,
        ),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        CLIENT_REPOSITORY,
        CONTACT_REPOSITORY,
        TagAssignments,
        ACTIVITY_LOG,
        SEARCH_INDEX,
        CLIENT_METRICS_WRITER,
        SEQUENCE,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: UpdateClient,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        clients: ClientRepository,
        contacts: ContactRepository,
        assignments: TagAssignments,
        activityLog: ActivityLogPort,
        searchIndex: SearchIndexPort,
        clock: ClockPort,
        rowLocks: RowLocksPort,
        projects: ProjectRepository,
        dependents: ClientSearchDependentsPort,
      ) =>
        new UpdateClient(
          authorization,
          uow,
          clients,
          contacts,
          assignments,
          activityLog,
          searchIndex,
          clock,
          rowLocks,
          projects,
          dependents,
        ),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        CLIENT_REPOSITORY,
        CONTACT_REPOSITORY,
        TagAssignments,
        ACTIVITY_LOG,
        SEARCH_INDEX,
        CLOCK,
        ROW_LOCKS,
        PROJECT_REPOSITORY,
        CLIENT_SEARCH_DEPENDENTS,
      ],
    },
    {
      provide: SetClientStatus,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        clients: ClientRepository,
        contacts: ContactRepository,
        assignments: TagAssignments,
        activityLog: ActivityLogPort,
        searchIndex: SearchIndexPort,
        clock: ClockPort,
      ) =>
        new SetClientStatus(
          authorization,
          uow,
          clients,
          contacts,
          assignments,
          activityLog,
          searchIndex,
          clock,
        ),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        CLIENT_REPOSITORY,
        CONTACT_REPOSITORY,
        TagAssignments,
        ACTIVITY_LOG,
        SEARCH_INDEX,
        CLOCK,
      ],
    },
    {
      provide: ArchiveClients,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        clients: ClientRepository,
        contacts: ContactRepository,
        finance: ClientFinanceDependentsPort,
        activityLog: ActivityLogPort,
        searchIndex: SearchIndexPort,
        clock: ClockPort,
      ) =>
        new ArchiveClients(
          authorization,
          uow,
          clients,
          contacts,
          finance,
          activityLog,
          searchIndex,
          clock,
        ),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        CLIENT_REPOSITORY,
        CONTACT_REPOSITORY,
        CLIENT_FINANCE_DEPENDENTS,
        ACTIVITY_LOG,
        SEARCH_INDEX,
        CLOCK,
      ],
    },
    {
      provide: RestoreClient,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        clients: ClientRepository,
        contacts: ContactRepository,
        assignments: TagAssignments,
        activityLog: ActivityLogPort,
        searchIndex: SearchIndexPort,
        clock: ClockPort,
      ) =>
        new RestoreClient(
          authorization,
          uow,
          clients,
          contacts,
          assignments,
          activityLog,
          searchIndex,
          clock,
        ),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        CLIENT_REPOSITORY,
        CONTACT_REPOSITORY,
        TagAssignments,
        ACTIVITY_LOG,
        SEARCH_INDEX,
        CLOCK,
      ],
    },
    {
      provide: ListContacts,
      useFactory: (
        authorization: AuthorizationPort,
        clients: ClientRepository,
        contacts: ContactRepository,
        assignments: TagAssignments,
      ) => new ListContacts(authorization, clients, contacts, assignments),
      inject: [AUTHORIZATION, CLIENT_REPOSITORY, CONTACT_REPOSITORY, TagAssignments],
    },
    {
      provide: SearchContacts,
      useFactory: (authorization: AuthorizationPort, contacts: ContactRepository) =>
        new SearchContacts(authorization, contacts),
      inject: [AUTHORIZATION, CONTACT_REPOSITORY],
    },
    {
      provide: CreateContact,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        clients: ClientRepository,
        contacts: ContactRepository,
        assignments: TagAssignments,
        activityLog: ActivityLogPort,
        searchIndex: SearchIndexPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ) =>
        new CreateContact(
          authorization,
          uow,
          clients,
          contacts,
          assignments,
          activityLog,
          searchIndex,
          clock,
          ids,
        ),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        CLIENT_REPOSITORY,
        CONTACT_REPOSITORY,
        TagAssignments,
        ACTIVITY_LOG,
        SEARCH_INDEX,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: UpdateContact,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        contacts: ContactRepository,
        assignments: TagAssignments,
        activityLog: ActivityLogPort,
        searchIndex: SearchIndexPort,
        clock: ClockPort,
      ) =>
        new UpdateContact(
          authorization,
          uow,
          contacts,
          assignments,
          activityLog,
          searchIndex,
          clock,
        ),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        CONTACT_REPOSITORY,
        TagAssignments,
        ACTIVITY_LOG,
        SEARCH_INDEX,
        CLOCK,
      ],
    },
    {
      provide: SetPrimaryContact,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        contacts: ContactRepository,
        assignments: TagAssignments,
        activityLog: ActivityLogPort,
        clock: ClockPort,
      ) => new SetPrimaryContact(authorization, uow, contacts, assignments, activityLog, clock),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        CONTACT_REPOSITORY,
        TagAssignments,
        ACTIVITY_LOG,
        CLOCK,
      ],
    },
    {
      provide: ArchiveContact,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        contacts: ContactRepository,
        activityLog: ActivityLogPort,
        searchIndex: SearchIndexPort,
        clock: ClockPort,
      ) => new ArchiveContact(authorization, uow, contacts, activityLog, searchIndex, clock),
      inject: [AUTHORIZATION, UNIT_OF_WORK, CONTACT_REPOSITORY, ACTIVITY_LOG, SEARCH_INDEX, CLOCK],
    },
    {
      provide: RestoreContact,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        clients: ClientRepository,
        contacts: ContactRepository,
        assignments: TagAssignments,
        activityLog: ActivityLogPort,
        searchIndex: SearchIndexPort,
        clock: ClockPort,
      ) =>
        new RestoreContact(
          authorization,
          uow,
          clients,
          contacts,
          assignments,
          activityLog,
          searchIndex,
          clock,
        ),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        CLIENT_REPOSITORY,
        CONTACT_REPOSITORY,
        TagAssignments,
        ACTIVITY_LOG,
        SEARCH_INDEX,
        CLOCK,
      ],
    },
    {
      provide: ClientRestoreHandler,
      useFactory: (restoreClient: RestoreClient) => new ClientRestoreHandler(restoreClient),
      inject: [RestoreClient],
    },
    {
      provide: ContactRestoreHandler,
      useFactory: (restoreContact: RestoreContact) => new ContactRestoreHandler(restoreContact),
      inject: [RestoreContact],
    },
  ],
  exports: [ListClients],
})
export class ClientsModule implements OnModuleInit {
  constructor(
    @Inject(TAGGABLE_TARGET_REGISTRY) private readonly taggables: TaggableTargetRegistry,
    @Inject(RESTORE_HANDLER_REGISTRY) private readonly restoreHandlers: RestoreHandlerRegistry,
    private readonly clientResolver: ClientTaggableResolver,
    private readonly contactResolver: ContactTaggableResolver,
    private readonly clientHandler: ClientRestoreHandler,
    private readonly contactHandler: ContactRestoreHandler,
    @Inject(SearchReindexRegistry) private readonly reindexRegistry: SearchReindexRegistry,
    @Inject(ExportSourceRegistry) private readonly exportRegistry: ExportSourceRegistry,
    @Inject(TransactionHost) private readonly host: TransactionHost,
    @Inject(CLIENT_REPOSITORY) private readonly clients: ClientRepository,
    @Inject(CONTACT_REPOSITORY) private readonly contacts: ContactRepository,
    private readonly listClients: ListClients,
    private readonly listContacts: ListContacts,
  ) {}

  onModuleInit(): void {
    const resolvers: TaggableTargetResolver[] = [this.clientResolver, this.contactResolver];
    for (const resolver of resolvers) this.taggables.register(resolver);
    const handlers: RestoreHandler[] = [this.clientHandler, this.contactHandler];
    for (const handler of handlers) this.restoreHandlers.register(handler);
    this.reindexRegistry.register(new ClientReindexSource(this.host, this.clients));
    this.reindexRegistry.register(new ContactReindexSource(this.host, this.contacts));
    this.exportRegistry.register(new ClientExportSource(this.listClients));
    this.exportRegistry.register(new ContactExportSource(this.listContacts));
  }
}
