import type {
  ExecutionProviderId,
  VideoExecutionInput,
} from './types';

const METERED = new Set<ExecutionProviderId>(['gemini-veo', 'runway']);

export type ExecutionApprovalPayload = {
  missionId: string;
  providerIds: ExecutionProviderId[];
  issuedAt: number;
  expiresAt: number;
  maxRunwayCredits?: number;
};

type ApprovalRequest = {
  missionId: string;
  providerIds: ExecutionProviderId[];
  ttlSeconds?: number;
  maxRunwayCredits?: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function approvalSecret() {
  return process.env.VIDEO_APPROVAL_SECRET?.trim() || '';
}

function encodeBase64Url(value: Uint8Array | string) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    Math.ceil(value.length / 4) * 4,
    '=',
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return bytes;
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function validateProviders(providerIds: ExecutionProviderId[]) {
  return [...new Set(providerIds)].filter((providerId) =>
    METERED.has(providerId),
  );
}

export async function createExecutionApproval(
  request: ApprovalRequest,
): Promise<{ token: string; payload: ExecutionApprovalPayload }> {
  const secret = approvalSecret();
  if (!secret) {
    throw new Error('VIDEO_APPROVAL_SECRET is not configured.');
  }

  const missionId = request.missionId?.trim().slice(0, 120);
  if (!missionId) throw new Error('missionId is required.');

  const providerIds = validateProviders(request.providerIds || []);
  if (!providerIds.length) {
    throw new Error('At least one metered provider must be approved.');
  }

  const ttlSeconds = Math.min(
    1800,
    Math.max(60, Math.floor(request.ttlSeconds || 900)),
  );
  const issuedAt = Math.floor(Date.now() / 1000);
  const maxRunwayCredits =
    typeof request.maxRunwayCredits === 'number' &&
    Number.isFinite(request.maxRunwayCredits) &&
    request.maxRunwayCredits > 0
      ? request.maxRunwayCredits
      : undefined;

  const payload: ExecutionApprovalPayload = {
    missionId,
    providerIds,
    issuedAt,
    expiresAt: issuedAt + ttlSeconds,
    ...(maxRunwayCredits ? { maxRunwayCredits } : {}),
  };

  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const key = await hmacKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(encodedPayload)),
  );

  return {
    token: `${encodedPayload}.${encodeBase64Url(signature)}`,
    payload,
  };
}

export async function verifyExecutionApproval(
  token: string | undefined,
  input: VideoExecutionInput,
): Promise<ExecutionApprovalPayload | null> {
  if (!token) return null;

  const secret = approvalSecret();
  if (!secret) {
    throw new Error('VIDEO_APPROVAL_SECRET is not configured.');
  }

  const [encodedPayload, encodedSignature, extra] = token.split('.');
  if (!encodedPayload || !encodedSignature || extra) {
    throw new Error('Execution approval token is malformed.');
  }

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    decodeBase64Url(encodedSignature),
    encoder.encode(encodedPayload),
  );

  if (!valid) throw new Error('Execution approval signature is invalid.');

  let payload: ExecutionApprovalPayload;
  try {
    payload = JSON.parse(
      decoder.decode(decodeBase64Url(encodedPayload)),
    ) as ExecutionApprovalPayload;
  } catch {
    throw new Error('Execution approval payload is invalid.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.expiresAt || payload.expiresAt <= now) {
    throw new Error('Execution approval token has expired.');
  }

  if (payload.missionId !== input.missionId) {
    throw new Error('Execution approval is scoped to a different mission.');
  }

  const providerIds = validateProviders(payload.providerIds || []);
  if (!providerIds.length) {
    throw new Error('Execution approval contains no metered provider.');
  }

  if (
    typeof input.maxRunwayCredits === 'number' &&
    typeof payload.maxRunwayCredits === 'number' &&
    input.maxRunwayCredits > payload.maxRunwayCredits
  ) {
    throw new Error(
      'Requested Runway credit cap exceeds the signed operator approval.',
    );
  }

  return {
    ...payload,
    providerIds,
  };
}
