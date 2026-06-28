const DEFAULT_WORKER_URL = "https://papertrail-api.4l3xv33.workers.dev";
const CACHE_TTL = {
  searches: 7 * 24 * 60 * 60 * 1000,
  authors: 30 * 24 * 60 * 60 * 1000,
  works: 30 * 24 * 60 * 60 * 1000
};

const state = {
  author: null,
  works: [],
  analysis: null,
  memo: "",
  exportData: null
};

const elements = {
  form: document.querySelector("#search-form"),
  nameInput: document.querySelector("#name-input"),
  orcidInput: document.querySelector("#orcid-input"),
  authorIdInput: document.querySelector("#author-id-input"),
  refreshInput: document.querySelector("#refresh-input"),
  clearButton: document.querySelector("#clear-button"),
  clearCacheButton: document.querySelector("#clear-cache-button"),
  status: document.querySelector("#status-indicator"),
  resultsSource: document.querySelector("#results-source"),
  resultsList: document.querySelector("#results-list"),
  profileSection: document.querySelector("#profile-section"),
  profileContent: document.querySelector("#profile-content"),
  dashboardSection: document.querySelector("#dashboard-section"),
  dashboardGrid: document.querySelector("#dashboard-grid"),
  analysisSource: document.querySelector("#analysis-source"),
  memoSection: document.querySelector("#memo-section"),
  memoOutput: document.querySelector("#memo-output"),
  copyMemoButton: document.querySelector("#copy-memo-button"),
  downloadMdButton: document.querySelector("#download-md-button"),
  downloadJsonButton: document.querySelector("#download-json-button")
};

