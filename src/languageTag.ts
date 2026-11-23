/**
 * languageTag — 言語のタグ (BCP 47。RFC 5646) を読む小さな道具。
 *
 * XSL-FO の language は ISO 639-2 の 3 字の符号でもよい (XSL 1.1 §7.10 の分綴の性質の language) ので、
 * 2 字の符号のある言語の 3 字の符号 (書誌用 B と用語用 T の両方) を 2 字に直す (RFC 5646 §2.2.1: 2 字の符号のある言語は 2 字で書く)。
 */

/** ISO 639-2 の 3 字の符号 → ISO 639-1 の 2 字の符号 (よく使う言語と、分綴の規則を持つ言語) */
const ISO639_2_TO_1: Record<string, string> = {
  jpn: 'ja', eng: 'en', zho: 'zh', chi: 'zh', kor: 'ko', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', spa: 'es', ita: 'it', por: 'pt', rus: 'ru', nld: 'nl', dut: 'nl',
  swe: 'sv', dan: 'da', nor: 'no', fin: 'fi', pol: 'pl', ces: 'cs', cze: 'cs', ell: 'el', gre: 'el', tur: 'tr', ara: 'ar', heb: 'he', hin: 'hi', tha: 'th', vie: 'vi',
  cat: 'ca', slk: 'sk', slo: 'sk', slv: 'sl', hrv: 'hr', est: 'et', lit: 'lt', lav: 'lv', gle: 'ga', cym: 'cy', wel: 'cy', glg: 'gl', eus: 'eu', baq: 'eu',
  isl: 'is', ice: 'is', hun: 'hu', srp: 'sr', bul: 'bg', nob: 'nb', nno: 'nn', lat: 'la', ukr: 'uk', ron: 'ro', rum: 'ro', ind: 'id', mkd: 'mk', mac: 'mk',
  bel: 'be', bos: 'bs',
};

/** 言語の符号 (初めの部分) を 2 字に直す (3 字の符号で、2 字の符号のあるもの)。小文字にする */
export function primaryLanguage(code: string): string {
  const b = code.toLowerCase();
  return ISO639_2_TO_1[b] ?? b;
}

/**
 * ISO 3166-1 の国の符号: 3 字の符号 (alpha-3)・2 字の符号 (alpha-2)・3 桁の数字の符号 (numeric) を、この順に続けて 1 つの項にしたもの (空白で区切る)。
 * XSL-FO の country は ISO 3166 の符号 (XSL 1.1 §7.10.1) で、3 字や数字で書いてもよいが、言語のタグの地域は、2 字の符号のある国は 2 字で書く
 * (RFC 5646 §2.2.4)。3 字の符号は、言語のタグの中では拡張の言語 (extlang) と区別できないので、地域にするときに 2 字に直す
 */
