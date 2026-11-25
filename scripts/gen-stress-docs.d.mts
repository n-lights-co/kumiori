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
export function collapseTableHtml(n: number, seed?: number): string;
export function collapseTableFo(n: number, seed?: number): string;
/** 続きから組む作りの確かめに使う形 (左右・奇数偶数で本文の幅の違うページ・罫線をつぶした表がページをまたぐ文書) */
export type ResumeShape = 'sidewidth' | 'fosidewidth' | 'collapsetable' | 'focollapsetable';
export const RESUME_SHAPES: Record<ResumeShape, { make: (n: number, seed?: number) => string; ext: 'html' | 'fo' }>;
export const RESUME_SIZES: Record<ResumeShape, number>;
export function chaptersFo(n: number, seed?: number, kind?: 'footnote' | 'marker' | 'footnote-inline'): string;
export function footnoteDisplayHtml(n: number, seed?: number): string;
export function tocHtml(n: number, seed?: number): string;
export function tocFo(n: number, seed?: number): string;
/** createTypesetter の使い回しの確かめに使う形 (章ごとの page-sequence に、脚注・マーカーのある XSL-FO と、脚注を行内に並べる XSL-FO・HTML と、初めに目次のある HTML・XSL-FO) */
export type ReuseShape = 'fofootnotes' | 'fomarkers' | 'fofootinline' | 'footdisplay' | 'toc' | 'fotoc';
export const REUSE_SHAPES: Record<ReuseShape, { make: (n: number, seed?: number) => string; ext: 'html' | 'fo' }>;
export const REUSE_SIZES: Record<ReuseShape, number>;
export const SHAPES: Record<Shape, { make: (n: number, seed?: number) => string; ext: 'html' | 'fo' }>;
export const STANDARD_SIZES: Record<Shape, number>;
export function standardSet(scale?: number): Array<{ name: string; text: string; shape: Shape; n: number }>;
