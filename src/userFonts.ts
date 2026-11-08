/**
 * userFonts — 利用者が自分の PC から読み込んだ書体 (MS 明朝・MS ゴシックなど) の保存。
 * ブラウザの IndexedDB に置くので、次に開いたときも読み込み直さずに使える。外部には送らない。
 */
import type { UserFont } from './fontLoader';

const DB = 'kumiori-user-fonts';
const STORE = 'fonts';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 接続を開いて fn を行い、途中で失敗しても必ず閉じる */
async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await open();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

export async function saveUserFont(f: UserFont): Promise<void> {
  try {
    await withDb(
      (db) =>
        new Promise<void>((res, rej) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put({ key: `${f.family}|${f.weight}`, ...f });
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        }),
    );
  } catch {
    /* 保存できなくても、今回の組版には使える */
  }
}

export async function loadUserFonts(): Promise<UserFont[]> {
  try {
    return await withDb(
      (db) =>
        new Promise<UserFont[]>((res, rej) => {
          const req = db.transaction(STORE).objectStore(STORE).getAll();
          req.onsuccess = () => res(req.result as UserFont[]);
          req.onerror = () => rej(req.error);
        }),
    );
  } catch {
    return [];
  }
}

export async function clearUserFonts(): Promise<void> {
  try {
    await withDb(
      (db) =>
        new Promise<void>((res, rej) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).clear();
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        }),
    );
  } catch {
    /* 無視 */
  }
}
