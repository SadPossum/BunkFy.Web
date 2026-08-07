export async function staffMutationHash(values: string[]): Promise<string> {
  const encoder = new TextEncoder();
  const chunks = values.map((value) => encoder.encode(value));
  const byteLength = chunks.reduce(
    (total, chunk) => total + 4 + chunk.byteLength,
    0,
  );
  const input = new Uint8Array(byteLength);
  const view = new DataView(input.buffer);
  let offset = 0;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.byteLength);
    offset += 4;
    input.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function isStaffMutationFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function isStaffMutationOperationId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
