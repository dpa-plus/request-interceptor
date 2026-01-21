#!/bin/bash
set -e

# Read major and minor version from config
CONFIG_FILE=".github/version-config.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: $CONFIG_FILE not found" >&2
    exit 1
fi

MAJOR=$(jq -r '.major' "$CONFIG_FILE")
MINOR=$(jq -r '.minor' "$CONFIG_FILE")

# Get the latest patch version from existing tags
LATEST_PATCH=$(git tag -l "v${MAJOR}.${MINOR}.*" | sed "s/v${MAJOR}.${MINOR}.//" | sort -n | tail -1)

if [ -z "$LATEST_PATCH" ]; then
    PATCH=0
else
    PATCH=$((LATEST_PATCH + 1))
fi

VERSION="${MAJOR}.${MINOR}.${PATCH}"

# Create and push tag
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push origin "v${VERSION}"

echo "$VERSION"
