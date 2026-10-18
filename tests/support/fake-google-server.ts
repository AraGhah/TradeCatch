import http from "node:http";
import type { FakeGoogle } from "./fake-google";

/** Serves a FakeGoogle over real HTTP so a separate Next.js process can call it. */
export function startFakeGoogleServer(google: FakeGoogle, port: number): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(key, value);
      }
      const hasBody = !["GET", "HEAD"].includes(req.method || "GET");
      const response = await google.handle(
        new Request(`http://127.0.0.1:${port}${req.url}`, {
          method: req.method,
          headers,
          body: hasBody ? Buffer.concat(chunks) : undefined,
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
