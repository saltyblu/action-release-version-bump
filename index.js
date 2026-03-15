#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules"]);

function getInput(name, fallback = "") {
  const githubActionsKey = `INPUT_${name.toUpperCase().replace(/ /g, "_")}`;
  const legacyKey = `INPUT_${name.toUpperCase().replace(/[- ]/g, "_")}`;
  const value = process.env[githubActionsKey] ?? process.env[legacyKey] ?? fallback;
  return value.trim();
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    throw new Error("GITHUB_OUTPUT is not set");
  }
  fs.appendFileSync(outputFile, `${name}=${value}\n`, "utf8");
}

function validateVersion(version) {
  if (!/^(\d+)\.(\d+)\.(\d+)$/.test(version)) {
    throw new Error(`Invalid version: ${version}. Expected semantic version like 1.2.3`);
  }
}

function isProbablyTextFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length === 0) {
    return true;
  }
  let suspiciousBytes = 0;
  const limit = Math.min(buffer.length, 1024);
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) {
      return false;
    }
    if (buffer[i] < 7 || (buffer[i] > 14 && buffer[i] < 32)) {
      suspiciousBytes += 1;
    }
  }
  return suspiciousBytes / limit < 0.2;
}

function listFilesRecursive(rootDir, includePrefixes) {
  const collected = [];

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const relative = path.relative(rootDir, absolutePath).split(path.sep).join("/");
      if (includePrefixes.length > 0 && !includePrefixes.some((prefix) => relative.startsWith(prefix))) {
        continue;
      }
      collected.push(absolutePath);
    }
  }

  walk(rootDir);
  return collected;
}

