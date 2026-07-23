import { readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseDocument } from "yaml";

import { isPathPhysicallyInside, pathExists } from "./fs.js";

const REPORT_SCHEMA = "sdd-epic-verify-report-v1";
const ALIGNED_GATE_RESULTS = new Set(["pass", "not applicable"]);
const GATE_RESULTS = new Set(["pass", "findings", "blocked", "not applicable"]);
const RESULT_LABELS = new Set([
  "aligned",
  "changes-requested",
  "needs artifact fix",
  "needs implementation",
  "needs verification",
  "needs product decision",
  "blocked",
]);
const REQUIRED_SECTIONS = Object.freeze([
  "Verdict",
  "Current Gate Scorecard",
  "Current Findings",
  "Initial Findings (Historical)",
  "Remediation And Recheck",
  "Current Tests And Checks",
]);
const CANONICAL_GATES = Object.freeze([
  "SDD workflow adherence",
  "Epic coherence",
  "Epic template adherence",
  "Story shape",
  "Story requirement completeness",
  "Story reference traceability",
  "Canonical map authority",
  "Cold code navigation",
  "Semantic anchor ownership",
  "Reverse traceability inventory",
  "Requirement and Scenario truth",
  "Implementation drift",
  "Verification strength",
  "Aggregate/runtime verification scope",
  "Supporting truth freshness",
  "Change status traceability",
  "Docs and product alignment",
  "Security and data safety",
]);
const IMMUTABLE_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

function normalizePath(value) {
  return typeof value === "string" ? value.split("\\").join("/") : "";
}

function finding(level, code, path, message, context) {
  return { level, code, path: normalizePath(path), message, ...context };
}

function parseFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) return null;
  const data = document.toJS();
  return data && typeof data === "object" ? data : null;
}

function sectionLines(source, heading) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return null;
  const content = lines.slice(start + 1);
  const end = content.findIndex((line) => /^#{1,2}\s+/.test(line));
  return content.slice(0, end < 0 ? content.length : end);
}

function tableRows(lines) {
  if (!lines) return [];
  return lines
    .filter((line) => line.trim().startsWith("|") && line.trim().endsWith("|"))
    .slice(2)
    .map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
}

