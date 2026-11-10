/**
 * 利用者の書体の保存 (src/userFonts.ts。ブラウザの IndexedDB)。
 * 取引 (transaction) が中止 (abort) で終わったときも、保存・消去が終わる (待ったままにならず、接続を閉じる)。
 * Indexed Database API 3.0 §5.5 (Aborting a transaction): 中止では取引に abort のイベントが来る。error のイベントは
 * 来ないことがある (確定の途中の誤り (容量の超過など) で中止されたとき)。
 * Node に IndexedDB は無いので、イベントの来方だけをまねた偽の IndexedDB で試す
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearUserFonts, loadUserFonts, saveUserFont } from '../src/userFonts';
import type { UserFont } from '../src/fontLoader';

type Handler = (() => void) | null;
type FakeTx = { error: unknown; oncomplete: Handler; onerror: Handler; onabort: Handler; objectStore(): { put(v: unknown): object; clear(): object } };

/** 取引の終わり方 (complete: 確定、abort: abort のイベントだけ、error: error のイベントの後に abort) を決めた偽の IndexedDB */
function fakeIndexedDb(end: 'complete' | 'abort' | 'error') {
  const state = { closed: 0, puts: [] as unknown[], clears: 0 };
  const db = {
    transaction(): FakeTx {
      const tx: FakeTx = {
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: () => ({ put: (v) => (state.puts.push(v), {}), clear: () => (state.clears++, {}) }),
      };
      setTimeout(() => {
        if (end === 'complete') return tx.oncomplete?.();
        tx.error = new Error('QuotaExceededError');
        if (end === 'error') tx.onerror?.();
        tx.onabort?.();
      }, 0);
      return tx;
    },
    close: () => void state.closed++,
  };
  const idb = {
    open() {
      const req = { result: db, error: null, onupgradeneeded: null as Handler, onsuccess: null as Handler, onerror: null as Handler };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
  };
  vi.stubGlobal('indexedDB', idb);
  return state;
}

/** p が、タイマーを何度か回す間に終わるか (終わらなければ 'pending')。時間は測らない */
async function settled(p: Promise<unknown>): Promise<'done' | 'pending'> {
  const turns = (async () => {
    for (let k = 0; k < 20; k++) await new Promise((ok) => setTimeout(ok, 0));
    return 'pending' as const;
  })();
  return Promise.race([p.then(() => 'done' as const), turns]);
}

const font: UserFont = { family: 'F', weight: 400, names: ['F'], buffer: new ArrayBuffer(4) } as unknown as UserFont;

describe('利用者の書体の保存 (IndexedDB)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('取引が確定すれば、保存・消去が終わり、接続を閉じる', async () => {
    const st = fakeIndexedDb('complete');
    expect(await settled(saveUserFont(font))).toBe('done');
    expect(await settled(clearUserFonts())).toBe('done');
    expect(st.puts).toEqual([{ key: 'F|400', ...font }]);
    expect([st.clears, st.closed]).toEqual([1, 2]);
  });
  it('取引が中止 (abort のイベントだけ) で終わっても、保存・消去が終わり (投げない)、接続を閉じる', async () => {
    for (const end of ['abort', 'error'] as const) {
      const st = fakeIndexedDb(end);
      expect(await settled(saveUserFont(font))).toBe('done');
      expect(await settled(clearUserFonts())).toBe('done');
      expect(st.closed).toBe(2);
      vi.unstubAllGlobals();
    }
  });
  it('IndexedDB が無ければ、読み出しは空 (投げない)', async () => {
    expect(await loadUserFonts()).toEqual([]);
  });
});
