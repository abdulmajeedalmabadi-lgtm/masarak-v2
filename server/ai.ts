/** Future adapter contract; deterministic navigation never calls an AI provider. */
export interface AIService {
  explainRoute(input: {
    language: string;
    steps: { key: string; distance: number }[];
  }): Promise<string>;
  estimateQueue(input: { anonymousDurations: number[] }): Promise<number>;
}
