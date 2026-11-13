import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { AiAssistantService } from './ai-assistant.service';

function harness(llmResult: {
  text: string;
  usedProvider: boolean;
  provider: string | null;
  fallbackReason: 'no_provider_configured' | 'provider_request_failed' | null;
}) {
  const conversation = { id: 12, user: { id: 7 }, messages: [] };
  const saved: any[] = [];
  const msgRepo = {
    create: jest.fn((value: any) => value),
    save: jest.fn(async (value: any) => {
      saved.push(value);
      return value;
    }),
  };
  const openRouter = { askWithMetadata: jest.fn(async () => llmResult) };
  const intentDetector = {
    detect: jest.fn(async () => ({
      type: 'GENERAL_CHAT',
      needsLLM: true,
      confidence: 0.5,
      source: 'fallback',
    })),
    buildRuleBasedResponse: jest.fn(() => null),
  };
  const context = {
    build: jest.fn(async () => ({})),
    toPromptString: jest.fn(() => 'verified context'),
  };
  const convRepo = { findOne: jest.fn(async () => conversation) };
  const service = new AiAssistantService(
    convRepo as any,
    msgRepo as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    context as any,
    intentDetector as any,
    openRouter as any,
    { log: jest.fn(async () => undefined) } as any,
  );
  return { service, saved, openRouter, convRepo };
}

describe('AiAssistantService response provenance and ownership', () => {
  it('does not label a fallback response as LLM output', async () => {
    const h = harness({
      text: 'پاسخ جایگزین',
      usedProvider: false,
      provider: null,
      fallbackReason: 'no_provider_configured',
    });
    const result = await h.service.userSendsMessage(12, 7, 'یک سوال عمومی دارم');
    expect(result).toMatchObject({
      usedLLM: false,
      responseSource: 'fallback',
      fallbackReason: 'no_provider_configured',
    });
    expect(h.saved[1].meta).toMatchObject({
      usedLLM: false,
      responseSource: 'fallback',
      llmProvider: null,
    });
  });

  it('reports an LLM response only after the provider succeeds', async () => {
    const h = harness({
      text: 'پاسخ مدل',
      usedProvider: true,
      provider: 'Gemini',
      fallbackReason: null,
    });
    const result = await h.service.userSendsMessage(12, 7, 'یک سوال عمومی دارم');
    expect(result).toMatchObject({
      usedLLM: true,
      responseSource: 'llm',
      llmProvider: 'Gemini',
      fallbackReason: null,
    });
    expect(h.saved[1].meta).toMatchObject({
      usedLLM: true,
      responseSource: 'llm',
      llmProvider: 'Gemini',
    });
  });

  it('rejects access to another user conversation before saving a message', async () => {
    const h = harness({
      text: 'unused',
      usedProvider: false,
      provider: null,
      fallbackReason: 'no_provider_configured',
    });
    await expect(h.service.userSendsMessage(12, 99, 'unauthorized')).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.saved).toHaveLength(0);
    expect(h.openRouter.askWithMetadata).not.toHaveBeenCalled();
  });
});
