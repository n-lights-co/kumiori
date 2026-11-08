/**
 * 究極のサンプル: 仕様の全機能を 1 つの文書で実演する。
 *  Seq.1 縦書き (vertical-rl) : ルビ・縦中横・禁則・ぶら下げ・横倒し欧文・縦書き表・ボックスの改ページ断片
 *  Seq.2 横書き               : 行単位でページをまたぐ表 (ヘッダ繰り返し) + 絶対配置の縦書きコンテナ
 *  共通                       : 塗り足しまで届く背景ブロックの静的ヘッダー/フッター、トンボ付き A4
 */
import type {
  LBlock,
  LBlockContainer,
  LBlockLevel,
  LDocument,
  LFloat,
  LFootnote,
  LInlineLevel,
  LMarker,
  LRuby,
  LTable,
  LTableCell,
  LTableRow,
  LTateChuYoko,
  PageMaster,
} from './types';
import { mm } from './units';

export const SERIF = 'Noto Serif JP';
export const SANS = 'Noto Sans JP';

const ruby = (baseText: string, rubyText: string): LRuby => ({ type: 'ruby', baseText, rubyText });
const tcy = (text: string): LTateChuYoko => ({ type: 'tate-chu-yoko', text });
const hl = (children: LInlineLevel[], backgroundColor = '#fff2a8'): LInlineLevel => ({ type: 'inline', children, backgroundColor });
const bold = (children: LInlineLevel[], color?: string): LInlineLevel => ({ type: 'inline', fontFamily: SANS, fontWeight: 700, color, children });
const note = (text: string): LFootnote => ({ type: 'footnote', children: [text] });
const section = (name: string): LMarker => ({ type: 'marker', className: 'section', children: [' ｜ ', name] });
const p = (children: LInlineLevel[], extra: Partial<LBlock> = {}): LBlock => ({ type: 'block', children, ...extra });

const BLEED = 3;
const A4 = (margins: PageMaster['margins']): PageMaster => ({
  width: 210,
  height: 297,
  bleed: BLEED,
  trimMarks: true,
  trimMarkMargin: 10,
  margins,
  backgroundColor: '#fbf8f1',
});

/** 全ページ共通の絶対配置 (仕上がり左上基準, pt)。背景は塗り足しまで届く */
function staticContent(title: string, footer = '— {pageNumber} / {totalPages} —'): LBlockContainer[] {
  const W = mm(210);
  const b = mm(BLEED);
  return [
    {
      type: 'block-container',
      id: 'header-band',
      absolutePosition: true,
      writingMode: 'horizontal-tb',
      top: -b,
      left: -b,
      width: W + b * 2,
      height: mm(24) + b,
      boxSizing: 'border-box',
      backgroundColor: 'cmyk(100%,70%,0%,45%)',
      padding: { top: mm(11) + b, left: mm(18) + b, right: mm(18) + b },
      fontFamily: SANS,
      fontWeight: 700,
      fontSize: 12,
      color: '#ffffff',
      textAlign: 'start',
      letterSpacing: 1.5,
      // 現在の節名 (fo:marker 'section') を取り出して添える。このページで始まる最初の節、無ければ前ページからの持ち越し
      children: [{ type: 'block', children: [title, { type: 'retrieve-marker', className: 'section', position: 'first-including-carryover' }] }],
    },
    {
      type: 'block-container',
      id: 'header-rule',
      absolutePosition: true,
      writingMode: 'horizontal-tb',
      top: mm(24),
      left: -b,
      width: W + b * 2,
      height: mm(1.2),
      backgroundColor: '#e9b44c',
      children: [],
    },
    {
      type: 'block-container',
      id: 'footer-band',
      absolutePosition: true,
      writingMode: 'horizontal-tb',
      bottom: -b,
      left: -b,
      width: W + b * 2,
      height: mm(13) + b,
      boxSizing: 'border-box',
      backgroundColor: '#efe4c8',
      padding: { top: mm(4) },
      fontFamily: SANS,
      fontSize: 8.5,
      color: '#5b4a1f',
      textAlign: 'center',
      children: [{ type: 'block', children: [footer] }],
    },
  ];
}

// ───────────────────────── Seq.1 縦書き ─────────────────────────

