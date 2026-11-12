/**
 * eps — EPS (Encapsulated PostScript) の PostScript を実行し、描いたものを SVG にする。
 *
 * Encapsulated PostScript File Format Specification 3.0 (Adobe Technical Note #5002) の取り込みの取り決め (§3.2) に従う:
 *  save と restore で囲み、showpage を空にし、グラフィックス状態を初期値 (黒・線の太さ 1 など) にし、userdict を begin する。
 *  DOS 形式 (先頭が C5D0D3C6) は PostScript の部分だけを読む (§5.2 Table 1)。
 * 座標は %%HiResBoundingBox (無ければ %%BoundingBox) の範囲を SVG の viewBox にする (y は下向きに直す)。
 * 画像は PNG (JPEG はそのまま) の data: URI にして SVG の image に入れる。
 */
import { Interp, latin1 } from './psInterp';
import { Graphics, type Clip, type DisplayItem } from './psGraphics';
import { encodePng } from './pixels';
import { invert, type Matrix as Mat, type Seg } from './matrix';
import { base64 } from './base64';
import { PS_MAX_SVG_CHARS } from './imageLimits';

export interface EpsResult {
  svg: string;
  /** 外接矩形 (pt) */
  bbox: [number, number, number, number];
  /** 描いたものの数 */
  count: number;
  /** 描けなかったもの (模様・複合書体の文字など) */
  warnings: string[];
  /** 近似して描いたもの (代わりの書体など) */
  notes: string[];
  /** 途中で止まったときのエラー */
  error?: string;
}

/** EPS の PostScript の部分と外接矩形 */
export function epsProgram(b: Uint8Array): { ps: Uint8Array; bbox: [number, number, number, number] } | undefined {
  let ps = b;
  if (b[0] === 0xc5 && b[1] === 0xd0 && b[2] === 0xd3 && b[3] === 0xc6) {
    // DOS 形式の頭 (30 バイト。EPSF 3.0 §5.2 Table 1) の、PostScript の部分の位置と長さ (4〜11 バイト目) が無ければ読めない
    if (b.length < 12) return undefined;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const off = v.getUint32(4, true);
    const len = v.getUint32(8, true);
    ps = b.subarray(off, off + len);
  } else if (!(b[0] === 0x25 && b[1] === 0x21)) return undefined;
  const bbox = epsBoundingBox(new TextDecoder('latin1').decode(ps.subarray(0, 64 * 1024)));
  if (!bbox) return undefined;
  if (!(bbox[2] > bbox[0] && bbox[3] > bbox[1])) return undefined;
  return { ps, bbox };
}

/** DSC の注釈の外接矩形 [x0, y0, x1, y1] (pt)。%%HiResBoundingBox を優先し、無ければ %%BoundingBox。どちらも無ければ undefined */
export function epsBoundingBox(head: string): [number, number, number, number] | undefined {
  const m = /%%HiResBoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(head) ?? /%%BoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(head);
  if (!m) return undefined;
  // 数として読めない値 (1.2.3 は NaN) と、有限でない値 (何百桁もの数は Infinity) の外接矩形は、無いものとして扱う (EPS として読まない)。
  // そのまま通すと、幅・高さが NaN・Infinity の画像になり、PDF を書く所で文書の全体が誤りになる
  const box = m.slice(1).map(Number) as [number, number, number, number];
  return box.every(Number.isFinite) ? box : undefined;
}

/** EPS を実行するときの上限 (どれも、超えたら PostScript のエラーで終わり、そこまでに描いたものを返す) */
export interface EpsLimits {
  /** 経過時間の上限 (ミリ秒)。既定は 20 秒 */
  maxMillis?: number;
  /** VM の使用量 (配列・文字列・辞書などの確保の合計。バイト) の上限。超えれば VMerror。既定は PS_MAX_VM_BYTES */
  maxVM?: number;
  /** パスの点の合計の上限。超えれば limitcheck。既定は PS_MAX_PATH_POINTS */
  maxPathPoints?: number;
  /** フィルタ (ReusableStreamDecode・DCTDecode) が元を読みためる量 (バイト) の上限。超えれば limitcheck。既定は PS_FILTER_MAX_BYTES */
  maxFilterBytes?: number;
  /**
   * メモリの合計 (VM・パスの点・描画の並び・画像を、実際に使う量に近いバイト数で 1 つの勘定に積んだもの) の上限。超えれば VMerror。
   * 既定は PS_MAX_MEMORY_BYTES (512MB)。ヒープの小さな環境では、これと maxSvgChars を下げる
   */
  maxMemory?: number;
  /**
   * SVG にした文字列の長さ (字) の上限 (epsToSvg だけ)。超えたら、そこまでに SVG にしたものを返し、error に limitcheck を入れる。
   * 既定は PS_MAX_SVG_CHARS (128MB)
   */
  maxSvgChars?: number;
  /** 文書あたりの時間の予算 (epsToSvg だけ)。残りが maxMillis より短ければ、残りを時間の上限にし、使った時間を引く。残りが無ければ実行しない */
  budget?: EpsBudget;
}

