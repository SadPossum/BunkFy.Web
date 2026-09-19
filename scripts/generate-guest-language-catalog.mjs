/* global process, fetch, Buffer, URL, console */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const source = "https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry";
const expectedSha256 = "be21e91b6851f750a7b1a687f11209d46ad5a8471d6b10a1efc8d1dac4c8a926";
const bytes = process.argv[2] ? await readFile(process.argv[2]) : await (async () => {
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Registry fetch failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
})();
const sha256 = value => createHash("sha256").update(value).digest("hex");
if (sha256(bytes) !== expectedSha256) throw new Error("Registry differs from reviewed snapshot; review changes before updating the pinned hash.");
const registry = bytes.toString("utf8");
const catalog = registry.split("%%").flatMap(block => {
  const lines = block.replace(/\r/g, "").replace(/\n +/g, " ").split("\n");
  const field = name => lines.filter(line => line.startsWith(`${name}: `)).map(line => line.slice(name.length + 2));
  const tag = field("Subtag")[0];
  if (field("Type")[0] !== "language" || field("Deprecated").length || !/^[a-z]{2,8}$/.test(tag ?? "")) return [];
  return [[tag, ...field("Description")]];
}).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
if (catalog.length !== 8043 || new Set(catalog.map(([tag]) => tag)).size !== catalog.length) throw new Error("Unexpected reviewed catalog denominator.");
const generated = JSON.stringify(catalog) + "\n";
const target = new URL("../src/features/guests/guestLanguageCatalog.json", import.meta.url);
try {
  const existing = await readFile(target, "utf8");
  if (existing !== generated) throw new Error("Existing catalog differs; preserve and review it before regeneration.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  await writeFile(target, generated, { flag: "wx" });
}
console.log(JSON.stringify({ source, registryDate: registry.match(/^File-Date: (.+)$/m)?.[1],
  sourceSha256: expectedSha256, records: catalog.length, bytes: Buffer.byteLength(generated), artifactSha256: sha256(generated) }));
