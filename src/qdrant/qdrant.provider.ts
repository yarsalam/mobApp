import { QdrantClient } from '@qdrant/js-client-rest';

export const QDRANT_CLIENT = 'QDRANT_CLIENT';

export const QdrantProvider = {
  provide: QDRANT_CLIENT,
  useFactory: () =>
    new QdrantClient({
      host: process.env.QDRANT_HOST ?? 'qdrant',
      port: parseInt(process.env.QDRANT_PORT ?? '6333'),
    }),
};
