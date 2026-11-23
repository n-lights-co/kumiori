# OS の書体を後備に使う選択肢の設計の覚え書き

Node で、OS の書体の場所 (Linux の fontconfig の設定・Windows・macOS の書体のフォルダ) を探し、読み込んだどの書体にも字形の無い字だけを、
その中の書体で組む選択肢を足す設計です。CSS Fonts 4 §5.2 (Matching font styles) の手順の最後は、どの書体にも無い字を、
処理系の後備の書体 (system font fallback) で組んでよいとしている。この覚え書きは、リリースする文書 (`docs/` など) ではありません。

前提にしたもの (利用者の決め。2026-11-22):

- 既定では使わない (組んだ結果が、組む機械に入っている書体で変わるため)。
- ライブラリは `systemFonts`、コマンドは `--system-fonts` で使う。
- 外のファイルを読まない指定 (`--no-outside-files`) と一緒なら、誤りにする。
- 足すだけで、指定しなければ前と同じに動く。組版の結果も同じ。
- 7.1 の 6 つの決め (2026-11-22): 部品を渡す形・**明朝とゴシックに合わせる** (推奨と違う。2.4)・索引はディスクに覚えない・記号と絵文字の書体の後に OS の書体を探す・
  種類は名前も見て決める・種類の分からない指定の書体は serif の側から探す。

ほかに、呼び出しごとの文脈 (`src/callContext.ts`。`lang`・`limits`・`signal`・`onProgress`)、器 (`createTypesetter`) の書体の下ごしらえの覚え
(`FontPrepCache`)、入力の上限 (`src/limits.ts` の `fontBytes`・`fontCollectionBytes`) が main に入っていることを前提にした。

## 0. 先に分かったこと (設計の形を決めるもの)

- **字形の無い字を知らせる所は 1 か所。** `src/api.ts` の文書ごとの組版の準備で、等幅の書体 → 記号の書体 (`SYMBOL_SPEC`。0x2000 以上の字が欠けるとき) →
  絵文字の書体 (`EMOJI_SPEC`) の順に読み込み、その後で `missingGlyphChars` (`src/fontMapping.ts`) が残った字を数えて、
  字ごとに `font/missing-glyph` (重さは error) を出す。OS の書体を探すのは、**この間 (絵文字の書体の後、知らせる前)** に 1 段足せばよい。
  欠ける字の無い文書では、探しもしない (いまと同じ手間)。
- **組版の字の書体の選び方は、読み込み済みの書体から字を持つものを探す。** `FontManager.findForChar` (`src/fontManager.ts`) は、指定の書体に字が無ければ、
  欧文の書体 → `fallbackOrder(weight)` (読み込み済みのすべての書体を、太さの近い順・登録の順・傾き・幅で並べたもの) の順に `hasGlyph` で探す。
  OS の書体を、記号・絵文字の書体と同じく「読み込み済みの書体」に足せば、組版の側の選び方は、ほぼ変えなくてよい
  (変えるのは、書体の種類を合わせるための、OS の書体どうしの並べ方だけ。3.1)。
  ただし、そのままだと、足した OS の書体が、欠けていなかった字の選び方にも入りうる (太さの近い順に並べるので、登録の順だけでは決まらない)。
  「欠けていた字だけが変わる」を守るために、**OS の書体は、この文書で欠けていた字だけを持つものとして登録する** (3.1)。
- **メインの入口 (`kumiori`) は、ブラウザでも読む。** `src/index.ts` は `node:fs` を読み込めない (ブラウザ向けの束にも入る)。
  Node の部品は `kumiori/node` (`src/node.ts`・`src/nodeFonts.ts`) にある (`createFontLoader`・`createFileResolver`)。
  ライブラリの `systemFonts` は、`loadFont`・`resolveResource` と同じく、**`kumiori/node` が作る部品を渡す形**にする (1.1)。
- **探す速さ。** この環境の `/usr/share/fonts` (109 ファイル・111 書体・122MB) で測った (手で書いた試しの script。リポジトリには入れない):
  - 表の目次と `cmap` の表だけをファイルから読む: 初めの 1 回 30ms、2 回目 (OS のファイルのキャッシュが効いて) 2ms。読んだ `cmap` は合計 2.1MB。
  - ファイルを全部読んで fontkit で開き、字の集まり (`characterSet`) を取る: 1.1 秒 (字は合わせて 77 万)。
  - macOS・Windows の書体のフォルダは、500〜1000 ファイル・1〜3GB ほど (CJK・絵文字の書体が大きい)。全部を fontkit で開くと 10〜30 秒になる見込みで、
    必要な表だけを読めば 0.1〜1 秒ほどの見込み。**書体の全部を読まず、要る表だけを読んで字の範囲の索引を作る** (2.2)。
- 書体の埋め込みの可否 (OpenType の `OS/2` の表の `fsType`) は、いまはどの書体についても見ていない (`--font` の書体も見ない。渡す人の責任)。
  OS の書体は、組む人が選んで渡したものではないので、**OS の書体だけ `fsType` を見て、埋め込めない書体を選ばない** (3.4)。

## 1. 公開する API の形

### 1.1 型と入口

