/**
 * 時間を確かめる試験の道具。機械の速さと負荷 (ほかの試験のワーカー・e2e・ビルドが同じ機械で走ること) に揺れにくい形で測る。
 *
 * 決めごと:
 *  - 測るのは、壁の時計ではなく、このスレッドの CPU の時間 (process.threadCpuUsage。無い版の Node では process.cpuUsage)。
 *    ほかのプロセスに CPU を取られて待った時間は入らないので、負荷で延びにくい。
 *    vitest はテストのファイルごとに別のプロセス (forks) で走るので、process.cpuUsage でも、ほかのファイルの試験の時間は入らない
 *  - 1 度で決めず、何度か測って一番短い値を取る (遅れの揺れは足し算でしか入らないので、一番短い値が本当の手間に近い)。
 *    上限の内に入った時点で止めるので、通るときの手間は 1 度分で済む
 *  - 上限を大きく超えた (既定で 10 倍) ときは、測り直さずに落とす (2 乗や指数の手間が戻ったときに、試験を長く待たせない)
 *  - 伸び方の試験 (growth) は、大きさ n と k·n を交互に測り、それぞれの一番短い値の比を見る。機械の速さが比に出ないので、上限の数を機械ごとに変えなくてよい
 *  - 遅い機械 (CI の小さな機械・Node の下限の確かめ) では、環境変数 KUMIORI_TIME_SCALE (既定 1) で、時間の上限だけを何倍かにできる (比の上限は変えない)
 */
import { expect } from 'vitest';

/** 時間の上限に掛ける倍率 (環境変数 KUMIORI_TIME_SCALE。既定 1) */
export const TIME_SCALE = Math.max(1, Number(process.env.KUMIORI_TIME_SCALE) || 1);

/**
 * このスレッドの CPU の時間 (ミリ秒)。壁の時計 (Date.now・performance.now) の代わりに、差を取って使う
 * (1 度だけ測る試験でも、ほかのプロセスに CPU を取られて待った時間が入らない)
 */
export function cpuClock(): number {
  const u = typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage() : process.cpuUsage();
  return (u.user + u.system) / 1000;
}
const cpuNow = cpuClock;

/** 時間の上限 (ミリ秒) に KUMIORI_TIME_SCALE を掛ける */
export const scaled = (ms: number): number => ms * TIME_SCALE;

/** f を 1 度走らせ、このスレッドの CPU の時間 (ミリ秒) と f の値を返す (f が Promise を返すときは、終わりまで待つ) */
export async function cpuMs<T>(f: () => T | Promise<T>): Promise<{ ms: number; value: T }> {
  const t0 = cpuNow();
  const value = await f();
  return { ms: cpuNow() - t0, value };
}

/** f を reps 度走らせ、CPU の時間の一番短い値を返す */
export async function bestCpuMs(f: () => unknown, reps = 3): Promise<number> {
  let best = Infinity;
  for (let i = 0; i < reps; i++) best = Math.min(best, (await cpuMs(f)).ms);
  return best;
}

export interface WithinOptions {
  /** 上限の内に入らないときに測り直す回数の合計 (既定 3) */
  reps?: number;
  /** 上限のこの倍を超えたら、測り直さずに落とす (既定 10) */
  giveUp?: number;
  /** 落ちたときの文に入れる名前 */
  label?: string;
}

/**
 * f の CPU の時間が limitMs (× KUMIORI_TIME_SCALE) の内であることを確かめる。上限を超えたら、reps 度まで測り直し、一番短い値で決める。
 * f の値 (最後に走らせた回のもの) を返すので、結果の中身も確かめられる
 */
