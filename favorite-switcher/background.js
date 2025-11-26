"use strict";

const FAVORITE_SETS_ROOT_NAME = "★FavoriteSets";
const BOOKMARK_BAR_ID = "1";      // ブックマークバー
const OTHER_BOOKMARKS_ID = "2";   // その他のブックマーク

// ---- Bookmarks API を Promise 化 ----

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

function getNode(id) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.get(id, (results) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(results[0]);
      }
    });
  });
}

// ---- Storage API ラッパー ----

function getActiveSetName() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get("activeSetName", (items) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(items.activeSetName);
      }
    });
  });
}

function setActiveSetName(name) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ activeSetName: name }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

function isSyncDisabled() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get("syncDisabled", (items) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(!!items.syncDisabled);
      }
    });
  });
}

// ---- お気に入りセット操作 ----

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
 * 拡張インストール時の初期化：
 * - 「★FavoriteSets/お気に入り1〜3」を作成
 * - ブックマークバーの内容を「お気に入り1」にコピー
 * - 初期アクティブセットを「お気に入り1」に設定
 */
async function initializeFavoriteSets() {
  console.log("[favorite-switcher] initializeFavoriteSets start");

  const setNames = ["お気に入り1", "お気に入り2", "お気に入り3"];

  const setFolders = {};
  for (const name of setNames) {
    setFolders[name] = await getOrCreateSetFolder(name);
  }

  const fav1Folder = setFolders["お気に入り1"];

  const existing = await getChildren(fav1Folder.id);
  for (const child of existing) {
    await removeTree(child.id);
  }

  await cloneChildren(BOOKMARK_BAR_ID, fav1Folder.id);

  await setActiveSetName("お気に入り1");

  console.log("[favorite-switcher] initializeFavoriteSets done (activeSetName = お気に入り1)");
}

/**
 * 指定したノード（または親ID）がブックマークバー配下かどうかを判定
 */
async function isUnderBookmarkBar(nodeId) {
  try {
    let current = await getNode(nodeId);
    while (current && current.parentId) {
      if (current.parentId === BOOKMARK_BAR_ID) {
        return true;
      }
      current = await getNode(current.parentId);
    }
  } catch (e) {
    console.error("[favorite-switcher] isUnderBookmarkBar error:", e);
  }
  return false;
}

/**
 * 現在のブックマークバーの状態で、
 * アクティブセットのフォルダ内容を丸ごと上書きする
 */
async function syncActiveSetFromBar() {
  try {
    // ★ popup側で切り替え中なら同期しない
    const disabled = await isSyncDisabled();
    if (disabled) {
      return;
    }

    const activeSetName = await getActiveSetName();
    if (!activeSetName) {
      return;
    }

    const setFolder = await getOrCreateSetFolder(activeSetName);

    const existing = await getChildren(setFolder.id);
    for (const child of existing) {
      await removeTree(child.id);
    }

    await cloneChildren(BOOKMARK_BAR_ID, setFolder.id);

    console.log("[favorite-switcher] synced active set from bar:", activeSetName);
  } catch (e) {
    console.error("[favorite-switcher] syncActiveSetFromBar error:", e);
  }
}

/**
 * ブックマークイベント監視
 */
function setupBookmarkListeners() {
  const triggerSyncIfInBar = async (nodeId, parentIdMaybe) => {
    try {
      let targetId = nodeId;
      if (parentIdMaybe) {
        targetId = parentIdMaybe;
      }

      const underBar = await isUnderBookmarkBar(targetId);
      if (underBar || targetId === BOOKMARK_BAR_ID) {
        await syncActiveSetFromBar();
      }
    } catch (e) {
      console.error("[favorite-switcher] triggerSyncIfInBar error:", e);
    }
  };

  chrome.bookmarks.onCreated.addListener((id, node) => {
    triggerSyncIfInBar(id, node.parentId);
  });

  chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
    triggerSyncIfInBar(id, removeInfo.parentId);
  });

  chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
    triggerSyncIfInBar(id, null);
  });

  chrome.bookmarks.onMoved.addListener((id, moveInfo) => {
    triggerSyncIfInBar(id, moveInfo.parentId);
  });

  chrome.bookmarks.onChildrenReordered.addListener((id, reorderInfo) => {
    triggerSyncIfInBar(id, id);
  });

  chrome.bookmarks.onImportEnded.addListener(() => {
    triggerSyncIfInBar(BOOKMARK_BAR_ID, BOOKMARK_BAR_ID);
  });
}

// ---- イベント登録 ----

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    initializeFavoriteSets().catch((e) => {
      console.error("[favorite-switcher] initialization error:", e);
    });
  }
});

setupBookmarkListeners();