```ts
// kumiori (型だけ。ブラウザでも読める)

/** OS の書体を探す部品 (TypesetterOptions.systemFonts)。kumiori/node の createSystemFonts が作る */
export interface SystemFontSource {
  /** 字形の無い字 (chars) を持つ書体を探す。見つからない字は、返す書体に入れない。探せなければ空の並び */
  find(request: SystemFontRequest): Promise<SystemFontMatch[]>;
}

export interface SystemFontRequest {
  /** 読み込んだどの書体にも字形の無い字 (書記素ではなく符号位置 1 つの字。重ならず、符号位置の順) */
  chars: string[];
  /** 探す書体の種類 (2.4)。種類ごとに、chars を覆う書体を探す。既定 ['serif', 'sans'] */
  kinds?: readonly SystemFontKind[];
  /** 種類ごとに探す字 (chars のうち、その種類の書体の指定の所に出る字。無い種類は chars の全部。2.4 の後の直し) */
  charsByKind?: Partial<Record<SystemFontKind, readonly string[]>>;
  /** 文書の言語 (BCP 47。HTML の lang・XSL-FO の xml:lang、無ければ documentLang)。漢字の書体の選び方に使う (2.3) */
  lang?: string;
  /** 返す書体 (埋め込める書体) の数の上限 (入力の上限 systemFontFaces) */
  maxFaces?: number;
  /** 呼び出しの止める合図 (TypesetOptions.signal) */
  signal?: AbortSignal;
}

/** 書体の種類 (2.4)。serif: 明朝・セリフ体、sans: ゴシック・サンセリフ体、other: 装飾・手書き・記号の書体、unknown: 分からない */
export type SystemFontKind = 'serif' | 'sans' | 'other' | 'unknown';

export interface SystemFontMatch {
  /** この書体の種類 (2.4)。組版は、指定の書体と同じ種類のものを先に使う */
  kind: SystemFontKind;
  /** どの種類の求めに応えた書体か (kinds の 1 つ。種類の合う書体が無くて、ほかの種類で補ったときは kind と違う) */
  forKind: SystemFontKind;
  /** 同じ書体の印 (実体のパス・TTC の中の番号・大きさ・更新の時刻)。器が、文書をまたいで読み込んだ書体を使い回すのに使う */
  key: string;
  /** 知らせに出す名前 (書体のファミリー名とファイル名。例 "Noto Sans Tamil (NotoSansTamil-Regular.ttf)") */
  name: string;
  /** この書体で組む字 (request.chars のうち、この書体が持つもの) */
  chars: string[];
  /**
   * PDF に埋め込めるか (fsType。3.4)。false の書体は、字を持つが使えないことを知らせる (font/system-font-not-embeddable) ためだけに返す
   * (data を呼ばない。chars は、埋め込める書体のどれも持たない字)
   */
  embeddable: boolean;
  /** 書体の中身 (TTC なら、取り出した 1 つの書体の sfnt)。初めて使うときに 1 度だけ呼ぶ */
  data(): Promise<ArrayBuffer>;
}

export type TypesetterOptions = Pick<TypesetOptions, 'fonts' | 'genericFonts' | 'loadFont' | 'systemFonts' | /* … */ 'limits'> & { /* … */ };

export interface TypesetOptions {
  // …
  /**
   * どの書体にも字形の無い字を、OS の書体で組む (CSS Fonts 4 §5.2 の処理系の後備の書体)。既定は使わない。
   * Node では kumiori/node の createSystemFonts() を渡す。使ったときは、組んだ結果が組む機械の書体で変わる
   */
  systemFonts?: SystemFontSource;
}
```

```ts
// kumiori/node

export interface SystemFontOptions {
  /**
   * 探すディレクトリ (文字列の配列。配列でない値・文字列でない項・空の文字列は TypeError)。省略すれば systemFontDirs() (OS の書体の場所)。
   * 相対の道は、部品を作ったときのカレントディレクトリから決める。空の配列なら、どこも探さない
   */
  dirs?: readonly string[];
  /** 探すファイルの数の上限 (既定 20000)。超えた分は探さない */
  maxFiles?: number;
}
/** OS の書体を探す部品 (TypesetOptions.systemFonts に渡す)。字の範囲の索引は、初めて find を呼んだときに作り、この部品が持つ */
export function createSystemFonts(o?: SystemFontOptions): SystemFontSource;
/** OS の書体の場所 (2.1)。環境変数・OS・home を引数で差し替えられる (defaultFontCacheDir と同じ形) */
export function systemFontDirs(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, home?: string): string[];
```

- 受ける入口: `typeset`・`typesetToPdf` (`TypesetOptions` から)、器の設定 (`createTypesetter` の `TypesetterOptions`。書体まわりの設定なので器の側に置き、
  文書ごとの `DocumentOptions` には入れない)、コマンド (`--system-fonts`。`createSystemFonts()` を作って渡す。`--watch` で組み直すときも同じ部品を使い回す)、
  `kumiori/node` (`createSystemFonts`・`systemFontDirs`)。
- 型が部品 (`SystemFontSource`) なので、`true` を渡して使う形ではない。利用者の決めの「選択肢 `systemFonts`」は、この名前の選択肢に部品を渡す形で満たす
  (別の形の候補は 7 の 1)。
- **ブラウザでは**: `kumiori/node` を読めないので、OS の書体は探せない。`systemFonts` を渡さなければ、いまと同じ。
  `SystemFontSource` の形を自分で作れば (ブラウザの Local Font Access API の `queryLocalFonts()` などで)、ブラウザでも使える (Kumiori からは作らない。
  その API はまだ標準でなく、使える環境も限られる)。画面 (`index.html`・`src/main.ts`) は変えない。
- `systemFonts` が部品の形でない値 (`true` など) なら、ほかの選択肢と同じく `KumioriOptionError` にする (`optionsObject` などと同じ確かめ方)。
  `true` を渡したときの文には「Node では kumiori/node の createSystemFonts() を渡してください」と添える。

### 1.2 コマンド

