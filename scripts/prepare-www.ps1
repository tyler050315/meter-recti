$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$www = Join-Path $root "www"

if (Test-Path $www) {
  Remove-Item -LiteralPath $www -Recurse -Force
}

New-Item -ItemType Directory -Path $www | Out-Null
New-Item -ItemType Directory -Path (Join-Path $www "icons") | Out-Null

Copy-Item -LiteralPath (Join-Path $root "index.html") -Destination $www
Copy-Item -LiteralPath (Join-Path $root "styles.css") -Destination $www
Copy-Item -LiteralPath (Join-Path $root "app.js") -Destination $www
Copy-Item -LiteralPath (Join-Path $root "native-scanner.js") -Destination $www
Copy-Item -LiteralPath (Join-Path $root "manifest.json") -Destination $www
Copy-Item -LiteralPath (Join-Path $root "service-worker.js") -Destination $www
Copy-Item -LiteralPath (Join-Path $root "icons\*") -Destination (Join-Path $www "icons") -Recurse
