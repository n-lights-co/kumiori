/**
 * drawioStencil — draw.io の図形ライブラリ (ステンシル。mxgraph.* の名前の形と、style に埋め込んだ stencil(…)) を読んで、SVG にする。
 *
 * 根拠: 公開の仕様書が無いので、mxGraph と draw.io の公開のソース (Apache License 2.0) に合わせる (CLAUDE.md の「他の組版ソフトの拡張」と同じ扱い)。
 *   - 形の命令 (<shape> の <background>・<foreground> の中の path・rect・fillstroke など) と、座標の写し方: mxGraph の mxStencil
 *     (drawShape・computeAspect・drawNode)
 *   - 形の名前から読むファイル: draw.io の mxStencilRegistry (Graph.js の getBasenameForStencil と getStencil。
 *     mxgraph.<名前>.… は stencils/<名前>.xml。名前ごとに別のファイルを読むものは App.js の mxStencilRegistry.libraries の表)
 *   - ライブラリの名前の付け方: draw.io の mxStencilRegistry.parseStencilSet (<shapes name="パッケージ"> + "." + 形の名前を小文字にし、空白を _ に)
 *   - 配布物 js/stencils.min.js の中身: f['<ファイル>.xml'] = '<base64>' の並び。base64 を戻して deflate (頭の無い形) を解くと、
 *     2 進の形 (5 つの流れ: 命令・x・y・そのほかの数・文字。数はジグザグの可変長整数の差分、値は 1000 倍の整数) か、
 *     古い版では XML の文字。読み方は stencils.min.js の decode に合わせた (実行はしない。データとして読む)
 * 図形ライブラリそのもの (draw.io の配布物) は、利用条件 (draw.io の stencils/LICENSE。取る版 v24.7.5 では CC BY 4.0) があり、Kumiori には入れない。
 * 利用者が渡すか、利用者が許したときだけネットワークから取る (TypesetOptions.drawio の stencils・fetchStencils。options.ts)。
 *
 * 描かないもの (警告に出す): JavaScript で書かれた形 (draw.io の shapes/*.js。ライブラリのファイルに無い形)、
 *   data: でない画像。text の localized (訳語の表) は読まず、str をそのまま描く
 *
 * 元のソースの表示 (Apache License 2.0 の 4 項 (b)・(c)): このファイルは、draw.io (https://github.com/jgraph/drawio。v32.6.10) の
 * 次のファイル (src/main/webapp/ の下) のコードを TypeScript に書き直したもの、またはその描き方に合わせたもの (上の根拠の部分)。
 * Kumiori のために変更している。元のファイルの著作権表示は、書き換えずに残す:
 *   js/diagramly/App.js: Copyright (c) 2006-2020, JGraph Holdings Ltd; Copyright (c) 2006-2020, draw.io AG
 *   js/grapheditor/Graph.js: Copyright (c) 2006-2012, JGraph Holdings Ltd
 *   mxgraph/src/shape/mxShape.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxStencil.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/shape/mxStencilRegistry.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxAbstractCanvas2D.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/util/mxConstants.js: Copyright (c) 2006-2026, JGraph Holdings Ltd; Copyright (c) 2006-2026, draw.io AG
 *   mxgraph/src/util/mxSvgCanvas2D.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 *   mxgraph/src/view/mxGraph.js: Copyright (c) 2006-2015, JGraph Holdings Ltd; Copyright (c) 2006-2015, draw.io AG
 * Licensed under the Apache License, Version 2.0 (Kumiori の LICENSE。THIRD_PARTY_NOTICES.md の 13 節)。
 */

import { inflateBytes } from './inflate';
import { msg } from './messages';
import { esc, f, kids, MAX_DEPTH, num, parseXml, type XEl } from './drawioXml';
import { XML_COMMENT } from './sniff';
import { rejoin, thisCall } from '../callContext';

/**
 * fetchStencils: true のときに取る、draw.io の配布物の図形ライブラリ (draw.io の公開のリポジトリの、版を決めたファイル。
 * draw.io が直しても結果が変わらないように、版を決める。版を上げるときは、その版の stencils.min.js の形 (decodeCompressed) を確かめる)。
 * 版は v24.7.5 (2024-07-25): v29.3.2 から、draw.io の stencils/・img/ の LICENSE に、Atlassian の製品に使うことの制限が付いた。
 * v24.7.5 の stencils/・img/ の LICENSE は Creative Commons Attribution 4.0 (CC BY 4.0) で、その制限が無い (THIRD_PARTY_NOTICES.md の 13.2 節)。
 * 配布物の画像 (drawioImageUrl) も、同じ版の場所から取る
 */
export const DRAWIO_STENCILS_URL = 'https://raw.githubusercontent.com/jgraph/drawio/v24.7.5/src/main/webapp/js/stencils.min.js';
/** 配布物 (draw.io の webapp) の中の、図形ライブラリのファイルの道 (drawio.fetchStencils の関数に渡す) */
export const DRAWIO_STENCILS_PATH = 'js/stencils.min.js';

