import assert from "node:assert/strict";
import test from "node:test";

import { createCongressClient } from "../integrations/congress/client.mjs";

const environment = { CONGRESS_API_KEY: "congress-api-key" };

test("fetches bills actioned on a selected date", async () => {
  const calls = [];
  const fetchImplementation = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return new Response(JSON.stringify({
      bills: [
        {
          congress: 119,
          type: "HR",
          number: "123",
          latestAction: { actionDate: "2026-10-04", text: "Passed House." },
        },
        {
          congress: 119,
          type: "S",
          number: "456",
          latestAction: { actionDate: "2026-10-03", text: "Introduced." },
        },
      ],
    }), { status: 200 });
  };
  const congress = createCongressClient({ environment, fetchImplementation });

  const bills = await congress.billsActionedOn({ date: "2026-10-04", limit: 25 });

  assert.deepEqual(bills.map(({ number }) => number), ["123"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/v3/bill");
  assert.equal(calls[0].url.searchParams.get("api_key"), "congress-api-key");
  assert.equal(calls[0].url.searchParams.get("format"), "json");
  assert.equal(calls[0].url.searchParams.get("fromDateTime"), "2026-10-04T00:00:00Z");
  assert.equal(calls[0].url.searchParams.get("toDateTime"), "2026-10-04T23:59:59Z");
  assert.equal(calls[0].url.searchParams.get("limit"), "25");
  assert.equal(calls[0].options.headers.Accept, "application/json");
});

test("fetches every bill updated on a selected date", async () => {
  const fetchImplementation = async () => new Response(JSON.stringify({
    bills: [
      {
        congress: 119,
        type: "S",
        number: "2970",
        updateDate: "2026-10-01",
        latestAction: { actionDate: "2026-09-30" },
      },
      {
        congress: 117,
        type: "HR",
        number: "6583",
        updateDate: "2026-10-01",
        latestAction: { actionDate: "2022-02-04" },
      },
    ],
  }), { status: 200 });
  const congress = createCongressClient({ environment, fetchImplementation });

  const bills = await congress.billsUpdatedOn({ date: "2026-10-01", limit: 20 });

  assert.deepEqual(bills.map(({ number }) => number), ["2970", "6583"]);
});

test("fetches bill details and selects the latest API summary", async () => {
  const paths = [];
  const fetchImplementation = async (url) => {
    const { pathname } = new URL(url);
    paths.push(pathname);
    if (pathname.endsWith("/summaries")) {
      return new Response(JSON.stringify({
        summaries: [
          { text: "Older summary", lastSummaryUpdateDate: "2026-09-01T12:00:00Z" },
          { text: "Latest summary", lastSummaryUpdateDate: "2026-10-03T12:00:00Z" },
        ],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      bill: { congress: 119, type: "HR", number: "123", title: "A test bill" },
    }), { status: 200 });
  };
  const congress = createCongressClient({ environment, fetchImplementation });
  const reference = { congress: 119, type: "HR", number: "123" };

  assert.equal((await congress.billDetails(reference)).title, "A test bill");
  assert.equal((await congress.latestBillSummary(reference)).text, "Latest summary");
  assert.deepEqual(paths, [
    "/v3/bill/119/hr/123",
    "/v3/bill/119/hr/123/summaries",
  ]);
});

test("returns null when the Congress API has no bill summary", async () => {
  const congress = createCongressClient({
    environment,
    fetchImplementation: async () => new Response(JSON.stringify({ summaries: [] }), {
      status: 200,
    }),
  });

  assert.equal(await congress.latestBillSummary({
    congress: 119,
    type: "S",
    number: "1",
  }), null);
});

test("validates credentials, request URLs, and bill options", async () => {
  assert.throws(() => createCongressClient({ environment: {} }), /CONGRESS_API_KEY is required/);
  const congress = createCongressClient({
    environment,
    fetchImplementation: () => assert.fail("invalid input must fail before fetching"),
  });

  await assert.rejects(
    congress.get("https://example.com/v3/bill"),
    /must use https:\/\/api\.congress\.gov\/v3\//,
  );
  await assert.rejects(
    congress.billsActionedOn({ date: "2026-02-30" }),
    /valid calendar date/,
  );
  await assert.rejects(
    congress.bills({ limit: 251 }),
    /limit must be an integer/,
  );
  await assert.rejects(
    congress.billDetails({ congress: 119, type: "unknown", number: "1" }),
    /unsupported Congress bill type/,
  );
});
