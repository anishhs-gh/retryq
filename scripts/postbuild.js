// Writes per-directory package.json "type" markers so Node resolves each build
// output correctly: dist/cjs as CommonJS and dist/esm as ES modules.
const fs = require("fs");
const path = require("path");

const targets = [
  { dir: "dist/cjs", type: "commonjs" },
  { dir: "dist/esm", type: "module" },
];

for (const { dir, type } of targets) {
  const outDir = path.resolve(__dirname, "..", dir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "package.json"),
    JSON.stringify({ type }, null, 2) + "\n"
  );
  console.log(`postbuild: wrote ${dir}/package.json ({ "type": "${type}" })`);
}
