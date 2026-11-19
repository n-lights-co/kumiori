/**
 * pageFlow — 名前付きのページ (page) の切り替えが起きる箱の見分け方。
 *
 * 読み込み (htmlImport の flowChildren。ページの名前が変わる所に、ページの組の切り替えを置く) と、
 * カスケード (cssCascade の cascadeStyles。切り替えた箱から下の百分率の幅の基準を、そのページの領域の幅で見積もる) が、同じ見分け方を使う。
 * ずれると、切り替わらない箱 (float・表のセルの中など) の百分率の幅を名前付きのページの幅で見積もって、箱がまわりからはみ出す。
 *
 * page は class A の区切りを作る箱 (流れの中のブロック) に、どの深さでも効き、auto の箱は親の値を使う (CSS Paged Media 3 §8.1)。
 * 見るのは、body から、流れの中のふつうのブロック (切り替えを置ける箱の並びを持つ箱) だけをたどった箱 (表・flex・段組などの中は見ない)。
 * 文書の最初のページは、根元の要素 (html・body) の page から (下の rootPageName)。
 */

/** display が、ブロック水準の箱か (表の部品・block math・block ruby を含む。htmlImport の isBlock の display の部分) */
export function blockLevelDisplay(d: string): boolean {
  // block math・block ruby は、短い書き方の無い 2 値の display (Display 3 §2.2)。表の部品は、表の外に単独で現れたらブロックとして扱う
  return /^(block|flow-root|table|list-item|flex|grid|block math|block ruby)$/.test(d) || /^table-/.test(d);
}

/**
 * 切り替えを置ける箱の並びを持つ要素の子で、切り替えを置く箱か: ブロック水準で、流れの中にある (絶対配置・固定配置・float の箱は、
 * ページの名前を変えない)。blockLevel は blockLevelDisplay (読み込みでは、数式の要素も見る isBlock)
 */
export function pageSwitchBox(blockLevel: boolean, position: string, float: string): boolean {
  return blockLevel && !/^(absolute|fixed)$/.test(position) && (float || 'none') === 'none';
}

/**
 * 切り替えを置く箱 (pageSwitchBox) の中も、切り替えを置ける箱の並びか: ふつうのブロック (段組・表・flex・grid・リストの項目・置き換えの要素は除く)。
 * 段組は、column-count が 2 以上か、column-width が auto でないもの (CSS Multi-column 1 §2: column-width が auto でない箱は、段の数が
 * 置く場所の幅で決まり、1 段になっても段組の容器)。column-count: 1 だけの箱は、1 段のふつうのブロックとして組むので、段組と見ない
 */
export function pageSwitchHolder(display: string, columnCount: string, columnWidth: string, localName: string): boolean {
  const multicol = (parseInt(columnCount, 10) || 0) > 1 || parseFloat(columnWidth) > 0;
  return /^(block|flow-root)$/.test(display) && !multicol && !/^(img|svg|math|video|object|iframe|canvas)$/i.test(localName);
}

/** body が、切り替えを置ける箱の並びか (flex・grid の body は、ブラウザの配置で 1 つの箱として組むので、中では切り替えない) */
export function bodyPageSwitchHolder(display: string): boolean {
  return !/^(inline-)?(flex|grid)$/.test(display);
}

/** page の値の、ページの名前 (auto と空は undefined。名前は大文字小文字を区別する) */
export function ownPageName(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t && !/^auto$/i.test(t) ? t : undefined;
}

/**
 * 文書の最初のページの名前 (無ければ undefined): body の page、無ければ html の page。
 * page の auto は、使用値が親の値なので (CSS Paged Media 3 §8.1)、html・body の page は、page が auto の中の箱すべての名前になり、
 * 最初のページの種類は、最初の流れの中の箱の名前で決まる (同じ節)。文書の全体を名前付きのページにする書き方 (body { page: x })
 */
export function rootPageName(bodyPage: string | undefined, htmlPage: string | undefined): string | undefined {
  return ownPageName(bodyPage) ?? ownPageName(htmlPage);
}
