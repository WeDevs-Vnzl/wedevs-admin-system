import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env.schema';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../shared/application/ports/id-generator.port';
import {
  ACTIVITY_LOG,
  AUTHORIZATION,
  CLOCK,
  ID_GENERATOR,
  UNIT_OF_WORK,
} from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { APP_LOGGER, type AppLogger } from '../../shared/interface/logger';
import { SharedInterfaceModule } from '../../shared/interface/shared-interface.module';
import { FileAccessRegistry } from './application/file-access.registry';
import { CONTENT_SNIFFER, type ContentSnifferPort } from './application/ports/content-sniffer.port';
import { FILE_ACCESS_REGISTRY } from './application/ports/file-access.port';
import {
  FILE_CLEANUP_REPOSITORY,
  FILE_REPOSITORY,
  type FileCleanupRepository,
  type FileRepository,
} from './application/ports/file.repository.port';
import { FILE_STORAGE, type FileStoragePort } from './application/ports/file-storage.port';
import { HEALTH_PROBE, type HealthProbePort } from './application/ports/health-probe.port';
import {
  CleanupFiles,
  type CleanupFailureReporter,
} from './application/use-cases/cleanup-files.use-case';
import { ConfirmUpload } from './application/use-cases/confirm-upload.use-case';
import { DeleteFile } from './application/use-cases/delete-file.use-case';
import { GetFileDownload } from './application/use-cases/get-file-download.use-case';
import { GetFileSummary } from './application/use-cases/get-file-summary.use-case';
import { GetHealth } from './application/use-cases/get-health.use-case';
import { IssueFileDeliveryUrl } from './application/use-cases/issue-file-delivery-url.use-case';
import { ReserveFileForAttachment } from './application/use-cases/reserve-file-for-attachment.use-case';
import { RequestUpload } from './application/use-cases/request-upload.use-case';
import type { CleanupFailureHandler } from './application/upload-permission';
import { CloudinaryFileStorage } from './infrastructure/cloudinary-file-storage.adapter';
import { FileTypeSniffer } from './infrastructure/file-type-sniffer.adapter';
import { PrismaFileRepository } from './infrastructure/prisma-file.repository';
import { PrismaHealthProbe } from './infrastructure/prisma-health-probe.adapter';
import { ActivityModule } from './activity.module';
import { TrashModule } from './trash.module';
import { FilesController } from './interface/http/files.controller';
import { HealthController } from './interface/http/health.controller';

const logCleanupFailure =
  (logger: AppLogger): CleanupFailureHandler =>
  (error, context) =>
    logger.error(
      { fileId: context.fileId, storageKey: context.storageKey, err: error },
      'File asset cleanup failed; the cleanup job will retry',
    );

const logCleanupRunFailure =
  (logger: AppLogger): CleanupFailureReporter =>
  (error, context) =>
    logger.error(
      { fileId: context.fileId, storageKey: context.storageKey, err: error },
      'File cleanup step failed for one file; it stays for the next run',
    );

