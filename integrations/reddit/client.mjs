const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE_URL = "https://oauth.reddit.com";
const VALID_SORTS = new Set(["best", "hot", "new", "rising", "top", "controversial"]);

function requiredEnvironment(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function responseJson(response, description) {
  if (!response.ok) {
    const body = (await response.text()).trim().slice(0, 500);
    throw new Error(`${description} failed with HTTP ${response.status}${body ? `: ${body}` : ""}`);
  }
  return response.json();
}

export function createRedditClient({
  environment = process.env,
  fetchImplementation = globalThis.fetch,
  timeoutMilliseconds = 30_000,
} = {}) {
  const appId = requiredEnvironment(environment, "REDDIT_APP_ID");
  const appSecret = requiredEnvironment(environment, "REDDIT_APP_SECRET");
  const username = requiredEnvironment(environment, "REDDIT_USERNAME");
  const password = requiredEnvironment(environment, "REDDIT_PASSWORD");
  const userAgent = environment.REDDIT_USER_AGENT?.trim()
    || `linux:feedr-node:1.0 (by /u/${username})`;
  let accessTokenPromise;

  async function accessToken() {
    if (!accessTokenPromise) {
      accessTokenPromise = (async () => {
        const response = await fetchImplementation(TOKEN_URL, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": userAgent,
          },
          body: new URLSearchParams({
            grant_type: "password",
            username,
            password,
          }),
          signal: AbortSignal.timeout(timeoutMilliseconds),
        });
        const payload = await responseJson(response, "Reddit access-token request");
        if (!payload.access_token) {
          throw new Error("Reddit access-token response omitted access_token");
        }
        return payload.access_token;
      })().catch((error) => {
        accessTokenPromise = undefined;
        throw error;
      });
    }
    return accessTokenPromise;
  }

  async function get(path, parameters = {}) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const query = new URLSearchParams(
      Object.entries(parameters)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)]),
    );
    const suffix = query.size > 0 ? `?${query}` : "";
    const response = await fetchImplementation(`${API_BASE_URL}${normalizedPath}${suffix}`, {
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "User-Agent": userAgent,
      },
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
    return responseJson(response, `Reddit request for ${normalizedPath}`);
  }

  async function subreddit({ subreddit, sort = "hot", time, limit = 25 }) {
    if (!/^[A-Za-z0-9_]+$/.test(subreddit || "")) {
      throw new Error("subreddit must contain only letters, numbers, or underscores");
    }
    if (!VALID_SORTS.has(sort)) {
      throw new Error(`unsupported Reddit sort: ${sort}`);
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Reddit limit must be an integer from 1 through 100");
    }
    const listing = await get(`/r/${subreddit}/${sort}`, {
      limit,
      raw_json: 1,
      t: time,
    });
    if (!Array.isArray(listing?.data?.children)) {
      throw new Error("Reddit listing response omitted data.children");
    }
    return listing.data.children
      .map((child) => child?.data)
      .filter(Boolean);
  }

  return Object.freeze({ get, subreddit });
}
