import { Module } from '@nestjs/common';
import { FeaturesController } from './interface/http/features.controller';

/** `GET /features` (DT-227): reads the global `FEATURES` token of the config module. */
@Module({ controllers: [FeaturesController] })
export class FeaturesModule {}
