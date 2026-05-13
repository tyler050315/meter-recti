import { build } from "esbuild";

await build({
  entryPoints: ["scripts/native-scanner-entry.js"],
  bundle: true,
  format: "iife",
  globalName: "MeterRectiNativeScannerBundle",
  outfile: "native-scanner.js",
  sourcemap: false,
  minify: true,
});
