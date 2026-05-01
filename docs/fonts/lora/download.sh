#!/bin/bash
cd "$(dirname "$0")"
# Try the Google Fonts CSS API to get the actual font URL, then download
URL=$(curl -s "https://fonts.googleapis.com/css2?family=Lora:wght@400;500&display=swap" -H "User-Agent: Mozilla/5.0" | grep -oP 'url\(\K[^)]+\.woff2' | head -1)
if [ -n "$URL" ]; then
  curl -sL "$URL" -o Lora.woff2
  echo "Downloaded woff2: $(ls -la Lora.woff2)"
else
  # Fallback: try ttf from github
  curl -sL "https://github.com/google/fonts/raw/main/ofl/lora/Lora%5Bwght%5D.ttf" -o Lora-Variable.ttf
  echo "Downloaded ttf: $(ls -la Lora-Variable.ttf 2>/dev/null || echo 'FAILED')"
fi