- `--system-fonts`: 値を取らない。`createSystemFonts()` を `systemFonts` に渡す。
- `--no-outside-files` と一緒なら、`UsageError` (終わりの番号はほかの使い方の誤りと同じ):
  「--system-fonts は --no-outside-files と一緒に使えません (OS の書体のフォルダは、入力のディレクトリの外です)」/
  "--system-fonts cannot be combined with --no-outside-files (the OS font folders are outside the input directory)"。
- 使い方の文 (日英) と `--help` の一覧に足す。
- ライブラリには `--no-outside-files` にあたる選択肢が無い (`createFileResolver({ root })` で読む範囲を絞る形) ので、ライブラリでは誤りにしない。
  `docs/library.md` に「他人の書いた文書を組むときは、`systemFonts` を渡さない」と書く (4 の理由)。

## 2. 書体の探し方 (`src/nodeSystemFonts.ts`。新しいファイル。`kumiori/node` から出す)

### 2.1 OS ごとの場所 (`systemFontDirs`)

- **Linux など (下の 2 つ以外)**: fontconfig の設定のファイルを読んで、`<dir>` を集める。`fc-list` は呼ばない (下の理由)。
  - 設定のファイルは、環境変数 `FONTCONFIG_FILE` (あればそのファイル)、無ければ `FONTCONFIG_PATH` (あればその中の `fonts.conf`)、無ければ `/etc/fonts/fonts.conf`。
    fontconfig と同じ順 (fontconfig の説明書 fonts-conf(5) の「CONFIGURATION FILE FORMAT」と環境変数の節)。
  - 読むのは `<dir>` と `<include>` だけ。`<dir prefix="xdg">` は `$XDG_DATA_HOME` (無ければ `~/.local/share`) の下、`prefix="relative"` は設定のファイルのディレクトリの下、
    `~` で始まる道は home の下。`<include>` はファイルかディレクトリ (ディレクトリなら、その中の `*.conf` を名前の順に)。`ignore_missing` の有無によらず、無いものは飛ばす。
    `<include>` の入れ子は 8 段まで、同じファイルは 2 度読まない (循環を止める)。XML は `htmlparser2` の XML の読み方で読む (依存を足さない)。
  - 設定のファイルが無い・読めないときは、XDG Base Directory の決まりで `$XDG_DATA_HOME/fonts` (既定 `~/.local/share/fonts`)・`$XDG_DATA_DIRS` の各 `/fonts`
    (既定 `/usr/local/share/fonts`・`/usr/share/fonts`) と `~/.fonts` を使う。
  - 読まないもの: `<selectfont>` の `<rejectfont>`・`<acceptfont>` (書体を外す・足す決まり)、`<match>` (名前の写し替え)、`<cachedir>`。
    外すと決めた書体を拾うことはあるが、後備の書体を選ぶだけなので、害は小さい (7 に残さない。作ってから要れば足す)。
  - `fc-list` を呼ばない理由: 外のプログラムを動かすことになる (入っていない機械・コンテナが多い。動かす道 (PATH) を他人が変えられる環境もある)。
    設定の全部を正しく解くのは `fc-list` だが、ここで要るのは書体のファイルの場所だけで、字の範囲は自分で読む (2.2) ので、`<dir>` が分かれば足りる。
- **Windows**: `%WINDIR%\Fonts` (`WINDIR`、無ければ `SystemRoot`、無ければ `C:\Windows`) と、利用者ごとに入れた書体の
  `%LOCALAPPDATA%\Microsoft\Windows\Fonts` (Windows 10 1809 から)。レジストリ (`HKLM\…\Fonts`) は読まない (Node だけでは読めない。上の 2 つで、入れた書体のファイルはほぼ尽きる)。
- **macOS**: `/System/Library/Fonts` (下の `Supplemental` も)・`/Library/Fonts`・`~/Library/Fonts`。
  後から取り込む書体 (`/System/Library/AssetsV2/com_apple_MobileAsset_Font*`) は探さない (取り込んだかどうかで結果が変わり、場所も版で変わる)。
- どの OS でも、ディレクトリの中は下へたどる (fontconfig と同じ)。

### 2.2 読むファイルと、字の範囲の索引

- 拡張子が `.ttf`・`.otf`・`.ttc`・`.otc` のファイルだけ (大文字小文字を問わない)。先頭の 4 バイトで書体のファイルか確かめる (`looksLikeFont` と同じ)。
  `.fon` (Windows の bitmap)・`.pcf`・`.bdf`・`.pfb` (Type 1)・`.dfont` (macOS のリソースフォーク) は読まない (Kumiori が組めない形)。
- 1 つの書体ごとに、ファイルの全部を読まず、`fs.read` で次の所だけを読む:
  1. 先頭 (TTC なら `ttcf` の頭と、中の書体の目次の位置。OpenType 1.9 の「Font Collections」)。
  2. 表の目次 (table directory)。
  3. `cmap` (字の範囲。format 4・12 の部分表。Unicode の部分表 (platform 0、または platform 3 の encoding 1・10) を選ぶ。字形の番号 0 に当たる字は除く。
     format 13 (多くの字を 1 つの字形に当てる、最後の手段の書体のもの) は、字を持つとは数えない (どの字も同じ代わりの形で組んでしまう)。format 14 (異体字) は見ない)。
  4. `name` (ファミリー名 nameID 16・1、PostScript 名 nameID 6。英語のもの)。
  5. `OS/2` (`usWeightClass`・`usWidthClass`・`fsSelection` (傾き)・`fsType` (埋め込みの可否)・`ulCodePageRange1` (言語の手がかり)・`sFamilyClass`)。
  6. 輪郭の表 (`glyf`・`CFF `・`CFF2`) があるかを、表の目次で見るだけ (無ければ bitmap だけの書体なので選ばない)。
  ここだけの小さな sfnt の読み手を書く (fontkit はファイルの全部を要るので使わない。読むのは数 KB〜数百 KB)。
