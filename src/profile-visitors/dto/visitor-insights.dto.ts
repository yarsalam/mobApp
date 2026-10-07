export class VisitorInsightsDto {
  free: {
    todayViews: number;
    uniqueToday: number;
  };

  premium?: {
    fullList: Array<{
      visitorId: number;
      visitorName: string;
      visitedAt: Date;
      isMutual: boolean;
    }>;
    mutualCount: number;
    repeatVisitors: number[];
  } | null;

  gold?: {
    historicalData: Array<{
      date: string;
      count: number;
      unique: number;
    }>;
    topVisitors: Array<{
      visitorId: number;
      visitCount: number;
      lastVisit: Date;
    }>;
    visitorsByHour: Record<number, number>;
  } | null;

  alerts: Array<{
    type: string;
    message: string;
    visitorId?: number;
    priority: 'low' | 'medium' | 'high';
  }>;
}
