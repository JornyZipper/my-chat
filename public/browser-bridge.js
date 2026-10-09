/* BurmalpticajopaChat web adapter for the same UI as Windows.
   It keeps the existing server API unchanged. */
(() => {
  'use strict';
  if (window.burmalDesktop) return; // Electron preload is already active.
  const ALLOWED_UPLOADS = { '/api/upload': { field: 'file', limit: 15 * 1024 * 1024 }, '/api/profile/avatar': { field: 'avatar', limit: 4 * 1024 * 1024 } };
  const safePath = (path) => {
    const value = String(path || '');
    if (!value.startsWith('/api/') || value.includes('..') || value.includes('\\')) throw new Error('Недопустимый адрес API.');
    return value;
  };
  const makeUrl = (path) => new URL(safePath(path), window.location.origin).href;
  const parseJson = async (response) => {
    const raw = await response.text();
    try { return raw ? JSON.parse(raw) : {}; }
    catch { return { error: `Сервер вернул HTML или не-JSON (HTTP ${response.status}).`, details: raw.slice(0,240) }; }
  };
  async function apiRequest(args) {
    try {
      const method = String(args?.method || 'GET').toUpperCase();
      if (!['GET','POST','PATCH','DELETE','PUT'].includes(method)) throw new Error('Недопустимый HTTP-метод.');
      const headers = { Accept: 'application/json' };
      if (args?.token) headers.Authorization = `Bearer ${String(args.token)}`;
      let body;
      if (args?.body != null) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(args.body);
      }
      const response = await fetch(makeUrl(args.path), { method, headers, body, credentials: 'same-origin' });
      return { ok: response.ok, status: response.status, data: await parseJson(response) };
    } catch (error) { return { ok: false, status: 0, data: { error: error.message || 'Нет соединения с сервером.' } }; }
  }
  async function apiUpload(args) {
    try {
      const cfg = ALLOWED_UPLOADS[String(args?.path || '')];
      if (!cfg || args?.fieldName !== cfg.field) throw new Error('Неподдерживаемая загрузка.');
      if (!args?.token) throw new Error('Сначала войди в аккаунт.');
      const source = args.file;
      if (!source?.data) throw new Error('Файл не выбран.');
      const bytes = source.data instanceof ArrayBuffer ? source.data : source.data.buffer;
      if (!bytes?.byteLength || bytes.byteLength > cfg.limit) throw new Error('Файл пустой или слишком большой.');
      const file = new File([bytes], String(source.name || 'file').slice(0,180), { type: String(source.type || 'application/octet-stream') });
      const form = new FormData(); form.append(cfg.field, file);
      const response = await fetch(makeUrl(args.path), { method:'POST', headers:{ Authorization:`Bearer ${String(args.token)}`, Accept:'application/json' }, body:form });
      return { ok: response.ok, status: response.status, data: await parseJson(response) };
    } catch (error) { return { ok: false, status: 0, data: { error: error.message || 'Ошибка загрузки файла.' } }; }
  }
  async function mediaRequest(args) {
    try {
      if (!/^\/api\/media\/[A-Za-z0-9_-]+$/.test(String(args?.path || ''))) throw new Error('Недопустимый файл.');
      if (!args?.token) throw new Error('Не авторизован.');
      const response = await fetch(makeUrl(args.path), { headers: { Authorization:`Bearer ${String(args.token)}` } });
      if (!response.ok) return {ok:false,status:response.status,error:'Файл не найден или нет доступа.'};
      const blob = await response.blob();
      if (blob.size > 18 * 1024 * 1024) throw new Error('Слишком большой файл для предпросмотра.');
      const dataUrl = await new Promise((resolve,reject) => {
        const reader = new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(new Error('Не удалось прочитать файл.')); reader.readAsDataURL(blob);
      });
      const comma = dataUrl.indexOf(',');
      const semicolon = dataUrl.indexOf(';');
      return { ok:true,status:200, mimeType:blob.type||'application/octet-stream', base64:dataUrl.slice(comma+1) };
    } catch (error) { return { ok:false,status:0,error:error.message || 'Ошибка чтения медиа.' }; }
  }
  window.burmalDesktop = Object.freeze({ apiRequest, apiUpload, mediaRequest, openExternal: async url => {
    try { const value = new URL(url); if(value.protocol !== 'https:') return false; window.open(value.href, '_blank', 'noopener,noreferrer'); return true; }
    catch { return false; }
  }, platform:'web' });
})();
