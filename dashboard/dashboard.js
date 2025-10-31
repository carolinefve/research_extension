// Dashboard state
let allPapers = [];
let filteredPapers = [];
let currentSort = "recent";
let allHighlights = [];

// Initialize dashboard
async function initializeDashboard() {
  await loadPapers();
  await loadHighlights();
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

// Load highlights from storage
async function loadHighlights() {
  try {
    const { highlights = [] } = await chrome.storage.local.get("highlights");
    allHighlights = highlights;
    console.log("[Dashboard] Loaded", allHighlights.length, "highlights");
  } catch (error) {
    console.error("[Dashboard] Failed to load highlights:", error);
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
        openResultsWindow(filteredPapers[index].timestamp);
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
      openResultsWindow(paperId);
    });
  });
}

// Helper function to open results in popup window (same as popup.js)
async function openResultsWindow(analysisId) {
  try {
    await chrome.windows.create({
      url: chrome.runtime.getURL(`results/results.html?id=${analysisId}`),
      type: "popup",
      width: 1000,
      height: 800,
    });
  } catch (error) {
    console.error("Failed to open results window:", error);
    showNotification("Failed to open results window", "error");
  }
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

  if (url.includes("ieee")) return "IEEE";
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

// Open connection modal (kept for connection badge quick view)
function openConnectionModal(paper) {
  const modal = document.getElementById("connectionModal");
  const modalBody = document.getElementById("connectionModalBody");

  if (!paper.connections || paper.connections.length === 0) {
    modalBody.innerHTML =
      '<p style="text-align: center; color: var(--text-light);">No connections found for this paper.</p>';
    modal.classList.add("active");
    return;
  }

  // NEW: Sort connections by when they were detected (newest first)
  const sortedConnections = [...paper.connections].sort(
    (a, b) => new Date(b.detectedAt) - new Date(a.detectedAt)
  );

  modalBody.innerHTML = `
    <div class="connection-list">
      ${sortedConnections
        .map(
          (conn) => `
        <div class="connection-item">
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

// Render highlights panel
function renderHighlightsPanel() {
  const panelBody = document.getElementById("highlightsPanelBody");

  if (allHighlights.length === 0) {
    panelBody.innerHTML = `
      <div class="empty-state-small">
        <p>No highlights saved yet</p>
        <p class="hint">Select text on a research paper and choose "Save Highlight" from the context menu</p>
      </div>
    `;
    return;
  }

  // Group highlights by paper URL
  const groupedHighlights = {};
  allHighlights.forEach((highlight) => {
    const key = highlight.paperUrl;
    if (!groupedHighlights[key]) {
      groupedHighlights[key] = {
        paperTitle: highlight.paperTitle,
        paperUrl: highlight.paperUrl,
        highlights: [],
      };
    }
    groupedHighlights[key].highlights.push(highlight);
  });

  // Convert to array and sort by most recent highlight
  const groups = Object.values(groupedHighlights).sort((a, b) => {
    const aLatest = Math.max(...a.highlights.map((h) => new Date(h.timestamp)));
    const bLatest = Math.max(...b.highlights.map((h) => new Date(h.timestamp)));
    return bLatest - aLatest;
  });

  panelBody.innerHTML = groups
    .map(
      (group) => `
    <div class="highlight-group" data-paper-url="${escapeHtml(group.paperUrl)}">
      <div class="highlight-group-header">
        <div class="highlight-group-title">${escapeHtml(group.paperTitle)}</div>
        <div class="highlight-count-badge">${
          group.highlights.length
        } highlight${group.highlights.length > 1 ? "s" : ""}</div>
      </div>
      <div class="highlight-preview">${escapeHtml(
        group.highlights[0].text.substring(0, 100)
      )}${group.highlights[0].text.length > 100 ? "..." : ""}</div>
      <div class="highlight-group-meta">
        Last added ${getTimeAgo(
          new Date(
            Math.max(...group.highlights.map((h) => new Date(h.timestamp)))
          )
        )}
      </div>
    </div>
  `
    )
    .join("");

  // Add click handlers to groups
  document.querySelectorAll(".highlight-group").forEach((group) => {
    group.addEventListener("click", () => {
      const paperUrl = group.dataset.paperUrl;
      openHighlightsModal(paperUrl);
    });
  });
}

// NEW: Open highlights detail modal
function openHighlightsModal(paperUrl) {
  const modal = document.getElementById("highlightsModal");
  const modalTitle = document.getElementById("highlightsModalTitle");
  const modalBody = document.getElementById("highlightsModalBody");

  // Find highlights for this paper
  const paperHighlights = allHighlights.filter((h) => h.paperUrl === paperUrl);

  if (paperHighlights.length === 0) {
    modalBody.innerHTML =
      '<p style="text-align: center; color: var(--text-light);">No highlights found.</p>';
    modal.classList.add("active");
    return;
  }

  // Sort by timestamp (newest first)
  const sortedHighlights = [...paperHighlights].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  modalTitle.textContent = `Highlights: ${sortedHighlights[0].paperTitle}`;

  modalBody.innerHTML = sortedHighlights
    .map(
      (highlight) => `
    <div class="highlight-item" data-highlight-id="${highlight.id}">
      <div class="highlight-text">${escapeHtml(highlight.text)}</div>
      <div class="highlight-meta">
        <span>Saved ${getTimeAgo(new Date(highlight.timestamp))}</span>
        <div class="highlight-actions">
          <button class="delete-highlight-btn" data-highlight-id="${
            highlight.id
          }">Delete</button>
        </div>
      </div>
    </div>
  `
    )
    .join("");

  // Add delete handlers
  modalBody.querySelectorAll(".delete-highlight-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const highlightId = btn.dataset.highlightId;
      await deleteHighlight(highlightId);

      // Reload and re-render
      await loadHighlights();
      renderHighlightsPanel();

      // If no more highlights for this paper, close modal
      const remainingHighlights = allHighlights.filter(
        (h) => h.paperUrl === paperUrl
      );
      if (remainingHighlights.length === 0) {
        modal.classList.remove("active");
      } else {
        // Re-render modal with updated highlights
        openHighlightsModal(paperUrl);
      }
    });
  });

  modal.classList.add("active");
}

