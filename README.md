# Send SMS with curl-sms – GitHub Action

[![CI](https://github.com/curl-sms/send-sms/actions/workflows/ci.yml/badge.svg)](https://github.com/curl-sms/send-sms/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/curl-sms/send-sms?color=0a0a0a)](https://github.com/curl-sms/send-sms/releases)
[![MIT license](https://img.shields.io/badge/license-MIT-0a0a0a)](LICENSE)

Send an SMS from any GitHub workflow: when a deploy fails, a release ships or a nightly job breaks. One step, no dependencies, works on Linux, macOS and Windows runners.

```yaml
- uses: curl-sms/send-sms@v1
  with:
    api-key: ${{ secrets.CURLSMS_API_KEY }}
    receiver: "+4915123456789"
    body: "Deploy of ${{ github.repository }} finished"
```

## Setup

1. Create an account at [curl-sms.com](https://curl-sms.com) (5 free SMS per month, no payment details needed) and create an API key under [API keys](https://curl-sms.com/app/keys).
2. Add it as a repository secret named `CURLSMS_API_KEY` (**Settings → Secrets and variables → Actions**).
3. Add the step to your workflow.

Start with a **test key** (`cs_test_…`): the request runs through every check, but nothing is sent and nothing is charged. Switch to a live key (`cs_live_…`) when it works.

## Examples

### SMS when a job fails

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: ./deploy.sh

      - name: SMS on failure
        if: failure()
        uses: curl-sms/send-sms@v1
        with:
          api-key: ${{ secrets.CURLSMS_API_KEY }}
          receiver: "+4915123456789"
          body: "❌ Deploy failed: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
```

### Several receivers

```yaml
- uses: curl-sms/send-sms@v1
  with:
    api-key: ${{ secrets.CURLSMS_API_KEY }}
    receiver: |
      +4915123456789
      +4917612345678
    body: "Release ${{ github.ref_name }} is live"
```

Up to 100 numbers, separated by new lines or commas. Keep numbers out of public workflow files by storing them in a secret or variable, e.g. `receiver: ${{ vars.ONCALL_PHONE }}`.

### Scheduled reminder

```yaml
- uses: curl-sms/send-sms@v1
  with:
    api-key: ${{ secrets.CURLSMS_API_KEY }}
    receiver: ${{ vars.ONCALL_PHONE }}
    body: "Maintenance window starts in 1 hour"
    send-at: "2026-12-24T08:00:00+01:00"
```

### Use the outputs

```yaml
- id: sms
  uses: curl-sms/send-sms@v1
  with:
    api-key: ${{ secrets.CURLSMS_API_KEY }}
    receiver: ${{ vars.ONCALL_PHONE }}
    body: "Nightly build broke"
- run: echo "SMS ${{ steps.sms.outputs.id }} is ${{ steps.sms.outputs.status }}"
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `api-key` | yes | | curl-sms API key. Always pass it from a secret. |
| `receiver` | yes | | Mobile number(s) in international format (`+49…`). Up to 100, separated by commas or new lines. |
| `body` | yes | | SMS text. 160 characters per part (70 with emoji), at most 10 parts. |
| `send-at` | no | | RFC 3339 time to send later (at most one year ahead). |
| `idempotency-key` | no | derived from run, attempt, job and message | Same key and request within 24 hours never sends twice. |
| `fail-on-error` | no | `true` | `false` turns a rejected SMS into a warning instead of failing the step. |
| `language` | no | `en` | Language of error messages (`en` or `de`). |
| `base-url` | no | `https://curl-sms.com` | Only for testing. |

## Outputs

| Output | Description |
|---|---|
| `id` | ID of the SMS (the first one when sending to several receivers) |
| `ids` | JSON array of all SMS IDs |
| `status` | `queued`, or `scheduled` with `send-at` |
| `mode` | `live` or `test` |
| `segments` | Number of SMS parts per receiver |
| `price` | Price in euros taken from the balance (`0.00` for included SMS and test keys) |

## Behaviour

- **No duplicates on re-run.** The default idempotency key is built from the run ID, attempt, job and message. Retries inside the step reuse it, so a timeout never causes a second SMS.
- **Retries.** Network errors, `429` (honouring `Retry-After`) and `5xx` are retried up to two times.
- **Privacy.** The API key is masked in logs. The log and job summary show only the last four digits of each number.
- **Errors.** A rejected SMS fails the step with the API error code, e.g. `invalid_receiver` or `insufficient_balance`. All codes: [error codes](https://curl-sms.com/docs/error-codes).
- **Security.** Pass values from events (branch names, PR titles) through `with:` as shown. The action never runs them through a shell, so they cannot inject commands.

## Links

[curl-sms.com](https://curl-sms.com) · [Docs](https://curl-sms.com/docs) · [API reference](https://curl-sms.com/docs/api) · [Pricing](https://curl-sms.com/pricing) · [More examples](https://github.com/curl-sms/curl-sms)

## License

[MIT](LICENSE). Use of the curl-sms service is subject to the [terms](https://curl-sms.com/terms).
