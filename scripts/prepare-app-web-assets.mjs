import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const source = path.resolve("node_modules/plotly.js-dist-min/plotly.min.js");
const targetDir = path.resolve("app-web/vendor");
const target = path.join(targetDir, "plotly.min.js");

async function run() {
  await mkdir(targetDir, { recursive: true });
  await copyFile(source, target);
  console.log(`Copied ${path.relative(process.cwd(), source)} -> ${path.relative(process.cwd(), target)}`);
}

run().catch((error) => {
  console.error(`Failed to copy Plotly asset: ${error.message}`);
  process.exit(1);
});
