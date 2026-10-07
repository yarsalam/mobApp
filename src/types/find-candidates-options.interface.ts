export interface FindCandidatesOptions {
  excludeUserId?: number;
  gender?: string;
  city?: string;
  ageFrom?: number;
  ageTo?: number;
  onlyCompleted?: boolean;
  onlyOnline?: boolean;
  limit?: number;
}
