// Dashboard state
let allPapers = [];
let filteredPapers = [];
let currentSort = "recent";

// Initialize dashboard
async function initializeDashboard() {
  await loadPapers();
  updateStats();
  renderPapers();
  setupEventListeners();
}

// Load papers from storage
async function loadPapers() {
  try {
    const { analyses = [] } = await chrome.storage.local.get("analyses");
    allPapers = analyses;
    filteredPapers = [...allPapers];
    console.log("[Dashboard] Loaded", allPapers.length, "papers");
  } catch (error) {
    console.error("[Dashboard] Failed to load papers:", error);
    showNotification("Failed to load papers", "error");
  }
}

// Update statistics
function updateStats() {
  // Total papers
  document.getElementById("totalPapers").textContent = allPapers.length;

  // Total connections (divide by 2 since they're bidirectional)
  const totalConnections = allPapers.reduce((sum, paper) => {
    return sum + (paper.connections?.length || 0);
  }, 0);
  document.getElementById("totalConnections").textContent = Math.floor(
    totalConnections / 2
  );
}

// Render papers grid
function renderPapers() {
  const papersGrid = document.getElementById("papersGrid");
  const resultsCount = document.getElementById("resultsCount");

  if (filteredPapers.length === 0) {
    papersGrid.innerHTML = `
      <div class="empty-state">
        <h3>${
          allPapers.length === 0
            ? "No papers analysed yet"
            : "No papers match your filters"
        }</h3>
        <p>${
          allPapers.length === 0
            ? 'Visit arXiv, PubMed, or other supported sites and click "Analyse Paper" to get started'
            : "Try adjusting your search or filters to see more results"
        }</p>
      </div>
    `;
    resultsCount.textContent = "0 papers";
    return;
  }

  resultsCount.textContent = `${filteredPapers.length} ${
    filteredPapers.length === 1 ? "paper" : "papers"
  }`;

  papersGrid.innerHTML = filteredPapers
    .map((paper) => createPaperCard(paper))
    .join("");

  // Add click handlers
  document.querySelectorAll(".paper-card").forEach((card, index) => {
    card.addEventListener("click", (e) => {
      if (
        !e.target.closest(".connection-badge") &&
        !e.target.closest(".view-details-btn")
      ) {
        openPaperDetails(filteredPapers[index]);
      }
    });
  });

  document.querySelectorAll(".connection-badge").forEach((badge) => {
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      const paperId = e.currentTarget.dataset.paperId;
      const paper = filteredPapers.find((p) => p.timestamp === paperId);
      if (paper) {
        openConnectionModal(paper);
      }
    });
  });

  document.querySelectorAll(".view-details-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const paperId = e.currentTarget.dataset.paperId;
      const paper = filteredPapers.find((p) => p.timestamp === paperId);
      if (paper) {
        openPaperDetails(paper);
      }
    });
  });
}

// Create paper card HTML
function createPaperCard(paper) {
  const hasConnections = paper.connections && paper.connections.length > 0;
  const timestamp = new Date(paper.timestamp);
  const timeAgo = getTimeAgo(timestamp);

  return `
    <div class="paper-card ${
      hasConnections ? "has-connections" : ""
    }" data-paper-id="${paper.timestamp}">
      <div class="paper-header">
        <h3 class="paper-title">${escapeHtml(paper.title)}</h3>
      </div>
      <p class="paper-summary">${escapeHtml(paper.summary)}</p>
      <div class="paper-meta">
        <span class="meta-tag">${timeAgo}</span>
        <span class="meta-tag">${paper.keyFindings.length} findings</span>
      </div>
      <div class="paper-actions">
        ${
          hasConnections
            ? `
          <button class="connection-badge" data-paper-id="${paper.timestamp}">
            ${paper.connections.length} ${
                paper.connections.length === 1 ? "connection" : "connections"
              }
          </button>
        `
            : ""
        }
        <button class="view-details-btn" data-paper-id="${
          paper.timestamp
        }">View Details</button>
      </div>
    </div>
  `;
}

// Get site name from URL
function getSiteName(url) {
  if (url.includes("arxiv.org")) return "arXiv";
  if (url.includes("pubmed")) return "PubMed";
  if (url.includes("ieee")) return "IEEE";
  if (url.includes("scholar.google")) return "Scholar";
  return "Unknown";
}

