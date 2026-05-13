import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const www = join(root, "www");

await rm(www, { recursive: true, force: true });
await mkdir(join(www, "icons"), { recursive: true });

const files = [
  "index.html",
  "styles.css",
  "app.js",
  "native-scanner.js",
  "manifest.json",
  "service-worker.js",
];

for (const file of files) {
  await cp(join(root, file), join(www, file));
}

await cp(join(root, "icons"), join(www, "icons"), { recursive: true });
