let currentAnalysis = null;

async function loadAnalysis() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const analysisId = urlParams.get("id");

    if (analysisId === "latest") {
      const { analyses = [] } = await chrome.storage.local.get("analyses");
      if (analyses.length === 0) {
        showError("No analysis found");
        return;
      }
      currentAnalysis = analyses[0];
    } else if (analysisId) {
      const { analyses = [] } = await chrome.storage.local.get("analyses");
      currentAnalysis = analyses.find((a) => a.timestamp === analysisId);
      if (!currentAnalysis) {
        showError("Analysis not found");
        return;
      }
    } else {
      showError("No analysis specified");
      return;
    }

    displayAnalysis(currentAnalysis);
  } catch (error) {
    console.error("Failed to load analysis:", error);
    showError("Failed to load analysis");
  }
}

function displayAnalysis(analysis) {
  // Update title
  document.getElementById("paperTitle").textContent = analysis.title;

  // Update sidebar stats
  document.getElementById(
    "confidenceScore"
  ).textContent = `${analysis.confidence}%`;
  document.getElementById("findingsCount").textContent =
    analysis.keyFindings.length;
  document.getElementById("gapsCount").textContent =
    analysis.researchGaps.length;
  // NEW: Update trajectories count
  document.getElementById("trajectoriesCount").textContent =
    analysis.trajectorySuggestions?.length || 0;

  // Update paper info
  const timestamp = new Date(analysis.timestamp);
  document.getElementById("analyzedTime").textContent =
    formatDateTime(timestamp);
  document.getElementById("paperSource").textContent = getSiteName(
    analysis.url
  );

  const originalLink = document.getElementById("originalLink");
  originalLink.href = analysis.url;

  // Update summary
  document.getElementById("summaryContent").textContent = analysis.summary;
  document.getElementById("summaryContent").classList.remove("loading-text");

  // Update key findings
  displayFindings(analysis.keyFindings);

  // Update methodology
  document.getElementById("methodologyContent").textContent =
    analysis.methodology;
  document
    .getElementById("methodologyContent")
    .classList.remove("loading-text");

  // Update research gaps
  displayGaps(analysis.researchGaps);

  // NEW: Update trajectory suggestions
  displayTrajectories(analysis.trajectorySuggestions || []);

  // Update page title
  document.title = `Analysis: ${analysis.title}`;
}

function displayFindings(findings) {
  const findingsList = document.getElementById("findingsList");
  const findingsBadge = document.getElementById("findingsBadge");

  findingsBadge.textContent = findings.length;
  findingsList.innerHTML = "";

  if (findings.length === 0) {
    findingsList.innerHTML =
      '<p class="loading-text">No key findings identified</p>';
    return;
  }

  findings.forEach((finding, index) => {
    const item = document.createElement("div");
    item.className = "finding-item";
    item.innerHTML = `
      <div class="finding-content">
        <span class="finding-number">${index + 1}</span>
        <p class="finding-text">${escapeHtml(finding)}</p>
      </div>
    `;
    findingsList.appendChild(item);
  });
}

function displayGaps(gaps) {
  const gapsList = document.getElementById("gapsList");
  const gapsBadge = document.getElementById("gapsBadge");

  gapsBadge.textContent = gaps.length;
  gapsList.innerHTML = "";

  if (gaps.length === 0) {
    gapsList.innerHTML =
      '<p class="loading-text">No research gaps identified</p>';
    return;
  }

  gaps.forEach((gap, index) => {
    const item = document.createElement("div");
    item.className = "gap-item";
    item.innerHTML = `
      <div class="gap-content">
        <span class="gap-number">${index + 1}</span>
        <p class="gap-text">${escapeHtml(gap)}</p>
      </div>
    `;
    gapsList.appendChild(item);
  });
}

// NEW FUNCTION: Display trajectory suggestions
function displayTrajectories(trajectories) {
  const trajectoriesList = document.getElementById("trajectoriesList");
  const trajectoriesBadge = document.getElementById("trajectoriesBadge");

  trajectoriesBadge.textContent = trajectories.length;
  trajectoriesList.innerHTML = "";

  if (trajectories.length === 0) {
    trajectoriesList.innerHTML =
      '<p class="loading-text">No trajectory suggestions generated</p>';
    return;
  }

  trajectories.forEach((trajectory, index) => {
    const item = document.createElement("div");
    item.className = "trajectory-item";
    item.innerHTML = `
      <div class="trajectory-content">
        <span class="trajectory-number">${index + 1}</span>
        <p class="trajectory-text">${escapeHtml(trajectory)}</p>
      </div>
    `;
    trajectoriesList.appendChild(item);
  });
}

function getSiteName(url) {
  if (url.includes("arxiv.org")) return "arXiv";
  if (url.includes("pubmed")) return "PubMed";
  if (url.includes("ieee")) return "IEEE Xplore";
  if (url.includes("scholar.google")) return "Google Scholar";
  return "Unknown";
}

