/**
 * Extract a JSON object string from raw LLM output.
 * Strips markdown fences and any prose before/after the object.
 * Throws a descriptive error when no object can be found.
 */
export function extractJson(raw: string): string {
  let s = raw.trim();
  // strip ```json ... ``` or ``` ... ``` fences
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence && fence[1] !== undefined) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no JSON object found in output (expected {...})');
  }
  return s.slice(start, end + 1);
}
