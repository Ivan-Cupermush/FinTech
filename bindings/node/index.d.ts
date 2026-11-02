// типы для TypeScript (offix написан на нём)
// SPDX-License-Identifier: MIT

export interface KusokOptions {
	readOnly?: boolean;
	sync?: boolean;
	/** 0 — без сжатия, 1 — быстро, 2..12 — сильнее */
	compress?: number;
	salvage?: boolean;
	threads?: number;
	cacheChunks?: number;
	minChunk?: number;
	avgChunk?: number;
	maxChunk?: number;
	packLimit?: number;
}

export interface PutResult {
	/** SHA-256 содержимого, 64 hex */
	id: string;
	newBytes: number;
}

export interface Stat {
	files: number;
	chunks: number;
	logicalBytes: number;
	uniqueBytes: number;
	storedBytes: number;
	packs: number;
	cacheHits: number;
	cacheMisses: number;
}

export interface GcReport {
	packsRewritten: number;
	bytesBefore: number;
	bytesAfter: number;
	recordsDropped: number;
}

export interface FsckReport {
	records: number;
	badRecords: number;
	files: number;
	brokenFiles: number;
	missingManifests: number;
	tailBytes: number;
}

/** ошибка kusok: code — 'ENOTFOUND', 'ECORRUPT', ...; errno — код из C */
export interface KusokError extends Error {
	code: string;
	errno: number;
}

export class Kusok {
	constructor(dir: string, opts?: KusokOptions);
	put(data: Buffer | Uint8Array | string): Promise<PutResult>;
	putFile(path: string): Promise<PutResult>;
	putStream(stream: AsyncIterable<Buffer | string>): Promise<PutResult>;
	read(id: string, offset?: number, length?: number): Promise<Buffer>;
	size(id: string): number;
	ref(id: string): number;
	unref(id: string): number;
	refs(id: string): number;
	stat(): Stat;
	list(): { id: string; size: number; refs: number }[];
	checkpoint(): void;
	gc(minGarbage?: number): Promise<GcReport>;
	fsck(): Promise<FsckReport>;
	close(): void;
}

export function withStore<T>(dir: string, opts: KusokOptions | undefined,
	fn: (ks: Kusok) => Promise<T>): Promise<T>;

export const version: string;