/**
 * 1 つの文書 (画像の登録の入れ物 1 つ。assets.ts の AssetStore) で、EPS を実行して SVG にする時間の合計の上限 (ミリ秒)。
 * EPS 1 つごとの上限 (20 秒・512MB) だけでは、名前を変えて同じ EPS を何個も参照する文書 (8 個で 280 秒を超えた) が、個数の分だけ
 * 時間を使う。実在の EPS は 1 つが数十〜数百ミリ秒 (見本の docs/conformance の EPS は、どれも 1 秒未満) なので、60 秒は数百個の図を
 * 持つ文書でも届かない。使い切ったら、残りの EPS は実行しない (epsToSvg が undefined を返し、プレビューがあればプレビューで、
 * 無ければ描けない画像として警告に出す)
 */
export const EPS_DOCUMENT_MILLIS = 60_000;

/** 文書あたりの EPS の時間の予算 (EPS_DOCUMENT_MILLIS の説明) */
export class EpsBudget {
  constructor(public millisLeft = EPS_DOCUMENT_MILLIS) {}
}
const budgets = new WeakMap<object, EpsBudget>();
/**
 * 予算を初めの値に戻す。画面 (main.ts) は、画像の入れ物を 1 つだけ作り、別の文書を開いても使い続ける (前に読んだ画像を残す) ので、
 * 文書を開くたびに戻す (戻さないと、「文書あたり」の予算が「画面を開いている間の合計」になり、重い EPS を何度か開いた後は、どの EPS も描けなくなる)
 */
export function resetEpsBudget(owner: object): void {
  budgets.delete(owner);
}
/** 文書 (画像の登録の入れ物など、文書ごとに 1 つのもの) に結び付けた予算。初めて引いたときに作る */
export function epsBudgetOf(owner: object): EpsBudget {
  let b = budgets.get(owner);
  if (!b) budgets.set(owner, (b = new EpsBudget()));
  return b;
}

/** EPS を実行して、描いたものを返す */
export function runEps(
  b: Uint8Array,
  opts: EpsLimits = {},
): { items: DisplayItem[]; bbox: [number, number, number, number]; warnings: string[]; notes: string[]; error?: string } | undefined {
  const prog = epsProgram(b);
  if (!prog) return undefined;
  const I = new Interp({ maxMillis: opts.maxMillis ?? 20_000, maxVM: opts.maxVM, maxFilterBytes: opts.maxFilterBytes, maxMemory: opts.maxMemory });
  const G = new Graphics(I, { bbox: prog.bbox, maxPathPoints: opts.maxPathPoints });
  // EPSF 3.0 §3.2: save で囲み、userdict を begin し、showpage を空にする (グラフィックス状態は初期値)
  const head = latin1('save userdict begin /showpage {} def 0 setgray 0 setlinecap 1 setlinewidth 0 setlinejoin 10 setmiterlimit [] 0 setdash newpath\n');
  const err0 = I.run(head);
  const error = I.run(prog.ps);
  return { items: G.items, bbox: prog.bbox, warnings: [...I.warnings], notes: [...I.notes], error: err0 ?? error };
}

const f = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const hex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
/** 色: RGB の属性と、CMYK で決まる色なら CMYK の値の属性 (Kumiori は PDF に DeviceCMYK で描く。ブラウザは RGB で描く) */
const paint = (what: 'fill' | 'stroke', rgb: [number, number, number], cmyk?: number[]) => `${what}="${hex(rgb)}"${cmyk ? ` data-${what}-cmyk="${cmyk.map(f).join(' ')}"` : ''}`;

function pathData(segs: Seg[], m?: Mat): string {
  const t = (x: number, y: number) => (m ? [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] : [x, y]);
  let d = '';
  for (const s of segs) {
    if (s.op === 'Z') d += 'Z';
    else if (s.op === 'C') {
      const [a, b] = t(s.x1, s.y1);
      const [c, e] = t(s.x2, s.y2);
      const [g, h] = t(s.x, s.y);
      d += `C${f(a)} ${f(b)} ${f(c)} ${f(e)} ${f(g)} ${f(h)}`;
    } else {
      const [x, y] = t(s.x, s.y);
      d += `${s.op}${f(x)} ${f(y)}`;
    }
  }
  return d;
}

