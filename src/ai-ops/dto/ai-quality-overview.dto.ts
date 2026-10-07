export type ServiceStatus = 'healthy' | 'degraded' | 'down';

export interface RedisMonitorMetrics {
  dataAvailable: boolean;
  vectorCount: number | null;
  memoryUsedMb: number | null;
  memoryPeakMb: number | null;
  hitRate: number | null;
  evictedKeys: number | null;
}

export interface EmbeddedAiMetrics {
  dataAvailable: boolean;
  status: ServiceStatus;
  modelLoaded: boolean | null;
  redisOk: boolean | null;
  queueLength: number | null;
  uptime: string | null;
  avgEmbeddingLatency: string | null;
}

export interface MlServiceMetrics {
  dataAvailable: boolean;
  status: ServiceStatus;
  trainingEventCount: number | null;
  matchingJobsPerHour: number | null;
  avgMatchingLatency: string | null;
  failedJobs: number | null;
}

export interface UpliftMetrics {
  dataAvailable: boolean;
  status: ServiceStatus;
  modelTrained: boolean | null;
  lastTrainingAt: string | null;
  confidenceScore: number | null;
}

export interface LlmCostMetrics {
  dataAvailable: boolean;
  todayCost: number | null;
  monthCost: number | null;
  requestsToday: number | null;
}

export interface SystemMetrics {
  dataAvailable: boolean;
  cpu: { average: number; count: number } | null;
  memory: { totalGb: number; usedGb: number; percent: number } | null;
  disk: { totalGb: number; usedGb: number; percent: number } | null;
  app: {
    avgResponseTime: number;
    errorRate: number;
    isAvailable: boolean;
    sampleSize?: number;
  } | null;
  collectedAt: string | null;
}

export interface PerformanceIssue {
  type: string;
  value: number;
  threshold: number;
  severity: 'warning' | 'critical';
  impact: string;
  suggestion: string;
  revenueImpact: number;
  estimatedDailyLoss?: number;
  estimatedMonthlyLoss?: number;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  detectedAt: string;
}

export interface AiQualityOverviewDto {
  generatedAt: string;
  redis: RedisMonitorMetrics;
  embeddedAi: EmbeddedAiMetrics;
  mlService: MlServiceMetrics;
  uplift: UpliftMetrics;
  llmCost: LlmCostMetrics;
  system: SystemMetrics;
  performanceIssues: PerformanceIssue[];
}
