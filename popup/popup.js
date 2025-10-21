// Modal Management
const modals = {
  settings: document.getElementById("settingsModal"),
  help: document.getElementById("helpModal"),
};

const settingsBtn = document.getElementById("settingsBtn");
const helpBtn = document.getElementById("helpBtn");
const analyzeBtn = document.getElementById("analyzeBtn");

const autoAnalyzeToggle = document.getElementById("autoAnalyze");
const summaryLengthSelect = document.getElementById("summaryLength");
const connectionDetectionToggle = document.getElementById(
  "connectionDetection"
);
const clearDataBtn = document.getElementById("clearDataBtn");

// State
let currentAnalysis = null;
let isAnalyzing = false;

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
      showNotification(
        "Chrome AI APIs not available. Some features may be limited.",
        "warning"
      );
    }
  } catch (error) {
    console.error("Failed to check API availability:", error);
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

    const detectionSection = document.querySelector(".page-detection");
    const detectionTitle = document.querySelector(".page-detection-title");
    const detectionSubtitle = document.querySelector(
      ".page-detection-subtitle"
    );

    if (response && response.detected) {
      detectionSection.style.display = "flex";
      detectionTitle.textContent = `${response.site} paper detected`;
      detectionSubtitle.textContent = "Ready to analyze this paper";
      analyzeBtn.disabled = false;
    } else {
      detectionSection.style.display = "flex";
      detectionSection.style.background =
        "linear-gradient(135deg, #fef3c7, #fde68a)";
      detectionSection.style.borderColor = "#f59e0b";
      detectionTitle.textContent = "No supported site detected";
      detectionSubtitle.textContent =
        "Visit arXiv, PubMed, IEEE, or Google Scholar";
      analyzeBtn.disabled = true;
    }
  } catch (error) {
    console.error("Failed to detect site:", error);
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

async function analyzePaper() {
  if (isAnalyzing) return;

  isAnalyzing = true;
  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML =
    '<span class="btn-icon">⏳</span><div class="btn-content"><span class="btn-text">Analyzing...</span></div>';

  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    // Extract paper content
    showNotification("Extracting paper content...", "info");
    const contentResponse = await chrome.tabs.sendMessage(tab.id, {
      action: "extractContent",
    });

    if (!contentResponse.success || !contentResponse.data) {
      throw new Error("Failed to extract paper content");
    }

    // Analyze with Chrome AI APIs
    showNotification("Analyzing with AI...", "info");
    const analysisResponse = await chrome.runtime.sendMessage({
      action: "analyzePaper",
      paperData: contentResponse.data,
    });

    if (!analysisResponse.success) {
      throw new Error(analysisResponse.error || "Analysis failed");
    }

    currentAnalysis = analysisResponse.data;

    // Update UI
    await loadStats();
    await loadLatestInsight();

    // Open results in popup window
    await openResultsWindow("latest");

    showNotification("Analysis complete! Opening results...", "success");
  } catch (error) {
    console.error("Analysis error:", error);
    showNotification(error.message || "Failed to analyze paper", "error");
  } finally {
    isAnalyzing = false;
    analyzeBtn.disabled = false;
    analyzeBtn.innerHTML =
      '<span class="btn-icon">🔍</span><div class="btn-content"><span class="btn-text">Analyze Current Page</span></div>';
  }
}

// View insights dashboard - open latest analysis
document
  .querySelector(".action-btn.secondary")
  .addEventListener("click", async () => {
    const { analyses = [] } = await chrome.storage.local.get("analyses");

    if (analyses.length === 0) {
      showNotification("No analyses yet. Analyze a paper first!", "warning");
      return;
    }

    await openResultsWindow("latest");
  });

async function loadStats() {
  try {
    const { analyses = [] } = await chrome.storage.local.get("analyses");

    const statNumbers = document.querySelectorAll(".stat-number");
    statNumbers[0].textContent = analyses.length; // Analyzed count

    // Calculate connections (simplified: papers with similar topics)
    const connections = Math.min(analyses.length * 0.5, analyses.length - 1);
    statNumbers[1].textContent = Math.floor(connections);

    // Average confidence
    if (analyses.length > 0) {
      const avgConfidence =
        analyses.reduce((sum, a) => sum + a.confidence, 0) / analyses.length;
      statNumbers[2].textContent = `${Math.round(avgConfidence)}%`;
    }
  } catch (error) {
    console.error("Failed to load stats:", error);
  }
}

async function loadLatestInsight() {
  try {
    const { analyses = [] } = await chrome.storage.local.get("analyses");

    if (analyses.length === 0) return;

    const latest = analyses[0];
    const insightItem = document.querySelector(".insight-item");
    const insightTitle = document.querySelector(".insight-title");
    const insightText = document.querySelector(".insight-text");
    const insightMeta = document.querySelector(".insight-meta");

    insightTitle.textContent = latest.title;
    insightText.textContent = latest.summary.slice(0, 150) + "...";

    const timestamp = new Date(latest.timestamp);
    const timeAgo = getTimeAgo(timestamp);
    insightMeta.innerHTML = `
      <span>📅 ${timeAgo}</span>
      <span>📈 ${latest.confidence}% confidence</span>
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

    autoAnalyzeToggle.checked = settings.autoAnalyze;
    summaryLengthSelect.value = settings.summaryLength;
    connectionDetectionToggle.checked = settings.connectionDetection;
  });
}

function saveSettings() {
  const settings = {
    autoAnalyze: autoAnalyzeToggle.checked,
    summaryLength: summaryLengthSelect.value,
    connectionDetection: connectionDetectionToggle.checked,
  };

  chrome.storage.local.set({ settings }, () => {
    showNotification("Settings saved successfully", "success");
  });
}

// Event Listeners
analyzeBtn.addEventListener("click", analyzePaper);
settingsBtn.addEventListener("click", () => openModal("settings"));
helpBtn.addEventListener("click", () => openModal("help"));

autoAnalyzeToggle.addEventListener("change", saveSettings);
summaryLengthSelect.addEventListener("change", saveSettings);
connectionDetectionToggle.addEventListener("change", saveSettings);

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
    "Are you sure you want to delete all analyzed papers and insights?\n\n" +
      "This action cannot be undone. Consider exporting your data first."
  );

  if (confirmed) {
    await chrome.storage.local.set({ analyses: [] });
    await loadStats();
    document.querySelector(".insight-title").textContent = "No analyses yet";
    document.querySelector(".insight-text").textContent =
      "Analyze your first paper to get started";
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

RESEARCH GAPS
${analysis.researchGaps.map((g, i) => `${i + 1}. ${g}`).join("\n")}
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
    if (!isAnalyzing && !analyzeBtn.disabled) {
      analyzePaper();
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

// Initialize on load
initializePopup();
