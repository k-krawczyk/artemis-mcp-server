# Security Policy

## Supported versions

The latest released version receives security fixes.

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/k-krawczyk/artemis-mcp-server/security/advisories/new)
or email karkra321@gmail.com. Include steps to reproduce and the affected version. You
can expect an initial response within a few days.

## Operational notes

This server can perform destructive operations on a broker. When deploying it:

- Keep the default `read-only` mode unless write access is required.
- Give the broker account only the permissions it needs, and keep the Jolokia endpoint
  off any public network.
- Use TLS for both AMQP and the console in production.
