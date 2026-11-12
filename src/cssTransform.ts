/**
 * cssTransform — CSS の変換 (transform・transform-origin と、translate・rotate・scale) の計算値を読む。
 *
 * 仕様: CSS Transforms 1 (https://www.w3.org/TR/css-transforms-1/ 、W3C Candidate Recommendation 2019-02-14。2026-11-10 取得) の
 * §4 (transform)・§5 (transform-origin)・§9.1 (2D の変換の関数)、CSS Transforms 2 (https://www.w3.org/TR/css-transforms-2/ 、
 * W3C Working Draft 2021-11-09。同日取得) の §5 (translate・rotate・scale) と §6 (行列の作り方)・§12 (関数の書き方)。
 * 読むのは 2D の変換だけ。3D の関数 (matrix3d・translate3d・translateZ・scale3d・scaleZ・rotate3d・rotateX・rotateY・perspective) と、
 * 3D になる translate・rotate・scale の値は読まない (読めなかった関数の名前を返し、呼び手が未対応の値として知らせる)。
 * 長さは計算値 (絶対の長さ。カスケードが em などを px にしてある) か百分率。calc() に百分率が残る式は読まない
 */
import { cssLen } from './cssText';
import type { TransformFunction, TransformLength } from './types';

const PT_PER_PX = 0.75;

/** 読めなかったもの (未対応の値として知らせる名前。例: 'rotate3d()') */
export interface TransformMiss {
  miss: string;
}

