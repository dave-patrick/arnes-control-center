$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
  npm run check
  if ($LASTEXITCODE) { throw 'Source validation failed' }
  npm run check:site
  if ($LASTEXITCODE) { throw 'Site validation failed' }
  New-Item -ItemType Directory -Force artifacts | Out-Null
  $files = 'app','documentation','scripts','site','package.json','README.md','LICENSE','THIRD-PARTY-NOTICES.md'
  Compress-Archive -Path $files -DestinationPath artifacts/arnes-source.zip -Force
  $hash = (Get-FileHash artifacts/arnes-source.zip -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  arnes-source.zip" | Set-Content artifacts/SHA256SUMS.txt
} finally { Pop-Location }

