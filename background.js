class PaperAnalyzer {
  constructor() {
    this.summarizerSession = null;
    this.writerSession = null;
    this.languageModelSession = null;
  }

  async initializeAPIs() {
    try {
      console.log("[Research Insights] Checking API availability...");

      // Check if required APIs exist
      if (typeof Summarizer === "undefined" || typeof Writer === "undefined") {
        throw new Error(
          "Required Chrome AI APIs (Summarizer, Writer) not found"
        );
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

      // Check if APIs are ready
      if (summarizerAvailability === "no" || writerAvailability === "no") {
        throw new Error("Required Chrome AI APIs not available on this system");
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

      // Create Prompt session
      if (typeof LanguageModel !== "undefined") {
        try {
          const languageModelAvailability = await LanguageModel.availability();
          console.log(
            "[Research Insights] LanguageModel availability:",
            languageModelAvailability
          );

          if (languageModelAvailability !== "no") {
            console.log(
              "[Research Insights] Creating LanguageModel session..."
            );

            // Get default parameters
            const params = await LanguageModel.params();

            this.languageModelSession = await LanguageModel.create({
              systemPrompt: `You are an expert research advisor analyzing academic papers. Your role is to provide specific, actionable research suggestions that build upon the work presented. When suggesting research directions:
- Be concrete and specific with methodology suggestions
- Suggest realistic next steps that researchers can actually pursue
- Consider practical constraints like data availability and feasibility
- Identify potential collaborations or interdisciplinary approaches
- Focus on high-impact research directions that advance the field
Keep suggestions clear, actionable, and well-reasoned.`,
              temperature: params.defaultTemperature,
              topK: params.defaultTopK,
              monitor(m) {
                m.addEventListener("downloadprogress", (e) => {
                  console.log(
                    `[Research Insights] LanguageModel download: ${Math.round(
                      e.loaded * 100
                    )}%`
                  );
                });
              },
            });
            console.log("[Research Insights] ✅ LanguageModel session created");
          } else {
            console.log(
              "[Research Insights] ⚠️ LanguageModel not ready, trajectory suggestions will be unavailable"
            );
          }
        } catch (languageModelError) {
          console.warn(
            "[Research Insights] ⚠️ Failed to initialize LanguageModel:",
            languageModelError.message
          );
          console.log(
            "[Research Insights] Extension will work without trajectory suggestions"
          );
        }
      } else {
        console.log(
          "[Research Insights] ⚠️ LanguageModel API not found, trajectory suggestions will be unavailable"
        );
      }

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
      trajectorySuggestions: [],
      confidence: 0,
      summary: "",
    };

    // Calculate total steps based on available APIs
    const totalSteps = this.languageModelSession ? 5 : 4;
    let successfulSteps = 0;

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
        const gapsPrompt = `Based on this research paper summary, identify 2-3 research gaps, limitations, or areas the authors mention need further investigation:\n\n${results.summary}`;
        const gapsText = await this.writerSession.write(gapsPrompt);
        results.researchGaps = this.parseFindings(gapsText);
        successfulSteps++;
        console.log(
          "[Research Insights] Research gaps identified:",
          results.researchGaps.length
        );
      }

      // Step 5: Generate trajectory suggestions using LanguageModel (OPTIONAL)
      if (this.languageModelSession) {
        console.log(
          "[Research Insights] Step 5: Generating research trajectory suggestions..."
        );
        try {
          const trajectoryPrompt = `Based on this research paper and its identified gaps, suggest 3-4 specific, actionable research directions that could build upon this work.

Paper Summary:
${results.summary}

Key Findings:
${results.keyFindings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Identified Gaps:
${results.researchGaps.map((g, i) => `${i + 1}. ${g}`).join("\n")}

Provide concrete, feasible next steps that researchers could pursue. Each suggestion should be specific enough to guide actual research planning. Format as a numbered list.`;

          const trajectoriesText = await this.languageModelSession.prompt(
            trajectoryPrompt
          );
          results.trajectorySuggestions = this.parseFindings(trajectoriesText);
          successfulSteps++;
          console.log(
            "[Research Insights] Trajectory suggestions generated:",
            results.trajectorySuggestions.length
          );
        } catch (languageModelError) {
          console.warn(
            "[Research Insights] Failed to generate trajectories:",
            languageModelError.message
          );
          // Continue without trajectories
        }
      } else {
        console.log(
          "[Research Insights] ⚠️ Skipping trajectory suggestions (LanguageModel not available)"
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
    return lines.slice(0, 4);
  }

  async cleanup() {
    console.log("[Research Insights] Cleaning up analyzer sessions");
    if (this.summarizerSession) {
      this.summarizerSession.destroy();
    }
    if (this.writerSession) {
      this.writerSession.destroy();
    }
    if (this.languageModelSession) {
      this.languageModelSession.destroy();
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
    return true;
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

    const initialized = await analyzer.initializeAPIs();
    if (!initialized) {
      return {
        success: false,
        error:
          "Chrome AI APIs failed to initialize. Please ensure Gemini Nano is downloaded.",
      };
    }

    const result = await analyzer.analyzePaper(paperData);

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
    // Check required APIs
    if (typeof Summarizer === "undefined" || typeof Writer === "undefined") {
      return {
        available: false,
        error: "Required Chrome AI APIs not available in service worker",
        mode: "unavailable",
      };
    }

    const summarizerAvailability = await Summarizer.availability();
    const writerAvailability = await Writer.availability();

    // FIXED: Check LanguageModel instead of Prompt
    let languageModelAvailability = "no";
    if (typeof LanguageModel !== "undefined") {
      languageModelAvailability = await LanguageModel.availability();
    }

    const result = {
      available: summarizerAvailability !== "no" && writerAvailability !== "no",
      summarizer: summarizerAvailability,
      writer: writerAvailability,
      languageModel: languageModelAvailability,
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
    analyses.unshift(analysisData);

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

chrome.runtime.onSuspend.addListener(() => {
  console.log("[Research Insights] Extension suspending, cleaning up");
  analyzer.cleanup();
});

console.log("[Research Insights] Background service worker initialized");

(async () => {
  try {
    console.log("[Research Insights] Checking initial API availability...");
    const result = await checkAPIs();
    console.log("[Research Insights] Startup API check:", result);
  } catch (error) {
    console.error("[Research Insights] Startup check failed:", error);
  }
})();
