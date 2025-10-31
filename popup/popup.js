// Modal Management
const modals = {
  settings: document.getElementById("settingsModal"),
  help: document.getElementById("helpModal"),
};

const settingsBtn = document.getElementById("settingsBtn");
const helpBtn = document.getElementById("helpBtn");
const analyseBtn = document.getElementById("analyseBtn");

const summaryLengthSelect = document.getElementById("summaryLength");
const connectionDetectionToggle = document.getElementById(
  "connectionDetection"
);
const autoAnalyseToggle = document.getElementById("autoAnalyse");
const clearDataBtn = document.getElementById("clearDataBtn");

// State
let currentAnalysis = null;
let isAnalysing = false;

// Status indicator elements
const statusDot = document.querySelector(".status-dot");
const statusText = document.querySelector(".status-text");

// Status management functions
function setStatus(status, text) {
  // Remove all status classes
  statusDot.classList.remove("ready", "limited", "error");

  // Add new status class
  statusDot.classList.add(status);

  // Update text
  statusText.textContent = text;
}

// Initialize popup
async function initializePopup() {
  await checkSiteDetection();
  await loadStats();
  await loadLatestInsight();
  await checkAPIAvailability();
  loadSettings();
}

async function checkAPIAvailability() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: "checkAPIAvailability",
    });

    if (!response.available) {
      setStatus("limited", "Limited");
      showNotification(
        "Chrome AI APIs not available. Some features may be limited.",
        "warning"
      );
    } else {
      setStatus("ready", "Ready");
    }
  } catch (error) {
    console.error("Failed to check API availability:", error);
    setStatus("error", "Error");
  }
}

async function checkSiteDetection() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: "detectSite",
    });

    // Simply enable/disable the analyse button based on detection
    if (response && response.detected) {
      analyseBtn.disabled = false;
      console.log(`[NovaMind] Detected ${response.site} paper`);
    } else {
      analyseBtn.disabled = true;
      console.log("[NovaMind] No supported site detected");
    }
  } catch (error) {
    console.error("Failed to detect site:", error);
    // Don't disable button on error - might just be wrong page type
    analyseBtn.disabled = false;
  }
}

// Helper function to open results in popup window
async function openResultsWindow(analysisId = "latest") {
  try {
    // Get current window to position the popup relative to it
    const currentWindow = await chrome.windows.getCurrent();

    // Calculate position (offset from current window)
    const left = currentWindow.left + 100;
    const top = currentWindow.top + 50;

    await chrome.windows.create({
      url: chrome.runtime.getURL(`results/results.html?id=${analysisId}`),
      type: "popup",
      width: 1000,
      height: 800,
      left: left,
      top: top,
    });
  } catch (error) {
    console.error("Failed to open results window:", error);
    showNotification("Failed to open results window", "error");
  }
}

// NEW: Check if paper already exists
async function checkForDuplicate(paperUrl) {
  const { analyses = [] } = await chrome.storage.local.get("analyses");
  return analyses.find((analysis) => analysis.url === paperUrl);
}

