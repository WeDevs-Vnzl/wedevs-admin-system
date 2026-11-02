import { Module } from '@nestjs/common';
import { AlertsModule } from './alerts.module';
import { DashboardModule } from './dashboard.module';
import { ExportsModule } from './exports.module';
import { GraphModule } from './graph.module';
import { OverviewsModule } from './overviews.module';
import { ReportsModule } from './reports.module';
import { SearchModule } from './search.module';

/**
 * Aggregator of the `intelligence` context (A1). `AppModule` imports it **before** the owning contexts, and
 * `OverviewsModule` comes first here, so `GET /x/overview` registers ahead of `GET /x/:id` (X13). Likewise
 * `ReportsModule` declares `/reports/kpis` before `/reports/:slug` in its own controller. Do not reorder.
 */
@Module({
  imports: [
    OverviewsModule,
    ReportsModule,
    DashboardModule,
    AlertsModule,
    SearchModule,
    GraphModule,
    ExportsModule,
  ],
})
export class IntelligenceModule {}
