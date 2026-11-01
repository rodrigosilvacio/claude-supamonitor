export type Environment = "prod" | "staging" | "dev" | "prototipo";

export interface Project {
  id: string;
  name: string;
  project_ref: string;
  environment: Environment;
  db_quota_bytes: number | null;
  max_connections: number | null;
  active: boolean;
  secret_configured: boolean;
  consecutive_failures: number;
  last_scrape_at: string | null;
  created_at: string;
}

export interface CheckPart {
  ok: boolean;
  status: number;
  durationMs: number;
  message: string;
}

export interface ConnectionCheck {
  metrics: CheckPart & { seriesCount: number; metricNames: number };
  advisors: CheckPart;
}

export const ENV_LABEL: Record<Environment, string> = {
  prod: "Produção",
  staging: "Homologação",
  dev: "Desenvolvimento",
  prototipo: "Protótipo",
};
