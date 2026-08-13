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

test("public guide documents progressive workspace-owned Changes and current-only setup", async () => {
  const { html } = await readSite();

  assert.match(html, /workspace-owned work/i);
  assert.match(html, /&lt;workspace&gt;\/\.sdd\/changes\//);
  assert.match(html, /&lt;workspace&gt;\/\.sdd\/config\.yaml/);
  assert.match(html, /&lt;workspace&gt;\/\.agents\/skills\//);
  assert.match(html, /change\.md/);
  assert.match(html, /Planning expands <code>change\.md<\/code> and adds\s+<code>tasks\.md<\/code>/);
  assert.match(html, /existing records may retain a compatible <code>design\.md<\/code>/);
  assert.match(html, /Pre-1\.0 installation and Change formats are unsupported alpha data/);
  assert.match(html, /<code>sdd update<\/code> reconciles current managed doctrine and skills/);
  assert.doesNotMatch(html, /change-briefs\//);
  assert.doesNotMatch(html, /--from-user/);
  assert.match(
    html,
    /<code>sdd validate &lt;space-id&gt; --change &lt;change-id&gt; --workspace &lt;path&gt;<\/code>/,
  );
  assert.doesNotMatch(html, /<code>sdd validate --change<\/code>/);
  assert.doesNotMatch(html, /~\/\.sdd/);
  assert.doesNotMatch(html, /user-level Change store/i);
  assert.doesNotMatch(html, /globally unique Change IDs/i);
  assert.doesNotMatch(html, /sdd change promote/);
  assert.doesNotMatch(html, /planned-changes\//);
  assert.doesNotMatch(html, /docs\/changes/);
});

test("public guide presents ADR as a confirmed terminal decision handoff", async () => {
  const { html } = await readSite();

  assert.match(html, /ADRs preserve consequential\s+technical choices only when real alternatives/);
  assert.match(html, /ADR returns the confirmed direction to its caller without implementing it/);
  assert.match(html, /Compare viable technical paths and confirm consequential decisions/);
  assert.match(html, /<code>\/sdd-change<\/code><code>\/sdd-adr<\/code>/);
});

test("public guide presents Change as composable vertical-slice planning", async () => {
  const { html } = await readSite();

  assert.match(html, /independently green vertical Requirement slices/);
  assert.match(html, /observable outcome, Scenario-based proof intent/);
  assert.match(html, /Plan independently green slices and settle branching decisions/);
  assert.match(html, /<code>complete<\/code>, <code>no-op<\/code>,\s+<code>needs-user<\/code>, <code>blocked<\/code>, or <code>routed<\/code>/);
  assert.match(html, /returns control before Design or\s+Apply begins/);
  assert.match(html, /recommended handoffs, not an automatic cascade/);
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
  assert.match(script, /const canSelectCommandText = Boolean\(/);
  assert.match(script, /typeof selection\.removeAllRanges === "function"/);
  assert.match(script, /typeof selection\.addRange === "function"/);
  assert.match(script, /if \(canSelectCommandText\)/);
  assert.match(script, /range\.selectNodeContents\(commandText\)/);
  assert.match(script, /selection\.removeAllRanges\(\)/);
  assert.match(script, /selection\.addRange\(range\)/);
  assert.match(script, /label\.textContent = "Selected"/);
  assert.match(script, /label\.textContent = "Copy failed"/);
  assert.match(script, /label\.textContent = "Copy"/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /scroll-behavior:\s*auto/);
  assert.match(styles, /transition-duration:\s*0\.01ms/);
  assert.match(styles, /:focus-visible/);
});
