import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { createCongressClient } from "../../../integrations/congress/client.mjs";

const execFileAsync = promisify(execFile);
const SUMMARY_CHUNK_LIMIT = 275;
const BILL_TYPE_PATHS = new Map([
  ["hr", "house-bill"],
  ["s", "senate-bill"],
  ["hjres", "house-joint-resolution"],
  ["sjres", "senate-joint-resolution"],
  ["hconres", "house-concurrent-resolution"],
  ["sconres", "senate-concurrent-resolution"],
  ["hres", "house-resolution"],
  ["sres", "senate-resolution"],
]);

function runeLength(value) {
  return Array.from(value).length;
}

function truncateText(value, limit) {
  const runes = Array.from(String(value));
  if (runes.length <= limit) return runes.join("");
  return `${runes.slice(0, Math.max(0, limit - 1)).join("")}…`;
}

export function chunkText(value, limit = SUMMARY_CHUNK_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("chunk limit must be a positive integer");
  }
  const words = String(value).trim().split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = "";

  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };

  for (const word of words) {
    if (runeLength(word) > limit) {
      flush();
      const runes = Array.from(word);
      while (runes.length > limit) chunks.push(runes.splice(0, limit).join(""));
      current = runes.join("");
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (runeLength(candidate) > limit) {
      flush();
      current = word;
    } else {
      current = candidate;
    }
  }
  flush();
  return chunks;
}

function decodeHtmlEntities(value) {
  const named = new Map([
    ["amp", "&"],
    ["apos", "'"],
    ["gt", ">"],
    ["lt", "<"],
    ["nbsp", " "],
    ["quot", "\""],
  ]);
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return named.get(entity.toLowerCase()) ?? match;
  });
}

export function summaryTextFromHtml(value, title = "") {
  let text = String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  text = decodeHtmlEntities(text);
  if (title) text = text.replace(title, "").trim();
  return text;
}

function currentDateInTimeZone(timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date()).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function ordinal(value) {
  const remainder100 = value % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

export function billViewerUrl(bill) {
  const type = String(bill.type ?? bill.billType ?? "").toLowerCase();
  const typePath = BILL_TYPE_PATHS.get(type);
  if (!typePath) throw new Error(`unsupported Congress bill type: ${type || "(empty)"}`);
  return `https://www.congress.gov/bill/${ordinal(bill.congress)}-congress/${typePath}/${bill.number}`;
}

function dateOnly(value, fallback = "Not available") {
  const match = String(value ?? "").match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? fallback;
}

function sponsorsText(sponsors = []) {
  if (sponsors.length === 0) return "Sponsors: Not available";
  return truncateText(
    `Sponsors:\n${sponsors.map((sponsor) => `- ${sponsor.fullName}`).join("\n")}`,
    SUMMARY_CHUNK_LIMIT,
  );
}

export async function buildCongressPost(bill, client) {
  const [details, summary] = await Promise.all([
    client.billDetails(bill),
    client.latestBillSummary(bill),
  ]);
  if (!summary?.text) {
    throw new Error(`Congress API has no summary for ${bill.type} ${bill.number}`);
  }

  const title = details.title ?? bill.title ?? `${bill.type} ${bill.number}`;
  const summaryText = summaryTextFromHtml(summary.text, title);
  if (!summaryText) {
    throw new Error(`Congress API returned an empty summary for ${bill.type} ${bill.number}`);
  }

  const updateDate = dateOnly(details.updateDate, dateOnly(bill.updateDate));
  const actionDate = dateOnly(bill.latestAction?.actionDate, updateDate);
  const rootText = [
    truncateText(title, 200),
    "",
    `Updated: ${updateDate}`,
    `Introduced: ${dateOnly(details.introducedDate)}`,
  ].join("\n");
  const url = billViewerUrl(bill);
  const thread = [
    { text: rootText },
    ...chunkText(summaryText).map((text) => ({ text })),
    { text: sponsorsText(details.sponsors) },
    { text: "Link to bill:", url },
  ];

  return {
    id: `congress-${bill.congress}-${String(bill.type).toLowerCase()}-${bill.number}-${updateDate}`,
    text: rootText,
    url,
    thread,
    metadata: {
      source: "congress.gov",
      congress: bill.congress,
      billType: bill.type,
      billNumber: bill.number,
      updateDate,
      actionDate,
      latestAction: bill.latestAction?.text ?? "",
      policyArea: details.policyArea?.name ?? "Not available",
    },
  };
}

export async function generateCongressPosts({
  client = createCongressClient(),
  date = currentDateInTimeZone(process.env.FEEDR_TIMEZONE || "UTC"),
  logger = console,
} = {}) {
  const bills = await client.billsUpdatedOn({ date, limit: 15 });
  const results = await Promise.allSettled(
    bills.map((bill) => buildCongressPost(bill, client)),
  );
  const posts = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      posts.push(result.value);
      return;
    }
    const bill = bills[index];
    logger.error(
      `Skipping ${bill?.type ?? "bill"} ${bill?.number ?? "(unknown)"}: ${result.reason?.message ?? result.reason}`,
    );
  });
  return posts;
}

async function publish(posts) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "feedr-congress-"));
  const output = join(temporaryDirectory, "posts.json");
  try {
    await writeFile(output, `${JSON.stringify(posts, null, 2)}\n`, "utf8");
    await execFileAsync("feedr", ["publish", output]);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const posts = await generateCongressPosts();
  await publish(posts);
  console.log(`Published ${posts.length} Congress.gov bill summary post(s).`);
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
