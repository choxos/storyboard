import { resolve, sep } from "node:path";
const root = resolve("dist");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 4173,
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(
      url.pathname.replace(/^\/storyboard(?=\/)/, ""),
    );
    const path = resolve(
      root,
      `.${pathname.endsWith("/") ? pathname + "index.html" : pathname}`,
    );
    if (!path.startsWith(root + sep))
      return new Response("Not found", { status: 404 });
    const file = Bun.file(path);
    return (await file.exists())
      ? new Response(file)
      : new Response("Not found", { status: 404 });
  },
});
console.log(`Storyboard: ${server.url}storyboard/`);
