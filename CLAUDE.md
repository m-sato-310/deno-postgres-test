# このリポジトリで作業するときの前提

Deno Deploy 上で動く REST API サーバのスターターテンプレートです。
Deno.serve でリクエストを受け、`npm:pg` で Postgres に接続します。

## 最初に読むこと

Deno Deploy は 2025 年に作り直されており、モデルの学習データに残っている情報は古い可能性が高いです。
Deploy まわりで手が止まったら、記憶ではなく次のページを WebFetch で読んでください。
ドキュメントと自分の記憶が食い違った場合は、ドキュメントを優先します。

- <https://docs.deno.com/deploy/reference/databases.md>: Postgres のプロビジョニング、注入される環境変数、Pre-Deploy Command
- <https://docs.deno.com/deploy/reference/runtime.md>: 実行環境、インスタンスの寿命、コールドスタート
- <https://docs.deno.com/deploy/reference/env_vars_and_contexts.md>: 環境変数とコンテキスト (production / development / build)
- <https://docs.deno.com/deploy/reference/builds.md>: Install / Build / Pre-Deploy の実行順、warmup フェーズ
- <https://docs.deno.com/deploy/reference/tunnel.md>: 手元のプロセスを Deploy に繋ぐ
- <https://docs.deno.com/deploy/migration_guide.md>: Deploy Classic から何が変わったか
- <https://docs.deno.com/runtime/reference/cli/deploy.md>: `deno deploy` の CLI リファレンス

上記に載っていない話題は <https://docs.deno.com/llms.txt> から該当ページを探します。

## 書いてはいけないこと

以下はすべて古い情報です。
コード、設定、ドキュメント、コミットメッセージのいずれにも登場させないでください。

- `deployctl` コマンド。現在は `deno deploy` サブコマンドです
- `dash.deno.com`。Deploy Classic の URL で、停止済みです。現在は `console.deno.com` です
- `deno.land/std` の `serve()`。`Deno.serve()` だけを使います。旧 `serve()` を使うとデプロイ時に warmup フェーズでタイムアウトします
- Prisma Data Proxy、および `prisma://` 形式の接続文字列
- Prisma schema の `previewFeatures = ["deno"]`
- 接続文字列を `.env` にハードコードする手順。Deploy が `DATABASE_URL` と `PG*` を自動注入するため不要です

デプロイ手段として `deno deploy` で手元のディレクトリを直接送る手順も案内しないでください。
ビルド工程を通らないためマイグレーションが流れません。
理由は下の「Deploy まわりの制約」にあります。

## 構成

```
main.ts              Deno.serve とルーティング。エントリポイント
db.ts                接続プールと query()。ここだけが pg に依存します
routes/http.ts       Route 型、JSON レスポンス、リクエストボディの検証補助
routes/memos.ts      memos の CRUD ハンドラ
migrations/          node-pg-migrate の SQL マイグレーション
public/              静的ファイル。ブラウザから直接返されます
compose.yml          ローカル開発用の Postgres。Deploy では使いません
deno.json            タスクと import マップ
```

## どこを触るか

- API を増やす: `routes/` にファイルを足し、`Route[]` を export して `main.ts` の `routes` に並べます
- テーブルを変える: `deno task migrate:new <名前>` で SQL ファイルを作り、`-- Up Migration` と `-- Down Migration` の下に書きます。既存ファイルは編集しません
- 画面を変える: `public/` を編集します。サーバの再起動は不要です
- SQL を書く: `db.ts` の `query()` を使います。値は必ず第 2 引数の配列で渡します

`db.ts` と `main.ts` は原則そのままで足ります。
接続プールの設定やシャットダウン処理を変える前に、下の「触る前に知っておくこと」を読んでください。

## 触る前に知っておくこと

接続情報を引数で渡さないでください。
`new Pool({ max: 3 })` のように接続情報を省くと、`npm:pg` が `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` を読みます。
Deploy はこれらを環境ごとに違う値で注入するため、コードに書くと production と preview が同じ DB を指してしまいます。

プールはモジュールのトップレベルで 1 回だけ作ります。
リクエストごとに `new Pool()` すると接続が使い捨てになり、DB の接続上限をすぐ使い切ります。

`max` を増やさないでください。
Deno Deploy はアクセスに応じてインスタンスを増やすので、DB が受ける接続数はインスタンス数 × `max` になります。

`pool.on("error", ...)` を消さないでください。
idle 状態の接続が DB 側から切られたときに発火します。
購読していないと未処理エラーになり、プロセスごと落ちます。
Deno Deploy はインスタンスを頻繁に停止・再起動するため、これは必須です。

トップレベルの `await` とネットワークアクセスを増やさないでください。
コールドスタートが遅くなり、warmup フェーズのタイムアウトに近づきます。
`db.ts` はプールを作るだけで、この時点では接続しません。

## マイグレーション

`node-pg-migrate` を使います。
`DATABASE_URL` が無ければ `PG*` にフォールバックするため、ローカルでも Deploy 上でも同じ環境変数だけで動きます。

- 新規作成: `deno task migrate:new add-tags`
- 適用: `deno task migrate`
- 1 つ戻す: `deno task migrate:down`

Deploy 上では console.deno.com の Pre-Deploy Command に `deno task migrate` を設定します。
Pre-Deploy はビルド後、ロールアウト前に timeline ごとに 1 回実行されるため、production と preview の DB がそれぞれ更新されます。

手元から Deploy の DB を触るときは `--tunnel` を付けます。
Deploy 側の環境変数を受け取り、アプリに割り当てられた DB に接続します。

```sh
deno task --tunnel migrate
deno task --tunnel dev
```

## Deploy まわりの制約

実際に試して分かった制約です。
どれもドキュメントに明記がないため、記憶や推測で別の手順を提案しないでください。

CLI デプロイ (`deno deploy`、`deno deploy create --source local`) はビルド工程を通りません。
Install command / Build command / Pre-Deploy Command のいずれも実行されません。
`deno deploy create` に `--pre-deploy-command` を渡しても、確認表示は `(n/a)` になり無視されます。
マイグレーションを自動で流すには GitHub 連携のアプリである必要があります。

Deploy が用意した Postgres の接続文字列は取得できません。
`deno deploy database list` も REST API もパスワードを返しません。
外部から本番 DB にスキーマを入れる手段はないため、Pre-Deploy Command が唯一の経路です。

`deno deploy database query` は CLI にサブコマンドがありますが、サーバ側が未実装で失敗します。
マイグレーションの代替手段として使えません。

`--tunnel` が繋がるのは Local コンテキストの DB です。
`--tunnel` は true / false しか取らず、production を対象にはできません。
tunnel で流したマイグレーションは本番のテーブルを作りません。

`deno task --tunnel <タスク>` はタスクが終わってもプロセスが残ります。
tunnel が接続を保持しているためで、失敗ではありません。

tunnel は `deno.json` に `deploy: { org, app }` を書き込みます。
利用者ごとに違う値なので、テンプレートの初期状態には含めません。

DB を割り当てた直後は環境ごとの DB がまだ用意されていないことがあります。
Local が先に ready になり、production は数分遅れます。

DB の割り当てや設定変更の後は push しないとビルドが走りません。
変更がない場合は空コミットで再デプロイします。

## 変更したら

`deno task check` を通してください。
`deno check` と `deno lint` と `deno fmt --check` をまとめて実行します。

Markdown は 1 文 1 行で書きます。
`deno.json` の `fmt.proseWrap` を `preserve` にしてあるため、`deno fmt` は行を折り返しません。
