import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { of, throwError } from 'rxjs';
import { OpenRouterClientService } from './openrouter-client.service';

const KEYS = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY'] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

function clearKeys() {
  for (const key of KEYS) delete process.env[key];
}

afterEach(() => {
  for (const key of KEYS) {
    const value = ORIGINAL[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('OpenRouterClientService provenance', () => {
  it('marks unconfigured responses as fallback', async () => {
    clearKeys();
    const http = { post: jest.fn() };
    const service = new OpenRouterClientService(http as any);
    const result = await service.askWithMetadata({
      userMessage: 'چرا لایک نمی‌گیرم؟',
      contextString: '',
    });
    expect(result).toMatchObject({
      usedProvider: false,
      provider: null,
      fallbackReason: 'no_provider_configured',
    });
    expect(result.text).toContain('از روی این پیام به‌تنهایی');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('marks a successful Gemini response as provider output', async () => {
    clearKeys();
    process.env.GEMINI_API_KEY = 'test-key';
    const http = {
      post: jest.fn(() =>
        of({ data: { candidates: [{ content: { parts: [{ text: 'پاسخ واقعی مدل' }] } }] } }),
      ),
    };
    const service = new OpenRouterClientService(http as any);
    const result = await service.askWithMetadata({
      userMessage: 'سلام',
      contextString: 'داده تأییدشده',
    });
    expect(result).toEqual({
      text: 'پاسخ واقعی مدل',
      usedProvider: true,
      provider: 'Gemini',
      fallbackReason: null,
    });
  });

  it('marks provider errors as fallback', async () => {
    clearKeys();
    process.env.GEMINI_API_KEY = 'test-key';
    const http = {
      post: jest.fn(() => throwError(() => new Error('provider offline'))),
    };
    const service = new OpenRouterClientService(http as any);
    const result = await service.askWithMetadata({
      userMessage: 'برای پیام چه بنویسم؟',
      contextString: '',
    });
    expect(result).toMatchObject({
      usedProvider: false,
      provider: 'Gemini',
      fallbackReason: 'provider_request_failed',
    });
    expect(result.text).toContain('پاسخ‌ساز هوشمند در دسترس نیست');
  });
});
