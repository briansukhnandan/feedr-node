import assert from "node:assert/strict";
import test from "node:test";

import {
  billViewerUrl,
  chunkText,
  generateCongressPosts,
  summaryTextFromHtml,
} from "../scripts/examples/congress-bill-summaries/congress-bill-summaries.mjs";

test("formats actioned bills as feedr summary threads", async () => {
  const calls = [];
  const bill = {
    congress: 119,
    type: "HR",
    number: "123",
    title: "Example Act",
    updateDate: "2026-10-04",
    latestAction: { actionDate: "2026-10-04", text: "Passed House." },
  };
  const client = {
    async billsUpdatedOn(options) {
      calls.push(options);
      return [bill];
    },
    async billDetails() {
      return {
        title: "Example Act",
        introducedDate: "2026-08-01",
        updateDate: "2026-10-04T14:00:00Z",
        policyArea: { name: "Government Operations and Politics" },
        sponsors: [{ fullName: "Rep. Example, Alex [D-NY]" }],
      };
    },
    async latestBillSummary() {
      return {
        text: "<p>Example Act</p><p>Updates services &amp; reporting requirements.</p>",
      };
    },
  };

  const posts = await generateCongressPosts({ client, date: "2026-10-04" });

  assert.deepEqual(calls, [{ date: "2026-10-04", limit: 15 }]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, "congress-119-hr-123-2026-10-04");
  assert.match(posts[0].thread[0].text, /Updated: 2026-10-04/);
  assert.equal(posts[0].thread[1].text, "Updates services & reporting requirements.");
  assert.match(posts[0].thread[2].text, /Rep\. Example, Alex/);
  assert.equal(posts[0].thread.at(-1).url,
    "https://www.congress.gov/bill/119th-congress/house-bill/123");
  assert.equal(posts[0].metadata.latestAction, "Passed House.");
  assert.equal(posts[0].metadata.updateDate, "2026-10-04");
});

test("skips bills that have no API summary without scraping", async () => {
  const errors = [];
  const client = {
    async billsUpdatedOn() {
      return [{
        congress: 119,
        type: "S",
        number: "5",
        latestAction: { actionDate: "2026-10-04" },
      }];
    },
    async billDetails() {
      return { title: "No Summary Act", sponsors: [] };
    },
    async latestBillSummary() {
      return null;
    },
  };

  const posts = await generateCongressPosts({
    client,
    date: "2026-10-04",
    logger: { error: (message) => errors.push(message) },
  });

  assert.deepEqual(posts, []);
  assert.match(errors[0], /no summary/i);
});

test("keeps summary chunks within the Bluesky-safe limit", () => {
  const chunks = chunkText("word ".repeat(200), 50);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => Array.from(chunk).length <= 50));
  assert.equal(summaryTextFromHtml("<p>A &amp; B</p>"), "A & B");
  assert.equal(
    billViewerUrl({ congress: 118, type: "SJRES", number: "2" }),
    "https://www.congress.gov/bill/118th-congress/senate-joint-resolution/2",
  );
});
