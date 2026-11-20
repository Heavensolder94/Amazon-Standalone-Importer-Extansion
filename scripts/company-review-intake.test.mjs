import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const markup = fs.readFileSync(new URL("../popup.html", import.meta.url), "utf8");
test("Company OS action sends research through authenticated Seller Tool and requires identity confirmation", () => {
  const payload = source.slice(source.indexOf("function companyOsPayload()"), source.indexOf("function safeDraftPayload()"));
  assert.match(payload, /observedAmazonPurchaseReference/);
  assert.doesNotMatch(payload, /rawPrice:|costPrice:|buyPrice:/);
  assert.match(payload, /selectedVariations: state\.product\?\.variations/);
  assert.match(payload, /originalTitle: state\.product\?\.title/);
  const action = source.slice(source.indexOf("async function sendToCompanyOs()"), source.indexOf("async function copy("));
  assert.match(action, /sellerProtectedPost\('\/api\/products\/review-intake'/);
  assert.match(action, /result\.body\?\.reviewStatus !== 'in_review'/);
  assert.doesNotMatch(action, /clipboard/);
  assert.match(markup, /kein bestätigter Lieferanten-EK/);
});
