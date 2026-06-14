# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Claude Code plugin marketplace manifest so the server can be installed with
  `/plugin marketplace add` and `/plugin install`, with broker settings collected
  through the plugin's user configuration.
- Setup instructions for Codex, Cursor and VS Code.

### Fixed

- Empty environment values are now treated as unset, so optional settings keep their
  defaults when a client templates configuration with blank strings.

## [0.1.0] - 2026-06-14

Initial release.

### Added

- Messaging tools over AMQP 1.0: `send_message`, `browse_messages`, `consume_message`.
- Management tools over Jolokia: `list_queues`, `list_addresses`, `create_queue`,
  `delete_queue`, `get_queue_info`.
- Monitoring tools: `get_queue_stats`, `get_broker_overview`, `list_consumers`,
  `list_connections`.
- Administration tools: `purge_queue`, `move_messages`, `delete_messages`, `retry_dlq`.
- Read-only mode by default; write tools require `ARTEMIS_MODE=admin` and destructive
  tools require an explicit `confirm` flag.
- Configuration via environment variables with startup validation and secret redaction.
- Unit tests and a Testcontainers integration suite against a real broker.

[0.1.0]: https://github.com/k-krawczyk/artemis-mcp-server/releases/tag/v0.1.0
