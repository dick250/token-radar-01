# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dick250/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dick250/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A deterministic token launch radar built from the sealed snapshot alone. It scores every protocol in the snapshot, ranks 220 pre-token candidates by implied value from a snapshot-derived model (comparable market-cap/TVL multiples per protocol family, shrunk toward family priors in log space), covers all 40 watchlist protocols, and gives every row a concrete farm plan with costs and time. Each run writes board.json, a static fully offline dashboard, and the judge's dossier — same input, same bytes, every run.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22 or newer, standard library only. `<snapshot.json>` is the sealed snapshot file (in the grading container the program defaults to /input/snapshot.json).

---

<sub>Entered on [make.fun](https://make.fun/?ref=11h4eb64&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
