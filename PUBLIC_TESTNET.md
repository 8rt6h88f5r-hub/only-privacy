# Public test network

OnlyPrivacy is being released for public testing, with native encrypted wallet software and CPU mining. It is not an independently audited production currency. Participation does not establish a market price, exchange listing, finality or absolute anonymity. The initial owner allocation is preserved; no reset/new genesis is used to simulate a public launch.

The verified seed is in `config/peers.json`; compare the genesis against `network/checkpoint.json` before joining:

`a4d251900e072e0f15e372fb1f3b7753dc2b3947f77eda1cc2337d686a1c2694`

The initial seed runs on one developer computer behind Tor. It is reachable only while that computer, node and Internet connection are operating. It is not an independently distributed or continuously guaranteed service. No paid cloud server has been provisioned. Additional operators should run their own validating nodes and explicitly exchange verified onion endpoints. There is no automatic peer discovery or identity-based enrollment.

## Join and mine

On the supplied Mac build, run `채굴시작.command`, choose creation of a participation wallet, and use a strong password you can recover. Run the menu again, choose CPU mining and accept/paste the verified seed address. The new participation wallet starts at zero. Each mining action attempts one block with a bounded amount of work; it does not start a hidden background miner.

On source builds, follow [BUILD.md](BUILD.md), run Tor on SOCKS port 19050 with `IsolateSOCKSAuth`, and use `join` followed by `mine-remote`. Clients independently validate the seed's chain, proofs and scheduled reward. A miner earns a block's protocol reserve release + new subsidy + fees only if that block is accepted. No fixed return, equal reward per person or payout for invalid work is promised. A heavier valid branch can reverse previous blocks.

## Wallet

The native `OnlyPrivacyWallet.app` is for macOS 14+ on Apple Silicon. Open an existing private `owner.json` or create a new password-encrypted zero-balance wallet in a private folder outside the application. The app stores that wallet password in the local Keychain. Back up the encrypted wallet and the necessary unlock information; the application has no developer recovery key.

The app displays verified local balance, available/locked/reserved notes, height and current encryption suite. It generates fresh compact receive addresses, QR codes and public invoice files; prepares real private proof transactions; submits them over Tor; synchronizes the chain; and prepares renewal transactions. Making a transaction file does not confirm it. Wait for a valid block and synchronize. Tor is required for remote operations; run the supplied node/miner connection tools or your own suitable Tor client first.

The public application bundle contains no owner wallet, owner Keychain metadata or Tor hidden-service keys. Downloaded binaries use local ad-hoc signatures, not a paid Apple Developer ID or independent certificate. For distribution, prefer building the published source yourself if macOS cannot verify a downloaded app. Do not disable operating-system security protections.

## Operate another node

Run `노드공유.command` on the supplied Mac build. It starts a loopback listener and a v3 onion service using public chain data; it does not unlock the owner's wallet. The address is displayed when prepared. Keep the process and computer running to provide a service; Ctrl+C stops it. Preserve the private `data/` folder locally and never publish its onion service keys.

`run <peers.json> <chain.json> <port>` can validate and follow up to eight explicitly configured peers. Accept peer endpoints only after checking the intended public checkpoint. Do not expose private wallet operations as RPC endpoints or port-forward the local HTTP service directly to the Internet.

## Release verification

`reports/public-release-tests.tap` contains the final complete regression output. `reports/dependency-advisories.json` records a timestamped OSV/npm lookup of 121 pinned registry dependencies with no matches at lookup time, its exact package list and exclusions. Git-pinned cryptography, RandomX and runtime security are not fully covered by those databases. The lookup is not an independent audit.

`reports/public-node-probe.json` records a real Tor client response from the seed. It establishes observed connectivity at one time, not an independent node operator or protection from global traffic analysis. New public HTTP tests reproduce and guard fixes for oversized pending replies and uncaught archive-read failures. See [SECURITY.md](SECURITY.md) for the remaining production blockers and privacy limitations.