function formatDateTime(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showError(message) {
  document.getElementById("paperTitle").textContent = "Error";
  document.querySelector(".results-main").innerHTML = `
    <div class="analysis-section">
      <div class="content-card">
        <p style="color: #ef4444; text-align: center; padding: 2rem;">
          ${escapeHtml(message)}
        </p>
      </div>
    </div>
  `;
}

// Export functionality
document.getElementById("exportBtn").addEventListener("click", () => {
  if (!currentAnalysis) return;

  try {
    generatePDF(currentAnalysis);
    showNotification("PDF exported successfully");
  } catch (error) {
    console.error("Failed to generate PDF:", error);
    showNotification("Failed to export PDF", true);
  }
});

function generatePDF(analysis) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const maxWidth = pageWidth - 2 * margin;
  let yPos = margin;

  function addText(text, fontSize, isBold = false, isCenter = false) {
    doc.setFontSize(fontSize);
    doc.setFont(undefined, isBold ? "bold" : "normal");
    const lines = doc.splitTextToSize(text, maxWidth);

    lines.forEach((line) => {
      if (yPos > pageHeight - margin) {
        doc.addPage();
        yPos = margin;
      }

      if (isCenter) {
        const textWidth = doc.getTextWidth(line);
        doc.text(line, (pageWidth - textWidth) / 2, yPos);
      } else {
        doc.text(line, margin, yPos);
      }

      yPos += fontSize * 0.5;
    });
  }

  function addSpacing(space = 10) {
    yPos += space;
    if (yPos > pageHeight - margin) {
      doc.addPage();
      yPos = margin;
    }
  }

  function addSeparator() {
    if (yPos > pageHeight - margin) {
      doc.addPage();
      yPos = margin;
    }
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 10;
  }

  // Title
  addText("RESEARCH PAPER ANALYSIS", 20, true, true);
  addSpacing(15);
  addSeparator();
  addSpacing(5);

  // Paper Title
  addText(analysis.title, 16, true);
  addSpacing(10);

  // Metadata
  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  doc.text(`URL: ${analysis.url}`, margin, yPos);
  yPos += 6;
  doc.text(
    `Analyzed: ${new Date(analysis.timestamp).toLocaleString()}`,
    margin,
    yPos
  );
  yPos += 6;
  doc.text(`Source: ${getSiteName(analysis.url)}`, margin, yPos);
  yPos += 6;
  doc.text(`Confidence Score: ${analysis.confidence}%`, margin, yPos);
  yPos += 6;

  addSpacing(10);
  addSeparator();
  addSpacing(5);

  // Summary Section
  addText("SUMMARY", 14, true);
  addSpacing(8);
  addText(analysis.summary, 10);
  addSpacing(15);
  addSeparator();
  addSpacing(5);

  // Key Findings Section
  addText("KEY FINDINGS", 14, true);
  addSpacing(8);

  if (analysis.keyFindings.length > 0) {
    analysis.keyFindings.forEach((finding, index) => {
      const numberedText = `${index + 1}. ${finding}`;
      addText(numberedText, 10);
      addSpacing(8);
    });
  } else {
    addText("No key findings identified", 10);
    addSpacing(8);
  }

  addSpacing(10);
  addSeparator();
  addSpacing(5);

  // Research Methodology Section
  addText("RESEARCH METHODOLOGY", 14, true);
  addSpacing(8);
  addText(analysis.methodology, 10);
  addSpacing(15);
  addSeparator();
  addSpacing(5);

  // Research Gaps Section
  addText("RESEARCH GAPS & LIMITATIONS", 14, true);
  addSpacing(8);

  if (analysis.researchGaps.length > 0) {
    analysis.researchGaps.forEach((gap, index) => {
      const numberedText = `${index + 1}. ${gap}`;
      addText(numberedText, 10);
      addSpacing(8);
    });
  } else {
    addText("No research gaps identified", 10);
    addSpacing(8);
  }

  addSpacing(10);
  addSeparator();
  addSpacing(5);

  // NEW: Trajectory Suggestions Section
  addText("RESEARCH TRAJECTORY & NEXT STEPS", 14, true);
  addSpacing(8);

  if (
    analysis.trajectorySuggestions &&
    analysis.trajectorySuggestions.length > 0
  ) {
    analysis.trajectorySuggestions.forEach((trajectory, index) => {
      const numberedText = `${index + 1}. ${trajectory}`;
      addText(numberedText, 10);
      addSpacing(8);
    });
  } else {
    addText("No trajectory suggestions generated", 10);
    addSpacing(8);
  }

  // Footer
  if (yPos > pageHeight - 40) {
    doc.addPage();
    yPos = margin;
  }
  yPos = pageHeight - 20;
  doc.setFontSize(8);
  doc.setTextColor(128, 128, 128);
  doc.text("Generated by Research Insights Chrome Extension", margin, yPos);

  // Save the PDF
  const safeTitle = analysis.title
    .replace(/[^a-z0-9]/gi, "-")
    .toLowerCase()
    .substring(0, 40);
  const date = new Date().toISOString().split("T")[0];
  const filename = `${safeTitle}-${date}.pdf`;
  doc.save(filename);
}

function showNotification(message, isError = false) {
  const notification = document.createElement("div");
  notification.textContent = message;

  Object.assign(notification.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    background: isError ? "#ef4444" : "#10b981",
    color: "white",
    padding: "12px 24px",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: "500",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
    zIndex: "1000",
    animation: "slideIn 0.3s ease",
  });

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = "slideOut 0.3s ease";
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "p") {
    e.preventDefault();
    window.print();
  }
  if (e.ctrlKey && e.key === "s") {
    e.preventDefault();
    document.getElementById("exportBtn").click();
  }
  if (e.key === "Escape") {
    window.close();
  }
});

// Add animations
const style = document.createElement("style");
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(400px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(400px); opacity: 0; }
  }
`;
document.head.appendChild(style);

// Initialize
loadAnalysis();
