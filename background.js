// Defines approximate token and character limits for API calls.
const TOKEN_LIMITS = {
  MAX_CONTEXT_TOKENS: 4096, // Total session context
  MAX_PROMPT_TOKENS: 1024, // Per-prompt limit

  SUMMARIZER_INPUT: 3000,
  WRITER_INPUT: 3000,
  LANGUAGE_MODEL_INPUT: 3000,

  ABSTRACT_MAX: 2000,
  INTRODUCTION_MAX: 3000,
  CONCLUSION_MAX: 3000,
  COMBINED_CONTEXT_MAX: 4000,

  // Reserved tokens for prompt formatting and response generation.
  PROMPT_OVERHEAD: 200,
  RESPONSE_TOKENS: 200,
};

// Calculates a safe character count based on estimated token limits.
function calculateSafeInputSize(promptOverheadChars = 800) {
  const availableTokens =
    TOKEN_LIMITS.MAX_PROMPT_TOKENS -
    (TOKEN_LIMITS.PROMPT_OVERHEAD + TOKEN_LIMITS.RESPONSE_TOKENS);
  // Estimate ~3.5 chars per token.
  return Math.floor(availableTokens * 3.5);
}

// Truncates text by combining the start and end, for very large inputs.
function smartTruncate(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text || "";
  }
  const halfLength = Math.floor(maxLength / 2);
  const start = text.substring(0, halfLength);
  const end = text.substring(text.length - halfLength);
  return start + "\n\n...[Content Truncated for Token Limits]...\n\n" + end;
}

// Truncates text at the nearest sentence boundary.
function intelligentTruncate(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text || "";
  }

  // Try to split on sentence boundaries.
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let result = "";
  let currentLength = 0;

  for (const sentence of sentences) {
    if (currentLength + sentence.length > maxLength) {
      if (result === "") {
        // If no full sentences fit, just truncate the first one.
        return sentence.substring(0, maxLength) + "...";
      }
      break;
    }
    result += sentence;
    currentLength += sentence.length;
  }
  return result.trim();
}

async function prepareTextForAPI(text, apiType = "WRITER", session = null) {
  if (!text) return "";

  const charLimit =
    TOKEN_LIMITS[apiType + "_INPUT"] || TOKEN_LIMITS.WRITER_INPUT;
  const normalized = text.replace(/\s+/g, " ").trim();

  // If within char limit, check actual tokens if a session is available.
  if (normalized.length <= charLimit) {
    if (session && typeof session.countPromptTokens === "function") {
      try {
        const tokenCount = await session.countPromptTokens(normalized);
        console.log(`[NovaMind] Actual token count: ${tokenCount} tokens`);

        // If it's over the token limit, truncate based on tokens.
        if (
          tokenCount >
          TOKEN_LIMITS.MAX_PROMPT_TOKENS - TOKEN_LIMITS.PROMPT_OVERHEAD
        ) {
          console.log(`[NovaMind] Token limit exceeded, truncating...`);
          const safeSize = calculateSafeInputSize();
          return intelligentTruncate(normalized, safeSize);
        }
        return normalized;
      } catch (error) {
        console.warn(
          "[NovaMind] Token counting failed, using char-based limit:",
          error
        );
      }
    }
    return normalized;
  }

  // Text exceeds char limit, truncate intelligently.
  console.log(
    `[NovaMind] Text too long (${normalized.length} chars), truncating to ${charLimit}`
  );
  return intelligentTruncate(normalized, charLimit);
}

// Logs the current token usage of an AI session.
function checkSessionTokens(session, label = "") {
  if (!session) return;
  try {
    const tokensSoFar = session.tokensSoFar || 0;
    const tokensLeft = session.tokensLeft || TOKEN_LIMITS.MAX_CONTEXT_TOKENS;
    console.log(
      `[NovaMind] ${label} Session tokens: ${tokensSoFar} used, ${tokensLeft} remaining`
    );
    if (tokensLeft < 500) {
      console.warn(
        `[NovaMind] WARNING: Only ${tokensLeft} tokens left in session!`
      );
    }
    return { tokensSoFar, tokensLeft };
  } catch (error) {
    console.warn("[NovaMind] Failed to check session tokens:", error);
    return null;
  }
}

