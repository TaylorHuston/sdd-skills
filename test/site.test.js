import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const siteRoot = new URL("../site/", import.meta.url);

async function readSite() {
  const [html, script, styles] = await Promise.all([
    readFile(new URL("index.html", siteRoot), "utf8"),
    readFile(new URL("site.js", siteRoot), "utf8"),
    readFile(new URL("styles.css", siteRoot), "utf8"),
  ]);
  return { html, script, styles };
}

test("public guide separates portable methodology from package implementation and preserves durable Story semantics", async () => {
  const { html } = await readSite();
  const portableSections = ["problem", "model", "process", "traceability", "example"];
  const positions = portableSections.map((id) => html.indexOf(`id="${id}"`));
  const implementationPosition = html.indexOf('id="implementation"');

  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  assert.ok(positions.every((position) => position < implementationPosition));
  assert.match(html, /A Change updates the Story\. It does not replace it\./);
  assert.match(html, /Create a new Story only for a genuinely distinct, durable user outcome/);
  assert.match(html, /Scenario R1-S1/);
  assert.doesNotMatch(html, /Scenario R\d+\.\d+/);
});

test("public guide has unique fragment targets and sequential navigable sections", async () => {
  const { html } = await readSite();
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const fragments = [...html.matchAll(/\shref="#([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);

  assert.deepEqual(duplicateIds, []);
  assert.ok(fragments.length > 0);
  assert.deepEqual(
    [...new Set(fragments.filter((fragment) => !ids.includes(fragment)))],
    [],
  );
  assert.match(html, /<main id="main-content" tabindex="-1">/);
  assert.match(html, /class="skipLink" href="#main-content">Skip to content/);
  assert.match(html, /<aside class="docsSidebar" aria-label="Documentation navigation">/);
  assert.match(html, /<nav class="siteNav" aria-label="On this page">/);
});

test("public guide preserves clipboard fallback feedback and reduced-motion behavior", async () => {
  const { html, script, styles } = await readSite();

  assert.match(html, /<button class="copyButton" id="copy-command"[\s\S]{0,500}data-copy="[^"]*sdd setup/);
  assert.match(html, /aria-live="polite"/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(script, /range\.selectNodeContents\(commandText\)/);
  assert.match(script, /selection\.removeAllRanges\(\)/);
  assert.match(script, /selection\.addRange\(range\)/);
  assert.match(script, /label\.textContent = "Selected"/);
  assert.match(script, /label\.textContent = "Copy"/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /scroll-behavior:\s*auto/);
  assert.match(styles, /transition-duration:\s*0\.01ms/);
  assert.match(styles, /:focus-visible/);
});
