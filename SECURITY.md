# Security status — 0.3.0

**Research network; no independent security audit.** The 54 regression cases check specific behavior. They do not prove freedom from all exploits, anonymity against a named agency, or end-to-end quantum security. The public checkpoint must remain unchanged to preserve the actual owner allocation.

## Implemented protections

- A fixed transparent hash-based zero-knowledge STARK program, with no Groth16 ceremony, verifies ownership, Merkle membership, integer conservation/ranges and locks. Consensus requires a proof rather than a local VM success flag.
- Ciphertext and context binding prevent swapping envelopes onto an existing proof. ML-KEM-1024 envelopes use authenticated AES-256-GCM and fresh per-invoice keys. Sender secrets and note amounts are absent from public proof packets.
- Consensus recomputes fresh issuance, reserve release, fees, work and spent nullifiers. A modified display balance, copied wallet file or administrator assertion cannot authorize additional coins. Invalid block processing is atomic.
- Wallet encryption uses scrypt N=131072, r=8, p=1 and AES-256-GCM. The actual local owner unlock secret is random and stored in this computer's macOS Keychain; private files have owner-only permissions. No recovery/master key is included.
- Private keys are retained before publication, writes are durable and atomic, pending inputs are reserved, disk failures are tested, and OS locks prevent concurrent writers. A persisted index plus its block directory is required for a full archived chain.
- Remote transaction traffic uses Tor v3 onion addresses and fresh authenticated SOCKS isolation per request. A missing or unsuitable proxy produces an error. Public node operations never load the owner wallet.

## Quantum-security evidence and limits

This version removes the earlier elliptic-curve proof verification path and uses a pinned Triton VM revision with its default conjectured classical security parameter 160. That number is not an independent lower bound of 160 quantum-security bits for the whole coin. Public IDs and context hashes also use SHA-256/SHA-512; the custom Tip5 composition, program, Fiat–Shamir transform, protocol composition, metadata and implementation all require review in an appropriate quantum adversary model.

NIST FIPS 203 standardizes ML-KEM and describes its security as based on the believed difficulty of Module-LWE, including against quantum adversaries. Using ML-KEM-1024 is evidence for a post-quantum design choice, not certification of this wallet, a NIST-validated cryptographic module, or a proof that every protocol component is secure. See the [NIST standard and current errata](https://csrc.nist.gov/pubs/fips/203/final) and the [Triton specification](https://triton-vm.org/spec/).

The observed proof was about 872 KB and took about 11 seconds on the development Mac with two prover threads. Repeated payment, proof tampering and independent replay tests passed. Performance and privacy depend on implementation and hardware; those observations do not establish security against arbitrary attacks.

## Material limitations

| Area | Current limit and implication |
| --- | --- |
| Anonymity set | This new chain starts with one known 100-coin allocation. A small set, known amounts, fees, timing and external knowledge can reveal substantial information despite valid zero-knowledge proofs. |
| Network observation | Tor does not eliminate endpoint compromise, global traffic correlation, malicious peers or disclosures by transaction parties. No cover-traffic network is implemented. |
| Consensus | Low initial hash power is vulnerable to majority-work reorganizations, censorship and eclipse attacks. Difficulty/time rules and long partition recovery require adversarial review. No fixed confirmation count can guarantee finality. |
| Time and issuance | Annual limits use block timestamps and local future-time rejection. They are not a proven bound over every external UTC interval under hostile clock control. |
| Endpoints | Malware, memory inspection, screenshots, swapped software and a compromised operating system can expose keys or destinations. JavaScript secret strings are not guaranteed to be erased from memory. |
| Custody | Loss of the encrypted wallet or its Keychain unlock secret can permanently lose access. A source archive does not back up the owner's assets. |
| Future migration | `renew` works with currently supported notes and suites. Future hashes, proof systems, ownership formats and broken historical primitives need reviewed migration rules before use. |
| Scale | Proofs are large; full startup replay, tree rebuilding and trying invoice keys over historical outputs are expensive. Block-directory storage prevents one huge JSON read but does not establish global-scale capacity. |
| Wallets and exchanges | MetaMask, Trust Wallet, mobile integrations, exchange deposits and atomic conversions are not implemented. A public wrapped token would introduce separate contracts and public metadata; it would not automatically inherit this protocol's privacy. |
| Platforms | Actual execution was verified on macOS ARM64. Linux build instructions are supplied but unverified here. Windows file locking and native library loading are not supported by this release. |

## Next work in priority order

1. Independent review of the fixed TASM program, native verifier limits, hash composition and security assumptions; public test vectors and reproducible builds on another machine.
2. Adversarial consensus review covering timestamps, retargeting, reserve scheduling, reorganizations, network partitions and hostile resource consumption; test with multiple independently operated nodes.
3. Incremental authenticated state and efficient wallet scanning; measure CPU, memory, chain growth and synchronization under sustained hostile load.
4. Specify cryptographic migrations retaining legacy verification and ownership guarantees. Prove mint conservation and uniqueness through migration, including offline owners.
5. Build and review provider/mobile wallet integration and external custody backup/recovery flows before claiming broad wallet compatibility. A funded exchange listing is a separate external action.

Open source means anybody can inspect or modify a copy. Accepted network rules depend on participant node adoption. No design can stop someone from publishing a fork; no developer administration key is provided to alter other nodes' consent or assets. Source maintenance remains possible and necessary. This is a technical property, not a blanket transfer or waiver of legal responsibility.

## Dependencies

Pinned Triton VM revision `2f3d61789b45bd90d3aaf7a6b191f5b46894c5bd`; vendored RandomX revision `418f5497e60215fcd8a7cff2a16be835135833e5`; Koffi 3.3.3. Upstream RandomX is CPU-oriented ([Monero documentation](https://www.getmonero.org/resources/moneropedia/randomx.html)); identity privacy is provided separately by this protocol and transport, not by RandomX itself. Bundled Mac Node and Tor provenance/licenses are retained under `runtime/`. Their ongoing security maintenance is required. A compromised local source/manifest cannot be detected by comparing it only with itself; archive checksums are integrity records, not an independent trust authority.

## Public release hardening

The HTTP boundary now admits at most eight active responses across reads and writes, publishes a maximum of three pending transactions per response, limits legacy whole-chain replies to two blocks, and returns a generic service error while halting mutations on archived-data failures. Separate regressions reproduced the prior oversized pending batch and uncaught archive read. The native wallet uses a bounded stdin/stdout child-process bridge, not an exposed private HTTP server. Metadata is pinned to the public genesis and private wallet filenames; unknown commands and foreign Keychain services are rejected before custody access. Compact addresses validate checksum, exact key algorithm and network domain.

The timestamped OSV/npm lookup in `reports/dependency-advisories.json` queried 121 registry packages and found no matching advisories at that time. This excludes git-pinned custom cryptography, vendored code, runtimes and unpublished defects. It does not change the independent-audit status. The public seed was reached through real Tor; it runs on one computer with conditional uptime. See `PUBLIC_TESTNET.md`.
