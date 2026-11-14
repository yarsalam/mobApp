import { describe, expect, it } from '@jest/globals';
import {
  acquisitionTouchFromUserMetadata,
  normalizeAcquisitionTouch,
} from './acquisition-attribution';

describe('acquisition attribution normalization', () => {
  it('normalizes Google paid search while dropping query strings and fragments', () => {
    const touch = normalizeAcquisitionTouch({
      source: 'Google',
      medium: 'CPC',
      campaign: 'trust',
      landingPage: 'https://yarsalam.top/safety?phone=private#section',
      capturedAt: '2026-11-13T10:00:00.000Z',
    });
    expect(touch).toMatchObject({
      source: 'google_ads',
      medium: 'cpc',
      campaign: 'trust',
      landingPage: 'https://yarsalam.top/safety',
      confidence: 'explicit_utm',
    });
    expect(touch.landingPage).not.toContain('phone');
  });

  it.each([
    ['https://chatgpt.com/search', 'chatgpt_search'],
    ['https://www.perplexity.ai/search', 'perplexity'],
    ['https://copilot.microsoft.com/', 'copilot'],
    ['https://gemini.google.com/app', 'gemini'],
    ['https://claude.ai/new', 'claude'],
    ['https://www.instagram.com/reel/example', 'instagram'],
    ['https://t.me/example', 'telegram'],
  ])('classifies referrer %s as %s', (referrer, source) => {
    const touch = normalizeAcquisitionTouch({ referrer });
    expect(touch.source).toBe(source);
    expect(touch.confidence).toBe('referrer');
  });

  it('lets a referral code override a generic referrer source', () => {
    const touch = normalizeAcquisitionTouch({
      source: 'instagram',
      referralCode: 'invite-abc',
    });
    expect(touch.source).toBe('referral');
    expect(touch.referralCode).toBe('invite-abc');
    expect(touch.confidence).toBe('referral');
  });

  it('does not treat the generic mobile app label as an organic source', () => {
    const touch = acquisitionTouchFromUserMetadata('mobile', {
      acquisitionMeta: { landingPage: 'app' },
    });
    expect(touch.source).toBe('unattributed');
    expect(touch.landingPage).toBeNull();
  });

  it('replaces a client timestamp too far in the future with server receipt time', () => {
    const now = new Date('2026-11-13T12:00:00.000Z');
    const touch = normalizeAcquisitionTouch({
      source: 'direct',
      capturedAt: '2027-01-01T00:00:00.000Z',
    }, {}, now);
    expect(touch.capturedAt).toBe(now.toISOString());
  });
});