const noteBox: LBlock = {
  type: 'block',
  id: 'note',
  margin: { left: 12, right: 12 },
  padding: 9,
  backgroundColor: '#fdf1c9',
  border: { width: 1, color: '#c28b00' },
  fontSize: 10,
  children: [
    bold(['組木のこころ　']),
    '釘を使わず、',
    ruby('寸分', 'すんぶん'),
    'の狂いもなく木と木を噛み合わせる。ボックスの',
    ruby('余白', 'よはく'),
    'も、行間も、ルビの張り出しも、すべてを',
    hl(['数値で割り切って']),
    '組み上げるのが本エンジンの流儀である。このボックスが頁をまたぐ場合、枠線と余白は断片ごとに正しく切り取られる。',
  ],
};

function verticalTable(): LTable {
  const cell = (children: LInlineLevel[], extra: Partial<LTableCell> = {}): LTableCell => ({
    type: 'table-cell',
    padding: 4,
    border: { left: { width: 0.6, color: '#555' }, bottom: { width: 0.6, color: '#555' } },
    children,
    ...extra,
  });
  const row = (cells: LTableCell[]): LTableRow => ({ type: 'table-row', cells });
  return {
    type: 'table',
    id: 'vtable',
    margin: { left: 14, right: 6 },
    border: { top: { width: 0.6, color: '#555' }, right: { width: 0.6, color: '#555' } },
    fontSize: 10,
    columns: [{ type: 'table-column', width: 90 }, { type: 'table-column', width: '1*' }, { type: 'table-column', width: 70 }],
    body: {
      type: 'table-body',
      rows: [
        row([
          cell([bold(['項目'])], { backgroundColor: '#e8eef7' }),
          cell([bold(['内容'])], { backgroundColor: '#e8eef7' }),
          cell([bold(['備考'])], { backgroundColor: '#e8eef7' }),
        ]),
        row([cell(['判型']), cell(['A4（', tcy('210'), '×', tcy('297'), 'mm）']), cell([ruby('仕上', 'しあが'), 'り'])]),
        row([cell(['塗り足し']), cell([tcy('3'), 'mm を四方に確保し、背景色はここまで届かせる。']), cell(['必須'])]),
        row([cell(['トンボ']), cell(['コーナーとセンターの実線トンボを出力。']), cell(['任意'])]),
        row([cell(['書字方向']), cell(['縦書き（右から左へ行を積む）。']), cell(['', tcy('JIS'), ' X ', tcy('4051')])]),
        row([cell(['ルビ']), cell(['親文字と均等割りで配置。']), cell(['行間を調整'])]),
        row([cell(['脚注']), cell(['本文領域の左端へ縦組み。']), cell(['自動連番'])]),
        row([cell(['回り込み']), cell(['行ごとに幅を変える。']), cell(['float'])]),
      ],
    },
  };
}

/** 縦書きの float: inline 始端 = 上端。幅 (縦方向の長さ) は height で指定 */
const verticalFloat: LFloat = {
  type: 'float',
  float: 'start',
  height: 110,
  width: 46,
  margin: { bottom: 8, left: 6 },
  padding: 5,
  border: { width: 0.8, color: '#c28b00' },
  backgroundColor: '#fdf1c9',
  fontFamily: SANS,
  fontSize: 9,
  textAlign: 'start',
  children: [{ type: 'block', children: ['図１　縦書きの回り込み。上端に寄せ、続く本文が下へ回り込む。'] }],
};