const xmlText = (t: string) => t.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;')).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** PostScript の書体の名前から、SVG の font-family (系統) と太さ・斜体を決める */
export function fontFamilyOf(psName: string): { family: string; bold: boolean; italic: boolean } {
  const n = psName.replace(/^[A-Z]{6}\+/, '');
  const bold = /Bold|Black|Heavy|Demi|W[6-9]\b|-B\b/i.test(n);
  const italic = /Italic|Oblique/i.test(n);
  let family = 'sans-serif';
  if (/Courier|Mono|Consol/i.test(n)) family = 'monospace';
  else if (/Times|Roman|Serif|Garamond|Century|Minion|Georgia|Mincho|Ryumin|Ming|明朝/i.test(n) && !/Sans/i.test(n)) family = 'serif';
  else if (/Symbol/i.test(n)) family = 'serif';
  return { family, bold, italic };
}

/**
 * SVG の断片をためる。短い断片を 1 つずつ配列に持つと、断片ごとの入れ物で文字の何倍ものメモリを使う (900 万個の断片で 1GB を超えた) ので、
 * 64KB たまるごとに 1 つの文字列にまとめる
 */
class Pieces {
  private chunks: string[] = [];
  private buf: string[] = [];
  private n = 0;
  push(piece: string) {
    this.buf.push(piece);
    this.n += piece.length;
    if (this.n >= 65536) this.flush();
  }
  private flush() {
    if (this.buf.length) this.chunks.push(this.buf.join(''));
    this.buf = [];
    this.n = 0;
  }
  get empty(): boolean {
    return !this.chunks.length && !this.buf.length;
  }
  join(): string {
    this.flush();
    return this.chunks.join('');
  }
}

/** EPS を SVG にする。読めない EPS なら undefined */
export async function epsToSvg(b: Uint8Array, opts: EpsLimits = {}): Promise<EpsResult | undefined> {
  const budget = opts.budget;
  if (!budget) return epsToSvg1(b, opts);
  if (!(budget.millisLeft > 0) || !epsProgram(b)) return undefined;
  const t0 = Date.now();
  try {
    return await epsToSvg1(b, { ...opts, maxMillis: Math.min(opts.maxMillis ?? 20_000, budget.millisLeft) });
  } finally {
    // 実行の後の SVG にする時間も引く
    budget.millisLeft -= Date.now() - t0;
  }
}

