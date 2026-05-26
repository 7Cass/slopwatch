# Single package modular structure

Slopwatch starts as one Bun package with modular source directories rather than a monorepo or workspace split. The v0 product needs a CLI, local API, collector, inference, database layer, and dashboard to move together while the domain is still forming. Keeping one package reduces setup and release overhead, while the module boundaries leave room to extract workspaces later if real separation pressure appears.
