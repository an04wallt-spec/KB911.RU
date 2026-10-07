import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { api, serve, key } from '../functions/_models.js';

class Bucket {
  objects = new Map();
  async put(key, bytes, options) { if (options?.sha256 && !Buffer.from(options.sha256).equals(createHash('sha256').update(bytes).digest())) throw new Error('checksum mismatch'); const object = { key, bytes: Uint8Array.from(bytes), size: bytes.length, uploaded: new Date(), body: bytes }; this.objects.set(key, object); return object; }
  async get(key) { return this.objects.get(key) || null; }
  async delete(keys) { for (const key of keys) this.objects.delete(key); }
  async list({ prefix, delimiter, limit, cursor }) {
    const found = [...this.objects.values()].filter(o => o.key.startsWith(prefix)).sort((a,b) => a.key.localeCompare(b.key));
    let objects = found, prefixes = [];
    if (delimiter) { prefixes = [...new Set(found.map(o => o.key.slice(0, o.key.indexOf('/', prefix.length)+1)))]; objects = []; }
    const offset = Number(cursor || 0), source = delimiter ? prefixes : objects, page = source.slice(offset, offset+limit);
    return { objects: delimiter ? [] : page, delimitedPrefixes: delimiter ? page : [], truncated: source.length > offset+limit, cursor: String(offset+limit) };
  }
}
function env() { return { MODELS: new Bucket(), MODELS_API_TOKEN: 't'.repeat(40), PUBLIC_BASE_URL: 'https://kb911.ru' }; }
function req(path, options = {}) { return new Request('https://kb911.ru/api/models/'+path, { ...options, headers: { Authorization: 'Bearer '+ 't'.repeat(40), ...options.headers } }); }
async function upload(storage, model='Столик', html='<!doctype html><html>model</html>', checksum=null) {
  const bytes = Buffer.from(html); return api(req('upload?project='+encodeURIComponent('Русские Сезоны')+'&model='+encodeURIComponent(model), { method: 'POST', body: bytes, headers: { 'Content-Type': 'text/html', 'Content-Length': String(bytes.length), 'X-Content-SHA256': checksum || createHash('sha256').update(bytes).digest('hex') } }), storage);
}
test('upload, stable replacement, authenticated listing, public byte-perfect HTML and batch deletion', async () => {
  const storage = env(); const first = await (await upload(storage)).json(); assert.equal(first.success, true);
  const second = await (await upload(storage, 'Столик', '<!doctype html><html>updated</html>')).json(); assert.equal(second.url, first.url); assert.equal(storage.MODELS.objects.size, 1);
  const page = await serve(new Request(first.url), storage, ['Русские Сезоны', 'Столик.html']); assert.equal(await page.text(), '<!doctype html><html>updated</html>'); assert.equal(page.headers.get('Cache-Control'), 'no-store'); assert.match(page.headers.get('X-Robots-Tag'), /noindex/);
  assert.equal((await (await api(req('projects'), storage)).json()).projects[0].name, 'Русские Сезоны');
  const files = await (await api(req('project?project='+encodeURIComponent('Русские Сезоны')), storage)).json(); assert.equal(files.files[0].url, first.url); assert.ok(files.files[0].updatedAt);
  await upload(storage, 'Шкаф');
  const deleted = await api(req('files', { method: 'DELETE', body: JSON.stringify({ files: [{ project: 'Русские Сезоны', model:'Столик' }, { project: 'Русские Сезоны', model:'Шкаф' }] }) }), storage); assert.equal(deleted.status, 200); assert.equal(storage.MODELS.objects.size, 0);
  assert.deepEqual((await (await api(req('projects'), storage)).json()).projects, []);
});
test('bad checksum or truncated upload cannot replace a published file', async () => {
  const storage = env(); await upload(storage); const before = (await storage.MODELS.get(key('Русские Сезоны','Столик'))).bytes;
  assert.equal((await upload(storage, 'Столик', '<!doctype html><html>bad</html>', '0'.repeat(64))).status, 400);
  assert.deepEqual((await storage.MODELS.get(key('Русские Сезоны','Столик'))).bytes, before);
});
test('all API operations reject missing/wrong authentication; public directories never list', async () => {
  const storage = env();
  for (const path of ['projects', 'project?project=x', 'upload', 'files']) assert.equal((await api(new Request('https://kb911.ru/api/models/'+path),storage)).status,401);
  for (const path of [[], ['Русские Сезоны'], ['Русские Сезоны','../x.html']]) assert.equal((await serve(new Request('https://kb911.ru/3d-temp/'),storage,path)).status,404);
  assert.throws(()=>key('../bad','ok')); assert.throws(()=>key('ok','a/b')); assert.throws(()=>key('ok','..'));
});
test('size, invalid HTML and oversized bodies reject without writing', async () => {
  const storage = env(); assert.equal((await upload(storage,'model','plain text')).status,400);
  const r = await api(req('upload?project=p&model=m',{method:'POST',body:'x',headers:{'Content-Type':'text/html','Content-Length':String(51*1024*1024),'X-Content-SHA256':'0'.repeat(64)}}),storage);
  assert.equal(r.status,413); assert.equal(storage.MODELS.objects.size,0);
});
