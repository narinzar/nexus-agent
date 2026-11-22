---
name: env-aws-lambda
description: Building and deploying AWS Lambda functions - SAM, CDK or Serverless Framework, handlers, packaging, IAM, environment and secrets, local invoke, logs. Use when the project deploys to AWS Lambda or has template.yaml (SAM), cdk.json, serverless.yml or aws-lambda / boto3 dependencies.
---

# AWS Lambda

**Before anything:** `nexus env check aws-lambda`. Use short-lived credentials (`aws configure sso`, then `aws sso login --profile <p>`); never long-lived access keys in files or environment variables you commit. Confirm the account with `aws sts get-caller-identity` before any deploy.

**Never deploy unless the owner asked for that deploy**, and say which stack, account and region first.
- SAM: `sam build && sam deploy --config-env dev` (`samconfig.toml` holds per-environment settings). First deploy: `sam deploy --guided`.
- CDK: `cdk diff` first and show it; then `cdk deploy <Stack>`.
- Serverless Framework: `serverless deploy --stage dev`.

**Handlers**
- Keep the handler thin: parse the event, call plain functions, return. Plain functions get unit tests without AWS.
- Create SDK clients outside the handler (reused across warm invocations).
- Idempotency for anything triggered by queues or retries (SQS, EventBridge, S3 events can deliver twice).

**Packaging:** bundle only what runs (esbuild for Node via SAM `Metadata: BuildMethod: esbuild`; layers or container images for heavy Python dependencies). Match the architecture (`arm64` is cheaper) between build and function.

**Config and secrets:** environment variables for config; Secrets Manager or SSM Parameter Store for secrets, read at cold start and cached. IAM role per function with least privilege; no `*` actions in templates.

**Local:** `sam local invoke <Fn> -e events/<event>.json`, `sam local start-api`; generate events with `sam local generate-event`.

**Observe:** `sam logs -n <Fn> --tail` or `aws logs tail /aws/lambda/<fn> --follow`. Set timeouts and memory explicitly; set reserved concurrency on functions that can be flooded.
