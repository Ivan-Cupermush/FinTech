// kusok для node.js: обёртка над собранным kusok.node
// SPDX-License-Identifier: MIT
'use strict';

const path = require('node:path');
const fs = require('node:fs');

// где искать модуль: переменная окружения, потом обычные каталоги сборки
function najti() {
	if (process.env.KUSOK_NODE_ADDON)
		return path.resolve(process.env.KUSOK_NODE_ADDON);
	const koren = path.resolve(__dirname, '..', '..');
	for (const b of ['build', 'build-rel', 'build-node']) {
		const p = path.join(koren, b, 'kusok.node');
		if (fs.existsSync(p))
			return p;
	}
	throw new Error('kusok.node не найден: соберите с -DKUSOK_NODE=ON');
}

const addon = require(najti());

class Kusok extends addon.Kusok {
	// положить поток (например, req) кусками в буфер и потом put
	async putStream(stream) {
		const parts = [];
		for await (const c of stream)
			parts.push(typeof c === 'string' ? Buffer.from(c) : c);
		return this.put(Buffer.concat(parts));
	}
}

// открыть и сразу закрыть по выходу из функции
async function withStore(dir, opts, fn) {
	const ks = new Kusok(dir, opts);
	try {
		return await fn(ks);
	} finally {
		ks.close();
	}
}

module.exports = { Kusok, withStore, version: addon.version };
