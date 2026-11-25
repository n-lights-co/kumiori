# 確認するための自作のサンプル

アンテナハウスのサンプル FO 集などのサンプルに無い形を、組版ソフトがどう組むかを確認するための、自作の小さな文書です。
どれも Kumiori の開発者が書いたもので、他の人の著作物は含みません (サンプルの PDF や他社の製品の出力は、ここに入れません)。

各文書には、確認する箇所の近くに、読み方ごとに文字が来るはずの位置を赤い ▼ の目印で置いています。
目印は、確認する性質に関わらない所 (外のフロー) に、位置を明示して置いたものです。
そのため、どの組版ソフトで組んでも、文字が A・B どちらの目印にそろうかを見れば、そのソフトの読み方が分かります。

| 文書 | 確認すること |
| --- | --- |
| `fo/indent-inheritance-1.fo` | 字下げ (start-indent) の、表のセルの中・リストの本体の中への受け継ぎ (XSL 1.1 §5.3.2・§6.7.10・§6.8.4・§6.8.5・§7.30.4)。全 10 ケース |

## indent-inheritance-1.fo の、いまの Kumiori の結果

x は本文の領域の左端から測った値 (`pdftotext -bbox-layout` で拾った ◆ の左端)。
仕様モード (`--compat spec`) は XSL 1.1 どおり。互換モード (`--compat antenna`) は、受け継がない従来の読み方のまま
(AH Formatter の出力でどちらの読み方かを確認していないため)。確認するテストは `test/foIndentInheritance.test.ts`。

| ケース | 仕様 (A) | 受け継がない・本体の始端から測る (B) | Kumiori 仕様モード | Kumiori 互換モード |
| --- | --- | --- | --- | --- |
| 1. start-indent="20mm" の中の表のセル | 40mm | 20mm | 40mm (A) | 20mm (B) |
| 2. margin-left="20mm" の中の表のセル | 40mm | 20mm | 40mm (A) | 20mm (B) |
| 3. 2 と同じで、表に margin-left="0pt" | 40mm | 20mm | 40mm (A) | 20mm (B) |
| 4. 対照: セルの中で start-indent="5mm" | 25mm | 25mm | 25mm | 25mm |
| 5. リストの本体 (30mm) の中の表のセル | 60mm | 30mm | 60mm (A) | 30mm (B) |
| 6. 入れ子のリスト (body-start() だけ) | ラベル 20mm・本体 40mm | 同じ | 20mm・40mm | 20mm・40mm |
| 7. 入れ子のリスト (長さで書いたもの) | ラベル 25mm・本体 45mm | 45mm・65mm | 25mm・45mm (A) | 45mm・65mm (B。ラベルは 63mm まで) |
| 8. 本体の中で start-indent="30mm" | 30mm | 50mm | 30mm (A) | 50mm (B) |
| 9. 本体の中で margin-left="5mm" | 25mm | 5mm | 25mm (A) | 25mm (A) |
| 10. 本体の中で from-parent(start-indent) + 5mm | 25mm | 5mm | 25mm (A) | 20mm (from-parent() を読まない。警告が出る) |

ケース 7 の互換モードでは、`label-end()` の位置 (外の本体の始端から 23mm) がラベルの start-indent (25mm) より手前になる。
前はラベルの幅が 0 になり、文字が 1 字ずつ縦に割れていた。いまは、どちらのモードでも、そういうときはラベルの終端を
本体の始端から provisional-label-separation だけ手前にする (互換モードではラベルが 45mm〜63mm になる。AH Formatter がどう組むかは確認していない)。

## 組み方と比べ方

```bash
npm run build:cli
mkdir -p out/spec out/antenna   # 入力が 1 つのとき、コマンドは出力先のディレクトリを作らない
node dist-cli/cli.js samples/check/fo/indent-inheritance-1.fo -o out/spec/indent-inheritance-1.pdf --compat spec
node dist-cli/cli.js samples/check/fo/indent-inheritance-1.fo -o out/antenna/indent-inheritance-1.pdf --compat antenna
```

ほかの組版ソフト (AH Formatter など) の出力が手に入ったら、それを左にして比べる:

```bash
node scripts/compare-view.mjs --ref <ほかのソフトの PDF のディレクトリ> --pdf out/antenna --ref-label "AH Formatter" --pdf-label "Kumiori 互換"
```

ほかのソフトの出力 (PDF) は、そのソフトの利用条件によっては公開できないので、リポジトリには入れない。
