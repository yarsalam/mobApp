import { Global, Module } from '@nestjs/common';
import { QdrantProvider } from './qdrant.provider';

@Global()
@Module({
  providers: [QdrantProvider],
  exports: [QdrantProvider],
})
export class QdrantModule {}
