// ============================================================================
// TOKEN LIMITS & TEXT HELPERS
// ============================================================================
const TOKEN_LIMITS = {
  // Chrome AI actual limits (in tokens)
  MAX_CONTEXT_TOKENS: 4096, // Total session context
  MAX_PROMPT_TOKENS: 1024, // Per-prompt limit

  SUMMARIZER_INPUT: 3000, // ~750 tokens input (leaves 274 for prompt+response)
  WRITER_INPUT: 3000, // ~750 tokens input (safe for Writer API)
  LANGUAGE_MODEL_INPUT: 3000, // ~750 tokens input (safe for LanguageModel)

  ABSTRACT_MAX: 2000, // ~500 tokens
  INTRODUCTION_MAX: 3000, // ~750 tokens
  CONCLUSION_MAX: 3000, // ~750 tokens
  COMBINED_CONTEXT_MAX: 4000, // ~1000 tokens (for multi-section)

  // Reserved tokens for prompt text
  PROMPT_OVERHEAD: 200, // ~200 tokens for prompt formatting
  RESPONSE_TOKENS: 200, // ~200 tokens reserved for response
};

function calculateSafeInputSize(promptOverheadChars = 800) {
  const availableTokens =
    TOKEN_LIMITS.MAX_PROMPT_TOKENS -
    (TOKEN_LIMITS.PROMPT_OVERHEAD + TOKEN_LIMITS.RESPONSE_TOKENS);

  return Math.floor(availableTokens * 3.5);
}

function smartTruncate(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text || "";
  }

  const halfLength = Math.floor(maxLength / 2);
  const start = text.substring(0, halfLength);
  const end = text.substring(text.length - halfLength);

  return start + "\n\n...[Content Truncated for Token Limits]...\n\n" + end;
}

/**
 * IMPROVED: Intelligent truncation with sentence boundaries
 */
function intelligentTruncate(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text || "";
  }

  // Try to split on sentence boundaries
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  let result = "";
  let currentLength = 0;

  for (const sentence of sentences) {
    if (currentLength + sentence.length > maxLength) {
      if (result === "") {
        // No sentences fit, just truncate
        return sentence.substring(0, maxLength) + "...";
      }
      break;
    }
    result += sentence;
    currentLength += sentence.length;
  }

  return result.trim();
}

/**
 * NEW: Prepare text with token counting (if available)
 * Uses actual Chrome AI token counting when possible
 */
async function prepareTextForAPI(text, apiType = "WRITER", session = null) {
  if (!text) return "";

  // Get the appropriate limit
  const charLimit =
    TOKEN_LIMITS[apiType + "_INPUT"] || TOKEN_LIMITS.WRITER_INPUT;

  // Normalize whitespace
  const normalized = text.replace(/\s+/g, " ").trim();

  // If within limit, check actual tokens if session available
  if (normalized.length <= charLimit) {
    // Try to use real token counting if available
    if (session && typeof session.countPromptTokens === "function") {
      try {
        const tokenCount = await session.countPromptTokens(normalized);
        console.log(`[NovaMind] Actual token count: ${tokenCount} tokens`);

        // If under token limit, return as-is
        if (
          tokenCount <=
          TOKEN_LIMITS.MAX_PROMPT_TOKENS - TOKEN_LIMITS.PROMPT_OVERHEAD
        ) {
          return normalized;
        }

        // Otherwise, we need to truncate more aggressively
        console.log(`[NovaMind] Token limit exceeded, truncating...`);
        const safeSize = calculateSafeInputSize();
        return intelligentTruncate(normalized, safeSize);
      } catch (error) {
        console.warn(
          "[NovaMind] Token counting failed, using char-based limit:",
          error
        );
      }
    }

    return normalized;
  }

  // Text exceeds char limit, truncate intelligently
  console.log(
    `[NovaMind] Text too long (${normalized.length} chars), truncating to ${charLimit}`
  );
  return intelligentTruncate(normalized, charLimit);
}

/**
 * NEW: Check session token usage
 */