// Get time ago string
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 604800)} weeks ago`;
  return date.toLocaleDateString();
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Convert markdown to HTML
function markdownToHtml(text) {
  if (!text) return "";

  // First escape HTML to prevent XSS
  let escaped = escapeHtml(text);

  // Convert bold text: **text** to <strong>text</strong>
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Split into lines and process
  const lines = escaped.split("\n");
  let inList = false;
  let result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines unless we're in a list
    if (line.length === 0) {
      if (inList) {
        result.push("</ul>");
        inList = false;
      }
      continue;
    }

    // Check if line starts with bullet point (*, -, or •)
    if (line.match(/^[*\-•]\s/)) {
      if (!inList) {
        result.push("<ul>");
        inList = true;
      }
      // Remove the bullet and wrap in <li>
      const content = line.replace(/^[*\-•]\s+/, "");
      result.push("<li>" + content + "</li>");
    } else {
      // Close list if we were in one
      if (inList) {
        result.push("</ul>");
        inList = false;
      }

      // Regular paragraph
      result.push("<p>" + line + "</p>");
    }
  }

  // Close any open list
  if (inList) {
    result.push("</ul>");
  }

  return result.join("");
}

// Open connection modal
function openConnectionModal(paper) {
  const modal = document.getElementById("connectionModal");
  const modalBody = document.getElementById("connectionModalBody");

  if (!paper.connections || paper.connections.length === 0) {
    modalBody.innerHTML =
      '<p style="text-align: center; color: var(--text-light);">No connections found for this paper.</p>';
    modal.classList.add("active");
    return;
  }

  // Sort connections by strength
  const sortedConnections = [...paper.connections].sort(
    (a, b) => b.strength - a.strength
  );

  modalBody.innerHTML = `
    <div class="connection-list">
      ${sortedConnections
        .map(
          (conn) => `
        <div class="connection-item">
          <div class="connection-item-header">
            <span class="connection-type-badge ${conn.type}">${conn.type}</span>
            <span class="connection-strength">Strength: ${
              conn.strength
            }/10</span>
          </div>
          <h4 class="connection-item-title">${escapeHtml(conn.paperTitle)}</h4>
          <p class="connection-description">${markdownToHtml(
            conn.description
          )}</p>
          <div class="connection-meta">
            Detected ${getTimeAgo(new Date(conn.detectedAt))}
          </div>
        </div>
      `
        )
        .join("")}
    </div>
  `;

  modal.classList.add("active");
}

// Open paper details modal - FIXED with markdown rendering
function openPaperDetails(paper) {
  const modal = document.getElementById("paperModal");
  const modalTitle = document.getElementById("paperModalTitle");
  const modalBody = document.getElementById("paperModalBody");

  modalTitle.textContent = paper.title;

  modalBody.innerHTML = `
    <div style="margin-bottom: 1.5rem;">
      <div style="display: flex; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap;">
        <span style="background: var(--bg-gray); padding: 0.5rem 1rem; border-radius: 0.5rem; font-size: 0.875rem;">
          🌐 Source: ${getSiteName(paper.url)}
        </span>
        <span style="background: var(--bg-gray); padding: 0.5rem 1rem; border-radius: 0.5rem; font-size: 0.875rem;">
          ${new Date(paper.timestamp).toLocaleDateString()}
        </span>
      </div>
      <a href="${
        paper.url
      }" target="_blank" style="color: var(--primary); text-decoration: none; font-weight: 500;">
        View Original Paper →
      </a>
    </div>

    <div style="margin-bottom: 2rem;">
      <h3 style="font-size: 1.125rem; margin-bottom: 0.75rem; color: var(--text);">📄 Summary</h3>
      <p style="line-height: 1.7; color: var(--text-light);">${markdownToHtml(
        paper.summary
      )}</p>
    </div>

    <div style="margin-bottom: 2rem;">
      <h3 style="font-size: 1.125rem; margin-bottom: 0.75rem; color: var(--text);">🎯 Key Findings</h3>
      <ol style="padding-left: 1.5rem; display: flex; flex-direction: column; gap: 0.5rem;">
        ${paper.keyFindings
          .map(
            (finding) => `
          <li style="line-height: 1.6; color: var(--text-light);">${markdownToHtml(
            finding
          )}</li>
        `
          )
          .join("")}
      </ol>
    </div>

    <div style="margin-bottom: 2rem;">
      <h3 style="font-size: 1.125rem; margin-bottom: 0.75rem; color: var(--text);">🔬 Methodology</h3>
      <p style="line-height: 1.7; color: var(--text-light);">${markdownToHtml(
        paper.methodology
      )}</p>
    </div>

    <div style="margin-bottom: 2rem;">
      <h3 style="font-size: 1.125rem; margin-bottom: 0.75rem; color: var(--text);">💡 Research Gaps</h3>
      <ol style="padding-left: 1.5rem; display: flex; flex-direction: column; gap: 0.5rem;">
        ${paper.researchGaps
          .map(
            (gap) => `
          <li style="line-height: 1.6; color: var(--text-light);">${markdownToHtml(
            gap
          )}</li>
        `
          )
          .join("")}
      </ol>
    </div>

    ${
      paper.trajectorySuggestions && paper.trajectorySuggestions.length > 0
        ? `
      <div style="margin-bottom: 2rem;">
        <h3 style="font-size: 1.125rem; margin-bottom: 0.75rem; color: var(--text);">🚀 Research Future & Next Steps</h3>
        <ol style="padding-left: 1.5rem; display: flex; flex-direction: column; gap: 0.5rem;">
          ${paper.trajectorySuggestions
            .map(
              (traj) => `
            <li style="line-height: 1.6; color: var(--text-light);">${markdownToHtml(
              traj
            )}</li>
          `
            )
            .join("")}
        </ol>
      </div>
    `
        : ""
    }

    ${
      paper.connections && paper.connections.length > 0
        ? `
      <div>
        <h3 style="font-size: 1.125rem; margin-bottom: 0.75rem; color: var(--text);">Connections</h3>
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
          ${paper.connections
            .map(
              (conn) => `
            <div style="background: var(--bg-gray); padding: 1rem; border-radius: 0.5rem; border-left: 4px solid var(--primary);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <span class="connection-type-badge ${conn.type}">${
                conn.type
              }</span>
                <span style="font-size: 0.75rem; color: var(--text-light);">Strength: ${
                  conn.strength
                }/10</span>
              </div>
              <h4 style="font-size: 0.938rem; font-weight: 600; margin-bottom: 0.5rem;">${escapeHtml(
                conn.paperTitle
              )}</h4>
              <p style="font-size: 0.875rem; color: var(--text-light); line-height: 1.5;">${markdownToHtml(
                conn.description
              )}</p>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    `
        : ""
    }
  `;

  modal.classList.add("active");
}

