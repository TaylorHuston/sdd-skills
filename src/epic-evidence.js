import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { isPathPhysicallyInside, pathExists } from "./fs.js";

export function orderedValuesEqual(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function isRepositoryRelativePath(path) {
  return Boolean(path)
    && !isAbsolute(path)
    && !path.startsWith("../")
    && !/\s/.test(path);
}

export function isAutomatedTestPath(path) {
  const lowered = path.replace(/^\.\//, "").replace(/:\d+$/, "").toLowerCase();
  return (
    /(?:^|\/)(?:__tests__|e2e|spec|specs|test|tests)\//.test(lowered)
    || /\.(?:spec|test)\.[a-z0-9]+$/.test(lowered)
    || /(?:^|\/)test_[^/]+\.py$/.test(lowered)
    || /(?:^|\/)[^/]+_test\.py$/.test(lowered)
  );
}

export async function readRegularText(path) {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) return { source: null, error: "path is not a regular file" };
    return { source: await readFile(path, "utf8"), error: null };
  } catch (error) {
    return { source: null, error: error.message };
  }
}

export function behaviorReferences(value) {
  return [...value.matchAll(/\b(S\d+|[A-Z][A-Z0-9-]*-\d+)\/(R\d+(?:-S\d+)?)\b/g)]
    .map((match) => ({ story: match[1], behavior: match[2] }));
}

