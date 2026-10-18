# OnlyPrivacy protocol — ONLYPRIVACY-STARK-1

This document describes version 0.3.0 as implemented, not an independently reviewed specification. The earlier `private-chain` prototype is a different network.

## Consensus identity

Nodes pin the genesis, configuration hash, fixed proof-program hash, initial allocation, annual fresh issuance, reserve, tree depth, target time and governance parameters. The public genesis and checkpoint are in `network/`. Generating a different genesis creates a different network, even if the display name remains OnlyPrivacy. Full replay validates every block and proof; the wallet file is not a source of monetary authority.

## Notes and private transfers

A note holds an owner digest, unsigned 63-bit atomic amount, random rho and unsigned 32-bit unlock height. Its commitment and membership in a depth-32 Tip5 tree are proved inside the fixed Triton program. Five canonical field limbs represent a digest; each limb is below `2^64 − 2^32 + 1`. Domain separation applies to owners, commitments, nullifiers and external-context bindings. Amounts have 12 decimal places.

Every transaction has two padded inputs and two outputs. Zero-valued padding is excluded from membership/nullifier requirements. Nonzero input ownership and membership, boolean path selectors, lock-height comparisons, nonnegative bounded amounts and exact integer input + mint = output + fee conservation are checked by the program. Two-limb arithmetic with a bounded carry prevents field-modulus wraparound from satisfying conservation.

Public signals are `[nullifier0, nullifier1, commitment0, commitment1, binding, domain, root, mint, fee, externalHash, height, stake, stakeLock]`. Their canonical serialization is 65 field words. A nullifier uses the private spending secret, rho and domain; the same nonzero nullifier can be spent only once. A sender generates fresh change keys as well as using the recipient's one-time invoice. The wallet persists newly generated private keys before publishing a transaction or block.

The external context binds the active suite, network, height, random nonce, action and two encrypted envelopes. Each envelope has a fixed 1,024-byte encrypted payload, KEM ciphertext, nonce and tag. The envelope hash is part of the proof statement. Encryption validity for a particular recipient is not itself proved inside the STARK: a malicious sender can construct an unreadable output and lose their own funds.

The verifier pins the compiled program digest, the upstream proof system and padded trace height 65,536. The proof engine receives private witness fields on standard input, without a shell and without wallet-password environment variables. VM execution without a proof is a development operation and never a valid network proof. Proof payload and process output sizes and runtime are bounded.

## Blocks, reserve and work

Genesis header supply is 10,000 ONLYP; its private spendable note is 100 ONLYP. The remaining 9,900 is a consensus accounting reserve with no spendable note or private key. A block's reserve release must equal the minimum of its integer per-height schedule, earned elapsed-time credit and remaining reserve. There is no administrator payout path. A delayed distribution can continue beyond the target height until the reserve is exhausted.

Fresh minting is separately limited by its per-height 100/year target, cumulative elapsed-time credit and the remaining allowance in a rolling 365-day interval of block timestamps. Every validator recomputes these values. Time is consensus timestamp time, not a proven external real-time oracle. Reserve release does not increase total supply, but it increases spendable circulation. The ordinary coinbase pays exact fresh issuance + exact reserve release + public fees to the miner's fresh encrypted note.

Non-genesis blocks need native RandomX work over the canonical header. The implementation uses the portable light interpreter with a 256 MiB cache and no JIT. RandomX seed scheduling and a bounded ten-block difficulty adjustment are fixed by this implementation. The selected branch has strictly greater accumulated work; first-seen ties stay unchanged. These research difficulty/time rules require adversarial review before public value-bearing use. There is no identity registration or identity-based reward sharing.

Transactions are limited to four per block including coinbase, 6 MiB per transaction and 24 MiB per block. Three pending ordinary transactions fit beside a coinbase. At most 32 pending transactions, eight queued mutations and bounded concurrent HTTP connections are accepted. Recent anchors cover 256 roots; ordinary transaction context expires after 64 blocks.

## Persistence and peers

Validated blocks are saved separately beside a small chain index (`chain.json.blocks/` and `chain.json`). Both are needed when moving an archived chain. The index is atomically replaced only after block files are durable. Failed pre-commit storage leaves the old live state in place; uncertain post-rename durability makes a node read-only until replay/restart. OS file locks prevent two writers and release when a process dies. A candidate branch is verified off the live state and persisted before adoption.

`/tip`, `/range?from=H&count=N`, `/pending` and transaction/block submission carry public data only. Range synchronization fetches at most two blocks per response, verifies genesis against the local checkpoint, replays candidates, checks the final tip/work and supports resumable validated candidate storage. Legacy `/chain` replies are restricted to short chains. Clients accept v3 onion URLs only and require authenticated SOCKS isolation without direct/DNS fallback. The HTTP listener binds loopback and rejects browser Origin requests. TLS-over-Tor, cover traffic and protection against global traffic correlation are not implemented.

## Governance and historical notes

Every node enforces its adopted source rules. There is no forced update signature or global decryption key. Registered KEM suites are ML-KEM-768 and ML-KEM-1024; the present network starts at suite 2, so no higher suite is currently eligible. The existing voting framework can activate only a stronger registered suite, with 1 ONLYP locked per proposal/vote, a 1,000-vote quorum, 1,440-block voting window, two-thirds yes and 360-block delay. It is stake-weighted locked-note voting, not one human one vote. It cannot install arbitrary executable code or change issuance by ballot.

`renew` spends up to two old notes into fresh output keys and the current supported encryption suite, paying the ordinary fee. The old nullifiers prevent copying those notes into the new state twice, including when a copied wallet is used. Old invoice keys and decoders must remain available for old notes. Future changes to the commitment hash, proof program, field or ownership algorithm need an explicitly specified legacy verifier/migration design and participant adoption. They are not made automatic by this renewal command. An algorithm already broken before an owner migrates cannot be repaired retroactively by software.
