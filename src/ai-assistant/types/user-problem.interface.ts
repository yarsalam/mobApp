export interface UserProblem {
  category:
    | 'profile'
    | 'image'
    | 'engagement'
    | 'payment'
    | 'personality'
    | 'phase'
    | 'technical';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  reason: string;
  solution: string;
  impact: string;
}