export async function expectWithin<T>(limitMs: number, f: () => T | Promise<T>, o: WithinOptions = {}): Promise<T> {
  const limit = limitMs * TIME_SCALE;
  const reps = o.reps ?? 3;
  let best = Infinity;
  let value!: T;
  for (let i = 0; i < reps; i++) {
    const r = await cpuMs(f);
    value = r.value;
    best = Math.min(best, r.ms);
    if (best <= limit || r.ms > limit * (o.giveUp ?? 10)) break;
  }
  expect(best, `${o.label ?? '時間'}: CPU ${best.toFixed(0)}ms (上限 ${limit.toFixed(0)}ms)`).toBeLessThanOrEqual(limit);
  return value;
}

export interface GrowthOptions {
  /** 大きさを何倍にするか (既定 4) */
  k?: number;
  /** 大きさごとに測る回数 (交互に測る。既定 3) */
  reps?: number;
  /** 比べる前に 1 度、小さいほうを走らせて温める (JIT・書体の読み込み。既定 true) */
  warm?: boolean;
}

/**
 * 大きさ n と k·n で f を交互に測り、時間の比 (一番短い値どうし) を返す。
 * 線形の手間なら比はほぼ k、2 乗なら k² になる (k = 4 で 4 と 16。間の 8 ほどを上限にすれば、揺れで落ちず、2 乗の戻りは捕まる)
 */
export async function growth(f: (n: number) => unknown, n: number, o: GrowthOptions & { stopBelow?: number } = {}): Promise<{ ratio: number; small: number; large: number }> {
  const k = o.k ?? 4;
  if (o.warm ?? true) await f(n);
  let small = Infinity;
  let large = Infinity;
  // 小さいほうが短すぎると比が揺れるので、1ms より短い値は 1ms として比べる
  const ratio = () => large / Math.max(small, 1);
  for (let i = 0; i < (o.reps ?? 3); i++) {
    small = Math.min(small, (await cpuMs(() => f(n))).ms);
    large = Math.min(large, (await cpuMs(() => f(k * n))).ms);
    // 比が上限の内に入ったら、測り直さない (通るときの手間を 1 組分にする)
    if (o.stopBelow !== undefined && ratio() <= o.stopBelow) break;
  }
  return { ratio: ratio(), small, large };
}

/** growth の比が maxRatio 以下であることを確かめる (上限の内に入るまで、reps 組まで測り直す) */
export async function expectGrowth(maxRatio: number, f: (n: number) => unknown, n: number, o: GrowthOptions & { label?: string } = {}): Promise<void> {
  const g = await growth(f, n, { ...o, stopBelow: maxRatio });
  expect(g.ratio, `${o.label ?? '伸び方'}: n=${n} で ${g.small.toFixed(0)}ms、${o.k ?? 4} 倍で ${g.large.toFixed(0)}ms (比 ${g.ratio.toFixed(2)}、上限 ${maxRatio})`).toBeLessThanOrEqual(maxRatio);
}

/**
 * 2 つの処理 (悪い入力 f と、同じ量のふつうの入力 g) を交互に測り、時間の比 (一番短い値どうし) が maxRatio 以下であることを確かめる。
 * 機械の速さが比に出ないので、悪い入力の手間を「同じ大きさのふつうの文書の何倍まで」で縛れる (上限の内に入るまで、reps 組まで測り直す)
 */
export async function expectRatio(maxRatio: number, f: () => unknown, g: () => unknown, o: { reps?: number; warm?: boolean; label?: string } = {}): Promise<void> {
  if (o.warm ?? true) await g();
  let a = Infinity;
  let b = Infinity;
  const ratio = () => a / Math.max(b, 1);
  for (let i = 0; i < (o.reps ?? 3); i++) {
    a = Math.min(a, (await cpuMs(f)).ms);
    b = Math.min(b, (await cpuMs(g)).ms);
    if (ratio() <= maxRatio) break;
    // 大きく超えたら (上限の 10 倍)、測り直さない
    if (ratio() > maxRatio * 10) break;
  }
  expect(ratio(), `${o.label ?? '比'}: ${a.toFixed(0)}ms と、比べる元 ${b.toFixed(0)}ms (比 ${ratio().toFixed(2)}、上限 ${maxRatio})`).toBeLessThanOrEqual(maxRatio);
}
