/**
 * canvasRenderer — SheetArea を Canvas 2D に描画する。
 * ctx を scale(px/pt) して pt 単位のまま描くため、レイアウトと画素の対応が崩れない。
 */
import type { FontManager } from './fontManager';
import { toCss } from './color';
import { FAKE_BOLD, ITALIC_SLANT, paintSheet, type Line, type Matrix, type Painter, type PathSeg } from './paint';
import type { AssetStore } from './assets';
import type { Area, GlyphArea, ImageArea, Rect, SheetArea } from './types';

export interface CanvasRenderOptions {
  /** 1pt あたりの CSS px (既定 1.3333 = 96dpi) */
  scale?: number;
  devicePixelRatio?: number;
  /** 仕上がり・塗り足しのガイド線(画面確認用。印刷物には出ない) */
  guides?: boolean;
  /** 画像 (fo:external-graphic) の登録所 */
  assets?: AssetStore;
  /**
   * 字を、書体ファイルの輪郭 (fontkit の字形) から描く。既定は false (ブラウザに登録した書体 (FontFace) で fillText する)。
   * 書体をブラウザに登録していないとき (公開 API の renderPage) に使う
   */
  glyphOutlines?: boolean;
}

/** SVG の根の preserveAspectRatio (無ければ既定の xMidYMid meet)。根の開始タグだけを見る */
const svgAspectCache = new WeakMap<Uint8Array, { align: string; slice: boolean }>();
function svgAspect(bytes: Uint8Array | undefined): { align: string; slice: boolean } {
  const dflt = { align: 'xMidYMid', slice: false };
  if (!bytes) return dflt;
  const hit = svgAspectCache.get(bytes);
  if (hit) return hit;
  const head = new TextDecoder().decode(bytes.subarray(0, 4096));
  const tag = /<svg\b[^>]*>/i.exec(head)?.[0] ?? '';
  const m = /\bpreserveAspectRatio\s*=\s*["']\s*(?:defer\s+)?(none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:\s+(meet|slice))?/i.exec(tag);
  const v = m ? { align: m[1] === 'none' ? 'none' : m[1], slice: m[2]?.toLowerCase() === 'slice' } : dflt;
  svgAspectCache.set(bytes, v);
  return v;
}

/** 字の並びの輪郭 (字の大きさ 1em = unitsPerEm の座標) と送り。書体・文字列・機能ごとに覚えておく */
type Outline = { paths: Path2D[]; offsets: { x: number; y: number }[] };

class CanvasPainter implements Painter {
  private outlineCache = new Map<string, Outline>();
  constructor(
    private ctx: CanvasRenderingContext2D,
    private fonts: FontManager,
    private assets?: AssetStore,
    private outlines = false,
  ) {}
  /** 書体 f で text を組んだ字形の輪郭 (OpenType の機能 features を当てる) */
  private outlineOf(f: ReturnType<FontManager['get']>, text0: string, features: string[]): Outline {
    // 改行しない空白 (U+00A0) は、通常の空白の字形で描く (Arimo の U+00A0 の字形は、fontkit が読めない壊れたデータ。PDF の drawGlyph と同じ)
    const text = text0.replace(/\u00A0/g, ' ');
    const key = `${f.key}\u0000${features.join(',')}\u0000${text}`;
    const hit = this.outlineCache.get(key);
    if (hit) return hit;
    const run = f.fk.layout(text, Object.fromEntries(features.map((t) => [t, true])) as never);
    const paths: Path2D[] = [];
    const offsets: { x: number; y: number }[] = [];
    let x0 = 0;
    for (let i = 0; i < run.glyphs.length; i++) {
      let d = '';
      try {
        d = (run.glyphs[i] as unknown as { path: { toSVG(): string } }).path.toSVG();
      } catch (e) {
        // 字形のデータが壊れている書体 (fontkit が読めない字) は、その字を描かずに続ける (ページの残りを描く。PDF の drawGlyph と同じ)
        console.warn(`Canvas: ${f.key} の「${text}」の字形 (${i} 番目) を描けません`, e);
      }
      paths.push(new Path2D(d));
      // 最初の字の位置のずれは、組版で描く原点に入れてある
      offsets.push({ x: x0 + (i ? run.positions[i].xOffset : 0), y: i ? run.positions[i].yOffset : 0 });
      x0 += run.positions[i].xAdvance;
    }
    const o = { paths, offsets };
    if (this.outlineCache.size > 20000) this.outlineCache.clear();
    this.outlineCache.set(key, o);
    return o;
  }
  transform(m: Matrix, draw: () => void) {
    this.ctx.save();
    this.ctx.transform(...m);
    draw();
    this.ctx.restore();
  }
  drawImage(a: ImageArea, x: number, y: number) {
    const asset = this.assets?.get(a.src);
    const el = asset?.element;
    if (!el) return;
    // SVG: ブラウザは <img> を枠の大きさに引き伸ばすので、preserveAspectRatio (SVG 1.1 §7.8。既定 xMidYMid meet) を自分で当てる
    // (PDF の drawVector と同じ見た目にする)。none は引き伸ばす。slice は枠で切り抜く
    const par = asset.mime === 'image/svg+xml' && asset.width > 0 && asset.height > 0 ? svgAspect(asset.bytes) : undefined;
    if (par && par.align !== 'none' && !a.stretch) {
      const sx = a.width / asset.width;
      const sy = a.height / asset.height;
      if (Math.abs(sx - sy) > 1e-9) {
        const s = par.slice ? Math.max(sx, sy) : Math.min(sx, sy);
        const w = asset.width * s;
        const h = asset.height * s;
        const fx = /xMid/.test(par.align) ? 0.5 : /xMax/.test(par.align) ? 1 : 0;
        const fy = /YMid/.test(par.align) ? 0.5 : /YMax/.test(par.align) ? 1 : 0;
        const ctx = this.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, a.width, a.height);
        ctx.clip();
        ctx.drawImage(el, x + (a.width - w) * fx, y + (a.height - h) * fy, w, h);
        ctx.restore();
        return;
      }
    }
    this.ctx.drawImage(el, x, y, a.width, a.height);
  }
  fillRect(x: number, y: number, w: number, h: number, color: string) {
    this.ctx.fillStyle = toCss(color);
    this.ctx.fillRect(x, y, w, h);
  }
  drawGlyph(g: GlyphArea, x: number, y: number) {
    const f = this.fonts.get(g.fontFamily, g.fontWeight);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x + g.baselineX, y + g.baselineY);
    if (g.rotation) ctx.rotate((g.rotation * Math.PI) / 180);
    if (g.scaleX !== 1) ctx.scale(g.scaleX, 1);
    if (g.italic) ctx.transform(1, 0, -ITALIC_SLANT, 1, 0, 0);
    ctx.font = this.fonts.cssFont(f, g.fontSize);
    ctx.fillStyle = toCss(g.color);
    ctx.textBaseline = 'alphabetic';
    if (g.features?.length || this.outlines) {
      // OpenType の機能を当てた字形 (Canvas では指定できない)、または書体をブラウザに登録していないとき: 字形の輪郭を描く
      const o = this.outlineOf(f, g.text, g.features ?? []);
      const k = g.fontSize / f.unitsPerEm;
      for (let i = 0; i < o.paths.length; i++) {
        ctx.save();
        ctx.translate(o.offsets[i].x * k, -o.offsets[i].y * k);
        ctx.scale(k, -k);
        ctx.fill(o.paths[i]);
        if (g.fakeBold) {
          ctx.strokeStyle = toCss(g.color);
          ctx.lineWidth = FAKE_BOLD * f.unitsPerEm;
          ctx.stroke(o.paths[i]);
        }
        ctx.restore();
      }
      ctx.restore();
      return;
    }
    ctx.fillText(g.text, 0, 0);
    if (g.fakeBold) {
      // 疑似太字: 字の輪郭を、字の大きさの 3% の太さでなぞる
      ctx.strokeStyle = toCss(g.color);
      ctx.lineWidth = g.fontSize * FAKE_BOLD;
      ctx.lineJoin = 'round';
      ctx.strokeText(g.text, 0, 0);
    }
    ctx.restore();
  }
  strokeLine(l: Line, width: number, color = '#000') {
    const ctx = this.ctx;
    ctx.strokeStyle = toCss(color);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
  }
  clipPath(path: PathSeg[], evenOdd?: boolean) {
    this.ctx.save();
    this.tracePath(path);
    this.ctx.clip(evenOdd ? 'evenodd' : 'nonzero');
  }
  clipRect(r: Rect) {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(r.x, r.y, r.width, r.height);
    this.ctx.clip();
  }
  restore() {
    this.ctx.restore();
  }
  private tracePath(path: PathSeg[]) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (const g of path) {
      if (g.op === 'M') ctx.moveTo(g.x, g.y);
      else if (g.op === 'L') ctx.lineTo(g.x, g.y);
      else if (g.op === 'C') ctx.bezierCurveTo(g.x1, g.y1, g.x2, g.y2, g.x, g.y);
      else ctx.closePath();
    }
  }
  fillPath(path: PathSeg[], color: string, evenOdd?: boolean, opacity = 1) {
    this.tracePath(path);
    this.ctx.save();
    this.ctx.globalAlpha = opacity;
    this.ctx.fillStyle = toCss(color);
    this.ctx.fill(evenOdd ? 'evenodd' : 'nonzero');
    this.ctx.restore();
  }
  strokePath(path: PathSeg[], width: number, color: string, dash?: [number, number]) {
    const ctx = this.ctx;
    this.tracePath(path);
    ctx.save();
    ctx.strokeStyle = toCss(color);
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
    ctx.restore();
  }
  /** フォームの欄の見本 (PDF では欄そのものが値を表示する)。罫線の内側に、初期値・チェック・選択肢・ボタンの表示を描く */
  private drawField(a: Area, x: number, y: number) {
    const f = a.formField!;
    const ctx = this.ctx;
    const bl = a.border.left?.width ?? 0;
    const bt = a.border.top?.width ?? 0;
    const ix = x + bl;
    const iy = y + bt;
    const iw = a.width - bl - (a.border.right?.width ?? 0);
    const ih = a.height - bt - (a.border.bottom?.width ?? 0);
    const fs = Math.min(f.fontSize === 'auto' ? ih * 0.8 : (f.fontSize ?? 10), ih * 0.8);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ix, iy, iw, ih);
    ctx.clip();
    ctx.fillStyle = toCss(f.color ?? '#000');
    ctx.strokeStyle = toCss(f.color ?? '#000');
    ctx.font = `${fs}px sans-serif`;
    ctx.textBaseline = 'middle';
    const pad = a.padding.left;
    if (f.kind === 'checkbox' || f.kind === 'radio') {
      if (f.checked) {
        // チェック印
        ctx.lineWidth = Math.max(ih * 0.12, 0.8);
        ctx.beginPath();
        ctx.moveTo(ix + iw * 0.2, iy + ih * 0.55);
        ctx.lineTo(ix + iw * 0.42, iy + ih * 0.78);
        ctx.lineTo(ix + iw * 0.8, iy + ih * 0.22);
        ctx.stroke();
      }
    } else if (f.kind === 'listbox') {
      const lh = fs * 1.25;
      (f.options ?? []).forEach((o, k) => {
        if (o.selected) {
          ctx.save();
          ctx.fillStyle = '#99c1f1';
          ctx.fillRect(ix, iy + a.padding.top + k * lh, iw, lh);
          ctx.restore();
        }
        ctx.fillText(o.label, ix + pad, iy + a.padding.top + k * lh + lh / 2);
      });
    } else if (f.kind === 'button') {
      ctx.textAlign = 'center';
      ctx.fillText(f.caption ?? '', ix + iw / 2, iy + ih / 2);
    } else {
      const text = f.kind === 'combobox' ? ((f.options ?? []).find((o) => o.selected) ?? f.options?.[0])?.label ?? '' : f.password ? '•'.repeat((f.value ?? '').length) : (f.value ?? '');
      ctx.fillText(text, ix + pad, iy + ih / 2);
      if (f.kind === 'combobox') {
        // 開くボタンの ▼
        const s = Math.min(ih * 0.5, fs);
        ctx.beginPath();
        ctx.moveTo(ix + iw - s * 1.5, iy + ih / 2 - s / 4);
        ctx.lineTo(ix + iw - s * 0.5, iy + ih / 2 - s / 4);
        ctx.lineTo(ix + iw - s, iy + ih / 2 + s / 3);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** 注釈の目印 (画面確認用)。テキスト注釈はアイコンの位置に小さな付箋、FreeText・スタンプは枠と中身 */
  mark(a: Area, x: number, y: number) {
    if (a.formField) this.drawField(a, x, y);
    const an = a.annotation;
    if (!an) return;
    const ctx = this.ctx;
    const ax = x + (an.dx ?? 0);
    const ay = y + (an.dy ?? 0);
    const color = toCss(an.color ?? '#ffd400');
    ctx.save();
    if (an.kind === 'text' || an.kind === 'file-attachment') {
      const s = 12;
      ctx.fillStyle = color;
      ctx.fillRect(ax, ay, s, s);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 0.4;
      ctx.strokeRect(ax, ay, s, s);
      ctx.beginPath();
      for (const k of [3.5, 6, 8.5]) {
        ctx.moveTo(ax + 2.5, ay + k);
        ctx.lineTo(ax + s - 2.5, ay + k);
      }
      ctx.stroke();
    } else {
      const w = an.width ?? 100;
      const h = an.height ?? 30;
      ctx.beginPath();
      ctx.rect(ax, ay, w, h);
      ctx.clip();
      if (an.kind === 'free-text') {
        // FreeText: 注釈の色が背景、中身を改行ごとに描く
        ctx.fillStyle = color;
        if (an.color) ctx.fillRect(ax, ay, w, h);
        const fs = an.fontSize ?? 10;
        ctx.fillStyle = toCss(an.textColor ?? '#000');
        ctx.font = `${fs}px sans-serif`;
        ctx.textBaseline = 'top';
        (an.contents ?? '').split(/\r?\n/).forEach((t, k) => ctx.fillText(t, ax + 2, ay + 2 + k * fs * 1.2));
      } else {
        ctx.strokeStyle = toCss(an.color ?? '#c00');
        ctx.lineWidth = 2;
        ctx.strokeRect(ax + 1, ay + 1, w - 2, h - 2);
        const fs = Math.min(h * 0.5, 18);
        ctx.fillStyle = toCss(an.color ?? '#c00');
        ctx.font = `bold ${fs}px sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText((an.icon ?? 'Draft').toUpperCase(), ax + 4, ay + (h - fs) / 2, w - 8);
      }
    }
    ctx.restore();
  }
}

export function renderSheetToCanvas(sheet: SheetArea, canvas: HTMLCanvasElement, fonts: FontManager, opts: CanvasRenderOptions = {}) {
  const scale = opts.scale ?? 96 / 72;
  const dpr = opts.devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  canvas.width = Math.ceil(sheet.width * scale * dpr);
  canvas.height = Math.ceil(sheet.height * scale * dpr);
  canvas.style.width = `${sheet.width * scale}px`;
  canvas.style.height = `${sheet.height * scale}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  ctx.fontKerning = 'none';
  // 用紙
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  const painter = new CanvasPainter(ctx, fonts, opts.assets, !!opts.glyphOutlines);
  paintSheet(sheet, painter, { guides: opts.guides });
}
