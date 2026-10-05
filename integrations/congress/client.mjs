const API_BASE_URL = "https://api.congress.gov/v3/";
const API_ORIGIN = new URL(API_BASE_URL).origin;
const VALID_BILL_TYPES = new Set([
  "hr",
  "s",
  "hjres",
  "sjres",
  "hconres",
  "sconres",
  "hres",
  "sres",
]);
const VALID_SORTS = new Set(["updateDate+asc", "updateDate+desc"]);

function requiredEnvironment(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function dateTime(value, name) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${name} must be a valid ISO 8601 date-time`);
  }
  return value;
}

function calendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("date must use YYYY-MM-DD format");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("date must be a valid calendar date");
  }
  return value;
}

function billReference(reference) {
  const congress = positiveInteger(reference?.congress, "congress");
  const billNumber = String(reference?.number ?? "").trim();
  if (!/^\d+$/.test(billNumber) || Number(billNumber) < 1) {
    throw new Error("bill number must be a positive integer");
  }
  const billType = String(reference?.type ?? reference?.billType ?? "").toLowerCase();
  if (!VALID_BILL_TYPES.has(billType)) {
    throw new Error(`unsupported Congress bill type: ${billType || "(empty)"}`);
  }
  return { congress, billType, billNumber };
}

async function responseJson(response, description) {
  if (!response.ok) {
    const body = (await response.text()).trim().slice(0, 500);
    throw new Error(`${description} failed with HTTP ${response.status}${body ? `: ${body}` : ""}`);
  }
  return response.json();
}

export function createCongressClient({
  environment = process.env,
  fetchImplementation = globalThis.fetch,
  timeoutMilliseconds = 30_000,
} = {}) {
  const apiKey = requiredEnvironment(environment, "CONGRESS_API_KEY");
  if (typeof fetchImplementation !== "function") {
    throw new Error("a fetch implementation is required");
  }
  positiveInteger(timeoutMilliseconds, "timeoutMilliseconds");

  async function get(path, parameters = {}) {
    const url = new URL(path, API_BASE_URL);
    if (url.origin !== API_ORIGIN || !url.pathname.startsWith("/v3/")) {
      throw new Error("Congress API requests must use https://api.congress.gov/v3/");
    }
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    url.searchParams.set("format", "json");
    url.searchParams.set("api_key", apiKey);

    const response = await fetchImplementation(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
    return responseJson(response, `Congress API request for ${url.pathname}`);
  }

  async function bills({
    congress,
    fromDateTime,
    toDateTime,
    limit = 20,
    offset = 0,
    sort = "updateDate+desc",
  } = {}) {
    if (congress !== undefined) positiveInteger(congress, "congress");
    if (!Number.isInteger(limit) || limit < 1 || limit > 250) {
      throw new Error("Congress bill limit must be an integer from 1 through 250");
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error("Congress bill offset must be a non-negative integer");
    }
    if (!VALID_SORTS.has(sort)) {
      throw new Error(`unsupported Congress bill sort: ${sort}`);
    }
    const normalizedFrom = dateTime(fromDateTime, "fromDateTime");
    const normalizedTo = dateTime(toDateTime, "toDateTime");
    if (normalizedFrom && normalizedTo && Date.parse(normalizedFrom) > Date.parse(normalizedTo)) {
      throw new Error("fromDateTime must not be after toDateTime");
    }

    const payload = await get(congress === undefined ? "bill" : `bill/${congress}`, {
      fromDateTime: normalizedFrom,
      toDateTime: normalizedTo,
      limit,
      offset,
      sort,
    });
    if (!Array.isArray(payload?.bills)) {
      throw new Error("Congress bill response omitted bills");
    }
    return payload.bills;
  }

  async function billsActionedOn({
    date = new Date().toISOString().slice(0, 10),
    ...options
  } = {}) {
    const normalizedDate = calendarDate(date);
    const matchingBills = await bills({
      ...options,
      fromDateTime: `${normalizedDate}T00:00:00Z`,
      toDateTime: `${normalizedDate}T23:59:59Z`,
      limit: options.limit ?? 250,
    });
    return matchingBills.filter((bill) => bill?.latestAction?.actionDate === normalizedDate);
  }

  async function billDetails(reference) {
    const { congress, billType, billNumber } = billReference(reference);
    const payload = await get(`bill/${congress}/${billType}/${billNumber}`);
    if (!payload?.bill || typeof payload.bill !== "object") {
      throw new Error("Congress bill-detail response omitted bill");
    }
    return payload.bill;
  }

  async function billSummaries(reference) {
    const { congress, billType, billNumber } = billReference(reference);
    const payload = await get(`bill/${congress}/${billType}/${billNumber}/summaries`);
    if (!Array.isArray(payload?.summaries)) {
      throw new Error("Congress bill-summary response omitted summaries");
    }
    return payload.summaries;
  }

  async function latestBillSummary(reference) {
    const summaries = await billSummaries(reference);
    return summaries.reduce((latest, candidate) => {
      if (!latest) return candidate;
      const latestTime = Date.parse(latest.lastSummaryUpdateDate ?? "");
      const candidateTime = Date.parse(candidate.lastSummaryUpdateDate ?? "");
      if (Number.isNaN(candidateTime)) return latest;
      if (Number.isNaN(latestTime) || candidateTime > latestTime) return candidate;
      return latest;
    }, null);
  }

  return Object.freeze({
    get,
    bills,
    billsActionedOn,
    billDetails,
    billSummaries,
    latestBillSummary,
  });
}
