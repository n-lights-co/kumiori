/**
 * 出来た PDF の検査 (軽い組): リポジトリの小さな文書を、PDF/UA-1・PDF/A-2b・PDF/A-3b と PDF/UA-1・PDF/X-4・PDF/X-1a で組み、
 *  - 壊れた PDF でないこと (qpdf --check と Poppler の pdfinfo・pdffonts・pdftotext。誤りの行・埋め込んでいない書体・タグ付きでないもの)
 *  - veraPDF の PDF/UA-1・PDF/A の検査で、基準 (test/pdf-checks.json) に無い規則が落ちないこと
 * を確かめる。検査の中身は scripts/check-pdfs.mjs と同じ (部品は scripts/pdf-checks-lib.mjs)。対応仕様説明書を含むリポジトリの文書の全部は、
 * npm run ci:local の pdf のジョブで、check-pdfs.mjs で確かめる。
 * 道具 (qpdf・Poppler・Java と .cache/verapdf (環境変数 KUMIORI_VERAPDF_DIR があればそこ) の veraPDF) が無ければ、その検査を飛ばす (失敗にしない)。
 * veraPDF は取りに行かない (取るのは NODE_USE_ENV_PROXY=1 node scripts/verapdf.mjs --fetch-only)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { DEFAULT_FONTS, typesetToPdf } from '../src/index';
import { ensureFonts, fontDir, loadCachedFont } from './helpers';
import { testIccProfile } from './iccTestProfile';
import { listDocs } from '../scripts/doc-sources.mjs';
import { baselineKey, checkStructure, compareRules, MODES, pdfFileName, readBaseline, toolsAvailable } from '../scripts/pdf-checks-lib.mjs';
import { runVerapdf, verapdfReady } from '../scripts/verapdf-lib.mjs';

const root = path.resolve(import.meta.dirname, '..');
/** 組む文書 (scripts/doc-sources.mjs の名前。check-pdfs.mjs と同じ名前で基準を引く) */
const DOC_IDS = ['examples/drawio-pages/pages.html', 'samples/check/fo/indent-inheritance-1.fo (--compat spec)'];
const tools = toolsAvailable();
const verapdfDir = process.env.KUMIORI_VERAPDF_DIR ?? path.join(root, '.cache', 'verapdf');
const hasVerapdf = verapdfReady(verapdfDir);
const baseline = readBaseline(path.join(root, 'test', 'pdf-checks.json'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kumiori-pdf-checks-'));
/** 組んだ PDF: { id, mode, file } */
const made: Array<{ id: string; mode: keyof typeof MODES; file: string }> = [];

beforeAll(async () => {
  await ensureFonts([...DEFAULT_FONTS.base, ...DEFAULT_FONTS.mono]);
  const { docs } = listDocs({ groups: ['examples', 'samples'], samples: '', weasyprint: '', fontDir });
  const ctx = { profile: testIccProfile() };
  for (const id of DOC_IDS) {
    const d = docs.find((x) => x.id === id);
    if (!d) throw new Error(`文書がありません: ${id}`);
    const doc = await d.load();
    for (const mode of Object.keys(MODES) as Array<keyof typeof MODES>) {
      const m = MODES[mode];
      const options = typeof doc.options === 'function' ? doc.options() : doc.options;
      const r = await typesetToPdf(doc.text, { ...doc.setup, loadFont: loadCachedFont, ...options, ...m.options }, m.pdf(ctx));
      const file = path.join(outDir, pdfFileName(id, mode));
      fs.writeFileSync(file, r.pdf);
      made.push({ id, mode, file });
    }
  }
  return () => fs.rmSync(outDir, { recursive: true, force: true });
}, 300_000);

describe('出来た PDF の検査 (小さなリポジトリの文書)', () => {
  it.skipIf(!tools.qpdf && !tools.pdfinfo)('壊れた PDF でない (qpdf --check・pdfinfo・pdffonts・pdftotext)', () => {
    const problems = made.flatMap(({ id, mode, file }) => checkStructure(file, { tagged: MODES[mode].tagged }, tools).problems.map((p) => `${id} [${mode}]: ${p}`));
    expect(problems).toEqual([]);
  });

  for (const flavour of ['ua1', '2b', '3b'])
    it.skipIf(!hasVerapdf)(
      `veraPDF ${flavour}: 基準に無い規則が落ちない`,
      () => {
        const list = made.filter((x) => MODES[x.mode].verapdf.includes(flavour));
        expect(list.length).toBeGreaterThan(0);
        const reports = new Map(
          runVerapdf(
            verapdfDir,
            flavour,
            list.map((x) => x.file),
          ).map((r) => [path.resolve(r.name), r]),
        );
        const added: string[] = [];
        for (const { id, mode, file } of list) {
          const rep = reports.get(path.resolve(file));
          if (!rep || rep.compliant === undefined) {
            added.push(`${id} [${mode}]: 検査できない (${rep?.error ?? '報告が無い'})`);
            continue;
          }
          // 適合しないのに落ちた規則を 1 つも読めないとき (veraPDF の報告の形が変わったときなど) は、通さない
          if (rep.compliant === false && !rep.rules.length) {
            added.push(`${id} [${mode}] ${flavour}: 適合しないのに、落ちた規則を読めない`);
            continue;
          }
          const cmp = compareRules(baseline, baselineKey(id, mode, flavour), rep.rules);
          for (const x of cmp.added) added.push(`${id} [${mode}] ${flavour}: ${x} ${rep.rules.find((r) => `${r.clause}-${r.test}` === x)?.description ?? ''}`);
        }
        expect(added).toEqual([]);
      },
      120_000,
    );
});

describe('形の検査は、壊れた PDF を見つける', () => {
  it.skipIf(!tools.qpdf || !tools.pdfinfo || !tools.pdftotext)('途中で切れた PDF と、ページの中身の流れを壊した PDF', async () => {
    const src = made.find((x) => x.mode === 'pdfua');
    expect(src).toBeDefined();
    const bytes = fs.readFileSync(src!.file);
    // 終わりの相互参照の表と trailer の無い PDF
    const cut = path.join(outDir, 'cut.pdf');
    fs.writeFileSync(cut, bytes.subarray(0, Math.floor(bytes.length / 2)));
    const c = checkStructure(cut, {}, tools).problems;
    expect(c.some((p) => p.startsWith('qpdf'))).toBe(true);
    expect(c.some((p) => p.startsWith('pdfinfo'))).toBe(true);
    // ページの中身の流れに知らない演算子 (lX) のある PDF (形は正しいので qpdf は通り、pdftotext が誤りの行を出す)
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream('0 0 m 10 10 lX S')));
    const broken = path.join(outDir, 'broken-ops.pdf');
    fs.writeFileSync(broken, await doc.save({ useObjectStreams: false }));
    expect(checkStructure(broken, {}, tools).problems.some((p) => p.startsWith('pdftotext'))).toBe(true);
  });

  it('基準と比べる: 基準に無い規則は added、基準にあって落ちなかった規則は removed', () => {
    const b = { rules: { 'x [pdfua] ua1': ['7.1-9', '7.3-1'] } };
    expect(
      compareRules(b, 'x [pdfua] ua1', [
        { clause: '7.1', test: '9' },
        { clause: '7.18.1', test: '2' },
      ]),
    ).toEqual({ failed: ['7.1-9', '7.18.1-2'], added: ['7.18.1-2'], removed: ['7.3-1'] });
    expect(compareRules(b, 'y [pdfua] ua1', [])).toEqual({ failed: [], added: [], removed: [] });
  });
});
