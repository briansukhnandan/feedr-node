import assert from "node:assert/strict";
import test from "node:test";

import { createRedditClient } from "../integrations/reddit/client.mjs";

const environment = {
  REDDIT_APP_ID: "app-id",
  REDDIT_APP_SECRET: "app-secret",
  REDDIT_USERNAME: "feedr-user",
  REDDIT_PASSWORD: "reddit-password",
  REDDIT_USER_AGENT: "linux:feedr-node-test:1.0 (by /u/feedr-user)",
};

test("authenticates once and fetches subreddit listings", async () => {
  const calls = [];
  const fetchImplementation = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("access_token")) {
      return new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 });
    }
    return new Response(JSON.stringify({
      data: { children: [{ kind: "t3", data: { id: "abc123" } }] },
    }), { status: 200 });
  };
  const reddit = createRedditClient({ environment, fetchImplementation });

  assert.deepEqual(await reddit.subreddit({
    subreddit: "worldnews",
    sort: "top",
    time: "day",
    limit: 10,
  }), [{ id: "abc123" }]);
  await reddit.get("/api/v1/me");

  assert.equal(calls.filter(({ url }) => url.includes("access_token")).length, 1);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Basic YXBwLWlkOmFwcC1zZWNyZXQ=");
  assert.equal(calls[0].options.body.get("grant_type"), "password");
  assert.match(calls[1].url, /\/r\/worldnews\/top\?/);
  assert.match(calls[1].url, /(?:\?|&)t=day(?:&|$)/);
  assert.equal(calls[1].options.headers.Authorization, "Bearer access-token");
});

test("validates credentials and listing options", async () => {
  assert.throws(() => createRedditClient({ environment: {} }), /REDDIT_APP_ID is required/);
  const reddit = createRedditClient({
    environment,
    fetchImplementation: () => assert.fail("invalid options must fail before fetching"),
  });
  await assert.rejects(
    reddit.subreddit({ subreddit: "../worldnews", limit: 10 }),
    /subreddit must contain/,
  );
  await assert.rejects(
    reddit.subreddit({ subreddit: "worldnews", limit: 101 }),
    /limit must be an integer/,
  );
});
