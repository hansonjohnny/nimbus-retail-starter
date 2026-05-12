# Working With This Code

A short note on how to think about the application code in this repository.

## You are the platform team

The application code in this repo was written by an imaginary product engineering team. In real life that team would be five or six developers building features under product pressure. They are not bad engineers, but they are not infrastructure engineers either. They write Node.js and Python. They expect you, the platform team, to take their work and make it production-ready.

This is exactly how it works at every mid-to-large software company.

## What the developers did well

Every service in this repo exposes three operational endpoints. You can rely on them:

- `GET /healthz` for liveness
- `GET /readyz` for readiness (it actually checks downstream dependencies)
- `GET /metrics` for Prometheus

Every service logs in structured JSON. Every service reads its configuration from environment variables (no hardcoded hostnames, no hardcoded credentials). Every service is stateless in the pod itself. Every service implements graceful shutdown on SIGTERM. These are not accidents. These are the things your contract with the developers should require.

## What the developers did not do

They did not provide Helm charts. That is your job.

They did not provide Kubernetes manifests. That is your job.

They did not set up CI/CD. They have a basic `package.json` or `requirements.txt`. Building, scanning, pushing, and deploying are your jobs.

They did not configure secrets management. The services expect environment variables; how those variables get populated in a cluster is your responsibility (and the answer is the External Secrets Operator reading from AWS Secrets Manager).

They did not write NetworkPolicies, image scanning, admission policies, or any of the security layer. That is all your job.

They did not pick instance sizes, set resource limits, configure autoscaling, or design the database tier. That is your job too.

## How to think about it

A useful frame: imagine you receive this repository on day one of a new role at NimbusRetail. The product team is busy. They have given you a working application. They want it on EKS. They want it observable. They want it secure. They want a path to ship new versions daily without a six-hour change window. They expect you to read their code, ask intelligent questions when something is unclear, and make decisions that fit the company's broader architecture.

That is your project.

## If you find a bug

You may find a bug. The code is small but it is not perfect. If you find one:

1. Open an issue in this repository with steps to reproduce.
2. Mention it in your Solution Design Document under "Issues raised with product team".
3. Do not fix it yourself unless it is genuinely blocking. Filing the issue is the platform-engineering response. Fixing the developer's code is the developer's response.

That distinction matters. In a real organisation, a platform engineer who silently rewrites another team's code creates more problems than they solve.

## If something legitimately needs a code change to be production-ready

There are a few things that might. For example, you might want to add OpenTelemetry instrumentation. You might want to add Kafka consumer-lag headers. You might want to add a `/debug/pprof` endpoint. For changes like these, the right approach is:

1. Open an issue describing what you need and why.
2. Open a pull request with the change.
3. Be ready to defend the change to the (imaginary) product team.

This is the collaboration pattern between platform and product teams in healthy engineering organisations. Get used to it.
