export interface FeedPhase {
  phase: 'cold' | 'warm' | 'hot';
  vipActive: boolean;
  boostActive: boolean;
  everPaid: boolean;
  isCompleted: boolean;
}