- 索引は、書体ごとに「字の範囲 (符号位置の始まりと終わりの組の並び。`Uint32Array`)」と上の値を持つ。探すときは、欠けた字ごとに、範囲を二分探索で引く。
  この環境の 111 書体で、範囲の組は合わせて数万ほど (`cmap` 2.1MB から)。1000 書体でも数 MB に収まる見込み。
- 索引は、`createSystemFonts` の部品が持つ (初めて `find` を呼んだときに作り、同じ部品の次の `find` では作り直さない)。
  器 (`createTypesetter`) やコマンドの `--watch` では、1 つの部品を使い回すので、索引を作るのは 1 度だけ。
- **ディスクの覚え (書体のキャッシュ `src/nodeFonts.ts` の置き場に、索引を JSON で置く) は、はじめは作らない** (推奨。7 の 3)。
  要る表だけ読めば、この環境で 30ms、大きな機械でも 1 秒ほどの見込みで、覚えの古さ (書体を入れ替えた後) を確かめる手間と危うさに見合わない。
  作ると決めたときは、置き場は `defaultFontCacheDir()` (`KUMIORI_FONT_CACHE` か OS のキャッシュの `kumiori/fonts`) の中の `system-fonts-index-v1.json`、
  中身はファイルごとの (実体のパス・大きさ・更新の時刻) と索引で、どれかが違うファイルだけを読み直す。書き方は、いまの書体のキャッシュと同じ (一時のファイルに書いてから名前を変える)。
  書体の中身は置かない (名前と字の範囲だけ)。

### 2.3 どの書体を先に使うか

欠けた字の集まりを、なるべく少ない書体で覆う (貪欲法: 残りの字をいちばん多く持つ書体を選び、その字を除いて繰り返す)。持つ字の数が同じなら、次の順で選ぶ。

1. **言語**: 漢字 (CJK 統合漢字とその拡張・互換漢字) を含むときは、文書の言語に合う `ulCodePageRange1` の印を持つ書体を先に
   (OpenType の `OS/2` の表: bit 17 日本語 (JIS)・bit 18 簡体字 (GB 2312)・bit 19 韓国語 (Wansung)・bit 20 繁体字 (Big5)・bit 21 韓国語 (Johab))。
   言語が無ければ日本語 (Kumiori の既定の書体と同じ側)。漢字を含まないときは、言語を見ない。
2. **形**: 太さが 400 に近い・傾いていない (`fsSelection` の ITALIC が無い)・幅が普通 (`usWidthClass` 5)。
   太字の指定の字は、いまと同じく、選んだ書体を太らせて描く (既定の書体の太字の無いときと同じ。`FontManager` の太らせ)。
3. **決まった順**: 実体のパスの順、同じファイルなら TTC の中の番号の順 (同じ機械なら、何度組んでも同じ書体になる)。

- 上の選び方は、**書体の種類 (明朝・ゴシック) ごとに** 行う (2.4)。種類の求め (`kinds`。既定は serif と sans) ごとに、欠けた字を覆う書体の並びを選ぶ。
- 1 つの文書で使う OS の書体の数に上限を置く (入力の上限に `systemFontFaces` を足す。既定 16、上げ下げできる。種類を合わせた分を合わせて数える)。
  超えたら残りの字は欠けたまま (`font/missing-glyph`)。上限に達したときは、どの種類にも 1 度は書体を割り当ててから (serif → sans の順に 1 つずつ) 残りを割り当てる。

### 2.4 書体の種類 (明朝・ゴシック) を合わせる

利用者の決め: 書体の種類を `OS/2` の `sFamilyClass` と PANOSE で分け、指定の書体 (font-family の並びが選んだ書体) と同じ種類の OS の書体を先に使う。
種類の合う書体が無い字は、ほかの種類の書体で補う。

**種類の決め方** (索引を作るときに、書体ごとに 1 度。読むのは `OS/2` の `sFamilyClass`・`panose` と `name`。どちらも 2.2 で読む表):

1. PANOSE (OpenType 1.9 の OS/2 の `panose`。PANOSE 2.0 の Latin Text の分類): `bFamilyType` が 2 (Latin Text) のとき、`bSerifStyle` が 2〜10 (Cove〜Triangle。セリフのあるもの) なら serif、
   11〜15 (Normal Sans・Obtuse Sans・Perpendicular Sans・Flared・Rounded) なら sans。`bFamilyType` が 3 (Latin Hand Written)・4 (Latin Decoratives)・5 (Latin Symbol) なら other。
   0・1 (Any・No Fit) は決めず、次へ。
2. `sFamilyClass` (OpenType 1.9 の「Family Class IDs」。上の 1 バイトが類): 1〜5・7 (Oldstyle Serifs・Transitional・Modern・Clarendon・Slab・Freeform) なら serif、8 (Sans Serif) なら sans、
   9 (Ornamentals)・10 (Scripts)・12 (Symbolic) なら other。0 (No Classification) は決めず、次へ。
3. 名前の手がかり (7.1 の 5): ファミリー名に明朝・Mincho・Serif・Song・Ming・Batang・Myeongjo があれば serif、
   ゴシック・Gothic・Sans・Hei・Gulim・Dotum があれば sans (いまの `GOTHIC` の正規表現 (`src/fontMapping.ts`) と同じ考え。Serif と Sans Serif は、Sans を先に見る)。
   CJK の書体は、PANOSE も `sFamilyClass` も 0 のものが多い (Noto Sans CJK・源ノ明朝など) ので、名前を見ないと、ほとんどが unknown になる。
4. どれでも決まらなければ unknown。

