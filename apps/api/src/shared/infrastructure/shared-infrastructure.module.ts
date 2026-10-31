import { Global, Module } from '@nestjs/common';
import {
  ACTIVITY_LOG,
  CLIENT_METRICS_WRITER,
  CLOCK,
  ID_GENERATOR,
  REQUEST_CONTEXT,
  ROW_LOCKS,
  SEARCH_INDEX,
  SEQUENCE,
  UNIT_OF_WORK,
} from '../application/ports/tokens';
import { CuidGenerator } from './id-generator.adapter';
import { PrismaActivityLog } from './prisma/prisma-activity-log';
import { PrismaClientMetricsWriter } from './prisma/prisma-client-metrics-writer';
import { PrismaRowLocks } from './prisma/prisma-row-locks';
import { PrismaSearchIndex } from './prisma/prisma-search-index';
import { PrismaSequence } from './prisma/prisma-sequence';
import { PrismaService } from './prisma/prisma.service';
import { PrismaUnitOfWork } from './prisma/prisma-unit-of-work';
import { TransactionHost } from './prisma/transaction-host';
import { AsyncLocalRequestContext } from './request-context.adapter';
import { SystemClock } from './system-clock.adapter';

@Global()
@Module({
  providers: [
    PrismaService,
    TransactionHost,
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: CuidGenerator },
    { provide: UNIT_OF_WORK, useClass: PrismaUnitOfWork },
    { provide: ACTIVITY_LOG, useClass: PrismaActivityLog },
    { provide: SEQUENCE, useClass: PrismaSequence },
    { provide: SEARCH_INDEX, useClass: PrismaSearchIndex },
    { provide: CLIENT_METRICS_WRITER, useClass: PrismaClientMetricsWriter },
    { provide: ROW_LOCKS, useClass: PrismaRowLocks },
    { provide: REQUEST_CONTEXT, useClass: AsyncLocalRequestContext },
  ],
  exports: [
    PrismaService,
    TransactionHost,
    CLOCK,
    ID_GENERATOR,
    UNIT_OF_WORK,
    ACTIVITY_LOG,
    SEQUENCE,
    SEARCH_INDEX,
    CLIENT_METRICS_WRITER,
    ROW_LOCKS,
    REQUEST_CONTEXT,
  ],
})
export class SharedInfrastructureModule {}
