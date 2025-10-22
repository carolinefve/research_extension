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

      // Create LanguageModel session
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

    // UPDATED: Now stores original abstract for better connection detection
    const results = {
      title: paperData.title,
      url: paperData.url,
      timestamp: new Date().toISOString(),
      abstract: paperData.abstract || paperData.content, // ← Store original abstract
      keyFindings: [],
      methodology: "",
      researchGaps: [],
      trajectorySuggestions: [],
      connections: [],
      confidence: 0,
      summary: "",
    };

    console.log(
      "[Research Insights] Original abstract length:",
      results.abstract.length,
      "chars"
    );

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

// ENHANCED ConnectionDetector - Uses Original Abstracts
class ConnectionDetector {
  constructor(languageModelSession) {
    this.languageModelSession = languageModelSession;
  }

  async detectConnections(newPaper, previousPapers) {
    console.log(
      "[Research Insights] Detecting connections with",
      previousPapers.length,
      "previous papers"
    );

    if (!this.languageModelSession) {
      console.warn(
        "[Research Insights] ⚠️ LanguageModel not available, skipping connections"
      );
      return [];
    }

    // Take up to 5 most recent papers for comparison
    const papersToCompare = previousPapers.slice(0, 5);
    const connections = [];

    for (let i = 0; i < papersToCompare.length; i++) {
      const oldPaper = papersToCompare[i];
      console.log(
        `[Research Insights] Comparing with paper ${i + 1}/${
          papersToCompare.length
        }: "${oldPaper.title.substring(0, 50)}..."`
      );

      try {
        const connection = await this.comparePapers(newPaper, oldPaper);
        if (connection) {
          console.log(
            `[Research Insights] ✅ Connection found: ${connection.type} (strength: ${connection.strength})`
          );
          connections.push(connection);
        } else {
          console.log(
            `[Research Insights] ❌ No significant connection detected`
          );
        }
      } catch (error) {
        console.error(
          `[Research Insights] ❌ Failed to detect connection with "${oldPaper.title.substring(
            0,
            50
          )}...":`,
          error.message
        );
      }
    }

    console.log(
      `[Research Insights] Total connections found: ${connections.length}`
    );
    return connections;
  }

  cleanJsonString(str) {
    // Remove markdown code blocks
    str = str.replace(/```json\s*/g, "").replace(/```\s*/g, "");

    // Remove any text before the first {
    const firstBrace = str.indexOf("{");
    if (firstBrace > 0) {
      str = str.substring(firstBrace);
    }

    // Remove any text after the last }
    const lastBrace = str.lastIndexOf("}");
    if (lastBrace !== -1 && lastBrace < str.length - 1) {
      str = str.substring(0, lastBrace + 1);
    }

    return str.trim();
  }

