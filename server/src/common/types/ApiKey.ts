export interface ApiKey {
  id: string;
  organisation: string;
  rate_limit_per_hour?: number;
  retention_period_days?: number;
  created: Date;
  updated: Date;
}

