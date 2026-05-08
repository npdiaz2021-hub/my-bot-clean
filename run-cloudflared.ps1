$cloudflaredPaths = @(
    "$env:ProgramFiles(x86)\cloudflared\cloudflared.exe",
    "$env:ProgramFiles\cloudflared\cloudflared.exe"
)

$cloudflared = $cloudflaredPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $cloudflared) {
    Write-Error "cloudflared.exe not found. Install Cloudflare Tunnel and add it to PATH, or update the script path."
    exit 1
}

Write-Host "Using cloudflared at: $cloudflared"
& "$cloudflared" tunnel run my-bot-tunnel
