import { Logger } from '@nestjs/common';
import {
  EmbeddingsProvider,
  EmbeddingInputType,
} from './embeddings-provider.interface';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

/**
 * Proveedor de embeddings contra Voyage AI (recomendado por Anthropic). Usa
 * `input_type` para optimizar recuperación (documentos vs. consultas).
 */
export class VoyageEmbeddingsProvider implements EmbeddingsProvider {
  private readonly logger = new Logger(VoyageEmbeddingsProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    readonly dimension: number,
  ) {}

  async embed(
    texts: string[],
    inputType: EmbeddingInputType = 'document',
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const response = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        input_type: inputType,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `Voyage respondió ${response.status}: ${detail.slice(0, 300)}`,
      );
      throw new Error(
        `Fallo al generar embeddings (Voyage ${response.status})`,
      );
    }

    const json = (await response.json()) as VoyageResponse;
    // Voyage devuelve en orden, pero ordenamos por `index` por seguridad.
    return json.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}
