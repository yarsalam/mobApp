import { describe, expect, it, jest } from '@jest/globals';
import { VectorSearchService } from './vector-search.service';
import {
  QDRANT_COLLECTION,
  QDRANT_SEMANTIC_COLLECTION,
} from '../../feature-store/feature-store.constan';

describe('VectorSearchService Qdrant query contract', () => {
  it('uses query and reads points for structural candidate retrieval', async () => {
    const vector = [0.1, 0.2, 0.3];
    const qdrant = {
      query: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({
        points: [{ id: 12 }, { id: 13 }],
      }),
    };
    const redis = {
      get: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue(null),
      set: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue('OK'),
      del: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue(1),
    };
    const userRepo = {
      find: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue([
        { id: 12 },
        { id: 13 },
      ]),
    };
    const service = new VectorSearchService(
      {} as any,
      userRepo as any,
      redis as any,
      qdrant as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const ids = await (service as any).findSimilarUsers(vector, 10, 7, 'female');

    expect(qdrant.query).toHaveBeenCalledWith(QDRANT_COLLECTION, {
      query: vector,
      limit: 11,
      filter: {
        must: [{ key: 'gender', match: { value: 'female' } }],
        must_not: [{ key: 'userId', match: { value: 7 } }],
      },
      with_payload: false,
    });
    expect(ids).toEqual([12, 13]);
  });

  it('uses query and reads points for semantic candidate retrieval', async () => {
    const vector = [0.4, 0.5, 0.6];
    const qdrant = {
      query: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({
        points: [{ id: 22 }],
      }),
    };
    const userRepo = {
      findOne: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({
        id: 7,
        nickname: 'User',
        aboutme: 'About',
        hobbies_self: 'Reading',
        values_self: 'Family',
        city: 'Tehran',
        education: 'University',
      }),
      find: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue([
        { id: 22 },
      ]),
    };
    const semanticEmbedding = {
      embedText: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue(vector),
    };
    const service = new VectorSearchService(
      {} as any,
      userRepo as any,
      {} as any,
      qdrant as any,
      {} as any,
      {} as any,
      semanticEmbedding as any,
    );

    const ids = await (service as any).findSemanticUsers(7, 10, 'male');

    expect(qdrant.query).toHaveBeenCalledWith(QDRANT_SEMANTIC_COLLECTION, {
      query: vector,
      limit: 11,
      filter: {
        must: [{ key: 'gender', match: { value: 'male' } }],
        must_not: [{ key: 'userId', match: { value: 7 } }],
      },
      with_payload: false,
    });
    expect(ids).toEqual([22]);
  });
});
