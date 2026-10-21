#!/bin/sh
# Downloads the British birds scenario's big files (the photos and the bird
# records) from a release of the exercise repo. They are kept out of git to
# keep the curriculum repo small. Safe to run again: it does nothing once
# they are there.
set -eu
cd "$(dirname "$0")/scenarios/birds/files"
[ -d images ] && [ -f sightings.csv.gz ] && exit 0
curl -fsSL https://github.com/skiller-whale/genai-for-everyone-productivity-with-ai/releases/download/data-v1/birds-data.tar.gz | tar -xz
