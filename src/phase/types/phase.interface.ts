export interface PhaseWeights {
  matches: number;
  messages: number;
  views: number;
  retentionDays: number;
  boostUsed: number;
  cityUsers: number;
  learningScore: number;
  profileCompleteness: number;
  sentimentScore: number;
}

export const DEFAULT_WEIGHTS: PhaseWeights = {
  matches: 2.5,
  messages: 2.0,
  views: 0.3,
  retentionDays: 1.5,
  boostUsed: 1.0,
  cityUsers: 5.0,
  learningScore: 4.0,
  profileCompleteness: 4.0,
  sentimentScore: 2.0,
};
