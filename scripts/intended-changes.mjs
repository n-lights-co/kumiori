/**
 * 意図した変化の一覧 (test/intended-changes.json) を読み、前と後の組み比べ (scripts/compare-base.mjs) の結果と照らす部品。
 *
 * 一覧は、組版の結果を変えるコミットが、変わる文書とページを書き足していくファイル。形は
 *   {
 *     "changes": [
 *       { "commit": "変えたことの短い説明 (コミットの題など)", "docs": [ { "doc": "<文書の名前>", "pages": [3, "10-12"] }, { "doc": "ah/*" } ] }
 *     ]
 *   }
 *  - doc は、compare-base の報告の文書の名前 (conformance/kumiori-xsl-fo.fo・examples/drawio-pages/pages.html・ah/<名前> など)。
 *    * は、/ を含む任意の字の並びに当たる (ah/* は ah の群の全部)
 *  - pages は、変わってよいページ (後の版のページの番号。"10-12" は 10〜12)。書かなければ、その文書のどんな変化もよい
 *    (ページ数の変化・片方の版にだけある文書・警告と誤りの変化も)。書けば、そのページの字と絵の変化と、警告・誤りの変化と、
 *    見た目の同じバイトの変化だけがよい (ページ数が変われば落とす)
 *  - 同じ文書を、いくつのコミットの項に書いてもよい (ページは足し合わせる)
 * 組み比べの前とするのは、一覧を空にしたコミット (changes が空の一覧を持つ、いちばん新しいコミット。findBase)。
 * 一覧を空にするのは、組版の結果を変えないコミットで行う (リリースの後など。一覧は、そのコミットからの変化を書く)。
 *
 * 後の版で組めない文書 (誤りで止まった・時間切れ) は、一覧にあっても落とす。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

/** 一覧の置き場 (リポジトリの直下から) */
export const INTENDED_PATH = 'test/intended-changes.json';

/** 一覧の文字列を読み、形を確かめる (違えば Error を投げる) */
export function parseIntended(text, where = INTENDED_PATH) {
  let j;
  try {
    j = JSON.parse(text);
  } catch (e) {
    throw new Error(`${where} を JSON として読めません: ${e instanceof Error ? e.message : e}`);
  }
  if (!j || typeof j !== 'object' || !Array.isArray(j.changes)) throw new Error(`${where}: changes (配列) がありません`);
  for (const [i, c] of j.changes.entries()) {
    if (!c || typeof c.commit !== 'string' || !c.commit.trim()) throw new Error(`${where}: changes[${i}] の commit (変えたことの説明) がありません`);
    if (!Array.isArray(c.docs) || !c.docs.length) throw new Error(`${where}: changes[${i}] (${c.commit}) の docs (変わる文書) がありません`);
    for (const [k, d] of c.docs.entries()) {
      if (!d || typeof d.doc !== 'string' || !d.doc) throw new Error(`${where}: changes[${i}].docs[${k}] の doc (文書の名前) がありません`);
      if (d.pages !== undefined) {
        if (!Array.isArray(d.pages) || !d.pages.length) throw new Error(`${where}: ${d.doc} の pages は、ページの番号か "a-b" の配列にします`);
        for (const p of d.pages) if (!(Number.isInteger(p) && p > 0) && !(typeof p === 'string' && /^\d+-\d+$/.test(p))) throw new Error(`${where}: ${d.doc} の pages の ${JSON.stringify(p)} は、ページの番号か "a-b" にします`);
      }
    }
  }
  return j;
}

