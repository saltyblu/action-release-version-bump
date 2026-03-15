const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseSimpleYamlConfig,
  replaceMarkedLine,
  updateContent,
} = require("../index.js");

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

test("updateContent preserves CRLF and updates marked lines", () => {
  const input = "version=v1.2.3 # update-automation:version\r\nother=line\r\n";
  const result = updateContent(input, "update-automation:version", "v1.2.4");
  assert.equal(result.changed, true);
  assert.equal(result.content, "version=v1.2.4 # update-automation:version\r\nother=line\r\n");
});

test("updateContent leaves file untouched without marker", () => {
  const input = "version=v1.2.3\n";
  const result = updateContent(input, "update-automation:version", "v1.2.4");
  assert.equal(result.changed, false);
  assert.equal(result.content, input);
});
