# Security Policy

## Supported Versions

WordPing is currently maintained from the `main` branch. Security fixes should target `main` unless a separate supported release branch is created.

## Reporting A Vulnerability

Please do not open a public issue for suspected vulnerabilities.

Report security concerns by contacting the maintainer privately through GitHub. Include:

- a short description of the issue;
- affected code paths or configuration;
- reproduction steps, proof of concept, or logs if safe to share;
- the expected impact;
- any suggested fix or mitigation.

The maintainer will acknowledge valid reports as soon as possible and coordinate a fix before public disclosure.

## Security-Sensitive Areas

- Telegram bot tokens and webhook configuration.
- Telegram WebApp init data validation.
- Mini App development authentication through `ALLOW_DEV_AUTH`.
- Database credentials and Prisma migrations.
- News provider API keys and external fetch handling.
- Backup archives, restore commands, and Telegram backup delivery.
- CI/CD secrets and production deployment scripts.

## Operational Guidance

- Keep `ALLOW_DEV_AUTH=false` in production.
- Never commit `.env`, database dumps, bot tokens, API keys, or production logs.
- Rotate credentials after accidental exposure.
- Review `.env.example`, deployment scripts, and GitHub Actions when adding new secrets.
- Prefer least-privilege credentials for databases, providers, and deployment hosts.
