import { timingSafeEqual } from 'node:crypto';

/** The shared-filesystem proof path must be explicitly enabled by its operator. */
export function renderAccessStatus(headers: Headers): number | null {
  if (process.env.LOCAL_RENDER_ENABLED !== 'true' ||
      process.env.STORAGE_DRIVER !== 'local' || !process.env.LOCAL_MEDIA_ROOT?.trim()) return 503;
  const token = process.env.RENDER_TOKEN?.trim();
  if (!token || token.length < 32) return 503;
  const supplied = Buffer.from(headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${token}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? null : 401;
}