等幅 (PANOSE の `bProportion` 9) は種類にしない。等幅の指定の字の和文は、いまも和文の既定の側 (HTML はゴシック、XSL-FO は明朝) の書体で組むので、その側の種類で探せば足りる。

**指定の書体の種類**: 組版の側の書体 (`LoadedFont`) にも、同じ決め方で `kind` を持たせる (登録のときに、fontkit で開いた `OS/2`・`name` から)。
既定の書体は、決め方によらず、Noto Serif JP・Tinos・Kumiori Mono Serif の組は serif、Noto Sans JP・Arimo の組は sans に決めておく
(既定の書体の値で決めると、版の違いで変わりうるため)。総称の書体を差し替えたとき (`genericFonts`) は、差し替えた先の書体の決め方による。

**種類の合う書体が無い・種類が分からないときの扱い** (組版の側で、欠けた字の後備を探す順):

1. 指定の書体と同じ種類の OS の書体
2. 種類が unknown の OS の書体
3. ほかの種類の OS の書体 (serif ↔ sans。other は最後)

つまり、種類の合う書体が無い字は、unknown → ほかの種類の順で補う (利用者の推奨のとおり、補う)。指定の書体の種類が unknown (足した書体の種類が分からない) なら、
求める種類は既定の serif として扱う (Kumiori の既定の書体が明朝のため。7.1 の 6)。

**探す側 (`find`) の求め方**: 欠けた字が、どの種類の書体の文脈で出るかは、組む前には分からない (字の書体は、組版の中で `findForChar` が決める)。
そこで、欠けた字の全部を、`kinds` の種類ごと (既定は serif と sans の 2 つ) に探す。種類ごとに、2.3 の選び方を、その種類の書体だけで行い、
覆えなかった字は、unknown → ほかの種類の書体で補って選ぶ (返す `SystemFontMatch` の `forKind` が求めの種類、`kind` が書体の種類)。
同じ書体が 2 つの種類の求めに選ばれたら (種類の合う書体が 1 つしか無いときなど)、1 つにまとめて返す。

- 読み込む書体は、種類を合わせない場合の 2 倍ほどになりうるが、PDF に埋め込むのは組版で使った書体だけ (`src/pdfRenderer.ts` の `scan` が、字の領域の書体を集める) なので、
  使われなかった種類の書体は PDF を大きくしない。読み込む手間は増える (2 つ目の書体の中身を読む)。
- 求める種類を、文書で使う書体の種類だけに絞る作り (指定の書体の組を、組む前に font-family から決める) は、はじめはしない。
  写しの書体の組 (`fonts.all()`) に既定の明朝・ゴシックがいつも入るので、絞っても、ほとんどの文書で 2 つになる。
- **後の直し (0.6.0 の読み直し。2026-11-22)**: 上の 2 つの作りでは、明朝の文脈にしか無い字にもゴシックの書体を読み込み、組むのに使わなかった書体まで
  `font/system-fallback` (組みました) と知らせていた。そこで、次のように直した。
  - 組む前に、欠けた字ごとに、字の出る所の書体の指定 (文書の木の `fontFamily`・`fontWeight`。子が書かなければ親のもの) を見て、
    組版が先にする種類 (`FontManager.systemKindFor`。`fallbackOrder` の求めの種類と同じ決め方) を見込む (`missingCharKinds`。`src/fontMapping.ts`)。
  - `find` の求めに `charsByKind` (種類ごとに探す字) を足し、種類ごとに、その種類の所に出る字だけを探す。どの所にも出ない種類は求めない。
    見込みが外れても、組版は字を持つほかの種類の OS の書体で補う (豆腐にはならない)。
  - `font/system-fallback` は、組んだ後に、字の領域に使った書体ごとに、その書体で組んだ字だけで出す (PDF だけを作るときは、PDF に描くページで数える)。

## 3. 組版との関わり

### 3.1 いまの後備の選び方のどこに入るか

- `src/api.ts` の文書ごとの準備で、絵文字の書体を読み込んだ後、`font/missing-glyph` を出す前に、次を足す (`systemFonts` を渡したときだけ):
  1. `missingGlyphChars(fonts, doc)` の字を符号位置の順に並べ、`systemFonts.find({ chars, kinds: ['serif', 'sans'], lang, signal })` を呼ぶ (`rejoin(thisCall(), await …)` の形)。
  2. 返った書体ごとに、中身を読んで (`data()`)、`key` ごとに 1 度だけ登録する (読めなければ次の文書でまた試す)。
     登録は、器の `base` ではなく、書体ごとの小さな `FontManager` で行う (作る段で決めた。`base` に入れると、後の文書の写し (`fork`) にも、
     字の限り無しで入ってしまい、欠けていなかった字の書体の選び方が変わりうる)。読み込みの知らせ (`font/repaired` など) は覚えておき、使う文書ごとに出す。
     ファミリー名は、文書から名指しできない内部の名前 (`Kumiori System 1` のような番号。`installed` の名前の表 (`FontNameTable`) にも入れない) にする:
     文書の `font-family` で OS の書体を選べないようにする (あくまで後備。4 の探りも防ぐ)。
  3. 文書ごとの書体の組 (写し `fonts`) に、**その書体で組む字 (`match.chars`) だけを持つもの**として入れる:
     `FontManager` に `adopt(lf, { onlyChars })` を足し、写しの側に「この書体はこの字だけ」を覚える。`hasGlyph` は、その覚えがあれば、字がその中にあるときだけ真を返す。
     器の `base` の書体は文書をまたいで共通なので、限りは写し (文書) の側に持つ。
  4. 残った字を数え直して、いまと同じく `font/missing-glyph` を出す。
