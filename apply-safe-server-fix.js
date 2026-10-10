'use strict';
// Safe, narrowly-scoped patch for your existing server.js. Never replaces the server implementation.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const target = path.resolve(process.argv[2] || 'server.js');
if (!fs.existsSync(target)) {
  console.error(`Не найден ${target}. Запусти скрипт в каталоге репозитория рядом с server.js.`);
  process.exit(1);
}
const original = fs.readFileSync(target, 'utf8');
let updated = original;
const notes = [];
// APP_URL is for generated email verification/reset links; Render provides HTTPS to inbound requests.
const appUrlLine = /^([\t ]*)const APP_URL\s*=\s*.*;[\t ]*$/m;
const match = updated.match(appUrlLine);
if (match) {
  if (/process\.env\.APP_URL\s*\|\|\s*['"]{1}['"]{1}/.test(match[0])) {
    updated = updated.replace(appUrlLine, match[1] + String.raw`const APP_URL = (process.env.APP_URL || 'https://my-chat-ucw4.onrender.com').replace(/\/$/, '');`);
    notes.push('Добавлен запасной HTTPS APP_URL для email-ссылок.');
  } else {
    notes.push('APP_URL уже не пустой по умолчанию: оставлен без изменений.');
  }
} else {
  notes.push('В этом server.js нет строки APP_URL: настройки не изменены.');
}

const mediaLine = /^([\t ]*)res\.set\((['"])Content-Disposition\2,[^\r\n]*\);[\t ]*$/gm;
updated = updated.replace(mediaLine, (line, indent) => {
  if (/res\.set\(\s*['"]Content-Disposition['"]\s*,\s*['"]inline['"]\s*\)/.test(line)) return line;
  notes.push('Исправлен Content-Disposition при русских именах вложений.');
  return `${indent}res.set('Content-Disposition', 'inline');`;
});
if (updated === original) {
  console.log('Сервер уже исправлен или опасные строки не найдены. Файл не менялся.');
  console.log(notes.join('\n'));
  process.exit(0);
}
// Syntactic check before touching original.
const testFile = path.join(path.dirname(target), '.burmal-server-parse-check.js');
try {
  fs.writeFileSync(testFile, updated, 'utf8');
  const check = cp.spawnSync(process.execPath, ['--check', testFile], { encoding: 'utf8' });
  if (check.status !== 0) {
    console.error('Не удалось проверить синтаксис. server.js остался без изменений.\n' + check.stderr);
    process.exitCode = 1;
  } else {
    const backup = `${target}.backup-before-safe-fix-${Date.now()}`;
    fs.copyFileSync(target, backup);
    fs.writeFileSync(target, updated, 'utf8');
    console.log('ГОТОВО. Исправлен существующий файл: ' + target);
    console.log('Резервная копия: ' + backup);
    console.log(notes.join('\n'));
  }
} finally {
  try { fs.unlinkSync(testFile); } catch (_) {}
}
