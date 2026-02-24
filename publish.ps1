Set-Location $PSScriptRoot

# --- paths ---
$target_docs = Join-Path $PSScriptRoot 'docs'
$source_docs = 'C:\Users\kcamp\Downloads\MLB_Dashboard\docs'

# --- ensure target exists ---
if (!(Test-Path $target_docs)) {
    New-Item -ItemType Directory -Path $target_docs | Out-Null
}

# --- delete existing contents in target docs ---
Get-ChildItem $target_docs -Force | Remove-Item -Recurse -Force

# --- copy new contents ---
Copy-Item -Path (Join-Path $source_docs '*') `
          -Destination $target_docs `
          -Recurse -Force

git add .
git commit -m "update"
git push