- 組版の側は、書体の種類を合わせるために 1 か所変える (`FontManager.findForChar` の後備の探し方):
  - いまは、基本の書体に無い字を、欧文の書体 → `fallbackOrder(weight)` の順に探す。この順のまま、**OS の書体 (`adopt` で限りを付けた書体) だけを、ほかの書体の後ろに置き、
    その中を 2.4 の順 (基本の書体と同じ種類 → unknown → ほかの種類) に並べる**。OS の書体でない書体 (既定・記号・絵文字・足した書体) の順は変えない。
  - 字ごとの後備の覚え (`charFallback`) の鍵は、いま `base.key|varKey|ch`。基本の書体ごとに覚えるので、種類で順が変わっても、鍵はこのままでよい。
  - OS の書体の限りと種類は、写し (文書) の側に持つ (`adopt(lf, { onlyChars, kind })`)。`fallbackOrder` は、写しの側の覚えを見て並べる。
  - 作る段で決めた形: 種類の決め方は `src/fontKind.ts` (`classifyFontKind`・`kindRank`。部品と `FontManager` で共有)。`fallbackOrder(weight, base)` に指定の書体を渡し、
    `findForChar`・`findInList` (font-family の並び)・`getForCluster` (書記素のまとまり) の 3 か所で使う。既定の書体の種類は、名前の表 (`DEFAULT_FONT_KINDS`) で決める。
- 限りを付けたので、OS の書体を選ぶのは、前は欠けていた字だけ。変わるのは、その字の形・幅と、それに続く行の分け方・位置。
  `systemFonts` を渡さなければ、OS の書体は写しに入らないので、`findForChar` の順はいまと同じ (OS の書体の並べ替えは、入っているときだけ効く)。
- 書記素のまとまり (結合文字など) で、元の字が OS の書体、結合する字が別の書体のとき、まとまりが 2 つの書体に分かれることがある。
  いまの記号の書体と同じ扱いで、作る段で例を組んで確かめる (分かれて困る例が出たら、まとまりの字を全部 `chars` に入れて探す)。
- 進み具合: 書体を読むたびに `reportProgress({ phase: 'fonts', … })`、止める合図は `find` に渡し、読み終えた後に `checkAbort()`。
- `HTML` の `line-height: normal` の行の高さ: 記号・絵文字の書体と同じく、書体の値では決めない (`metricsLineHeight` を立てない)。

### 3.2 字形の無い字の警告

| 診断 | 重さ | いつ |
| --- | --- | --- |
| `font/missing-glyph` (いまのまま) | error | OS の書体を探しても残った字。`systemFonts` を渡さなければ、いまと同じ字が出る |
| `font/system-fallback` (足す) | info | OS の書体で組んだ字があるとき、書体ごとに 1 件 (書体の名前・字・字の数)。結果が機械で変わることを、組んだ人に知らせる |
| `font/system-font-not-embeddable` (足す) | warning | 字を持つ OS の書体があったが、埋め込めない (`fsType`。3.4) ので使わなかったとき。字は `font/missing-glyph` にも出る |

- 探せなかったディレクトリ・読めなかったファイル (OS の書体のフォルダには、壊れたファイル・権限の無いファイルがある) は、知らせない
  (毎回同じ知らせが出て邪魔になる。数は `font/system-fallback` の詳しい値に入れてもよい)。
- コマンドでは、`--system-fonts` を付けずに `font/missing-glyph` が出たとき、文の終わりに「(--system-fonts で、OS の書体を探せます)」を 1 度だけ添える
  (`src/cli.ts` の診断の文の組み立て)。ライブラリの診断の文は変えない。
- 足す診断は、`src/diagnostics.ts` の名前・重さ・種類の表と、`docs/diagnostics.md` (日英) の表に足す。

### 3.3 器の覚え (`FontPrepCache`) との関係

- OS の書体は、器が書体の印ごとに 1 度だけ登録し (器の `base` には入れない。3.1 の 2)、文書ごとの写しは `adopt` で入れる。
  下ごしらえ (WOFF2 の戻し・CFF2 の変換など) は、登録のときに 1 度だけ。`FontPrepCache` (写しが文書の書体を登録するときに、同じ中身なら下ごしらえを使い回す覚え) は通らない。
- 器の `reuse: false` のときも、読み込んだ OS の書体は器が持ち続ける (記号の書体と同じ)。
- 段落の行分けの使い回し (`SharedLineMemo`) は、書体の組の印が同じときだけ使う。OS の書体を足した文書は、写しの書体の組が変わるので、印が変わる
  (作る段で、印に「限りを付けた書体と字」が入ることを確かめる。入らないと、前の文書の、欠けた字を豆腐で組んだ行分けを使い回してしまう)。
- 索引 (2.2) は、器ではなく `createSystemFonts` の部品が持つ。器をいくつ作っても、同じ部品を渡せば、索引は 1 つ。

### 3.4 PDF への埋め込み (`fsType`)

OpenType の `OS/2` の表の `fsType` (OpenType 1.9 の OS/2 の節) で、次のどれかの書体は選ばない (索引には残し、`font/system-font-not-embeddable` に使う)。

- bit 1 (0x0002。Restricted License embedding): 埋め込んではならない。
- bit 9 (0x0200。Bitmap embedding only): 輪郭を埋め込めない。
- bit 8 (0x0100。No subsetting): Kumiori は、既定では書体を字の部分集合にして埋め込む (`src/pdfRenderer.ts` の `embedFont`。PDF の設定の `subset` が既定 true) ので、守れない。
  組んだ後の PDF の設定で `subset: false` にすれば守れるが、組版の時には PDF の設定が分からず、CJK の書体では PDF が数十 MB になる。はじめは選ばない。

