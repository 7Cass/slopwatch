# Localhost-only no auth for v0

Slopwatch v0 does not require authentication for the local API or dashboard as long as the server binds to `127.0.0.1` by default. Binding to a non-localhost address must be explicit and warned about. This keeps the local personal workflow simple while making the network exposure boundary visible instead of adding token management before there is a multi-user or remote-access product.
