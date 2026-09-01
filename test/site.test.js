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
  assert.match(html, /Planning expands <code>change\.md<\/code>, then adds a\s+compact <code>tasks\.md<\/code> queue and one central <code>review\.md<\/code>/);
  assert.match(html, /Existing records may retain a compatible <code>design\.md<\/code>/);
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

test("public guide presents PRDs as directional starting points rather than delivery gates", async () => {
  const { html } = await readSite();

  assert.match(html, /A PRD is a starting direction to revisit deliberately, not a document to synchronize after every outcome/);
  assert.match(html, /It can be broader, older, or phased differently without blocking an accepted Change/);
});

test("public guide presents ADR as a confirmed terminal decision handoff", async () => {
  const { html } = await readSite();

  assert.match(html, /ADRs preserve consequential\s+technical choices only when real alternatives/);
  assert.match(html, /ADR returns the confirmed direction to its caller without implementing it/);
  assert.match(html, /Compare viable technical paths and confirm consequential decisions/);
  assert.match(html, /<code>\/sdd-change<\/code><code>\/sdd-adr<\/code>/);
});

test("public guide presents Change as coherent outcome planning", async () => {
  const { html } = await readSite();

  assert.match(html, /Outcomes describe observable\s+behavior, Scenarios, dependencies, expected risks, and focused proof/);
  assert.match(html, /One Requirement is a useful default, not a universal rule/);
  assert.match(html, /Plan coherent outcomes and settle branching decisions/);
  assert.match(html, /<code>complete<\/code>, <code>no-op<\/code>,\s+<code>needs-user<\/code>, <code>blocked<\/code>, or <code>routed<\/code>/);
  assert.match(html, /returns control before Design or\s+Apply begins/);
  assert.match(html, /Apply's narrow local outcome-commit authority never implies push, PR, merge, release, deployment, or closeout/);
});

test("public guide presents Design as optional planned convergence and candidate-bound revision", async () => {
  const { html } = await readSite();

  assert.match(html, /Validate, then commit to the planned scope[\s\S]*Optionally converge the planned experience/);
  assert.match(html, /Design uses the same statuses, preserves a <code>planned<\/code> Change during initial convergence, binds revisions to exact repository candidates, keeps prototypes optional, and returns before separately invoked Apply or Review/);
});

test("public guide presents Apply as one focused reviewed outcome", async () => {
  const { html } = await readSite();

  assert.match(html, /Deliver, verify, review, reconcile when needed, and commit one outcome/);
  assert.match(html, /records an exact baseline/);
  assert.match(html, /transient Scenario proof sketch without creating another durable matrix/);
  assert.match(html, /focused behavior-derived verification/);
  assert.match(html, /Broad suites are reserved for material breadth, project policy, integration, or release risk/);
  assert.match(html, /five universal gates and only the concrete triggered checks/);
  assert.match(html, /separate Spec Adherence and Implementation Quality judgments/);
  assert.match(html, /Required technical gaps cannot pass as manual acceptance/);
  assert.match(html, /accepted technical gap names the exact gap and date/);
  assert.match(html, /product acceptance remains independently pending until the owner confirms it/);
  assert.match(html, /one consolidated remediation batch and one fresh final Review/);
  assert.match(html, /Epic reconciliation runs immediately when accepted behavior, Story completion, or a consumed contract or gap changes/);
  assert.match(html, /creates one content-identical local commit/);
  assert.match(html, /records the commit and matching tree in central <code>review\.md<\/code>/);
  assert.match(html, /Review and Epic Update remain directly callable/);
  assert.doesNotMatch(html, /slice-reviews\/|slice-closures\/|Closure receipt|required Review digest|second current profile/);
});

test("public guide presents candidate-bound Epic reconciliation as its own capability", async () => {
  const { html } = await readSite();

  assert.match(html, /Confirm the final Review and Epic truth share one candidate/);
  assert.match(html, /<code>\/sdd-epic-update<\/code>/);
  assert.match(html, /Epic reconciliation runs immediately when accepted behavior, Story completion, or a consumed contract or gap changes/);
  assert.match(html, /Review and Epic Update remain directly callable/);
  assert.match(html, /Epic truth share one candidate/);
  assert.match(html, /<code>sdd epic update-input<\/code>/);
});

test("public guide presents candidate-bound Changelog as separate from Release", async () => {
  const { html } = await readSite();

  assert.match(html, /<code>\/sdd-changelog<\/code>/);
  assert.match(html, /same candidate envelope after current final Review and current Epic truth/);
  assert.match(html, /repository's native release-record policy/);
  assert.match(html, /returns <code>no-op<\/code> for internal-only or already accurate work/);
  assert.match(html, /stops before versioning, staging, commits, PRs, release, or deployment/);
  assert.match(html, /Release owns aggregation and version intent/);
  assert.match(html, /<code>sdd candidate resolve<\/code>/);
});

test("public guide distinguishes deterministic v2 validation from independent judgment", async () => {
  const { html } = await readSite();

  assert.match(html, /five universal gates: scope and candidate, behavior, fresh\s+verification, independent Spec and Quality review, and integrity and authority/);
  assert.match(html, /Planning declares\s+expected risks; Review runs concrete behavior-derived checks/);
  assert.match(html, /Validate current Change structure, outcome dependencies, five universal gates, declared triggers, exact Scenario sets, dated gap treatment, commit reachability, and reviewed-tree\/final-tree equality/);
  assert.match(html, /CLI validates deterministic structure and provenance; independent Review judges\s+whether the proof is sufficient/);
  assert.match(html, /Schema-less and receipt-based Change records are unsupported pre-1\.0 history/);
  assert.match(html, /not a second\s+current profile/);
  assert.doesNotMatch(html, /Implementation Ledger|Slice Gate Ledger|Review-byte digest|minimal closure receipt|Legacy v1 receipts/);
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
  assert.match(html, /class="mapFlow" role="group" aria-label="Idea to verified evidence"/);
  assert.match(html, /class="traceStack" role="group" aria-label="Traceability hierarchy"/);
  assert.equal((html.match(/<pre role="region" tabindex="0" aria-label="Default [^"]+ document layout">/g) ?? []).length, 3);
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
