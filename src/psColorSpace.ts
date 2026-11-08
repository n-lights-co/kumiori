/**
 * psColorSpace — PostScript の色空間 (§4.8) の型と、機器の色空間の定数。psGraphics (Graphics の色の変換) と、
 * 色・画像の演算子 (psOpsState・psOpsImage) が共有する
 */
import { name, type PSObj } from './psInterp';

export type RGB = [number, number, number];

/** 色空間 (§4.8)。family は名前、params は配列の形のときの残り */
export interface ColorSpace {
  family: string;
  obj: PSObj;
  ncomp: number;
  base?: ColorSpace;
  /** Indexed */
  hival?: number;
  lookup?: Uint8Array | PSObj;
  /** Separation・DeviceN */
  tint?: PSObj;
  names?: string[];
}

export const DEVICE_GRAY: ColorSpace = { family: 'DeviceGray', obj: name('DeviceGray'), ncomp: 1 };
export const DEVICE_RGB: ColorSpace = { family: 'DeviceRGB', obj: name('DeviceRGB'), ncomp: 3 };
export const DEVICE_CMYK: ColorSpace = { family: 'DeviceCMYK', obj: name('DeviceCMYK'), ncomp: 4 };

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
