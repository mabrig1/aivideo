import {
  withVideoCircuitBreaker,
  videoCircuitBreakers,
} from '../video-router/circuit-breaker';
import { verifyExecutionApproval } from './approval';
import { safeProviderError } from './http';
import { executionAdapter } from './registry';
import type {
  ExecutionProviderId,
  ExecutionResult,
  ProviderJobStatus,
  VideoExecutionInput,
} from './types';

const METERED = new Set<ExecutionProviderId>(['gemini-veo', 'runway']);

function normalize(input: VideoExecutionInput): VideoExecutionInput {
  if (!input?.missionId?.trim()) throw new Error('missionId is required');
  if (!input?.prompt?.trim()) throw new Error('prompt is required');

  const durationSeconds = Number(input.durationSeconds);
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > 180
  ) {
    throw new Error('durationSeconds must be between 1 and 180');
  }

  const ratios = new Set(['16:9', '9:16', '1:1']);
  if (!ratios.has(input.aspectRatio)) {
    throw new Error('aspectRatio must be 16:9, 9:16 or 1:1');
  }

  const supported = new Set<ExecutionProviderId>([
    'local-wan',
    'gemini-veo',
    'runway',
  ]);
  const candidates = (input.candidateProviderIds || [])
    .filter((providerId): providerId is ExecutionProviderId =>
      supported.has(providerId),
    )
    .slice(0, 5);

  if (!candidates.length) {
    throw new Error('At least one executable candidate provider is required');
  }

  return {
    ...input,
    missionId: input.missionId.trim().slice(0, 120),
    prompt: input.prompt.trim().slice(0, 20_000),
    durationSeconds,
    candidateProviderIds: [...new Set(candidates)],
    referenceImageUrls: input.referenceImageUrls?.slice(0, 8),
    approvalToken: input.approvalToken?.trim().slice(0, 8_000),
    maxRunwayCredits:
      typeof input.maxRunwayCredits === 'number' &&
      Number.isFinite(input.maxRunwayCredits)
        ? Math.max(0, input.maxRunwayCredits)
        : undefined,
  };
}

export async function executeWithFallback(
  rawInput: VideoExecutionInput,
): Promise<ExecutionResult> {
  let input = normalize(rawInput);
  const attempts: ExecutionResult['attempts'] = [];
  const warnings: string[] = [];

  const approval = await verifyExecutionApproval(input.approvalToken, input);
  const approved = new Set(approval?.providerIds || []);

  if (
    typeof approval?.maxRunwayCredits === 'number' &&
    typeof input.maxRunwayCredits !== 'number'
  ) {
    input = {
      ...input,
      maxRunwayCredits: approval.maxRunwayCredits,
    };
  }

  if (input.approvedPaidProviderIds?.length) {
    warnings.push(
      'Legacy approvedPaidProviderIds metadata was ignored; signed operator approval is authoritative.',
    );
  }

  for (const providerId of input.candidateProviderIds) {
    const adapter = executionAdapter(providerId);

    if (!adapter) {
      attempts.push({
        providerId,
        stage: 'preflight',
        ok: false,
        detail: 'No execution adapter is registered.',
      });
      continue;
    }

    if (!adapter.configured()) {
      attempts.push({
        providerId,
        stage: 'preflight',
        ok: false,
        detail: 'Provider execution adapter is not configured.',
      });
      continue;
    }

    if (METERED.has(providerId) && !approved.has(providerId)) {
      attempts.push({
        providerId,
        stage: 'preflight',
        ok: false,
        detail:
          'Metered provider requires a valid signed operator approval for this mission.',
      });
      continue;
    }

    if (videoCircuitBreakers.isOpen(providerId)) {
      attempts.push({
        providerId,
        stage: 'preflight',
        ok: false,
        detail: 'Provider circuit breaker is open after repeated failures.',
      });
      continue;
    }

    try {
      const preflight = await withVideoCircuitBreaker(providerId, () =>
        adapter.preflight(input),
      );

      attempts.push({
        providerId,
        stage: 'preflight',
        ok: preflight.ok,
        detail: preflight.detail,
      });

      if (!preflight.ok) continue;

      const submission = await withVideoCircuitBreaker(providerId, () =>
        adapter.submit(input),
      );

      attempts.push({
        providerId,
        stage: 'submit',
        ok: true,
        detail: `Accepted as provider job ${submission.providerJobId}.`,
      });

      if (providerId === 'runway' && preflight.estimatedCredits) {
        warnings.push(
          `Runway dry-run estimated ${preflight.estimatedCredits} credits before submission.`,
        );
      }
      if (providerId === 'gemini-veo' && preflight.estimatedCostUsd) {
        warnings.push(
          `Gemini/Veo preflight estimated $${preflight.estimatedCostUsd.toFixed(2)} before submission.`,
        );
      }

      return {
        missionId: input.missionId,
        submission: {
          ...submission,
          estimatedCredits:
            submission.estimatedCredits ?? preflight.estimatedCredits,
          model: submission.model ?? preflight.model,
        },
        attempts,
        warnings,
      };
    } catch (error) {
      attempts.push({
        providerId,
        stage: 'submit',
        ok: false,
        detail: safeProviderError(error),
      });
    }
  }

  warnings.push(
    'Every approved execution route failed or was unavailable. No additional provider was charged.',
  );

  return {
    missionId: input.missionId,
    submission: null,
    attempts,
    warnings,
  };
}

export async function getExecutionStatus(
  providerId: ExecutionProviderId,
  providerJobId: string,
): Promise<ProviderJobStatus> {
  const adapter = executionAdapter(providerId);
  if (!adapter) throw new Error('Unknown execution provider');
  if (!adapter.configured()) {
    throw new Error('Execution provider is not configured');
  }

  return withVideoCircuitBreaker(providerId, () =>
    adapter.status(providerJobId),
  );
}
