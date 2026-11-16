/**
 * shellArg — scripts/ci-local.mjs が npm を shell を通して動かすとき (Windows) の、コマンドの引数の囲み方。
 *
 * Windows では npm は npm.cmd (バッチファイル) で、Node は .cmd・.bat を shell なしで動かすのを拒む
 * (spawn が EINVAL になる。Node 18.20.2・20.12.2 からの、バッチファイルの引数の扱いの脆弱性 CVE-2024-27980 への対応) ので、
 * ci-local.mjs は shell: true で動かす。このとき Node は引数を空白でつないだだけの 1 本のコマンド行を cmd.exe に渡すので、
 * 空白を含む引数は、こちらで囲んでおかないと分かれてしまう。
 */

/**
 * 1 つの引数を、Microsoft の C ランタイムのコマンド行の解析 (Microsoft の文書「Parsing C command-line arguments」) で
 * 元の文字列に戻るように、" で囲む。npm.cmd は受けた引数をそのまま node.exe に渡し、node.exe はこの決まりで引数に分けるため。
 * 決まり: \ は、" の直前に続くときだけ特別で、2n 個の \ と " は n 個の \ と区切りの "、2n+1 個の \ と " は n 個の \ と字の " になる。
 * なので、" の直前に続く \ を 2 倍にしてから \" にし、閉じの " の直前に来る終わりの \ も 2 倍にする。ほかの \ はそのまま。
 *
 * cmd.exe の特別な字 (& | < > ^ など) は、" で囲んだ中では効かないが、% (と、遅延展開が有効なときの !) は囲んだ中でも展開され、
 * 引数の中の " は cmd.exe の囲みを閉じてしまう。ここでは扱わない: 渡すのは ci-local.mjs が os.tmpdir() の下に mkdtemp で作るパス
 * (Windows のパスには " を書けず、%名前% と読める並びが入ることも実際には無い) だけのため。
 * @param {string} s
 * @returns {string}
 */
export function quoteWindowsArg(s) {
  // 正規表現は、前の \ ごと (/(\\*)"/g)・終わりの \ の並び (/(\\+)$/) を置き換える。\ を数えずに " だけを \" にすると、
  // a\"b (\\" は \ と区切りの " になる) や、\ で終わる引数 (C:\dir with space\ の閉じの " が \" になる) で囲みが崩れる
  const body = s.replace(/(\\*)"/g, (_, bs) => `${bs}${bs}\\"`).replace(/(\\+)$/, (_, bs) => `${bs}${bs}`);
  return `"${body}"`;
}

/**
 * コマンドの引数を、shell を通すとき (Windows) のために囲む。Windows でないとき (shell を通さず、引数をそのまま渡す) と、
 * 空白・" の無い引数は、そのまま返す (空の引数は、消えないように "" にする)
 * @param {string} s
 * @param {string} [platform] process.platform に当たるもの (テストで変える)
 * @returns {string}
 */
export function shellArg(s, platform = process.platform) {
  if (platform !== 'win32') return s;
  return s === '' || /[\s"]/.test(s) ? quoteWindowsArg(s) : s;
}
