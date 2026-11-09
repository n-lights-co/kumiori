/** 文書・CSS の参照の集め方 (src/resources.ts) */
import { describe, expect, it } from 'vitest';
import { collectResources, cssRefs, documentRefs, resolveRef } from '../src/resources';

describe('参照の集め方', () => {
  it('文書の参照: <link rel=stylesheet> と @import は CSS、@font-face の url() は書体、src・data・SVG の href・ほかの url() はそのほか。<a href> は拾わない', () => {
    const refs = documentRefs(
      '<link rel="preload" href="p.css"><link href=\'s.css\' rel="alternate stylesheet"><style>@import url("i.css"); p { background: url(bg.png) }</style>' +
        '<img src="a.png"><svg><image xlink:href="b.svg"/></svg><object data="c.svg"></object><a href="doc.pdf">d</a><fo:external-graphic src="url(\'e.png\')"/>',
    );
    expect(refs).toEqual([
      { url: 's.css', kind: 'css' },
      { url: 'a.png', kind: 'other' },
      { url: 'b.svg', kind: 'other' },
      { url: 'c.svg', kind: 'other' },
      { url: 'e.png', kind: 'other' },
      { url: 'i.css', kind: 'css' },
      { url: 'bg.png', kind: 'other' },
    ]);
    expect(cssRefs("@import 'a.css' screen; @font-face { src: url(f.ttf) }")).toEqual([
      { url: 'a.css', kind: 'css' },
      { url: 'f.ttf', kind: 'font' },
    ]);
  });
  it('CSS の中の相対参照は CSS の URL を基準に解決する (RFC 3986 §5.2。スキームの無い名前はパスとしてつなぐ)', () => {
    expect(resolveRef('../img/a.png', 'file:///w/css/main.css')).toBe('file:///w/img/a.png');
    expect(resolveRef('b.css', 'https://cdn.example/x/a.css?v=1')).toBe('https://cdn.example/x/b.css');
    expect(resolveRef('../img/a.png', 'css/main.css')).toBe('img/a.png');
    expect(resolveRef('https://x/y.css', 'css/main.css')).toBe('https://x/y.css');
    expect(resolveRef('a.png')).toBe('a.png');
  });
  it('files にあるものは問い合わせない。data:・#・javascript: は問い合わせない。CSS の @import の輪で止まる', async () => {
    const asked: string[] = [];
    const r = await collectResources('<link rel="stylesheet" href="a.css"><img src="data:image/png;base64,AA"><img src="have.png"><img src="#x">', {
      has: (u) => u === 'have.png',
      cssTexts: [],
      resolve: (u) => (asked.push(u), u === 'a.css' ? '@import "b.css";' : u === 'b.css' ? '@import "a.css";' : undefined),
      fetchStyle: () => false,
      timeoutMs: 1000,
    });
    expect(asked).toEqual(['a.css', 'b.css']);
    expect(r.files.map((f) => [f.name, f.css])).toEqual([
      ['a.css', true],
      ['b.css', true],
    ]);
  });
});