  async comparePapers(paper1, paper2) {
    // ENHANCED: Use original abstracts if available, fallback to summaries
    const paper1Content = paper1.abstract || paper1.summary;
    const paper2Content = paper2.abstract || paper2.summary;

    // Limit to 800 chars to stay within token limits while maximizing content
    const paper1Text = paper1Content.substring(0, 800);
    const paper2Text = paper2Content.substring(0, 800);

    console.log(
      "[Research Insights] Paper 1 content length:",
      paper1Text.length,
      "chars"
    );
    console.log(
      "[Research Insights] Paper 2 content length:",
      paper2Text.length,
      "chars"
    );

    const prompt = `Compare these two research papers and identify their relationship. Be STRICT - only identify strong, meaningful connections. Being in the same broad field (e.g., both about "machine learning" or "NLP") is NOT enough for a connection.

PAPER 1 (NEWER):
Title: ${paper1.title}
Abstract: ${paper1Text}
Key Findings: ${paper1.keyFindings.join("; ")}
Research Gaps: ${paper1.researchGaps.join("; ")}

PAPER 2 (OLDER):
Title: ${paper2.title}
Abstract: ${paper2Text}
Key Findings: ${paper2.keyFindings.join("; ")}
Research Gaps: ${paper2.researchGaps.join("; ")}

Respond with ONLY a valid JSON object (no markdown, no extra text):
{
  "hasConnection": true,
  "connectionType": "citation",
  "strength": 9,
  "description": "Brief explanation without quotes"
}

Rules:
- hasConnection: true or false (BE STRICT - most papers should be false)
- connectionType: "methodological" | "contradictory" | "complementary" | "citation" | "none"
- strength: number from 1 to 10 (minimum 7 for real connections)
- description: simple string explaining the SPECIFIC connection

Connection Types (with STRICT criteria):
- citation: Paper 1 explicitly mentions or directly builds upon the SPECIFIC approach/model/findings from Paper 2, OR both papers study the EXACT SAME narrow phenomenon/dataset/model (e.g., both specifically about "GPT-3", not just "transformers"). Requires very specific overlap, not just same field.
- complementary: Paper 1 DIRECTLY addresses a gap or limitation that Paper 2 explicitly mentioned, OR Paper 2's findings/focus match gaps that Paper 1 identified, OR Paper 2's findings are a prerequisite for Paper 1's work. Check if research gaps from one paper align with the focus of the other.
- methodological: Papers use the SAME SPECIFIC novel technique/algorithm (not just "uses neural networks" but "both use the exact same LoRA fine-tuning approach"). Different methods studying the same topic do NOT count as methodological connections.
- contradictory: Papers have DIRECTLY OPPOSING findings or conclusions about the SAME SPECIFIC question/experiment
- none: No strong, specific connection (this should be the most common result)

STRICT Guidelines - Mark as "none" unless:
- Papers share the EXACT SAME specific model, dataset, or narrow phenomenon (e.g., both about "BERT fine-tuning on SQUAD", not just "NLP")
- One paper explicitly builds on the other's specific method or findings
- Papers have contradictory results on the SAME specific experiment
- One paper directly addresses a gap the other paper mentioned, or their gaps/findings complement each other
- Note: Different methods studying the same specific phenomenon CAN be connected (citation/complementary), but not as "methodological"
- Sharing a general field (AI, biology, etc.) is NOT a connection
- Using common techniques (transformers, CNNs, etc.) is NOT enough for a methodological connection
- Having similar themes is NOT a connection

If in doubt, mark as "none" with hasConnection: false. Require strength >= 7 for any connection.`;

    try {
      console.log("[Research Insights] Sending enhanced comparison request...");
      const response = await this.languageModelSession.prompt(prompt);

      console.log("[Research Insights] Raw response received");
      console.log("[Research Insights] Response length:", response.length);
      console.log(
        "[Research Insights] First 300 chars:",
        response.substring(0, 300)
      );

      // Clean the response
      const cleanedResponse = this.cleanJsonString(response);
      console.log("[Research Insights] Cleaned response:", cleanedResponse);

      let analysis;
      try {
        analysis = JSON.parse(cleanedResponse);
        console.log("[Research Insights] ✅ Successfully parsed JSON");
      } catch (parseError) {
        console.error(
          "[Research Insights] ❌ JSON parse error:",
          parseError.message
        );
        console.error("[Research Insights] Failed to parse:", cleanedResponse);

        // Try manual extraction as fallback
        console.log("[Research Insights] Attempting manual extraction...");
        const manualAnalysis = this.manualExtractJson(cleanedResponse);
        if (manualAnalysis) {
          console.log("[Research Insights] ✅ Manual extraction successful");
          analysis = manualAnalysis;
        } else {
          console.log("[Research Insights] ❌ Manual extraction failed");
          return null;
        }
      }

      // Validate response structure
      if (
        !analysis.hasOwnProperty("hasConnection") ||
        !analysis.hasOwnProperty("connectionType") ||
        !analysis.hasOwnProperty("strength") ||
        !analysis.hasOwnProperty("description")
      ) {
        console.warn(
          "[Research Insights] Invalid response structure:",
          analysis
        );
        return null;
      }

      console.log("[Research Insights] Analysis result:", {
        hasConnection: analysis.hasConnection,
        type: analysis.connectionType,
        strength: analysis.strength,
        description: analysis.description.substring(0, 50) + "...",
      });

      if (!analysis.hasConnection || analysis.connectionType === "none") {
        return null;
      }

      // Ensure strength is a number between 1-10
      const strength = Math.max(
        1,
        Math.min(10, parseInt(analysis.strength) || 5)
      );

      // STRICT FILTER: Only accept connections with strength >= 7
      if (strength < 7) {
        console.log(
          `[Research Insights] ❌ Connection strength too low (${strength}), filtering out`
        );
        return null;
      }

      const connection = {
        paperId: paper2.timestamp,
        paperTitle: paper2.title,
        type: analysis.connectionType,
        strength: strength,
        description: analysis.description.substring(0, 200), // Limit description length
        detectedAt: new Date().toISOString(),
      };

      console.log("[Research Insights] Created connection:", connection);
      return connection;
    } catch (error) {
      console.error("[Research Insights] Error in comparePapers:", error);
      console.error("[Research Insights] Error stack:", error.stack);
      return null;
    }
  }

