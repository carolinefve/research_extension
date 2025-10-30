// --- NEW (IMPROVEMENT 1) ---
/**
 * Truncates text by taking the beginning and the end.
 * @param {string} text The full text to truncate.
 * @param {number} totalLength The total desired character length.
 * @returns {string} The truncated text.
 */
function smartTruncate(text, totalLength = 3500) {
  if (!text || text.length <= totalLength) {
    return text || "";
  }

  const halfLength = Math.floor(totalLength / 2);
  const start = text.substring(0, halfLength);
  const end = text.substring(text.length - halfLength);

  return start + "\n\n...[Content Truncated]...\n\n" + end;
}
// --- END NEW ---

class PaperAnalyser {
  constructor() {
    this.summarizerSession = null;
    this.writerSession = null;
    this.languageModelSession = null;
  }

  async initializeAPIs() {
    try {
      console.log("[NovaMind] Checking API availability...");

      // Check if required APIs exist
      if (typeof Summarizer === "undefined" || typeof Writer === "undefined") {
        throw new Error(
          "Required Chrome AI APIs (Summarizer, Writer) not found"
        );
      }

      // Check Summarizer availability
      const summarizerAvailability = await Summarizer.availability();
      console.log(
        "[NovaMind] Summarizer availability:",
        summarizerAvailability
      );

      // Check Writer availability
      const writerAvailability = await Writer.availability();
      console.log("[NovaMind] Writer availability:", writerAvailability);

      // Check if APIs are ready
      if (summarizerAvailability === "no" || writerAvailability === "no") {
        throw new Error("Required Chrome AI APIs not available on this system");
      }

      // Create Summarizer session
      console.log("[NovaMind] Creating Summarizer session...");
      this.summarizerSession = await Summarizer.create({
        type: "teaser",
        format: "plain-text",
        length: "medium",
        outputLanguage: "en",
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            console.log(
              `[NovaMind] Summarizer download: ${Math.round(e.loaded * 100)}%`
            );
          });
        },
      });
      console.log("[NovaMind] ✅ Summarizer session created");

      // Create Writer session
      console.log("[NovaMind] Creating Writer session...");
      this.writerSession = await Writer.create({
        tone: "formal",
        format: "plain-text",
        length: "medium",
        outputLanguage: "en",
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            console.log(
              `[NovaMind] Writer download: ${Math.round(e.loaded * 100)}%`
            );
          });
        },
      });
      console.log("[NovaMind] ✅ Writer session created");

      // Create LanguageModel session
      if (typeof LanguageModel !== "undefined") {
        try {
          const languageModelAvailability = await LanguageModel.availability();
          console.log(
            "[NovaMind] LanguageModel availability:",
            languageModelAvailability
          );

          if (languageModelAvailability !== "no") {
            console.log("[NovaMind] Creating LanguageModel session...");

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
                    `[NovaMind] LanguageModel download: ${Math.round(
                      e.loaded * 100
                    )}%`
                  );
                });
              },
            });
            console.log("[NovaMind] ✅ LanguageModel session created");
          } else {
            console.log(
              "[NovaMind] ⚠️ LanguageModel not ready, trajectory suggestions will be unavailable"
            );
          }
        } catch (languageModelError) {
          console.warn(
            "[NovaMind] ⚠️ Failed to initialize LanguageModel:",
            languageModelError.message
          );
          console.log(
            "[NovaMind] Extension will work without trajectory suggestions"
          );
        }
      } else {
        console.log(
          "[NovaMind] ⚠️ LanguageModel API not found, trajectory suggestions will be unavailable"
        );
      }

      return true;
    } catch (error) {
      console.error("[NovaMind] Failed to initialize Chrome AI APIs:", error);
      return false;
    }
  }

  async analysePaper(paperData) {
    console.log("[NovaMind] Starting paper analysis for:", paperData.title);

    // Helper function to send progress updates via storage (more reliable for service workers)
    const sendProgress = async (progress) => {
      try {
        // Store progress in chrome.storage for popup to read
        await chrome.storage.local.set({ analysisProgress: progress });

        // Also try to send message (might work if popup is open)
        chrome.runtime
          .sendMessage({
            action: "analysisProgress",
            progress: progress,
          })
          .catch(() => {
            // Ignore errors if popup is closed
          });
      } catch (error) {
        // Ignore errors
      }
    };

    const results = {
      title: paperData.title,
      url: paperData.url,
      timestamp: new Date().toISOString(),
      abstract: paperData.abstract || paperData.content, // Store original abstract
      keyFindings: [],
      methodology: "",
      researchQuestion: "", // NEW: Field for research question
      researchGaps: [],
      trajectorySuggestions: [],
      connections: [],
      confidence: 0,
      summary: "",
    };

    console.log(
      "[NovaMind] Original abstract length:",
      results.abstract.length,
      "chars"
    );
    if (paperData.introductionText) {
      console.log(
        "[NovaMind] Introduction length:",
        paperData.introductionText.length,
        "chars"
      );
    }
    if (paperData.conclusionText) {
      console.log(
        "[NovaMind] Conclusion length:",
        paperData.conclusionText.length,
        "chars"
      );
    }

    // Calculate total steps based on available APIs and data
    let totalSteps = 4; // Base: Summary, Findings, Methodology, Gaps
    let successfulSteps = 0;

    if (this.writerSession && paperData.introductionText) {
      totalSteps++; // Add step for Research Question
    }
    if (this.languageModelSession) {
      totalSteps++; // Add step for Trajectories
    }

    try {
      // Step 1: Generate summary using Summarizer API
      sendProgress(20);
      console.log("[NovaMind] Step 1: Generating summary...");
      if (this.summarizerSession) {
        const contentToSummarize = paperData.abstract || paperData.content;
        results.summary = await this.summarizerSession.summarize(
          contentToSummarize
        );
        successfulSteps++;
        console.log(
          "[NovaMind] Summary generated:",
          results.summary.substring(0, 100) + "..."
        );
      }

      // Step 2: Extract key findings using Writer API
      sendProgress(35);
      console.log("[NovaMind] Step 2: Extracting key findings...");
      if (this.writerSession) {
        // --- UPDATED (IMPROVEMENT 2) ---
        const findingsPrompt = `You are a research assistant. Your task is to read the following abstract of an academic paper and extract only the main contributions or key findings.
- List 2-3 key findings.
- Be specific and concise.
- Do NOT add any introductory text like "Here are the findings...".
- Start directly with the first finding.

Abstract:
${results.abstract}`;
        // --- END UPDATE ---

        const findingsText = await this.writerSession.write(findingsPrompt);
        results.keyFindings = this.parseFindings(findingsText);
        successfulSteps++;
        console.log(
          "[NovaMind] Key findings extracted:",
          results.keyFindings.length
        );
      }

      // Step 3 (NEW): Extract Research Question from Introduction
      if (this.writerSession && paperData.introductionText) {
        sendProgress(50);
        console.log("[NovaMind] Step 3: Extracting research question...");
        try {
          // --- UPDATED (IMPROVEMENT 1) ---
          const introText = smartTruncate(paperData.introductionText, 3500);

          // --- UPDATED (IMPROVEMENT 2) ---
          const questionPrompt = `You are a research assistant. Read the following introduction from an academic paper and identify the primary research question, problem statement, or hypothesis.
- Answer in one or two concise sentences.
- Do NOT add any introductory text.

Introduction Text:
${introText}`;
          // --- END UPDATE ---

          results.researchQuestion = await this.writerSession.write(
            questionPrompt
          );
          successfulSteps++;
          console.log(
            "[NovaMind] Research question extracted:",
            results.researchQuestion
          );
        } catch (introError) {
          console.warn(
            "[NovaMind] Failed to extract research question:",
            introError.message
          );
        }
      }

      // Step 4 (was 3): Identify methodology using Writer API
      sendProgress(60);
      console.log("[NovaMind] Step 4: Analyzing methodology...");
      if (this.writerSession) {
        // --- UPDATED (IMPROVEMENT 2) ---
        const methodologyPrompt = `You are a research assistant. Read the following abstract and describe the research methodology, techniques, or approaches used.
- Answer in 2-3 sentences.
- Do NOT add any introductory text.

Abstract:
${results.abstract}`;
        // --- END UPDATE ---

        results.methodology = await this.writerSession.write(methodologyPrompt);
        successfulSteps++;
        console.log("[NovaMind] Methodology analysed");
      }

      // Step 5 (was 4, ENHANCED): Identify research gaps using Conclusion
      sendProgress(75);
      console.log("[NovaMind] Step 5: Identifying research gaps...");
      if (this.writerSession) {
        // Use conclusion text if available (much better), otherwise fallback to summary
        const gapSourceText = paperData.conclusionText || results.summary;

        // --- UPDATED (IMPROVEMENT 1) ---
        const gapSource = smartTruncate(gapSourceText, 3500);
        // --- END UPDATE ---

        console.log(
          "[NovaMind] Using gap source:",
          paperData.conclusionText ? "Conclusion" : "Summary"
        );

        // --- UPDATED (IMPROVEMENT 2) ---
        const gapsPrompt = `You are a research assistant. Read the following text (from a paper's conclusion or summary) and identify 2-3 research gaps, limitations, or areas suggested for future investigation.
- List only the gaps or limitations.
- Do NOT add any introductory text.

Text:
${gapSource}`;
        // --- END UPDATE ---

        const gapsText = await this.writerSession.write(gapsPrompt);
        results.researchGaps = this.parseFindings(gapsText);
        successfulSteps++;
        console.log(
          "[NovaMind] Research gaps identified:",
          results.researchGaps.length
        );
      }

      // Step 6 (was 5, ENHANCED): Generate trajectory suggestions (OPTIONAL)
      if (this.languageModelSession) {
        sendProgress(85);
        console.log(
          "[NovaMind] Step 6: Generating research trajectory suggestions..."
        );
        try {
          // This prompt is already quite good, as it leverages the new, more accurate gaps
          const trajectoryPrompt = `Based on this research paper and its identified gaps, suggest 3-4 specific, actionable research directions that could build upon this work.

Research Question/Problem:
${results.researchQuestion || "N/A"}

Paper Summary:
${results.summary}

Identified Gaps/Limitations:
${results.researchGaps.map((g, i) => `${i + 1}. ${g}`).join("\n")}

IMPORTANT: Format your response as a numbered list starting directly with "1." - do NOT include any introductory text like "Here are..." or explanations. Each suggestion should be 2-4 sentences describing concrete, feasible next steps that researchers could pursue.

Example format:
1. [Research direction title]. [2-4 sentences of actionable detail]
2. [Research direction title]. [2-4 sentences of actionable detail]`;

          const trajectoriesText = await this.languageModelSession.prompt(
            trajectoryPrompt
          );
          results.trajectorySuggestions =
            this.parseTrajectories(trajectoriesText);
          successfulSteps++;
          console.log(
            "[NovaMind] Trajectory suggestions generated:",
            results.trajectorySuggestions.length
          );
        } catch (languageModelError) {
          console.warn(
            "[NovaMind] Failed to generate trajectories:",
            languageModelError.message
          );
          // Continue without trajectories
        }
      } else {
        console.log(
          "[NovaMind] ⚠️ Skipping trajectory suggestions (LanguageModel not available)"
        );
      }

      // Calculate confidence score
      results.confidence = Math.round((successfulSteps / totalSteps) * 100);
      console.log(
        "[NovaMind] Analysis complete with confidence:",
        results.confidence + "%"
      );

      return { success: true, data: results };
    } catch (error) {
      console.error("[NovaMind] Error during paper analysis:", error);
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

    console.log("[NovaMind] Parsed findings:", lines.length);
    return lines.slice(0, 4);
  }

  // Parse trajectory suggestions that may span multiple lines
  parseTrajectories(text) {
    console.log("[NovaMind] Parsing trajectory text:", text.substring(0, 200));

    // Split on numbered list markers (1., 2., 3., etc.)
    const items = text.split(/\n(?=\d+\.\s)/);

    const trajectories = items
      .map((item) => {
        // Remove the number prefix and clean up
        return item
          .replace(/^\d+\.\s*/, "") // Remove leading "1. " or "2. " etc
          .replace(/\n{3,}/g, "\n\n") // Keep paragraph breaks (convert 3+ newlines to 2)
          .replace(/\n\s*\*/g, "\n*") // Normalize bullet formatting
          .trim();
      })
      .filter((item) => {
        // Must be substantial
        if (item.length < 30) return false;

        // Filter out preamble/introductory text
        const lowerItem = item.toLowerCase();
        const preamblePhrases = [
          "here are",
          "here is",
          "below are",
          "below is",
          "following are",
          "the following",
          "i suggest",
          "i recommend",
          "these are",
          "this is",
        ];

        // Check if item starts with any preamble phrase
        const isPreamble = preamblePhrases.some(
          (phrase) =>
            lowerItem.startsWith(phrase) ||
            lowerItem.includes(phrase + " specific") ||
            lowerItem.includes(phrase + " actionable")
        );

        return !isPreamble;
      });

    console.log("[NovaMind] Parsed trajectories:", trajectories.length);
    return trajectories.slice(0, 5);
  }

  async cleanup() {
    console.log("[NovaMind] Cleaning up analyser sessions");
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
      "[NovaMind] Detecting connections with",
      previousPapers.length,
      "previous papers"
    );

    if (!this.languageModelSession) {
      console.warn(
        "[NovaMind] ⚠️ LanguageModel not available, skipping connections"
      );
      return [];
    }

    // Take up to 5 most recent papers for comparison
    const papersToCompare = previousPapers.slice(0, 5);
    const connections = [];

    for (let i = 0; i < papersToCompare.length; i++) {
      const oldPaper = papersToCompare[i];
      console.log(
        `[NovaMind] Comparing with paper ${i + 1}/${
          papersToCompare.length
        }: "${oldPaper.title.substring(0, 50)}..."`
      );

      try {
        const connection = await this.comparePapers(newPaper, oldPaper);
        if (connection) {
          console.log(
            `[NovaMind] ✅ Connection found: ${connection.type} (strength: ${connection.strength})`
          );
          connections.push(connection);
        } else {
          console.log(`[NovaMind] ❌ No significant connection detected`);
        }
      } catch (error) {
        console.error(
          `[NovaMind] ❌ Failed to detect connection with "${oldPaper.title.substring(
            0,
            50
          )}...":`,
          error.message
        );
      }
    }

    console.log(`[NovaMind] Total connections found: ${connections.length}`);
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
      "[NovaMind] Paper 1 content length:",
      paper1Text.length,
      "chars"
    );
    console.log(
      "[NovaMind] Paper 2 content length:",
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
      console.log("[NovaMind] Sending enhanced comparison request...");
      const response = await this.languageModelSession.prompt(prompt);

      console.log("[NovaMind] Raw response received");
      console.log("[NovaMind] Response length:", response.length);
      console.log("[NovaMind] First 300 chars:", response.substring(0, 300));

      // Clean the response
      const cleanedResponse = this.cleanJsonString(response);
      console.log("[NovaMind] Cleaned response:", cleanedResponse);

      let analysis;
      try {
        analysis = JSON.parse(cleanedResponse);
        console.log("[NovaMind] ✅ Successfully parsed JSON");
      } catch (parseError) {
        console.error("[NovaMind] ❌ JSON parse error:", parseError.message);
        console.error("[NovaMind] Failed to parse:", cleanedResponse);

        // Try manual extraction as fallback
        console.log("[NovaMind] Attempting manual extraction...");
        const manualAnalysis = this.manualExtractJson(cleanedResponse);
        if (manualAnalysis) {
          console.log("[NovaMind] ✅ Manual extraction successful");
          analysis = manualAnalysis;
        } else {
          console.log("[NovaMind] ❌ Manual extraction failed");
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
        console.warn("[NovaMind] Invalid response structure:", analysis);
        return null;
      }

      console.log("[NovaMind] Analysis result:", {
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
          `[NovaMind] ❌ Connection strength too low (${strength}), filtering out`
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

      console.log("[NovaMind] Created connection:", connection);
      return connection;
    } catch (error) {
      console.error("[NovaMind] Error in comparePapers:", error);
      console.error("[NovaMind] Error stack:", error.stack);
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
      console.error("[NovaMind] Manual extraction error:", error);
      return null;
    }
  }
}

// Global analyser instance
const analyser = new PaperAnalyser();

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[NovaMind] Received message:", request.action);

  if (request.action === "analysePaper") {
    handleAnalysis(request.paperData)
      .then(sendResponse)
      .catch((err) => {
        console.error("[NovaMind] Message handler error:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  } else if (request.action === "checkAPIAvailability") {
    checkAPIs()
      .then(sendResponse)
      .catch((err) => {
        console.error("[NovaMind] API check error:", err);
        sendResponse({ available: false, error: err.message });
      });
    return true;
  }
});

async function handleAnalysis(paperData) {
  try {
    console.log("[NovaMind] Handling analysis request");

    // Initialize APIs
    const initialized = await analyser.initializeAPIs();
    if (!initialized) {
      return {
        success: false,
        error:
          "Chrome AI APIs failed to initialize. Please ensure Gemini Nano is downloaded.",
      };
    }

    // Step 1-6: Analyse the paper (this now includes the new Deep Dive steps)
    const result = await analyser.analysePaper(paperData);

    if (!result.success) {
      return result;
    }

    // Step 7: Detect connections with previous papers
    console.log("[NovaMind] === STARTING STEP 7 (Connections) ===");

    if (analyser.languageModelSession) {
      // Send progress update via storage (more reliable)
      try {
        await chrome.storage.local.set({ analysisProgress: 90 });
        chrome.runtime
          .sendMessage({
            action: "analysisProgress",
            progress: 90,
          })
          .catch(() => {});
      } catch (error) {
        // Ignore errors
      }

      console.log(
        "[NovaMind] Step 7: Detecting connections with previous papers using ORIGINAL ABSTRACTS..."
      );
      console.log(
        "[NovaMind] LanguageModel session exists:",
        !!analyser.languageModelSession
      );

      try {
        // Get previous analyses
        const { analyses = [] } = await chrome.storage.local.get("analyses");
        console.log(
          "[NovaMind] Found",
          analyses.length,
          "previous analyses in storage"
        );

        if (analyses.length > 0) {
          console.log("[NovaMind] Creating ConnectionDetector...");
          const detector = new ConnectionDetector(
            analyser.languageModelSession
          );

          console.log("[NovaMind] Starting enhanced connection detection...");
          result.data.connections = await detector.detectConnections(
            result.data,
            analyses
          );

          console.log(
            "[NovaMind] ✅ Connection detection complete. Found",
            result.data.connections.length,
            "connections"
          );
        } else {
          console.log("[NovaMind] No previous papers to compare against");
          result.data.connections = [];
        }
      } catch (error) {
        console.error("[NovaMind] ❌ Failed to detect connections:", error);
        console.error("[NovaMind] Error stack:", error.stack);
        result.data.connections = [];
      }
    } else {
      console.warn(
        "[NovaMind] ⚠️ LanguageModel session not available, skipping connection detection"
      );
      console.log(
        "[NovaMind] analyser.languageModelSession is:",
        analyser.languageModelSession
      );
      result.data.connections = [];
    }

    console.log("[NovaMind] === STEP 7 COMPLETE ===");

    // Save with bidirectional connections
    console.log("[NovaMind] Saving analysis with connections...");
    await saveAnalysisWithConnections(result.data);
    console.log("[NovaMind] Analysis saved to storage");

    return result;
  } catch (error) {
    console.error("[NovaMind] Handle analysis error:", error);
    console.error("[NovaMind] Error stack:", error.stack);
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

    console.log("[NovaMind] API check result:", result);
    return result;
  } catch (error) {
    console.error("[NovaMind] API check error:", error);
    return {
      available: false,
      error: error.message,
      mode: "error",
    };
  }
}

async function saveAnalysisWithConnections(analysisData) {
  try {
    console.log("[NovaMind] Starting save with connections...");
    const { analyses = [] } = await chrome.storage.local.get("analyses");

    console.log("[NovaMind] Current analyses count:", analyses.length);
    console.log(
      "[NovaMind] New paper connections:",
      analysisData.connections?.length || 0
    );

    // Add the new analysis
    analyses.unshift(analysisData);

    // Create bidirectional connections
    if (analysisData.connections && analysisData.connections.length > 0) {
      console.log("[NovaMind] Creating bidirectional connections...");

      analysisData.connections.forEach((connection, index) => {
        console.log(
          `[NovaMind] Processing connection ${index + 1}/${
            analysisData.connections.length
          }`
        );

        // Find the connected paper and add reverse connection
        const connectedPaper = analyses.find(
          (a) => a.timestamp === connection.paperId
        );

        if (connectedPaper) {
          console.log(
            "[NovaMind] Found connected paper:",
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
            console.log("[NovaMind] Added reverse connection");
          } else {
            console.log("[NovaMind] Reverse connection already exists");
          }
        } else {
          console.warn(
            "[NovaMind] Connected paper not found for paperId:",
            connection.paperId
          );
        }
      });
    } else {
      console.log("[NovaMind] No connections to process");
    }

    // Limit to 50 papers
    if (analyses.length > 50) {
      console.log("[NovaMind] Trimming to 50 papers");
      analyses.length = 50;
    }

    await chrome.storage.local.set({ analyses });
    console.log(
      "[NovaMind] ✅ Saved analysis with connections, total count:",
      analyses.length
    );
  } catch (error) {
    console.error("[NovaMind] ❌ Failed to save analysis:", error);
    console.error("[NovaMind] Error stack:", error.stack);
  }
}

chrome.runtime.onSuspend.addListener(() => {
  console.log("[NovaMind] Extension suspending, cleaning up");
  analyser.cleanup();
});

// Handle keyboard commands
chrome.commands.onCommand.addListener((command) => {
  console.log("[NovaMind] Command received:", command);

  if (command === "open_dashboard") {
    // Open dashboard in a new tab
    chrome.tabs.create({
      url: chrome.runtime.getURL("dashboard/dashboard.html"),
    });
  }
});

console.log("[NovaMind] Background service worker initialized");

(async () => {
  try {
    console.log("[NovaMind] Checking initial API availability...");
    const result = await checkAPIs();
    console.log("[NovaMind] Startup API check:", result);
  } catch (error) {
    console.error("[NovaMind] Startup check failed:", error);
  }
})();