const vertical: LBlockLevel[] = [
  {
    type: 'block',
    id: 'v-title',
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: 24,
    lineHeight: 1.4,
    color: '#1b3a5c',
    textAlign: 'start',
    padding: { left: 6 },
    margin: { left: 16 },
    border: { left: { width: 2, color: '#e9b44c' } },
    children: [section('縦書きの美学'), ruby('組み織り', 'くみおり'), '　— 縦書きの美学'],
  },
  p(
    [
      '　',
      ruby('組版', 'くみはん'),
      'とは、文字という小さな部品を、',
      ruby('正確', 'せいかく'),
      'な座標のうえに',
      ruby('組', 'く'),
      'み上げていく仕事である。',
      tcy('2026'),
      '年',
      tcy('10'),
      '月',
      tcy('28'),
      '日、ブラウザ上で動く新しい組版エンジン「',
      bold(['Kumiori']),
      '」が、',
      ruby('商業印刷', 'しょうぎょういんさつ'),
      'の水準をめざして',
      ruby('産声', 'うぶごえ'),
      'をあげた。',
    ],
    { textIndent: 0 },
  ),
  p([
    '　入力は、扱いやすい',
    bold(['JSON']),
    'の論理ツリー。内部では、',
    ruby('領域', 'りょういき'),
    'モデル（Area Model）',
    note('Area Model は XSL-FO 1.1 の領域モデル。ブロック・行・インラインなどの領域を入れ子にして、寸法と位置を表す。'),
    'に従って、ブロック・行・インライン・',
    ruby('文字', 'もじ'),
    'の一つひとつを',
    hl(['ミリ単位の精度']),
    'で計算し、物理ツリーへと組み上げる。縦書きでは、行は右から左へ、文字は上から下へ流れ、',
    tcy('!!'),
    'のような記号や、欧文の「Typesetting」は横に倒れて、あるいは',
    ruby('縦中横', 'たてちゅうよこ'),
    'として一文字分の枠に収まる。',
  ]),
  p([
    '　行頭に閉じ括弧や句読点が来てはならず、行末に開き括弧を残してもならない。これが',
    ruby('禁則処理', 'きんそくしょり'),
    note('日本語組版の決まりで、行頭・行末に置いてはならない文字の規則。'),
    'である。「そのとき、行は押し出され、あるいは句点だけが版面の外にぶら下がる」。これらも、',
    'エンジンは当たり前のように、静かにこなしていく。',
    ruby('吾輩', 'わがはい'),
    'は猫である。名前はまだ無い。どこで生れたかとんと',
    ruby('見当', 'けんとう'),
    'がつかぬ。',
  ]),
  noteBox,
  verticalFloat,
  p([
    '　ルビの付いた行は、隣り合う行との',
    ruby('行間', 'ぎょうかん'),
    'を自動的に広げる。親文字がルビより短ければ親文字を、ルビが長ければルビを均等に割り付けて、全体の幅を決める。',
    '漢字かなまじりの文章が、紙の上でほどよい呼吸をするための、ささやかな調整だ。',
  ]),
  {
    type: 'block',
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: 13,
    color: '#1b3a5c',
    margin: { left: 8 },
    children: [section('表組み（縦書き）'), '表組み'],
  },
  p([
    '　次の表は、縦書きの文書に挿入された表組みである。行は右から左へ積まれ、セルは上から下へ並ぶ。罫線と背景は、行の高さ（ここでは幅）に合わせて揃えられる。',
  ]),
  verticalTable(),
  p([
    '　頁がいっぱいになれば、エンジンは新しい頁を起こして続きを組む。本文の',
    ruby('流', 'なが'),
    'れは途切れることなく、次の頁の右端から再開される。ここまでが縦書きの章である。次の頁からは、横書きの',
    ruby('表組', 'ひょうぐ'),
    'みの章に入る。',
    '最後の行がページの末尾にひとりぼっちで残らないよう、widows と orphans も考慮している。' +
      '句読点、括弧、小書きの仮名（ゃゅょっ）、長音（ー）もきちんと処理される。',
  ]),
  p(
    [
      '　',
      ruby('春', 'はる'),
      'はあけぼの。やうやう白くなりゆく山ぎは、少しあかりて、紫だちたる雲のほそくたなびきたる。',
      '夏は夜。月のころはさらなり、闇もなほ、蛍のおほく飛びちがひたる。また、ただ一つ二つなど、ほのかにうち光りて行くもをかし。雨など降るもをかし。',
      '秋は夕暮れ。夕日のさして山の端いと近うなりたるに、烏の寝どころへ行くとて、三つ四つ、二つ三つなど飛び急ぐさへあはれなり。',
      'まいて雁などの連ねたるが、いと小さく見ゆるはいとをかし。日入り果てて、風の音、虫の音など、はたいふべきにあらず。',
      '冬はつとめて。雪の降りたるはいふべきにもあらず、霜のいと白きも、またさらでもいと寒きに、火など急ぎおこして、炭持て渡るもいとつきづきし。',
    ],
    { fontSize: 11 },
  ),
];

// ───────────────────────── Seq.2 横書き + 表 ─────────────────────────