const db = {
  name: "papertrail-cache",
  version: 1,
  connection: null,
  async open() {
    if (this.connection) return this.connection;
    this.connection = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, this.version);
      request.onupgradeneeded = () => {
        const database = request.result;
        ["searches", "authors", "works"].forEach((storeName) => {
          if (!database.objectStoreNames.contains(storeName)) {
            database.createObjectStore(storeName, { keyPath: "key" });
          }
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.connection;
  },
  async get(storeName, key, ttl) {
    const database = await this.open();
    const record = await new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    if (!record) return null;
    if (Date.now() - record.savedAt > ttl) return null;
    return record.value;
  },
  async set(storeName, key, value) {
    const database = await this.open();
    await new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put({ key, value, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async clear() {
    const database = await this.open();
    await Promise.all(["searches", "authors", "works"].map((storeName) => new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, "readwrite");
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    })));
  }
};

const researchProvider = {
  get baseUrl() {
    return (window.PAPERTRAIL_WORKER_URL || localStorage.getItem("papertrail_worker_url") || DEFAULT_WORKER_URL).replace(/\/$/, "");
  },
  async request(path, params) {
    if (!this.baseUrl) {
      throw new Error("Worker URL is not configured. Set window.PAPERTRAIL_WORKER_URL or localStorage papertrail_worker_url.");
    }
    const url = new URL(`${this.baseUrl}${path}`);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
    });
    const response = await fetch(url.toString());
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Request failed with status ${response.status}`);
    }
    return payload;
  },
  searchAuthors(query) {
    return this.request("/search-authors", query);
  },
  getAuthor(authorId) {
    return this.request("/author", { id: authorId });
  },
  getWorksByAuthor(authorId) {
    return this.request("/works", { authorId });
  }
};

function setStatus(label, isError = false) {
  elements.status.textContent = label;
  elements.status.classList.toggle("error", isError);
}

function sourceLabel(source) {
  return source === "cache" ? "Cache" : source === "live" ? "Live API" : "No source";
}

function cleanId(value) {
  return String(value || "").trim().replace(/^https:\/\/openalex\.org\//i, "");
}

function cacheKey(prefix, value) {
  return `${prefix}:${String(value || "").trim().toLowerCase()}`;
}

async function cachedFetch(storeName, key, ttl, refresh, fetcher) {
  if (!refresh) {
    const cached = await db.get(storeName, key, ttl);
    if (cached) return { value: cached, source: "cache" };
  }
  const value = await fetcher();
  await db.set(storeName, key, value);
  return { value, source: "live" };
}

function authorInstitution(author) {
  return author.lastKnownInstitution?.displayName || author.institutions?.[0]?.displayName || "Not available";
}

function renderAuthors(authors, source) {
  elements.resultsSource.textContent = sourceLabel(source);
  if (!authors.length) {
    elements.resultsList.className = "results-list empty-state";
    elements.resultsList.textContent = "No likely author matches found.";
    return;
  }
  elements.resultsList.className = "results-list";
  elements.resultsList.innerHTML = authors.map((author, index) => `
    <article class="result-card">
      <div>
        <h3>${escapeHtml(author.displayName || "Unnamed author")}</h3>
        <div class="metadata-grid">
          ${metric("OpenAlex ID", author.id || "Not available")}
          ${metric("ORCID", author.orcid || "Not available")}
          ${metric("Works Count", formatNumber(author.worksCount))}
          ${metric("Citation Count", formatNumber(author.citedByCount))}
          ${metric("Institution", authorInstitution(author), "wide")}
        </div>
      </div>
      <div class="button-row">
        <button type="button" data-author-index="${index}">Analyze</button>
      </div>
    </article>
  `).join("");
  elements.resultsList.querySelectorAll("[data-author-index]").forEach((button) => {
    button.addEventListener("click", () => analyzeAuthor(authors[Number(button.dataset.authorIndex)]));
  });
}

function metric(label, value, className = "") {
  return `<div class="metric ${className}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value ?? "Not available"))}</strong></div>`;
}

function metricRaw(label, value, className = "") {
  return `<div class="metric ${className}"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
}

function renderProfile(author) {
  const profileUrl = author.id ? `https://openalex.org/${cleanId(author.id)}` : "";
  const safeProfileUrl = escapeHtml(profileUrl);
  elements.profileContent.innerHTML = [
    metric("Name", author.displayName || "Not available"),
    profileUrl ? metricRaw("OpenAlex Profile", `<a href="${safeProfileUrl}" target="_blank" rel="noreferrer">${safeProfileUrl}</a>`) : metric("OpenAlex Profile", "Not available"),
    metric("ORCID", author.orcid || "Not available"),
    metric("Works Count", formatNumber(author.worksCount)),
    metric("Citation Count", formatNumber(author.citedByCount))
  ].join("");
  elements.profileSection.classList.remove("hidden");
}

function renderDashboard(analysis, source) {
  elements.analysisSource.textContent = sourceLabel(source);
  elements.dashboardGrid.innerHTML = [
    metric("Works Analyzed", formatNumber(analysis.worksAnalyzed)),
    metric("Publication Year Range", analysis.yearRange),
    metric("Average Authors Per Paper", analysis.averageAuthors),
    metric("Signal Density", analysis.signalDensity),
    metric("Hyper-Authorship 25+", formatNumber(analysis.hyperAuthorship.over25)),
    metric("Hyper-Authorship 50+", formatNumber(analysis.hyperAuthorship.over50)),
    metric("Hyper-Authorship 100+", formatNumber(analysis.hyperAuthorship.over100)),
    metric("Affiliation Ambiguity", analysis.affiliationAmbiguity ? "Possible" : "Not prominent"),
    metric("Funding Complexity", analysis.fundingComplexity ? "Possible" : "Not prominent"),
    metric("Top Coauthors", listText(analysis.topCoauthors), "wide"),
    metric("Top Institutions", listText(analysis.topInstitutions), "wide"),
    metric("Top Countries", listText(analysis.topCountries), "wide"),
    metric("Top Concepts/Topics", listText(analysis.topConcepts), "wide"),
    metric("Collaboration Clusters", listText(analysis.collaborationClusters), "full"),
    metric("Signal Density Explanation", "Signal Density is a transparent bibliometric heuristic. It is NOT a risk score.", "full")
  ].join("");
  elements.dashboardSection.classList.remove("hidden");
}

function analyzeWorks(author, works) {
  const years = works.map((work) => work.publicationYear).filter(Boolean);
  const authorCounts = works.map((work) => work.authorships?.length || 0);
  const coauthors = new Map();
  const institutions = new Map();
  const countries = new Map();
  const concepts = new Map();
  const clusters = new Map();
  let ambiguousAffiliations = 0;
  let fundedWorks = 0;

  works.forEach((work) => {
    const authorNames = [];
    const workInstitutions = new Set();
    (work.authorships || []).forEach((authorship) => {
      const name = authorship.author?.displayName;
      const id = authorship.author?.id;
      if (id && cleanId(id) !== cleanId(author.id)) {
        increment(coauthors, name || id);
        if (name) authorNames.push(name);
      }
      const authorInstitutionNames = new Set();
      (authorship.institutions || []).filter(Boolean).forEach((institution) => {
        if (institution.displayName) {
          increment(institutions, institution.displayName);
          authorInstitutionNames.add(institution.displayName);
          workInstitutions.add(institution.displayName);
        }
        if (institution.countryCode) increment(countries, institution.countryCode);
      });
      if (authorInstitutionNames.size > 1) ambiguousAffiliations += 1;
    });
    (work.concepts || []).forEach((concept) => {
      if (concept.displayName) increment(concepts, concept.displayName);
    });
    if ((work.grants || []).length > 1 || (work.funders || []).length > 1) fundedWorks += 1;
    const clusterKey = Array.from(workInstitutions).sort().slice(0, 4).join(" + ");
    if (clusterKey) increment(clusters, clusterKey);
  });

  const hyper25 = authorCounts.filter((count) => count >= 25).length;
  const repeatedClusters = topEntries(clusters, 8).filter((entry) => entry.count > 1);
  const fundingComplexity = fundedWorks >= 2;
  const affiliationAmbiguity = ambiguousAffiliations >= 3;
  let signalPoints = 0;
  if (institutions.size >= 15) signalPoints += 1;
  if (countries.size >= 5) signalPoints += 1;
  if (works.length && hyper25 / works.length >= 0.25) signalPoints += 1;
  if (repeatedClusters.length > 0) signalPoints += 1;
  if (fundingComplexity) signalPoints += 1;

  return {
    worksAnalyzed: works.length,
    yearRange: years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "Not available",
    averageAuthors: authorCounts.length ? (authorCounts.reduce((sum, count) => sum + count, 0) / authorCounts.length).toFixed(1) : "0",
    hyperAuthorship: {
      over25: hyper25,
      over50: authorCounts.filter((count) => count >= 50).length,
      over100: authorCounts.filter((count) => count >= 100).length
    },
    topCoauthors: topEntries(coauthors, 10),
    topInstitutions: topEntries(institutions, 10),
    topCountries: topEntries(countries, 10),
    topConcepts: topEntries(concepts, 10),
    collaborationClusters: repeatedClusters,
    affiliationAmbiguity,
    fundingComplexity,
    signalDensity: signalPoints <= 1 ? "Low" : signalPoints <= 3 ? "Moderate" : "High",
    signalPoints
  };
}

function generateMemo(author, works, analysis) {
  const profileUrl = author.id ? `https://openalex.org/${cleanId(author.id)}` : "Not available";
  return `# PAPERTRAIL Bibliometric Triage Memo

## Subject
${author.displayName || "Not available"}

## OpenAlex profile
${profileUrl}

## Works analyzed
${analysis.worksAnalyzed} works covering ${analysis.yearRange}.

## Collaboration summary
Average authors per paper: ${analysis.averageAuthors}. Top observed collaboration patterns include ${listText(analysis.collaborationClusters)}.

## Hyper-authorship observations
25+ authors: ${analysis.hyperAuthorship.over25}
50+ authors: ${analysis.hyperAuthorship.over50}
100+ authors: ${analysis.hyperAuthorship.over100}

## Top collaborators
${markdownList(analysis.topCoauthors)}

## Institutions
${markdownList(analysis.topInstitutions)}

## Countries
${markdownList(analysis.topCountries)}

## Interpretation cautions
- This application surfaces bibliometric indicators requiring context.
- Co-authorship is not proof of direct collaboration.
- Large author lists can distort inferred relationships.
- Bibliometric metadata may contain incomplete affiliations or errors.
- This application is intended as a triage aid only.

## Suggested follow-up
- Review original publication records and author affiliation histories.
- Confirm ambiguous metadata against primary institutional or publication sources.
- Treat large-team publications differently from small-team collaborations.
- Document any manual interpretation separately from this generated memo.

## Signal Density explanation
Signal Density: ${analysis.signalDensity}. Signal Density is a transparent bibliometric heuristic. It is NOT a risk score.

## Non-determination statement
PAPERTRAIL does not determine misconduct, foreign influence, technology transfer, or security risk. This memo supports careful exploration of scholarly footprints and collaboration patterns only.
`;
}

async function performSearch(event) {
  event.preventDefault();
  const query = {
    name: elements.nameInput.value.trim(),
    orcid: elements.orcidInput.value.trim(),
    authorId: cleanId(elements.authorIdInput.value)
  };
  if (!query.name && !query.orcid && !query.authorId) {
    setStatus("Error", true);
    elements.resultsList.className = "results-list empty-state";
    elements.resultsList.textContent = "Enter a researcher name, ORCID, or OpenAlex Author ID.";
    return;
  }
  setBusy(true);
  setStatus("Loading...");
  try {
    const key = cacheKey("search", JSON.stringify(query));
    const result = await cachedFetch("searches", key, CACHE_TTL.searches, elements.refreshInput.checked, () => researchProvider.searchAuthors(query));
    setStatus(result.source === "cache" ? "Cache Hit" : "Live API");
    renderAuthors(result.value.authors || [], result.source);
  } catch (error) {
    setStatus("Error", true);
    elements.resultsList.className = "results-list empty-state";
    elements.resultsList.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function analyzeAuthor(authorSummary) {
  setBusy(true);
  setStatus("Loading...");
  try {
    const authorId = cleanId(authorSummary.id);
    const refresh = elements.refreshInput.checked;
    const authorResult = await cachedFetch("authors", cacheKey("author", authorId), CACHE_TTL.authors, refresh, () => researchProvider.getAuthor(authorId));
    const worksResult = await cachedFetch("works", cacheKey("works", authorId), CACHE_TTL.works, refresh, () => researchProvider.getWorksByAuthor(authorId));
    const author = authorResult.value.author || authorSummary;
    const works = worksResult.value.works || [];
    const analysis = analyzeWorks(author, works);
    const memo = generateMemo(author, works, analysis);

    state.author = author;
    state.works = works;
    state.analysis = analysis;
    state.memo = memo;
    state.exportData = { generatedAt: new Date().toISOString(), author, works, analysis, memo };

    renderProfile(author);
    renderDashboard(analysis, worksResult.source);
    elements.memoOutput.value = memo;
    elements.memoSection.classList.remove("hidden");
    setStatus(authorResult.source === "cache" && worksResult.source === "cache" ? "Cache Hit" : "Live API");
  } catch (error) {
    setStatus("Error", true);
    alert(error.message);
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = isBusy;
  });
}

function increment(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function topEntries(map, limit) {
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function listText(entries) {
  if (!entries || !entries.length) return "Not prominent";
  return entries.map((entry) => `${entry.name} (${entry.count})`).join("; ");
}

function markdownList(entries) {
  if (!entries || !entries.length) return "- Not prominent";
  return entries.map((entry) => `- ${entry.name} (${entry.count})`).join("\n");
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "Not available";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

elements.form.addEventListener("submit", performSearch);
elements.clearButton.addEventListener("click", () => {
  elements.form.reset();
  elements.resultsList.className = "results-list empty-state";
  elements.resultsList.textContent = "No search results yet.";
  elements.resultsSource.textContent = "No source";
  setStatus("Ready");
});
elements.clearCacheButton.addEventListener("click", async () => {
  await db.clear();
  setStatus("Cache Miss");
});
elements.copyMemoButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.memo);
  setStatus("Memo Copied");
});
elements.downloadMdButton.addEventListener("click", () => {
  downloadFile("papertrail-memo.md", state.memo, "text/markdown");
});
elements.downloadJsonButton.addEventListener("click", () => {
  downloadFile("papertrail-analysis.json", JSON.stringify(state.exportData, null, 2), "application/json");
});
