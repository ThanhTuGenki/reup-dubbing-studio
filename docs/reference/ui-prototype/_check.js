const fs = require('fs');
const f = process.argv[2];
const h = fs.readFileSync(f, 'utf8');
const m = [...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
let ok = true;
m.forEach((s, i) => { try { new Function(s[1]); } catch (e) { ok = false; console.log('script', i, 'ERR', e.message); } });
console.log(ok ? ('all ' + m.length + ' scripts parse OK') : 'SYNTAX ERRORS');
const tags = {};
for (const t of h.matchAll(/<(\/?)(div|section|main|aside|table|tbody|thead|tr|td|th|button|dl|ul|li|nav|header)\b/g)) {
  tags[t[2]] = (tags[t[2]] || 0) + (t[1] ? -1 : 1);
}
const bad = Object.entries(tags).filter(([k, v]) => v !== 0);
console.log(bad.length ? ('UNBALANCED ' + JSON.stringify(bad)) : 'tags balanced');