function bigTable(): LTable {
  const border = { bottom: { width: 0.5, color: '#8a8a8a' }, right: { width: 0.5, color: '#8a8a8a' } };
  const cell = (children: Array<LInlineLevel | LBlock>, extra: Partial<LTableCell> = {}): LTableCell => ({
    type: 'table-cell',
    padding: { top: 3, bottom: 3, left: 5, right: 5 },
    border,
    children,
    ...extra,
  });
  const head = (t: string): LTableCell =>
    cell([t], { backgroundColor: 'cmyk(100%,70%,0%,45%)', color: '#ffffff', fontFamily: SANS, fontWeight: 700, textAlign: 'center' });
  const items = ['檜', '杉', '欅', '楢', '栗', '桜', '樫', '桐', '松', '栂', '槙', '榧'];
  const rows: LTableRow[] = [];
  for (let k = 0; k < 38; k++) {
    const bg = k % 2 ? '#f3ecd8' : undefined;
    const name = items[k % items.length];
    const long = k % 7 === 3;
    rows.push({
      type: 'table-row',
      cells: [
        cell([String(k + 1)], { backgroundColor: bg, textAlign: 'end' }),
        cell([ruby(name, ['ひのき', 'すぎ', 'けやき', 'なら', 'くり', 'さくら', 'かし', 'きり', 'まつ', 'とが', 'まき', 'かや'][k % items.length]), `材 ${String.fromCharCode(65 + (k % 26))}-${100 + k}`], { backgroundColor: bg }),
        cell([`${(k * 7) % 40 + 5} 本`], { backgroundColor: bg, textAlign: 'end' }),
        cell([`¥${((k * 1370) % 9000 + 1200).toLocaleString('en-US')}`], { backgroundColor: bg, textAlign: 'end' }),
        cell(
          [
            long
              ? '桟（さん）の仕口は、蟻継ぎと鎌継ぎを併用する。乾燥は天然乾燥で十二か月以上、含水率十五パーセント以下を確認のこと。複数行になるセルがあっても行高は最大のセルに揃う。'
              : k % 5 === 0
                ? '特選。木目が通り、節が少ない。'
                : '標準。',
          ],
          { backgroundColor: bg, textAlign: 'start' },
        ),
      ],
    });
  }
  // 結合セルの行
  rows.splice(10, 0, {
    type: 'table-row',
    cells: [cell([bold(['— 中間集計（colSpan = 5）—'])], { colSpan: 5, backgroundColor: '#dfe9d0', textAlign: 'center' })],
  });
  return {
    type: 'table',
    id: 'bigtable',
    fontSize: 9.5,
    lineHeight: 1.5,
    textAlign: 'start',
    border: { top: { width: 0.8, color: '#8a8a8a' }, left: { width: 0.8, color: '#8a8a8a' } },
    columns: [
      { type: 'table-column', width: 30 },
      { type: 'table-column', width: '2*' },
      { type: 'table-column', width: '1*' },
      { type: 'table-column', width: '1.2*' },
      { type: 'table-column', width: '3*' },
    ],
    header: { type: 'table-body', rows: [{ type: 'table-row', cells: [head('№'), head('品名'), head('数量'), head('単価'), head('備考')] }] },
    body: { type: 'table-body', rows },
  };
}

/** float (回り込み) の例: 左に図、右へ本文が回り込む。図の下では元の幅に戻る */
function floatDemo(): LBlockLevel[] {
  const figure: LFloat = {
    type: 'float',
    float: 'start',
    width: 96,
    height: 74,
    margin: { right: 12, bottom: 4 },
    padding: 6,
    border: { width: 0.8, color: '#c28b00' },
    backgroundColor: '#fdf1c9',
    fontFamily: SANS,
    fontSize: 8.5,
    textAlign: 'start',
    children: [bold(['図1　蟻継ぎ']), { type: 'block', margin: { top: 4 }, children: ['楔形の突起と溝を噛み合わせ、引き抜きに強い継手とする。'] }],
  };
  return [
    figure,
    {
      type: 'block',
      fontSize: 10.5,
      margin: { bottom: 10 },
      children: [
        '回り込み（float）の例。図は本文領域の始端に寄せられ、続く本文は図の右側へ回り込む。',
        '行ごとに使える幅が変わるので、図と重なる行だけが始端を進めて幅を縮め、図の下端を過ぎた行は元の幅に戻る。',
        '禁則処理・ぶら下げ・ルビも、縮んだ幅の行で通常どおり働く。組木の継手には、',
        ruby('蟻継', 'ありつ'),
        'ぎ、',
        ruby('鎌継', 'かまつ'),
        'ぎ、',
        ruby('追掛大栓継', 'おいかけだいせんつ'),
        'ぎなどがあり、いずれも釘や接着剤を使わず、木の形だけで部材をつなぐ。',
      ],
    },
  ];
}

