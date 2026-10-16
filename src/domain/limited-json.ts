/** Bound memory use even for chunked HTTP bodies without Content-Length. */
export class RequestBodyTooLarge extends Error {
  constructor() { super("Request body too large."); }
}

export async function parseLimitedJson(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes = 1024,
): Promise<unknown> {
  if (!stream) throw new Error("Missing JSON body.");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new RequestBodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