async function epsToSvg1(b: Uint8Array, opts: EpsLimits): Promise<EpsResult | undefined> {
  const r = runEps(b, opts);
  if (!r) return undefined;
  const [x0, y0, x1, y1] = r.bbox;
  const W = x1 - x0;
  const H = y1 - y0;
  const defs = new Pieces();
  const body = new Pieces();
  // 出力の長さを数える (PS_MAX_SVG_CHARS の説明)。上限を超える断片は足さずに、そこで止める
  const maxChars = opts.maxSvgChars ?? PS_MAX_SVG_CHARS;
  let chars = 0;
  const TOO_LONG = new Error('svg too long');
  const emit = (to: Pieces, piece: string) => {
    chars += piece.length;
    if (chars > maxChars) throw TOO_LONG;
    to.push(piece);
  };
  let tooLong = false;
  // 画素を共有する画像 (模様の写しは、模様の絵の画像の画素を共有する。psShading の moveItem) は、PNG に 1 度だけ圧縮して使い回す。
  // 前は写しごとに圧縮し直し、2,500 万画素の画像の写しの数だけ、数秒ずつかかった。覚えるのは共有されている画素だけ (最後の写しで手放す)
  const shared = new Map<Uint8Array, number>();
  for (const it of r.items) if (it.k === 'image' && it.rgba) shared.set(it.rgba, (shared.get(it.rgba) ?? 0) + 1);
  const pngs = new Map<Uint8Array, Uint8Array>();
  const pngOf = async (rgba: Uint8Array, width: number, height: number): Promise<Uint8Array> => {
    const left = (shared.get(rgba) ?? 1) - 1;
    shared.set(rgba, left);
    let data = pngs.get(rgba);
    if (!data) {
      data = await encodePng({ width, height, rgba });
      if (left > 0) pngs.set(rgba, data);
    }
    if (left <= 0) {
      pngs.delete(rgba);
      shared.delete(rgba);
    }
    return data;
  };
  const clipIds = new Map<Clip, string>();
  const clipId = (c: Clip) => {
    let id = clipIds.get(c);
    if (!id) {
      id = `c${clipIds.size}`;
      emit(defs, `<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${pathData(c.segs)}" clip-rule="${c.evenOdd ? 'evenodd' : 'nonzero'}"/></clipPath>`);
      clipIds.set(c, id);
    }
    return id;
  };
  // 同じクリップの並びをまとめて、クリップの g で囲む (外側のクリップから)
  let curClip: Clip | undefined;
  let open = 0;
  const setClip = (c: Clip | undefined) => {
    if (c === curClip) return;
    for (; open > 0; open--) body.push('</g>');
    const chain: Clip[] = [];
    // 内側から外側へたどって、最後に逆順にする (unshift で前に足すと、クリップの入れ子の深さの 2 乗の手間になる)
    for (let k = c; k; k = k.parent) chain.push(k);
    chain.reverse();
    curClip = undefined;
    for (const k of chain) {
      // 閉じる </g> の分 (4 字) も数える
      chars += 4;
      emit(body, `<g clip-path="url(#${clipId(k)})">`);
      open++;
    }
    curClip = c;
  };
  try {
    for (const it of r.items) {
      setClip(it.clip);
      if (it.k === 'fill') emit(body, `<path d="${pathData(it.segs)}" ${paint('fill', it.color, it.cmyk)}${it.evenOdd ? ' fill-rule="evenodd"' : ''}/>`);
      else if (it.k === 'stroke') {
        // 線は、ユーザ空間の座標で CTM を掛けて描く (太さが CTM で変わる。§4.5.1)
        const inv = invert(it.ctm);
        const m = it.ctm;
        const lw = it.lineWidth === 0 ? 0.25 / Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]) || 1) : it.lineWidth;
        const attrs = [
          `fill="none"`,
          paint('stroke', it.color, it.cmyk),
          `stroke-width="${f(lw)}"`,
          it.cap ? `stroke-linecap="${it.cap === 1 ? 'round' : 'square'}"` : '',
          it.join ? `stroke-linejoin="${it.join === 1 ? 'round' : 'bevel'}"` : '',
          `stroke-miterlimit="${f(it.miter)}"`,
          it.dash ? `stroke-dasharray="${it.dash.array.map(f).join(' ')}" stroke-dashoffset="${f(it.dash.offset)}"` : '',
        ]
          .filter(Boolean)
          .join(' ');
        if (inv) emit(body, `<path transform="matrix(${m.map(f).join(' ')})" d="${pathData(it.segs, inv)}" ${attrs}/>`);
        else emit(body, `<path d="${pathData(it.segs)}" ${attrs}/>`);
      } else if (it.k === 'text') {
        // 文字: SVG の text (字の空間は y 下向きなので、y を反転してから文字の空間の行列を掛ける)
        const m = it.mat;
        const fam = fontFamilyOf(it.fontName);
        emit(body, 
          `<text transform="matrix(${[m[0], m[1], -m[2], -m[3], m[4], m[5]].map(f).join(' ')})" font-family="${fam.family}" font-size="1"${fam.bold ? ' font-weight="bold"' : ''}${fam.italic ? ' font-style="italic"' : ''} ${paint('fill', it.color, it.cmyk)} xml:space="preserve">${xmlText(it.text)}</text>`,
        );
      } else if (it.k === 'image') {
        // base64 にする前に長さを確かめる (上限を超える画像を、文字列にしない)
        const data = it.jpeg ?? (await pngOf(it.rgba!, it.width, it.height));
        if (chars + Math.ceil(data.length / 3) * 4 > maxChars) throw TOO_LONG;
        const uri = `data:image/${it.jpeg ? 'jpeg' : 'png'};base64,${base64(data)}`;
        // 画素は、SVG にしたら手放す (描画の並びはこの関数の中だけのもの。画像の多い絵で、画素と PNG を 2 重に持ち続けない)
        it.rgba = undefined;
        emit(body, 
          `<image x="0" y="0" width="${it.width}" height="${it.height}" preserveAspectRatio="none" transform="matrix(${it.mat.map(f).join(' ')})"${it.interpolate ? '' : ' style="image-rendering:optimizeSpeed"'} href="${uri}"/>`,
        );
      }
    }
  } catch (e) {
    if (e !== TOO_LONG) throw e;
    tooLong = true;
  }
  // 開いたままのクリップの g を閉じる
  for (; open > 0; open--) body.push('</g>');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${f(W)}pt" height="${f(H)}pt" viewBox="0 0 ${f(W)} ${f(H)}" preserveAspectRatio="none">` +
    (defs.empty ? '' : `<defs>${defs.join()}</defs>`) +
    `<g transform="matrix(1 0 0 -1 ${f(-x0)} ${f(y1)})">${body.join()}</g></svg>`;
  // SVG が上限を超えたときは、PostScript の実装の限界のエラーの名前で知らせる (PLRM 付録 B: 限界を超える操作は limitcheck)
  return { svg, bbox: r.bbox, count: r.items.length, warnings: r.warnings, notes: r.notes, error: r.error ?? (tooLong ? 'limitcheck (SVG の出力が長すぎます)' : undefined) };
}