/** rowSpan / colSpan の例 */
function spanTable(): LTable {
  const border = { bottom: { width: 0.5, color: '#8a8a8a' }, right: { width: 0.5, color: '#8a8a8a' } };
  const cell = (children: LInlineLevel[], extra: Partial<LTableCell> = {}): LTableCell => ({
    type: 'table-cell',
    padding: { top: 3, bottom: 3, left: 5, right: 5 },
    border,
    children,
    ...extra,
  });
  const row = (cells: LTableCell[]): LTableRow => ({ type: 'table-row', cells });
  return {
    type: 'table',
    id: 'spantable',
    margin: { top: 12 },
    fontSize: 9.5,
    textAlign: 'start',
    border: { top: { width: 0.8, color: '#8a8a8a' }, left: { width: 0.8, color: '#8a8a8a' } },
    columns: [{ type: 'table-column', width: 70 }, { type: 'table-column', width: '1*' }, { type: 'table-column', width: '2*' }],
    header: {
      type: 'table-body',
      rows: [row([cell([bold(['区分'])], { backgroundColor: '#e8eef7' }), cell([bold(['樹種'])], { backgroundColor: '#e8eef7' }), cell([bold(['用途'])], { backgroundColor: '#e8eef7' })])],
    },
    body: {
      type: 'table-body',
      rows: [
        row([cell([bold(['広葉樹'])], { rowSpan: 3, backgroundColor: '#dfe9d0' }), cell(['欅']), cell(['柱・梁。木目が美しく、狂いが少ない。'])]),
        row([cell(['楢']), cell(['家具・床材。硬く、摩耗に強い。'])]),
        row([cell(['桜']), cell(['建具・彫刻。加工しやすく、肌合いがよい。'])]),
        row([cell([bold(['針葉樹'])], { rowSpan: 2, backgroundColor: '#f3ecd8' }), cell(['檜']), cell(['社寺建築。香りが良く、耐久性に優れる。'])]),
        row([cell(['杉']), cell(['板・樽。軽くて柔らかく、加工が容易。'])]),
      ],
    },
  };
}

/** fo:leader の例 (目次) */
function tocBlocks(): LBlockLevel[] {
  const line = (title: LInlineLevel[], page: string, pattern: 'dots' | 'rule' = 'dots'): LBlock => ({
    type: 'block',
    fontSize: 10.5,
    margin: { bottom: 2 },
    children: [...title, { type: 'leader', pattern, ruleThickness: 0.4, color: '#8a8a8a' }, page],
  });
  return [
    {
      type: 'block',
      fontFamily: SANS,
      fontWeight: 700,
      fontSize: 13,
      color: '#1b3a5c',
      margin: { top: 14, bottom: 6 },
      keepTogether: true,
      children: [section('目次'), '目次（fo:leader）'],
    },
    line([ruby('組み織り', 'くみおり'), 'の流儀'], '1'),
    line(['縦書きの美学'], '2'),
    line(['表組み — 行単位のページまたぎ'], '3'),
    line(['罫線リーダーの例'], '5', 'rule'),
  ];
}

const horizontalFlow: LBlockLevel[] = [
  {
    type: 'block-container',
    id: 'v-caption',
    absolutePosition: true,
    writingMode: 'vertical-rl',
    top: mm(40),
    left: mm(210 - 17),
    width: mm(12),
    height: mm(70),
    padding: 3,
    border: { width: 0.8, color: '#c28b00' },
    backgroundColor: '#fdf1c9',
    fontFamily: SANS,
    fontSize: 9,
    textAlign: 'start',
    children: [{ type: 'block', children: ['絶対配置・', ruby('縦書', 'たてが'), 'きコンテナ'] }],
  },
  {
    type: 'block',
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: 20,
    color: '#1b3a5c',
    margin: { bottom: 8 },
    border: { bottom: { width: 1.5, color: '#e9b44c' } },
    padding: { bottom: 4 },
    children: [section('表組みとページまたぎ'), '表組み — 行単位のページまたぎ'],
  },
  {
    type: 'block',
    fontSize: 10.5,
    margin: { bottom: 10 },
    children: [
      '以下の表は、ヘッダ行を持ち、複数ページにまたがる。行は途中で分割されず、収まらない行は次のページへ送られ、',
      '各ページの先頭にはヘッダ行が自動的に複製される。列幅は固定値と比例値（',
      hl(['2*']),
      '、',
      hl(['3*']),
      'など）の混在で決まり、行の高さは行内で最も背の高いセルに揃う。',
      note('比例値 N* は、固定値を引いた残りの幅を N の比で按分する (XSL-FO の proportional-column-width に相当)。'),
    ],
  },
  ...floatDemo(),
  bigTable(),
  spanTable(),
  ...tocBlocks(),
  {
    type: 'block',
    fontSize: 10.5,
    margin: { top: 12 },
    children: ['表の後続の本文は、最後の行の直後から再開される。ここで本サンプルは終了となる。'],
  },
];

