Set-Location $PSScriptRoot

# --- mirror docs incrementally (only changes) ---
$source_docs = 'C:\Users\kcamp\Downloads\MLB_Dashboard\docs'
$target_docs = Join-Path $PSScriptRoot 'docs'

if (!(Test-Path $target_docs)) {
    New-Item -ItemType Directory -Path $target_docs | Out-Null
}

# /MIR mirrors (copy + delete extras)
# /MT uses multithreading (adjust threads if you want)
# /R and /W keep retries from stalling forever
robocopy "$source_docs" "$target_docs" /MIR /MT:16 /R:2 /W:1 /NFL /NDL /NP

# robocopy returns "weird" success codes; treat < 8 as success
if ($LASTEXITCODE -ge 8) { throw "Robocopy failed with exit code $LASTEXITCODE" }

# if nothing changed, skip committing
git status --porcelain | ForEach-Object { $has_changes = $true; break }
if (-not $has_changes) { exit 0 }

git add .
git commit -m "update"
git push