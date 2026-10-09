import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';

export const SEMANTIC_VECTOR_DIMS = 384;

@Injectable()
export class SemanticEmbeddingService {
  private readonly logger = new Logger(SemanticEmbeddingService.name);

  constructor(private readonly aiService: AiService) {}

  async embedText(text: string): Promise<number[]> {
    const normalizedText = text.trim();

    if (!normalizedText) {
      throw new Error('Cannot embed empty text');
    }

    const response: unknown = await this.aiService.embedText(normalizedText);
    const vector = this.extractVector(response);

    if (vector.length !== SEMANTIC_VECTOR_DIMS) {
      throw new Error(
        `Expected ${SEMANTIC_VECTOR_DIMS}-dim embedding, got ${vector.length}`,
      );
    }

    if (!vector.every(Number.isFinite)) {
      throw new Error('Embedding contains non-finite values');
    }

    const norm = Math.sqrt(
      vector.reduce((sum, value) => sum + value * value, 0),
    );

    if (!Number.isFinite(norm) || norm === 0) {
      throw new Error('Embedding has an invalid norm');
    }

    return vector.map((value) => value / norm);
  }

  private extractVector(response: unknown): number[] {
    if (!response || typeof response !== 'object') {
      throw new Error('Embedding API returned an invalid response');
    }

    const result = response as Record<string, unknown>;
    const nested =
      result.data && typeof result.data === 'object'
        ? (result.data as Record<string, unknown>)
        : undefined;

    const candidate =
      result.embedding ?? result.vector ?? nested?.embedding ?? nested?.vector;

    if (
      !Array.isArray(candidate) ||
      !candidate.every(
        (value): value is number =>
          typeof value === 'number' && Number.isFinite(value),
      )
    ) {
      this.logger.error('Unsupported embedding response shape');
      throw new Error(
        'Embedding API must return embedding or vector as a number array',
      );
    }

    return candidate;
  }
}
