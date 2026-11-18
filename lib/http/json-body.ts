const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|\s*$)/i

/**
 * Reads a request body that must be a JSON object of at most `maxBytes`.
 *
 * Returns null, so the route can answer 400, when the body is not declared as
 * JSON, is too large, is not valid JSON, or is not a plain object.
 *
 * The limit is enforced while streaming, not only from Content-Length: a
 * client can leave that header out or understate it, and a route that
 * buffered the whole body first could be made to hold any amount of memory.
 * An oversized body is cancelled as soon as it passes the limit.
 */
export async function readJsonObject(
  request: Request,
  maxBytes: number
): Promise<Record<string, unknown> | null> {
  if (!JSON_CONTENT_TYPE.test(request.headers.get("content-type") || ""))
    return null
  if (!request.body) return null
  const declared = request.headers.get("content-length")
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    void request.body.cancel().catch(() => undefined)
    return null
  }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        void reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    // Malformed JSON or an aborted upload is a bad request, not a server fault.
    return null
  } finally {
    reader.releaseLock()
  }
}
