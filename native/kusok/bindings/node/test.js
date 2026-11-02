// тесты привязки: node --test bindings/node/test.js
// SPDX-License-Identifier: MIT
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { Kusok, withStore, version } = require('./index.js');

function tmp() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'kusok-node-'));
}

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('версия', () => {
	assert.match(version, /^\d+\.\d+\.\d+$/);
});

test('put и read: id — это SHA-256', async () => {
	const dir = tmp();
	const ks = new Kusok(dir, { sync: false });
	const data = crypto.randomBytes(300000);
	const r = await ks.put(data);
	assert.equal(r.id, sha(data));
	assert.ok(r.newBytes > 0);
	assert.equal(ks.size(r.id), data.length);
	assert.deepEqual(await ks.read(r.id), data);
	assert.deepEqual(await ks.read(r.id, 1000, 50), data.subarray(1000, 1050));
	// за концом — пустой буфер, а не ошибка
	assert.equal((await ks.read(r.id, data.length + 10, 5)).length, 0);
	ks.close();
	fs.rmSync(dir, { recursive: true });
});

test('повтор: новых байт 0, ссылок 2', async () => {
	const dir = tmp();
	const ks = new Kusok(dir, { sync: false });
	const a = await ks.put('один и тот же текст '.repeat(5000));
	const b = await ks.put('один и тот же текст '.repeat(5000));
	assert.equal(a.id, b.id);
	assert.equal(b.newBytes, 0);
	assert.equal(ks.refs(a.id), 2);
	assert.equal(ks.unref(a.id), 1);
	assert.equal(ks.ref(a.id), 2);
	ks.close();
	fs.rmSync(dir, { recursive: true });
});

test('Uint8Array, пустой файл, putFile, putStream', async () => {
	const dir = tmp();
	const ks = new Kusok(dir, { sync: false });
	const u = new Uint8Array([1, 2, 3, 4, 5]);
	assert.equal((await ks.put(u)).id, sha(u));
	const e = await ks.put(Buffer.alloc(0));
	assert.equal(e.id, sha(Buffer.alloc(0)));
	assert.equal(ks.size(e.id), 0);
	assert.equal((await ks.read(e.id)).length, 0);
	const f = path.join(dir, 'file.bin');
	const data = crypto.randomBytes(200000);
	fs.writeFileSync(f, data);
	assert.equal((await ks.putFile(f)).id, sha(data));
	const s = await ks.putStream(Readable.from([data.subarray(0, 7), data.subarray(7)]));
	assert.equal(s.id, sha(data));
	ks.close();
	fs.rmSync(dir, { recursive: true });
});

test('много промисов сразу', async () => {
	const dir = tmp();
	const ks = new Kusok(dir, { sync: false, threads: 2 });
	const bufs = Array.from({ length: 40 }, (_, i) =>
		Buffer.from(`файл ${i} `.repeat(1000 + i * 37)));
	const res = await Promise.all(bufs.map((b) => ks.put(b)));
	res.forEach((r, i) => assert.equal(r.id, sha(bufs[i])));
	const back = await Promise.all(res.map((r) => ks.read(r.id)));
	back.forEach((b, i) => assert.deepEqual(b, bufs[i]));
	assert.equal(ks.stat().files, 40);
	assert.equal(ks.list().length, 40);
	ks.close();
	fs.rmSync(dir, { recursive: true });
});

test('ошибки с кодом', async () => {
	const dir = tmp();
	const ks = new Kusok(dir, { sync: false });
	const net = '00'.repeat(32);
	assert.throws(() => ks.size(net), { code: 'ENOTFOUND' });
	await assert.rejects(ks.read(net), { code: 'ENOTFOUND' });
	assert.throws(() => ks.size('xyz'), TypeError);
	assert.throws(() => ks.read('00'.repeat(32), -1), TypeError);
	await assert.rejects(ks.putFile(path.join(dir, 'нет-файла')), { code: 'ENOTFOUND' });
	assert.throws(() => new Kusok(dir), { code: 'ELOCKED' });
	assert.throws(() => new Kusok(dir, { compress: 99 }), { code: 'EINVAL' });
	assert.throws(() => new Kusok(dir, { threads: 'много' }), TypeError);
	ks.close();
	assert.throws(() => ks.stat(), { code: 'EINVAL' });
	fs.rmSync(dir, { recursive: true });
});

test('close ждёт промисы', async () => {
	const dir = tmp();
	const ks = new Kusok(dir, { sync: false });
	const p = ks.put(crypto.randomBytes(1 << 20));
	assert.throws(() => ks.close(), { code: 'EBUSY' });
	await p;
	ks.close();
	fs.rmSync(dir, { recursive: true });
});

test('gc и fsck, только чтение', async () => {
	const dir = tmp();
	await withStore(dir, { sync: false }, async (ks) => {
		const a = await ks.put(crypto.randomBytes(500000));
		const b = await ks.put(crypto.randomBytes(500000));
		ks.unref(a.id);
		const g = await ks.gc(0);
		assert.ok(g.bytesAfter < g.bytesBefore);
		const f = await ks.fsck();
		assert.equal(f.files, 1);
		assert.equal(f.brokenFiles + f.badRecords, 0);
		assert.equal(ks.refs(b.id), 1);
	});
	const ro = new Kusok(dir, { readOnly: true });
	const ro2 = new Kusok(dir, { readOnly: true }); // читателей может быть много
	assert.equal(ro.stat().files, 1);
	await assert.rejects(ro.put('x'), { code: 'ERDONLY' });
	ro.close();
	ro2.close();
	fs.rmSync(dir, { recursive: true });
});

test('бэкап из того же процесса: ids, exportTo, importFrom — пока хранилище открыто на запись', async () => {
	const src = tmp();
	const dst = tmp();
	const ks = new Kusok(src, { sync: false });
	const a = crypto.randomBytes(200000);
	const b = crypto.randomBytes(150000);
	const ra = await ks.put(a);
	const bundle = path.join(src, 'b1.kb');
	// первый раз — всё
	let r = await ks.exportTo(bundle);
	assert.equal(r.files, 1);
	assert.equal(fs.existsSync(bundle + '.part'), false);
	const bk = new Kusok(path.join(dst, 'kusok'), { sync: false });
	r = await bk.importFrom(bundle);
	assert.equal(r.files, 1);
	assert.deepEqual(await bk.read(ra.id), a);
	// второй раз — только новое: кусков a в пакете нет
	const rb = await ks.put(b);
	const known = bk.ids();
	assert.ok(known.length >= 2);
	r = await ks.exportTo(bundle, known);
	assert.equal(r.files, 2);
	assert.ok(r.skipped > 0);
	assert.ok(r.bytes < a.length);
	r = await bk.importFrom(bundle);
	assert.deepEqual(await bk.read(rb.id), b);
	assert.equal(bk.refs(ra.id), 1);
	assert.equal((await bk.fsck()).badRecords, 0);
	// неверные аргументы
	assert.throws(() => ks.exportTo(bundle, ['xyz']), TypeError);
	assert.throws(() => ks.exportTo(bundle, 'abc'), TypeError);
	assert.throws(() => ks.exportTo(''), TypeError);
	await assert.rejects(bk.importFrom(path.join(dst, 'нет.kb')), { code: 'ENOTFOUND' });
	bk.close();
	ks.close();
	fs.rmSync(src, { recursive: true });
	fs.rmSync(dst, { recursive: true });
});
