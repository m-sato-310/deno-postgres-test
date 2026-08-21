import { query } from "../db.ts";
import { error, json, optionalString, readJson, type Route } from "./http.ts";

/**
 * memos テーブル 1 行分の型です。
 * SQL の列名と 1 対 1 に対応させておくと、`select *` の結果をそのまま返せます。
 */
interface Memo extends Record<string, unknown> {
  id: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

/** URL の :id を数値に変換します。数値でなければ null を返します。 */
function parseId(params: Record<string, string | undefined>): number | null {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function list(): Promise<Response> {
  const result = await query<Memo>(
    "select * from memos order by created_at desc, id desc limit 100",
  );
  return json(result.rows);
}

async function show(
  _request: Request,
  params: Record<string, string | undefined>,
): Promise<Response> {
  const id = parseId(params);
  if (id === null) return error("id must be a positive integer", 400);

  const result = await query<Memo>("select * from memos where id = $1", [id]);
  const memo = result.rows[0];
  return memo ? json(memo) : error("memo not found", 404);
}

async function create(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body === null) return error("body must be a JSON object", 400);

  const title = optionalString(body, "title");
  if (typeof title !== "string" || title.trim() === "") {
    return error("title is required and must be a non-empty string", 400);
  }
  const text = optionalString(body, "body");
  if (text === null) return error("body must be a string", 400);

  const result = await query<Memo>(
    "insert into memos (title, body) values ($1, $2) returning *",
    [title, text ?? ""],
  );
  return json(result.rows[0], 201);
}

async function update(
  request: Request,
  params: Record<string, string | undefined>,
): Promise<Response> {
  const id = parseId(params);
  if (id === null) return error("id must be a positive integer", 400);

  const body = await readJson(request);
  if (body === null) return error("body must be a JSON object", 400);

  const title = optionalString(body, "title");
  const text = optionalString(body, "body");
  if (title === null) return error("title must be a string", 400);
  if (text === null) return error("body must be a string", 400);
  if (title === undefined && text === undefined) {
    return error("nothing to update", 400);
  }

  // coalesce を使うと「渡された列だけ更新する」を SQL 1 本で書けます。
  // null を渡した列は既存の値がそのまま残ります。
  const result = await query<Memo>(
    `update memos
        set title = coalesce($2, title),
            body = coalesce($3, body),
            updated_at = now()
      where id = $1
      returning *`,
    [id, title ?? null, text ?? null],
  );
  const memo = result.rows[0];
  return memo ? json(memo) : error("memo not found", 404);
}

async function destroy(
  _request: Request,
  params: Record<string, string | undefined>,
): Promise<Response> {
  const id = parseId(params);
  if (id === null) return error("id must be a positive integer", 400);

  const result = await query("delete from memos where id = $1", [id]);
  return result.rowCount === 0 ? error("memo not found", 404) : new Response(null, { status: 204 });
}

export const memoRoutes: Route[] = [
  { method: "GET", pattern: new URLPattern({ pathname: "/api/memos" }), handler: list },
  { method: "POST", pattern: new URLPattern({ pathname: "/api/memos" }), handler: create },
  { method: "GET", pattern: new URLPattern({ pathname: "/api/memos/:id" }), handler: show },
  { method: "PATCH", pattern: new URLPattern({ pathname: "/api/memos/:id" }), handler: update },
  { method: "DELETE", pattern: new URLPattern({ pathname: "/api/memos/:id" }), handler: destroy },
];
