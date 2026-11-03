import { Module } from '@nestjs/common';
import { ApiTokensModule } from '../identity/api-tokens.module';
import { ApiTokensController } from '../identity/interface/http/api-tokens.controller';

/**
 * The routes `GET|POST /me/api-tokens` and `POST /me/api-tokens/{id}/revoke` (A9, DT-189), over the use cases
 * `ApiTokensModule` exports. Lives with the MCP module because that is where the tokens are used. Imported by
 * `AppModule` through the MCP aggregator (package 4.1).
 */
@Module({ imports: [ApiTokensModule], controllers: [ApiTokensController] })
export class ApiTokenRoutesModule {}
