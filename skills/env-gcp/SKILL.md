---
name: env-gcp
description: Building and deploying on Google Cloud - Cloud Run, Cloud Functions, App Engine, Cloud Build, Artifact Registry, Secret Manager, IAM and service accounts, local emulators. Use when the project deploys to or calls Google Cloud, or has app.yaml, cloudbuild.yaml, firebase.json or google-cloud dependencies.
---

# Google Cloud

**Before anything:** `nexus env check gcp`. You need an active account (`gcloud auth list`), a project (`gcloud config get-value project`) and application default credentials for local code (`gcloud auth application-default login`).

**Never deploy unless the owner asked for that deploy.** Prefer a preview or dev target; say exactly what would run first:
- Cloud Run: `gcloud run deploy <service> --source . --region <region> --no-traffic --tag preview` (a tagged revision with no traffic), then shift traffic with `gcloud run services update-traffic` when approved.
- Functions (2nd gen): `gcloud functions deploy <name> --gen2 --runtime <rt> --region <region> --trigger-http`.
- App Engine: `gcloud app deploy --no-promote` then promote when approved.

**Configuration**
- Config in environment variables; secrets in Secret Manager mounted at runtime (`--set-secrets KEY=secret-name:latest`), never in images, `app.yaml` or git.
- One service account per service with only the roles it needs. Never use the default compute account with Editor.
- Region and project come from config or flags, never hard-coded in code.

**Images and builds:** push to Artifact Registry (`<region>-docker.pkg.dev/<project>/<repo>/<image>`), not Container Registry. Keep `cloudbuild.yaml` steps the same as local build and test commands.

**Local first:** run against emulators where they exist (`gcloud emulators firestore start`, `gcloud beta emulators pubsub start`, Firebase Local Emulator Suite) and the Functions Framework (`npx @google-cloud/functions-framework --target=<fn>`).

**Cost and safety:** set `--max-instances` on Cloud Run and Functions; check `gcloud billing` budgets exist before load tests; delete preview revisions and tags when done.
