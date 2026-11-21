import { open, unlink } from 'node:fs/promises';

const PEXELS_ORIGIN = 'https://api.pexels.com';
const TRUSTED_VIDEO_HOSTS = new Set([
  'player.vimeo.com',
  'videos.pexels.com',
  'static-videos.pexels.com',
]);
const MAX_CLIP_BYTES = 120 * 1024 * 1024;

export type FreeScene = {
  id: number;
  duration: number;
  image: string;
  pageUrl: string;
  author: string;
  authorUrl: string;
  width: number;
  height: number;
  downloadAvailable: boolean;
};
type VideoFile = {
  file_type?: string;
  quality?: string;
  width?: number | null;
  height?: number | null;
  link?: string;
};
type VideoRecord = {
  id?: number;
  duration?: number;
  image?: string;
  url?: string;
  width?: number;
  height?: number;
  user?: { name?: string; url?: string };
  video_files?: VideoFile[];
};

export function normalizeFreeSceneQuery(query: string) {
  const clean = query.trim().replace(/\s+/g, ' ');
  if (clean.length < 2 || clean.length > 80 || /[<>\x00-\x1f]/.test(clean)) {
    throw new Error('Scene search must be 2–80 readable characters.');
  }
  return clean;
}

export function validatedFreeSceneIds(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 8 ||
    value.some((id) => !Number.isSafeInteger(id) || id < 1 || id > 2147483647) ||
    new Set(value).size !== value.length
  ) {
    throw new Error('Select 1–8 distinct official Pexels video IDs.');
  }
  return value as number[];
}

export function safePexelsVideoUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' || url.username || url.password ||
      url.port || !TRUSTED_VIDEO_HOSTS.has(url.hostname) ||
      !/\.mp4$/i.test(url.pathname)
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safePexelsPageUrl(value: string | undefined) {
  try {
    const u = new URL(value || '');
    return u.protocol === 'https:' && u.hostname === 'www.pexels.com' && !u.username &&
      u.pathname.startsWith('/video/') ? u.toString() : 'https://www.pexels.com/videos/';
  } catch {
    return 'https://www.pexels.com/videos/';
  }
}

function safePexelsAuthorUrl(value: string | undefined) {
  try {
    const u = new URL(value || '');
    return u.protocol === 'https:' && u.hostname === 'www.pexels.com' && !u.username
      ? u.toString() : 'https://www.pexels.com/';
  } catch {
    return 'https://www.pexels.com/';
  }
}

export function selectFreeSceneFile(files: VideoFile[] | undefined): string | null {
  const entries = (files || []).filter((file) =>
    file.file_type === 'video/mp4' &&
    Number.isFinite(file.width) && Number.isFinite(file.height) &&
    (file.width || 0) > 0 && (file.height || 0) > 0 &&
    (file.width || 0) * (file.height || 0) <= 1280 * 720 &&
    safePexelsVideoUrl(file.link) !== null,
  );
  entries.sort((a,b) =>
    ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)),
  );
  return entries.length ? safePexelsVideoUrl(entries[0].link) : null;
}

export function toFreeScene(video: VideoRecord): FreeScene | null {
  if (
    !Number.isSafeInteger(video.id) ||
    (video.id || 0) < 1 ||
    (video.id || 0) > 2147483647
  ) return null;
  const image = video.image || '';
  let safeImage = '';
  try {
    const u = new URL(image);
    if (u.protocol === 'https:' && ['images.pexels.com', 'static-videos.pexels.com'].includes(u.hostname)) {
      safeImage = u.toString();
    }
  } catch { /* no preview */ }
  return {
    id: video.id as number,
    duration: Math.max(0, Number(video.duration) || 0),
    image: safeImage,
    pageUrl: safePexelsPageUrl(video.url),
    author: (video.user?.name || 'Pexels contributor').slice(0, 120),
    authorUrl: safePexelsAuthorUrl(video.user?.url),
    width: Number(video.width) || 0,
    height: Number(video.height) || 0,
    downloadAvailable: Boolean(selectFreeSceneFile(video.video_files)),
  };
}

async function pexelsGet(
  path: string,
  key: string,
  fetcher: typeof fetch,
): Promise<unknown> {
  if (!key || key.length < 8) throw new Error('PEXELS_API_KEY is not configured.');
  if (!path.startsWith('/v1/videos/') || path.includes('..') || path.includes('//')) {
    throw new Error('Invalid Pexels API path.');
  }
  const response = await fetcher(PEXELS_ORIGIN + path, {
    headers: { Authorization: key, Accept: 'application/json' },
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error('Pexels search quota reached. Try later.');
    if (response.status === 401 || response.status === 403) throw new Error('Pexels API key was rejected.');
    throw new Error('Pexels API is temporarily unavailable.');
  }
  const raw = await response.text();
  if (raw.length > 1_500_000) throw new Error('Oversized Pexels API response.');
  return JSON.parse(raw);
}

export async function searchFreeScenes(
  query: string,
  orientation: string,
  key = process.env.PEXELS_API_KEY || '',
  fetcher: typeof fetch = fetch,
): Promise<FreeScene[]> {
  const q = normalizeFreeSceneQuery(query);
  if (!['landscape','portrait','square'].includes(orientation)) {
    throw new Error('Unsupported scene orientation.');
  }
  const params = new URLSearchParams({ query: q, orientation, per_page:'12', page:'1' });
  const result = await pexelsGet('/v1/videos/search?' + params.toString(), key, fetcher) as {
    videos?: VideoRecord[];
  };
  return (Array.isArray(result?.videos) ? result.videos : [])
    .map(toFreeScene).filter((v): v is FreeScene => Boolean(v))
    .slice(0, 12);
}

export async function downloadFreeScene(
  videoId: number,
  destination: string,
  key = process.env.PEXELS_API_KEY || '',
  maxBytes = MAX_CLIP_BYTES,
  fetcher: typeof fetch = fetch,
): Promise<{bytes:number;scene:FreeScene}> {
  validatedFreeSceneIds([videoId]);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_CLIP_BYTES) {
    throw new Error('Invalid footage download budget.');
  }
  const detail = await pexelsGet('/v1/videos/videos/' + videoId, key, fetcher) as VideoRecord;
  if (detail.id !== videoId) throw new Error('Pexels video identity mismatch.');
  const scene = toFreeScene(detail);
  const url = selectFreeSceneFile(detail.video_files);
  if (!scene || !url) throw new Error('No compatible, trusted MP4 variant; download manually from Pexels.');
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(90000),
    });
  } catch {
    throw new Error('Footage host is unavailable or redirected; use manual Pexels download.');
  }
  if (!response.ok || !response.body) throw new Error('Pexels video download failed.');
  const length = Number(response.headers.get('content-length') || '0');
  const mime = response.headers.get('content-type') || '';
  if (length > maxBytes || (mime && !/^(video\/mp4|application\/octet-stream)(;|$)/i.test(mime))) {
    await response.body.cancel();
    throw new Error('Pexels video exceeds the size limit or is not an MP4.');
  }
  const handle = await open(destination, 'wx', 0o600);
  let total = 0;
  let succeeded = false;
  try {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('Pexels video exceeds the upload budget.');
      }
      await handle.write(value);
    }
    if (total < 1024) throw new Error('Pexels video is empty or incomplete.');
    succeeded = true;
  } finally {
    await handle.close();
    if (!succeeded) await unlink(destination).catch(() => {});
  }
  return {bytes:total,scene};
}
