#!/usr/bin/env bash
# Build from the repo root:  REGISTRY=asia-south1-docker.pkg.dev/PROJECT/cloudlab bash infra/images/build.sh [push]
set -euo pipefail
cd "$(dirname "$0")/../.."
REGISTRY="${REGISTRY:-cloudlab}"
for lab in python java web; do
  docker build -f infra/images/$lab/Dockerfile -t "$REGISTRY/$lab:1.0" .
  [ "${1:-}" = push ] && docker push "$REGISTRY/$lab:1.0"
done
