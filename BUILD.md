# Build and verify

The local delivery contains a tested macOS ARM64 Node runtime, native libraries, proof engine and Tor bundle. Source backups omit these binaries, all wallet files and all Tor state. Building source requires network access to official dependency registries/upstreams. No paid cloud is required.

## Requirements

- Node.js 24.7 or newer with ML-KEM support; tested local version 24.19.0.
- Rust 1.99.1, pinned by `rust-toolchain.toml`; C/C++ compiler, CMake, make, Git and a native development environment.
- pnpm 11.25.0; `pnpm-lock.yaml` and `pq/Cargo.lock` are required.
- Enough RAM for STARK proving and the 256 MiB RandomX cache. Proving is heavier than ordinary wallet arithmetic and has not been qualified for low-memory phones.
- Tor for remote operation, with authenticated SOCKS isolation. The included Mac launcher uses port 19050. Linux users can set `ONLYPRIVACY_TOR_BIN` to their own installed Tor executable.

Linux builds have not been run in this environment. macOS binaries cannot run on Linux. Windows is not supported by this release's locking/FFI layer.

From the extracted `only-privacy` directory:

```sh
pnpm install --frozen-lockfile
node scripts/build-native.mjs
node scripts/build-pq.mjs
node src/cli.mjs doctor
node src/cli.mjs verify network/genesis.json
node --test --test-concurrency=1 tests/*.test.mjs
```

`doctor` compares the fixed program, witness layout, Rust lockfile and native program digest. The public genesis must independently verify as height 0, total supply 10,000, circulation 100 and reserve 9,900. Rebuilding the existing fixed program must preserve its program digest. Do not regenerate or replace the genesis to bypass a failure. `scripts/generate-transfer.mjs` is for reviewed proof-program development, not a required normal installation step.

## Participate without recreating supply

```sh
node src/cli.mjs join data/miner-wallet.enc.json data/chain.json
node src/cli.mjs verify data/chain.json
node src/cli.mjs mine-remote http://YOUR_VERIFIED_V3_ONION/ data/miner-wallet.enc.json data/chain.json
```

The URL above is a placeholder, not a seed. Obtain a verified endpoint from a participant and run the authenticated Tor SOCKS proxy on port 19050 first. The initial peer list is empty. `join` makes a zero-balance wallet on the existing public genesis and does not issue coins. Use interactive password input. `mine-remote` syncs and verifies the node's history, selects valid pending transactions, mines one block and submits it. A rejected or disconnected submission leaves a durable public block file for retry; a locally shown reward can be reversed by a heavier accepted branch.

`init` intentionally creates a different experimental network with a new genesis. It is useful in tests, but cannot add 10,000 coins to this network. `scripts/create-owner.mjs` was a one-time local allocation tool and must not be rerun to join or resume this chain.

## Local custody and backup

The actual owner wallet is a sibling directory outside this source project. Keep its `wallet.enc.json`, `owner.json`, chain index and any `chain.json.blocks/` together with the corresponding macOS Keychain item. A public source ZIP contains none of these private files. Losing the Keychain item is not repaired by reinstalling the program. Do not paste unlock secrets into chat, terminal arguments, public tickets or source code. Do not disable OS security settings to run this software.

Test wallets are created in temporary directories and deleted; tests never spend the actual owner's 100 coins. Full regression results are retained in `reports/release-final.tap`. A source-only local backup can be rebuilt using `python3 scripts/package-source.py`; it includes an internal file hash manifest and an external ZIP checksum. It never uploads or publishes anything.