export function implementationLocationPaths(value) {
  return [...value.matchAll(/`([^`]+)`/g)].map((match) => {
    const normalized = match[1].split("\\").join("/").replace(/^\.\//, "");
    const anchorIndex = normalized.indexOf("#");
    return {
      raw: normalized,
      path: anchorIndex >= 0 ? normalized.slice(0, anchorIndex) : normalized,
      anchor: anchorIndex >= 0 ? normalized.slice(anchorIndex + 1) : "",
    };
  });
}

export function automatedEvidenceTestLocations(evidence) {
  const explicitlyAutomated = /\b(?:automated|e2e|end-to-end|integration|japa|jest|playwright|pytest|specs?|unit|vitest)\b/i.test(evidence);
  const genericTestEvidence = /\btests?\b/i.test(evidence) && !/\bmanual\b/i.test(evidence);
  return explicitlyAutomated || genericTestEvidence ? implementationLocationPaths(evidence) : null;
}

export function isPassingEvidenceStatus(value) {
  return /^(?:passing\b|user confirmed\b)/i.test(value.trim());
}

export function isGenericAutomatedEvidenceAnchor(value) {
  return /^(?:it|test|describe|specify)(?:\.(?:each|only|skip|todo))?\($/i.test(value.trim());
}

export async function validateVerifiedEvidenceRow({
  row,
  isV2,
  storyLabel,
  knownEvidenceIds,
  storyPath,
  context,
  repositoryRoot,
  createFinding,
}) {
  const reference = row[0] ?? "";
  const evidence = row[1] ?? "";
  const proves = row[2] ?? "";
  const evidenceStatus = row[3] ?? "";
  const findings = [];
  let rowUsable = true;
  const validBehaviorReferences = [];
  if (isV2 && [reference, evidence, proves, evidenceStatus].some((cell) => !cell.trim())) {
    rowUsable = false;
    findings.push(createFinding(
      "error",
      "INCOMPLETE_VERIFIED_BY_ROW",
      storyPath,
      "Verified By rows must include a reference, evidence, what it proves, and status.",
      context,
    ));
  }
  const rowBehaviorReferences = behaviorReferences(reference);
  if (isV2 && rowBehaviorReferences.length === 0) rowUsable = false;
  if (isV2) {
    for (const item of rowBehaviorReferences) {
      if (item.story !== storyLabel || !knownEvidenceIds.has(item.behavior)) {
        rowUsable = false;
        findings.push(createFinding(
          "error",
          "BROKEN_EVIDENCE_REFERENCE",
          storyPath,
          `Verified By references unknown ${item.story}/${item.behavior}.`,
          context,
        ));
      } else validBehaviorReferences.push(item);
    }
  }
  const ids = [...reference.matchAll(/(?:^|\/)R\d+(?:-S\d+)?/g)]
    .map((match) => match[0].replace(/^\//, ""));
  if (ids.length === 0) {
    rowUsable = false;
    findings.push(createFinding(
      "error",
      "INVALID_EVIDENCE_REFERENCE",
      storyPath,
      `Verified By row has no Requirement or Scenario reference: ${reference || "(empty)"}.`,
      context,
    ));
  } else {
    for (const id of ids) {
      if (!knownEvidenceIds.has(id)) {
        rowUsable = false;
        findings.push(createFinding(
          "error",
          "BROKEN_EVIDENCE_REFERENCE",
          storyPath,
          `Verified By references unknown ${storyLabel}/${id}.`,
          context,
        ));
      }
    }
  }
  const testLocations = automatedEvidenceTestLocations(evidence);
  if (testLocations?.length === 0) {
    rowUsable = false;
    findings.push(createFinding(
      isV2 ? "error" : "warning",
      "GENERIC_AUTOMATED_EVIDENCE",
      storyPath,
      `Verified By automated evidence for ${reference || "(unmapped)"} must name a concrete repository-relative test path: ${evidence || "(empty)"}.`,
      context,
    ));
  }
  for (const testLocation of testLocations ?? []) {
    const testPath = testLocation.path.replace(/:\d+$/, "");
    if (!isRepositoryRelativePath(testPath) || !isAutomatedTestPath(testPath)) {
      rowUsable = false;
      findings.push(createFinding(
        isV2 ? "error" : "warning",
        "INVALID_AUTOMATED_EVIDENCE_PATH",
        storyPath,
        `Every cited automated evidence path must be a repository-relative test file: ${testLocation.raw}.`,
        context,
      ));
      continue;
    }
    const absoluteTestPath = resolve(repositoryRoot, testPath.replace(/^\.\//, ""));
    const relativeTestPath = relative(repositoryRoot, absoluteTestPath).split("\\").join("/");
    const contained = !relativeTestPath.startsWith("../")
      && await isPathPhysicallyInside(repositoryRoot, absoluteTestPath);
    if (!contained) {
      rowUsable = false;
      findings.push(createFinding(
        isV2 ? "error" : "warning",
        "EVIDENCE_PATH_OUTSIDE_REPOSITORY",
        storyPath,
        `Verified By test path for ${reference || "(unmapped)"} resolves outside the repository: ${testPath}.`,
        context,
      ));
    } else if (!(await pathExists(absoluteTestPath))) {
      rowUsable = false;
      findings.push(createFinding(
        isV2 ? "error" : "warning",
        "MISSING_AUTOMATED_EVIDENCE_PATH",
        storyPath,
        `Verified By automated test path for ${reference || "(unmapped)"} does not exist in the repository: ${testPath}.`,
        context,
      ));
    } else if (isV2 && !testLocation.anchor) {
      rowUsable = false;
      findings.push(createFinding(
        "error",
        "MISSING_AUTOMATED_EVIDENCE_ANCHOR",
        storyPath,
        `Verified By automated test path for ${reference || "(unmapped)"} must include a searchable anchor after #: ${testPath}.`,
        context,
      ));
    } else if (isV2 && isGenericAutomatedEvidenceAnchor(testLocation.anchor)) {
      rowUsable = false;
      findings.push(createFinding(
        "error",
        "GENERIC_AUTOMATED_EVIDENCE_ANCHOR",
        storyPath,
        `Verified By automated evidence for ${reference || "(unmapped)"} must name an exact test title or stable named test anchor, not framework syntax: ${testLocation.raw}.`,
        context,
      ));
    } else if (isV2) {
      const testSource = await readRegularText(absoluteTestPath);
      if (testSource.error) {
        rowUsable = false;
        findings.push(createFinding(
          "error",
          "INVALID_AUTOMATED_EVIDENCE_PATH",
          storyPath,
          `Verified By automated test path is not a readable regular file: ${testPath} (${testSource.error}).`,
          context,
        ));
      } else if (!testSource.source.includes(testLocation.anchor)) {
        rowUsable = false;
        findings.push(createFinding(
          "error",
          "MISSING_AUTOMATED_EVIDENCE_ANCHOR",
          storyPath,
          `Verified By automated anchor was not found in ${testPath}: ${testLocation.anchor}.`,
          context,
        ));
      }
    }
  }
  return {
    findings,
    verifiedBehaviors: isV2 && rowUsable
      ? validBehaviorReferences.map((item) => item.behavior)
      : [],
    passingBehaviors: isV2 && rowUsable && isPassingEvidenceStatus(evidenceStatus)
      ? validBehaviorReferences.map((item) => item.behavior)
      : [],
  };
}
