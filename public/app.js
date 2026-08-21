// API を叩いて画面を書き換えるだけの最小構成です。
// 画面の作りは自由に差し替えてください。API 側の形だけ合っていれば動きます。

const statusEl = document.querySelector("#status");
const listEl = document.querySelector("#memos");
const formEl = document.querySelector("#new-memo");

function setStatus(message) {
  statusEl.textContent = message;
}

/** fetch のラッパーです。エラーの扱いを 1 箇所にまとめます。 */
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "content-type": "application/json" } : undefined,
  });
  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? `${response.status} ${response.statusText}`);
  }
  return data;
}

function render(memos) {
  listEl.replaceChildren(...memos.map((memo) => {
    const li = document.createElement("li");

    const title = document.createElement("h2");
    title.textContent = memo.title;

    const body = document.createElement("p");
    body.textContent = memo.body;

    const updated = document.createElement("time");
    updated.dateTime = memo.updated_at;
    updated.textContent = new Date(memo.updated_at).toLocaleString("ja-JP");

    const actions = document.createElement("div");
    actions.className = "actions";

    const editButton = document.createElement("button");
    editButton.textContent = "編集";
    editButton.addEventListener("click", () => edit(memo));

    const deleteButton = document.createElement("button");
    deleteButton.textContent = "削除";
    deleteButton.addEventListener("click", () => remove(memo.id));

    actions.append(editButton, deleteButton);
    li.append(title, body, updated, actions);
    return li;
  }));
}

async function reload() {
  try {
    render(await api("/api/memos"));
    setStatus("");
  } catch (err) {
    setStatus(`読み込みに失敗しました: ${err.message}`);
  }
}

async function edit(memo) {
  const title = prompt("タイトル", memo.title);
  if (title === null) return;
  const body = prompt("本文", memo.body);
  if (body === null) return;

  try {
    await api(`/api/memos/${memo.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title, body }),
    });
    await reload();
  } catch (err) {
    setStatus(`更新に失敗しました: ${err.message}`);
  }
}

async function remove(id) {
  if (!confirm("削除しますか?")) return;
  try {
    await api(`/api/memos/${id}`, { method: "DELETE" });
    await reload();
  } catch (err) {
    setStatus(`削除に失敗しました: ${err.message}`);
  }
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = document.querySelector("#new-title").value;
  const body = document.querySelector("#new-body").value;

  try {
    await api("/api/memos", { method: "POST", body: JSON.stringify({ title, body }) });
    formEl.reset();
    await reload();
  } catch (err) {
    setStatus(`追加に失敗しました: ${err.message}`);
  }
});

reload();