bit 2 (Preview & Print)・bit 3 (Editable) と 0 (Installable) は、使ってよい。PDF/A・PDF/X は書体の埋め込みを求める (PDF/A は ISO 19005-2 §6.2.11.4) ので、
埋め込めない書体を選ばないことは、それらの確かめとも合う。SVG・PNG に書き出すときも同じ書体を使う (書き出しの形で選び直さない。組版の結果を同じにする)。

### 3.5 入力の上限 (`fontBytes`・`fontCollectionBytes`) との関係

- 索引を作るとき: `.ttf`・`.otf` でファイルが `fontBytes` (既定 128MB) より大きいもの、`.ttc`・`.otc` で `fontCollectionBytes` (既定 1GB) より大きいものは、索引に入れない
  (macOS の `Apple Color Emoji.ttc` のように 128MB を超える書体もあるが、絵文字は先に Noto Emoji で組むので、困らない)。読むのは表の一部なので、索引を作る手間は大きさによらない。
- 中身を読むとき (`data()`): TTC は、ファイルの全部を読んでから、要る 1 つの書体だけを取り出す (`src/fontLoader.ts` の `extractFromCollection(buf, index)`。
  作る段で、この関数が既にあると分かった)。取り出した書体は `fontBytes` で確かめる。
- 上限は、索引を作ったときの呼び出しの値で見る (索引は部品が持ち、呼び出しをまたぐので)。中身を読むときは、その呼び出しの値で見る。
- 書体の数: 探すファイルは `maxFiles` (既定 20000。部品の設定)、1 つの文書で使う書体は `systemFontFaces` (既定 16。入力の上限。2.3)。

## 4. 安全

- **外のファイルを読むこと**: OS の書体のフォルダは、入力のディレクトリの外にある。読むのは、OS・fontconfig の設定 (機械の管理者か組む人が書いたもの) が示す場所だけで、
  文書は場所を変えられない。ただし、文書は「どの字を欠けさせるか」を選べるので、組んだ PDF から「その機械にどの書体が入っているか」を探れる
  (PDF に埋め込まれた書体の名前と字形)。他人の書いた文書を組むサーバーでは、機械の様子が漏れる。そこで:
  - `--no-outside-files` (他人の書いた文書を組むときの指定) と一緒なら、誤りにする (利用者の決め)。黙って片方を外さない。
  - 文書の `font-family` から OS の書体を名指しできないようにする (3.1 の 2。後備に使うだけ)。名指しできると、欠けた字を作らなくても、名前で探れてしまう。
  - `docs/library.md` に、他人の書いた文書を組むときは `systemFonts` を渡さないことを書く。
- **シンボリックリンク**: OS の書体のフォルダは、リンクが多い (Debian の `/usr/share/fonts/truetype/…` が別のパッケージの場所を指す、など)。
  リンクはたどる (fontconfig と同じ)。ただし、たどった実体のパス (`fs.realpathSync`) で、同じディレクトリ・ファイルは 1 度だけ見る (循環で止まらない。同じ書体を 2 つ数えない)。
  下へたどるのは 16 段まで。ふつうのファイル (`isFile`) とディレクトリだけを見る (デバイス・FIFO などは開かない。FIFO を開くと止まるため)。
  中身を読む (`data()`) ときは、索引を作ったときの実体のパスを読み、大きさと更新の時刻が索引と違えば読まない (索引を作った後に差し替えられたファイルを、確かめずに使わない)。
- **大きな書体の数**: `maxFiles` と、索引に入れる大きさの上限 (3.5)。1 つのファイルから読む表の大きさにも上限を置く (`cmap`・`name` は 16MB まで。壊れた目次で大きな読みを起こさない)。
- **探す手間**: 欠けた字の無い文書では探さない。索引は部品ごとに 1 度。
- **環境変数**: `FONTCONFIG_FILE`・`XDG_*`・`WINDIR`・`LOCALAPPDATA`・`HOME` を読む。これらは組む人の環境で、文書からは変えられない。

## 5. 試験の案 (手元の OS の書体に頼らない)

- **仮の書体を作る**: 試験の中で、小さな TrueType を組み立てる手助け (`test/sfntTestFont.ts`。`head`・`hhea`・`maxp`・`OS/2`・`name`・`cmap` (format 4・12)・`loca`・`glyf`
  (四角の字形)・`hmtx`・`post`) を足す。持たせる字・ファミリー名・太さ・`fsType`・`ulCodePageRange1` を引数で決める。
  字は、既定の書体のどれも持たない私用の領域 (U+F0000 など) と、記号の書体にも絵文字の書体にも無い字を使う。TTC (`ttcf` の頭で 2 つを束ねたもの) も作る。
  書体のファイルをリポジトリに入れない (作った書体は試験の一時のディレクトリに書く)。
- **探す場所を差し替える**: `createSystemFonts({ dirs: [一時のディレクトリ] })` で、OS の書体を見ない。
  `systemFontDirs(env, platform, home)` は引数だけで決まる関数なので、Linux (fontconfig の設定のファイル。`<include>`・`prefix="xdg"`・`~`・循環・無いファイル)・Windows・macOS の
  場所を、一時のディレクトリに設定のファイルを書いて試す。
- **部品の試験** (`test/systemFonts.test.ts`): 字の範囲の読み (format 4・12・13)、TTC の中の番号、貪欲法の選び方と決まった順 (言語の印・太さ・パスの順)、
  `fsType` で選ばないこと、大きさの上限・`maxFiles`、リンクの循環・同じ実体の重なり・FIFO を開かないこと、索引を作った後にファイルを差し替えたら読まないこと。
