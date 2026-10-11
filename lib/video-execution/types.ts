export type ExecutionProviderId = 'local-wan' | 'gemini-veo' | 'runway';

export type VideoExecutionInput = {
  missionId: string;
  prompt: string;
  durationSeconds: number;
  aspectRatio: '16:9' | '9:16' | '1:1';
  sourceImageUrl?: string;
  sourceVideoUrl?: string;
  audioUrl?: string;
  referenceImageUrls?: string[];
  candidateProviderIds: ExecutionProviderId[];
  /**
   * Short-lived HMAC approval issued by the operator-only approval endpoint.
   * Metered providers are not executable without a valid signed approval.
   */
  approvalToken?: string;
  /**
   * Legacy request metadata retained for compatibility. It is not trusted as
   * authorization; signed approvalToken scope is authoritative.
   */
  approvedPaidProviderIds?: ExecutionProviderId[];
  maxRunwayCredits?: number;
};

export type ProviderPreflight = {
  ok: boolean;
  providerId: ExecutionProviderId;
  detail: string;
  estimatedCredits?: number;
  estimatedCostUsd?: number;
  model?: string;
};

export type ProviderSubmission = {
  providerId: ExecutionProviderId;
  providerJobId: string;
  status: 'queued' | 'working';
  model?: string;
  estimatedCredits?: number;
  metadata?: Record<string, unknown>;
};

export type ProviderJobStatus = {
  providerId: ExecutionProviderId;
  providerJobId: string;
  status: 'queued' | 'working' | 'succeeded' | 'failed';
  outputUrls: string[];
  error?: string;
  metadata?: Record<string, unknown>;
};

export type ExecutionAttempt = {
  providerId: ExecutionProviderId;
  stage: 'preflight' | 'submit';
  ok: boolean;
  detail: string;
};

export type ExecutionResult = {
  missionId: string;
  submission: ProviderSubmission | null;
  attempts: ExecutionAttempt[];
  warnings: string[];
};

export interface VideoExecutionAdapter {
  readonly providerId: ExecutionProviderId;
  readonly metered: boolean;
  configured(): boolean;
  preflight(input: VideoExecutionInput): Promise<ProviderPreflight>;
  submit(input: VideoExecutionInput): Promise<ProviderSubmission>;
  status(providerJobId: string): Promise<ProviderJobStatus>;
}
