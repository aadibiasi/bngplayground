# @bngplayground/engine: Architecture & Developer Guide

The `@bngplayground/engine` package is a standalone, environment-agnostic core for BioNetGen simulation and graph processing. It is designed to run in the browser (via Web Workers/WASM), in Node.js (via MCP/CLI), and in CI environments.

## Core Architecture

### 1. Parser (`/src/parser`)

- **BNGParser**: Antlr4-based parser for BNGL syntax.
- **BNGLParser**: High-level structural parser that converts BNGL blocks into in-memory `BNGLModel` graphs.
- **ExpressionEvaluator**: Handles functional rates and mathematical expressions. Supports lazy-loading of `SafeExpressionEvaluator` for runtime security.

### 2. Services (`/src/services`)

- **GraphMatcher**: Subgraph matching engine for molecule patterns.
- **NetworkNormalization**: Handles molecule isomorphism and Nauty-based canonicalization.
- **Simulation**:
  - `SimulationLoop.ts`: Orchestrates multi-phase simulations.
  - `SSA.ts`: Direct SSA implementation.
  - `cvode_node.ts` / `cvode_worker.ts`: Environment-specific loaders for the CVODE WASM solver.

### 3. Utilities (`/src/utils`)

- **batchRunner.ts**: Orchestration logic for running multiple models in sequence. Environment-agnostic via interfaces.
- **dynamicObservable.ts**: Real-time validation of observable expressions.

## Developer Workflow

### Running Tests

All algorithmic and parity tests should reside in `packages/engine/tests`.

```bash
cd packages/engine
npm test
```

### Adding New Features

1. **Interfaces First**: Define new capabilities in `src/types.ts` or local `interfaces/`.
2. **Environment Agnostic**: Avoid `window`, `document`, or Node-specific built-ins (like `fs`) in the core logic. Use dependency injection or environment-specific loaders (see `cvode_node.ts` example).
3. **Parity Checks**: Verify changes against BioNetGen (BNG2.pl) behaviors documented in `bionetgen-review.md`.

## Integration

The engine is consumed by:

- `src/`: The BioNetGen Web Simulation frontend.
- `packages/mcp-server/`: The Model Context Protocol server for Claude/IDEs.
- `scripts/`: Local parity and validation scripts.
