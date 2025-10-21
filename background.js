class PaperAnalyzer {
  constructor() {
    this.summarizerSession = null;
    this.writerSession = null;
  }

  async initializeAPIs() {
    try {
      console.log("[Research Insights] Checking API availability...");

      // Check if APIs exist
      if (typeof Summarizer === "undefined" || typeof Writer === "undefined") {
        throw new Error("Chrome AI APIs not found in service worker context");
      }

      // Check Summarizer availability
      const summarizerAvailability = await Summarizer.availability();
      console.log(
        "[Research Insights] Summarizer availability:",
        summarizerAvailability
      );

      // Check Writer availability
      const writerAvailability = await Writer.availability();
      console.log(
        "[Research Insights] Writer availability:",
        writerAvailability
      );

      // Check if APIs are ready or can be downloaded
      if (summarizerAvailability === "no" || writerAvailability === "no") {
        throw new Error("Chrome AI APIs not available on this system");
      }

      // Create Summarizer session
      console.log("[Research Insights] Creating Summarizer session...");
      this.summarizerSession = await Summarizer.create({
        type: "key-points",
        format: "plain-text",
        length: "medium",
        outputLanguage: "en",
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            console.log(
              `[Research Insights] Summarizer download: ${Math.round(
                e.loaded * 100
              )}%`
            );
          });
        },
      });
      console.log("[Research Insights] ✅ Summarizer session created");

      // Create Writer session
      console.log("[Research Insights] Creating Writer session...");
      this.writerSession = await Writer.create({
        tone: "formal",
        format: "plain-text",
        length: "medium",
        outputLanguage: "en",
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            console.log(
              `[Research Insights] Writer download: ${Math.round(
                e.loaded * 100
              )}%`
            );
          });
        },
      });
      console.log("[Research Insights] ✅ Writer session created");

      return true;
    } catch (error) {
      console.error(
        "[Research Insights] Failed to initialize Chrome AI APIs:",
        error
      );
      return false;
    }
  }

  async analyzePaper(paperData) {
    console.log(
      "[Research Insights] Starting paper analysis for:",
      paperData.title
    );

    const results = {
      title: paperData.title,
      url: paperData.url,
      timestamp: new Date().toISOString(),
      keyFindings: [],
      methodology: "",
      researchGaps: [],
      confidence: 0,
      summary: "",
    };

    let successfulSteps = 0;
    const totalSteps = 4;

    try {
      // Step 1: Generate summary using Summarizer API
      console.log("[Research Insights] Step 1: Generating summary...");
      if (this.summarizerSession) {
        const contentToSummarize = paperData.abstract || paperData.content;
        results.summary = await this.summarizerSession.summarize(
          contentToSummarize
        );
        successfulSteps++;
        console.log(
          "[Research Insights] Summary generated:",
          results.summary.substring(0, 100) + "..."
        );
      }

      // Step 2: Extract key findings using Writer API
      console.log("[Research Insights] Step 2: Extracting key findings...");
      if (this.writerSession) {
        const findingsPrompt = `Based on this research paper summary, identify and list 2-3 main research contributions or key findings. Be specific and concise:\n\n${results.summary}`;
        const findingsText = await this.writerSession.write(findingsPrompt);
        results.keyFindings = this.parseFindings(findingsText);
        successfulSteps++;
        console.log(
          "[Research Insights] Key findings extracted:",
          results.keyFindings.length
        );
      }

      // Step 3: Identify methodology using Writer API
      console.log("[Research Insights] Step 3: Analyzing methodology...");
      if (this.writerSession) {
        const methodologyPrompt = `Based on this research paper summary, describe the research methodology, techniques, or approaches used in 2-3 sentences:\n\n${results.summary}`;
        results.methodology = await this.writerSession.write(methodologyPrompt);
        successfulSteps++;
        console.log("[Research Insights] Methodology analyzed");
      }

      // Step 4: Identify research gaps using Writer API
      console.log("[Research Insights] Step 4: Identifying research gaps...");
      if (this.writerSession) {
        const gapsPrompt = `Based on this research paper summary, identify 2-3 research gaps or opportunities for future work. Focus on what the paper suggests needs further investigation:\n\n${results.summary}`;
        const gapsText = await this.writerSession.write(gapsPrompt);
        results.researchGaps = this.parseFindings(gapsText);
        successfulSteps++;
        console.log(
          "[Research Insights] Research gaps identified:",
          results.researchGaps.length
        );
      }

      // Calculate confidence score
      results.confidence = Math.round((successfulSteps / totalSteps) * 100);
      console.log(
        "[Research Insights] Analysis complete with confidence:",
        results.confidence + "%"
      );

      return { success: true, data: results };
    } catch (error) {
      console.error("[Research Insights] Error during paper analysis:", error);
      return { success: false, error: error.message };
    }
  }

  parseFindings(text) {
    // Split text into individual findings (by numbers, bullets, or newlines)
    const lines = text
      .split(/\n+/)
      .map((line) =>
        line
          .replace(/^\d+\.\s*/, "")
          .replace(/^[•\-*]\s*/, "")
          .trim()
      )
      .filter((line) => line.length > 20);

    console.log("[Research Insights] Parsed findings:", lines.length);
    return lines.slice(0, 3); // Return max 3 findings
  }

  async cleanup() {
    console.log("[Research Insights] Cleaning up analyzer sessions");
    if (this.summarizerSession) {
      this.summarizerSession.destroy();
    }
    if (this.writerSession) {
      this.writerSession.destroy();
    }
  }
}

