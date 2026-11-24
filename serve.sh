#!/bin/sh
# Static site: any static server works. Opens on http://localhost:8000
cd "$(dirname "$0")" && python3 -m http.server 8000