const columnsFlow: LBlockLevel[] = [
  { type: 'block', span: 'all', fontFamily: SANS, fontWeight: 700, fontSize: 20, textAlign: 'start', margin: { top: 0, right: 0, bottom: 10, left: 0 }, children: ['二段組と段抜き見出し'] },
  ...[
    '段組では、本文領域を複数の段に分け、段が埋まると隣の段へ、最後の段が埋まると次のページへ流れます。段の幅は、本文幅から段間を引いて等分して決まります。',
    '見出しのように、全段を貫くブロック（span="all"）を置くこともできます。その直前までの本文は、段の高さを釣り合わせて、短い方の段が極端に空かないようにします。',
    '釣り合わせは、最後のページの段の高さを二分探索で縮めながら試し組みし、同じページに収まる最小の高さを採用する方法で行っています。',
  ].map((t) => p([t], { textAlign: 'justify', textIndent: 10.5, margin: { top: 0, right: 0, bottom: 4, left: 0 } })),
  { type: 'block', span: 'all', fontFamily: SANS, fontWeight: 700, fontSize: 14, textAlign: 'start', margin: { top: 6, right: 0, bottom: 6, left: 0 }, children: ['段抜き見出しの後ろ'] },
  ...Array.from({ length: 14 }, (_, i) =>
    p([`第${i + 1}段落。縦横どちらの書字方向でも、段は行の方向（inline 方向）に並びます。ここは本文だけの段落です。`], { textAlign: 'justify', textIndent: 10.5, margin: { top: 0, right: 0, bottom: 4, left: 0 } }),
  ),
];

export function buildSampleDocument(): LDocument {
  const vMaster = A4({ top: 34, right: 18, bottom: 24, left: 18 });
  // 横書き章: 奇数/偶数でミラー余白 (本文幅は同じ)、先頭ページだけ天を 10mm 広く取る
  const hMaster = (top: number, left: number, right: number) => A4({ top, right, bottom: 24, left });
  const hTitle = 'KUMIORI 組み織り ｜ 表組み・ページまたぎ';
  return {
    type: 'document',
    title: 'Kumiori 組み織り サンプル',
    fontFamily: SERIF,
    fontSize: 10.5,
    sequences: [
      {
        type: 'page-sequence',
        master: vMaster,
        // 最終ページだけフッター文言を差し替え (条件付きページマスター: pagePosition = last)
        footnotes: { numberFormat: 'circled', separator: { length: 80, color: '#5b4a1f' } },
        masterAlternatives: [
          {
            when: { pagePosition: 'last' },
            master: vMaster,
            staticContent: staticContent('KUMIORI 組み織り ｜ 縦書き・ルビ・縦中横', '— {pageNumber} / {totalPages} ｜ 縦書きの章 終 —'),
          },
        ],
        staticContent: staticContent('KUMIORI 組み織り ｜ 縦書き・ルビ・縦中横'),
        flow: { type: 'flow', writingMode: 'vertical-rl', fontSize: 11, lineHeight: 1.8, children: vertical },
      },
      {
        type: 'page-sequence',
        master: hMaster(34, 20, 26),
        footnotes: { numberFormat: 'decimal', labelPrefix: '*', separator: { length: 120, color: '#5b4a1f' } },
        masterAlternatives: [
          // 先頭ページ (奇数): 天を広く
          { when: { pagePosition: 'first' }, master: hMaster(44, 20, 26) },
          { when: { oddOrEven: 'odd' }, master: hMaster(34, 20, 26) },
          { when: { oddOrEven: 'even' }, master: hMaster(34, 26, 20) },
        ],
        staticContent: staticContent(hTitle),
        flow: { type: 'flow', writingMode: 'horizontal-tb', children: horizontalFlow },
      },
      {
        type: 'page-sequence',
        master: { ...A4({ top: 34, right: 20, bottom: 24, left: 20 }), columns: { count: 2, gap: 8 } },
        staticContent: staticContent('KUMIORI 組み織り ｜ 段組'),
        flow: { type: 'flow', writingMode: 'horizontal-tb', children: columnsFlow },
      },
    ],
  };
}