/** doc の名前の型 (* は任意の字の並び) を正規表現にする */
function docPattern(p) {
  return new RegExp(`^${p.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
}

/** ページの指定 ([3, "10-12"]) を、ページの番号の集まりにする */
function pageSet(pages) {
  const out = new Set();
  for (const p of pages) {
    if (typeof p === 'number') out.add(p);
    else {
      const [a, b] = p.split('-').map(Number);
      for (let k = a; k <= b; k++) out.add(k);
    }
  }
  return out;
}

/**
 * 組み比べの結果 (compare-base の report.json の results) を一覧と照らす。返すのは
 *  { unlisted: [{ id, group, status, why }], unused: [{ commit, doc }] }
 *  - unlisted: 一覧に無い変化 (落とすもの)
 *  - unused: 一覧にあるが、当たる文書が変わらなかった項 (知らせるだけ。後のコミットで戻した変化など)
 * 組んだ文書のどれにも当たらない項 (見本の群を組まなかったときの ah/* など) は、unused に入れない
 */
export function checkIntended(intended, results) {
  const entries = intended.changes.flatMap((c) => c.docs.map((d) => ({ commit: c.commit, doc: d.doc, re: docPattern(d.doc), pages: d.pages && pageSet(d.pages), used: false })));
  const unlisted = [];
  for (const r of results) {
    if (r.status === 'same' || r.status === 'missing') continue;
    const hit = entries.filter((e) => e.re.test(r.id));
    for (const e of hit) e.used = true;
    const any = hit.some((e) => !e.pages);
    const pages = new Set(hit.flatMap((e) => (e.pages ? [...e.pages] : [])));
    let why;
    if (r.status === 'error') {
      // 後の版で組めないものは、一覧にあっても落とす。前の版でだけ組めないものは、一覧に (ページを書かずに) あればよい
      if (r.error?.head) why = `後の版で組めない (${r.error.head})`;
      else if (!any) why = `前の版で組めない (${r.error?.base ?? ''})`;
    } else if (r.status === 'only-base' || r.status === 'only-head') {
      if (!any) why = r.status === 'only-base' ? '前の版にだけある' : '後の版にだけある';
    } else if (r.status === 'changed') {
      if (!any) {
        if (r.pages && r.pages.base !== r.pages.head) why = `ページ数が変わった (${r.pages.base} → ${r.pages.head})`;
        else {
          const out = (r.changedPages ?? []).map((p) => p.page).filter((p) => !pages.has(p));
          if (out.length) why = `一覧に無いページが変わった (${out.join('・')} ページ)`;
        }
      }
    } else if (r.status === 'looks-same' || r.status === 'diagnostics') {
      if (!hit.length) why = r.status === 'looks-same' ? 'PDF のバイトが変わった (見た目は同じ)' : '警告・誤りが変わった';
    }
    if (why) unlisted.push({ id: r.id, group: r.group, status: r.status, why });
  }
  const composed = results.map((r) => r.id);
  const unused = entries.filter((e) => !e.used && composed.some((id) => e.re.test(id))).map((e) => ({ commit: e.commit, doc: e.doc }));
  return { unlisted, unused };
}

/**
 * 組み比べの前とするコミット (一覧を空にした、いちばん新しいコミット) を探す。
 * rev から順に、一覧のファイルを変えたコミットをたどり、changes が空の一覧を持つ初めのコミットを返す。
 * worktree が真なら、作業の場所のファイルの一覧が空のとき、rev そのものを返す (まだコミットしていない変更を後とするとき)。
 * 見つからなければ undefined (浅く取り出したリポジトリで、そのコミットまでの履歴が無いときなど)
 */
export function findBase(root, rev = 'HEAD', { worktree = false, file = INTENDED_PATH } = {}) {
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const empty = (text) => {
    try {
      return parseIntended(text).changes.length === 0;
    } catch {
      return false;
    }
  };
  if (worktree && fs.existsSync(`${root}/${file}`) && empty(fs.readFileSync(`${root}/${file}`, 'utf8'))) return git(['rev-parse', rev]).stdout.trim() || undefined;
  const log = git(['log', '--format=%H', rev, '--', file]);
  if (log.status !== 0) return undefined;
  for (const sha of log.stdout.split('\n').filter(Boolean)) {
    const show = git(['show', `${sha}:${file}`]);
    if (show.status === 0 && empty(show.stdout)) return sha;
  }
  return undefined;
}

/** 後の版の一覧を読む (rev が '.' なら作業の場所のファイル、ほかはそのコミットのファイル) */
export function readIntended(root, rev, file = INTENDED_PATH) {
  if (rev === '.') return parseIntended(fs.readFileSync(`${root}/${file}`, 'utf8'), file);
  const r = spawnSync('git', ['show', `${rev}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${rev} に ${file} がありません`);
  return parseIntended(r.stdout, `${rev}:${file}`);
}
