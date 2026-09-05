const fs = require("fs");
const html = fs.readFileSync(__dirname + "/library.html", "utf8");
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log("script blocks:", blocks.length);
blocks.forEach((b, i) => {
  try { new Function(b); console.log("block", i + 1, "OK", b.length, "chars"); }
  catch (e) { console.log("block", i + 1, "SYNTAX ERROR:", e.message); process.exitCode = 1; }
});
const opens = (html.match(/<div\b/g) || []).length, closes = (html.match(/<\/div>/g) || []).length;
console.log("div open/close:", opens, closes);
console.log("has </html>:", html.trim().endsWith("</html>"));
console.log("lines:", html.split("\n").length);
