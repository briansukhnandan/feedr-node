# feedr-node

`feedr-node` runs a content-generation command on a cron schedule and publishes
the resulting JSON into a parent [feedr](../feedr) daemon's data directory. The
generator can be any executable placed in `scripts/`.

## Configure and run

Initialize the node interactively:

```sh
make init
```

`feedr init` asks for a feed ID and a standard five-field cron schedule and
writes them to `config/feedr-node.conf`. Then set these fields in that file:

```text
FEEDR_SCRIPT_DIR=/scripts
FEEDR_SCRIPT_COMMAND=./example.sh
FEEDR_TIMEZONE=America/New_York
```

`FEEDR_TIMEZONE` must match the timezone in the parent daemon's
`~/.feedr/config.json`; otherwise the two containers can disagree about which
day's directory to use near midnight. The feed ID must also exist in the
parent's `feeds` configuration, where its publishing destinations are defined.

Start the node:

```sh
make start
docker compose logs --follow feedr-node
```

The Compose file mounts:

- `./scripts` at `/scripts` (read-only)
- `./config` at `/config`
- `${FEEDR_DATA_DIR:-$HOME/.feedr}` at `/feedr`

The Make targets pass the host UID and GID into the container. Cron itself
runs as root, but generator and publishing commands drop to that identity so
the node does not leave root-owned files in `~/.feedr`.

The image tracks the official `node:lts-alpine` tag and includes Node.js,
`npm`, Alpine's current `python3`, and `pip3`. The `python` and `pip` commands
are aliases for their Python 3 equivalents. `make build`, `make start`, and
`make test` use Docker's `--pull` option so a rebuild checks for the latest LTS
base image. Extend the Dockerfile if a generator needs another package.

## Optional integrations

Reusable optional integrations live under `integrations/<name>/` and are
copied into the image at `/integrations`. Nothing in that directory runs
unless a feed script imports it, so the scheduler remains independent of the
services used by individual feeds.

Runnable integration examples live under `scripts/examples/<name>/`. Each
directory keeps its generator and an `example.conf` together so the required
feed ID, schedule, script command, timezone, and integration environment are
visible in one place.

Each integration can provide a `config/<name>.env.example` file. To enable
one, copy its example to `config/<name>.env`, fill in the values, and
uncomment that integration's environment variables in `compose.yaml`. Make
automatically passes every `config/*.env` file to Compose, allowing
multiple integrations to be enabled together. These populated files are
excluded from Git and the Docker build context.

### Congress.gov

The Congress.gov client fetches bills, bill details, and bill summaries
through the official API using only Node.js built-ins. It does not scrape
Congress.gov or launch a browser. Enable it with:

```sh
cp config/congress.env.example config/congress.env
# Fill in config/congress.env, then uncomment CONGRESS_API_KEY in compose.yaml.
make start
```

With direct Compose commands, also pass `--env-file config/congress.env`. A
Node.js feed script can then use the client without installing a package:

```js
import { createCongressClient } from "../integrations/congress/client.mjs";

const congress = createCongressClient();
const date = new Date().toISOString().slice(0, 10);
const bills = await congress.billsActionedOn({ date });

for (const bill of bills) {
  const details = await congress.billDetails(bill);
  const summary = await congress.latestBillSummary(bill);
  // A bill can legitimately have no API summary; in that case summary is null.
}
```

For a complete generator that publishes the latest bills actioned on today as
formatted summary threads, see
`scripts/examples/congress-bill-summaries/`. Copy its `example.conf` to
`config/feedr-node.conf` and adjust the feed ID, schedule, and timezone for the
parent feedr installation.

## Generator contract

The configured command runs with `FEEDR_FEED_ID`, `FEEDR_CRON_STRING`,
`FEEDR_SCRIPT_DIR`, `FEEDR_SCRIPT_COMMAND`, and `FEEDR_TIMEZONE` exported. It
should create a complete JSON array and call:

```sh
feedr publish /path/to/generated-posts.json
```

For example, the configured command may invoke either bundled runtime:

```text
FEEDR_SCRIPT_COMMAND=node generator.js
FEEDR_SCRIPT_COMMAND=python generator.py
```

Publishing validates the basic JSON shape, then atomically replaces:

```text
/feedr/YYYY_MM_DD/feeds/$FEEDR_FEED_ID/posts.json
```

That path corresponds to
`~/.feedr/YYYY_MM_DD/feeds/<feed-id>/posts.json` on the host and matches the
current feedr daemon contract.

`feedr run` installs the configured schedule once and starts cron in the
foreground. Since a child process cannot persistently change its container's
environment, the node exports `FEEDR_REGISTERED_CRON_JOB=1` for the cron
process and records registration in `/var/lib/feedr-node/cron.registered` for
the rest of that container's lifetime. Registration is safe to recreate when a
container is replaced.

## Test

```sh
./tests/feedr_test.sh
docker build -t feedr-node:local .
```
