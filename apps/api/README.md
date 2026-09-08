# API app

NestJS + Fastify Control Plane scaffold. The only HTTP endpoint in this issue is
`GET /health`; feature endpoints are added as vertical slices.

## Logging

The API emits one structured Pino log stream. Development uses single-line
`pino-pretty`; production emits one JSON object per stdout line. `LOG_LEVEL`
overrides the default (`debug` in development, `info` in production).

Use levels consistently: `error` needs a person to investigate, `warn` is an
abnormal but self-recovering condition, `info` marks a business milestone, and
`debug` is technical detail. Do not log payloads at `info` level. Request logs
carry `requestId` and `traceId`; use `setBusinessContext({ taskId, videoId,
jobId, attempt })` (and the user/worker identifiers) inside a use case so those
fields are carried by subsequent logs automatically. Authorization, cookies,
token/secret/apiKey/password fields, and URL query strings are redacted.
