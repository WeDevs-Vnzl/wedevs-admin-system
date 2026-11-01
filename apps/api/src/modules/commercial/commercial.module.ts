import { Module } from '@nestjs/common';
import { ClientsModule } from './clients.module';
import { NotesModule } from './notes.module';
import { ProjectsModule } from './projects.module';

/**
 * Commercial aggregator (PRD §8.2-§8.3, §8.10): clients and contacts, projects and notes. Each
 * sub-module owns its providers; this module only composes them for `AppModule`. Projects export
 * `TechnologyUsageQueries`, which settings' technologies module reaches through a lazy lookup, so no
 * module import closes a cycle with settings.
 */
@Module({ imports: [ClientsModule, ProjectsModule, NotesModule] })
export class CommercialModule {}
