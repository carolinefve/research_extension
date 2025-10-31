let currentMode = null;
let selectedText = null;

// Initialize on load
async function initialize() {
  try {
    // Get stored data
    const { assistantMode, assistantText, assistantTimestamp } =
      await chrome.storage.local.get([
        "assistantMode",
        "assistantText",
        "assistantTimestamp",
      ]);

    if (!assistantMode || !assistantText) {
      showError("No data found. Please try again.");
      return;
    }

    // Check if data is recent (within 1 minute)
    const now = Date.now();
    if (now - assistantTimestamp > 60000) {
      showError("Session expired. Please try again.");
      return;
    }

    currentMode = assistantMode;
    selectedText = assistantText;

    // Update UI based on mode
    updateUIForMode();

    // Display selected text
    document.getElementById("selectedText").textContent = selectedText;
    document.getElementById("selectedText").classList.remove("loading-text");

    // Auto-process for Simplify and Explain modes
    if (currentMode === "simplify-text" || currentMode === "explain-text") {
      await processRequest();
    }
  } catch (error) {
    console.error("Initialize error:", error);
    showError("Failed to load assistant. Please try again.");
  }
}

function updateUIForMode() {
  const modeTitle = document.getElementById("modeTitle");
  const questionSection = document.getElementById("questionSection");
  const submitButton = document.getElementById("submitQuestion");

  switch (currentMode) {
    case "simplify-text":
      modeTitle.textContent = "Simplify Text";
      document.title = "Simplify Text - NovaMind";
      break;
    case "explain-text":
      modeTitle.textContent = "Explain Text";
      document.title = "Explain Text - NovaMind";
      break;
    case "ask-question":
      modeTitle.textContent = "Ask a Question";
      document.title = "Ask a Question - NovaMind";
      questionSection.style.display = "block";

      // Hide loading for Ask mode (wait for user input)
      document.getElementById("loadingState").style.display = "none";
      document.getElementById("resultContent").style.display = "block";
      document.getElementById("resultContent").innerHTML =
        '<p class="loading-text">Enter your question above and click "Get Answer"</p>';

      // Setup submit button
      submitButton.addEventListener("click", processRequest);

      // Allow Enter key to submit
      document
        .getElementById("questionInput")
        .addEventListener("keydown", (e) => {
          if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            processRequest();
          }
        });
      break;
  }
}

async function processRequest() {
  const loadingState = document.getElementById("loadingState");
  const resultContent = document.getElementById("resultContent");
  const submitButton = document.getElementById("submitQuestion");

  // Show loading
  loadingState.style.display = "flex";
  resultContent.style.display = "none";

  // Disable submit button if in Ask mode
  if (submitButton) {
    submitButton.disabled = true;
  }

  try {
    // Get question if in Ask mode
    let question = null;
    if (currentMode === "ask-question") {
      question = document.getElementById("questionInput").value.trim();
      if (!question) {
        showError("Please enter a question.");
        return;
      }
    }

    // Send request to background script
    const response = await chrome.runtime.sendMessage({
      action: "processAssistantRequest",
      mode: currentMode,
      text: selectedText,
      question: question,
    });

    if (!response.success) {
      throw new Error(response.error || "Processing failed");
    }

    // Display result
    displayResult(response.result);
  } catch (error) {
    console.error("Process error:", error);
    showError(error.message || "Failed to process request. Please try again.");
  } finally {
    // Re-enable submit button
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

// Add this new function after the initialize() function
function formatMarkdownText(text) {
  if (!text) return "";

  let html = text;

  // Convert bold text: **text** to <strong>text</strong>
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Convert italic text: *text* to <em>text</em>
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Split into lines and process
  const lines = html.split("\n");
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
      // Remove the bullet and wrap in <li>, preserve bold/italic formatting
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

// REPLACE the existing displayResult function with this:
function displayResult(result) {
  const loadingState = document.getElementById("loadingState");
  const resultContent = document.getElementById("resultContent");

  loadingState.style.display = "none";
  resultContent.style.display = "block";

  // Use markdown formatter instead of simple escapeHtml
  resultContent.innerHTML = formatMarkdownText(result);
}

function showError(message) {
  const loadingState = document.getElementById("loadingState");
  const resultContent = document.getElementById("resultContent");

  loadingState.style.display = "none";
  resultContent.style.display = "block";
  resultContent.innerHTML = `<div class="error-message">${escapeHtml(
    message
  )}</div>`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    window.close();
  }
});

// Initialize
initialize();
