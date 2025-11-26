"use strict";

const FAVORITE_SETS_ROOT_NAME = "★FavoriteSets";
const BOOKMARK_BAR_ID = "1";      // ブックマークバー（固定ID）
const OTHER_BOOKMARKS_ID = "2";   // その他のブックマーク（固定ID）

const statusEl = document.getElementById("status");
const selectorEl = document.getElementById("setSelector");
const applyBtn = document.getElementById("applyBtn");

function setStatus(msg) {
  statusEl.textContent = msg;
}

// ---- Chrome API を Promise 化 ----
function getChildren(id) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.getChildren(id, (results) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(results);
      }
    });
  });
}

function createFolder(parentId, title) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.create({ parentId, title }, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result);
      }
    });
  });
}

function removeTree(id) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.removeTree(id, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

function createBookmark(parentId, title, url) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.create({ parentId, title, url }, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result);
      }
    });
  });
}

function setStorage(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

// ---- お気に入りセットのフォルダ操作 ----

async function getOrCreateSetsRoot() {
  const children = await getChildren(OTHER_BOOKMARKS_ID);
  let root = children.find(
    (c) => c.title === FAVORITE_SETS_ROOT_NAME && !c.url
  );

  if (!root) {
    root = await createFolder(OTHER_BOOKMARKS_ID, FAVORITE_SETS_ROOT_NAME);
  }
  return root;
}

async function getOrCreateSetFolder(setName) {
  const root = await getOrCreateSetsRoot();
  const children = await getChildren(root.id);

  let folder = children.find(
    (c) => c.title === setName && !c.url
  );

  if (!folder) {
    folder = await createFolder(root.id, setName);
  }
  return folder;
}

/**
 * ★FavoriteSets 直下のフォルダ一覧を取得し、select に反映
 */
async function loadSetOptions() {
  try {
    setStatus("セットを読み込み中…");

    const root = await getOrCreateSetsRoot();
    const children = await getChildren(root.id);

    const folders = children.filter((c) => !c.url); // フォルダのみ

    selectorEl.innerHTML = "";

    if (folders.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "（セットがありません）";
      selectorEl.appendChild(opt);
      selectorEl.disabled = true;
      applyBtn.disabled = true;
      setStatus("★FavoriteSets フォルダ内にセット用フォルダを作成してください。");
      return;
    }

    folders.sort((a, b) => a.title.localeCompare(b.title, "ja"));

    for (const folder of folders) {
      const opt = document.createElement("option");
      opt.value = folder.title;
      opt.textContent = folder.title;
      selectorEl.appendChild(opt);
    }

    selectorEl.disabled = false;
    applyBtn.disabled = false;

    chrome.storage.local.get("activeSetName", (items) => {
      const active = items.activeSetName;
      if (active) {
        const optToSelect = Array.from(selectorEl.options)
          .find(o => o.value === active);
        if (optToSelect) {
          selectorEl.value = active;
        }
      }
    });

    setStatus(`セットを ${folders.length} 件読み込みました。`);
  } catch (e) {
    console.error(e);
    selectorEl.disabled = true;
    applyBtn.disabled = true;
    setStatus("セット一覧の取得中にエラーが発生しました: " + e.message);
  }
}

// ---- コピー系 ----

async function cloneChildren(srcParentId, destParentId) {
  const children = await getChildren(srcParentId);
  for (const node of children) {
    await cloneNode(node, destParentId);
  }
}

async function cloneNode(node, destParentId) {
  if (node.url) {
    await createBookmark(destParentId, node.title, node.url);
  } else {
    const newFolder = await createFolder(destParentId, node.title);
    await cloneChildren(node.id, newFolder.id);
  }
}

/**
 * ブックマークバーをいったん空にする
 */
async function clearBookmarkBar() {
  const barChildren = await getChildren(BOOKMARK_BAR_ID);
  for (const child of barChildren) {
    await removeTree(child.id);
  }
}

/**
 * 選択されたセットにブックマークバーを切り替える
 * → この間だけ同期を止めるため syncDisabled フラグを使う
 */
async function switchToSet(setName) {
  if (!setName) {
    setStatus("セットが選択されていません。");
    return;
  }

  setStatus("切り替え中…");

  try {
    // ★ 自動同期を一時停止
    await setStorage({ syncDisabled: true });

    const setFolder = await getOrCreateSetFolder(setName);

    await clearBookmarkBar();
    await cloneChildren(setFolder.id, BOOKMARK_BAR_ID);

    // アクティブセット名を更新
    await setStorage({ activeSetName: setName });

    setStatus(`「${setName}」に切り替えました。`);
  } catch (e) {
    console.error(e);
    setStatus("エラーが発生しました: " + e.message);
  } finally {
    // ★ 必ず同期を再開（失敗してもここは実行）
    await setStorage({ syncDisabled: false }).catch(() => {});
  }
}

// ---- イベント登録 ----

document.addEventListener("DOMContentLoaded", () => {
  loadSetOptions().catch((e) => {
    console.error(e);
    setStatus("初期化中にエラーが発生しました: " + e.message);
  });
});

applyBtn.addEventListener("click", async () => {
  const setName = selectorEl.value;
  await switchToSet(setName);
});
