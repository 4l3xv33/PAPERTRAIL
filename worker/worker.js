const API_BASE_URL = "https://api.openalex.org";
const OPENALEX_TIMEOUT_MS = 30000;
const OPENALEX_MAX_ATTEMPTS = 3;
const OPENALEX_RETRY_DELAYS_MS = [500, 1500];
const OPENALEX_RETRY_STATUSES = new Set([429, 502, 503, 504]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/health") {
        return json({ ok: true, service: "PAPERTRAIL Worker" });
      }

      if (url.pathname === "/search-authors") {
        return json(await searchAuthors(url.searchParams, env));
      }

      if (url.pathname === "/author") {
        return json(await getAuthor(url.searchParams, env));
      }

      if (url.pathname === "/works") {
        return json(await getWorks(url.searchParams, env));
      }

      return json({ error: "Route not found" }, 404);
    } catch (error) {
      return json(
        { error: error.message || "Unexpected Worker error" },
        error.status || 500
      );
    }
  }
};

async function searchAuthors(params, env) {
  const authorId = cleanOpenAlexId(params.get("authorId") || params.get("id"));

  if (authorId) {
    const author = normalizeAuthor(
      await openAlexFetch(`/authors/${authorId}`, {}, env)
    );
    return { authors: [author] };
  }

  const orcid = cleanOrcid(params.get("orcid"));

  if (orcid) {
    const payload = await openAlexFetch(
      `/authors/${encodeURIComponent(`https://orcid.org/${orcid}`)}`,
      {},
      env
    );
    return { authors: [normalizeAuthor(payload)] };
  }

  const name = params.get("name") || params.get("q");

  if (!name) {
    throw withStatus(
      "A researcher name, ORCID, or OpenAlex Author ID is required.",
      400
    );
  }

  const payload = await openAlexFetch(
    "/authors",
    {
      search: name,
      "per-page": "10"
    },
    env
  );

  return {
    authors: (payload.results || []).map(normalizeAuthor)
  };
}

async function getAuthor(params, env) {
  const id = cleanOpenAlexId(params.get("id") || params.get("authorId"));

  if (!id) {
    throw withStatus("OpenAlex Author ID is required.", 400);
  }

  return {
    author: normalizeAuthor(await openAlexFetch(`/authors/${id}`, {}, env))
  };
}

async function getWorks(params, env) {
  const authorId = cleanOpenAlexId(params.get("authorId") || params.get("id"));

  if (!authorId) {
    throw withStatus("OpenAlex Author ID is required.", 400);
  }

  const max = clampInteger(params.get("max"), 1, 200, 100);

  const payload = await openAlexFetch(
    "/works",
    {
      filter: `authorships.author.id:${authorId}`,
      sort: "publication_year:desc",
      "per-page": String(max)
    },
    env
  );

  return {
    works: (payload.results || []).map(normalizeWork),
    meta: payload.meta || {}
  };
}

async function openAlexFetch(path, params, env) {
  const url = new URL(`${API_BASE_URL}${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  applyOpenAlexAuthentication(url, env);

  let lastError = null;

  for (let attempt = 1; attempt <= OPENALEX_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url.toString(), {
        headers: {
          Accept: "application/json"
        }
      });

      const payload = await response.json().catch(() => ({}));

      if (response.ok) {
        return payload;
      }

      const message =
        payload.error ||
        payload.message ||
        `OpenAlex request failed with status ${response.status}`;

      if (!shouldRetryStatus(response.status) || attempt === OPENALEX_MAX_ATTEMPTS) {
        throw withStatus(message, response.status);
      }

      lastError = withStatus(message, response.status);
    } catch (error) {
      lastError = normalizeOpenAlexError(error);

      if (!shouldRetryError(lastError) || attempt === OPENALEX_MAX_ATTEMPTS) {
        throw lastError;
      }
    }

    await delay(OPENALEX_RETRY_DELAYS_MS[attempt - 1] || OPENALEX_RETRY_DELAYS_MS.at(-1));
  }

  throw lastError || withStatus("OpenAlex request failed.", 502);
}

function applyOpenAlexAuthentication(url, env) {
  if (!env.OPENALEX_API_KEY) {
    throw withStatus("OPENALEX_API_KEY is not configured for this Worker.", 500);
  }

  url.searchParams.set("api_key", env.OPENALEX_API_KEY);
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENALEX_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw withStatus("OpenAlex request timed out. Please retry in a few minutes.", 504);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeOpenAlexError(error) {
  if (error.status) return error;

  return withStatus(
    error.message || "OpenAlex request failed before a response was received.",
    502
  );
}

function shouldRetryStatus(status) {
  return OPENALEX_RETRY_STATUSES.has(status);
}

function shouldRetryError(error) {
  return shouldRetryStatus(error.status);
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalizeAuthor(author) {
  return {
    id: author.id || "",
    displayName: author.display_name || "",
    orcid: author.orcid || "",
    worksCount: author.works_count || 0,
    citedByCount: author.cited_by_count || 0,
    lastKnownInstitution: normalizeInstitution(author.last_known_institution),
    institutions: (author.affiliations || [])
      .flatMap((affiliation) => affiliation.institutions || [])
      .map(normalizeInstitution)
      .filter(Boolean)
  };
}

function normalizeWork(work) {
  return {
    id: work.id || "",
    doi: work.doi || "",
    title: work.display_name || work.title || "",
    publicationYear: work.publication_year || null,
    publicationDate: work.publication_date || "",
    citedByCount: work.cited_by_count || 0,

    authorships: (work.authorships || []).map((authorship) => ({
      author: normalizeAuthorLite(authorship.author || {}),
      institutions: (authorship.institutions || [])
        .map(normalizeInstitution)
        .filter(Boolean),
      countries: authorship.countries || []
    })),

    concepts: normalizeConcepts(work),

    grants: work.grants || [],
    funders: work.funders || []
  };
}

function normalizeConcepts(work) {
  const raw = work.concepts?.length ? work.concepts : work.topics || [];

  return raw.map((item) => ({
    id: item.id || "",
    displayName:
      item.display_name ||
      item.display_name_original ||
      item.topic?.display_name ||
      "",
    score: item.score || null
  }));
}

function normalizeAuthorLite(author) {
  return {
    id: author.id || "",
    displayName: author.display_name || ""
  };
}

function normalizeInstitution(institution) {
  if (!institution) return null;

  return {
    id: institution.id || "",
    displayName: institution.display_name || "",
    countryCode: institution.country_code || "",
    type: institution.type || ""
  };
}

function cleanOpenAlexId(value) {
  return String(value || "")
    .trim()
    .replace(/^https:\/\/openalex\.org\//i, "");
}

function cleanOrcid(value) {
  return String(value || "")
    .trim()
    .replace(/^https:\/\/orcid\.org\//i, "");
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) return fallback;

  return Math.min(Math.max(parsed, min), max);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function withStatus(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}
