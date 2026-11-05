import { NotFoundException } from '@nestjs/common';
import { FeatureStoreRevenueService } from './feature-store-rvenue.service';

describe('FeatureStoreRevenueService provenance contract', () => {
  const user = {
    id: 123,
    city: 'Tehran',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    acquisitionSource: null,
    metadata: {},
  };

  const makeService = (userRecord: unknown = user) => {
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };
    const userRepo = {
      findOne: jest.fn().mockResolvedValue(userRecord),
      count: jest.fn()
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(100),
    };
    const paymentRepo = { find: jest.fn().mockResolvedValue([]) };
    const eventRepo = { find: jest.fn().mockResolvedValue([]) };
    const seoActivityRepo = {};
    const externalSEOTools = { getKeywordDifficulty: jest.fn().mockResolvedValue(null) };

    const service = new FeatureStoreRevenueService(
      redis as never,
      userRepo as never,
      paymentRepo as never,
      eventRepo as never,
      seoActivityRepo as never,
      externalSEOTools as never,
    );
    return { service, redis, userRepo, externalSEOTools };
  };

  it('returns missing values and provenance instead of synthetic numeric defaults', async () => {
    const { service, redis } = makeService();

    const result = await service.getUserFeatures(123);

    expect(result.channelType).toBeNull();
    expect(result.keywordDifficulty).toBeNull();
    expect(result.contentLength).toBeNull();
    expect(result.timeToConversion).toBeNull();
    expect(result.intentScore).toBeNull();
    expect(result.retentionImpact).toBeNull();
    expect(result.campaignCost).toBeNull();
    expect(result.competitorPressure).toBeNull();
    expect(result.seasonalityFactor).toBeNull();
    expect(result.segmentSize).toBeNull();
    expect(result.ltv).toBeNull();
    expect(result.cac).toBeNull();
    expect(result.paybackPeriod).toBeNull();

    expect(result.engagementDepth).toBe(0);
    expect(result.featureProvenance.keywordDifficulty).toMatchObject({
      status: 'missing',
      source: null,
      revision: 'revenue-features-v1',
    });
    expect(result.featureProvenance.engagementDepth).toMatchObject({
      status: 'observed',
      source: 'PartitionedEvent',
      units: 'event_count',
    });
    expect(redis.set).toHaveBeenCalledWith(
      'revenue_features:v2:123',
      expect.any(String),
      3600,
    );
  });

  it('does not synthesize a feature record for an unknown user', async () => {
    const { service } = makeService(null);

    await expect(service.getUserFeatures(999)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns null for missing or failed keyword difficulty lookups', async () => {
    const { service, externalSEOTools } = makeService();

    await expect(service.getKeywordDifficulty('unknown keyword')).resolves.toBeNull();
    externalSEOTools.getKeywordDifficulty.mockRejectedValue(new Error('provider unavailable'));
    await expect(service.getKeywordDifficulty('provider failure')).resolves.toBeNull();
  });
});
