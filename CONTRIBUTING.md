# Contributing

1. Read `AGENTS.md` and the relevant docs.
2. Pick one backlog ID.
3. Create one branch and one focused PR.
4. Add tests before requesting review.
5. Report verification truthfully.

## Setup

```bash
npm ci
npm run tauri dev
```

## Before PR

```bash
npm run check
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Do not add AI/network features during Phase 1. Do not use destructive direct writes for user files.
