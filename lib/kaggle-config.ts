export const BRIDGE_VERSION = 2;
export const MIN_BRIDGE_TOKEN_LENGTH = 32;

export function bridgeConfiguration() {
  const tokenConfigured = (process.env.KAGGLE_BRIDGE_TOKEN?.trim().length || 0) >= MIN_BRIDGE_TOKEN_LENGTH;
  let endpointValid = false;
  try {
    const url = new URL(process.env.R2_ENDPOINT?.trim() || '');
    endpointValid = url.protocol === 'https:' && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname === '/' &&
      /^[a-z0-9]+(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/.test(url.hostname);
  } catch { /* An absent or invalid endpoint is not ready. */ }
  const storageConfigured = endpointValid && ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']
    .every((name) => Boolean(process.env[name]?.trim()));
  return { tokenConfigured, storageConfigured, configured: tokenConfigured && storageConfigured };
}

export const bridgeReady = () => bridgeConfiguration().configured;

export function bridgeBuild() {
  const candidate = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '';
  const commit = /^[a-f0-9]{40}$/.test(candidate) ? candidate : null;
  return {
    version: BRIDGE_VERSION,
    commit,
    uploaderUrl: commit ? `https://raw.githubusercontent.com/mabrig1/aivideo/${commit}/scripts/kaggle_upload.py` : null,
  };
}
