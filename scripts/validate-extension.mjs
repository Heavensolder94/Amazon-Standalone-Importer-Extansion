import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const requiredFiles = [
  "manifest.json",
  "popup.html",
  "popup.js",
  "popup-fixed.html",
  "popup-fixed.js",
  "image-fix.js",
  "category-fix.js",
  "workflow-fix.js",
  "style.css",
  "README.md",
];

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`✅ ${message}`);
}

for (const file of requiredFiles) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) fail(`Pflichtdatei fehlt: ${file}`);
  else ok(`Pflichtdatei vorhanden: ${file}`);
}

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  ok("manifest.json ist gültiges JSON");
} catch (error) {
  fail(`manifest.json ist ungültig: ${error.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) fail("manifest_version muss 3 sein");
  else ok("Manifest V3 erkannt");

  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version || ""))) {
    fail(`Ungültige Extension-Version: ${manifest.version || "<leer>"}`);
  } else {
    ok(`Extension-Version: ${manifest.version}`);
  }

  const popup = String(manifest?.action?.default_popup || "");
  if (!popup || !fs.existsSync(path.join(root, popup))) fail(`default_popup fehlt oder existiert nicht: ${popup || "<leer>"}`);
  else ok(`default_popup vorhanden: ${popup}`);
}

for (const jsFile of ["popup.js", "popup-fixed.js", "image-fix.js", "category-fix.js", "workflow-fix.js"]) {
  const syntax = spawnSync(process.execPath, ["--check", path.join(root, jsFile)], {
    encoding: "utf8",
  });
  if (syntax.status !== 0) fail(`${jsFile} Syntaxfehler:\n${syntax.stderr || syntax.stdout}`);
  else ok(`${jsFile} Syntax gültig`);
}

const popupHtml = fs.existsSync(path.join(root, "popup.html"))
  ? fs.readFileSync(path.join(root, "popup.html"), "utf8")
  : "";
const popupJs = fs.existsSync(path.join(root, "popup.js"))
  ? fs.readFileSync(path.join(root, "popup.js"), "utf8")
  : "";
const popupFixedJs = fs.existsSync(path.join(root, "popup-fixed.js"))
  ? fs.readFileSync(path.join(root, "popup-fixed.js"), "utf8")
  : "";
const imageFixJs = fs.existsSync(path.join(root, "image-fix.js"))
  ? fs.readFileSync(path.join(root, "image-fix.js"), "utf8")
  : "";
const workflowFixJs = fs.existsSync(path.join(root, "workflow-fix.js"))
  ? fs.readFileSync(path.join(root, "workflow-fix.js"), "utf8")
  : "";

const referencedIds = new Set();
for (const match of popupJs.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)) {
  referencedIds.add(match[1]);
}
for (const match of popupJs.matchAll(/\$\(\s*["']([^"']+)["']\s*\)/g)) {
  referencedIds.add(match[1]);
}
const htmlIds = new Set();
for (const match of popupHtml.matchAll(/\sid=["']([^"']+)["']/g)) {
  htmlIds.add(match[1]);
}
const missingIds = [...referencedIds].filter((id) => !htmlIds.has(id));
if (missingIds.length) fail(`In popup.js referenzierte IDs fehlen in popup.html: ${missingIds.join(", ")}`);
else ok(`DOM-ID-Check bestanden (${referencedIds.size} statische ID-Referenzen)`);

for (const [script, label] of [
  ["image-fix.js", "Bild-Handoff"],
  ["category-fix.js", "Kategorie-Handoff"],
  ["workflow-fix.js", "Preis-/Draft-Handoff"],
]) {
  if (!popupFixedJs.includes(`<script src="${script}"></script>`)) fail(`Popup-Bootstrap lädt ${label} nicht.`);
  else ok(`Popup-Bootstrap lädt ${script}`);
}

const imageFixContracts = [
  ["data-old-hires", "Amazon data-old-hires wird berücksichtigt"],
  ["data-a-dynamic-image", "Amazon data-a-dynamic-image wird berücksichtigt"],
  ["og:image", "OpenGraph-Bild wird berücksichtigt"],
  ["ebayImageUrls", "eBay-Bildfeld wird befüllt"],
  ["Nutzungsrechte", "Nutzungsrechte-Hinweis bleibt Teil des Fixes"],
];
for (const [needle, label] of imageFixContracts) {
  if (!imageFixJs.includes(needle)) fail(`Image-Fix-Vertrag fehlt: ${label}`);
  else ok(label);
}

const workflowContracts = [
  ["#corePrice_feature_div .priceToPay .a-offscreen", "aktueller Amazon-Preis wird priorisiert"],
  ["meta[itemprop=\"price\"]", "strukturierter Amazon-Preis wird berücksichtigt"],
  ["application/ld+json", "JSON-LD-Preis wird berücksichtigt"],
  ["buyPrice", "Einkaufspreisfeld wird befüllt"],
  ["suggestedSellPrice", "eBay-Verkaufspreis erhält einen prüfbaren Vorschlag"],
  ["conditionEnum", "Artikelzustand wird bei eindeutiger Neuware erkannt"],
  ["Pflichtmerkmale", "fehlende eBay-Pflichtmerkmale werden vollständig gemeldet"],
  ["details?.blockers", "Server-Blocker werden sichtbar gemacht"],
];
for (const [needle, label] of workflowContracts) {
  if (!workflowFixJs.includes(needle)) fail(`Workflow-Fix-Vertrag fehlt: ${label}`);
  else ok(label);
}

const codeFiles = [
  "manifest.json",
  "popup.html",
  "popup.js",
  "popup-fixed.html",
  "popup-fixed.js",
  "image-fix.js",
  "category-fix.js",
  "workflow-fix.js",
  "style.css",
];
const secretPatterns = [
  { name: "OpenAI/Projekt-Key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: "GitHub Token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "AWS Access Key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "Private Key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

let secretHits = 0;
for (const file of codeFiles) {
  if (!fs.existsSync(path.join(root, file))) continue;
  const text = fs.readFileSync(path.join(root, file), "utf8");
  for (const pattern of secretPatterns) {
    if (pattern.re.test(text)) {
      secretHits += 1;
      fail(`Möglicher eingebetteter Secret in ${file}: ${pattern.name}`);
    }
    pattern.re.lastIndex = 0;
  }
}
if (!secretHits) ok("Kein bekannter Secret-Pattern in Extension-Dateien gefunden");

if (process.exitCode) {
  console.error("\nExtension-Validierung fehlgeschlagen.");
  process.exit(process.exitCode);
}

console.log("\n🎉 Extension-Validierung erfolgreich.\n");