/** 読む上限 (小さなファイルで大量のメモリ・時間を使わせない) */
const LIMITS = {
  /** 1 つのライブラリを戻した大きさ (バイト) */
  inflated: 64 << 20,
  /** 1 つのライブラリの XML の要素の数 */
  nodes: 4_000_000,
  /** 1 つの図で描く命令の数 (include-shape で何度も描く形を含む) */
  ops: 2_000_000,
  /** include-shape の入れ子の深さ */
  depth: 8,
};

/**
 * 名前ごとに別のファイルを読むライブラリ (draw.io の App.js の mxStencilRegistry.libraries のうち、XML のファイル。
 * 表に無い名前は「名前.xml」。空の並びは、JavaScript だけで書かれたライブラリ)
 */
const LIBRARY_FILES: Record<string, string[]> = {
  mockup: [],
  arrows2: [],
  bpmn2: ['bpmn.xml'],
  c4: [],
  cisco_safe: ['architecture', 'business_icons', 'capability', 'design', 'iot_things_icons', 'people_places_things_icons', 'security_icons', 'technology_icons', 'threat'].map((n) => `cisco_safe/${n}.xml`),
  dfd: [],
  er: [],
  kubernetes: ['kubernetes.xml', 'kubernetes2.xml'],
  ios: [],
  rackGeneral: ['rack/general.xml'],
  rackF5: ['rack/f5.xml'],
  ios7icons: ['ios7/icons.xml'],
  ios7ui: ['ios7/misc.xml'],
  android: ['android/android.xml'],
  infographic: [],
  'mockup/buttons': [],
  'mockup/containers': [],
  'mockup/forms': [],
  'mockup/graphics': ['mockup/misc.xml'],
  'mockup/markup': [],
  'mockup/navigation': ['mockup/misc.xml'],
  'mockup/text': [],
  ibmcloud: ['ibm_cloud.xml'],
  archimate: [],
  archimate4: [],
  archimate3: [],
  sysml: [],
  aws4b: ['aws4.xml'],
  uml25: [],
  veeam: ['veeam/2d.xml', 'veeam/3d.xml', 'veeam/veeam.xml'],
  veeam2: ['veeam/2d.xml', 'veeam/3d.xml', 'veeam/veeam2.xml'],
  pid2inst: [],
  pid2misc: ['pid/misc.xml'],
  pid2valves: [],
  pidFlowSensors: ['pid/flow_sensors.xml'],
  emoji: [],
};

/** 形の名前 (mxgraph.aws4.lambda) のライブラリの名前 (aws4。間の名前は / でつなぐ: mxgraph.electrical.abstract.x → electrical/abstract) */
export function libraryOf(shape: string): string | undefined {
  const parts = shape.split('.');
  if (parts.length < 3 || parts[0] !== 'mxgraph') return undefined;
  return parts.slice(1, -1).join('/');
}
/** ライブラリの名前から、読むファイル (stencils/ からの相対の名前) */
export function libraryFiles(lib: string): string[] {
  return Object.hasOwn(LIBRARY_FILES, lib) ? LIBRARY_FILES[lib] : [`${lib.replace('_-_', '_')}.xml`];
}

// ───────────── 配布物 (stencils.min.js) の 2 進の形 ─────────────

const DRAW = new Set(['move', 'line', 'quad', 'curve', 'arc', 'rect', 'roundrect', 'ellipse', 'text', 'image', 'include-shape']);
const XS = new Set(['x', 'x1', 'x2', 'x3']);
const YS = new Set(['y', 'y1', 'y2', 'y3']);

/** 2 進の形のライブラリを XML の木に戻す (読めなければ undefined。maxNodes: 要素の数の上限) */
function decodeBinary(d: Uint8Array, maxNodes = LIMITS.nodes): XEl | undefined {
  if (d.length < 20) return undefined;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const s: Uint8Array[] = [];
  for (let i = 0, o = 20; i < 5; i++) {
    const n = v.getUint32(4 * i);
    if (o + n > d.length) return undefined;
    s.push(d.subarray(o, o + n));
    o += n;
  }
  const ops = s[0];
  const strs = new TextDecoder().decode(s[4]).split('\0');
  const p = [0, 0, 0, 0];
  let si = 0;
  const names: string[] = [];
  const attrNames: string[] = [];
  const root: XEl = { name: '#root', attrs: new Map(), children: [], text: '' };
  const stack: XEl[] = [root];
  let px = 0;
  let py = 0;
  let pn = new Map<string, number>();
  const read = (k: number): number => {
    const bytes = s[k];
    let n = 0;
    let m = 1;
    let c: number;
    do {
      if (p[k] >= bytes.length) throw new Error('eof');
      c = bytes[p[k]++];
      n += (c & 127) * m;
      m *= 128;
    } while (c & 128 && m < 2 ** 53);
    return n % 2 === 1 ? -(n + 1) / 2 : n / 2;
  };
  const byte = () => {
    if (p[0] >= ops.length) throw new Error('eof');
    return ops[p[0]++];
  };
  try {
    let count = 0;
    while (p[0] < ops.length) {
      const op = byte();
      if (op === 255) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      if (++count > maxNodes) return undefined;
      if (op >> 1 === names.length) names.push(strs[si++] ?? '');
      const name = names[op >> 1];
      if (name === undefined) return undefined;
      const node: XEl = { name, attrs: new Map(), children: [], text: '' };
      const n = byte();
      const coords = DRAW.has(name);
      if (name === 'shape') {
        px = 0;
        py = 0;
        pn = new Map();
      }
      for (let i = 0; i < n; i++) {
        const id = byte();
        if (id === attrNames.length) attrNames.push(strs[si++] ?? '');
        const attr = attrNames[id];
        if (attr === undefined) return undefined;
        if (byte() === 0) node.attrs.set(attr, strs[si++] ?? '');
        else if (coords && XS.has(attr)) node.attrs.set(attr, String((px += read(1)) / 1000));
        else if (coords && YS.has(attr)) node.attrs.set(attr, String((py += read(2)) / 1000));
        else {
          const key = `${name} ${attr}`;
          const next = (pn.get(key) ?? 0) + read(3);
          pn.set(key, next);
          node.attrs.set(attr, String(next / 1000));
        }
      }
      // 深すぎる要素は木に入れない (drawioXml.ts の parseXml と同じ。MAX_DEPTH の説明)
      if (stack.length <= MAX_DEPTH) stack[stack.length - 1].children.push(node);
      // 命令の下位のビットが 0 なら、子を持つ要素 (後の要素は、255 までこの要素の子)
      if (!(op & 1)) stack.push(node);
    }
  } catch {
    return undefined;
  }
  return root.children[0];
}