function parseSimpleYamlConfig(text) {
  const rules = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let inReplacements = false;
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    if (line === "replacements:" || line === "rules:") {
      inReplacements = true;
      continue;
    }

    if (!inReplacements) {
      continue;
    }

    if (line.startsWith("- ")) {
      if (current && current.path) {
        rules.push(current);
      }
      current = {};
      const remainder = line.slice(2).trim();
      if (remainder) {
        const [key, ...valueParts] = remainder.split(":");
        if (key && valueParts.length > 0) {
          current[key.trim()] = valueParts.join(":").trim().replace(/^['"]|['"]$/g, "");
        }
      }
      continue;
    }

    if (current && line.includes(":")) {
      const [key, ...valueParts] = line.split(":");
      current[key.trim()] = valueParts.join(":").trim().replace(/^['"]|['"]$/g, "");
    }
  }

  if (current && current.path) {
    rules.push(current);
  }

  return rules.map((rule) => ({
    path: rule.path,
    marker: rule.marker,
    replacementValue: rule["replacement-value"],
  }));
}

function replaceMarkedLine(line, marker, replacementValue) {
  const markerIndex = line.indexOf(marker);
  if (markerIndex < 0) {
    return line;
  }

  const beforeMarker = line.slice(0, markerIndex);
  const afterMarker = line.slice(markerIndex);

  // Marker format supports delimiter-driven replacements, e.g.:
  // - update-automation:@  => replace token after last '@' before marker
  // - update-automation::  => replace token after last ':' before marker
  // Legacy update-automation:version keeps semver-only replacement behavior.
  const markerDirective = marker.startsWith("update-automation:")
    ? marker.slice("update-automation:".length)
    : "version";

  if (markerDirective && markerDirective !== "version") {
    const delimiter = markerDirective;
    const delimiterIndex = beforeMarker.lastIndexOf(delimiter);
    if (delimiterIndex < 0) {
      return line;
    }

    let tokenStart = delimiterIndex + delimiter.length;
    while (tokenStart < beforeMarker.length && /\s/.test(beforeMarker[tokenStart])) {
      tokenStart += 1;
    }

    const commentIndex = beforeMarker.indexOf("#", tokenStart);
    let tokenEnd = commentIndex >= 0 ? commentIndex : beforeMarker.length;
    while (tokenEnd > tokenStart && /\s/.test(beforeMarker[tokenEnd - 1])) {
      tokenEnd -= 1;
    }

    if (tokenStart >= tokenEnd) {
      return line;
    }

    const updatedBefore = `${beforeMarker.slice(0, tokenStart)}${replacementValue}${beforeMarker.slice(tokenEnd)}`;
    return `${updatedBefore}${afterMarker}`;
  }

  const tokenPattern = /v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/g;
  const matches = [...beforeMarker.matchAll(tokenPattern)];

  if (matches.length === 0) {
    return line;
  }

  const last = matches[matches.length - 1];
  const start = last.index;
  const end = start + last[0].length;
  const updatedBefore = `${beforeMarker.slice(0, start)}${replacementValue}${beforeMarker.slice(end)}`;
  return `${updatedBefore}${afterMarker}`;
}

function updateContent(content, marker, replacementValue) {
  const hasCrlf = content.includes("\r\n");
  const eol = hasCrlf ? "\r\n" : "\n";
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let changed = false;

  const updatedLines = lines.map((line) => {
    const updated = replaceMarkedLine(line, marker, replacementValue);
    if (updated !== line) {
      changed = true;
    }
    return updated;
  });

  return {
    changed,
    content: updatedLines.join(eol),
  };
}

function resolveRules(cwd, configFileInput, defaultMarker) {
  const configPath = path.resolve(cwd, configFileInput);
  if (!fs.existsSync(configPath)) {
    return [];
  }

  const parsed = parseSimpleYamlConfig(fs.readFileSync(configPath, "utf8"));
  return parsed
    .filter((rule) => Boolean(rule.path))
    .map((rule) => ({
      path: rule.path,
      marker: rule.marker || defaultMarker,
      replacementValue: rule.replacementValue || "",
    }));
}

function main() {
  const version = getInput("version", "");
  const tagPrefix = getInput("tag-prefix", "v");
  const explicitReplacementValue = getInput("replacement-value", "");
  const workingDirectoryInput = getInput("working-directory", ".");
  const marker = getInput("marker", "update-automation:version");
  const configFileInput = getInput("config-file", ".github/release-automation.yml");
  const includeGlobInput = getInput("include-glob", "");
  const dryRun = getInput("dry-run", "false") === "true";

  validateVersion(version);

  const replacementValue = explicitReplacementValue || `${tagPrefix}${version}`;
  const includePrefixes = includeGlobInput
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const cwd = path.resolve(process.cwd(), workingDirectoryInput);
  const updatedFiles = [];

  const configuredRules = resolveRules(cwd, configFileInput, marker);

  if (configuredRules.length > 0) {
    for (const rule of configuredRules) {
      const targetPath = path.resolve(cwd, rule.path);
      if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
        continue;
      }
      if (!isProbablyTextFile(targetPath)) {
        continue;
      }

      const original = fs.readFileSync(targetPath, "utf8");
      const result = updateContent(original, rule.marker, rule.replacementValue || replacementValue);
      if (result.changed) {
        if (!dryRun) {
          fs.writeFileSync(targetPath, result.content, "utf8");
        }
        updatedFiles.push(path.relative(cwd, targetPath).split(path.sep).join("/"));
      }
    }
  } else {
    const allFiles = listFilesRecursive(cwd, includePrefixes);
    for (const filePath of allFiles) {
      if (!isProbablyTextFile(filePath)) {
        continue;
      }
      const original = fs.readFileSync(filePath, "utf8");
      if (!original.includes(marker)) {
        continue;
      }
      const result = updateContent(original, marker, replacementValue);
      if (result.changed) {
        if (!dryRun) {
          fs.writeFileSync(filePath, result.content, "utf8");
        }
        updatedFiles.push(path.relative(cwd, filePath).split(path.sep).join("/"));
      }
    }
  }

  const unique = [...new Set(updatedFiles)];
  setOutput("updated-files", JSON.stringify(unique));
  setOutput("updated-count", String(unique.length));
  setOutput("changed", String(unique.length > 0));
  setOutput("replacement-value", replacementValue);

  console.log(`dry-run=${dryRun}`);
  console.log(`working-directory=${cwd}`);
  console.log(`replacement-value=${replacementValue}`);
  console.log(`updated-files=${JSON.stringify(unique)}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

module.exports = {
  validateVersion,
  parseSimpleYamlConfig,
  replaceMarkedLine,
  updateContent,
};
