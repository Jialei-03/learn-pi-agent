// Run from the course repository with a checkout of Pi as the argument.
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sourceRoot = process.argv[2];
if (!sourceRoot) {
  console.error("Usage: node examples/shell-output/observe.mjs <Pi source directory>");
  process.exit(1);
}
const implementation = resolve(sourceRoot, "packages/coding-agent/src/core/tools/output-accumulator.ts");
const { OutputAccumulator } = await import(pathToFileURL(implementation).href);
const accumulator = new OutputAccumulator({ maxLines: 2, maxBytes: 12, tempFilePrefix: "pi-course" });
const euro = Buffer.from("€\n");
const chunks = [Buffer.from("HEAD\n"), euro.subarray(0, 1), euro.subarray(1), Buffer.from("TAIL\n")];

let file;
try {
  for (const [index, chunk] of chunks.entries()) {
    accumulator.append(chunk);
    const snapshot = accumulator.snapshot({ persistIfTruncated: true });
    file = snapshot.fullOutputPath;
    console.log(JSON.stringify({
      chunk: index + 1, decodedBytes: snapshot.truncation.totalBytes,
      lines: snapshot.truncation.totalLines, text: snapshot.content,
      saved: Boolean(file),
    }));
  }
  accumulator.finish();
  await accumulator.closeTempFile();
  const tail = accumulator.snapshot();
  assert.equal(tail.content, "€\nTAIL");
  assert.equal(tail.truncation.totalBytes, 14);
  assert.equal(tail.truncation.totalLines, 3);
  const original = await readFile(file, "utf8");
  assert.equal(original, "HEAD\n€\nTAIL\n");
  console.log("file =", JSON.stringify(original));
  const limited = await accumulator.readFullOutput(10);
  assert.equal(limited.truncated, true);
  assert.ok(limited.content.includes("4 bytes omitted"));
  console.log("bounded result =", JSON.stringify(limited.content));
} finally {
  await accumulator.closeTempFile();
  if (file) await rm(file, { force: true });
}