function currentFindingIsNone(lines, heading) {
  if (!lines) return false;
  const start = lines.findIndex((line) => line.trim() === `### ${heading}`);
  if (start < 0) return false;
  const content = lines.slice(start + 1);
  const end = content.findIndex((line) => /^#{1,3}\s+/.test(line));
  const entries = content
    .slice(0, end < 0 ? content.length : end)
    .map((line) => line.trim())
    .filter(Boolean);
  return entries.length === 1 && /^-\s+None\.$/i.test(entries[0]);
}

function hasSection(source, heading) {
  return sectionLines(source, heading) !== null;
}

function verdictValue(lines, label) {
  return lines
    .map((line) => line.match(new RegExp(`^- ${label}:\\s*\`([^\`]+)\``, "i"))?.[1])
    .find(Boolean);
}

function parseCommandTokens(command) {
  const tokens = [];
  let token = "";
  let quote = null;
  let escaped = false;

  for (const character of command.replaceAll("`", "").trim()) {
    if (escaped) {
      token += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else token += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
    } else {
      token += character;
    }
  }

  if (escaped) token += "\\";
  if (token) tokens.push(token);
  return quote ? [] : tokens;
}

function commandHasOptionValue(command, option, value) {
  const tokens = parseCommandTokens(command);
  const optionIndex = tokens.indexOf(option);
  return optionIndex >= 0 && tokens[optionIndex + 1] === value;
}

function orphanAuditHasRepositoryRoot(command, value) {
  const tokens = parseCommandTokens(command);
  const scriptIndex = tokens.findIndex((token) =>
    /(?:^|\/)sdd[_-]orphan[_-]audit(?:\.py)?$/i.test(token));
  return scriptIndex >= 0 && tokens[scriptIndex + 1] === value;
}

function isStructuralValidationCommand(command) {
  const tokens = parseCommandTokens(command);
  return tokens[0] === "sdd" && tokens[1] === "validate";
}

function isOrphanAuditCommand(command) {
  const tokens = parseCommandTokens(command);
  return ["python", "python3"].includes(tokens[0])
    && /(?:^|\/)sdd[_-]orphan[_-]audit\.py$/i.test(tokens[1] ?? "");
}

function reportDisplayPath(repositoryDisplayPath, repositoryRoot, reportPath) {
  return normalizePath(join(repositoryDisplayPath, relative(repositoryRoot, reportPath)));
}

export async function validateEpicVerifyReports({
  repository,
  repositoryRoot,
  epicPath,
  epicId,
}) {
  const reviewsPath = join(dirname(epicPath), "reviews");
  if (!(await pathExists(reviewsPath))) return { findings: [], reports: 0 };
  if (!(await isPathPhysicallyInside(dirname(epicPath), reviewsPath))) {
    return {
      findings: [finding(
        "error",
        "UNSAFE_EPIC_VERIFY_REPORT_PATH",
        reportDisplayPath(repository.resolvedPath, repositoryRoot, reviewsPath),
        "Epic verification reviews must remain physically inside their Epic directory.",
        {
          spaceId: repository.spaceId,
          repository: repository.resolvedPath,
          artifactType: "epic-verification-report",
          artifactId: epicId,
        },
      )],
      reports: 0,
    };
  }

  const entries = (await readdir(reviewsPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((left, right) => left.name.localeCompare(right.name));
  const reports = [];
  const malformedReports = [];
  const missingSchemaReports = [];
  const unknownReports = [];
  for (const entry of entries) {
    const path = join(reviewsPath, entry.name);
    const source = await readFile(path, "utf8");
    const frontmatter = parseFrontmatter(source);
    if (!frontmatter && /^(?:schema:.*sdd-epic-verify-report-v1|kind:.*sdd-epic-verify-report).*$/m.test(source)) {
      malformedReports.push(path);
      continue;
    }
    if (frontmatter?.kind === "sdd-epic-verify-report"
      && !frontmatter.schema) {
      missingSchemaReports.push(path);
      continue;
    }
    if (frontmatter?.kind === "sdd-epic-verify-report"
      && frontmatter.schema
      && frontmatter.schema !== REPORT_SCHEMA) {
      unknownReports.push({ path, schema: frontmatter.schema });
      continue;
    }
    if (frontmatter?.schema !== REPORT_SCHEMA) continue;
    reports.push({ path, source, frontmatter });
  }

  const findings = [];
  const context = {
    spaceId: repository.spaceId,
    repository: repository.resolvedPath,
    artifactType: "epic-verification-report",
    artifactId: epicId,
  };
  const reportByPath = new Map(reports.map((report) => [resolve(report.path), report]));
  const predecessorByReport = new Map();
  const successorsByPredecessor = new Map();

  for (const path of malformedReports) {
    findings.push(finding(
      "error",
      "INVALID_EPIC_VERIFY_REPORT_FRONTMATTER",
      reportDisplayPath(repository.resolvedPath, repositoryRoot, path),
      "Versioned Epic verification report frontmatter cannot be parsed.",
      context,
    ));
  }
  for (const path of missingSchemaReports) {
    findings.push(finding(
      "error",
      "MISSING_EPIC_VERIFY_REPORT_SCHEMA",
      reportDisplayPath(repository.resolvedPath, repositoryRoot, path),
      `Recognized Epic verification reports must declare schema ${REPORT_SCHEMA}.`,
      context,
    ));
  }
  for (const report of unknownReports) {
    findings.push(finding(
      "error",
      "UNKNOWN_EPIC_VERIFY_REPORT_SCHEMA",
      reportDisplayPath(repository.resolvedPath, repositoryRoot, report.path),
      `Unsupported Epic verification report schema: ${report.schema}.`,
      context,
    ));
  }

  for (const report of reports) {
    const { source, frontmatter } = report;
    const displayPath = reportDisplayPath(repository.resolvedPath, repositoryRoot, report.path);
    const expectedEpicPath = normalizePath(relative(repositoryRoot, epicPath));
    const missingSections = REQUIRED_SECTIONS.filter((heading) => !hasSection(source, heading));
    if (missingSections.length > 0) {
      findings.push(finding(
        "error",
        "MISSING_EPIC_VERIFY_REPORT_SECTION",
        displayPath,
        `Versioned report is missing current-state sections: ${missingSections.join(", ")}.`,
        context,
      ));
    }
    const requiredMetadata = [
      "kind",
      "epic",
      "epic_path",
      "created",
      "initial_result",
      "result",
      "mode",
      "audited_ref",
      "verified_ref",
    ];
    const missingMetadata = requiredMetadata.filter((key) => !frontmatter[key]);
    if (missingMetadata.length > 0
      || !RESULT_LABELS.has(frontmatter.initial_result)
      || !RESULT_LABELS.has(frontmatter.result)
      || !IMMUTABLE_COMMIT.test(String(frontmatter.audited_ref ?? ""))
      || !IMMUTABLE_COMMIT.test(String(frontmatter.verified_ref ?? ""))) {
      findings.push(finding(
        "error",
        "INVALID_EPIC_VERIFY_REPORT_METADATA",
        displayPath,
        `Report metadata is incomplete or invalid${missingMetadata.length > 0 ? `: ${missingMetadata.join(", ")}` : "."}`,
        context,
      ));
    }
    if (frontmatter.kind !== "sdd-epic-verify-report"
      || frontmatter.epic !== epicId
      || normalizePath(frontmatter.epic_path) !== expectedEpicPath) {
      findings.push(finding(
        "error",
        "INVALID_EPIC_VERIFY_REPORT_IDENTITY",
        displayPath,
        `Report identity must name Epic ${epicId} at ${expectedEpicPath}.`,
        context,
      ));
    }

    const verdict = sectionLines(source, "Verdict") ?? [];
    const verdictInitialResult = verdictValue(verdict, "Initial result");
    const verdictResult = verdictValue(verdict, "Current result");
    const verdictAuditedRef = verdictValue(verdict, "Audited ref");
    const verdictVerifiedRef = verdictValue(verdict, "Verified ref");
    if (verdictInitialResult !== frontmatter.initial_result
      || verdictResult !== frontmatter.result
      || verdictAuditedRef !== frontmatter.audited_ref
      || verdictVerifiedRef !== frontmatter.verified_ref) {
      findings.push(finding(
        "error",
        "EPIC_VERIFY_VERDICT_MISMATCH",
        displayPath,
        "Verdict initial/current results and audited/verified refs must exactly match frontmatter.",
        context,
      ));
    }

    if (frontmatter.result === "aligned") {
      const gates = tableRows(sectionLines(source, "Current Gate Scorecard"));
      const gateCounts = new Map();
      for (const row of gates) {
        const gate = row[0] ?? "";
        gateCounts.set(gate, (gateCounts.get(gate) ?? 0) + 1);
      }
      const completeGateCoverage = gates.length === CANONICAL_GATES.length
        && CANONICAL_GATES.every((gate) => gateCounts.get(gate) === 1);
      const contradictoryGate = gates.find((row) => !ALIGNED_GATE_RESULTS.has((row[1] ?? "").toLowerCase()));
      const currentFindings = sectionLines(source, "Current Findings");
      const checks = tableRows(sectionLines(source, "Current Tests And Checks"));
      const scopedValidation = checks.find((row) => {
        const command = row[0] ?? "";
        return isStructuralValidationCommand(command)
          && commandHasOptionValue(command, "--epic", epicId)
          && commandHasOptionValue(command, "--repo", repository.resolvedPath)
          && commandHasOptionValue(command, "--changed-from", frontmatter.audited_ref);
      });
      const reverseInventory = checks.find((row) => {
        const command = row[0] ?? "";
        return isOrphanAuditCommand(command)
          && commandHasOptionValue(command, "--epic", epicId)
          && orphanAuditHasRepositoryRoot(command, repository.resolvedPath);
      });
      const failedRequiredCheck = checks.find((row) => {
        const required = /\brequired\b/i.test(row[3] ?? "");
        return required && (row[1] ?? "").toLowerCase() !== "pass";
      });
      if (!completeGateCoverage
        || contradictoryGate
        || !currentFindingIsNone(currentFindings, "BLOCKING")
        || !currentFindingIsNone(currentFindings, "REQUIRED")
        || (scopedValidation?.[1] ?? "").toLowerCase() !== "pass"
        || (reverseInventory?.[1] ?? "").toLowerCase() !== "pass"
        || failedRequiredCheck) {
        findings.push(finding(
          "error",
          "EPIC_VERIFY_RESULT_CONTRADICTION",
          displayPath,
          "An aligned report must cover every canonical Current Gate Scorecard row exactly once with pass/not-applicable, have no current blocking or required findings, and include passing required checks against its audited ref.",
          context,
        ));
      }
    }

    if (frontmatter.result && frontmatter.result !== "aligned"
      && RESULT_LABELS.has(frontmatter.result)) {
      const gates = tableRows(sectionLines(source, "Current Gate Scorecard"));
      const gateCounts = new Map();
      for (const row of gates) {
        const gate = row[0] ?? "";
        gateCounts.set(gate, (gateCounts.get(gate) ?? 0) + 1);
      }
      const completeGateCoverage = gates.length === CANONICAL_GATES.length
        && CANONICAL_GATES.every((gate) => gateCounts.get(gate) === 1);
      const expectedGate = frontmatter.result === "blocked" ? "blocked" : "findings";
      const hasExpectedGate = gates.some((row) => (row[1] ?? "").toLowerCase() === expectedGate);
      const currentFindings = sectionLines(source, "Current Findings");
      const hasCurrentFinding = !currentFindingIsNone(currentFindings, "BLOCKING")
        || !currentFindingIsNone(currentFindings, "REQUIRED");
      const checks = tableRows(sectionLines(source, "Current Tests And Checks"));
      if (!completeGateCoverage || !hasExpectedGate || !hasCurrentFinding || checks.length === 0) {
        findings.push(finding(
          "error",
          "EPIC_VERIFY_RESULT_CONTRADICTION",
          displayPath,
          "A non-aligned report must have a complete scorecard, a result-appropriate current gate, current blocking or required findings, and current checks.",
          context,
        ));
      }
    }

    const invalidGate = tableRows(sectionLines(source, "Current Gate Scorecard"))
      .find((row) => !GATE_RESULTS.has((row[1] ?? "").toLowerCase()));
    if (invalidGate) {
      findings.push(finding(
        "error",
        "INVALID_EPIC_VERIFY_GATE_RESULT",
        displayPath,
        "Current Gate Scorecard results must be pass, findings, blocked, or not applicable.",
        context,
      ));
    }

    if (frontmatter.initial_result !== frontmatter.result
      && (!hasSection(source, "Initial Findings (Historical)")
        || !hasSection(source, "Remediation And Recheck"))) {
      findings.push(finding(
        "error",
        "MISSING_EPIC_VERIFY_REMEDIATION",
        displayPath,
        "A changed result requires explicit historical findings and remediation/recheck sections.",
        context,
      ));
    }

    if (frontmatter.supersedes) {
      const value = String(frontmatter.supersedes);
      const repositoryRelative = !isAbsolute(value)
        && !normalizePath(value).startsWith("../")
        && !normalizePath(value).startsWith("./");
      const target = isAbsolute(value) ? resolve(value) : resolve(repositoryRoot, value);
      const physicallyInside = await isPathPhysicallyInside(reviewsPath, target);
      const predecessor = reportByPath.get(target);
      if (!repositoryRelative || !physicallyInside || target === resolve(report.path) || !predecessor) {
        findings.push(finding(
          "error",
          "BROKEN_EPIC_VERIFY_SUPERSEDES",
          displayPath,
          "`supersedes` must name an existing versioned report in the same Epic reviews directory.",
          context,
        ));
      } else {
        if (frontmatter.initial_result !== predecessor.frontmatter.result) {
          findings.push(finding(
            "error",
            "EPIC_VERIFY_LINEAGE_RESULT_MISMATCH",
            displayPath,
            "A successor initial_result must equal its predecessor current result.",
            context,
          ));
        }
        const reportKey = resolve(report.path);
        predecessorByReport.set(reportKey, target);
        successorsByPredecessor.set(
          target,
          [...(successorsByPredecessor.get(target) ?? []), reportKey],
        );
      }
    }
  }

  for (const [predecessor, successors] of successorsByPredecessor) {
    if (successors.length <= 1) continue;
    findings.push(finding(
      "error",
      "AMBIGUOUS_EPIC_VERIFY_LINEAGE",
      reportDisplayPath(repository.resolvedPath, repositoryRoot, predecessor),
      "More than one versioned report supersedes the same predecessor.",
      context,
    ));
  }

  for (const reportPath of reportByPath.keys()) {
    const seen = new Set();
    let current = reportPath;
    while (predecessorByReport.has(current)) {
      if (seen.has(current)) {
        findings.push(finding(
          "error",
          "CYCLIC_EPIC_VERIFY_LINEAGE",
          reportDisplayPath(repository.resolvedPath, repositoryRoot, reportPath),
          "Versioned Epic verification report lineage contains a cycle.",
          context,
        ));
        break;
      }
      seen.add(current);
      current = predecessorByReport.get(current);
    }
  }

  const superseded = new Set(predecessorByReport.values());
  const tips = [...reportByPath.keys()].filter((path) => !superseded.has(path));
  if (tips.length > 1) {
    findings.push(finding(
      "error",
      "AMBIGUOUS_EPIC_VERIFY_TIP",
      normalizePath(join(repository.resolvedPath, relative(repositoryRoot, reviewsPath))),
      "Versioned Epic verification reports must have one unambiguous current tip linked through `supersedes`.",
      context,
    ));
  }

  return {
    findings,
    reports: reports.length
      + malformedReports.length
      + missingSchemaReports.length
      + unknownReports.length,
  };
}
