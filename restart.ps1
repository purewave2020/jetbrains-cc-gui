$ErrorActionPreference = "SilentlyContinue"

Write-Host "========================================"
Write-Host "  CC-GUI Restart Script"
Write-Host "========================================"
Write-Host ""

# Collect PIDs to protect: self, parent, grandparent
$protectPids = @($PID)
$ppid = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
if ($ppid) {
    $protectPids += $ppid
    $gppid = (Get-CimInstance Win32_Process -Filter "ProcessId=$ppid").ParentProcessId
    if ($gppid) { $protectPids += $gppid }
}

function Kill-ByPort($port) {
    $killed = @()
    $output = netstat -ano 2>$null
    foreach ($line in $output) {
        if ($line -match ":$port\s" -and $line -match "LISTENING") {
            $parts = $line.Trim() -split '\s+'
            $pid = [int]$parts[-1]
            if ($pid -gt 0 -and $killed -notcontains $pid -and $protectPids -notcontains $pid) {
                Write-Host "  Killing PID $pid on port $port..."
                taskkill //PID $pid //T //F 2>$null | Out-Null
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                $killed += $pid
            }
        }
    }
}

function Kill-ByPattern($patterns, $excludes) {
    $killed = @()
    $processes = Get-CimInstance Win32_Process
    foreach ($p in $processes) {
        if ($protectPids -contains $p.ProcessId) { continue }
        $cmd = $p.CommandLine
        if (-not $cmd) { continue }
        $excluded = $false
        foreach ($ex in $excludes) {
            if ($cmd -like $ex) { $excluded = $true; break }
        }
        if ($excluded) { continue }
        foreach ($pat in $patterns) {
            if ($cmd -like $pat -and $killed -notcontains $p.ProcessId) {
                Write-Host "  Killing PID $($p.ProcessId) ($($p.Name))..."
                taskkill //PID $p.ProcessId //T //F 2>$null | Out-Null
                Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
                $killed += $p.ProcessId
                break
            }
        }
    }
}

# Step 1: Kill by port
Write-Host "[1/2] Stopping processes on ports 3001 and 5173..."
Kill-ByPort 3001
Kill-ByPort 5173

# Step 2: Kill by command line pattern (catches orphaned processes)
Write-Host "  Cleaning up related processes..."
Kill-ByPattern @('*server/index.js*','*server\index.js*','*daemon.js*','*concurrently*ai-bridge*','*vite\bin\vite*','*vite.js*') `
               @('*shell-snapshots*','*claude-*cwd*','*powershell*restart*')

# Step 3: Wait and verify - retry up to 5 times
Write-Host "  Verifying ports are free..."
for ($attempt = 0; $attempt -lt 5; $attempt++) {
    Start-Sleep -Seconds 2
    $stillBusy = $false
    foreach ($port in @(3001, 5173)) {
        $output = netstat -ano 2>$null
        foreach ($line in $output) {
            if ($line -match ":$port\s" -and $line -match "LISTENING") {
                $parts = $line.Trim() -split '\s+'
                $pid = [int]$parts[-1]
                if ($protectPids -contains $pid) { continue }
                $stillBusy = $true
                Write-Host "  Port $port still held by PID $pid, force killing..."
                taskkill //PID $pid //T //F 2>$null | Out-Null
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            }
        }
    }
    if (-not $stillBusy) {
        Write-Host "  Ports are free!"
        break
    }
}

# Final check
$finalCheck = netstat -ano 2>$null
foreach ($line in $finalCheck) {
    if (($line -match ":3001\s" -or $line -match ":5173\s") -and $line -match "LISTENING") {
        $parts = $line.Trim() -split '\s+'
        $pid = [int]$parts[-1]
        if ($protectPids -contains $pid) { continue }
        Write-Host "  ERROR: Port still occupied by PID $pid after all attempts. Please kill manually."
        Write-Host "  Run: taskkill //PID $pid //T //F"
    }
}

# Start dev servers
Write-Host ""
Write-Host "[2/2] Starting dev servers..."
Write-Host ""
npm run dev