@Module({
  imports: [SharedInterfaceModule, ActivityModule, TrashModule],
  controllers: [HealthController, FilesController],
  providers: [
    { provide: HEALTH_PROBE, useClass: PrismaHealthProbe },
    {
      provide: GetHealth,
      useFactory: (probe: HealthProbePort, clock: ClockPort) => new GetHealth(probe, clock),
      inject: [HEALTH_PROBE, CLOCK],
    },

    // Files (DT-85)
    {
      provide: FILE_STORAGE,
      useFactory: (config: AppConfig, clock: ClockPort) =>
        new CloudinaryFileStorage(
          {
            cloudName: config.CLOUDINARY_CLOUD_NAME,
            apiKey: config.CLOUDINARY_API_KEY,
            apiSecret: config.CLOUDINARY_API_SECRET,
          },
          clock,
        ),
      inject: [APP_CONFIG, CLOCK],
    },
    { provide: CONTENT_SNIFFER, useClass: FileTypeSniffer },
    { provide: FILE_REPOSITORY, useClass: PrismaFileRepository },
    { provide: FILE_CLEANUP_REPOSITORY, useExisting: FILE_REPOSITORY },
    { provide: FILE_ACCESS_REGISTRY, useClass: FileAccessRegistry },
    {
      provide: IssueFileDeliveryUrl,
      useFactory: (files: FileRepository, storage: FileStoragePort, clock: ClockPort) =>
        new IssueFileDeliveryUrl(files, storage, clock),
      inject: [FILE_REPOSITORY, FILE_STORAGE, CLOCK],
    },
    {
      provide: CleanupFiles,
      useFactory: (
        files: FileCleanupRepository,
        storage: FileStoragePort,
        activity: ActivityLogPort,
        uow: UnitOfWorkPort,
        clock: ClockPort,
        logger: AppLogger,
      ) => new CleanupFiles(files, storage, activity, uow, clock, logCleanupRunFailure(logger)),
      inject: [
        FILE_CLEANUP_REPOSITORY,
        FILE_STORAGE,
        ACTIVITY_LOG,
        UNIT_OF_WORK,
        CLOCK,
        APP_LOGGER,
      ],
    },
    {
      provide: RequestUpload,
      useFactory: (
        authorization: AuthorizationPort,
        files: FileRepository,
        storage: FileStoragePort,
        ids: IdGeneratorPort,
        clock: ClockPort,
        uow: UnitOfWorkPort,
      ) => new RequestUpload(authorization, files, storage, ids, clock, uow),
      inject: [AUTHORIZATION, FILE_REPOSITORY, FILE_STORAGE, ID_GENERATOR, CLOCK, UNIT_OF_WORK],
    },
    {
      provide: ConfirmUpload,
      useFactory: (
        authorization: AuthorizationPort,
        files: FileRepository,
        storage: FileStoragePort,
        sniffer: ContentSnifferPort,
        activity: ActivityLogPort,
        uow: UnitOfWorkPort,
        clock: ClockPort,
        logger: AppLogger,
      ) =>
        new ConfirmUpload(
          authorization,
          files,
          storage,
          sniffer,
          activity,
          uow,
          clock,
          logCleanupFailure(logger),
        ),
      inject: [
        AUTHORIZATION,
        FILE_REPOSITORY,
        FILE_STORAGE,
        CONTENT_SNIFFER,
        ACTIVITY_LOG,
        UNIT_OF_WORK,
        CLOCK,
        APP_LOGGER,
      ],
    },
    {
      provide: GetFileDownload,
      useFactory: (
        authorization: AuthorizationPort,
        files: FileRepository,
        registry: FileAccessRegistry,
        storage: FileStoragePort,
        clock: ClockPort,
      ) => new GetFileDownload(authorization, files, registry, storage, clock),
      inject: [AUTHORIZATION, FILE_REPOSITORY, FILE_ACCESS_REGISTRY, FILE_STORAGE, CLOCK],
    },
    {
      provide: DeleteFile,
      useFactory: (
        authorization: AuthorizationPort,
        files: FileRepository,
        registry: FileAccessRegistry,
        storage: FileStoragePort,
        activity: ActivityLogPort,
        uow: UnitOfWorkPort,
        clock: ClockPort,
        logger: AppLogger,
      ) =>
        new DeleteFile(
          authorization,
          files,
          registry,
          storage,
          activity,
          uow,
          clock,
          logCleanupFailure(logger),
        ),
      inject: [
        AUTHORIZATION,
        FILE_REPOSITORY,
        FILE_ACCESS_REGISTRY,
        FILE_STORAGE,
        ACTIVITY_LOG,
        UNIT_OF_WORK,
        CLOCK,
        APP_LOGGER,
      ],
    },
    {
      provide: GetFileSummary,
      useFactory: (
        authorization: AuthorizationPort,
        files: FileRepository,
        registry: FileAccessRegistry,
      ) => new GetFileSummary(authorization, files, registry),
      inject: [AUTHORIZATION, FILE_REPOSITORY, FILE_ACCESS_REGISTRY],
    },
    {
      provide: ReserveFileForAttachment,
      useFactory: (
        authorization: AuthorizationPort,
        files: FileRepository,
        registry: FileAccessRegistry,
      ) => new ReserveFileForAttachment(authorization, files, registry),
      inject: [AUTHORIZATION, FILE_REPOSITORY, FILE_ACCESS_REGISTRY],
    },
  ],
  exports: [
    GetFileSummary,
    ReserveFileForAttachment,
    IssueFileDeliveryUrl,
    CleanupFiles,
    FILE_ACCESS_REGISTRY,
  ],
})
export class PlatformModule {}
