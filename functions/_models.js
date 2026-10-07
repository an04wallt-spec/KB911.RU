const PREFIX = 'models/';
const MAX_BYTES = 50 * 1024 * 1024;
export function reply(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' } });
}
export function name(value) {
  if (typeof value !== 'string') throw new Error('Название отсутствует');
  const result = value.trim();
  if (!result || result === '.' || result === '..' || /[\u0000-\u001f\u007f/\\]/.test(result) || new TextEncoder().encode(result).length > 180) throw new Error('Недопустимое название');
  return result;
}
export function key(project, model) { return PREFIX + name(project) + '/' + name(model) + '.html'; }
export function publicURL(request, env, project, model) {
  const origin = env.PUBLIC_BASE_URL || new URL(request.url).origin;
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/') throw new Error('Некорректный PUBLIC_BASE_URL');
  return base.origin + '/3d-temp/' + encodeURIComponent(name(project)) + '/' + encodeURIComponent(name(model) + '.html');
}
async function authorized(request, env) {
  if (!env.MODELS_API_TOKEN || env.MODELS_API_TOKEN.length < 32) return false;
  const supplied = request.headers.get('Authorization') || '';
  const encoder = new TextEncoder();
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(supplied)));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode('Bearer ' + env.MODELS_API_TOKEN)));
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
function metadata(request, env, object) {
  const parts = object.key.slice(PREFIX.length).split('/');
  const model = parts[1].slice(0, -5);
  return { project: parts[0], model, size: object.size, updatedAt: object.uploaded.toISOString(), url: publicURL(request, env, parts[0], model) };
}
export async function api(request, env) {
  try {
    if (new URL(request.url).protocol !== 'https:') return reply({ success: false, error: 'Требуется HTTPS' }, 400);
    if (!env.MODELS || !env.MODELS_API_TOKEN) return reply({ success: false, error: 'Хранилище ещё не настроено' }, 503);
    if (!(await authorized(request, env))) return reply({ success: false, error: 'Нет доступа' }, 401);
    const url = new URL(request.url);
    const route = url.pathname.replace(/\/$/, '');
    if (route === '/api/models/upload' && request.method === 'POST') {
      const project = name(url.searchParams.get('project'));
      const model = name(url.searchParams.get('model'));
      const targetURL = publicURL(request, env, project, model);
      if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('text/html')) return reply({ success: false, error: 'Ожидается HTML' }, 415);
      const declared = Number(request.headers.get('Content-Length'));
      if (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAX_BYTES) return reply({ success: false, error: 'Размер HTML должен быть от 1 байта до 50 МБ' }, 413);
      const checksum = request.headers.get('X-Content-SHA256');
      if (!checksum || !/^[a-f0-9]{64}$/i.test(checksum)) return reply({ success: false, error: 'Отсутствует контрольная сумма' }, 400);
      // Count before buffering: dishonest chunked bodies cannot exceed the memory limit.
      const chunks = []; let size = 0;
      const reader = request.body.getReader();
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES || size > declared) { await reader.cancel(); return reply({ success: false, error: 'Размер превышает заявленный' }, 413); }
        chunks.push(value);
      }
      if (size !== declared) return reply({ success: false, error: 'Файл передан не полностью' }, 400);
      const body = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      chunks.length = 0;
      const actual = checksum.toLowerCase();
      const beginning = new TextDecoder().decode(body.subarray(0, 2048));
      if (!/<(?:!doctype\s+html|html)[\s>]/i.test(beginning)) return reply({ success: false, error: 'Файл не является HTML' }, 400);
      // R2 put publishes one complete object. Replacing a key keeps its public URL.
      // R2 verifies SHA-256 before committing the replacement. Hashing runs in
      // storage, avoiding expensive hashing inside a Pages Function CPU budget.
      const digest = Uint8Array.from(actual.match(/../g), hex => parseInt(hex, 16));
      const stored = await env.MODELS.put(key(project, model), body, { sha256: digest.buffer, httpMetadata: { contentType: 'text/html; charset=utf-8', cacheControl: 'no-store' }, customMetadata: { sha256: actual } });
      return reply({ success: true, url: targetURL, sha256: actual, size, updatedAt: stored.uploaded.toISOString() });
    }
    if (route === '/api/models/projects' && request.method === 'GET') {
      const result = await env.MODELS.list({ prefix: PREFIX, delimiter: '/', limit: 1000, cursor: url.searchParams.get('cursor') || undefined });
      return reply({ success: true, projects: result.delimitedPrefixes.map(p => ({ name: p.slice(PREFIX.length).replace(/\/$/, '') })), cursor: result.truncated ? result.cursor : null });
    }
    if (route === '/api/models/project' && request.method === 'GET') {
      const project = name(url.searchParams.get('project'));
      const result = await env.MODELS.list({ prefix: PREFIX + project + '/', limit: 1000, cursor: url.searchParams.get('cursor') || undefined });
      return reply({ success: true, files: result.objects.filter(o => o.key.endsWith('.html')).map(o => metadata(request, env, o)), cursor: result.truncated ? result.cursor : null });
    }
    if (route === '/api/models/files' && request.method === 'DELETE') {
      const raw = await request.text();
      if (raw.length > 65536) return reply({ success: false, error: 'Слишком большой запрос' }, 413);
      const data = JSON.parse(raw);
      if (!Array.isArray(data.files) || !data.files.length || data.files.length > 100) throw new Error('Выберите от 1 до 100 моделей');
      const keys = [...new Set(data.files.map(file => key(file.project, file.model)))];
      await env.MODELS.delete(keys);
      // Projects are virtual prefixes: their last deletion removes the folder too.
      return reply({ success: true, deleted: keys.length });
    }
    return reply({ success: false, error: 'Метод или адрес не поддерживается' }, 404);
  } catch (error) {
    if (/checksum/i.test(error.message)) return reply({ success: false, error: 'Контрольная сумма не совпала' }, 400);
    if (error instanceof SyntaxError || /назван|Название|Выберите/.test(error.message)) return reply({ success: false, error: error.message }, 400);
    return reply({ success: false, error: 'Не удалось выполнить запрос. Повторите позже.' }, 500);
  }
}
export async function serve(request, env, route) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  try {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith('/3d-temp/')) return new Response('Not found', { status: 404, headers });
    const parts = pathname.slice('/3d-temp/'.length).split('/').map(segment => decodeURIComponent(segment));
    if (parts.length !== 2 || !parts[1].endsWith('.html')) return new Response('Not found', { status: 404, headers });
    if (!env.MODELS) return new Response('Storage unavailable', { status: 503, headers });
    const project = name(parts[0]), model = name(parts[1].slice(0, -5));
    const object = await env.MODELS.get(key(project, model));
    if (!object) return new Response('Not found', { status: 404, headers });
    headers['Content-Type'] = 'text/html; charset=utf-8';
    headers['Content-Length'] = String(object.size);
    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  } catch { return new Response('Not found', { status: 404, headers }); }
}

