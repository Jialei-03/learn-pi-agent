import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, "..");
const repository = resolve(project, "..", "..");
const output = resolve(project, "public");

await mkdir(output, { recursive: true });

await copyFile(
  resolve(repository, "assets", "mox-illustrations", "mox-reference-sheet.png"),
  resolve(output, "mox-reference-sheet.png"),
);

await copyFile(
  resolve(project, "node_modules", "gsap", "dist", "gsap.min.js"),
  resolve(output, "gsap.min.js"),
);

console.log("Prepared Mox and GSAP assets in public/.");