// NEW: Delete a highlight
async function deleteHighlight(highlightId) {
  try {
    const { highlights = [] } = await chrome.storage.local.get("highlights");
    const updatedHighlights = highlights.filter((h) => h.id !== highlightId);
    await chrome.storage.local.set({ highlights: updatedHighlights });
    showNotification("Highlight deleted", "success");
  } catch (error) {
    console.error("[Dashboard] Failed to delete highlight:", error);
    showNotification("Failed to delete highlight", "error");
  }
}

// NEW: Toggle highlights panel
function toggleHighlightsPanel() {
  const panel = document.getElementById("highlightsPanel");
  const backdrop = document.getElementById("panelBackdrop");
  const mainContent = document.querySelector(".main-content");

  const isActive = panel.classList.contains("active");

  if (isActive) {
    panel.classList.remove("active");
    backdrop.classList.remove("active");
    mainContent.classList.remove("panel-open");
  } else {
    panel.classList.add("active");
    backdrop.classList.add("active");
    mainContent.classList.add("panel-open");
    renderHighlightsPanel();
  }
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

  // Highlights button
  document.getElementById("highlightsBtn").addEventListener("click", () => {
    toggleHighlightsPanel();
  });

  // NEW: Close panel button
  document.getElementById("closePanelBtn").addEventListener("click", () => {
    toggleHighlightsPanel();
  });

  // NEW: Panel backdrop click
  document.getElementById("panelBackdrop").addEventListener("click", () => {
    toggleHighlightsPanel();
  });

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
      // Close modals
      document.querySelectorAll(".modal.active").forEach((modal) => {
        modal.classList.remove("active");
      });
      // Close highlights panel
      const panel = document.getElementById("highlightsPanel");
      if (panel.classList.contains("active")) {
        toggleHighlightsPanel();
      }
    }
    if (e.ctrlKey && e.key === "f") {
      e.preventDefault();
      searchInput.focus();
    }
    // Ctrl+H to toggle highlights
    if (e.ctrlKey && e.key === "h") {
      e.preventDefault();
      toggleHighlightsPanel();
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
