# Changelog

All notable changes to this action are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-25

### Added

- Send an SMS to one or up to 100 receivers, optionally scheduled with `send-at`.
- Automatic idempotency key per run, attempt, job and message, so re-running a job never sends twice.
- Retries on network errors, `429` (honours `Retry-After`) and `5xx`.
- Outputs `id`, `ids`, `status`, `mode`, `segments` and `price`, plus a job summary.
- `fail-on-error: false` to only warn when an SMS is rejected.
- Runs on Linux, macOS and Windows runners without dependencies.

[1.0.0]: https://github.com/curl-sms/send-sms/releases/tag/v1.0.0
