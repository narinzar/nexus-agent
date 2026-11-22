---
name: env-powershell
description: Working from Windows PowerShell - pwsh 7 versus Windows PowerShell 5.1, quoting, execution policy, environment variables, paths, and running Node, Python and git commands. Use when commands run in PowerShell, the repository has .ps1 scripts, or the user is on Windows without WSL.
---

# PowerShell

**Use PowerShell 7 (`pwsh`)**, not Windows PowerShell 5.1: it has `&&`/`||`, UTF-8 by default and runs on Windows, macOS and Linux. Install with `winget install Microsoft.PowerShell`.

**Translating shell commands**
| bash | PowerShell |
|---|---|
| `export KEY=value` | `$env:KEY = "value"` (this session only) |
| `KEY=v cmd` | `$env:KEY="v"; cmd; Remove-Item Env:KEY` |
| `cmd1 && cmd2` | same in pwsh 7; in 5.1 `cmd1; if ($?) { cmd2 }` |
| `rm -rf dir` | `Remove-Item -Recurse -Force dir` |
| `cat f \| grep x` | `Select-String -Path f -Pattern x` |
| `which node` | `Get-Command node` |
| `$(cmd)` | `$(cmd)` works; backtick `` ` `` is the escape character, not `\` |

**Quoting:** single quotes are literal; double quotes expand `$var`. Pass arguments to native tools with `--%` when they contain special characters, or use an argument array: `& git @('commit', '-m', $msg)`.

**Scripts**
- Execution policy: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (never `Unrestricted` machine-wide).
- Start scripts with `$ErrorActionPreference = 'Stop'` and `Set-StrictMode -Version Latest`; check `$LASTEXITCODE` after native commands.
- Use `Join-Path` and `$PSScriptRoot` for paths; never hard-code `C:\Users\...`.

**Secrets:** read with `Read-Host -AsSecureString` or from the SecretManagement module; never put them in profile scripts or history.

**Long paths:** enable with `git config --global core.longpaths true` when `node_modules` breaks checkouts.

**Preflight:** `nexus env check powershell`.
