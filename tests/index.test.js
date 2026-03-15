const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateVersion,
  parseSimpleYamlConfig,
  replaceMarkedLine,
  updateContent,
} = require("../index.js");

test("validateVersion accepts semantic versions", () => {
  assert.doesNotThrow(() => validateVersion("1.2.3"));
});

test("validateVersion rejects invalid versions", () => {
  assert.throws(() => validateVersion("v1.2.3"));
});

test("parseSimpleYamlConfig parses replacement rules", () => {
  const input = [
    "replacements:",
    "  - path: app/deploy.yaml",
    "    marker: update-automation:version",
    "    replacement-value: v1.2.3",
  ].join("\n");

  assert.deepEqual(parseSimpleYamlConfig(input), [
    {
      path: "app/deploy.yaml",
      marker: "update-automation:version",
      replacementValue: "v1.2.3",
    },
  ]);
});

test("replaceMarkedLine replaces last version before marker", () => {
  const line = "image: ghcr.io/acme/api:v1.2.3 # update-automation:version";
  assert.equal(
    replaceMarkedLine(line, "update-automation:version", "v2.0.0"),
    "image: ghcr.io/acme/api:v2.0.0 # update-automation:version"
  );
});

test("replaceMarkedLine keeps line when marker is missing", () => {
  const line = "image: ghcr.io/acme/api:v1.2.3";
  assert.equal(
    replaceMarkedLine(line, "update-automation:version", "v2.0.0"),
    line
  );
});

test("replaceMarkedLine keeps line when no version token exists before marker", () => {
  const line = "image: latest # update-automation:version";
  assert.equal(
    replaceMarkedLine(line, "update-automation:version", "v2.0.0"),
    line
  );
});

test("updateContent preserves CRLF and updates marked lines", () => {
  const input = "version=v1.2.3 # update-automation:version\r\nother=line\r\n";
  const result = updateContent(input, "update-automation:version", "v1.2.4");
  assert.equal(result.changed, true);
  assert.equal(result.content, "version=v1.2.4 # update-automation:version\r\nother=line\r\n");
});

test("updateContent updates marked lines with LF endings", () => {
  const input = "version=v1.2.3 # update-automation:version\n";
  const result = updateContent(input, "update-automation:version", "v1.2.4");
  assert.equal(result.changed, true);
  assert.equal(result.content, "version=v1.2.4 # update-automation:version\n");
});

test("updateContent leaves file untouched without marker", () => {
  const input = "version=v1.2.3\n";
  const result = updateContent(input, "update-automation:version", "v1.2.4");
  assert.equal(result.changed, false);
  assert.equal(result.content, input);
});

test("parseSimpleYamlConfig supports rules alias and ignores invalid lines", () => {
  const input = [
    "# comment",
    "rules:",
    "  - path: app/service.yaml",
    "    marker: update-automation:version",
    "    replacement-value: 'v9.9.9'",
    "random: value",
  ].join("\n");

  assert.deepEqual(parseSimpleYamlConfig(input), [
    {
      path: "app/service.yaml",
      marker: "update-automation:version",
      replacementValue: "v9.9.9",
    },
  ]);
});

test("parseSimpleYamlConfig handles inline list fields and skips items without path", () => {
  const input = [
    "replacements:",
    "  - marker: update-automation:version",
    "    replacement-value: v3.0.0",
    "    this-line-has-no-colon",
    "  - path: app/inline.yaml",
    "    marker: update-automation:version",
  ].join("\n");

  assert.deepEqual(parseSimpleYamlConfig(input), [
    {
      path: "app/inline.yaml",
      marker: "update-automation:version",
      replacementValue: undefined,
    },
  ]);
});

test("parseSimpleYamlConfig ignores keys before replacements block", () => {
  const input = [
    "name: demo",
    "team: release",
    "replacements:",
    "  - path: app/deploy.yaml",
  ].join("\n");

  assert.deepEqual(parseSimpleYamlConfig(input), [
    {
      path: "app/deploy.yaml",
      marker: undefined,
      replacementValue: undefined,
    },
  ]);
});
