<#
    install.ps1 - installs or updates scodezy-logcat on any Windows PC (v1.0.4)

    One line, in PowerShell (no admin needed unless Node.js has to be installed):

        irm https://raw.githubusercontent.com/unknown0492/scodezy-logcat/main/install.ps1 | iex

    What it does:
      1. Node.js: uses the one on the PC; else installs the LTS with winget, or the official MSI from nodejs.org.
      2. adb: uses the one on the PATH; else downloads Google's platform-tools into the install folder.
      3. Downloads scodezy-logcat (GitHub, branch main) into %LOCALAPPDATA%\scodezy-logcat, keeping data\
         (remembered TVs and packages) when it is an update.
      4. npm install (production), pm2 (installed globally when missing), starts / restarts the
         "scodezy-logcat" pm2 process only, pm2 save.
      5. Starts it again at Windows sign-in (a small file in the Startup folder runs "pm2 resurrect").
      6. Opens http://127.0.0.1:3737

    Settings (environment variables, set before running the line):
      LOGCAT_INSTALL_DIR   install folder           (default %LOCALAPPDATA%\scodezy-logcat)
      LOGCAT_BRANCH        GitHub branch to install (default main)
      LOGCAT_SKIP_START    1 = download and install only: no pm2, no Startup file (e.g. to prepare a PC, or tests)
#>

& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'                    # Invoke-WebRequest is many times faster without the bar
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $repo   = 'unknown0492/scodezy-logcat'
    $branch = if ( $env:LOGCAT_BRANCH ) { $env:LOGCAT_BRANCH } else { 'main' }
    $dir    = if ( $env:LOGCAT_INSTALL_DIR ) { $env:LOGCAT_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'scodezy-logcat' }
    $url    = 'http://127.0.0.1:3737'

    function Step( $text ) { Write-Host "`n==> $text" -ForegroundColor Cyan }
    function Ok( $text )   { Write-Host "    $text" -ForegroundColor Green }

    # PATH again from the registry (after Node.js / npm -g installs in this same window)
    function Update-PathFromRegistry {
        $machine = [Environment]::GetEnvironmentVariable( 'Path', 'Machine' )
        $user    = [Environment]::GetEnvironmentVariable( 'Path', 'User' )
        $env:Path = ( @( $machine, $user, ( Join-Path $env:APPDATA 'npm' ) ) | Where-Object { $_ } ) -join ';'
    }

    function Find-Exe( $name ) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ( $cmd ) { return $cmd.Source }
        return $null
    }

    Write-Host "scodezy-logcat installer" -ForegroundColor White
    Write-Host "Install folder: $dir"

    # ── 1. Node.js ─────────────────────────────────────────────────────────────────────────────────────
    Step 'Node.js'
    Update-PathFromRegistry
    if ( -not ( Find-Exe 'node.exe' ) ) {
        if ( Find-Exe 'winget.exe' ) {
            Write-Host '    Installing Node.js LTS with winget...'
            & winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements | Out-Host
        } else {
            Write-Host '    Installing Node.js LTS from nodejs.org (Windows will ask for permission)...'
            $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
            $lts = $index | Where-Object { $_.lts } | Select-Object -First 1
            $arch = if ( [Environment]::Is64BitOperatingSystem ) { 'x64' } else { 'x86' }
            $msi = Join-Path $env:TEMP "node-$( $lts.version )-$arch.msi"
            Invoke-WebRequest "https://nodejs.org/dist/$( $lts.version )/node-$( $lts.version )-$arch.msi" -OutFile $msi -UseBasicParsing
            Start-Process msiexec.exe -ArgumentList '/i', "`"$msi`"", '/qb', '/norestart' -Verb RunAs -Wait
            Remove-Item $msi -ErrorAction SilentlyContinue
        }
        Update-PathFromRegistry
        if ( -not ( Find-Exe 'node.exe' ) ) { throw 'Node.js could not be installed. Install it from https://nodejs.org and run this line again.' }
    }
    $nodeVersion = & node.exe -v
    $major = [int] ( $nodeVersion -replace '^v(\d+).*', '$1' )
    if ( $major -lt 18 ) { throw "Node.js $nodeVersion is too old (18 or newer is needed). Update it from https://nodejs.org and run this line again." }
    Ok "Node.js $nodeVersion"
    $npm = Join-Path ( Split-Path ( Find-Exe 'node.exe' ) ) 'npm.cmd'          # npm.cmd: npm.ps1 is blocked by the default execution policy
    if ( -not ( Test-Path $npm ) ) { $npm = 'npm.cmd' }

    # ── 2. Download scodezy-logcat (data\ is kept) ─────────────────────────────────────────────────────
    Step "Downloading scodezy-logcat ($branch)"
    $tmp = Join-Path $env:TEMP ( 'scodezy-logcat-' + [Guid]::NewGuid().ToString( 'N' ) )
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        $zip = Join-Path $tmp 'src.zip'
        Invoke-WebRequest "https://codeload.github.com/$repo/zip/refs/heads/$branch" -OutFile $zip -UseBasicParsing
        Expand-Archive -Path $zip -DestinationPath $tmp -Force
        $src = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
        if ( -not ( Test-Path ( Join-Path $src.FullName 'server.js' ) ) ) { throw 'The download does not look like scodezy-logcat.' }
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        # Program files are replaced; data\ (history.json), platform-tools\ and node_modules\ stay
        Get-ChildItem -Path $src.FullName -Force | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination $dir -Recurse -Force
        }
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
    $version = ( Get-Content ( Join-Path $dir 'package.json' ) -Raw | ConvertFrom-Json ).version
    Ok "Version $version in $dir"

    # ── 3. adb ─────────────────────────────────────────────────────────────────────────────────────────
    Step 'adb'
    $localAdb = Join-Path $dir 'platform-tools\adb.exe'
    if ( Test-Path $localAdb ) {
        Ok "adb: $localAdb"
    } elseif ( Find-Exe 'adb.exe' ) {
        Ok "adb: $( Find-Exe 'adb.exe' )"
    } else {
        Write-Host "    adb not found: downloading Google's platform-tools..."
        $ptZip = Join-Path $env:TEMP 'platform-tools-latest-windows.zip'
        Invoke-WebRequest 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $ptZip -UseBasicParsing
        Expand-Archive -Path $ptZip -DestinationPath $dir -Force                 # -> $dir\platform-tools\adb.exe
        Remove-Item $ptZip -ErrorAction SilentlyContinue
        Ok "adb: $localAdb"
    }

    $skipStart = ( $env:LOGCAT_SKIP_START -eq '1' )

    # ── 4. Packages and pm2 ────────────────────────────────────────────────────────────────────────────
    Step 'npm install'
    Push-Location $dir
    try {
        & $npm install --omit=dev --no-audit --no-fund --loglevel=error | Out-Host
        if ( $LASTEXITCODE -ne 0 ) { throw 'npm install failed.' }
    } finally { Pop-Location }
    Ok 'Packages installed'

    if ( $skipStart ) {
        Write-Host "`nscodezy-logcat $version installed in $dir (not started: LOGCAT_SKIP_START=1)." -ForegroundColor Green
        return
    }

    Step 'pm2'
    Update-PathFromRegistry
    $pm2 = Find-Exe 'pm2.cmd'
    if ( -not $pm2 ) {
        & $npm install -g pm2 --no-audit --no-fund --loglevel=error | Out-Host
        Update-PathFromRegistry
        $pm2 = Find-Exe 'pm2.cmd'
        if ( -not $pm2 ) { $pm2 = Join-Path $env:APPDATA 'npm\pm2.cmd' }
    }
    if ( -not ( Test-Path $pm2 ) ) { throw 'pm2 could not be installed.' }
    # Only the scodezy-logcat process is touched (other pm2 apps on this PC are left alone)
    # "pm2 id <name>" prints [ 2 ] or [] ("pm2 jlist" cannot be read by Windows PowerShell 5.1: duplicate keys)
    $running = ( ( & $pm2 id scodezy-logcat 2>$null ) -join ' ' ) -match '\d'
    Push-Location $dir
    try {
        if ( $running ) { & $pm2 delete scodezy-logcat | Out-Null }       # Re-read ecosystem.config.js (new folder / adb path)
        & $pm2 start ecosystem.config.js | Out-Null
        & $pm2 save | Out-Null
    } finally { Pop-Location }
    Ok 'pm2 process "scodezy-logcat" started'

    # ── 5. Start at Windows sign-in ────────────────────────────────────────────────────────────────────
    Step 'Start at sign-in'
    $startup = Join-Path ( [Environment]::GetFolderPath( 'Startup' ) ) 'scodezy-logcat.cmd'
    Set-Content -Path $startup -Encoding ASCII -Value @(
        '@echo off',
        'rem scodezy-logcat: brings back the saved pm2 processes after sign-in (made by install.ps1)',
        "start `"`" /min cmd /c `"`"$pm2`" resurrect`""
    )
    Ok "Startup file: $startup"

    # ── 6. Ready ───────────────────────────────────────────────────────────────────────────────────────
    $ready = $false
    for ( $i = 0; $i -lt 20 -and -not $ready; $i++ ) {
        Start-Sleep -Milliseconds 500
        try { $ready = ( Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2 ).StatusCode -eq 200 } catch { }
    }
    if ( $ready ) {
        Write-Host "`nscodezy-logcat $version is running: $url" -ForegroundColor Green
        Start-Process $url
    } else {
        Write-Host "`nInstalled, but the page does not answer yet. Check: pm2 logs scodezy-logcat" -ForegroundColor Yellow
    }
    Write-Host 'Update later: run the same line again. Stop: pm2 stop scodezy-logcat'
}
