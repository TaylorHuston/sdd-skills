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

  assert.match(html, /A PRD is a starting direction to revisit deliberately, not a document to synchronize after every slice/);
  assert.match(html, /It can be broader, older, or phased differently without blocking an accepted Change/);
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
  assert.match(html, /Apply's narrow local slice-commit authority never implies push, PR, merge, release, deployment, or closeout/);
});

test("public guide presents Design as optional planned convergence and candidate-bound revision", async () => {
  const { html } = await readSite();

  assert.match(html, /Validate, then commit to the planned scope[\s\S]*Optionally converge the planned experience/);
  assert.match(html, /Design uses the same statuses, preserves a <code>planned<\/code> Change during initial convergence, binds revisions to exact repository candidates, keeps prototypes optional, and returns before separately invoked Apply or Review/);
});

test("public guide presents Apply as one reviewed and reconciled slice pipeline", async () => {
  const { html } = await readSite();

  assert.match(html, /Deliver, review, reconcile, and commit one slice/);
  assert.match(html, /exact baseline with fresh candidate-bound evidence/);
  assert.match(html, /Apply uses the same public statuses after exactly one atomic Requirement slice/);
  assert.match(html, /implement inline or through one fresh-context worker in an\s+authorized dedicated isolated workspace/);
  assert.match(html, /transient Scenario proof sketch without adding another durable matrix/);
  assert.match(html, /invokes the public Review contract in implementation-phase slice-checkpoint mode/);
  assert.match(html, /admits grounded required findings, performs one consolidated same-slice remediation batch/);
  assert.match(html, /another pre-existing finding returns <code>needs-user<\/code>/);
  assert.match(html, /only a remediation-introduced regression receives one narrow correction/);
  assert.match(html, /requires one fresh final Review across every affected Scenario before invoking the public Epic Update contract/);
  assert.match(html, /evidence type, and durable reproduction reference/);
  assert.match(html, /temporary-only artifacts cannot close a technical gate/);
  assert.match(html, /prior verdicts as claims to falsify/);
  assert.match(html, /Gate Execution Manifest that accounts for every applicable gate/);
  assert.match(html, /real diff-scoped reverse-traceability audit/);
  assert.match(html, /Required technical gaps cannot pass as manual acceptance/);
  assert.match(html, /When Epic files change, Apply invokes a fresh comprehensive post-Epic slice Review on the final candidate/);
  assert.match(html, /final Review writes a durable <code>slice-reviews\/S#\.md<\/code>/);
  assert.match(html, /minimal machine-validated receipt containing Review identity\/candidate\/verdict\/raw digest/);
  assert.match(html, /Review and Epic Update remain directly callable/);
});

test("public guide presents candidate-bound Epic reconciliation as its own capability", async () => {
  const { html } = await readSite();

  assert.match(html, /Confirm the final Review and Epic truth share one candidate/);
  assert.match(html, /<code>\/sdd-epic-update<\/code>/);
  assert.match(html, /public Epic Update contract/);
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

test("public guide distinguishes structured Change validation from planning judgment", async () => {
  const { html } = await readSite();

  assert.match(html, /CLI validates slice fields, references,\s+dependencies, unique Scenario references, explicit visual obligations, one current Implementation Ledger row and one candidate-bound Slice Gate Ledger row per slice, a durable slice Review plus minimal versioned closure receipt/);
  assert.match(html, /Gate rows use exact commit or content-sensitive working-tree watermarks/);
  assert.match(html, /slice marked <code>Closure receipt: required<\/code> cannot remain <code>done<\/code> without complete gate state, an owner-confined detailed slice Review, a matching minimal receipt, exact Scenario and planned visual contract accounting, durable Review proof references that resolve in the seal, reconciled gaps, a Review-byte digest, and a reachable single-parent commit/);
  assert.match(html, /Legacy v1 receipts and existing completed slices without the marker remain compatible/);
  assert.match(html, /CLI validates provenance and consistency, not whether the proof is semantically sufficient/);
  assert.match(html, /atomic Requirement slices, explicit multi-Requirement coupling, candidate-consistent gate ledgers, durable slice Reviews, minimal closure receipts, exact gate\/Scenario\/visual sets, Review digests, accepted-gap reconciliation, reviewed-tree\/final-tree seals, ledger\/checkpoint coherence/);
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
