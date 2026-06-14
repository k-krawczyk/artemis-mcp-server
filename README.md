# artemis-mcp-server

[![CI](https://github.com/k-krawczyk/artemis-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/k-krawczyk/artemis-mcp-server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An MCP server that lets an AI agent work with an ActiveMQ Artemis broker. Messaging
runs over AMQP 1.0; queue management, monitoring and administration run over the
broker's Jolokia REST endpoint.

The server is read-only by default. Tools that change broker state are only exposed
when `ARTEMIS_MODE=admin`, and the four destructive operations additionally require an
explicit `confirm: true` argument so an agent cannot delete data by accident.

## Requirements

- Node.js 20 or newer
- An Artemis broker with an AMQP acceptor and the web console (Jolokia) enabled

## Install

Run it directly from a client without installing:

```
npx artemis-mcp-server
```

Or install it globally:

```
npm install -g artemis-mcp-server
```

## Configuration

Configuration comes entirely from environment variables. Missing or invalid values
fail fast at startup with a description of what is wrong.

| Variable                     | Required | Default     | Description                                                          |
| ---------------------------- | -------- | ----------- | -------------------------------------------------------------------- |
| `ARTEMIS_AMQP_URL`           | yes      | —           | AMQP endpoint, `amqp://host:5672` or `amqps://host:5671`             |
| `ARTEMIS_JOLOKIA_URL`        | yes      | —           | Jolokia endpoint, e.g. `http://host:8161/console/jolokia`            |
| `ARTEMIS_USER`               | yes      | —           | Broker user for both AMQP and Jolokia                                |
| `ARTEMIS_PASSWORD`           | yes      | —           | Broker password                                                      |
| `ARTEMIS_BROKER_NAME`        | no       | `0.0.0.0`   | Broker name used in the management ObjectName                        |
| `ARTEMIS_MODE`               | no       | `read-only` | `read-only` or `admin`                                               |
| `ARTEMIS_MAX_BROWSE`         | no       | `200`       | Hard cap on messages returned by `browse_messages`/`consume_message` |
| `ARTEMIS_JOLOKIA_TIMEOUT_MS` | no       | `10000`     | Jolokia request timeout                                              |
| `ARTEMIS_AMQP_TIMEOUT_MS`    | no       | `15000`     | AMQP connection and operation timeout                                |
| `ARTEMIS_LOG_LEVEL`          | no       | `info`      | `error`, `warn`, `info` or `debug`                                   |

See `.env.example` for a starting point. The password is never written to the logs.

## Using it with an MCP client

### Claude Code (plugin)

This repository is a Claude Code plugin marketplace. Add it and install the plugin; Claude
Code prompts for the broker URL, credentials and mode, then runs the server for you:

```
/plugin marketplace add k-krawczyk/artemis-mcp-server
/plugin install artemis-mcp-server@artemis-mcp
```

The password is stored in your system keychain.

### Claude Code (CLI)

Without the plugin, register the server directly:

```
claude mcp add artemis \
  --env ARTEMIS_AMQP_URL=amqp://localhost:5672 \
  --env ARTEMIS_JOLOKIA_URL=http://localhost:8161/console/jolokia \
  --env ARTEMIS_USER=artemis \
  --env ARTEMIS_PASSWORD=artemis \
  --env ARTEMIS_MODE=admin \
  -- npx -y artemis-mcp-server
```

### Codex

In `~/.codex/config.toml`:

```toml
[mcp_servers.artemis]
command = "npx"
args = ["-y", "artemis-mcp-server"]
env = { ARTEMIS_AMQP_URL = "amqp://localhost:5672", ARTEMIS_JOLOKIA_URL = "http://localhost:8161/console/jolokia", ARTEMIS_USER = "artemis", ARTEMIS_PASSWORD = "artemis", ARTEMIS_MODE = "admin" }
```

### Cursor

In `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "artemis": {
      "command": "npx",
      "args": ["-y", "artemis-mcp-server"],
      "env": {
        "ARTEMIS_AMQP_URL": "amqp://localhost:5672",
        "ARTEMIS_JOLOKIA_URL": "http://localhost:8161/console/jolokia",
        "ARTEMIS_USER": "artemis",
        "ARTEMIS_PASSWORD": "artemis",
        "ARTEMIS_MODE": "admin"
      }
    }
  }
}
```

### VS Code

In `.vscode/mcp.json` (note the `servers` key):

```json
{
  "servers": {
    "artemis": {
      "command": "npx",
      "args": ["-y", "artemis-mcp-server"],
      "env": {
        "ARTEMIS_AMQP_URL": "amqp://localhost:5672",
        "ARTEMIS_JOLOKIA_URL": "http://localhost:8161/console/jolokia",
        "ARTEMIS_USER": "artemis",
        "ARTEMIS_PASSWORD": "artemis",
        "ARTEMIS_MODE": "admin"
      }
    }
  }
}
```

### Claude Desktop and other clients

Most clients accept the same `mcpServers` shape as Cursor above. Add the `artemis` entry to
the client's MCP config file (for Claude Desktop, `claude_desktop_config.json`).

## Tools

Tools marked _write_ are hidden unless `ARTEMIS_MODE=admin`. Tools marked _confirm_
do nothing unless called with `confirm: true`.

### Messaging

- `send_message` _(write)_ — send one message to an address or queue.
  Arguments: `address`, `body`, `bodyType` (`text` or `bytes`, base64 for bytes),
  `subject?`, `durable?`, `ttlMs?`, `messageId?`, `properties?`.
  ```json
  { "address": "orders", "body": "hello", "properties": { "priority": 9 } }
  ```
- `browse_messages` — read messages without removing them.
  Arguments: `queue`, `address?`, `limit?`.
- `consume_message` _(write)_ — receive and remove messages.
  Arguments: `queue`, `address?`, `count?`.

For a named queue on a multicast address, pass both `queue` and `address`; the server
addresses it as `address::queue`.

### Management

- `list_queues` — names of all queues.
- `list_addresses` — names of all addresses.
- `create_queue` _(write)_ — create a queue.
  Arguments: `name`, `address?`, `routingType?` (`anycast`/`multicast`), `durable?`,
  `filter?`, `maxConsumers?`, `autoCreateAddress?`.
- `delete_queue` _(write, confirm)_ — destroy a queue.
  Arguments: `name`, `removeConsumers?`, `autoDeleteAddress?`, `confirm`.
- `get_queue_info` — configuration of a queue (address, routing type, durability, filter).

### Monitoring

- `get_queue_stats` — runtime counters (message count, added, acknowledged, delivering,
  scheduled, consumers).
- `get_broker_overview` — version, uptime, memory usage, connection/consumer totals and
  queue/address counts.
- `list_consumers` — consumers currently attached.
- `list_connections` — open connections.

### Administration

- `purge_queue` _(write, confirm)_ — remove every message from a queue.
  ```json
  { "queue": "orders", "confirm": true }
  ```
- `move_messages` _(write, confirm)_ — move messages to another queue.
  Arguments: `queue`, `targetQueue`, `filter?`, `confirm`.
- `delete_messages` _(write, confirm)_ — remove messages matching a filter. A filter is
  required so this cannot become an accidental purge.
- `retry_dlq` _(write, confirm)_ — resend a dead-letter queue's messages to their
  original destination.

## Security

- The default mode is read-only. Granting write access is an explicit choice through
  `ARTEMIS_MODE=admin`.
- Destructive operations require `confirm: true` on every call.
- Credentials are redacted from log output and stack traces are never returned to the
  client; unexpected failures surface as a generic message and are logged on stderr.
- Jolokia is an administrative surface. In production use a dedicated service account
  with the least privilege it needs, keep the endpoint off the public network, and
  prefer TLS for both AMQP and the console.

## Development

Start a local broker with the console and Jolokia enabled:

```
docker compose up -d
```

Then:

```
npm install
npm run build
npm test                 # unit tests
npm run test:integration # spins up a broker with Testcontainers; needs Docker
```

`npm run lint`, `npm run typecheck` and `npm run format:check` round out the checks that
CI runs on every push and pull request.

## License

MIT
