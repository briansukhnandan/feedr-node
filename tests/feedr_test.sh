#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
feedr=$project_dir/bin/feedr
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM

assert_file() {
  [ -f "$1" ] || {
    printf 'expected file: %s\n' "$1" >&2
    exit 1
  }
}

mkdir -p "$test_dir/config" "$test_dir/feedr" "$test_dir/scripts" "$test_dir/state" "$test_dir/bin"
config=$test_dir/config/feedr-node.conf

printf 'my-feed\n*/15 * * * *\n' | \
  FEEDR_CONFIG_FILE=$config \
  FEEDR_HOME=$test_dir/feedr \
  FEEDR_SCRIPT_DIR=$test_dir/scripts \
  FEEDR_SCRIPT_COMMAND='./generate.sh' \
  "$feedr" init >/dev/null

grep -Fx 'FEEDR_FEED_ID=my-feed' "$config" >/dev/null
grep -Fx 'FEEDR_CRON_STRING=*/15 * * * *' "$config" >/dev/null

posts=$test_dir/posts.json
printf '%s\n' '[{"id":"one","text":"hello"}]' >"$posts"
FEEDR_CONFIG_FILE=$config FEEDR_HOME=$test_dir/feedr "$feedr" publish "$posts" >/dev/null
today=$(TZ=UTC date +%Y_%m_%d)
published=$test_dir/feedr/$today/feeds/my-feed/posts.json
assert_file "$published"
cmp "$posts" "$published"

printf '%s\n' '#!/bin/sh' 'cp "$1" "$CRONTAB_CAPTURE"' >"$test_dir/bin/crontab"
printf '%s\n' '#!/bin/sh' 'exit 0' >"$test_dir/bin/crond"
chmod +x "$test_dir/bin/crontab" "$test_dir/bin/crond"
CRONTAB_CAPTURE=$test_dir/registered-crontab \
PATH=$test_dir/bin:$PATH \
FEEDR_CONFIG_FILE=$config \
FEEDR_HOME=$test_dir/feedr \
FEEDR_STATE_DIR=$test_dir/state \
"$feedr" run >/dev/null

assert_file "$test_dir/state/cron.registered"
grep -F '*/15 * * * * /usr/local/bin/feedr _run-job' "$test_dir/registered-crontab" >/dev/null

printf '%s\n' 'feedr tests passed'
