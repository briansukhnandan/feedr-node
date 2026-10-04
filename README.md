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

Extend the Dockerfile if a generator needs another runtime or package.

## Generator contract

The configured command runs with `FEEDR_FEED_ID`, `FEEDR_CRON_STRING`,
`FEEDR_SCRIPT_DIR`, `FEEDR_SCRIPT_COMMAND`, and `FEEDR_TIMEZONE` exported. It
should create a complete JSON array and call:

```sh
feedr publish /path/to/generated-posts.json
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
