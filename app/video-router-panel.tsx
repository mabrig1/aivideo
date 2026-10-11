'use client';

import { useEffect, useMemo, useState } from 'react';
import { planAspectRatio } from '../lib/video-router/aspect-ratio';

type Mode = 'free-only' | 'free-preferred' | 'commercial-safe' | 'best-quality';

type ProviderState = {
  providerId: string;
  configured: boolean;
  healthy: boolean;
  available: boolean;
  quotaRemaining?: number;
  quotaUnit?: string;
  estimatedCostUsd?: number;
  reason?: string;
};

type Provider = {
  id: string;
  label: string;
  access: string;
  integration: string;
  commercialUse: string;
  watermark: string;
};

type Mission = {
  missionId: string;
  decision: {
    selectedProviderId: string | null;
    requiresHumanApproval: boolean;
    warnings: string[];
    candidates: Array<{
      providerId: string;
      score: number;
      estimatedCostUsd: number;
      quotaRemaining?: number;
      quotaUnit?: string;
    }>;
    rejected: Array<{ providerId: string; reasons: string[] }>;
  };
};

export type VideoRouterSelection = {
  mode: Mode;
  commercialUse: boolean;
  allowPaidFallback: boolean;
  maxCostUsd: number;
  selectedProviderId: string | null;
  requiresHumanApproval: boolean;
  warnings: string[];
  requestedAspectRatio: string;
  generationAspectRatio: '16:9' | '9:16' | '1:1';
  finishingStrategy: string;
};

export function VideoRouterPanel({
  prompt,
  aspectRatio,
  onSelection,
}: {
  prompt: string;
  aspectRatio: string;
  onSelection?: (selection: VideoRouterSelection) => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [runtime, setRuntime] = useState<ProviderState[]>([]);
  const [mode, setMode] = useState<Mode>('free-preferred');
  const [commercialUse, setCommercialUse] = useState(false);
  const [allowPaidFallback, setAllowPaidFallback] = useState(false);
  const [maxCostUsd, setMaxCostUsd] = useState(0);
  const [mission, setMission] = useState<Mission | null>(null);
  const [routing, setRouting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/video-router')
      .then((response) => response.json())
      .then((payload) => {
        setProviders(Array.isArray(payload.providers) ? payload.providers : []);
        setRuntime(Array.isArray(payload.runtime) ? payload.runtime : []);
      })
      .catch(() => setError('Provider status could not be loaded.'));
  }, []);

  const providerMap = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );
  const aspectPlan = useMemo(
    () => planAspectRatio(aspectRatio),
    [aspectRatio],
  );

  async function route() {
    setRouting(true);
    setError('');
    setMission(null);

    try {
      const response = await fetch('/api/video-router', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request: {
            prompt: prompt || 'Create a cinematic music-video shot.',
            durationSeconds: 8,
            aspectRatio: aspectPlan.generationAspectRatio,
            source: 'text',
            mode,
            commercialUse,
            allowPaidFallback,
            maxCostUsd,
          },
        }),
      });

      const payload = await response.json();
      if (!response.ok && !payload?.decision) {
        throw new Error(payload?.error || 'No eligible route was found.');
      }

      setMission(payload);
      const selection: VideoRouterSelection = {
        mode,
        commercialUse,
        allowPaidFallback,
        maxCostUsd,
        selectedProviderId: payload?.decision?.selectedProviderId ?? null,
        requiresHumanApproval:
          Boolean(payload?.decision?.requiresHumanApproval),
        warnings: Array.isArray(payload?.decision?.warnings)
          ? payload.decision.warnings
          : [],
        requestedAspectRatio: aspectPlan.requestedAspectRatio,
        generationAspectRatio: aspectPlan.generationAspectRatio,
        finishingStrategy: aspectPlan.finishingStrategy,
      };
      onSelection?.(selection);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Video routing failed.';
      setError(message);
      onSelection?.({
        mode,
        commercialUse,
        allowPaidFallback,
        maxCostUsd,
        selectedProviderId: null,
        requiresHumanApproval: false,
        warnings: [message],
        requestedAspectRatio: aspectPlan.requestedAspectRatio,
        generationAspectRatio: aspectPlan.generationAspectRatio,
        finishingStrategy: aspectPlan.finishingStrategy,
      });
    } finally {
      setRouting(false);
    }
  }

  return (
    <div className="panel">
      <h2>03 · AI Video Wallet & Router</h2>
      <p>
        Use included/self-hosted capacity first, then fall back only within
        your permissions and budget.
      </p>

      <label>Routing mode</label>
      <div className="chips">
        {(
          [
            ['free-preferred', 'Free Preferred'],
            ['free-only', 'Free Only'],
            ['commercial-safe', 'Commercial Safe'],
            ['best-quality', 'Best Quality'],
          ] as Array<[Mode, string]>
        ).map(([value, label]) => (
          <button
            type="button"
            className={mode === value ? 'on' : ''}
            onClick={() => setMode(value)}
            key={value}
          >
            {label}
          </button>
        ))}
      </div>

      <label>Policy</label>
      <div className="chips">
        <button
          type="button"
          className={commercialUse ? 'on' : ''}
          onClick={() => setCommercialUse((value) => !value)}
        >
          {commercialUse ? '✓ ' : ''}Commercial Use
        </button>
        <button
          type="button"
          className={allowPaidFallback ? 'on' : ''}
          onClick={() => setAllowPaidFallback((value) => !value)}
        >
          {allowPaidFallback ? '✓ ' : ''}Allow Paid Fallback
        </button>
      </div>

      {allowPaidFallback && (
        <>
          <label>Maximum spend for this routed shot (USD)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={maxCostUsd}
            onChange={(event) =>
              setMaxCostUsd(Math.max(0, Number(event.target.value) || 0))
            }
          />
        </>
      )}

      {aspectPlan.requiresFinishing && (
        <div className="render">
          <b>
            Master {aspectPlan.requestedAspectRatio} · generate{' '}
            {aspectPlan.generationAspectRatio}
          </b>
          <span>{aspectPlan.finishingStrategy}</span>
        </div>
      )}

      <button type="button" className="generate" onClick={route} disabled={routing}>
        {routing ? 'Checking quota & providers…' : '⌁ Find Best Available Route'}
      </button>

      <div className="templateGrid">
        {runtime.map((state) => {
          const provider = providerMap.get(state.providerId);
          return (
            <div className="templateCard" key={state.providerId}>
              <b>{state.available ? '●' : '○'} {provider?.label ?? state.providerId}</b>
              <span>
                {provider?.access ?? 'provider'} ·{' '}
                {state.available ? 'available' : 'not configured'}
              </span>
              <small>
                {typeof state.quotaRemaining === 'number'
                  ? `${state.quotaRemaining} ${state.quotaUnit ?? 'quota'} remaining`
                  : state.reason || 'Quota/cost must be measured before paid routing.'}
              </small>
            </div>
          );
        })}
      </div>

      {mission && (
        <div className="render">
          <b>
            {mission.decision.selectedProviderId
              ? `Selected: ${providerMap.get(mission.decision.selectedProviderId)?.label ?? mission.decision.selectedProviderId}`
              : 'No eligible provider'}
          </b>
          <span>
            {mission.decision.requiresHumanApproval
              ? 'Human approval required before provider execution. '
              : ''}
            {mission.decision.warnings.join(' ')}
          </span>
        </div>
      )}

      {error && <div className="render"><b>Router notice</b><span>{error}</span></div>}
    </div>
  );
}
