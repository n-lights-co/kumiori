#!/usr/bin/env node
/**
 * PDF に書かれた特色 (Separation の色空間) の名前と、濃度 100% の代わりの色 (DeviceCMYK) を取り出して、
 * Node のコマンドの --spot-colors に渡す JSON (`{"名前": "cmyk(…%,…%,…%,…%)"}`) にする。
 *
 *   node scripts/spot-colors-from-pdf.mjs <PDF ファイル> [-o <JSON ファイル>]
 *
 * 見本との比較で、見本と同じ特色の色で組むためのもの (特色の値はリポジトリに入れず、比べるたびに見本の PDF から取る)。
 * 読むのは [/Separation <名前> /DeviceCMYK <関数>] の形の色空間だけ。関数は ISO 32000-2 §7.10.2 (型 0: 標本) と §7.10.3 (型 2: 指数) で、
 * 入力 1.0 (濃度 100%) の出力を求める。型 0 は、最後の標本を Decode (無ければ Range) の範囲に直したもの (標本の並びの端は入力の Domain の端)。
 * 名前の All・None (§8.6.6.4: 全部の版・どの版でもない) は特色ではないので出さない。
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from 'pdf-lib';

const args = process.argv.slice(2);
const oi = args.indexOf('-o');
const out = oi >= 0 ? args[oi + 1] : undefined;
const file = args.find((a, k) => !a.startsWith('-') && (oi < 0 || k !== oi + 1));
if (!file) {
  console.error('使い方: node scripts/spot-colors-from-pdf.mjs <PDF ファイル> [-o <JSON ファイル>]');
  process.exit(1);
}

const doc = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true, updateMetadata: false });
const ctx = doc.context;
const look = (o) => (o instanceof PDFRef ? ctx.lookup(o) : o);
const nums = (o) => {
  const a = look(o);
  return a instanceof PDFArray ? a.asArray().map((x) => look(x)).map((x) => (x instanceof PDFNumber ? x.asNumber() : NaN)) : undefined;
};

/** 型 0 (標本) の関数の、入力 1.0 の出力 */
function sampledAtOne(fn) {
  const d = fn.dict;
  const range = nums(d.get(PDFName.of('Range')));
  const size = nums(d.get(PDFName.of('Size')));
  const bps = look(d.get(PDFName.of('BitsPerSample')))?.asNumber?.();
  if (!range || !size || size.length !== 1 || !bps) return undefined;
  const decode = nums(d.get(PDFName.of('Decode'))) ?? range;
  const n = range.length / 2;
  let data = fn.contents;
  const filter = look(d.get(PDFName.of('Filter')));
  const names = filter instanceof PDFArray ? filter.asArray().map((x) => String(look(x))) : filter ? [String(filter)] : [];
  for (const f of names) {
    if (f === '/FlateDecode') data = zlib.inflateSync(Buffer.from(data));
    else return undefined;
  }
  // 最後の標本 (size[0] − 1 番目) の n 個の値を、BitsPerSample の幅で読む
  const bitAt = (size[0] - 1) * n * bps;
  const out = [];
  for (let k = 0; k < n; k++) {
    let v = 0;
    for (let b = 0; b < bps; b++) {
      const bit = bitAt + k * bps + b;
      v = (v << 1) | ((data[bit >> 3] >> (7 - (bit & 7))) & 1);
    }
    const max = 2 ** bps - 1;
    out.push(decode[2 * k] + (v / max) * (decode[2 * k + 1] - decode[2 * k]));
  }
  return out;
}

/** 型 2 (指数) の関数の、入力 1.0 の出力 (C1) */
function exponentialAtOne(d) {
  return nums(d.get(PDFName.of('C1'))) ?? [1];
}

const result = {};
for (const [, obj] of ctx.enumerateIndirectObjects()) {
  if (!(obj instanceof PDFArray) || obj.size() !== 4) continue;
  const [kind, name, alt, fnRef] = obj.asArray();
  if (String(look(kind)) !== '/Separation' || String(look(alt)) !== '/DeviceCMYK') continue;
  const spot = look(name).decodeText?.() ?? decodeURIComponent(String(look(name)).slice(1).replace(/#([0-9a-fA-F]{2})/g, '%$1'));
  if (spot === 'All' || spot === 'None' || result[spot]) continue;
  const fn = look(fnRef);
  const type = look((fn instanceof PDFRawStream ? fn.dict : fn).get(PDFName.of('FunctionType')))?.asNumber?.();
  const cmyk = type === 0 && fn instanceof PDFRawStream ? sampledAtOne(fn) : type === 2 && fn instanceof PDFDict ? exponentialAtOne(fn) : undefined;
  if (!cmyk || cmyk.length !== 4) continue;
  const pct = (v) => `${Math.round(v * 1000) / 10}%`;
  result[spot] = `cmyk(${cmyk.map(pct).join(',')})`;
}

const json = JSON.stringify(result, null, 2) + '\n';
if (out) fs.writeFileSync(out, json);
else process.stdout.write(json);