// Setup event listeners
function setupEventListeners() {
  // Search
  const searchInput = document.getElementById("searchInput");
  const clearSearch = document.getElementById("clearSearch");

  searchInput.addEventListener("input", (e) => {
    const query = e.target.value.trim();
    clearSearch.style.display = query ? "flex" : "none";
    applyFilters();
  });

  clearSearch.addEventListener("click", () => {
    searchInput.value = "";
    clearSearch.style.display = "none";
    applyFilters();
  });

  // Filters
  document.getElementById("sortSelect").addEventListener("change", (e) => {
    currentSort = e.target.value;
    applyFilters();
  });

  document
    .getElementById("connectionFilter")
    .addEventListener("change", applyFilters);

  // Modal close buttons
  document.querySelectorAll(".modal-close").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".modal").classList.remove("active");
    });
  });

  // Close modal on backdrop click
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.classList.remove("active");
      }
    });
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal.active").forEach((modal) => {
        modal.classList.remove("active");
      });
    }
    if (e.ctrlKey && e.key === "f") {
      e.preventDefault();
      searchInput.focus();
    }
  });
}

// Apply filters and search
function applyFilters() {
  const searchQuery = document
    .getElementById("searchInput")
    .value.toLowerCase()
    .trim();
  const connectionFilter = document.getElementById("connectionFilter").value;

  // Start with all papers
  filteredPapers = [...allPapers];

  // Apply search
  if (searchQuery) {
    filteredPapers = filteredPapers.filter((paper) => {
      return (
        paper.title.toLowerCase().includes(searchQuery) ||
        paper.summary.toLowerCase().includes(searchQuery) ||
        paper.methodology.toLowerCase().includes(searchQuery) ||
        paper.keyFindings.some((f) => f.toLowerCase().includes(searchQuery)) ||
        paper.researchGaps.some((g) => g.toLowerCase().includes(searchQuery))
      );
    });
  }

  // Apply connection filter
  if (connectionFilter === "connected") {
    filteredPapers = filteredPapers.filter(
      (paper) => paper.connections && paper.connections.length > 0
    );
  } else if (connectionFilter === "isolated") {
    filteredPapers = filteredPapers.filter(
      (paper) => !paper.connections || paper.connections.length === 0
    );
  }

  // Apply sorting
  switch (currentSort) {
    case "recent":
      filteredPapers.sort(
        (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
      );
      break;
    case "oldest":
      filteredPapers.sort(
        (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
      );
      break;
    case "connections":
      filteredPapers.sort((a, b) => {
        const aConns = a.connections?.length || 0;
        const bConns = b.connections?.length || 0;
        return bConns - aConns;
      });
      break;
  }

  renderPapers();
}

// Show notification
function showNotification(message, type = "info") {
  const notification = document.createElement("div");
  notification.textContent = message;

  const colors = {
    success: "#10b981",
    error: "#ef4444",
    warning: "#f59e0b",
    info: "#3b82f6",
  };

  Object.assign(notification.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    background: colors[type],
    color: "white",
    padding: "12px 24px",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: "500",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
    zIndex: "10000",
    animation: "slideInRight 0.3s ease",
  });

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = "slideOutRight 0.3s ease";
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Initialize on load
initializeDashboard();
