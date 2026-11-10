/**
 * psOpsState — グラフィックス状態の演算子 (§8.2: gsave・setlinewidth・setdash など)、色 (setgray・setrgbcolor・setcolorspace・setpattern など) と、
 * 機器に依存する色の変換 (§7。値は持つだけ)
 */
import { type Interp, PSError, VM_ARRAY_ITEM, arr, arrItems, bool, dictObj, int, name, num, real } from './psInterp';
import type { Graphics, GState } from './psGraphics';
import { DEVICE_GRAY, DEVICE_RGB, DEVICE_CMYK, clamp01, type ColorSpace } from './psColorSpace';
import { popMatrix } from './psOpsMatrix';
import { patternToDevice } from './psShading';

/** グラフィックス状態・色の演算子を登録する */
export function installStateOperators(I: Interp, G: Graphics) {
  const d = (n: string, fn: (I: Interp) => void) => I.def(n, fn);
  // グラフィックス状態 (§8.2)
  d('gsave', () => {
    G.stack.push(G.copy(G.g));
    if (G.stack.length > 1000) throw new PSError('limitcheck');
  });
  d('grestore', () => {
    const s = G.stack.pop();
    if (s) {
      G.discard(G.g);
      G.g = s;
    }
  });
  d('grestoreall', () => {
    if (G.stack.length) {
      G.discard(G.g);
      for (const x of G.stack.slice(1)) G.discard(x);
      G.g = G.stack[0];
      G.stack = [];
    }
  });
  d('initgraphics', () => {
    const g = G.initial();
    g.clip = undefined;
    G.g = g;
  });
  // gstate のオブジェクトは VM に置く (§8.2 gstate)
  d('gstate', (I) => {
    I.vmAlloc(G.gstateCost(G.g));
    I.push({ t: 'gstate', g: G.copy(G.g) });
  });
  d('currentgstate', (I) => {
    const o = I.pop();
    if (o.t !== 'gstate') throw new PSError('typecheck');
    I.vmAlloc(G.gstateCost(G.g));
    I.push({ t: 'gstate', g: G.copy(G.g) });
  });
  d('setgstate', (I) => {
    const o = I.pop();
    if (o.t !== 'gstate') throw new PSError('typecheck');
    G.g = G.copy(o.g as GState);
  });
  d('setlinewidth', (I) => void (G.g.lineWidth = Math.abs(I.popNum())));
  d('currentlinewidth', (I) => I.push(real(G.g.lineWidth)));
  d('setlinecap', (I) => {
    const v = I.popInt();
    if (v < 0 || v > 2) throw new PSError('rangecheck');
    G.g.cap = v;
  });
  d('currentlinecap', (I) => I.push(int(G.g.cap)));
  d('setlinejoin', (I) => {
    const v = I.popInt();
    if (v < 0 || v > 2) throw new PSError('rangecheck');
    G.g.join = v;
  });
  d('currentlinejoin', (I) => I.push(int(G.g.join)));
  d('setmiterlimit', (I) => {
    const v = I.popNum();
    if (v < 1) throw new PSError('rangecheck');
    G.g.miter = v;
  });
  d('currentmiterlimit', (I) => I.push(real(G.g.miter)));
  d('setdash', (I) => {
    const off = I.popNum();
    const a = I.popArray();
    const array = arrItems(a).map((o) => {
      if (o.t !== 'int' && o.t !== 'real') throw new PSError('typecheck');
      return o.v;
    });
    if (array.length && array.every((v) => v === 0)) throw new PSError('rangecheck');
    G.g.dash = { array, offset: off };
  });
  d('currentdash', (I) => {
    I.vmAlloc(G.g.dash.array.length * VM_ARRAY_ITEM);
    I.push(arr(G.g.dash.array.map(num)));
    I.push(num(G.g.dash.offset));
  });
  d('setflat', (I) => void (G.g.flat = Math.max(0.2, Math.min(100, I.popNum()))));
  d('currentflat', (I) => I.push(real(G.g.flat)));
  d('setstrokeadjust', (I) => void (G.g.strokeAdjust = I.popBool()));
  d('currentstrokeadjust', (I) => I.push(bool(G.g.strokeAdjust)));
  d('setoverprint', (I) => void (G.g.overprint = I.popBool()));
  d('currentoverprint', (I) => I.push(bool(G.g.overprint)));
  d('setsmoothness', (I) => void (G.g.smoothness = I.popNum()));
  d('currentsmoothness', (I) => I.push(real(G.g.smoothness)));

  // 色 (§8.2)
  const setColor = (cs: ColorSpace, c: number[]) => {
    G.g.cs = cs;
    G.g.color = c;
    G.g.pattern = undefined;
  };
  d('setgray', (I) => setColor(DEVICE_GRAY, [clamp01(I.popNum())]));
  d('currentgray', (I) => {
    const [r, g, b] = G.currentRGB();
    I.push(real(0.3 * r + 0.59 * g + 0.11 * b));
  });
  d('setrgbcolor', (I) => {
    const b = I.popNum();
    const g = I.popNum();
    const r = I.popNum();
    setColor(DEVICE_RGB, [clamp01(r), clamp01(g), clamp01(b)]);
  });
  d('currentrgbcolor', (I) => {
    for (const v of G.currentRGB()) I.push(real(v));
  });
  d('sethsbcolor', (I) => {
    const b = clamp01(I.popNum());
    const s = clamp01(I.popNum());
    const h = clamp01(I.popNum());
    // 六角錐のモデル (§4.8.2 の HSB)
    const i = Math.floor(h * 6) % 6;
    const f = h * 6 - Math.floor(h * 6);
    const p = b * (1 - s);
    const q = b * (1 - s * f);
    const t = b * (1 - s * (1 - f));
    const rgb = [
      [b, t, p],
      [q, b, p],
      [p, b, t],
      [p, q, b],
      [t, p, b],
      [b, p, q],
    ][i];
    setColor(DEVICE_RGB, rgb);
  });
  d('currenthsbcolor', (I) => {
    const [r, g, b] = G.currentRGB();
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    let h = 0;
    if (mx > mn) {
      if (mx === r) h = ((g - b) / (mx - mn) + 6) % 6;
      else if (mx === g) h = (b - r) / (mx - mn) + 2;
      else h = (r - g) / (mx - mn) + 4;
    }
    I.push(real(h / 6));
    I.push(real(mx ? (mx - mn) / mx : 0));
    I.push(real(mx));
  });
  d('setcmykcolor', (I) => {
    const k = I.popNum();
    const y = I.popNum();
    const m = I.popNum();
    const c = I.popNum();
    setColor(DEVICE_CMYK, [c, m, y, k].map(clamp01));
  });
  d('currentcmykcolor', (I) => {
    if (G.g.cs.family === 'DeviceCMYK') for (const v of G.g.color) I.push(real(v));
    else {
      // §7.2.3 (黒の生成・下色除去は、そのまま k を使う)
      const [r, g, b] = G.currentRGB();
      const c = 1 - r;
      const m = 1 - g;
      const y = 1 - b;
      const k = Math.min(c, m, y);
      for (const v of [c - k, m - k, y - k, k]) I.push(real(v));
    }
  });
  d('setcolorspace', (I) => {
    const o = I.pop();
    const cs = G.parseColorSpace(o);
    setColor(cs, G.initialColor(cs));
  });
  d('currentcolorspace', (I) => {
    const o = G.g.cs.obj;
    I.push(o.t === 'name' ? arr([o]) : o);
  });
  d('setcolor', (I) => {
    const cs = G.g.cs;
    if (cs.family === 'Pattern') {
      const p = I.pop();
      const under: number[] = [];
      if (cs.base) for (let k = 0; k < cs.base.ncomp; k++) under.unshift(I.popNum());
      G.g.pattern = p;
      G.g.color = under;
      return;
    }
    const c: number[] = [];
    for (let k = 0; k < cs.ncomp; k++) c.unshift(I.popNum());
    G.g.color = c;
  });
  d('currentcolor', (I) => {
    for (const v of G.g.color) I.push(real(v));
    if (G.g.pattern) I.push(G.g.pattern);
  });
  d('setpattern', (I) => {
    const p = I.pop();
    if (p.t !== 'dict') throw new PSError('typecheck');
    const pt = p.d.get('PaintType');
    if (pt && pt.t === 'int' && pt.v === 2) {
      // 色の無い模様: 下の色の成分を取る
      const base = G.g.cs.family === 'Pattern' ? G.g.cs.base : G.g.cs;
      const comps: number[] = [];
      if (base) for (let k = 0; k < base.ncomp; k++) comps.unshift(I.popNum());
      G.g.cs = { family: 'Pattern', obj: arr([name('Pattern'), base?.obj ?? name('DeviceGray')]), ncomp: 1, base };
      G.g.color = comps;
    } else {
      G.g.cs = { family: 'Pattern', obj: name('Pattern'), ncomp: 1 };
      G.g.color = [];
    }
    G.g.pattern = p;
  });
  d('makepattern', (I) => {
    const m = popMatrix(I);
    const p = I.popDict();
    const copy = I.newDict(p.size + 1);
    for (const { k, v } of p.map.values()) copy.put(k, v);
    // 模様の空間 → 機器の座標の行列 (渡された行列に、いまの CTM を掛けたもの。§4.9.1)
    copy.put('Implementation', arr([dictObj(I.newDict()), ...patternToDevice(G, m).map(real)]));
    copy.acc = 'readonly';
    I.push(dictObj(copy));
  });
  // 機器に依存する色の変換 (§7)。値は持つだけ
  d('settransfer', (I) => void (G.g.transfer = I.pop()));
  d('currenttransfer', (I) => I.push(G.g.transfer));
  d('setcolortransfer', (I) => {
    for (let k = 0; k < 4; k++) I.pop();
  });
  d('currentcolortransfer', (I) => {
    for (let k = 0; k < 4; k++) I.push(G.g.transfer);
  });
  d('setblackgeneration', (I) => void (G.g.blackGeneration = I.pop()));
  d('currentblackgeneration', (I) => I.push(G.g.blackGeneration));
  d('setundercolorremoval', (I) => void (G.g.ucr = I.pop()));
  d('currentundercolorremoval', (I) => I.push(G.g.ucr));
  d('setscreen', (I) => {
    const p = I.pop();
    const a = I.pop();
    const f = I.pop();
    G.g.screen = [f, a, p];
  });
  d('currentscreen', (I) => G.g.screen.forEach((o) => I.push(o)));
  d('setcolorscreen', (I) => {
    for (let k = 0; k < 12; k++) I.pop();
  });
  d('currentcolorscreen', (I) => {
    for (let k = 0; k < 4; k++) G.g.screen.forEach((o) => I.push(o));
  });
  d('sethalftone', (I) => void (G.g.halftone = I.pop()));
  d('currenthalftone', (I) => {
    if (G.g.halftone.t === 'dict') I.push(G.g.halftone);
    else {
      const h = I.newDict(4);
      h.put('HalftoneType', int(1));
      h.put('Frequency', G.g.screen[0]);
      h.put('Angle', G.g.screen[1]);
      h.put('SpotFunction', G.g.screen[2]);
      I.push(dictObj(h));
    }
  });
  d('setcolorrendering', (I) => void (G.g.colorRendering = I.pop()));
  d('currentcolorrendering', (I) => I.push(G.g.colorRendering.t === 'dict' ? G.g.colorRendering : dictObj(I.newDict())));
}
