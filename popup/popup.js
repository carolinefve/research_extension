// Modal Management
const modals = {
  settings: document.getElementById("settingsModal"),
  export: document.getElementById("exportModal"),
  help: document.getElementById("helpModal"),
};

const settingsBtn = document.getElementById("settingsBtn");
const exportBtn = document.getElementById("exportBtn");
const helpBtn = document.getElementById("helpBtn");

const autoAnalyzeToggle = document.getElementById("autoAnalyze");
const summaryLengthSelect = document.getElementById("summaryLength");
const connectionDetectionToggle = document.getElementById(
  "connectionDetection"
);
const clearDataBtn = document.getElementById("clearDataBtn");

const exportPdfBtn = document.getElementById("exportPdfBtn");

const helpTabs = document.querySelectorAll(".help-tab");
const helpPanels = document.querySelectorAll(".help-panel");

function openModal(modalId) {
  const modal = modals[modalId];
  if (modal) {
    modal.classList.add("active");
  }
}

function closeModal(modal) {
  modal.classList.remove("active");
}

settingsBtn.addEventListener("click", () => openModal("settings"));
exportBtn.addEventListener("click", () => openModal("export"));
helpBtn.addEventListener("click", () => openModal("help"));

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

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    Object.values(modals).forEach((modal) => {
      if (modal.classList.contains("active")) {
        closeModal(modal);
      }
    });
  }
});

function saveSettings() {
  const settings = {
    autoAnalyze: autoAnalyzeToggle.checked,
    summaryLength: summaryLengthSelect.value,
    connectionDetection: connectionDetectionToggle.checked,
  };
  console.log("Settings saved:", settings);
  showNotification("Settings saved successfully", "success");
}

autoAnalyzeToggle.addEventListener("change", saveSettings);
summaryLengthSelect.addEventListener("change", saveSettings);
connectionDetectionToggle.addEventListener("change", saveSettings);

clearDataBtn.addEventListener("click", () => {
  const confirmed = confirm(
    "Are you sure you want to delete all analyzed papers and insights?\n\n" +
      "This action cannot be undone. Consider exporting your data first."
  );

  if (confirmed) {
    document.querySelectorAll(".stat-number").forEach((el) => {
      el.textContent = "0";
    });
    showNotification("All data cleared successfully", "success");
    closeModal(modals.settings);
  }
});

function formatDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

exportPdfBtn.addEventListener("click", async () => {
  exportPdfBtn.disabled = true;
  exportPdfBtn.innerHTML =
    '<span class="btn-icon">⏳</span><span class="btn-text">Generating PDF...</span>';

  await new Promise((resolve) => setTimeout(resolve, 1500));

  showNotification("PDF exported successfully!", "success");
  exportPdfBtn.innerHTML =
    '<span class="btn-icon">📄</span><span class="btn-text">Export as PDF</span>';
  exportPdfBtn.disabled = false;
});

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    showNotification("Starting paper analysis...", "info");
  }

  if (e.ctrlKey && e.key === "d") {
    e.preventDefault();
    showNotification("Opening insights dashboard...", "info");
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
      type === "success" ? "#10b981" : type === "error" ? "#ef4444" : "#3b82f6",
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

document.getElementById("analyzeBtn").addEventListener("click", () => {
  showNotification("Starting paper analysis...", "info");
});