// Combines multiple text sections intelligently, respecting a total character limit.
function combineContexts(sections, maxTotalLength) {
  const results = [];
  let totalLength = 0;

  for (const section of sections) {
    if (!section.text) continue;

    const available = maxTotalLength - totalLength;
    if (available <= 100) break; // Stop if not enough space left.

    let sectionText = section.text;
    if (sectionText.length > available) {
      sectionText = intelligentTruncate(sectionText, available);
    }

    results.push({
      label: section.label,
      text: sectionText,
    });
    totalLength += sectionText.length;
  }
  return results;
}

class PaperAnalyser {
  constructor() {
    this.summarizerSession = null;
    this.writerSession = null;
    this.languageModelSession = null;
  }

  // Initializes all available Chrome AI APIs (Summarizer, Writer, LanguageModel).
  async initializeAPIs() {
    try {
      console.log("[NovaMind] Checking API availability...");
      if (typeof Summarizer === "undefined" || typeof Writer === "undefined") {
        throw new Error("Required Chrome AI APIs not found");
      }
      const summarizerAvailability = await Summarizer.availability();
      const writerAvailability = await Writer.availability();
      if (summarizerAvailability === "no" || writerAvailability === "no") {
        throw new Error("Required Chrome AI APIs not available");
      }

      // Create Summarizer session
      this.summarizerSession = await Summarizer.create({
        type: "teaser",
        format: "plain-text",
        length: "medium",
        outputLanguage: "en",
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            console.log(
              `[NovaMind] Summarizer: ${Math.round(e.loaded * 100)}%`
            );
          });
        },
      });
      console.log("[NovaMind] ✅ Summarizer ready");

      // Create Writer session
      this.writerSession = await Writer.create({
        tone: "formal",
        format: "plain-text",
        length: "medium",
        outputLanguage: "en",
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            console.log(`[NovaMind] Writer: ${Math.round(e.loaded * 100)}%`);
          });
        },
      });
      console.log("[NovaMind] ✅ Writer ready");

      // Create LanguageModel session (if available)
      if (typeof LanguageModel !== "undefined") {
        try {
          const languageModelAvailability = await LanguageModel.availability();
          if (languageModelAvailability !== "no") {
            const params = await LanguageModel.params();
            this.languageModelSession = await LanguageModel.create({
              systemPrompt: `You are an expert research advisor. Provide specific, actionable research suggestions that build upon the work presented. Be concrete, realistic, and consider practical constraints.`,
              temperature: params.defaultTemperature,
              topK: params.defaultTopK,
              monitor(m) {
                m.addEventListener("downloadprogress", (e) => {
                  console.log(
                    `[NovaMind] LanguageModel: ${Math.round(e.loaded * 100)}%`
                  );
                });
              },
            });
            console.log("[NovaMind] ✅ LanguageModel ready");
          }
        } catch (error) {
          console.warn(
            "[NovaMind] ⚠️ LanguageModel unavailable:",
            error.message
          );
        }
      }
      return true;
    } catch (error) {
      console.error("[NovaMind] Failed to initialize APIs:", error);
      return false;
    }
  }

  // Main analysis function, chunks long texts for processing.
  async analysePaper(paperData) {
    console.log("[NovaMind] Starting analysis:", paperData.title);

    // Helper to send progress updates to the popup.
    const sendProgress = async (progress) => {
      try {
        await chrome.storage.local.set({ analysisProgress: progress });
        chrome.runtime
          .sendMessage({ action: "analysisProgress", progress })
          .catch(() => {});
      } catch (error) {}
    };

    const results = {
      title: paperData.title,
      url: paperData.url,
      timestamp: new Date().toISOString(),
      abstract: paperData.abstract || paperData.content,
      keyFindings: [],
      methodology: "",
      researchQuestion: "",
      researchGaps: [],
      trajectorySuggestions: [],
      connections: [],
      confidence: 0,
      summary: "",
    };

    let totalSteps = 4; // Base: Summary, Findings, Methodology, Gaps
    let successfulSteps = 0;
    if (this.writerSession && paperData.introductionText) totalSteps++; // Research Question
    if (this.languageModelSession) totalSteps++; // Trajectories

    try {
      // Step 1: Generate summary
      sendProgress(20);
      console.log("[NovaMind] Step 1: Summary");
      if (this.summarizerSession) {
        const contentToSummarize = await prepareTextForAPI(
          results.abstract,
          "SUMMARIZER",
          this.summarizerSession
        );
        results.summary = await this.summarizerSession.summarize(
          contentToSummarize
        );
        checkSessionTokens(this.summarizerSession, "After summary");
        successfulSteps++;
      }

      // Step 2: Extract key findings
      sendProgress(35);
      console.log("[NovaMind] Step 2: Key findings");
      if (this.writerSession) {
        // Use abstract ONLY for findings.
        const findingsContext = results.abstract;
        const preparedContext = await prepareTextForAPI(
          findingsContext,
          "WRITER",
          this.writerSession
        );
        const findingsPrompt = `Extract 2-3 key findings from this paper. List them directly, one per line.

Content:
${preparedContext}`;
        const findingsText = await this.writerSession.write(findingsPrompt);
        checkSessionTokens(this.writerSession, "After findings");
        results.keyFindings = findingsText
          .split("\n")
          .filter((f) => f.trim().length > 10)
          .map((f) => f.replace(/^[-•*\d.]+\s*/, "").trim())
          .slice(0, 3);
        successfulSteps++;
      }

      // Step 3 (Question) & 4 (Methodology) from Introduction
      sendProgress(50);
      console.log("[NovaMind] Step 3/4: Analysing for Q&M...");
      let researchQuestionFound = "";

      if (this.writerSession) {
        if (paperData.introductionText) {
          // 1. TRY INTRODUCTION (with chunking)
          console.log("[NovaMind] Analysing Introduction for Q&M...");
          const introText = paperData.introductionText;
          const CHUNK_SIZE = TOKEN_LIMITS.WRITER_INPUT;
          let methodologyFound = "";

          for (let i = 0; i < introText.length; i += CHUNK_SIZE) {
            if (researchQuestionFound && methodologyFound) break;
            const chunk = introText.substring(i, i + CHUNK_SIZE);

            if (!researchQuestionFound) {
              const questionPrompt = `Read this text and identify the main research question or problem statement in 1-2 sentences. If none is found in this text, respond with only the word "NONE".
                Text:
                ${chunk}`;
              const qResponse = await this.writerSession.write(questionPrompt);
              if (
                qResponse.trim().toUpperCase() !== "NONE" &&
                qResponse.length > 10
              ) {
                researchQuestionFound = qResponse.trim();
              }
            }

            if (!methodologyFound) {
              const methodologyPrompt = `Describe the research methodology from this text in 2-3 sentences. If none is found in this text, respond with only the word "NONE".
                Text:
                ${chunk}`;
              const mResponse = await this.writerSession.write(
                methodologyPrompt
              );
              if (
                mResponse.trim().toUpperCase() !== "NONE" &&
                mResponse.length > 10
              ) {
                methodologyFound = mResponse.trim();
              }
            }
          }
          results.researchQuestion = researchQuestionFound;
          results.methodology = methodologyFound;
          if (researchQuestionFound) successfulSteps++;
        } else {
          // 2. FALLBACK TO ABSTRACT (only if intro text is missing)
          console.log(
            "[NovaMind] No Introduction text. Using Abstract for Methodology."
          );
          const methodologyPrompt = `Describe the research methodology from this abstract in 2-3 sentences.
              Abstract:
              ${results.abstract}`;
          results.methodology = await this.writerSession.write(
            methodologyPrompt
          );
        }
        successfulSteps++; // Count methodology step
      }

      // Step 5: Research gaps from conclusion (or abstract as fallback)
      sendProgress(75);
      console.log("[NovaMind] Step 5: Research gaps");
      if (this.writerSession) {
        let gapSourceText;
        let sourceLabel;

        if (paperData.conclusionText) {
          // 1. TRY CONCLUSION
          gapSourceText = paperData.conclusionText;
          sourceLabel = "Conclusion";
        } else {
          // 2. FALLBACK TO ABSTRACT
          gapSourceText = results.abstract;
          sourceLabel = "Abstract (fallback)";
        }
        console.log(
          `[NovaMind] Analysing ${sourceLabel} for gaps in chunks...`
        );

        const CHUNK_SIZE = TOKEN_LIMITS.WRITER_INPUT;
        let gapsFound = [];

        // Process the source text in chunks.
        for (let i = 0; i < gapSourceText.length; i += CHUNK_SIZE) {
          const chunk = gapSourceText.substring(i, i + CHUNK_SIZE);
          const gapsPrompt = `Identify 2-3 research gaps or limitations from this text. List them directly, one per line. If none are found, respond with only the word "NONE".
          Text:
          ${chunk}`;
          const gapsText = await this.writerSession.write(gapsPrompt);

          if (gapsText.trim().toUpperCase() !== "NONE") {
            const parsedGaps = gapsText
              .split("\n")
              .filter((g) => g.trim().length > 10)
              .map((g) => g.replace(/^[-•*\d.]+\s*/, "").trim());
            gapsFound.push(...parsedGaps);
          }
        }
        results.researchGaps = [...new Set(gapsFound)].slice(0, 3); // Get unique gaps
        if (results.researchGaps.length > 0) successfulSteps++;
      }

      // Step 6: Research trajectories (from Conclusion or Abstract)
      if (this.languageModelSession) {
        sendProgress(85);
        console.log("[NovaMind] Step 6: Research trajectories");
        try {
          let trajectorySourceText;
          let sourceLabel;
          if (paperData.conclusionText) {
            trajectorySourceText = paperData.conclusionText;
            sourceLabel = "Conclusion";
          } else {
            trajectorySourceText = results.abstract;
            sourceLabel = "Abstract (fallback)";
          }
          console.log(`[NovaMind] Using ${sourceLabel} for trajectories...`);

          const contexts = combineContexts(
            [{ label: sourceLabel, text: trajectorySourceText }],
            TOKEN_LIMITS.COMBINED_CONTEXT_MAX
          );
          let contextText = contexts
            .map((c) => `${c.label}:\n${c.text}`)
            .join("\n\n");
          const trajectoryPrompt = `Based on this research, suggest 3-5 specific future research directions.

${contextText}

List 3-5 concrete, feasible research suggestions:`;
          // Check tokens if possible
          if (
            typeof this.languageModelSession.countPromptTokens === "function"
          ) {
            const tokenCount =
              await this.languageModelSession.countPromptTokens(
                trajectoryPrompt
              );
            console.log(`[NovaMind] Trajectory tokens: ${tokenCount}`);
          }
          const trajectoryText = await this.languageModelSession.prompt(
            trajectoryPrompt
          );
          checkSessionTokens(this.languageModelSession, "After trajectories");

          // Clean up the model's response.
          results.trajectorySuggestions = trajectoryText
            .split("\n")
            .filter((t) => t.trim().length > 15)
            .map((t) => t.replace(/^\s*[-•*\d.]+\s*/, "").trim())
            .filter((t) => !t.toLowerCase().startsWith("here"))
            .filter((t) => !t.toLowerCase().startsWith("based on"))
            .slice(0, 5);
          successfulSteps++;
        } catch (error) {
          console.error("[NovaMind] Trajectories failed:", error);
          results.trajectorySuggestions = [];
        }
      }

      // Calculate confidence based on successful steps.
      results.confidence = Math.round((successfulSteps / totalSteps) * 100);
      console.log(
        "[NovaMind] Analysis complete. Confidence:",
        results.confidence + "%"
      );
      return { success: true, data: results };
    } catch (error) {
      console.error("[NovaMind] Analysis error:", error);
      return { success: false, error: error.message, data: results };
    }
  }

  // Cleans up active AI sessions.
  cleanup() {
    console.log("[NovaMind] Cleaning up sessions");
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

// Detects connections between a new paper and a list of previous papers.
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

    // Take up to 5 most recent papers for comparison.
    const papersToCompare = previousPapers.slice(0, 5);
    const connections = [];

    for (let i = 0; i < papersToCompare.length; i++) {
      const oldPaper = papersToCompare[i];
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
    return connections;
  }

  // Cleans markdown and extra text from a JSON string response.
  cleanJsonString(str) {
    str = str.replace(/```json\s*/g, "").replace(/```\s*/g, "");
    const firstBrace = str.indexOf("{");
    if (firstBrace > 0) {
      str = str.substring(firstBrace);
    }
    const lastBrace = str.lastIndexOf("}");
    if (lastBrace !== -1 && lastBrace < str.length - 1) {
      str = str.substring(0, lastBrace + 1);
    }
    return str.trim();
  }

  // Compares two papers using the Language Model to find connections.
  async comparePapers(paper1, paper2) {
    // Use original abstracts for better comparison quality.
    const paper1Content = paper1.abstract || paper1.summary;
    const paper2Content = paper2.abstract || paper2.summary;
    const paper1Text = paper1Content.substring(0, 800);
    const paper2Text = paper2Content.substring(0, 800);

    // This prompt is highly structured to force a JSON response and enforce strict rules for what constitutes a "connection".
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
- Note: Different methods studying the same specific phenomenon CAN be connected (citation/complementary), not as "methodological"
- Sharing a general field (AI, biology, etc.) is NOT a connection
- Using common techniques (transformers, CNNs, etc.) is NOT enough for a methodological connection
- Having similar themes is NOT a connection

If in doubt, mark as "none" with hasConnection: false. Require strength >= 7 for any connection.`;

    try {
      console.log("[NovaMind] Sending enhanced comparison request...");
      const response = await this.languageModelSession.prompt(prompt);
      const cleanedResponse = this.cleanJsonString(response);

      let analysis;
      try {
        analysis = JSON.parse(cleanedResponse);
      } catch (parseError) {
        // Fallback to manual regex extraction if JSON.parse fails.
        console.error(
          "[NovaMind] ❌ JSON parse error, attempting manual extraction..."
        );
        analysis = this.manualExtractJson(cleanedResponse);
        if (!analysis) {
          console.log("[NovaMind] ❌ Manual extraction failed");
          return null;
        }
      }

      // Validate the parsed object structure.
      if (
        !analysis.hasOwnProperty("hasConnection") ||
        !analysis.hasOwnProperty("connectionType") ||
        !analysis.hasOwnProperty("strength") ||
        !analysis.hasOwnProperty("description")
      ) {
        console.warn("[NovaMind] Invalid response structure:", analysis);
        return null;
      }

      if (!analysis.hasConnection || analysis.connectionType === "none") {
        return null;
      }

      const strength = Math.max(
        1,
        Math.min(10, parseInt(analysis.strength) || 5)
      );

      // STRICT FILTER: Only accept connections with strength >= 7.
      if (strength < 7) {
        console.log(
          `[NovaMind] ❌ Connection strength too low (${strength}), filtering out`
        );
        return null;
      }

      return {
        paperId: paper2.timestamp,
        paperTitle: paper2.title,
        type: analysis.connectionType,
        strength: strength,
        description: analysis.description.substring(0, 200),
        detectedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error("[NovaMind] Error in comparePapers:", error);
      return null;
    }
  }

  // Fallback parser if JSON.parse fails on the model's output.
  manualExtractJson(text) {
    try {
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
        sendResponse({ success: false, error: err.message });
      });
    return true; // Indicates asynchronous response
  } else if (request.action === "checkAPIAvailability") {
    checkAPIs()
      .then(sendResponse)
      .catch((err) => {
        sendResponse({ available: false, error: err.message });
      });
    return true; // Indicates asynchronous response
  }
  return false;
});

// Orchestrates the full analysis pipeline.
async function handleAnalysis(paperData) {
  try {
    // Step 1: Initialize APIs
    const initialized = await analyser.initializeAPIs();
    if (!initialized) {
      return {
        success: false,
        error:
          "Chrome AI APIs failed to initialize. Please ensure Gemini Nano is downloaded.",
      };
    }

    // Step 2: Analyse the paper content
    const result = await analyser.analysePaper(paperData);
    if (!result.success) {
      return result;
    }

    // Step 3: Detect connections with previous papers
    if (analyser.languageModelSession) {
      await chrome.storage.local.set({ analysisProgress: 90 });
      chrome.runtime
        .sendMessage({ action: "analysisProgress", progress: 90 })
        .catch(() => {});

      try {
        const { analyses = [] } = await chrome.storage.local.get("analyses");
        if (analyses.length > 0) {
          const detector = new ConnectionDetector(
            analyser.languageModelSession
          );
          result.data.connections = await detector.detectConnections(
            result.data,
            analyses
          );
        } else {
          result.data.connections = [];
        }
      } catch (error) {
        console.error("[NovaMind] ❌ Failed to detect connections:", error);
        result.data.connections = [];
      }
    } else {
      console.warn(
        "[NovaMind] ⚠️ LanguageModel session not available, skipping connection detection"
      );
      result.data.connections = [];
    }

    // Step 4: Save the new analysis and update old papers with new connections.
    await saveAnalysisWithConnections(result.data);
    return result;
  } catch (error) {
    console.error("[NovaMind] Handle analysis error:", error);
    return { success: false, error: error.message };
  }
}

// Checks the availability of all required Chrome AI APIs.
async function checkAPIs() {
  try {
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
    return { available: false, error: error.message, mode: "error" };
  }
}

// Saves a new analysis and adds bidirectional links to connected papers.
async function saveAnalysisWithConnections(analysisData) {
  try {
    const { analyses = [] } = await chrome.storage.local.get("analyses");
    analyses.unshift(analysisData);

    // Create bidirectional connections
    if (analysisData.connections && analysisData.connections.length > 0) {
      analysisData.connections.forEach((connection) => {
        // Find the connected paper and add the reverse connection.
        const connectedPaper = analyses.find(
          (a) => a.timestamp === connection.paperId
        );
        if (connectedPaper) {
          if (!connectedPaper.connections) {
            connectedPaper.connections = [];
          }
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
          }
        }
      });
    }

    // Limit to 50 papers
    if (analyses.length > 50) {
      analyses.length = 50;
    }
    await chrome.storage.local.set({ analyses });
  } catch (error) {
    console.error("❌ Failed to save analysis:", error);
  }
}

chrome.runtime.onSuspend.addListener(() => {
  console.log("[NovaMind] Extension suspending, cleaning up");
  analyser.cleanup();
});

// Handle keyboard commands
chrome.commands.onCommand.addListener((command) => {
  if (command === "open_dashboard") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("dashboard/dashboard.html"),
    });
  }
});

console.log("[NovaMind] Background service worker initialized");

// Create context menu on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "novamind-assistant",
    title: "NovaMind",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "simplify-text",
    parentId: "novamind-assistant",
    title: "Simplify",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "explain-text",
    parentId: "novamind-assistant",
    title: "Explain",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "ask-question",
    parentId: "novamind-assistant",
    title: "Ask a Question",
    contexts: ["selection"],
  });
  console.log("[NovaMind] Context menu created");
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const selectedText = info.selectionText;
  const mode = info.menuItemId;
  if (!selectedText || !mode.includes("-")) return;

  // Store the selected text and mode for the assistant window
  await chrome.storage.local.set({
    assistantMode: mode,
    assistantText: selectedText,
    assistantTimestamp: Date.now(),
  });

  // Open assistant window
  const currentWindow = await chrome.windows.getCurrent();
  await chrome.windows.create({
    url: chrome.runtime.getURL("assistant/assistant.html"),
    type: "popup",
    width: 600,
    height: 700,
    left: currentWindow.left + 100,
    top: currentWindow.top + 50,
  });
});

// Handle messages from assistant window
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "processAssistantRequest") {
    handleAssistantRequest(request)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async response
  }
});

// Routes the assistant's request (Simplify, Explain, Ask) to the correct API.
async function handleAssistantRequest(request) {
  const { mode, text, question } = request;
  try {
    const initialized = await analyser.initializeAPIs();
    if (!initialized) {
      return {
        success: false,
        error: "Chrome AI APIs failed to initialize",
      };
    }

    let result = "";

    // SIMPLIFY - Use Writer API
    if (mode === "simplify-text") {
      if (!analyser.writerSession) throw new Error("Writer API not available");
      const simplifyPrompt = `Simplify the following text to make it easier to understand. Keep the main ideas but use clearer language and shorter sentences:

${text}`;
      result = await analyser.writerSession.write(simplifyPrompt);
    }
    // EXPLAIN - Use Language Model API
    else if (mode === "explain-text") {
      if (!analyser.languageModelSession)
        throw new Error("Language Model API not available");
      const explainPrompt = `Explain the following text in detail. Break down the key concepts and provide context:

${text}`;
      result = await analyser.languageModelSession.prompt(explainPrompt);
    }
    // ASK QUESTION - Use Language Model API
    else if (mode === "ask-question") {
      if (!analyser.languageModelSession)
        throw new Error("Language Model API not available");
      if (!question || question.trim().length === 0)
        throw new Error("Please enter a question");
      const askPrompt = `Based on the following text, answer this question: "${question}"

Text:
${text}

Answer:`;
      result = await analyser.languageModelSession.prompt(askPrompt);
    }

    return { success: true, result: result.trim() };
  } catch (error) {
    console.error("[NovaMind] Assistant processing error:", error);
    return { success: false, error: error.message };
  }
}

// Initial check on startup
(async () => {
  try {
    console.log("[NovaMind] Checking initial API availability...");
    const result = await checkAPIs();
    console.log("[NovaMind] Startup API check:", result);
  } catch (error) {
    console.error("[NovaMind] Startup check failed:", error);
  }
})();
