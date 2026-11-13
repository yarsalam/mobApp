import { describe, expect, it } from '@jest/globals';
import { IntentDetectorService, IntentType } from './intent-detector.service';

describe('IntentDetectorService fallback', () => {
  it('does not assume arbitrary short text is a greeting', async () => {
    const service = new IntentDetectorService({ classify: async () => null } as any);
    const result = await service.detect('ok');
    expect(result).toMatchObject({
      type: IntentType.GENERAL_CHAT,
      needsLLM: true,
      source: 'fallback',
    });
  });
});
