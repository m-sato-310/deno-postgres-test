import { Pool, type QueryResult, type QueryResultRow } from "pg";

/**
 * 接続プールはモジュールのトップレベルで 1 回だけ作ります。
 *
 * リクエストごとに `new Pool()` すると、リクエストの数だけ接続が作られて
 * Postgres 側の接続上限をすぐ使い切ります。
 * モジュールのトップレベルに置けば、同じインスタンスが生きている間は
 * この 1 つを使い回せます。
 *
 * 接続先は引数で渡しません。
 * Deno Deploy が PGHOST / PGPORT / PGDATABASE / PGUSER / PGPASSWORD を
 * 自動で注入し、npm:pg がそれを読むためです。
 * ここに host や password を書くと、環境ごとに違う DB を指せなくなります。
 *
 * max は 3 にしています。
 * Deno Deploy はアクセスに応じてインスタンスを増やすので、
 * 1 インスタンスあたりの接続数を小さくしておかないと
 * インスタンスの数 × max が DB の接続上限を超えます。
 */
export const pool = new Pool({ max: 3 });

/**
 * プールが持っている idle 接続が DB 側から切られると、
 * Pool は `error` イベントを出します。
 * これを購読していないと Node 互換の未処理エラーになり、プロセスごと落ちます。
 *
 * Deno Deploy ではインスタンスが頻繁に停止・再起動し、
 * DB 側のメンテナンスやアイドルタイムアウトでも接続は切られます。
 * つまりこのハンドラは「あると良い」ではなく必須です。
 */
pool.on("error", (err: Error) => {
  console.error("[db] idle client error:", err.message);
});

/** 一時的な切断として扱うエラーコード。次のリクエストではなく、その場で 1 回だけ貼り直します。 */
const RETRYABLE = new Set([
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
]);

/**
 * エラーから Postgres / OS のエラーコードを取り出します。
 *
 * 接続先が localhost のように複数のアドレスに解決される場合、
 * Node 互換層は個々の失敗をまとめた AggregateError を返します。
 * この場合 code は外側に無いので、中の errors を 1 段掘ります。
 */
function errorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;

  if ("code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }

  if (err instanceof AggregateError) {
    for (const inner of err.errors) {
      const code = errorCode(inner);
      if (code !== undefined) return code;
    }
  }

  return undefined;
}

/**
 * SQL を実行します。
 *
 * 値は必ず `params` で渡してください。
 * SQL の文字列に埋め込むと SQL インジェクションになります。
 *
 * ```ts
 * // 良い例
 * await query("select * from memos where id = $1", [id]);
 * // 悪い例
 * await query(`select * from memos where id = ${id}`);
 * ```
 *
 * 切断が原因のエラーのときだけ、少し待って貼り直します。
 * 文法エラーや制約違反まで再試行しても結果は変わらないため、そのまま投げます。
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  // 待ち時間 (ミリ秒)。要素数がそのまま再試行の回数になります。
  const backoff = [100, 400, 1000];

  for (let attempt = 0;; attempt++) {
    try {
      return await pool.query<T>(sql, params);
    } catch (err) {
      const code = errorCode(err);
      if (attempt >= backoff.length || code === undefined || !RETRYABLE.has(code)) throw err;
      console.warn(`[db] retrying after ${code} (attempt ${attempt + 1})`);
      await new Promise((resolve) => setTimeout(resolve, backoff[attempt]));
    }
  }
}

/** プールを閉じます。プロセス終了時に呼びます。 */
export async function closePool(): Promise<void> {
  try {
    await pool.end();
  } catch (err) {
    console.error("[db] failed to close pool:", err instanceof Error ? err.message : err);
  }
}
