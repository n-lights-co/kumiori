/** scripts/gen-stress-docs.mjs の型 (test/stressDocs.test.ts から読むため) */
export type Shape = 'nest' | 'table' | 'rules' | 'para' | 'images' | 'fonest' | 'fotable';
export function nestHtml(n: number, seed?: number): string;
export function tableHtml(n: number, seed?: number): string;
export function rulesHtml(n: number, seed?: number): string;
export function paraHtml(n: number, seed?: number): string;
export function imagesHtml(n: number, seed?: number): string;
export function nestFo(n: number, seed?: number): string;
export function tableFo(n: number, seed?: number): string;
export function sideWidthHtml(n: number, seed?: number): string;
export function sideWidthFo(n: number, seed?: number): string;
/** 続きから組む作りの確かめに使う形 (左右・奇数偶数で本文の幅の違うページ) */
export type ResumeShape = 'sidewidth' | 'fosidewidth';
export const RESUME_SHAPES: Record<ResumeShape, { make: (n: number, seed?: number) => string; ext: 'html' | 'fo' }>;
export const RESUME_SIZES: Record<ResumeShape, number>;
export const SHAPES: Record<Shape, { make: (n: number, seed?: number) => string; ext: 'html' | 'fo' }>;
export const STANDARD_SIZES: Record<Shape, number>;
export function standardSet(scale?: number): Array<{ name: string; text: string; shape: Shape; n: number }>;
