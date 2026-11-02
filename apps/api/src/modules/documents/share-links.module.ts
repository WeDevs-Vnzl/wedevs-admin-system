import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env.schema';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import type { RowLocksPort } from '../../shared/application/ports/row-locks.port';
import {
  ACTIVITY_LOG,
  AUTHORIZATION,
  CLOCK,
  ID_GENERATOR,
  ROW_LOCKS,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { NoteLinkTargetRegistry } from '../commercial/application/note-link-target.registry';
import { NotesModule } from '../commercial/notes.module';
import {
  SHARE_ACCESS_LOG_RETENTION,
  type ShareAccessLogRetentionPort,
} from './application/ports/share-access-log-retention.port';
import {
  SHARE_LINK_REPOSITORY,
  type ShareLinkRepository,
} from './application/ports/share-link.repository.port';
import { SHARE_SECRETS, type ShareSecretsPort } from './application/ports/share-secrets.port';
import { CreateShareLink } from './application/use-cases/shares/create-share-link.use-case';
import {
  GetShareLink,
  ListShareAccessLog,
  ListShareLinks,
} from './application/use-cases/shares/list-share-links.use-case';
import { MarkExpiredShareLinks } from './application/use-cases/shares/mark-expired-share-links.use-case';
import { PurgeShareAccessLog } from './application/use-cases/shares/purge-share-access-log.use-case';
import { RevokeShareLink } from './application/use-cases/shares/revoke-share-link.use-case';
import { SetShareDocumentAccessKey } from './application/use-cases/shares/set-share-document-access-key.use-case';
import { ShareSupport, ShareViews } from './application/use-cases/shares/share-support';
import { UpdateShareLink } from './application/use-cases/shares/update-share-link.use-case';
import { NodeShareSecrets } from './infrastructure/node-share-secrets';
import { PrismaShareAccessLog } from './infrastructure/prisma-share-access-log';
import { PrismaShareLinkRepository } from './infrastructure/prisma-share-link.repository';
import { ShareLinksController } from './interface/http/share-links.controller';

/**
 * Documents → share links (PRD §8.11, HU-22): management of the portal links, their access keys and their
 * access log, plus the expired-links step. The links are Owner and Admin only. Exports the repository and the
 * secrets port (the portal package builds on them), the support and views, `MarkExpiredShareLinks` for
 * BE-5's `daily-maintenance` and `PurgeShareAccessLog` for the `retention` job. Not imported by `AppModule` or `DocumentsModule` before package 5.1.
 */
@Module({
  imports: [NotesModule],
  controllers: [ShareLinksController],
  providers: [
    { provide: SHARE_LINK_REPOSITORY, useClass: PrismaShareLinkRepository },
    { provide: SHARE_ACCESS_LOG_RETENTION, useClass: PrismaShareAccessLog },
    {
      provide: SHARE_SECRETS,
      useFactory: (config: AppConfig): ShareSecretsPort =>
        new NodeShareSecrets({
          unlockSecret: config.SHARE_UNLOCK_SECRET,
          ipSalt: config.SHARE_IP_SALT,
        }),
      inject: [APP_CONFIG],
    },
    {
      provide: ShareSupport,
      useFactory: (
        shares: ShareLinkRepository,
        targets: NoteLinkTargetRegistry,
        secrets: ShareSecretsPort,
        activityLog: ActivityLogPort,
        locks: RowLocksPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
      ) => new ShareSupport(shares, targets, secrets, activityLog, locks, clock, ids),
      inject: [
        SHARE_LINK_REPOSITORY,
        NoteLinkTargetRegistry,
        SHARE_SECRETS,
        ACTIVITY_LOG,
        ROW_LOCKS,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: ShareViews,
      useFactory: (
        shares: ShareLinkRepository,
        targets: NoteLinkTargetRegistry,
        config: AppConfig,
        clock: ClockPort,
      ) => new ShareViews(shares, targets, config.APP_URL, clock),
      inject: [SHARE_LINK_REPOSITORY, NoteLinkTargetRegistry, APP_CONFIG, CLOCK],
    },
    {
      provide: ListShareLinks,
      useFactory: (
        authorization: AuthorizationPort,
        shares: ShareLinkRepository,
        views: ShareViews,
        clock: ClockPort,
      ) => new ListShareLinks(authorization, shares, views, clock),
      inject: [AUTHORIZATION, SHARE_LINK_REPOSITORY, ShareViews, CLOCK],
    },
    {
      provide: GetShareLink,
      useFactory: (authorization: AuthorizationPort, views: ShareViews) =>
        new GetShareLink(authorization, views),
      inject: [AUTHORIZATION, ShareViews],
    },
    {
      provide: ListShareAccessLog,
      useFactory: (authorization: AuthorizationPort, support: ShareSupport) =>
        new ListShareAccessLog(authorization, support),
      inject: [AUTHORIZATION, ShareSupport],
    },
    {
      provide: CreateShareLink,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: ShareSupport,
        views: ShareViews,
      ) => new CreateShareLink(authorization, uow, support, views),
      inject: [AUTHORIZATION, UNIT_OF_WORK, ShareSupport, ShareViews],
    },
    {
      provide: UpdateShareLink,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: ShareSupport,
        views: ShareViews,
      ) => new UpdateShareLink(authorization, uow, support, views),
      inject: [AUTHORIZATION, UNIT_OF_WORK, ShareSupport, ShareViews],
    },
    {
      provide: RevokeShareLink,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        support: ShareSupport,
        views: ShareViews,
      ) => new RevokeShareLink(authorization, uow, support, views),
      inject: [AUTHORIZATION, UNIT_OF_WORK, ShareSupport, ShareViews],
    },
    {
      provide: SetShareDocumentAccessKey,
      useFactory: (authorization: AuthorizationPort, uow: UnitOfWorkPort, support: ShareSupport) =>
        new SetShareDocumentAccessKey(authorization, uow, support),
      inject: [AUTHORIZATION, UNIT_OF_WORK, ShareSupport],
    },
    {
      provide: MarkExpiredShareLinks,
      useFactory: (uow: UnitOfWorkPort, support: ShareSupport) =>
        new MarkExpiredShareLinks(uow, support),
      inject: [UNIT_OF_WORK, ShareSupport],
    },
    {
      provide: PurgeShareAccessLog,
      useFactory: (
        uow: UnitOfWorkPort,
        retention: ShareAccessLogRetentionPort,
        activityLog: ActivityLogPort,
        clock: ClockPort,
      ) => new PurgeShareAccessLog(uow, retention, activityLog, clock),
      inject: [UNIT_OF_WORK, SHARE_ACCESS_LOG_RETENTION, ACTIVITY_LOG, CLOCK],
    },
  ],
  exports: [
    SHARE_LINK_REPOSITORY,
    SHARE_SECRETS,
    ShareSupport,
    ShareViews,
    MarkExpiredShareLinks,
    PurgeShareAccessLog,
  ],
})
export class ShareLinksModule {}
