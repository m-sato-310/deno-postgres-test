import { serveDir } from "@std/http/file-server";
import { closePool, query } from "./db.ts";
import { error, json, type Route } from "./routes/http.ts";
import { memoRoutes } from "./routes/memos.ts";

/**
 * DB に届いているかを確認するためのエンドポイントです。
 * デプロイ後にまずここを叩けば、アプリの問題か DB の問題かを切り分けられます。
 */
const healthRoute: Route = {
  method: "GET",
  pattern: new URLPattern({ pathname: "/api/health" }),
  handler: async () => {
    try {
      await query("select 1");
      return json({ ok: true, db: "up" });
    } catch (err) {
      console.error("[health] db check failed:", err);
      return json({ ok: false, db: "down" }, 503);
    }
  },
};

const routes: Route[] = [healthRoute, ...memoRoutes];

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);

  let pathMatched = false;
  for (const route of routes) {
    const match = route.pattern.exec(url);
    if (!match) continue;
    pathMatched = true;
    if (route.method !== request.method) continue;

    try {
      return await route.handler(request, match.pathname.groups);
    } catch (err) {
      // ハンドラが投げた例外をここで受けます。
      // 受けないと接続が切られ、クライアント側には原因の分からないエラーだけが残ります。
      console.error(`[${request.method} ${url.pathname}]`, err);
      return error("internal server error", 500);
    }
  }

  if (pathMatched) return error("method not allowed", 405);
  if (url.pathname.startsWith("/api/")) return error("not found", 404);

  // API 以外は public/ の静的ファイルとして返します。
  return serveDir(request, { fsRoot: "public", quiet: true });
}

const server = Deno.serve(handler);

/**
 * Deno Deploy はインスタンスを止めるとき SIGINT を送り、5 秒後に強制終了します。
 * その 5 秒のうちに処理中のリクエストを返し終えて、接続プールを閉じます。
 *
 * 閉じずに終了しても動きますが、DB 側に切れかけの接続が残り、
 * 再起動を繰り返すと接続上限に当たりやすくなります。
 */
const signals: Deno.Signal[] = Deno.build.os === "windows" ? ["SIGINT"] : ["SIGINT", "SIGTERM"];

for (const signal of signals) {
  Deno.addSignalListener(signal, async () => {
    console.log(`[server] ${signal} received, shutting down`);
    await server.shutdown();
    await closePool();
    Deno.exit(0);
  });
}
