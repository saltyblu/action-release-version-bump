# action-release-version-bump

GitHub Action that updates version strings on lines marked with an explicit automation marker.

## Marker syntax

Use a marker comment on the same line as the version value:

```text
image: ghcr.io/acme/app:v1.2.3 # update-automation:version
```

The action replaces the last semantic version token before the marker.

## Inputs

- `version` (required)
  - Semantic version without prefix, e.g. `1.2.3`.
- `tag-prefix` (optional, default: `v`)
  - Prefix used to build default replacement value.
- `replacement-value` (optional)
  - Explicit replacement value. Defaults to `<tag-prefix><version>`.
- `working-directory` (optional, default: `.`)
  - Directory where files are scanned.
- `marker` (optional, default: `update-automation:version`)
  - Marker token to identify replaceable lines.
- `config-file` (optional, default: `.github/release-automation.yml`)
  - Optional YAML rules file with explicit file paths.
- `include-glob` (optional)
  - Comma-separated path prefixes to limit recursive scan.
- `dry-run` (optional, default: `false`)
  - Computes results without writing files.

## Optional YAML config

```yaml
replacements:
  - path: app/deploy.yaml
    marker: update-automation:version
    replacement-value: v1.2.3
```

If config rules exist, only configured files are updated.

## Outputs

- `updated-files`: JSON array of changed files
- `updated-count`: number of changed files
- `changed`: `true` when at least one file changed
- `replacement-value`: value written to files

## Unit tests

```bash
node --test
```