/**
 * 圧縮した文字 (base64 の deflate) を、ライブラリの XML の木に戻す (2 進の形か、XML の文字)。
 * limit: 戻す大きさの上限、nodes: 要素の数の上限、stats: 戻したバイトの数を足す
 */
function decodeCompressed(b64: string, limit = LIMITS.inflated, nodes = LIMITS.nodes, stats?: { bytes: number }): XEl | undefined {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
  const d = inflateBytes(bytes, limit, stats);
  if (!d) return undefined;
  // 古い形: encodeURIComponent した XML か、XML の文字 (draw.io の Graph.decompress)
  const head = new TextDecoder('latin1').decode(d.subarray(0, 8)).trimStart();
  if (head.startsWith('<') || head.startsWith('%3C')) {
    let text = new TextDecoder().decode(d);
    if (text.startsWith('%3C')) {
      try {
        text = decodeURIComponent(text);
      } catch {
        return undefined;
      }
    }
    return parseXml(text, nodes);
  }
  return decodeBinary(d, nodes);
}

/**
 * 埋め込んだ形 (stencil(…)) の 1 つの要素の数の上限。draw.io の形は、点の多いものでも要素が数千なので、その 10 倍ほどにした
 * (図形ライブラリの全体を読む LIMITS.nodes (400 万) を、図のセルごとに使わせない)
 */
const INLINE_STENCIL_NODES = 50_000;

/**
 * style の stencil(…) の形 (draw.io の Graph.compress で縮めた <shape>)。
 * limit: 戻す大きさの上限 (既定は図形ライブラリと同じ)、stats: 戻したバイトの数を足す (図ごとの合計の勘定。drawio.ts の LIMITS.inlineStencilTotal)
 */
export function decodeInlineStencil(desc: string, limit = LIMITS.inflated, stats?: { bytes: number }): XEl | undefined {
  const el = decodeCompressed(desc, limit, INLINE_STENCIL_NODES, stats);
  return el?.name === 'shape' ? el : undefined;
}

// ───────────── 形の登録所 ─────────────

/**
 * 図形ライブラリの登録所。ライブラリの XML (<shapes>・<stencils>) と、draw.io の配布物 (stencils.min.js) を受け取り、
 * 形の名前 (小文字。空白は _) で引く。配布物の中のライブラリは、使うときに戻す
 */
export class StencilRegistry {
  private shapes = new Map<string, XEl>();
  private bundles: Array<Map<string, string>> = [];
  private loaded = new Set<string>();
  /**
   * 図が使う画像 (draw.io の配布物の画像 img/lib/sap/<名前>.svg・img/lib/clip_art/…png などと、http(s) の URL の画像)。
   * 鍵は、道・URL そのものと、渡されたファイルの名前 (name: の頭を付けた小文字のファイル名。道の最後で引く)
   */
  private images = new Map<string, DrawioImage>();
  /** 下の層 (overlay で作ったとき)。形・ライブラリ・画像を、この層に無ければ下の層で引く */
  private base?: StencilRegistry;

  /**
   * 下の層 base の上に重ねる、新しい層。足したもの (addImage など) は、この層にだけ入り、base は変えない。
   * 文書ごとの決まり (fetchImages・resolveResource) で取った URL の画像を、文書をまたいで使い回す共有の登録所に入れないために使う
   * (入れると、fetchImages: true の文書のために取った画像が、fetchImages: false の別の文書に、取らずに描かれていた)
   * @internal
   */
  static overlay(base?: StencilRegistry): StencilRegistry {
    const r = new StencilRegistry();
    r.base = base;
    return r;
  }

