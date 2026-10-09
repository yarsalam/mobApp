import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';

export const SEMANTIC_EMBEDDING_DIMENSIONS = 384;

@Injectable()
export class SemanticEmbeddingService {
  private readonly logger = new Logger(SemanticEmbeddingService.name);

  constructor(private readonly aiService: AiService) {}

  async embedText(text: string): Promise<number[]> {
    const normalizedText = text.trim();

    if (!normalizedText) {
      throw new Error('Cannot create an embedding from empty text');
    }

    const response: unknown = await this.aiService.embedText(normalizedText);

    const vector = this.extractVector(response);

    if (vector.length !== SEMANTIC_EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Invalid semantic embedding dimensions: expected ` +
          `${SEMANTIC_EMBEDDING_DIMENSIONS}, received ${vector.length}`,
      );
    }

    if (!vector.every(Number.isFinite)) {
      throw new Error('Semantic embedding contains non-finite values');
    }

    const norm = Math.sqrt(
      vector.reduce((sum, value) => sum + value * value, 0),
    );

    if (!Number.isFinite(norm) || norm === 0) {
      throw new Error('Semantic embedding has an invalid norm');
    }

    return vector.map((value) => value / norm);
  }

  private extractVector(response: unknown): number[] {
    if (response === null || typeof response !== 'object') {
      throw new Error('Embedding API returned an invalid response');
    }

    const result = response as Record<string, unknown>;

    // قراردادهای رایج پاسخ؛ ساختار واقعی API باید تأیید شود.
    const data =
      result['data'] !== null && typeof result['data'] === 'object'
        ? (result['data'] as Record<string, unknown>)
        : undefined;

    const candidate =
      result['embedding'] ??
      result['vector'] ??
      data?.['embedding'] ??
      data?.['vector'];

    if (
      !Array.isArray(candidate) ||
      !candidate.every(
        (value): value is number =>
          typeof value === 'number' && Number.isFinite(value),
      )
    ) {
      this.logger.error('Embedding API response has no valid embedding vector');

      throw new Error('Embedding API returned an unsupported response shape');
    }

    return candidate;
  }
}