/** 角度 → 度 (CSS Values 4 §7.1: deg・grad・rad・turn)。単位の無い 0 は 0deg (Transforms 1 §9) */
function angle(v: string): number | undefined {
  const m = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i.exec(v.trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  switch ((m[2] ?? '').toLowerCase()) {
    case 'deg':
      return n;
    case 'grad':
      return n * 0.9;
    case 'rad':
      return (n * 180) / Math.PI;
    case 'turn':
      return n * 360;
    default:
      return n === 0 ? 0 : undefined;
  }
}

const NUM = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const num = (v: string): number | undefined => (NUM.test(v.trim()) ? parseFloat(v) : undefined);
/** 数か百分率 (scale。Transforms 2 §12: 百分率は数と同じ意味。100% = 1) */
const numPct = (v: string): number | undefined => (/%$/.test(v.trim()) ? (num(v.trim().slice(0, -1)) ?? NaN) / 100 : num(v));
/** 長さ (pt) か百分率 */
function lenPct(v: string): TransformLength | undefined {
  const t = v.trim();
  if (/%$/.test(t)) return num(t.slice(0, -1)) !== undefined ? (`${parseFloat(t)}%` as TransformLength) : undefined;
  return /^[+-]?[\d.]/.test(t) ? cssLen(t.replace(/^\+/, '')) : undefined;
}

/** 引数を分ける (コンマ。古い書き方の空白区切りも読む) */
const args = (body: string) => (body.includes(',') ? body.split(',') : body.trim().split(/\s+/)).map((a) => a.trim()).filter((a) => a !== '');

/**
 * transform の計算値 (none か、変換の関数の並び) を読む。none・空は空の並び。読めない関数があれば、その名前を返す。
 * getComputedStyle の値 (matrix(a, b, c, d, e, f)。e・f は px) も同じ道で読む
 */
export function parseTransformList(value: string): TransformFunction[] | TransformMiss {
  const v = value.trim();
  if (!v || v.toLowerCase() === 'none') return [];
  const out: TransformFunction[] = [];
  const re = /\s*([a-z0-9]+)\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*/giy;
  let pos = 0;
  for (let m = re.exec(v); m; m = re.exec(v)) {
    pos = re.lastIndex;
    const name = m[1].toLowerCase();
    const a = args(m[2]);
    const bad: TransformMiss = { miss: `${name}()` };
    switch (name) {
      case 'matrix': {
        const n = a.map(num);
        if (n.length !== 6 || n.some((x) => x === undefined)) return bad;
        const k = n as number[];
        // 平行移動の 1 単位は 1 CSS px (Transforms 1 §14)
        out.push({ fn: 'matrix', m: [k[0], k[1], k[2], k[3], k[4] * PT_PER_PX, k[5] * PT_PER_PX] });
        break;
      }
      case 'translate':
      case 'translatex':
      case 'translatey': {
        const l = a.map(lenPct);
        if (!l.length || l.length > (name === 'translate' ? 2 : 1) || l.some((x) => x === undefined)) return bad;
        out.push(name === 'translatey' ? { fn: 'translate', x: 0, y: l[0]! } : { fn: 'translate', x: l[0]!, y: l[1] ?? 0 });
        break;
      }
      case 'scale':
      case 'scalex':
      case 'scaley': {
        const n = a.map(numPct);
        if (!n.length || n.length > (name === 'scale' ? 2 : 1) || n.some((x) => x === undefined || Number.isNaN(x))) return bad;
        out.push(name === 'scalex' ? { fn: 'scale', x: n[0]!, y: 1 } : name === 'scaley' ? { fn: 'scale', x: 1, y: n[0]! } : { fn: 'scale', x: n[0]!, y: n[1] ?? n[0]! });
        break;
      }
      // rotateZ() は rotate() と同じ 2D の回転 (Transforms 2 §12.2)
      case 'rotate':
      case 'rotatez': {
        const d = a.length === 1 ? angle(a[0]) : undefined;
        if (d === undefined) return bad;
        out.push({ fn: 'rotate', deg: d });
        break;
      }
      case 'skew':
      case 'skewx':
      case 'skewy': {
        const d = a.map(angle);
        if (!d.length || d.length > (name === 'skew' ? 2 : 1) || d.some((x) => x === undefined)) return bad;
        out.push(name === 'skewy' ? { fn: 'skew', x: 0, y: d[0]! } : { fn: 'skew', x: d[0]!, y: d[1] ?? 0 });
        break;
      }
      default:
        return bad;
    }
  }
  return pos === v.length && out.length ? out : { miss: v.replace(/\s+/g, ' ').slice(0, 40) };
}

/**
 * translate・rotate・scale (Transforms 2 §5) の計算値を、変換の関数にする。none は undefined。
 * 3D になる値 (translate の 3 つ目が 0 でない・rotate の軸が z でない・scale の 3 つ目が 1 でない) は読まない
 */
export function parseIndividualTransform(prop: 'translate' | 'rotate' | 'scale', value: string): TransformFunction | undefined | TransformMiss {
  const v = value.trim().toLowerCase();
  if (!v || v === 'none') return undefined;
  const t = v.split(/\s+/);
  const bad: TransformMiss = { miss: `${prop}: ${v}` };
  if (prop === 'translate') {
    const l = t.slice(0, 2).map(lenPct);
    if (t.length > 3 || l.some((x) => x === undefined)) return bad;
    if (t[2] !== undefined && cssLen(t[2]) !== 0) return bad;
    return { fn: 'translate', x: l[0]!, y: l[1] ?? 0 };
  }
  if (prop === 'scale') {
    const n = t.map(numPct);
    if (t.length > 3 || n.some((x) => x === undefined || Number.isNaN(x))) return bad;
    if (n[2] !== undefined && n[2] !== 1) return bad;
    return { fn: 'scale', x: n[0]!, y: n[1] ?? n[0]! };
  }
  // rotate: <angle> | [ x | y | z | <number>{3} ] && <angle>。z の軸 (z・「0 0 正の数」) は 2D の回転 (§5)。角度は先頭か末尾
  if (t.length === 1) {
    const d = angle(t[0]);
    return d === undefined ? bad : { fn: 'rotate', deg: d };
  }
  const first = /[a-z]$/.test(t[0]) && angle(t[0]) !== undefined;
  const d = angle(first ? t[0] : t[t.length - 1]);
  const axis = first ? t.slice(1) : t.slice(0, -1);
  if (d === undefined) return bad;
  const z = (axis.length === 1 && axis[0] === 'z') || (axis.length === 3 && axis.every((x) => NUM.test(x)) && +axis[0] === 0 && +axis[1] === 0 && +axis[2] > 0);
  return z ? { fn: 'rotate', deg: d } : bad;
}

/**
 * transform-origin の計算値 (Transforms 1 §5) → 原点の x・y (基準の箱の左上から)。初期値 (50% 50%) は undefined。
 * 3 つ目の値 (z) は 2D の変換に関わらないので捨てる。読めない値は初期値
 */
export function parseTransformOrigin(value: string): [TransformLength, TransformLength] | undefined {
  const t = value.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 2);
  if (!t.length) return undefined;
  const kwX: Record<string, TransformLength> = { left: '0%', center: '50%', right: '100%' };
  const kwY: Record<string, TransformLength> = { top: '0%', center: '50%', bottom: '100%' };
  let x: TransformLength | undefined;
  let y: TransformLength | undefined;
  if (t.length === 1) {
    // 1 つだけなら、もう一方は center
    if (t[0] === 'top' || t[0] === 'bottom') y = kwY[t[0]];
    else x = kwX[t[0]] ?? lenPct(t[0]);
    if (x === undefined && y === undefined) return undefined;
  } else if ((t[0] === 'top' || t[0] === 'bottom' || t[1] === 'left' || t[1] === 'right') && kwY[t[0]] !== undefined && kwX[t[1]] !== undefined) {
    // 語だけの組は、順が逆でもよい (top left など)
    y = kwY[t[0]];
    x = kwX[t[1]];
  } else {
    x = kwX[t[0]] ?? lenPct(t[0]);
    y = kwY[t[1]] ?? lenPct(t[1]);
    if (x === undefined || y === undefined) return undefined;
  }
  x ??= '50%';
  y ??= '50%';
  return x === '50%' && y === '50%' ? undefined : [x, y];
}

/**
 * 3D の変換になる値か (読まない値。@supports には、対応していないと答える): transform の 3D の関数、rotate の z でない軸、
 * translate・scale の 3 つ目が 0・1 でない値
 */
export function is3dTransformValue(prop: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (prop === 'transform') return /\b(matrix3d|translate3d|translatez|scale3d|scalez|rotate3d|rotatex|rotatey|perspective)\(/.test(v);
  if (prop === 'rotate' || prop === 'scale') {
    const r = parseIndividualTransform(prop, v);
    return !!r && 'miss' in r;
  }
  if (prop === 'translate') {
    const t = v.split(/\s+/);
    return t.length === 3 && !/^[+-]?0(\.0*)?[a-z]*$/.test(t[2]);
  }
  return false;
}
