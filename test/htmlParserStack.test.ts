/**
 * Node の HTML の構文解析器 (linkedom が使う htmlparser2) の、開いた要素の列の入れ物 (src/htmlParserStack.ts。HTM-65) の確かめ。
 * 時間ではなく、(1) 入れ物が配列と同じに振る舞うこと、(2) linkedom の構文解析で実際に入れ物に替わること、
 * (3) Parser の作りが受け持つ使い方から外れていれば替えないこと、(4) 深い入れ子の文書の木が正しいことを確かめる
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { parseHTML } from 'linkedom';
import { Parser } from 'htmlparser2';
import { parserListsWrapped, parserUsesSupportedListOps, patchHtmlParserStack, topFirstArray } from '../src/htmlParserStack';

describe('開いた要素の列の入れ物', () => {
  it('直下の依存の htmlparser2 が、linkedom の使うものと同じ (linkedom の下に別の版が置かれていない)', () => {
    // 仕掛け (htmlParserStack.ts・sourceLocation.ts) は直下の htmlparser2 の Parser に入れるので、linkedom が別の版を使うと効かない。
    // htmlparser2 は linkedom の依存の版 (package.json の範囲) に合わせて上げる (.github/dependabot.yml の htmlparser2 の項)
    const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')) as { packages: Record<string, { version?: string; dependencies?: Record<string, string> }> };
    expect(lock.packages['node_modules/linkedom/node_modules/htmlparser2'], 'linkedom の下の htmlparser2').toBeUndefined();
    expect(lock.packages['node_modules/htmlparser2']?.version).toBeDefined();
    expect(lock.packages['node_modules/linkedom']?.dependencies?.htmlparser2).toBeDefined();
  });

  it('shift・unshift・indexOf・length・添字が、配列と同じ答えを返す (でたらめな操作の列で比べる)', () => {
    let seed = 1;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
    const a: unknown[] = ['x', 'y'];
    const b = topFirstArray(['x', 'y']);
    for (let k = 0; k < 5000; k++) {
      const op = rnd(6);
      const v = ['div', 'p', 'b', 'i'][rnd(4)];
      if (op === 0 || op === 1) expect(b.unshift(v)).toBe(a.unshift(v));
      else if (op === 2) expect(b.shift()).toBe(a.shift());
      else if (op === 3) expect(b.indexOf(v)).toBe(a.indexOf(v));
      else if (op === 4) {
        const i = rnd(a.length + 2);
        expect(b[i]).toBe(a[i]);
      } else if (rnd(50) === 0) {
        const n = rnd(a.length + 1);
        a.length = n;
        b.length = n;
      }
      expect(b.length).toBe(a.length);
    }
    // 2 つ以上を一度に足すときも、配列と同じ並び
    const c = topFirstArray([]);
    c.unshift('a', 'b', 'c');
    expect([c[0], c[1], c[2]]).toEqual(['a', 'b', 'c']);
  });

  it('linkedom の構文解析で、Parser の 2 つの列 (stack・foreignContext) が入れ物に替わる', async () => {
    expect(await patchHtmlParserStack()).toBe(true);
    const before = parserListsWrapped();
    parseHTML('<!doctype html><html><body><p>x</p></body></html>');
    expect(parserListsWrapped() - before).toBe(2);
  });

  it('Parser の作りが、受け持つ使い方 (shift・unshift・indexOf・length・添字) から外れていれば替えない', () => {
    const src = Function.prototype.toString.call(Parser);
    expect(parserUsesSupportedListOps(src)).toBe(true);
    expect(parserUsesSupportedListOps(src.replace('this.stack.shift()', 'this.stack.pop()'))).toBe(false);
    expect(parserUsesSupportedListOps(src + ' f() { return this.foreignContext.slice(1); }')).toBe(false);
    expect(parserUsesSupportedListOps(src + ' g() { this.stack = []; }')).toBe(false);
    // linkedom が読む htmlparser2 は、ここで読むものと同じファイル (違えば、替える仕掛けが linkedom に効かない)
    const req = createRequire(import.meta.url);
    const fromLinkedom = createRequire(req.resolve('linkedom')).resolve('htmlparser2');
    expect(fs.realpathSync(fromLinkedom)).toBe(fs.realpathSync(req.resolve('htmlparser2')));
  });

  it('深い入れ子 (閉じない <b><i> × 2 万、svg の中の g × 1 万) の木と、閉じる所 (</i> で途中まで閉じる)', async () => {
    await patchHtmlParserStack();
    const n = 20000;
    const d = parseHTML(`<!doctype html><html><body>${'<b><i>'.repeat(n)}z</i>w<svg>${'<g>'.repeat(10000)}<text>t</text></svg>q</body></html>`).document;
    let e: Element | null = d.body.firstElementChild;
    let depth = 0;
    while (e && (e.localName === 'b' || e.localName === 'i')) {
      expect(e.localName).toBe(depth % 2 ? 'i' : 'b');
      depth++;
      if (e.firstElementChild && (e.firstElementChild.localName === 'b' || e.firstElementChild.localName === 'i')) e = e.firstElementChild;
      else break;
    }
    expect(depth).toBe(2 * n);
    // いちばん内側の i が z を持ち、</i> で閉じた後の w は、その親の b の中
    expect(e!.localName).toBe('i');
    expect(e!.textContent).toBe('z');
    const b = e!.parentElement!;
    expect(b.localName).toBe('b');
    // b の子: i・w・svg・q (svg を閉じた後の q も b の中)
    expect(Array.from(b.childNodes).map((c) => c.nodeName.toLowerCase())).toEqual(['i', '#text', 'svg', '#text']);
    expect(b.childNodes[1].textContent).toBe('w');
    expect(b.lastChild!.textContent).toBe('q');
    // svg の中の g の入れ子
    let g: Element | null = b.lastElementChild!;
    let gs = 0;
    while (g?.firstElementChild?.localName === 'g') ((g = g.firstElementChild), gs++);
    expect(gs).toBe(10000);
    expect(g!.firstElementChild!.localName).toBe('text');
    expect(d.body.textContent!.endsWith('tq')).toBe(true);
  });
});
