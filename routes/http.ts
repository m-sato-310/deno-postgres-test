/** ルート 1 つ分の定義です。 */
export interface Route {
  method: string;
  pattern: URLPattern;
  handler: (
    request: Request,
    params: Record<string, string | undefined>,
  ) => Promise<Response> | Response;
}

/** JSON のレスポンスを作ります。 */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** エラーレスポンスを作ります。形を揃えておくとフロント側の分岐が単純になります。 */
export function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

/**
 * リクエストボディを JSON として読みます。
 * 壊れた JSON が来たときに 500 ではなく 400 を返せるよう、ここで失敗を吸収します。
 */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * 省略可能な文字列フィールドを取り出します。
 *
 * 戻り値の意味は 3 通りあります。
 * `undefined` はキーが無い (更新しない)、`null` は型が不正、文字列は採用する値です。
 */
export function optionalString(
  body: Record<string, unknown>,
  key: string,
): string | undefined | null {
  if (!(key in body)) return undefined;
  const value = body[key];
  return typeof value === "string" ? value : null;
}
