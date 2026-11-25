#!/usr/bin/env node
/**
 * 構成図 (docs/architecture.md・docs/en/architecture.md の「構成図」の節の SVG) を作る。
 *
 *   node scripts/architecture-diagrams.mjs          docs/images/architecture/ (日本語) と docs/en/images/architecture/ (英語) に書く
 *   node scripts/architecture-diagrams.mjs --check  書いてある SVG がこのスクリプトの出力と同じことと、
 *                                                   図に書いた src の名前 (refs) が src にあることを確かめる (test/architectureDiagrams.test.ts)
 *
 * 図を直すときは、このスクリプトを直して作り直す (SVG を手で直さない)。src の関数・クラス・ファイルの名前を変えたら、
 * --check が、図に残った古い名前を知らせる。文言は、日本語と英語の対 (T(ja, en)) で書く。
 * SVG は、文書の画像として単独で表示するので、色と書体を SVG の中の style に持つ (明るい表示と暗い表示の両方)。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const OUT = { ja: 'docs/images/architecture', en: 'docs/en/images/architecture' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = `
:root { --bg: #ffffff; --fg: #1c2230; --muted: #5a6476; --line: #b9c1cf; --panel: #f4f6f9;
  --accent: #2c4c8a; --accent-soft: #e3e9f5; --hot: #b8432a; --hot-soft: #f8e6e1; }
@media (prefers-color-scheme: dark) { :root { --bg: #1a2030; --fg: #e2e7f0; --muted: #9aa4b6; --line: #48526a; --panel: #141925;
  --accent: #8eaeea; --accent-soft: #1e2a44; --hot: #f08b6d; --hot-soft: #3a231e; } }
.bg { fill: var(--bg); }
text { fill: var(--fg); font-family: "Hiragino Sans", "Noto Sans JP", "Yu Gothic", "Meiryo", system-ui, sans-serif; font-size: 12px; }
.t { font-weight: 700; font-size: 13px; }
.m { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 11px; fill: var(--muted); }
.m.strong { fill: var(--fg); font-size: 12px; }
.s, .lab { font-size: 11px; fill: var(--muted); }
.labh { font-size: 11px; fill: var(--hot); }
.lane { font-size: 12px; font-weight: 700; fill: var(--accent); }
.colh, .gt { font-size: 12px; font-weight: 700; fill: var(--muted); }
.b { fill: var(--bg); stroke: var(--line); stroke-width: 1.2; }
.k { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 1.4; }
.h { fill: var(--hot-soft); stroke: var(--hot); stroke-width: 1.5; }
.g { fill: none; stroke: var(--line); stroke-width: 1.2; stroke-dasharray: 6 4; }
.g2 { fill: var(--panel); stroke: var(--line); stroke-width: 1; }
.lazy { fill: none; stroke: var(--hot); stroke-width: 1.2; stroke-dasharray: 4 3; }
.tree { fill: none; stroke: var(--line); stroke-width: 1.2; }
.wait { stroke: var(--muted); stroke-width: 1.4; stroke-dasharray: 3 4; }
.a { fill: none; stroke: var(--fg); stroke-width: 1.3; }
.a.dash { stroke-dasharray: 5 4; stroke: var(--muted); }
.a.hot { stroke: var(--hot); stroke-width: 1.5; }
.mk { fill: var(--fg); }
.mkh { fill: var(--hot); }
`;

// ---- 部品 ----

/** 識別子 (英数と記号だけ) の行は等幅で書く。空白で区切っただけの英語の句 (英語版の補足) は、空白の無いものか、・ ( → . : を含むものだけを識別子とみなす */
const isCode = (l) => /^[A-Za-z@+][A-Za-z0-9_.()#@\-·・ /…→:]*$/.test(l) && (!l.includes(' ') || /[・(→.:]/.test(l));

/** 箱。lines の 1 行目は題、2 行目からは補足 */
function box(x, y, w, h, lines, cls = 'b') {
  lines = lines.filter((l) => l !== '');
  const cx = x + w / 2;
  const ty = y + h / 2 - ((lines.length - 1) * 15) / 2 + 4;
  let out = `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>`;
  lines.forEach((l, i) => {
    const c = i === 0 ? 't' : isCode(l) ? 'm' : 's';
    out += `<text class="${c}" x="${cx}" y="${ty + i * 15}" text-anchor="middle">${esc(l)}</text>`;
  });
  return out;
}
/** 矢印 (折れ線)。opt.dash: 点線、opt.hot: 注目する線、opt.both: 両向き */
function arrow(pts, opt = {}) {
  const cls = ['a', opt.dash ? 'dash' : '', opt.hot ? 'hot' : ''].join(' ').trim();
  const m = opt.hot ? 'mh' : 'm';
  return `<polyline class="${cls}" points="${pts.map((p) => p.join(',')).join(' ')}" marker-end="url(#${m})"${opt.both ? ` marker-start="url(#${m})"` : ''}/>`;
}
function label(x, y, t, anchor = 'middle', cls = 'lab') {
  return `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(t)}</text>`;
}
function group(x, y, w, h, t, cls = 'g', end = false) {
  return `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>` + (t ? `<text class="gt" x="${end ? x + w - 14 : x + 14}" y="${y + 20}"${end ? ' text-anchor="end"' : ''}>${esc(t)}</text>` : '');
}

function svg(fig, lang) {
  const T = (ja, en) => (lang === 'ja' ? ja : en);
  const title = T(...fig.title);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fig.W} ${fig.H}" width="${fig.W}" height="${fig.H}" role="img" aria-labelledby="title">
<title id="title">${esc(title)}</title>
<style>${STYLE}</style>
<defs><marker id="m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="mk"/></marker>
<marker id="mh" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="mkh"/></marker></defs>
<rect class="bg" x="0" y="0" width="${fig.W}" height="${fig.H}" rx="8"/>
${fig.body(T)}
</svg>
`;
}

// ---- 図 ----
// refs: 図に書いた src の名前 (ファイル・ディレクトリは src からの道、ほかは src のどこかにある識別子)

const FIGURES = [
  {
    id: '01-overview', W: 960, H: 490,
    title: ['全体像: 4 つの入口から同じ組版の流れへ', 'Overview: four entry points into one typesetting pipeline'],
    refs: ['main.ts', 'cli.ts', 'api.ts', 'index.ts', 'node.ts', 'typeset', 'typesetToPdf', 'typesetToPdfStream', 'createTypesetter', 'LDocument', 'LayoutEngine', 'AreaTree', 'FontManager', 'Measurer', 'AssetStore', 'callContext.ts', 'limits.ts', 'diagnostics.ts', 'messages.ts'],
    body: (T) => [
      box(20, 20, 210, 56, [T('画面', 'Web app'), 'index.html・main.ts']),
      box(250, 20, 210, 56, [T('Node のコマンド', 'Node CLI'), 'cli.ts']),
      box(480, 20, 210, 56, [T('ライブラリ', 'Library'), 'kumiori・kumiori/node']),
      box(710, 20, 230, 56, [T('ブラウザ向けの 1 ファイル', 'Browser bundle'), 'kumiori/browser']),
      box(250, 130, 690, 56, [T('公開 API (api.ts)', 'Public API (api.ts)'), 'typeset・typesetToPdf・typesetToPdfStream・createTypesetter'], 'k'),
      arrow([[355, 76], [355, 128]]), arrow([[585, 76], [585, 128]]), arrow([[825, 76], [825, 128]]),
      label(362, 106, T('typesetToPdf など', 'typesetToPdf etc.'), 'start'),
      group(10, 228, 940, 116, T('組版の流れ', 'Typesetting pipeline')),
      arrow([[125, 76], [125, 226]], { dash: true }),
      label(132, 140, T('部品を直に呼ぶ', 'calls modules directly'), 'start'), label(132, 156, T('(EPUB もここだけ)', '(EPUB only here)'), 'start'),
      arrow([[595, 186], [595, 226]]), label(602, 212, T('順に呼ぶ', 'runs each stage'), 'start'),
      box(20, 256, 170, 70, [T('読み込み', 'Import'), 'HTML+CSS・XSL-FO']),
      box(217, 256, 150, 70, [T('論理ツリー', 'Logical tree'), 'LDocument'], 'k'),
      box(394, 256, 170, 70, [T('組版', 'Layout'), 'LayoutEngine'], 'h'),
      box(591, 256, 150, 70, [T('物理ツリー', 'Area tree'), 'AreaTree'], 'k'),
      box(768, 256, 172, 70, [T('描画', 'Rendering'), 'PDF・Canvas・SVG・PNG']),
      arrow([[190, 291], [215, 291]]), arrow([[367, 291], [392, 291]]), arrow([[564, 291], [589, 291]]), arrow([[741, 291], [766, 291]]),
      arrow([[480, 344], [480, 378]], { dash: true }), label(488, 366, T('使う', 'uses'), 'start'),
      group(10, 380, 940, 100, T('どの段からも使う部品', 'Shared by every stage')),
      box(26, 408, 214, 56, [T('書体と計測', 'Fonts and measuring'), 'FontManager・Measurer']),
      box(255, 408, 214, 56, [T('画像の登録所', 'Image store'), 'AssetStore']),
      box(484, 408, 214, 56, [T('呼び出しの文脈', 'Call context'), 'callContext・limits']),
      box(713, 408, 221, 56, [T('診断と文言', 'Diagnostics and messages'), 'diagnostics・messages']),
    ].join(''),
  },
  {
    id: '02-import', W: 1080, H: 420,
    title: ['読み込み: 文書から論理ツリーへ', 'Import: from a document to the logical tree'],
    refs: ['FontManager', 'AssetStore', 'kindOf', 'htmlPrepare.ts', 'cssCascade.ts', 'htmlImport.ts', 'xmlParse', 'xslfoImport.ts', 'foExpr.ts', 'foPageMaster.ts', 'LDocument'],
    body: (T) => [
      box(20, 150, 100, 70, [T('入力', 'Input'), T('文書のテキスト', 'document text'), T('CSS・画像・書体', '+ files')]),
      box(142, 145, 140, 80, [T('書体・画像の用意', 'Fonts and images'), 'FontManager', 'AssetStore']),
      box(304, 160, 100, 50, [T('種類の判定', 'Detect kind'), 'html・xhtml・fo']),
      arrow([[120, 185], [140, 185]]), arrow([[282, 185], [302, 185]]),
      label(440, 40, 'HTML+CSS', 'start', 'lane'),
      box(440, 50, 150, 56, [T('HTML の解析', 'Parse HTML'), 'htmlPrepare']),
      box(610, 50, 150, 56, [T('カスケード', 'Cascade'), T('cssCascade ほか', 'cssCascade etc.')]),
      box(780, 50, 150, 56, [T('論理ツリーにする', 'Build logical tree'), 'htmlImport']),
      arrow([[590, 78], [608, 78]]), arrow([[760, 78], [778, 78]]),
      label(440, 254, 'XSL-FO', 'start', 'lane'),
      box(440, 264, 150, 56, [T('XML の解析', 'Parse XML'), 'xmlParse']),
      box(610, 264, 320, 56, [T('属性を読み、論理ツリーにする', 'Read attributes, build logical tree'), 'xslfoImport・foExpr・foPageMaster']),
      arrow([[590, 292], [608, 292]]),
      arrow([[354, 160], [354, 78], [438, 78]]), label(362, 120, 'html・xhtml', 'start'),
      arrow([[354, 210], [354, 292], [438, 292]]), label(362, 254, 'fo', 'start'),
      box(960, 150, 100, 70, [T('論理ツリー', 'Logical tree'), 'LDocument'], 'k'),
      arrow([[930, 78], [990, 78], [990, 148]]),
      arrow([[930, 292], [990, 292], [990, 222]]),
      box(800, 350, 260, 56, [T('使う字を見て書体を読み足す', 'Load fonts for the characters used'), T('等幅・記号・絵文字・数式・OS の書体', 'mono, symbol, emoji, math, OS fonts')], 'h'),
      arrow([[1040, 220], [1040, 348]]),
      arrow([[800, 378], [720, 378]]), label(712, 382, T('組版へ (図 3)', 'to layout (figure 3)'), 'end'),
    ].join(''),
  },
  {
    id: '03-passes', W: 960, H: 300,
    title: ['組版エンジン: 収束するまで組み直す', 'Layout engine: lay out again until it converges'],
    refs: ['SeqMemo', 'LayoutReuse', 'SharedLineMemo', 'createTypesetter', 'indexDocument', 'layoutOnce', 'PageBuild', 'finishTree'],
    body: (T) => [
      box(250, 24, 180, 52, [T('前の回のページ列', 'Previous pass'), 'SeqMemo・LayoutReuse']),
      box(450, 24, 180, 52, [T('文書をまたぐ行分け', 'Lines across documents'), 'SharedLineMemo']),
      arrow([[345, 76], [420, 148]], { dash: true }), label(330, 120, T('変わらない列を使い回す', 'reuses unchanged sequences'), 'end'),
      arrow([[535, 76], [468, 148]], { dash: true }), label(548, 120, T('createTypesetter のとき', 'with createTypesetter'), 'start'),
      box(20, 150, 110, 60, [T('論理ツリー', 'Logical tree'), 'LDocument'], 'k'),
      box(160, 150, 160, 60, [T('節に番号を付ける', 'Number the nodes'), 'indexDocument']),
      box(350, 150, 180, 60, [T('1 回組む', 'Lay out once'), 'layoutOnce → PageBuild'], 'h'),
      box(570, 150, 170, 60, [T('収束したか', 'Converged?'), T('ページ数・参照の値', 'page count, cited values')]),
      box(780, 150, 160, 60, [T('Area Tree にする', 'Build area tree'), 'finishTree'], 'k'),
      arrow([[130, 180], [158, 180]]), arrow([[320, 180], [348, 180]]), arrow([[530, 180], [568, 180]]), arrow([[740, 180], [778, 180]]),
      label(760, 170, T('同じ', 'yes')),
      arrow([[655, 210], [655, 252], [440, 252], [440, 212]], { hot: true }),
      label(548, 272, T('変わった → 組み直す (最大 4 回)', 'changed → lay out again (up to 4 times)'), 'middle', 'labh'),
    ].join(''),
  },
  {
    id: '04-flow', W: 960, H: 486,
    title: ['1 回の組版の中', 'Inside one layout pass'],
    refs: ['sequenceRun', 'selectMaster', 'openPage', 'closePage', 'sheetStatics', 'layoutBlock', 'layoutTable', 'placeFloat', 'footnotes.ts', 'layoutBoxColumns', 'placeAbsIn', 'inlineFlatten.ts', 'inlineLayout.ts', 'flattenInline', 'breakLines', 'positionLine', 'buildLineNode', 'LNode', 'toArea', 'applyFlip', 'buildSheet'],
    body: (T) => [
      group(10, 10, 940, 380, T('1 つの page-sequence (sequenceRun)', 'One page-sequence (sequenceRun)')),
      box(26, 42, 290, 54, [T('ページマスターを選ぶ', 'Select the page master'), 'selectMaster']),
      box(331, 42, 290, 54, [T('ページを開く・閉じる', 'Open and close pages'), 'openPage・closePage']),
      box(636, 42, 298, 54, [T('柱・ノンブルを置く', 'Place running heads and folios'), 'sheetStatics']),
      group(26, 110, 908, 112, T('Flow: 本文をページの枠に詰める', 'Flow: fill the page with the body'), 'g2'),
      box(42, 144, 138, 60, [T('ブロック', 'Block'), 'layoutBlock']),
      box(190, 144, 138, 60, [T('表', 'Table'), 'layoutTable']),
      box(338, 144, 138, 60, [T('回り込み', 'Float'), 'placeFloat']),
      box(486, 144, 138, 60, [T('脚注', 'Footnote'), 'footnotes']),
      box(634, 144, 138, 60, [T('段組', 'Columns'), 'layoutBoxColumns']),
      box(782, 144, 138, 60, [T('絶対配置', 'Absolute'), 'placeAbsIn']),
      arrow([[476, 110], [476, 98]], { hot: true }), label(484, 106, T('溢れたら次のページ', 'overflow → next page'), 'start', 'labh'),
      group(26, 238, 908, 138, T('行を組む (inlineFlatten・inlineLayout)', 'Build lines (inlineFlatten, inlineLayout)'), 'g2', true),
      box(42, 272, 192, 88, [T('字の並びにする', 'Flatten to atoms'), 'flattenInline', T('合字・shaping・送り', 'ligatures, shaping, advances')]),
      box(270, 272, 192, 88, [T('行に分ける', 'Break into lines'), 'breakLines', T('改行の機会・禁則・分綴', 'UAX #14, kinsoku, hyphens')], 'h'),
      box(498, 272, 192, 88, [T('行の中に置く', 'Position in the line'), 'positionLine', T('字間・揃え・双方向', 'spacing, alignment, bidi')]),
      box(726, 272, 192, 88, [T('行の節を作る', 'Build the line node'), 'buildLineNode', T('ルビ・縦中横', 'ruby, tate-chu-yoko')]),
      arrow([[234, 316], [268, 316]]), arrow([[462, 316], [496, 316]]), arrow([[690, 316], [724, 316]]),
      arrow([[111, 204], [111, 270]]), label(118, 230, T('中の行', 'lines inside'), 'start'),
      box(150, 410, 230, 60, [T('LNode の木', 'LNode tree'), T('論理座標 (inline・block)', 'logical (inline, block)')]),
      box(420, 410, 180, 60, [T('物理座標へ', 'To physical'), 'toArea・applyFlip']),
      box(640, 410, 200, 60, [T('ページの Area', 'Page areas'), 'buildSheet'], 'k'),
      arrow([[265, 390], [265, 408]]), arrow([[380, 440], [418, 440]]), arrow([[600, 440], [638, 440]]),
    ].join(''),
  },
  {
    id: '05-trees', W: 960, H: 400,
    title: ['論理ツリーと Area Tree', 'The logical tree and the area tree'],
    refs: ['LDocument', 'LPageSequence', 'LFlow', 'LBlock', 'LTable', 'LBlockContainer', 'LFloat', 'LFootnote', 'LMarker', 'LInline', 'LRuby', 'LTateChuYoko', 'LImage', 'LLeader', 'AreaTree', 'SheetArea', 'PageArea', 'RegionBodyArea', 'BlockArea', 'TableArea', 'TableCellArea', 'LineArea', 'GlyphArea', 'ImageArea', 'RubyArea', 'InlineArea'],
    body: (T) => {
      const L = [
        [0, 'LDocument', ''], [1, 'LPageSequence', T('ページマスター', 'page masters')], [2, 'LFlow', T('本文・柱の内容', 'body, static content')],
        [3, 'LBlock・LTable・LBlockContainer', ''], [3, 'LFloat・LFootnote・LMarker', ''], [4, 'LInline・LRuby・LTateChuYoko', ''], [4, T('文字列・LImage・LLeader', 'text・LImage・LLeader'), ''],
      ];
      const R = [
        [0, 'AreaTree', T('しおり・リンク先・構造', 'bookmarks, links, structure')], [1, 'sheet', T('トンボ・裁ち落とし', 'crop marks, bleed')], [2, 'page', ''],
        [3, 'region-body', T('背面・絶対配置も', 'plus behind, absolute')], [4, 'block・table・table-cell', ''], [5, 'line', ''], [6, 'glyph・image・ruby・inline', ''],
      ];
      let o = label(20, 24, T('論理ツリー (Input)', 'Logical tree (input)'), 'start', 'lane') + label(520, 24, T('Area Tree (物理ツリー)', 'Area tree (physical)'), 'start', 'lane');
      const rowY = (i) => 40 + i * 50;
      const draw = (list, x0, x1) => {
        list.forEach(([d, t, s], i) => {
          const x = x0 + d * 22;
          o += `<rect class="b" x="${x}" y="${rowY(i)}" width="${x1 - x}" height="36" rx="6"/>`;
          o += `<text class="m strong" x="${x + 12}" y="${rowY(i) + 23}">${esc(t)}</text>`;
          if (s) o += `<text class="s" x="${x1 - 12}" y="${rowY(i) + 23}" text-anchor="end">${esc(s)}</text>`;
          let p = i - 1;
          while (p >= 0 && list[p][0] >= d) p--;
          if (i > 0 && p >= 0) {
            const px = x0 + list[p][0] * 22 + 10;
            o += `<polyline class="tree" points="${px},${rowY(p) + 36} ${px},${rowY(i) + 18} ${x},${rowY(i) + 18}"/>`;
          }
        });
      };
      draw(L, 20, 440);
      draw(R, 520, 940);
      o += arrow([[440, rowY(1) + 18], [540, rowY(1) + 18]], { hot: true });
      o += label(480, rowY(1) + 12, T('ページの数だけ', 'one per page'), 'middle', 'labh');
      o += arrow([[440, rowY(3) + 18], [606, rowY(4) + 18]], { hot: true });
      o += label(446, rowY(4) + 38, T('改ページで分かれる', 'split at page breaks'), 'start', 'labh');
      o += arrow([[440, rowY(6) + 18], [650, rowY(6) + 18]], { hot: true });
      o += label(546, rowY(6) + 10, T('行に分け、字ごとの Area に', 'lines, one area per glyph'), 'middle', 'labh');
      return o;
    },
  },
  {
    id: '06-render', W: 960, H: 370,
    title: ['描画: 1 つの走査、4 つの書き出し', 'Rendering: one traversal, four outputs'],
    refs: ['paint.ts', 'paintSheet', 'paintArea', 'Painter', 'canvasRenderer.ts', 'svgRenderer.ts', 'pageRaster.ts', 'pdfRenderer.ts', 'renderPage', 'renderPageToSvg', 'renderPageToPng', 'toPdf', 'colorGlyphPdf.ts', 'pdfImageEmbed.ts', 'pdfTags.ts', 'pdfStandard.ts', 'pdfFlatten.ts', 'pdfPageLabels.ts'],
    body: (T) => [
      box(20, 150, 130, 60, ['Area Tree', 'AreaTree'], 'k'),
      box(180, 120, 190, 120, [T('走査と描く順', 'Traverse, paint order'), 'paintSheet・paintArea', T('背景・罫線・中身・トンボ', 'backgrounds, borders, marks')], 'h'),
      arrow([[150, 180], [178, 180]]),
      `<rect class="k" x="400" y="30" width="34" height="304" rx="6"/>`,
      `<text class="t" transform="translate(422 182) rotate(-90)" text-anchor="middle">${esc(T('Painter インターフェース', 'Painter interface'))}</text>`,
      arrow([[370, 180], [398, 180]]),
      box(470, 30, 210, 64, [T('Canvas (画面)', 'Canvas (screen)'), 'canvasRenderer', 'renderPage']),
      box(470, 110, 210, 64, ['SVG', 'svgRenderer', 'renderPageToSvg']),
      box(470, 190, 210, 64, [T('PNG (自前で塗る)', 'PNG (own rasterizer)'), 'pageRaster', 'renderPageToPng']),
      box(470, 270, 210, 64, ['PDF', 'pdfRenderer (pdf-lib)', 'toPdf・typesetToPdf'], 'k'),
      arrow([[434, 62], [468, 62]]), arrow([[434, 142], [468, 142]]), arrow([[434, 222], [468, 222]]), arrow([[434, 302], [468, 302]]),
      group(710, 120, 230, 236, T('PDF だけの部品', 'PDF only')),
      ...[
        T('書体の埋め込み (fontkit)', 'Font embedding (fontkit)'), T('色つきの字形 (colorGlyphPdf)', 'Color glyphs (colorGlyphPdf)'), T('画像の埋め込み (pdfImageEmbed)', 'Images (pdfImageEmbed)'),
        T('タグ付き PDF (pdfTags)', 'Tagged PDF (pdfTags)'), 'PDF/X・PDF/A (pdfStandard)', T('透明の平坦化 (pdfFlatten)', 'Flattening (pdfFlatten)'), T('ページラベル (pdfPageLabels)', 'Page labels (pdfPageLabels)'),
      ].map((t, i) => label(726, 166 + i * 27, t, 'start', 'li')),
      arrow([[680, 302], [708, 302]]),
    ].join(''),
  },
  {
    id: '07-pdf-modes', W: 960, H: 280,
    title: ['PDF の 3 つの作り方と、持つもの', 'Three ways to make a PDF, and what each keeps in memory'],
    refs: ['typeset', 'toPdf', 'typesetToPdf', 'typesetToPdfStream', 'layout', 'layoutSheets', 'renderPdf', 'renderPdfPages', 'renderPage'],
    body: (T) => {
      const rows = [
        ['typeset → toPdf', 'layout()', [T('Area Tree 全体', 'Whole area tree'), T('結果に残る', 'kept in the result')], 'renderPdf', ['Uint8Array', T('renderPage も使える', 'renderPage also works')], 'h'],
        ['typesetToPdf', 'layoutSheets()', [T('ページの論理の木', 'Page build trees'), T('1 ページずつ Area に', 'areas made page by page')], 'renderPdfPages', ['Uint8Array', T('Node のコマンドもこれ', 'used by the CLI')], 'k'],
        ['typesetToPdfStream', 'layoutSheets()', [T('ページの論理の木', 'Page build trees'), T('書いた流れは手放す', 'written streams released')], 'renderPdfPages', [T('書き出し先へ流す', 'Streamed to output'), T('PDF/X・PDF/A は不可', 'no PDF/X or PDF/A')], 'k'],
      ];
      let o = label(235, 22, T('組版', 'Layout'), 'middle', 'colh') + label(425, 22, T('メモリに持つもの', 'Kept in memory'), 'middle', 'colh') + label(635, 22, T('書き出し', 'Writing'), 'middle', 'colh') + label(850, 22, T('結果', 'Result'), 'middle', 'colh');
      rows.forEach(([name, lay, keep, wr, outp, cls], i) => {
        const y = 36 + i * 80;
        o += `<text class="m strong" x="20" y="${y + 33}">${esc(name)}</text>`;
        o += box(170, y, 130, 56, [T('組む', 'Lay out'), lay]);
        o += box(330, y, 190, 56, keep, cls);
        o += box(550, y, 170, 56, [T('描いて書く', 'Paint and write'), wr]);
        o += box(750, y, 200, 56, outp);
        o += arrow([[300, y + 28], [328, y + 28]]) + arrow([[520, y + 28], [548, y + 28]]) + arrow([[720, y + 28], [748, y + 28]]);
      });
      return o;
    },
  },
  {
    id: '08-fonts', W: 960, H: 380,
    title: ['書体: どこから来て、誰が使うか', 'Fonts: where they come from and who uses them'],
    refs: ['DEFAULT_FONTS', 'loadFont', 'systemFonts', 'userFonts.ts', 'webFont.ts', 'fontLoader.ts', 'FontManager', 'registerBuffer', 'fontInstancer.ts', 'cff2Instancer.ts', 'fontMapping.ts', 'Measurer', 'fontkitShaping.ts'],
    body: (T) => [
      label(20, 24, T('書体の出どころ', 'Sources'), 'start', 'lane'),
      box(20, 36, 200, 56, [T('既定の書体', 'Default fonts'), 'DEFAULT_FONTS・loadFont']),
      box(20, 108, 200, 56, [T('渡されたファイル', 'Given files'), 'files・@font-face']),
      box(20, 180, 200, 56, [T('OS の書体', 'OS fonts'), 'systemFonts (Node)']),
      box(20, 252, 200, 56, [T('画面で読み込んだ書体', 'Fonts added in the app'), 'userFonts']),
      box(260, 130, 170, 80, [T('形を戻す・分ける', 'Unwrap and split'), 'webFont・fontLoader', T('WOFF2 → TTF・TTC の分割', 'WOFF2 → TTF, split TTC')]),
      arrow([[220, 64], [240, 64], [240, 160], [258, 160]]), arrow([[220, 136], [240, 136]]), arrow([[220, 208], [240, 208], [240, 180], [258, 180]]), arrow([[220, 280], [240, 280], [240, 208]]),
      box(470, 120, 190, 100, ['FontManager', 'registerBuffer', T('fontkit で読む', 'parsed with fontkit'), T('字の割り当て', 'per-character fallback')], 'h'),
      arrow([[430, 170], [468, 170]]),
      box(455, 270, 220, 64, [T('可変フォントの実体', 'Variable font instances'), 'fontInstancer・cff2Instancer']),
      arrow([[565, 220], [565, 268]], { both: true }), label(573, 250, T('軸の値を決める', 'fix axis values'), 'start'),
      box(470, 20, 190, 64, [T('書体の割り当て', 'Font mapping'), 'fontMapping']),
      arrow([[565, 84], [565, 118]]), label(573, 106, T('family → 書体', 'family → face'), 'start'),
      label(720, 24, T('使う側', 'Consumers'), 'start', 'lane'),
      box(720, 36, 220, 64, [T('計測 (組版)', 'Measuring (layout)'), 'Measurer・fontkitShaping', T('送り・GSUB・GPOS', 'advances, GSUB, GPOS')], 'k'),
      box(720, 140, 220, 56, ['Canvas', 'FontFace']),
      box(720, 236, 220, 56, ['PDF・SVG・PNG', T('字形の輪郭・埋め込み', 'outlines, embedding')]),
      arrow([[660, 150], [690, 150], [690, 68], [718, 68]]), arrow([[660, 168], [718, 168]]), arrow([[660, 186], [690, 186], [690, 264], [718, 264]]),
      label(720, 330, T('文書が使うときだけ読む:', 'Loaded only when needed:'), 'start'), label(720, 348, T('数式・等幅・記号・絵文字', 'math, mono, symbol, emoji'), 'start'),
    ].join(''),
  },
  {
    id: '09-images', W: 960, H: 400,
    title: ['画像と図: 形式を見分けて、画素か図形に', 'Images and drawings: detect the format, then pixels or shapes'],
    refs: ['AssetStore', 'resolveResource', 'jpeg.ts', 'webp.ts', 'vp8.ts', 'pixels.ts', 'ccitt.ts', 'svg.ts', 'svgFilterRaster.ts', 'mathLayout.ts', 'pdfImage.ts', 'psInterp.ts', 'metafile.ts', 'cgm.ts', 'drawio'],
    body: (T) => [
      box(20, 60, 170, 56, [T('渡されたファイル', 'Given files'), 'files・Blob']),
      box(20, 140, 170, 56, [T('参照の取得', 'Fetched references'), 'resolveResource・fetch']),
      arrow([[190, 88], [214, 88], [214, 128], [238, 128]]), arrow([[190, 168], [214, 168], [214, 128]]),
      label(105, 222, T('取得は大きさと時間に上限', 'size and time limits on fetches'), 'middle'),
      box(240, 90, 170, 76, [T('画像の登録所', 'Image store'), 'AssetStore', T('大きさを先に読む', 'reads the size first')], 'h'),
      box(450, 90, 160, 76, [T('形式の判定', 'Detect format'), T('プラグイン → draw.io', 'plugins → draw.io'), T('→ 本体の形式', '→ built-in formats')]),
      arrow([[410, 128], [448, 128]]),
      group(650, 10, 290, 150, T('画素にする', 'To pixels')),
      label(666, 56, 'JPEG (jpeg)', 'start', 'li'), label(666, 80, 'PNG (pako)', 'start', 'li'), label(666, 104, 'WebP (webp・vp8)', 'start', 'li'), label(666, 128, 'GIF・BMP (pixels)', 'start', 'li'), label(806, 56, 'TIFF (utif・ccitt)', 'start', 'li'),
      group(650, 176, 290, 190, T('図形にする', 'To shapes')),
      label(666, 222, 'SVG (svg・svgFilterRaster)', 'start', 'li'), label(666, 246, 'MathML (mathLayout)', 'start', 'li'), label(666, 270, T('PDF のページ (pdfImage)', 'PDF pages (pdfImage)'), 'start', 'li'),
      label(666, 294, 'EPS (psInterp)', 'start', 'li'), label(666, 318, 'WMF・EMF (metafile)・CGM', 'start', 'li'), label(666, 342, 'draw.io (drawio/)', 'start', 'li'),
      `<rect class="lazy" x="656" y="278" width="270" height="74" rx="6"/>`,
      label(940, 386, T('点線の中の形式は、出てきたときだけ解釈器を読み込む', 'Formats in the dashed box load their code only when used'), 'end', 'labh'),
      arrow([[610, 116], [648, 86]]), arrow([[610, 140], [648, 260]]),
      box(240, 260, 170, 64, [T('組版と描画', 'Layout and rendering'), T('本来の大きさ・中身', 'natural size, content')], 'k'),
      arrow([[325, 166], [325, 258]]), label(333, 220, T('同じ画像を共有', 'one shared image'), 'start'),
    ].join(''),
  },
  {
    id: '10-call-context', W: 960, H: 250,
    title: ['呼び出しの文脈: await の後で置き直す', 'Call context: restore it after every await'],
    refs: ['callContext.ts', 'rejoin', 'thisCall'],
    body: (T) => [
      label(20, 34, T('モジュールの変数', 'Module variable'), 'start', 'lane'),
      `<rect class="k" x="160" y="18" width="160" height="26" rx="4"/>`, label(240, 36, 'A', 'middle', 't'),
      `<rect class="h" x="320" y="18" width="180" height="26" rx="4"/>`, label(410, 36, 'B', 'middle', 't'),
      `<rect class="k" x="500" y="18" width="180" height="26" rx="4"/>`, label(590, 36, 'A', 'middle', 't'),
      `<rect class="h" x="680" y="18" width="200" height="26" rx="4"/>`, label(780, 36, 'B', 'middle', 't'),
      label(20, 104, 'typeset A', 'start', 'lane'),
      box(160, 80, 150, 40, [T('組み始める', 'Start')]),
      `<line class="wait" x1="310" y1="100" x2="500" y2="100"/>`, label(405, 92, T('await (書体を取る)', 'await (fetch fonts)')),
      box(500, 80, 180, 40, [T('rejoin → A に戻す', 'rejoin → back to A')], 'k'),
      label(20, 184, 'typeset B', 'start', 'lane'),
      box(320, 160, 170, 40, [T('組み始める', 'Start')]),
      `<line class="wait" x1="490" y1="180" x2="680" y2="180"/>`, label(585, 172, 'await'),
      box(680, 160, 190, 40, [T('rejoin → B に戻す', 'rejoin → back to B')], 'h'),
      arrow([[160, 226], [940, 226]]), label(940, 244, T('時間', 'time'), 'end'),
    ].join(''),
  },
  {
    id: '11-build', W: 960, H: 370,
    title: ['ビルドと確かめ', 'Builds and checks'],
    refs: [],
    body: (T) => [
      box(20, 150, 120, 60, ['src', 'TypeScript'], 'k'),
      box(190, 20, 190, 56, ['vite.lib.config.ts', T('+ tsc (型の宣言)', '+ tsc (declarations)')]),
      box(190, 100, 190, 56, ['vite.cli.config.ts']),
      box(190, 180, 190, 56, ['vite.browser.config.ts']),
      box(190, 260, 190, 56, ['vite.config.ts']),
      arrow([[140, 180], [165, 180], [165, 48], [188, 48]]), arrow([[165, 128], [188, 128]]), arrow([[165, 208], [188, 208]]), arrow([[165, 180], [165, 288], [188, 288]]),
      box(420, 20, 210, 56, ['dist-lib', 'kumiori・kumiori/node']),
      box(420, 100, 210, 56, ['dist-cli', T('kumiori (コマンド)', 'kumiori (CLI)')]),
      box(420, 180, 210, 56, ['dist-browser', 'kumiori/browser']),
      box(420, 260, 210, 56, [T('画面', 'Web app'), 'GitHub Pages・/api/']),
      arrow([[380, 48], [418, 48]]), arrow([[380, 128], [418, 128]]), arrow([[380, 208], [418, 208]]), arrow([[380, 288], [418, 288]]),
      group(670, 10, 270, 350, T('確かめ', 'Checks')),
      box(686, 40, 238, 64, [T('単体の試験', 'Unit tests'), 'vitest (test/)', T('領域の木の指紋も', 'plus area tree fingerprints')]),
      box(686, 120, 238, 64, [T('画面の試験', 'Browser tests'), 'Playwright (e2e/)']),
      box(686, 200, 238, 64, [T('組み比べ', 'Before/after comparison'), 'compare-base・perf-compare', T('意図した変化の一覧と照らす', 'checked against intended changes')], 'h'),
      box(686, 280, 238, 64, [T('CI と同じ手順', 'CI steps locally'), 'npm run ci:local']),
    ].join(''),
  },
];

/** 11-build の refs は src の外のファイル (リポジトリの直下からの道) */
const REPO_REFS = { '11-build': ['vite.lib.config.ts', 'vite.cli.config.ts', 'vite.browser.config.ts', 'vite.config.ts', 'test', 'e2e', 'scripts/compare-base.mjs', 'scripts/perf-compare.mjs', 'scripts/ci-local.mjs', 'test/fingerprints'] };

function render() {
  const files = new Map();
  for (const fig of FIGURES) for (const lang of ['ja', 'en']) files.set(`${OUT[lang]}/${fig.id}.svg`, svg(fig, lang));
  return files;
}

/** src の下の .ts をすべて読む */
function srcText() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (rel.endsWith('.ts')) out.push(fs.readFileSync(path.join(root, rel), 'utf8'));
    }
  };
  walk('src');
  return out.join('\n');
}

function check() {
  const problems = [];
  for (const [f, text] of render()) {
    const abs = path.join(root, f);
    if (!fs.existsSync(abs)) problems.push(`${f} がありません`);
    else if (fs.readFileSync(abs, 'utf8') !== text) problems.push(`${f} がスクリプトの出力と違います`);
  }
  const src = srcText();
  for (const fig of FIGURES) {
    for (const r of fig.refs) {
      // 「.」か「/」を含むものは src の下の道、ほかは識別子 (src のディレクトリの名前でもよい)
      const ok = /[./]/.test(r) ? fs.existsSync(path.join(root, 'src', r)) : fs.existsSync(path.join(root, 'src', r)) || new RegExp(`\\b${r}\\b`).test(src);
      if (!ok) problems.push(`${fig.id}: src に ${r} がありません`);
    }
    for (const r of REPO_REFS[fig.id] ?? []) if (!fs.existsSync(path.join(root, r))) problems.push(`${fig.id}: ${r} がありません`);
  }
  const known = new Set([...render().keys()].map((f) => path.basename(f)));
  for (const d of Object.values(OUT)) {
    const abs = path.join(root, d);
    if (fs.existsSync(abs)) for (const f of fs.readdirSync(abs)) if (!known.has(f)) problems.push(`${d}/${f} はスクリプトが作らない図です`);
  }
  return problems;
}

if (process.argv.includes('--check')) {
  const problems = check();
  for (const p of problems) console.error(p);
  if (problems.length) {
    console.error('構成図を直すときは scripts/architecture-diagrams.mjs を直して、node scripts/architecture-diagrams.mjs で作り直してください');
    process.exit(1);
  }
  console.log(`構成図 ${FIGURES.length} 枚 (日本語・英語) は最新です`);
} else {
  for (const [f, text] of render()) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), text);
  }
  console.log(`構成図 ${FIGURES.length} 枚を ${OUT.ja}/ と ${OUT.en}/ に書きました`);
}
