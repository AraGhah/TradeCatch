import http from "node:http";
import { testGoogleJwks } from "./gmail-push-token";

/** Anything that answers a Request like Google would (the Gmail or the Calendar fake). */
export type FakeGoogleHandler = { handle(request: Request): Promise<Response> };

/** Serves a fake Google over real HTTP so a separate Next.js process can call it. */
export function startFakeGoogleServer(
  google: FakeGoogleHandler,
  port: number,
): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === "/oauth2/v3/certs") {
        res.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "public, max-age=3600",
        });
        res.end(JSON.stringify(testGoogleJwks));
        return;
      }
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