function checkSessionTokens(session, label = "") {
  if (!session) return;

  try {
    const tokensSoFar = session.tokensSoFar || 0;
    const tokensLeft = session.tokensLeft || TOKEN_LIMITS.MAX_CONTEXT_TOKENS;

    console.log(
      `[NovaMind] ${label} Session tokens: ${tokensSoFar} used, ${tokensLeft} remaining`
    );

    // Warn if getting close to limit
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

/**
 * Combine multiple contexts with priority and token awareness
 */
function combineContexts(sections, maxTotalLength) {
  const results = [];
  let totalLength = 0;

  for (const section of sections) {
    if (!section.text) continue;

    const available = maxTotalLength - totalLength;
    if (available <= 100) break; // Need at least 100 chars

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

// ============================================================================
// PAPER ANALYSER CLASS (From File 2)
// ============================================================================

class PaperAnalyser {
  constructor() {
    this.summarizerSession = null;
    this.writerSession = null;
    this.languageModelSession = null;
  }

  async initializeAPIs() {
    try {
      console.log("[NovaMind] Checking API availability...");

      if (typeof Summarizer === "undefined" || typeof Writer === "undefined") {
        throw new Error("Required Chrome AI APIs not found");
      }

      const summarizerAvailability = await Summarizer.availability();
      const writerAvailability = await Writer.availability();

      console.log("[NovaMind] Summarizer:", summarizerAvailability);
      console.log("[NovaMind] Writer:", writerAvailability);

      if (summarizerAvailability === "no" || writerAvailability === "no") {
        throw new Error("Required Chrome AI APIs not available");
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
              `[NovaMind] Summarizer: ${Math.round(e.loaded * 100)}%`
            );
          });
        },
      });
      console.log("[NovaMind] ✅ Summarizer ready");

      // Create Writer session
      console.log("[NovaMind] Creating Writer session...");
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

      // Create LanguageModel session
      if (typeof LanguageModel !== "undefined") {
        try {
          const languageModelAvailability = await LanguageModel.availability();
          console.log("[NovaMind] LanguageModel:", languageModelAvailability);

          if (languageModelAvailability !== "no") {
            console.log("[NovaMind] Creating LanguageModel session...");
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

  // ==========================================================================
  // ! ! ! UPDATED FUNCTION WITH CHUNKING LOGIC ! ! !
  // ==========================================================================
  async analysePaper(paperData) {
    console.log("[NovaMind] Starting analysis:", paperData.title);

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

    console.log("[NovaMind] Input lengths:");
    console.log("  Abstract:", results.abstract.length, "chars");
    if (paperData.introductionText) {
      console.log(
        "  Introduction:",
        paperData.introductionText.length,
        "chars"
      );
    }
    if (paperData.conclusionText) {
      console.log("  Conclusion:", paperData.conclusionText.length, "chars");
    }

    let totalSteps = 4; // Base: Summary, Findings, Methodology, Gaps
    let successfulSteps = 0;

    if (this.writerSession && paperData.introductionText) totalSteps++; // Research Question
    if (this.languageModelSession) totalSteps++; // Trajectories

    try {
      // Step 1: Generate summary (Abstract is usually short, no chunking needed)
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

      // Step 2: Extract key findings (Also uses abstract, no chunking needed)
      sendProgress(35);
      console.log("[NovaMind] Step 2: Key findings");
      if (this.writerSession) {
        // Use abstract ONLY for findings, per user request
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
        console.log("[NovaMind] Found", results.keyFindings.length, "findings");
      }

      // ====================================================================
      // CHUNKING LOGIC FOR INTRODUCTION
      // ====================================================================
      // Step 3 (Question) & 4 (Methodology)
      sendProgress(50);
      console.log("[NovaMind] Step 3/4: Analysing for Q&M...");
      let researchQuestionFound = "";

      if (this.writerSession) {
        // --- LOGIC FIX: Check for intro text *before* processing ---
        if (paperData.introductionText) {
          // --- 1. TRY INTRODUCTION ---
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
          results.methodology = methodologyFound; // This will be "" if "NONE" was returned, which is fine
          if (researchQuestionFound) successfulSteps++;
        } else {
          // --- 2. FALLBACK TO ABSTRACT (only if intro text is missing) ---
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
        // --- END OF LOGIC FIX ---
      }

      // ====================================================================
      // CHUNKING LOGIC FOR CONCLUSION
      // ====================================================================
      // Step 5: Research gaps from conclusion
      sendProgress(75);
      console.log("[NovaMind] Step 5: Research gaps");
      if (this.writerSession) {
        // --- LOGIC FIX: Set source based on conclusionText existence ---
        let gapSourceText;
        let sourceLabel;

        if (paperData.conclusionText) {
          // --- 1. TRY CONCLUSION ---
          gapSourceText = paperData.conclusionText;
          sourceLabel = "Conclusion";
        } else {
          // --- 2. FALLBACK TO ABSTRACT ---
          gapSourceText = results.abstract;
          sourceLabel = "Abstract (fallback)";
        }
        // --- END OF LOGIC FIX ---

        console.log(
          `[NovaMind] Analysing ${sourceLabel} for gaps in chunks...`
        );

        const CHUNK_SIZE = TOKEN_LIMITS.WRITER_INPUT;
        let gapsFound = [];

        for (let i = 0; i < gapSourceText.length; i += CHUNK_SIZE) {
          const chunk = gapSourceText.substring(i, i + CHUNK_SIZE);
          console.log(
            `[NovaMind] Processing ${sourceLabel} Chunk ${
              Math.floor(i / CHUNK_SIZE) + 1
            }/${Math.ceil(gapSourceText.length / CHUNK_SIZE)}`
          );

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
            console.log(
              `[NovaMind] ✅ Found ${parsedGaps.length} gaps in chunk`
            );
          }
        }

        results.researchGaps = [...new Set(gapsFound)].slice(0, 3); // Get unique gaps
        if (results.researchGaps.length > 0) successfulSteps++;
        console.log(
          "[NovaMind] Found",
          results.researchGaps.length,
          "total unique gaps"
        );
      }

      // Step 6: Research trajectories (Now uses better, un-truncated data)
      if (this.languageModelSession) {
        sendProgress(85);
        console.log("[NovaMind] Step 6: Research trajectories");

        try {
          // --- LOGIC FIX: Set source based on conclusionText existence ---
          let trajectorySourceText;
          let sourceLabel;

          if (paperData.conclusionText) {
            // --- 1. TRY CONCLUSION ---
            trajectorySourceText = paperData.conclusionText;
            sourceLabel = "Conclusion";
          } else {
            // --- 2. FALLBACK TO ABSTRACT ---
            trajectorySourceText = results.abstract;
            sourceLabel = "Abstract (fallback)";
          }
          console.log(`[NovaMind] Using ${sourceLabel} for trajectories...`);
          // --- END OF LOGIC FIX ---

          const contexts = combineContexts(
            [
              {
                label: sourceLabel,
                text: trajectorySourceText,
              },
            ],
            TOKEN_LIMITS.COMBINED_CONTEXT_MAX
          );

          let contextText = contexts
            .map((c) => `${c.label}:\n${c.text}`)
            .join("\n\n");

          const trajectoryPrompt = `Based on this research, suggest 3-5 specific future research directions.

${contextText}

List 3-5 concrete, feasible research suggestions:`;

          console.log(
            `[NovaMind] Trajectory prompt: ${trajectoryPrompt.length} chars`
          );

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

          // =================== Bug Fix Maintained ===================
          results.trajectorySuggestions = trajectoryText
            .split("\n")
            .filter((t) => t.trim().length > 15)
            // 1. MODIFIED: Added \s* to regex to catch bullets with leading whitespace
            .map((t) => t.replace(/^\s*[-•*\d.]+\s*/, "").trim())
            .filter((t) => !t.toLowerCase().startsWith("here"))
            // 2. ADDED: New filter to remove the unwanted "Based on..." preamble
            .filter((t) => !t.toLowerCase().startsWith("based on"))
            .slice(0, 5);
          // =================== End of Bug Fix ===================

          // This step is counted in totalSteps, so increment success
          successfulSteps++;

          console.log(
            "[NovaMind] Generated",
            results.trajectorySuggestions.length,
            "trajectories"
          );
        } catch (error) {
          console.error("[NovaMind] Trajectories failed:", error);
          results.trajectorySuggestions = [];
        }
      }

      results.confidence = Math.round((successfulSteps / totalSteps) * 100);
      console.log(
        "[NovaMind] Analysis complete. Confidence:",
        results.confidence + "%"
      );

      return {
        success: true,
        data: results,
      };
    } catch (error) {
      console.error("[NovaMind] Analysis error:", error);
      return {
        success: false,
        error: error.message,
        data: results,
      };
    }
  }

  cleanup() {
    console.log("[NovaMind] Cleaning up sessions");
    // Added checks for session existence before destroying
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

// ============================================================================
// CONNECTION DETECTOR CLASS (From File 1)
// ============================================================================

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
- Note: Different methods studying the same specific phenomenon CAN be connected (citation/complementary), not as "methodological"
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

// ============================================================================
// SERVICE WORKER LOGIC (From File 1)
// ============================================================================

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
    return true; // Indicates asynchronous response
  } else if (request.action === "checkAPIAvailability") {
    checkAPIs()
      .then(sendResponse)
      .catch((err) => {
        console.error("[NovaMind] API check error:", err);
        sendResponse({ available: false, error: err.message });
      });
    return true; // Indicates asynchronous response
  }
  // Allow other message types to be handled synchronously
  return false;
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

    // Step 1-6: Analyse the paper (using the new, smarter PaperAnalyser)
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
