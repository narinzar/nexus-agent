---
name: env-wsl
description: Working in WSL (Linux on Windows) - where to keep repositories, line endings, file permissions, ports, Docker Desktop, GPU, and calling Windows tools. Use when the machine is WSL, paths start with /mnt/c, or Windows and Linux tooling meet.
---

# WSL

**Where the code lives**
- Keep repositories on the Linux filesystem (`~/code/<repo>`), never under `/mnt/c`. Cross-filesystem access is many times slower, breaks file watchers (hot reload) and confuses permissions.
- Open them from Windows as `\\wsl$\<distro>\home\<user>\code\<repo>`, or run `code .` from inside WSL.

**Line endings and permissions**
- `git config --global core.autocrlf input` inside WSL; add `* text=auto eol=lf` to `.gitattributes` for scripts.
- A `bad interpreter: /bin/bash^M` error means CRLF endings: fix with `sed -i 's/\r$//' <file>` and the `.gitattributes` rule.
- Executable bits: `git update-index --chmod=+x <script>` so they survive Windows checkouts.

**Ports, networking, services**
- Servers in WSL are reachable from Windows at `localhost:<port>` (bind `0.0.0.0` if not).
- Mirrored networking (`networkingMode=mirrored` in `%UserProfile%\.wslconfig`) fixes VPN and LAN access issues.
- Docker: use Docker Desktop with WSL integration on, or docker-ce inside the distro. Not both.

**Windows interop**
- Call Windows tools explicitly: `powershell.exe -NoProfile -Command "..."`, `explorer.exe .`, `cmd.exe /c`.
- Convert paths with `wslpath -w <linux-path>` and `wslpath -u '<C:\path>'`.
- Credentials: share Git Credential Manager from Windows (`git config --global credential.helper "/mnt/c/Program\ Files/Git/mingw64/bin/git-credential-manager.exe"`).

**Resources:** limit memory in `.wslconfig` (`memory=8GB`) when builds starve Windows. GPU (CUDA) works with current Windows drivers; check with `nvidia-smi`.

**Preflight:** `nexus env check wsl`.