async function analysePaper() {
  if (isAnalysing) return;

  try {
    // Get current tab and extract content first to check for duplicates
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    // Check if it's a PDF URL
    if (tab.url.toLowerCase().includes(".pdf") || tab.url.includes("/pdf/")) {
      showNotification(
        "Extracting text from PDF... This may take a moment.",
        "info"
      );
    }

    const contentResponse = await chrome.tabs.sendMessage(tab.id, {
      action: "extractContent",
    });

    if (!contentResponse.success || !contentResponse.data) {
      throw new Error("Failed to extract paper content");
    }

    // Check if extraction was successful for PDF
    if (contentResponse.data.extractedFromPDF === false) {
      showNotification(
        "PDF extraction failed. Try downloading and opening the HTML version.",
        "warning"
      );
    }

    // NEW: Check for duplicate and automatically show existing analysis
    const existingPaper = await checkForDuplicate(contentResponse.data.url);

    if (existingPaper) {
      console.log("[NovaMind] Found existing analysis for this paper");

      // Automatically open the existing analysis (no notification)
      await openResultsWindow(existingPaper.timestamp);
      return;
    }

    // Continue with analysis for new papers
    isAnalysing = true;
    analyseBtn.disabled = true;
    updateAnalysisProgress(0);

    // Start polling for progress updates from storage
    const progressInterval = setInterval(async () => {
      try {
        const { analysisProgress } = await chrome.storage.local.get(
          "analysisProgress"
        );
        if (analysisProgress !== undefined && isAnalysing) {
          updateAnalysisProgress(analysisProgress);
        }
      } catch (error) {
        // Ignore errors
      }
    }, 100); // Poll every 100ms for smooth progress updates

    try {
      // Analyse with Chrome AI APIs
      updateAnalysisProgress(15);
      const analysisResponse = await chrome.runtime.sendMessage({
        action: "analysePaper",
        paperData: contentResponse.data,
      });

      if (!analysisResponse.success) {
        throw new Error(analysisResponse.error || "Analysis failed");
      }

      currentAnalysis = analysisResponse.data;

      // Update UI
      updateAnalysisProgress(100);
      await loadStats();
      await loadLatestInsight();

      // Clear progress from storage
      await chrome.storage.local.remove("analysisProgress");

      // Restore ready status
      setStatus("ready", "Ready");

      // Open results in popup window
      await openResultsWindow("latest");
    } catch (error) {
      console.error("Analysis error:", error);
      setStatus("error", "Error");
      showNotification(error.message || "Failed to analyse paper", "error");

      // Reset to ready status after 3 seconds
      setTimeout(async () => {
        await checkAPIAvailability();
      }, 3000);
    } finally {
      // Stop polling for progress updates
      clearInterval(progressInterval);

      isAnalysing = false;
      analyseBtn.disabled = false;
      analyseBtn.innerHTML =
        '<div class="btn-content"><span class="btn-text">Analyse Current Page</span></div>';
    }
  } catch (error) {
    console.error("Pre-analysis error:", error);
    showNotification(error.message || "Failed to start analysis", "error");
  }
}

function updateAnalysisProgress(percentage) {
  analyseBtn.innerHTML = `<span class="btn-icon">${percentage}%</span><div class="btn-content"><span class="btn-text">Analysing...</span></div>`;
}

// View insights dashboard - open in new tab
document
  .querySelector(".action-btn.secondary")
  .addEventListener("click", async () => {
    // Open dashboard in a new tab
    await chrome.tabs.create({
      url: chrome.runtime.getURL("dashboard/dashboard.html"),
    });
  });

async function loadStats() {
  try {
    const { analyses = [] } = await chrome.storage.local.get("analyses");

    const statNumbers = document.querySelectorAll(".stat-number");
    statNumbers[0].textContent = analyses.length; // Analysed count

    // Calculate connections (count all connections)
    const totalConnections = analyses.reduce((sum, paper) => {
      return sum + (paper.connections?.length || 0);
    }, 0);
    // Divide by 2 because connections are bidirectional
    statNumbers[1].textContent = Math.floor(totalConnections / 2);
  } catch (error) {
    console.error("Failed to load stats:", error);
  }
}

async function loadLatestInsight() {
  try {
    const { analyses = [] } = await chrome.storage.local.get("analyses");

    const insightItem = document.querySelector(".insight-item");
    const insightTitle = document.querySelector(".insight-title");
    const insightText = document.querySelector(".insight-text");

    // If no analyses, show empty state
    if (analyses.length === 0) {
      insightTitle.textContent = "No analyses yet";
      insightText.textContent = "Analyse your first paper to get started";
      insightItem.style.cursor = "default";
      return;
    }

    // Show latest analysis
    const latest = analyses[0];

    insightTitle.textContent = latest.title;
    insightText.textContent = latest.summary.slice(0, 150) + "...";

    // Add/update connection badge
    let connectionBadge = document.querySelector(".connection-badge");
    if (!connectionBadge) {
      connectionBadge = document.createElement("span");
      connectionBadge.className = "connection-badge";
      document.querySelector(".insight-header").appendChild(connectionBadge);
    }
    const connectionCount = latest.connections?.length || 0;
    connectionBadge.textContent = connectionCount;

    // Add/update meta info
    let insightMeta = document.querySelector(".insight-meta");
    if (!insightMeta) {
      insightMeta = document.createElement("div");
      insightMeta.className = "insight-meta";
      insightItem.appendChild(insightMeta);
    }
    const timestamp = new Date(latest.timestamp);
    const timeAgo = getTimeAgo(timestamp);
    insightMeta.innerHTML = `
      <span>${timeAgo}</span>
    `;

    // Make insight clickable to open results
    insightItem.style.cursor = "pointer";
    insightItem.addEventListener("click", async () => {
      await openResultsWindow("latest");
    });
  } catch (error) {
    console.error("Failed to load latest insight:", error);
  }
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

// Modal Functions
function openModal(modalId) {
  const modal = modals[modalId];
  if (modal) {
    modal.classList.add("active");
  }
}

function closeModal(modal) {
  modal.classList.remove("active");
}

// Settings
function loadSettings() {
  chrome.storage.local.get(["settings"], (result) => {
    const settings = result.settings || {
      autoAnalyze: true,
      summaryLength: "medium",
      connectionDetection: true,
    };

    autoAnalyseToggle.checked = settings.autoAnalyse;
    summaryLengthSelect.value = settings.summaryLength;
    connectionDetectionToggle.checked = settings.connectionDetection;
  });
}

function saveSettings() {
  const settings = {
    autoAnalyze: autoAnalyseToggle.checked,
    summaryLength: summaryLengthSelect.value,
    connectionDetection: connectionDetectionToggle.checked,
  };

  chrome.storage.local.set({ settings }, () => {
    showNotification("Settings saved successfully", "success");
  });
}

// Event Listeners
analyseBtn.addEventListener("click", analysePaper);
settingsBtn.addEventListener("click", () => openModal("settings"));
helpBtn.addEventListener("click", () => openModal("help"));

summaryLengthSelect.addEventListener("change", saveSettings);
connectionDetectionToggle.addEventListener("change", saveSettings);
autoAnalyseToggle.addEventListener("change", saveSettings); // This is the corrected line

document.querySelectorAll(".modal-close").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const modal = e.target.closest(".modal");
    closeModal(modal);
  });
});