  manualExtractJson(text) {
    try {
      // Try to extract values using regex
      const hasConnectionMatch = text.match(
        /"hasConnection"\s*:\s*(true|false)/i
      );
      const connectionTypeMatch = text.match(
        /"connectionType"\s*:\s*"([^"]+)"/
      );
      const strengthMatch = text.match(/"strength"\s*:\s*(\d+)/);
      const descriptionMatch = text.match(/"description"\s*:\s*"([^"]+)"/);

      if (
        hasConnectionMatch &&
        connectionTypeMatch &&
        strengthMatch &&
        descriptionMatch
      ) {
        return {
          hasConnection: hasConnectionMatch[1].toLowerCase() === "true",
          connectionType: connectionTypeMatch[1],
          strength: parseInt(strengthMatch[1]),
          description: descriptionMatch[1],
        };
      }

      return null;
    } catch (error) {
      console.error("[Research Insights] Manual extraction error:", error);
      return null;
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

    // Initialize APIs
    const initialized = await analyzer.initializeAPIs();
    if (!initialized) {
      return {
        success: false,
        error:
          "Chrome AI APIs failed to initialize. Please ensure Gemini Nano is downloaded.",
      };
    }

    // Step 1-5: Analyze the paper
    const result = await analyzer.analyzePaper(paperData);

    if (!result.success) {
      return result;
    }

    // Step 6: Detect connections with previous papers
    console.log("[Research Insights] === STARTING STEP 6 ===");

    if (analyzer.languageModelSession) {
      console.log(
        "[Research Insights] Step 6: Detecting connections with previous papers using ORIGINAL ABSTRACTS..."
      );
      console.log(
        "[Research Insights] LanguageModel session exists:",
        !!analyzer.languageModelSession
      );

      try {
        // Get previous analyses
        const { analyses = [] } = await chrome.storage.local.get("analyses");
        console.log(
          "[Research Insights] Found",
          analyses.length,
          "previous analyses in storage"
        );

        if (analyses.length > 0) {
          console.log("[Research Insights] Creating ConnectionDetector...");
          const detector = new ConnectionDetector(
            analyzer.languageModelSession
          );

          console.log(
            "[Research Insights] Starting enhanced connection detection..."
          );
          result.data.connections = await detector.detectConnections(
            result.data,
            analyses
          );

          console.log(
            "[Research Insights] ✅ Connection detection complete. Found",
            result.data.connections.length,
            "connections"
          );
        } else {
          console.log(
            "[Research Insights] No previous papers to compare against"
          );
          result.data.connections = [];
        }
      } catch (error) {
        console.error(
          "[Research Insights] ❌ Failed to detect connections:",
          error
        );
        console.error("[Research Insights] Error stack:", error.stack);
        result.data.connections = [];
      }
    } else {
      console.warn(
        "[Research Insights] ⚠️ LanguageModel session not available, skipping connection detection"
      );
      console.log(
        "[Research Insights] analyzer.languageModelSession is:",
        analyzer.languageModelSession
      );
      result.data.connections = [];
    }

    console.log("[Research Insights] === STEP 6 COMPLETE ===");

    // Save with bidirectional connections
    console.log("[Research Insights] Saving analysis with connections...");
    await saveAnalysisWithConnections(result.data);
    console.log("[Research Insights] Analysis saved to storage");

    return result;
  } catch (error) {
    console.error("[Research Insights] Handle analysis error:", error);
    console.error("[Research Insights] Error stack:", error.stack);
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

async function saveAnalysisWithConnections(analysisData) {
  try {
    console.log("[Research Insights] Starting save with connections...");
    const { analyses = [] } = await chrome.storage.local.get("analyses");

    console.log("[Research Insights] Current analyses count:", analyses.length);
    console.log(
      "[Research Insights] New paper connections:",
      analysisData.connections?.length || 0
    );

    // Add the new analysis
    analyses.unshift(analysisData);

    // Create bidirectional connections
    if (analysisData.connections && analysisData.connections.length > 0) {
      console.log("[Research Insights] Creating bidirectional connections...");

      analysisData.connections.forEach((connection, index) => {
        console.log(
          `[Research Insights] Processing connection ${index + 1}/${
            analysisData.connections.length
          }`
        );

        // Find the connected paper and add reverse connection
        const connectedPaper = analyses.find(
          (a) => a.timestamp === connection.paperId
        );

        if (connectedPaper) {
          console.log(
            "[Research Insights] Found connected paper:",
            connectedPaper.title.substring(0, 50) + "..."
          );

          if (!connectedPaper.connections) {
            connectedPaper.connections = [];
          }

          // Check if reverse connection already exists
          const reverseExists = connectedPaper.connections.some(
            (c) => c.paperId === analysisData.timestamp
          );

          if (!reverseExists) {
            connectedPaper.connections.push({
              paperId: analysisData.timestamp,
              paperTitle: analysisData.title,
              type: connection.type,
              strength: connection.strength,
              description: connection.description,
              detectedAt: connection.detectedAt,
            });
            console.log("[Research Insights] Added reverse connection");
          } else {
            console.log(
              "[Research Insights] Reverse connection already exists"
            );
          }
        } else {
          console.warn(
            "[Research Insights] Connected paper not found for paperId:",
            connection.paperId
          );
        }
      });
    } else {
      console.log("[Research Insights] No connections to process");
    }

    // Limit to 50 papers
    if (analyses.length > 50) {
      console.log("[Research Insights] Trimming to 50 papers");
      analyses.length = 50;
    }

    await chrome.storage.local.set({ analyses });
    console.log(
      "[Research Insights] ✅ Saved analysis with connections, total count:",
      analyses.length
    );
  } catch (error) {
    console.error("[Research Insights] ❌ Failed to save analysis:", error);
    console.error("[Research Insights] Error stack:", error.stack);
  }
}

chrome.runtime.onSuspend.addListener(() => {
  console.log("[Research Insights] Extension suspending, cleaning up");
  analyzer.cleanup();
});

// Handle keyboard commands
chrome.commands.onCommand.addListener((command) => {
  console.log("[Research Insights] Command received:", command);

  if (command === "open_dashboard") {
    // Open dashboard in a new tab
    chrome.tabs.create({
      url: chrome.runtime.getURL("dashboard/dashboard.html"),
    });
  }
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
