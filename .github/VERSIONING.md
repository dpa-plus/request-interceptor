# Versioning

This project uses semantic versioning with automatic patch increments.

## Version Format

`MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes (manually updated in `version-config.json`)
- **MINOR**: New features (manually updated in `version-config.json`)
- **PATCH**: Auto-incremented on each push to main

## How It Works

1. Push to `main` triggers the version job
2. The script reads `MAJOR.MINOR` from `.github/version-config.json`
3. It finds the latest tag matching `vMAJOR.MINOR.*` and increments the patch
4. A new git tag is created and pushed

## Docker Image Tags

- `latest` - Latest main branch build
- `vX.Y.Z` - Specific version
- `develop` - Latest develop branch build

## Manual Version Updates

To bump major or minor version, edit `.github/version-config.json`:

```json
{
  "major": 1,
  "minor": 0
}
```

Patch version will reset to 0 when major or minor is changed.