const ISO3166 =
  'ABWAW533 AFGAF004 AGOAO024 AIAAI660 ALAAX248 ALBAL008 ANDAD020 AREAE784 ARGAR032 ARMAM051 ASMAS016 ATAAQ010 ATFTF260 ATGAG028 AUSAU036 AUTAT040 ' +
  'AZEAZ031 BDIBI108 BELBE056 BENBJ204 BESBQ535 BFABF854 BGDBD050 BGRBG100 BHRBH048 BHSBS044 BIHBA070 BLMBL652 BLRBY112 BLZBZ084 BMUBM060 BOLBO068 ' +
  'BRABR076 BRBBB052 BRNBN096 BTNBT064 BVTBV074 BWABW072 CAFCF140 CANCA124 CCKCC166 CHECH756 CHLCL152 CHNCN156 CIVCI384 CMRCM120 CODCD180 COGCG178 ' +
  'COKCK184 COLCO170 COMKM174 CPVCV132 CRICR188 CUBCU192 CUWCW531 CXRCX162 CYMKY136 CYPCY196 CZECZ203 DEUDE276 DJIDJ262 DMADM212 DNKDK208 DOMDO214 ' +
  'DZADZ012 ECUEC218 EGYEG818 ERIER232 ESHEH732 ESPES724 ESTEE233 ETHET231 FINFI246 FJIFJ242 FLKFK238 FRAFR250 FROFO234 FSMFM583 GABGA266 GBRGB826 ' +
  'GEOGE268 GGYGG831 GHAGH288 GIBGI292 GINGN324 GLPGP312 GMBGM270 GNBGW624 GNQGQ226 GRCGR300 GRDGD308 GRLGL304 GTMGT320 GUFGF254 GUMGU316 GUYGY328 ' +
  'HKGHK344 HMDHM334 HNDHN340 HRVHR191 HTIHT332 HUNHU348 IDNID360 IMNIM833 INDIN356 IOTIO086 IRLIE372 IRNIR364 IRQIQ368 ISLIS352 ISRIL376 ITAIT380 ' +
  'JAMJM388 JEYJE832 JORJO400 JPNJP392 KAZKZ398 KENKE404 KGZKG417 KHMKH116 KIRKI296 KNAKN659 KORKR410 KWTKW414 LAOLA418 LBNLB422 LBRLR430 LBYLY434 ' +
  'LCALC662 LIELI438 LKALK144 LSOLS426 LTULT440 LUXLU442 LVALV428 MACMO446 MAFMF663 MARMA504 MCOMC492 MDAMD498 MDGMG450 MDVMV462 MEXMX484 MHLMH584 ' +
  'MKDMK807 MLIML466 MLTMT470 MMRMM104 MNEME499 MNGMN496 MNPMP580 MOZMZ508 MRTMR478 MSRMS500 MTQMQ474 MUSMU480 MWIMW454 MYSMY458 MYTYT175 NAMNA516 ' +
  'NCLNC540 NERNE562 NFKNF574 NGANG566 NICNI558 NIUNU570 NLDNL528 NORNO578 NPLNP524 NRUNR520 NZLNZ554 OMNOM512 PAKPK586 PANPA591 PCNPN612 PERPE604 ' +
  'PHLPH608 PLWPW585 PNGPG598 POLPL616 PRIPR630 PRKKP408 PRTPT620 PRYPY600 PSEPS275 PYFPF258 QATQA634 REURE638 ROURO642 RUSRU643 RWARW646 SAUSA682 ' +
  'SDNSD729 SENSN686 SGPSG702 SGSGS239 SHNSH654 SJMSJ744 SLBSB090 SLESL694 SLVSV222 SMRSM674 SOMSO706 SPMPM666 SRBRS688 SSDSS728 STPST678 SURSR740 ' +
  'SVKSK703 SVNSI705 SWESE752 SWZSZ748 SXMSX534 SYCSC690 SYRSY760 TCATC796 TCDTD148 TGOTG768 THATH764 TJKTJ762 TKLTK772 TKMTM795 TLSTL626 TONTO776 ' +
  'TTOTT780 TUNTN788 TURTR792 TUVTV798 TWNTW158 TZATZ834 UGAUG800 UKRUA804 UMIUM581 URYUY858 USAUS840 UZBUZ860 VATVA336 VCTVC670 VENVE862 VGBVG092 ' +
  'VIRVI850 VNMVN704 VUTVU548 WLFWF876 WSMWS882 YEMYE887 ZAFZA710 ZMBZM894 ZWEZW716 ';

let iso3166Map: Map<string, string> | undefined;

/**
 * 国の符号 (ISO 3166-1 の 2 字・3 字・3 桁の数字) を、言語のタグの地域 (2 字。大文字) に直す。知らない 3 字・数字の符号と、形の合わないものは undefined
 */
export function countryToRegion(code: string): string | undefined {
  const c = code.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(c)) return c;
  if (!/^([A-Z]{3}|\d{3})$/.test(c)) return undefined;
  if (!iso3166Map) {
    iso3166Map = new Map();
    for (const e of ISO3166.split(' ')) {
      if (!e) continue;
      iso3166Map.set(e.slice(0, 3), e.slice(3, 5));
      iso3166Map.set(e.slice(5, 8), e.slice(3, 5));
    }
  }
  return iso3166Map.get(c);
}

/** 言語のタグを部分に分けたもの (どれも小文字) */
export interface LanguageTagParts {
  /** 言語 (2 字に直したもの) */
  language: string;
  /** 文字 (4 字。latn・cyrl など) */
  script?: string;
  /** 地域 (2 字か 3 桁) */
  region?: string;
  /** 異形 (1901・polyton など) */
  variants: string[];
}

/** 古い登録のタグ (RFC 5646 §2.2.8 の grandfathered・redundant のうち、言語の符号だけで言えるもの) */
const LEGACY_TAGS: Record<string, string> = { 'no-bok': 'nb', 'no-nyn': 'nn' };

/**
 * 言語のタグを部分に分ける (RFC 5646 §2.1 の langtag)。`_` も区切りとして読む。拡張と私用 (1 字の部分の後ろ) は外す。
 * 空のタグは undefined
 */
export function parseLanguageTag(tag: string): LanguageTagParts | undefined {
  let l = tag.trim().toLowerCase().replace(/_/g, '-');
  for (const [k, v] of Object.entries(LEGACY_TAGS)) if (l === k || l.startsWith(`${k}-`)) l = v + l.slice(k.length);
  const parts = l.split('-');
  if (!parts[0] || parts[0].length === 1) return undefined;
  const out: LanguageTagParts = { language: primaryLanguage(parts[0]), variants: [] };
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p.length === 1) break;
    if (/^[a-z]{3}$/.test(p) && i <= 3 && !out.script && !out.region && !out.variants.length) continue; // 拡張の言語 (extlang)
    if (/^[a-z]{4}$/.test(p) && !out.script && !out.region && !out.variants.length) out.script = p;
    else if (/^([a-z]{2}|\d{3})$/.test(p) && !out.region && !out.variants.length) out.region = p;
    else out.variants.push(p);
  }
  return out;
}