- **種類の試験**: 仮の書体に `sFamilyClass`・PANOSE・名前を持たせ、2.4 の決め方 (PANOSE → `sFamilyClass` → 名前 → unknown) を確かめる。
  明朝の文脈 (font-family が serif) とゴシックの文脈の同じ欠けた字が、それぞれ同じ種類の OS の書体で組まれること、
  種類の合う書体が無ければ unknown → ほかの種類で補うこと、足した書体の種類が unknown なら serif の側を探すこと。
- **組版の試験**: 欠けた字のある文書を `systemFonts` 付きで組み、`font/missing-glyph` が消えて `font/system-fallback` が出ること、PDF に書体が埋め込まれること、
  ほかの字の位置が `systemFonts` 無しのときと同じこと (領域の木で比べる)、欠けた字の無い文書では `find` を呼ばないこと (数える偽の部品で)、
  `font-family` に内部の名前を書いても選ばれないこと、器で 2 つの文書を組んで書体の読み込みが 1 度だけのこと・限りが文書ごとのこと (2 つ目の文書で、1 つ目の字の限りが残らない)、
  止める合図で止まること。`test/callContextAwait.test.ts` が、足した await の形を確かめる。
- **コマンドの試験**: `--system-fonts` と `--no-outside-files` の誤り、使い方の文 (日英)。Linux では `FONTCONFIG_FILE`・`XDG_DATA_DIRS`・`XDG_DATA_HOME`・`HOME` を一時のディレクトリに向けて
  子のプロセスを動かし、仮の書体で組めること (Windows・macOS の場所は、関数の試験だけ)。
- **文書の試験**: `test/docsTables.test.ts` が、`docs/library.md` の表と公開の型の欄 (`systemFonts`・`systemFontFaces`) を突き合わせる。診断の表も同じ。
- 前と後の組み比べ (`npm run compare:base`) と領域の木の指紋は、選択肢を使わないので変わらないはず (変わらないことを確かめる)。

## 6. 大きさの見積もりと、作る段の分け方

| 部分 | 見積もり (行) |
| --- | --- |
| `src/nodeSystemFonts.ts` (場所・fontconfig の設定・sfnt の表の読み・索引・選び方・部品) | 450〜550 |
| `src/api.ts`・`src/fontManager.ts` (`adopt` の限り)・`src/fontLoader.ts` (`collectionFace`)・`src/limits.ts`・`src/diagnostics.ts`・`src/node.ts`・型 | 150〜200 |
| 書体の種類 (2.4。決め方は部品と `FontManager` で共有する小さな関数。`findForChar` の後備の並べ替え・既定の書体の種類) | 150〜200 |
| `src/cli.ts` (選択肢・誤り・使い方の文・知らせの添え書き) | 40〜60 |
| 文書 (`docs/library.md`・`docs/diagnostics.md`・コマンドの説明・README・CHANGELOG。日英) | 120〜160 |
| 試験 (仮の書体の手助け・部品・組版・コマンド) | 500〜650 |

合わせて 1500〜1900 行ほど (種類の試験を含む)。作る段は 4 回のコミットに分ける。

1. OS の書体を探して字の範囲の索引を作る部品 (`createSystemFonts`・`systemFontDirs` を `kumiori/node` から出す。まだ組版にはつながない) と、仮の書体の手助け・部品の試験。
2. 組版につなぐ: `systemFonts` の選択肢 (`TypesetOptions`・`TypesetterOptions`)、文書の字だけに限った登録、`fsType`、`systemFontFaces` の上限、
   診断 2 つ、`docs/library.md`・`docs/diagnostics.md` (日英)、組版の試験。この段では、種類は見ずに、OS の書体を登録の順で使う。
3. 書体の種類を合わせる (2.4): 種類の決め方、`find` の種類ごとの選び方、`LoadedFont` の `kind` と既定の書体の種類、`findForChar` の OS の書体の並べ替え、種類の試験。
   2 と分けるのは、`FontManager` の後備の探し方を変える所だけを 1 つのコミットで見られるようにするため (落ちたら、ここだけを戻せる)。
4. コマンドの `--system-fonts` と `--no-outside-files` の誤り、使い方の文・知らせの添え書き、README・CHANGELOG (日英)、コマンドの試験。

確かめ: どの段も `npm run typecheck`・`npm test`。画面は変えないので `npm run e2e` は要らない。2 の後に、指紋の試験と `npm run compare:base` で、既定の結果が変わらないことを見る。

## 7. 決め

### 7.1 決めたこと (2026-11-22。利用者)

1. `systemFonts` の形: `kumiori/node` の `createSystemFonts()` が作る部品を渡す (推奨どおり)。
2. 明朝・ゴシック: **合わせる** (推奨と違う)。`sFamilyClass`・PANOSE で種類を分け、指定の書体と同じ種類の書体を先に使う。種類の合う書体が無ければ、ほかの種類で補う (2.4)。
3. 索引: はじめはディスクに覚えない (推奨どおり)。
4. 使う順: 記号・絵文字の書体が先、その後に OS の書体 (推奨どおり)。
5. 書体の種類を決めるのに、名前も見る (推奨どおり)。PANOSE → `sFamilyClass` → 名前の順 (2.4)。
6. 指定の書体の種類が分からない (足した書体が unknown) ときは、serif の側を先に探し、unknown・sans で補う (推奨どおり)。

候補として並べた、選ばなかった形 (1 の `systemFonts: true`・`kumiori/node` の包み、3 のディスクの覚え、4 の OS の書体を先に、
5 の `sFamilyClass`・PANOSE だけ、6 の種類を問わない) は、作らない。

### 7.2 決めてほしいこと

いまは無い。作る段で判断の要る所が出たら、推奨と候補を付けて取りまとめ役に知らせる。
