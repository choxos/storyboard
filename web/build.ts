import { copyFile, mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
const result = await Bun.build({
  entrypoints: ["web/main.ts"],
  outdir: "dist",
  target: "browser",
  minify: true,
  naming: "main.js",
});
if (!result.success) throw new Error(result.logs.join("\n"));
await Promise.all([
  ...["index.html", "web.css", "demo.storyboard"].map((name) =>
    copyFile(`web/${name}`, `dist/${name}`),
  ),
  ...["style.css", "icon.svg"].map((name) =>
    copyFile(`ui/${name}`, `dist/${name}`),
  ),
]);
await Bun.write("dist/.nojekyll", "");
console.log(
  `Built static browser editor: ${result.outputs[0].size} bytes of JavaScript.`,
);