Object.values(modals).forEach((modal) => {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeModal(modal);
    }
  });
});

clearDataBtn.addEventListener("click", async () => {
  const confirmed = confirm(
    "Are you sure you want to delete all analysed papers and insights?\n\n" +
      "This action cannot be undone. Consider exporting your data first."
  );

  if (confirmed) {
    await chrome.storage.local.set({ analyses: [] });
    await loadStats();
    document.querySelector(".insight-title").textContent = "No analyses yet";
    document.querySelector(".insight-text").textContent =
      "Analyse your first paper to get started";
    showNotification("All data cleared successfully", "success");
    closeModal(modals.settings);
  }
});

function formatAnalysisForExport(analysis) {
  return `
Research Paper Analysis
Generated: ${new Date(analysis.timestamp).toLocaleString()}
Confidence: ${analysis.confidence}%

Title: ${analysis.title}
URL: ${analysis.url}

SUMMARY
${analysis.summary}

KEY FINDINGS
${analysis.keyFindings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

METHODOLOGY
${analysis.methodology}

RESEARCH GAPS & LIMITATIONS
${analysis.researchGaps.map((g, i) => `${i + 1}. ${g}`).join("\n")}

RESEARCH TRAJECTORY & NEXT STEPS
${
  analysis.trajectorySuggestions && analysis.trajectorySuggestions.length > 0
    ? analysis.trajectorySuggestions.map((t, i) => `${i + 1}. ${t}`).join("\n")
    : "No trajectory suggestions generated"
}

CONNECTIONS
${
  analysis.connections && analysis.connections.length > 0
    ? analysis.connections
        .map(
          (c, i) =>
            `${i + 1}. ${c.paperTitle} (${c.type}, strength: ${
              c.strength
            }/10)\n   ${c.description}`
        )
        .join("\n\n")
    : "No connections found"
}
  `.trim();
}

function downloadAsText(content, filename) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    Object.values(modals).forEach((modal) => {
      if (modal.classList.contains("active")) {
        closeModal(modal);
      }
    });
  }

  if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    if (!isAnalysing && !analyseBtn.disabled) {
      analysePaper();
    }
  }

  if (e.ctrlKey && e.key === "e") {
    e.preventDefault();
    openModal("export");
  }
});

function showNotification(message, type = "info") {
  const existing = document.querySelector(".notification");
  if (existing) existing.remove();

  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.textContent = message;

  Object.assign(notification.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    padding: "12px 20px",
    borderRadius: "8px",
    backgroundColor:
      type === "success"
        ? "#10b981"
        : type === "error"
        ? "#ef4444"
        : type === "warning"
        ? "#f59e0b"
        : "#3b82f6",
    color: "white",
    fontSize: "14px",
    fontWeight: "500",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
    zIndex: "10000",
    animation: "slideInRight 0.3s ease",
    maxWidth: "300px",
  });

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = "slideOutRight 0.3s ease";
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Listen for progress updates from background script
// Note: We primarily use storage polling (in analysePaper function) for reliable updates,
// but keep this listener as a backup in case direct messaging works
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analysisProgress" && isAnalysing) {
    updateAnalysisProgress(request.progress);
  }
});

// Initialize on load
initializePopup();
