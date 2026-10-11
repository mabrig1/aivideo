export class RequestBodyError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// Enforce actual bytes, including requests without Content-Length.
export async function readSmallJson(request: Request): Promise<Record<string, unknown>> {
  const limit = 16_384;
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestBodyError('Content-Type must be application/json.', 415);
  }
  if (Number(request.headers.get('content-length') || 0) > limit) {
    throw new RequestBodyError('Request payload too large.', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError('A JSON object is required.', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RequestBodyError('Request payload too large.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new RequestBodyError('A valid JSON object is required.', 400); }
}
