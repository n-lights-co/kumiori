
import { rejoin, thisCall } from './callContext';/**
 * userStencils — 利用者が画面で読み込んだ draw.io の図形ライブラリ (stencils.min.js・ライブラリの XML) と、
 * 配布物の画像 (img/lib/… の .svg・.png・.jpg) の保存。
 * ブラウザの IndexedDB に置くので、次に開いたときも読み込み直さずに使える。外部には送らない (userFonts.ts と同じ形)
 */

const DB = 'kumiori-drawio-stencils';
const STORE = 'libraries';

export interface UserStencilFile {
  /** ファイル名 (同じ名前は置き換える) */
  name: string;
  /** 中身: 図形ライブラリと SVG は文字、PNG・JPEG はバイト列 */
  data: string | Uint8Array;
}

/** 保存した形 (前の版は文字だけを text に入れていた。読むときは data に直す) */
interface StoredStencil {
  name: string;
  text?: string;
  data?: string | Uint8Array;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'name' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 接続を開いて fn を行い、途中で失敗しても必ず閉じる */
async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = rejoin(thisCall(), await open());
  try {
    return rejoin(thisCall(), await fn(db));
  } finally {
    db.close();
  }
}

/**
 * 書き込みの取引を行う。complete・error・abort のどれかで終わる (中止では error のイベントが来ないことがある。
 * Indexed Database API 3.0 §5.5 の注。userFonts.ts と同じ)
 */
const write = (fn: (store: IDBObjectStore) => void) =>
  withDb(
    (db) =>
      new Promise<void>((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        fn(tx.objectStore(STORE));
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error);
      }),
  );

export async function saveUserStencil(f: UserStencilFile): Promise<void> {
  try {
    rejoin(thisCall(), await write((s) => s.put({ name: f.name, data: f.data } satisfies StoredStencil)));
  } catch {
    /* 保存できなくても、今回の組版には使える */
  }
}

export async function loadUserStencils(): Promise<UserStencilFile[]> {
  try {
    return rejoin(thisCall(), await withDb(
      (db) =>
        new Promise<UserStencilFile[]>((res, rej) => {
          const req = db.transaction(STORE).objectStore(STORE).getAll();
          req.onsuccess = () =>
            res(
              (req.result as StoredStencil[]).flatMap((r) => {
                const data = r.data ?? r.text;
                return typeof data === 'string' || data instanceof Uint8Array ? [{ name: r.name, data }] : [];
              }),
            );
          req.onerror = () => rej(req.error);
        }),
    ));
  } catch {
    return [];
  }
}

export async function clearUserStencils(): Promise<void> {
  try {
    rejoin(thisCall(), await write((s) => s.clear()));
  } catch {
    /* 消せなくても、画面の中では使わなくなる */
  }
}
