export interface ProblemDetectorPhase {
  isCompleted: boolean;
  city?: string | null;
  bio?: string | null;

  phase: 'cold' | 'warm' | 'hot';

  everPaid: boolean;

  suggestedActions?: string[];
}
