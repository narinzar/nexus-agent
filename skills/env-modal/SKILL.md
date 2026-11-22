---
name: env-modal
description: Running code on Modal (serverless Python with GPUs) - apps and functions, images, volumes, secrets, modal run versus serve versus deploy, GPU choice and cost. Use when the project imports modal or the task is to run jobs, inference or training on Modal.
---

# Modal

**Before anything:** `nexus env check modal` (CLI installed, token set with `modal setup`). Check the active profile and environment: `modal profile current`, `modal environment list`.

**Three ways to run; pick the cheapest that answers the question**
- `modal run app.py::fn` runs once and exits. Use it for jobs, tests and experiments.
- `modal serve app.py` hot-reloads web endpoints while developing; stop it when done.
- `modal deploy app.py` creates a persistent deployment. **Only when the owner asked for that deploy.**

**Structure**
- `app = modal.App("<name>")`. Define the image once: `modal.Image.debian_slim().uv_pip_install(...)`, with pinned versions. Add local code with `.add_local_python_source("pkg")`.
- Load models in a class with `@modal.enter()` so weights load once per container, not per call.
- Persist data and model weights in `modal.Volume` (call `.commit()` after writes); never re-download per call.

**Secrets:** `modal secret create <name> KEY=...` (or the dashboard), then `secrets=[modal.Secret.from_name("<name>")]`. Never pass secrets as arguments or bake them into images.

**GPUs and cost**
- Request the smallest GPU that fits (`gpu="T4"` / `"L4"` before `"A100"` / `"H100"`).
- Set `timeout=` and keep `scaledown_window` low for dev.
- Use `.map()` for parallel fan-out instead of loops of `.remote()`.
- Check running apps with `modal app list` and stop forgotten ones with `modal app stop <name>`.

**Testing:** keep the logic in plain functions that run locally without Modal; call them from thin `@app.function` wrappers. Use `modal run` with a small input as the integration test.
