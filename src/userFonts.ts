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

/*
 * 書き込みの取引 (transaction) は、complete (確定)・error・abort (中止) のどれかで終わる。
 * 中止では取引に abort のイベントが来るが、error のイベントは来ないことがある (Indexed Database API 3.0 §5.5 Aborting a transaction の注:
 * 確定の途中の誤り (容量の超過など。§5.4 Committing a transaction) で中止されたとき)。abort も聞かないと、保存・消去が終わらず、接続も閉じない
 */

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
          // 斜体・斜めの書体は、同じファミリー・太さの立体と別に保存する
          tx.objectStore(STORE).put({ key: `${f.family}|${f.weight}${f.style ? `|${f.style}` : ''}`, ...f });
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error);
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
          tx.onabort = () => rej(tx.error);
        }),
    );
  } catch {
    /* 無視 */
  }
}
