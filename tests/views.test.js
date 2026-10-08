import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { serve, api, key } from '../functions/_models.js';
import { projectViews } from '../functions/_views.js';
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_project_views.sql', import.meta.url), 'utf8'));
  const MODEL_VIEWS = { prepare(sql) { return { bind(...args) { return { async run() { db.prepare(sql).run(...args); return { success: true }; }, async all() { return { success: true, results: db.prepare(sql).all(...args) }; } }; } }; } };
  const objects = new Map();
  const MODELS = { async get(k) { const body = objects.get(k); return body ? { size: Buffer.byteLength(body), body } : null; }, async list() { return { objects: [], delimitedPrefixes: [...new Set([...objects.keys()].map(k => k.slice(0, k.lastIndexOf('/')+1)))], truncated: false }; } };
  return { db, objects, env: { MODELS, MODEL_VIEWS, MODELS_API_TOKEN: 't'.repeat(40) } };
}
const url = (p,m) => 'https://kb911.ru/3d-temp/' + encodeURIComponent(p) + '/' + encodeURIComponent(m+'.html');
test('project sums count successful GETs across files; HEAD, missing files, listing and other projects do not increase them', async () => {
  const { db, objects, env } = setup();
  objects.set(key('Русские Сезоны','Обувница'), '<!doctype html><html>A</html>');
  objects.set(key('Русские Сезоны','Столик'), '<!doctype html><html>B</html>');
  objects.set(key('Другой','Шкаф'), '<!doctype html><html>C</html>');
  try {
    await Promise.all(Array.from({ length: 20 }, (_,i) => serve(new Request(url('Русские Сезоны', i%2 ? 'Столик' : 'Обувница')),env)));
    assert.equal((await serve(new Request(url('Русские Сезоны','Обувница'), {method:'HEAD'}),env)).status,200);
    assert.equal((await serve(new Request(url('Русские Сезоны','Нет')),env)).status,404);
    const response = await api(new Request('https://kb911.ru/api/models/projects',{headers:{Authorization:'Bearer '+'t'.repeat(40)}}),env);
    const projects = (await response.json()).projects;
    assert.equal(projects.find(p=>p.name==='Русские Сезоны').views,20);
    assert.equal(projects.find(p=>p.name==='Другой').views,0);
    assert.equal((await projectViews(env,['Русские Сезоны'])).get('Русские Сезоны'),20);
  } finally { db.close(); }
});
test('counter outage never breaks model bytes and missing statistics are not represented as zero', async () => {
  const { db, objects, env } = setup();
  objects.set(key('Проект','Модель'), '<!doctype html><html>exact bytes</html>');
  env.MODEL_VIEWS={prepare(){throw Error('database unavailable');}};
  try {
    const response=await serve(new Request(url('Проект','Модель')),env);
    assert.equal(response.status,200);
    assert.equal(await response.text(),objects.get(key('Проект','Модель')));
    assert.equal(await projectViews(env,['Проект']),null);
  } finally {db.close();}
});
