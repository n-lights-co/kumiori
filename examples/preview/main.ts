/**
 * 印刷プレビューの見本: 編集欄の HTML を、手が止まるたびに Kumiori で組み、ページを canvas に並べる。
 * 使うのは公開 API (createTypesetter・renderPage) だけで、ほかの依存は無い。
 * 編集欄 (contenteditable) と「HTML」欄 (textarea) は、どちらを書き換えても、もう一方に写す。
 * ほかのエディタとつなぐときは、エディタの中身が変わったときの通知で schedule(エディタの HTML) を呼べばよい。
 * 開き方: npm run dev → http://localhost:5173/examples/preview/
 */
import { createTypesetter, type Typesetter } from '../../src/index';

const editor = document.getElementById('editor')!;
const sourceEl = document.getElementById('source') as HTMLTextAreaElement;
const cssEl = document.getElementById('css') as HTMLTextAreaElement;
const preview = document.getElementById('preview')!;
const warningsEl = document.getElementById('warnings')!;
const statusEl = document.getElementById('status')!;

/** 書体は 1 度だけ読み込み、組むたびに使い回す */
let typesetter: Typesetter | undefined;
/** 組んでいる最中に変わったら、終わってから最新の中身でもう 1 度組む */
let running = false;
let pending: string | undefined;

async function render(bodyHtml: string) {
  if (running) {
    pending = bodyHtml;
    return;
  }
  running = true;
  try {
    typesetter ??= await createTypesetter();
    const t0 = performance.now();
    const r = await typesetter.typeset(`<!doctype html><html lang="ja"><body>${bodyHtml}</body></html>`, {
      kind: 'html',
      // 文書から参照されていない CSS は、利用者のスタイルシートとして足される
      files: [{ name: 'print.css', data: cssEl.value }],
    });
    const canvases: HTMLCanvasElement[] = [];
    for (let i = 0; i < r.pageCount; i++) {
      const c = document.createElement('canvas');
      c.setAttribute('aria-label', `${i + 1} ページ`);
      r.renderPage(c, i, { scale: 1 });
      canvases.push(c);
    }
    preview.replaceChildren(warningsEl, ...canvases);
    warningsEl.textContent = r.warnings.length ? `警告: ${[...new Set(r.warnings)].join(' / ')}` : '';
    statusEl.textContent = `${r.pageCount} ページ / ${Math.round(performance.now() - t0)}ms`;
  } catch (e) {
    statusEl.textContent = `組めませんでした: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    running = false;
    if (pending !== undefined) {
      const next = pending;
      pending = undefined;
      void render(next);
    }
  }
}

/** 手が止まってから組む (打つたびには組まない) */
let timer: ReturnType<typeof setTimeout> | undefined;
function schedule(bodyHtml: string, delay = 400) {
  clearTimeout(timer);
  timer = setTimeout(() => void render(bodyHtml), delay);
}

/** 初期の中身の字下げを落として、「HTML」欄に見やすく出す */
const tidy = (html: string) => html.replace(/^\s+/gm, '').trim();
editor.innerHTML = tidy(editor.innerHTML);
sourceEl.value = editor.innerHTML;

editor.addEventListener('input', () => {
  sourceEl.value = editor.innerHTML;
  schedule(editor.innerHTML);
});
sourceEl.addEventListener('input', () => {
  editor.innerHTML = sourceEl.value;
  schedule(sourceEl.value);
});
cssEl.addEventListener('input', () => schedule(editor.innerHTML));
void render(editor.innerHTML);