  /**
   * 中身を読んで足す。読めた形・ライブラリ・画像の数を返す (0 なら、図形ライブラリと読めない)。
   * 名前 (name) が .svg のファイルは、draw.io の配布物の画像として足す (SAP のアイコンの中の画像など。ファイルの名前で引く)
   */
  add(text: string, name?: string): number {
    const t = text.replace(/^\ufeff/, '').trimStart();
    if (name !== undefined && /\.svg$/i.test(name)) return this.addImage(name, new TextEncoder().encode(t)) ? 1 : 0;
    if (t.startsWith('<')) {
      const root = parseXml(t, LIMITS.nodes);
      return root ? this.addSet(root) : 0;
    }
    // 配布物: f['<ファイル>'] = '<base64>' の並び (JavaScript として実行せず、文字の並びとして読む)
    const files = new Map<string, string>();
    for (const m of t.matchAll(/\bf\['([^'\\]+)'\]\s*=\s*'([A-Za-z0-9+/=\s]*)'/g)) files.set(m[1], m[2]);
    if (files.size) this.bundles.push(files);
    return files.size;
  }

  /** ライブラリの XML の木を足す (draw.io の parseStencilSet) */
  private addSet(root: XEl): number {
    if (root.name === 'stencils') return kids(root, 'shapes').reduce((n, c) => n + this.addSet(c), 0);
    if (root.name === 'shape') return 0;
    const pkg = (root.attrs.get('name') ?? '').toLowerCase();
    let n = 0;
    for (const sh of kids(root, 'shape')) {
      const name = sh.attrs.get('name');
      if (name === undefined) continue;
      this.shapes.set(`${pkg ? pkg + '.' : ''}${name.replace(/ /g, '_').toLowerCase()}`, sh);
      n++;
    }
    return n;
  }

  /**
   * 名前の形 (mxgraph.flowchart.decision など)。配布物にあれば、そのライブラリを戻して足す
   * @internal
   */
  get(name: string): XEl | undefined {
    const key = name.toLowerCase();
    const hit = this.shapes.get(key);
    if (hit) return hit;
    const lib = libraryOf(name);
    if (lib === undefined) return undefined;
    for (const file of libraryFiles(lib)) {
      if (this.loaded.has(file)) continue;
      this.loaded.add(file);
      for (const b of this.bundles) {
        const data = b.get(file);
        const root = data !== undefined ? decodeCompressed(data) : undefined;
        if (root) {
          this.addSet(root);
          break;
        }
      }
    }
    return this.shapes.get(key) ?? this.base?.get(name);
  }

  /**
   * そのライブラリのファイルが、どれか 1 つでも手元にあるか (形が無いときの警告を分ける)
   * @internal
   */
  hasLibrary(lib: string): boolean {
    if (this.base?.hasLibrary(lib)) return true;
    const files = libraryFiles(lib);
    if (this.bundles.some((b) => files.some((file) => b.has(file)))) return true;
    const prefix = `mxgraph.${lib.replace(/\//g, '.')}.`.toLowerCase();
    for (const k of this.shapes.keys()) if (k.startsWith(prefix)) return true;
    return false;
  }

  /**
   * 画像を足す (PNG・JPEG・SVG だけ。中身で見分ける)。key: 配布物の中の道 (img/…)・http(s) の URL・渡されたファイルの名前。
   * 足せなければ false
   */
  addImage(key: string, bytes: Uint8Array): boolean {
    const mime = imageMime(bytes);
    if (!mime) return false;
    const img = { mime, bytes };
    if (isRemoteImage(key) || isDrawioImagePath(key)) this.images.set(key, img);
    else this.images.set(nameKey(key), img);
    return true;
  }

  /**
   * 画像 (src: 配布物の中の道か URL)。道そのもので無ければ、渡されたファイルの名前 (道の最後) で引く。無ければ undefined
   * @internal
   */
  image(src: string): DrawioImage | undefined {
    return this.images.get(src) ?? (isRemoteImage(src) ? undefined : this.images.get(nameKey(src))) ?? this.base?.image(src);
  }

  /**
   * 形・ライブラリ・画像が 1 つも無いか (下の層も含めて)
   * @internal
   */
  get empty(): boolean {
    return !this.shapes.size && !this.bundles.length && !this.images.size && (this.base?.empty ?? true);
  }
}

/** 図が使う画像 (PNG・JPEG・SVG) */
export interface DrawioImage {
  mime: 'image/png' | 'image/jpeg' | 'image/svg+xml';
  bytes: Uint8Array;
}

/** 渡されたファイルの名前で引く鍵 (道の最後。小文字) */
const nameKey = (path: string) => 'name:' + (path.split('/').pop() ?? '').toLowerCase();

/** 画像の種類 (PNG・JPEG は頭の印、SVG は根の要素)。ほかは undefined */
export function imageMime(b: Uint8Array): DrawioImage['mime'] | undefined {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  const head = new TextDecoder().decode(b.subarray(0, 4096)).replace(/^\ufeff/, '').trimStart();
  return isSvgText(head) ? 'image/svg+xml' : undefined;
}

/** http(s) の URL の画像か */
export const isRemoteImage = (src: string) => /^https?:\/\//i.test(src);

/** SVG の頭: XML の宣言・注釈 (XML_COMMENT。手間が長さに比例する形)・DOCTYPE の後ろに <svg */
const SVG_HEAD = new RegExp(String.raw`^(?:<\?xml[^>]*\?>\s*)?(?:${XML_COMMENT}\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]`, 'i');
/** SVG の文字か (根の要素が svg。XML の宣言・注釈・DOCTYPE は飛ばす) */
const isSvgText = (t: string) => SVG_HEAD.test(t.slice(0, 4096));

/**
 * draw.io の配布物の画像の道 (draw.io の GRAPH_IMAGE_PATH (img) からの道。SAP のアイコンの img/lib/sap/<名前>.svg、
 * 図形の一覧のクリップアートの img/lib/clip_art/<分類>/<名前>.png など)。図が書いた名前から作るので、配布物の img の下の
 * .svg・.png・.jpg だけを認める (.. や、ほかの場所を指させない)
 */
export const isDrawioImagePath = (path: string) =>
  /^img\/(?:[A-Za-z0-9_,()-]+\/){1,4}[^/\\?#%]+\.(?:svg|png|jpe?g)$/i.test(path) && !path.split('/').some((seg) => seg === '..' || seg === '.');

/** 配布物の画像の URL: 図形ライブラリの配布物 (…/webapp/js/stencils.min.js) と同じ版の、…/webapp/<path> */
export const drawioImageUrl = (path: string, bundleUrl: string = DRAWIO_STENCILS_URL) => new URL(`../${path.split('/').map(encodeURIComponent).join('/')}`, bundleUrl).href;

// ───────────── 描く ─────────────

export interface StencilBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 形を描くときの、セルのスタイルから決まる初めの状態 (mxShape.configureCanvas) */
export interface StencilPaint {
  /** 塗り (グラデーションなら url(#…))。無ければ塗らない */
  fill?: string;
  stroke?: string;
  strokeWidth: number;
  dashed: boolean;
  dashPattern: string;
  fixDash: boolean;
  /** 0〜1 */
  fillOpacity: number;
  strokeOpacity: number;
  /** セルのスタイル (色の属性に書いたキーの名前を引く) */
  style: Record<string, string>;
}

export interface StencilContext {
  lookup: (name: string) => XEl | undefined;
  warn: (m: string) => void;
  /**
   * ops: 描いた命令の数 (図の全体で数える)。chars: 書いてよい SVG の字の数の残り (あれば。drawio.ts がセルごとに入れる
   * (LIMITS.svgChars の残り)。形と道具 (drawioCanvas.ts) が、書くたびに減らし、負になったら、それ以上書かない)
   */
  budget: { ops: number; chars?: number };
}

interface State {
  fill?: string;
  stroke?: string;
  sw: number;
  dashed: boolean;
  dash: string;
  alpha: number;
  cap: string;
  join: string;
  miter: number;
  fontColor: string;
  fontSize: number;
  fontFamily: string;
  fontStyle: number;
}

/** #… と関数の形の色 (rgb(…) など) */
const isColorValue = (v: string) => /^#[0-9a-f]{3,8}$/i.test(v) || /^(?:rgb|rgba|hsl|hsla)\([\d\s.,%]+\)$/i.test(v);
/** SVG に書ける色 (色の名前を含む) */
const isColor = (v: string) => /^#[0-9a-f]{3,8}$/i.test(v) || /^(?:rgb|rgba|hsl|hsla)\([\d\s.,%]+\)$/i.test(v) || /^[a-z]+$/i.test(v);

/**
 * 形 (<shape>) を、枠 box に描く SVG。向き (direction) と反転は呼ぶ側で回す (box は回した後の縦横)。
 * 読めない形は空の文字
 */
export function stencilSvg(shape: XEl, box: StencilBox, paint: StencilPaint, ctx: StencilContext, depth = 0): string {
  if (box.w <= 0 || box.h <= 0 || depth > LIMITS.depth) return '';
  const a = shape.attrs;
  const w0 = num(a.get('w'), 100) || 100;
  const h0 = num(a.get('h'), 100) || 100;
  // 写し方 (mxStencil.computeAspect): variable は縦横を別の倍率に、fixed は小さい方の倍率で、枠の真ん中に置く
  let sx = box.w / w0;
  let sy = box.h / h0;
  let x0 = box.x;
  let y0 = box.y;
  if (a.get('aspect') === 'fixed') {
    sx = sy = Math.min(sx, sy);
    x0 += (box.w - w0 * sx) / 2;
    y0 += (box.h - h0 * sy) / 2;
  }
  const minScale = Math.min(sx, sy);
  const swAttr = a.get('strokewidth') ?? '1';
  let st: State = {
    fill: paint.fill,
    stroke: paint.stroke,
    sw: swAttr === 'inherit' ? paint.strokeWidth : num(swAttr, 1) * minScale,
    dashed: paint.dashed,
    dash: paint.dashPattern,
    alpha: 1,
    // mxAbstractCanvas2D の初めの状態: 線の端 flat・角 miter・miterlimit 10、字は黒・11px・Arial
    cap: 'butt',
    join: 'miter',
    miter: 10,
    fontColor: '#000000',
    fontSize: 11,
    fontFamily: 'Arial',
    fontStyle: 0,
  };
  const saved: State[] = [];
  const out: string[] = [];
  let d = '';
  const X = (v: string | undefined) => x0 + num(v, 0) * sx;
  const Y = (v: string | undefined) => y0 + num(v, 0) * sy;
  const P = (x: number, y: number) => `${f(x)} ${f(y)}`;

  /**
   * 色の属性 (mxStencil.parseColor・getColorValue): stroke・fill・font はセルの色。#… と rgb(…) などは色。ほかは、セルのスタイルのキー
   * (無ければ default の属性。キーの値が default なら default の属性)。どれでもない英字の名前は、色の名前 (black など) とみなす
   */
  const color = (el: XEl): string | undefined => {
    let v = el.attrs.get('color');
    if (v === undefined) return undefined;
    if (v === 'stroke') return paint.stroke;
    if (v === 'fill') return paint.fill;
    if (v === 'font') v = paint.style.fontColor ?? 'black';
    else if (v !== 'none' && !isColorValue(v)) {
      const def = el.attrs.get('default');
      const sv = Object.hasOwn(paint.style, v) ? paint.style[v] : undefined;
      if (sv !== undefined) v = sv === 'default' && def !== undefined && def !== 'none' ? def : sv;
      else if (def !== undefined) v = def;
    }
    if (v === 'default') v = el.name === 'fillcolor' ? '#ffffff' : '#000000';
    return v === 'none' || !isColor(v) ? undefined : v;
  };

  /** 今の経路を塗る・線を引く (mxSvgCanvas2D の fill・stroke・fillAndStroke。描いた経路は使い切る) */
  const emit = (doFill: boolean, doStroke: boolean) => {
    if (!d) return;
    const fill = doFill ? st.fill : undefined;
    const stroke = doStroke ? st.stroke : undefined;
    if (fill || stroke) {
      const attrs = [`d="${d}"`, `fill="${esc(fill ?? 'none')}"`];
      if (fill && st.alpha * paint.fillOpacity < 1) attrs.push(`fill-opacity="${f(st.alpha * paint.fillOpacity)}"`);
      if (stroke) {
        attrs.push(`stroke="${esc(stroke)}"`, `stroke-width="${f(st.sw)}"`);
        if (st.alpha * paint.strokeOpacity < 1) attrs.push(`stroke-opacity="${f(st.alpha * paint.strokeOpacity)}"`);
        if (st.cap !== 'butt') attrs.push(`stroke-linecap="${st.cap}"`);
        if (st.join !== 'miter') attrs.push(`stroke-linejoin="${st.join}"`);
        attrs.push(`stroke-miterlimit="${f(st.miter)}"`);
        if (st.dashed) {
          // 破線の長さは線の太さの倍 (fixDash=1 なら倍にしない。mxSvgCanvas2D.createDashPattern)
          const k = paint.fixDash ? 1 : st.sw;
          const pat = st.dash.split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
          if (pat.some((n) => n > 0)) attrs.push(`stroke-dasharray="${pat.map((n) => f(n * k)).join(' ')}"`);
        }
      } else attrs.push('stroke="none"');
      const el = `<path ${attrs.join(' ')}/>`;
      if (ctx.budget.chars !== undefined) ctx.budget.chars -= el.length;
      out.push(el);
    }
    d = '';
  };

  /** 角を丸めた折れ線 (mxShape.addPoints: 角から arcSize だけ手前で曲げ始め、角を制御点にした 2 次の曲線で曲げる) */
  const roundedPath = (pts: Array<{ x: number; y: number }>, arc: number, close: boolean) => {
    const n = pts.length;
    if (n < 2) return;
    const corner = (k: number) => close || (k > 0 && k < n - 1);
    const at = (k: number) => pts[(k + n) % n];
    const toward = (p: { x: number; y: number }, q: { x: number; y: number }) => {
      const dist = Math.max(1, Math.hypot(q.x - p.x, q.y - p.y));
      const r = Math.min(arc, dist / 2);
      return { x: p.x + ((q.x - p.x) * r) / dist, y: p.y + ((q.y - p.y) * r) / dist };
    };
    const start = corner(0) ? toward(at(0), at(1)) : at(0);
    d += `M${P(start.x, start.y)}`;
    for (let k = 1; k < (close ? n + 1 : n); k++) {
      const p = at(k);
      if (corner(k % n)) {
        const a1 = toward(p, at(k - 1));
        const a2 = toward(p, at(k + 1));
        d += `L${P(a1.x, a1.y)}Q${P(p.x, p.y)} ${P(a2.x, a2.y)}`;
      } else d += `L${P(p.x, p.y)}`;
    }
    if (close) d += 'Z';
  };

  const node = (el: XEl) => {
    if (++ctx.budget.ops > LIMITS.ops) return;
    // SVG の長さの上限 (drawio.ts の LIMITS.svgChars) を超えたら、その後の命令は描かない
    if (ctx.budget.chars !== undefined && ctx.budget.chars < 0) return;
    const g = (k: string) => el.attrs.get(k);
    switch (el.name) {
      case 'save':
        saved.push({ ...st });
        break;
      case 'restore':
        st = saved.pop() ?? st;
        break;
      case 'path': {
        d = '';
        // rounded="1" で、move と line だけの経路は、角を丸める (mxStencil.drawNode)
        if (g('rounded') === '1' && el.children.length && el.children.every((c) => c.name === 'move' || c.name === 'line')) {
          const segs: Array<Array<{ x: number; y: number }>> = [];
          for (const c of el.children) {
            if (c.name === 'move' || !segs.length) segs.push([]);
            segs[segs.length - 1].push({ x: X(c.attrs.get('x')), y: Y(c.attrs.get('y')) });
          }
          for (const sg of segs) {
            const s0 = sg[0];
            const e0 = sg[sg.length - 1];
            const close = sg.length > 1 && s0.x === e0.x && s0.y === e0.y;
            if (close) sg.pop();
            roundedPath(sg, num(g('arcSize'), 0), close);
          }
        } else for (const c of el.children) node(c);
        break;
      }
      case 'move':
        d += `M${P(X(g('x')), Y(g('y')))}`;
        break;
      case 'line':
        d += `L${P(X(g('x')), Y(g('y')))}`;
        break;
      case 'quad':
        d += `Q${P(X(g('x1')), Y(g('y1')))} ${P(X(g('x2')), Y(g('y2')))}`;
        break;
      case 'curve':
        d += `C${P(X(g('x1')), Y(g('y1')))} ${P(X(g('x2')), Y(g('y2')))} ${P(X(g('x3')), Y(g('y3')))}`;
        break;
      case 'arc':
        d += `A${f(num(g('rx'), 0) * sx)} ${f(num(g('ry'), 0) * sy)} ${f(num(g('x-axis-rotation'), 0))} ${num(g('large-arc-flag'), 0) ? 1 : 0} ${num(g('sweep-flag'), 0) ? 1 : 0} ${P(X(g('x')), Y(g('y')))}`;
        break;
      case 'close':
        d += 'Z';
        break;
      case 'rect': {
        const x = X(g('x'));
        const y = Y(g('y'));
        const w = num(g('w'), 0) * sx;
        const h = num(g('h'), 0) * sy;
        d = `M${P(x, y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`;
        break;
      }
      case 'roundrect': {
        // 角の半径: 短い辺 × arcsize / 100 (arcsize が 0 なら 15。mxConstants.RECTANGLE_ROUNDING_FACTOR)
        const x = X(g('x'));
        const y = Y(g('y'));
        const w = num(g('w'), 0) * sx;
        const h = num(g('h'), 0) * sy;
        const as = num(g('arcsize'), 0) || 15;
        const r = Math.min(w, h) * (as / 100);
        d = `M${P(x + r, y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${P(x + w, y + r)}V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${P(x + w - r, y + h)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${P(x, y + h - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${P(x + r, y)}Z`;
        break;
      }
      case 'ellipse': {
        const rx = (num(g('w'), 0) * sx) / 2;
        const ry = (num(g('h'), 0) * sy) / 2;
        const cx = X(g('x')) + rx;
        const cy = Y(g('y')) + ry;
        d = `M${P(cx - rx, cy)}A${f(rx)} ${f(ry)} 0 1 1 ${P(cx + rx, cy)}A${f(rx)} ${f(ry)} 0 1 1 ${P(cx - rx, cy)}Z`;
        break;
      }
      case 'fillstroke':
        emit(true, true);
        break;
      case 'fill':
        emit(true, false);
        break;
      case 'stroke':
        emit(false, true);
        break;
      case 'strokewidth':
        st.sw = num(g('width'), 1) * (g('fixed') === '1' ? 1 : minScale);
        break;
      case 'dashed':
        st.dashed = g('dashed') === '1';
        break;
      case 'dashpattern': {
        const pat = g('pattern');
        if (pat !== undefined)
          st.dash = pat
            .split(' ')
            .filter(Boolean)
            .map((n) => String(Number(n) * minScale))
            .join(' ');
        break;
      }
      case 'strokecolor':
        st.stroke = color(el);
        break;
      case 'fillcolor':
        st.fill = color(el);
        break;
      case 'fontcolor':
        st.fontColor = color(el) ?? st.fontColor;
        break;
      case 'linecap':
        st.cap = g('cap') === 'round' ? 'round' : g('cap') === 'square' ? 'square' : 'butt';
        break;
      case 'linejoin':
        st.join = g('join') === 'round' ? 'round' : g('join') === 'bevel' ? 'bevel' : 'miter';
        break;
      case 'miterlimit':
        st.miter = num(g('limit'), 10);
        break;
      // alpha・fillalpha・strokealpha は、どれも全体の不透明度を決める (mxStencil.drawNode は 3 つとも setAlpha)
      case 'alpha':
      case 'fillalpha':
      case 'strokealpha':
        st.alpha = Math.max(0, Math.min(1, num(g('alpha'), 1)));
        break;
      case 'fontsize':
        st.fontSize = num(g('size'), 11) * minScale;
        break;
      case 'fontfamily':
        st.fontFamily = g('family') ?? st.fontFamily;
        break;
      case 'fontstyle':
        st.fontStyle = num(g('style'), 0);
        break;
      case 'text': {
        // 点 (x, y) に置く文字 (大きさ 0 の枠の揃え。align の既定 left・valign の既定 top。vertical=1 なら左へ 90 度、rotation は左回り)
        const str = g('str');
        if (!str) break;
        const tx = X(g('x'));
        const ty = Y(g('y'));
        const align = g('align') ?? 'left';
        const valign = g('valign') ?? 'top';
        const size = st.fontSize;
        const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
        // 基線: 1 行の高さ 1.2em の枠の、上から 0.95em (drawio.ts の文字と同じ見積もり)
        const top = valign === 'middle' ? ty - 0.6 * size : valign === 'bottom' ? ty - 1.2 * size : ty;
        const rot = (g('vertical') === '1' ? -90 : 0) - num(g('rotation'), 0);
        const attrs = [`x="${f(tx)}"`, `y="${f(top + 0.95 * size)}"`, `text-anchor="${anchor}"`, `font-size="${f(size)}"`, `font-family="${esc(st.fontFamily.split(',')[0].trim())}"`, `fill="${esc(st.fontColor)}"`];
        if (st.fontStyle & 1) attrs.push('font-weight="bold"');
        if (st.fontStyle & 2) attrs.push('font-style="italic"');
        if (st.alpha < 1) attrs.push(`opacity="${f(st.alpha)}"`);
        if (rot) attrs.push(`transform="rotate(${f(rot)} ${f(tx)} ${f(ty)})"`);
        out.push(`<text ${attrs.join(' ')}>${esc(str)}</text>`);
        break;
      }
      case 'image': {
        const src = g('src') ?? '';
        const m = /^data:image\/(png|jpeg|jpg)(;base64)?,([A-Za-z0-9+/=\s]*)$/i.exec(src);
        if (!m) {
          ctx.warn(msg('形の中の画像は、data: の PNG・JPEG だけを描く', 'images in shapes are drawn only from data: PNG and JPEG'));
          break;
        }
        const x = X(g('x'));
        const y = Y(g('y'));
        const w = num(g('w'), 0) * sx;
        const h = num(g('h'), 0) * sy;
        const kind = m[1].toLowerCase() === 'png' ? 'png' : 'jpeg';
        out.push(`<image x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="none" href="data:image/${kind};base64,${m[3].replace(/\s+/g, '')}"/>`);
        break;
      }
      case 'include-shape': {
        // 別の形を、その枠に描く (今の色・線の状態のまま)
        const name = g('name') ?? '';
        const inc = ctx.lookup(name);
        if (!inc) {
          ctx.warn(msg(`形の中で使う形 "${name.slice(0, 80)}" が無い`, `shape "${name.slice(0, 80)}" used in a shape is missing`));
          break;
        }
        out.push(stencilSvg(inc, { x: X(g('x')), y: Y(g('y')), w: num(g('w'), 0) * sx, h: num(g('h'), 0) * sy }, { ...paint, fill: st.fill, stroke: st.stroke, strokeWidth: st.sw, dashed: st.dashed, dashPattern: st.dash }, ctx, depth + 1));
        break;
      }
      default:
        break;
    }
  };
  // 背景 (経路を作る) と前景 (塗る・線を引く)。今の経路は前景へ引き継ぐ (mxStencil.drawShape)
  for (const sec of ['background', 'foreground']) for (const c of kids(kids(shape, sec)[0])) node(c);
  return out.join('');
}

// ───────────── ネットワークから取る ─────────────

/** 取る道具 (Kumiori が画像の形式に渡す ImageFormatContext.fetch: 大きさの上限・時限・転送の守りは本体と同じ)。取れなければ undefined */
export type Fetcher = (url: string) => Promise<Uint8Array | undefined>;

/** 取った画像 (URL ごと。取れなかったものは覚えない) */
const images = new Map<string, Promise<Uint8Array | undefined>>();

/**
 * draw.io の配布物の画像 (img/…) をネットワークから取る (呼ぶのは、利用者が許したときだけ)。
 * 図形ライブラリの配布物 (bundleUrl) と同じ版の、同じ場所の下のファイルを取る。PNG・JPEG・SVG と読めないものは捨てる
 */
export async function fetchDrawioImage(fetch: Fetcher, path: string, bundleUrl: string = DRAWIO_STENCILS_URL): Promise<Uint8Array | undefined> {
  if (!isDrawioImagePath(path)) return undefined;
  const url = drawioImageUrl(path, bundleUrl);
  if (!images.has(url))
    images.set(
      url,
      fetch(url)
        .then((b) => (b && imageMime(b) ? b : undefined))
        .catch(() => undefined),
    );
  const got = rejoin(thisCall(), await images.get(url));
  if (got === undefined) images.delete(url);
  return got;
}

/** 取った配布物 (URL ごと。プロセス・画面の中で使い回す。取れなかったものは覚えない) */
const bundles = new Map<string, Promise<Uint8Array | undefined>>();

/**
 * draw.io の配布物 (stencils.min.js) をネットワークから取る (呼ぶのは、利用者が許したときだけ: drawio.fetchStencils)。
 * 中身はバイト列のまま返す (既定の取り先から取ったものは、呼ぶ側 (load.ts) が SHA-256 の一覧と照らす。drawioPin.ts)
 */
export async function fetchStencilBundle(fetch: Fetcher, url: string = DRAWIO_STENCILS_URL): Promise<Uint8Array | undefined> {
  if (!bundles.has(url)) bundles.set(url, fetch(url).catch(() => undefined));
  const got = rejoin(thisCall(), await bundles.get(url));
  if (got === undefined) bundles.delete(url);
  return got;
}