// Global analyzer instance
const analyzer = new PaperAnalyzer();

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[Research Insights] Received message:", request.action);

  if (request.action === "analyzePaper") {
    handleAnalysis(request.paperData)
      .then(sendResponse)
      .catch((err) => {
        console.error("[Research Insights] Message handler error:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async response
  } else if (request.action === "checkAPIAvailability") {
    checkAPIs()
      .then(sendResponse)
      .catch((err) => {
        console.error("[Research Insights] API check error:", err);
        sendResponse({ available: false, error: err.message });
      });
    return true;
  }
});

async function handleAnalysis(paperData) {
  try {
    console.log("[Research Insights] Handling analysis request");

    // Initialize APIs if not already done
    const initialized = await analyzer.initializeAPIs();
    if (!initialized) {
      return {
        success: false,
        error:
          "Chrome AI APIs failed to initialize. Please ensure Gemini Nano is downloaded.",
      };
    }

    // Analyze the paper
    const result = await analyzer.analyzePaper(paperData);

    // Store result in chrome.storage
    if (result.success) {
      await saveAnalysis(result.data);
      console.log("[Research Insights] Analysis saved to storage");
    }

    return result;
  } catch (error) {
    console.error("[Research Insights] Handle analysis error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

async function checkAPIs() {
  try {
    // Check if APIs exist first
    if (typeof Summarizer === "undefined" || typeof Writer === "undefined") {
      return {
        available: false,
        error: "Chrome AI APIs not available in service worker",
        mode: "unavailable",
      };
    }

    const summarizerAvailability = await Summarizer.availability();
    const writerAvailability = await Writer.availability();

    const result = {
      available: summarizerAvailability !== "no" && writerAvailability !== "no",
      summarizer: summarizerAvailability,
      writer: writerAvailability,
      mode: "real",
    };

    console.log("[Research Insights] API check result:", result);
    return result;
  } catch (error) {
    console.error("[Research Insights] API check error:", error);
    return {
      available: false,
      error: error.message,
      mode: "error",
    };
  }
}

async function saveAnalysis(analysisData) {
  try {
    const { analyses = [] } = await chrome.storage.local.get("analyses");
    analyses.unshift(analysisData); // Add to beginning

    // Keep only last 50 analyses
    if (analyses.length > 50) {
      analyses.length = 50;
    }

    await chrome.storage.local.set({ analyses });
    console.log(
      "[Research Insights] Saved analysis, total count:",
      analyses.length
    );
  } catch (error) {
    console.error("[Research Insights] Failed to save analysis:", error);
  }
}

// Cleanup on extension unload
chrome.runtime.onSuspend.addListener(() => {
  console.log("[Research Insights] Extension suspending, cleaning up");
  analyzer.cleanup();
});

console.log("[Research Insights] Background service worker initialized");

// Safely check API availability on startup
(async () => {
  try {
    console.log("[Research Insights] Checking initial API availability...");
    const result = await checkAPIs();
    console.log("[Research Insights] Startup API check:", result);
  } catch (error) {
    console.error("[Research Insights] Startup check failed:", error);
  }
})();
