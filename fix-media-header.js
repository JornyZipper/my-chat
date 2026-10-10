// Run from the root of the my-chat repository: node fix-media-header.js
// Patches only the invalid Content-Disposition line; preserves the rest of server.js.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const target = path.resolve(process.argv[2] || 'server.js');
if (!fs.existsSync(target)) {
  console.error('File not found:', target);
  process.exit(1);
}
const original = fs.readFileSync(target, 'utf8');
if (original.includes('filename*=UTF-8')) {
  console.log('Already fixed: UTF-8 filename header is present.');
  process.exit(0);
}
const lines = original.split('\n');
const matches = lines.map((v,i) => ({v,i})).filter(({v}) => v.includes('res.set(') && v.includes('Content-Disposition') && v.includes('rows[0].filename'));
if (matches.length !== 1) {
  console.error(`Expected one media Content-Disposition line. Found ${matches.length}. Server unchanged.`);
  process.exit(2);
}
const {v,i} = matches[0];
const indent = v.match(/^\s*/)[0];
lines.splice(i,1,
  `${indent}// HTTP header values must be ASCII / RFC 5987 encoded. Cyrillic filenames otherwise crash Electron.`,
  `${indent}const mediaFilename = String(rows[0].filename || 'attachment');`,
  indent + "const fallbackName = mediaFilename.replace(/[^\\x20-\\x7E]/g, '_').replace(/[\"\\\\;]/g, '_').slice(0, 120) || 'attachment';",
  `${indent}const encodedName = encodeURIComponent(mediaFilename).replace(/['()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());`,
  indent + "res.set('Content-Disposition', `inline; filename=\"${fallbackName}\"; filename*=UTF-8''${encodedName}`);"
);
let updated = lines.join('\n');
// Escape JavaScript strings for replacement interpolation - unlike a template literal inside a template literal.
updated = updated.replace(/\\`/g,'`').replace(/\\\$/g,'$');
const backup = `${target}.before-media-fix`;
if (fs.existsSync(backup)) {
  console.error('Backup already exists. Server unchanged:', backup);
  process.exit(3);
}
const tmp = `${target}.check-${process.pid}.js`;
try {
  fs.writeFileSync(tmp, updated);
  execFileSync(process.execPath,['--check',tmp],{stdio:'pipe'});
  fs.copyFileSync(target,backup);
  fs.writeFileSync(target,updated);
  console.log('Fixed successfully:',target);
  console.log('Backup:',backup);
} catch (e) {
  console.error('Syntax check failed, server.js not overwritten:',e.stderr?.toString()||e.message);
  process.exitCode=4;
} finally {
  try { fs.unlinkSync(tmp); } catch {}
}
