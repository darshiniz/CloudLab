#!/usr/bin/env bash
# Build from the repo root:  REGISTRY=asia-south1-docker.pkg.dev/PROJECT/cloudlab bash infra/images/build.sh push   (without 'push' it only builds locally)
set -euo pipefail
cd "$(dirname "$0")/../.."
REGISTRY="${REGISTRY:-cloudlab}"
for lab in python java web; do
  # Local tag cloudlab/<lab>:1.0 is what the database's docker_image column refers to.
  docker build -f infra/images/$lab/Dockerfile -t "cloudlab/$lab:1.0" .
  if [ "${1:-}" = push ]; then
    docker tag "cloudlab/$lab:1.0" "$REGISTRY/$lab:1.0"
    docker push "$REGISTRY/$lab:1.0"
  fi
done
