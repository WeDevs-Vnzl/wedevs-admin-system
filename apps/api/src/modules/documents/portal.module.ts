import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env.schema';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import type { RowLocksPort } from '../../shared/application/ports/row-locks.port';
import {
  CLOCK,
  ID_GENERATOR,
  ROW_LOCKS,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { NoteLinkTargetRegistry } from '../commercial/application/note-link-target.registry';
import { NotesModule } from '../commercial/notes.module';
import { IssueFileDeliveryUrl } from '../platform/application/use-cases/issue-file-delivery-url.use-case';
import { PlatformModule } from '../platform/platform.module';
import { DocumentTypeCatalog } from '../settings/application/document-type-catalog';
import { DocumentTypesModule } from '../settings/document-types.module';
import { DocumentVersionsModule } from './document-versions.module';
import {
  DOCUMENT_VERSION_REPOSITORY,
  type DocumentVersionRepository,
} from './application/ports/document-version.repository.port';
import { PORTAL_READ, type PortalReadPort } from './application/ports/portal-read.port';
import { RATE_LIMIT, type RateLimitPort } from './application/ports/rate-limit.port';
import {
  SHARE_ACCESS_LOG,
  type ShareAccessLogPort,
} from './application/ports/share-access-log.port';
import {
  SHARE_LINK_REPOSITORY,
  type ShareLinkRepository,
} from './application/ports/share-link.repository.port';
import { SHARE_SECRETS, type ShareSecretsPort } from './application/ports/share-secrets.port';
import { GetSharedDocumentDelivery } from './application/use-cases/portal/get-shared-document-delivery.use-case';
import { GetSharedDocument } from './application/use-cases/portal/get-shared-document.use-case';
import { PortalSupport } from './application/use-cases/portal/portal-support';
import { RecordShareView } from './application/use-cases/portal/record-share-view.use-case';
import { ResolveShareToken } from './application/use-cases/portal/resolve-share-token.use-case';
import { UnlockSharedDocument } from './application/use-cases/portal/unlock-shared-document.use-case';
import { PrismaPortalRead } from './infrastructure/prisma-portal-read';
import { PrismaShareAccessLog } from './infrastructure/prisma-share-access-log';
import { PortalHeadersMiddleware } from './interface/http/portal-headers.middleware';
import { PortalThrottlerGuard } from './interface/http/portal-throttler.guard';
import { PortalController } from './interface/http/portal.controller';
import { ShareLinksModule } from './share-links.module';

/**
 * Documents → public portal (PRD §8.11, HU-22; C22, C24, DT-45, DT-88): token resolution, viewing, unlock with
 * lockout, delivery, the access log and the throttler. The only unauthenticated routes of the context. Builds on
 * the share-link repository and secrets, the version reads, the type catalog and platform's
 * `IssueFileDeliveryUrl`. The throttler (`THROTTLE_TTL` seconds, `THROTTLE_LIMIT` requests per IP) guards the
 * portal controller only. Not imported by `AppModule` or `DocumentsModule` before package 5.1.
 */
@Module({
  imports: [
    ShareLinksModule,
    DocumentVersionsModule,
    DocumentTypesModule,
    PlatformModule,
    NotesModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ ttl: config.THROTTLE_TTL * 1000, limit: config.THROTTLE_LIMIT }],
      }),
    }),
  ],
  controllers: [PortalController],
  providers: [
    PortalThrottlerGuard,
    PrismaPortalRead,
    PrismaShareAccessLog,
    { provide: PORTAL_READ, useExisting: PrismaPortalRead },
    { provide: SHARE_ACCESS_LOG, useExisting: PrismaShareAccessLog },
    { provide: RATE_LIMIT, useExisting: PrismaShareAccessLog },
    {
      provide: PortalSupport,
      useFactory: (
        shares: ShareLinkRepository,
        read: PortalReadPort,
        secrets: ShareSecretsPort,
        accessLog: ShareAccessLogPort,
        uow: UnitOfWorkPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
        types: DocumentTypeCatalog,
        clients: NoteLinkTargetRegistry,
      ) => new PortalSupport(shares, read, secrets, accessLog, uow, clock, ids, types, clients),
      inject: [
        SHARE_LINK_REPOSITORY,
        PORTAL_READ,
        SHARE_SECRETS,
        SHARE_ACCESS_LOG,
        UNIT_OF_WORK,
        CLOCK,
        ID_GENERATOR,
        DocumentTypeCatalog,
        NoteLinkTargetRegistry,
      ],
    },
    {
      provide: ResolveShareToken,
      useFactory: (support: PortalSupport) => new ResolveShareToken(support),
      inject: [PortalSupport],
    },
    {
      provide: RecordShareView,
      useFactory: (support: PortalSupport) => new RecordShareView(support),
      inject: [PortalSupport],
    },
    {
      provide: UnlockSharedDocument,
      useFactory: (
        support: PortalSupport,
        uow: UnitOfWorkPort,
        locks: RowLocksPort,
        rateLimit: RateLimitPort,
        accessLog: ShareAccessLogPort,
      ) => new UnlockSharedDocument(support, uow, locks, rateLimit, accessLog),
      inject: [PortalSupport, UNIT_OF_WORK, ROW_LOCKS, RATE_LIMIT, SHARE_ACCESS_LOG],
    },
    {
      provide: GetSharedDocument,
      useFactory: (support: PortalSupport, versions: DocumentVersionRepository) =>
        new GetSharedDocument(support, versions),
      inject: [PortalSupport, DOCUMENT_VERSION_REPOSITORY],
    },
    {
      provide: GetSharedDocumentDelivery,
      useFactory: (
        support: PortalSupport,
        versions: DocumentVersionRepository,
        files: IssueFileDeliveryUrl,
      ) => new GetSharedDocumentDelivery(support, versions, files),
      inject: [PortalSupport, DOCUMENT_VERSION_REPOSITORY, IssueFileDeliveryUrl],
    },
  ],
})
export class PortalModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(PortalHeadersMiddleware).forRoutes(PortalController);
  }
}
