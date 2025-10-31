if (typeof pdfjsLib !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
    "extensions/pdfjs/pdf.worker.min.js"
  );
} else {
  console.error(
    "[NovaMind] pdfjsLib is not defined. Check manifest.json content_scripts array."
  );
}

function detectSite() {
  const hostname = window.location.hostname;
  const url = window.location.href.toLowerCase();

  // Define supported sites
  const supportedSites = {
    "arxiv.org": {
      key: "arXiv",
      domain: "arxiv.org",
      // Matches both HTML pages and PDF URLs
      isSupported:
        hostname.includes("arxiv.org") &&
        (url.includes("/abs/") || url.includes("/pdf/")),
    },
    "ncbi.nlm.nih.gov": {
      key: "PubMed",
      domain: "ncbi.nlm.nih.gov",
      isSupported:
        hostname.includes("ncbi.nlm.nih.gov") &&
        (url.includes("/pmc/") || url.includes("/pubmed/")),
    },
    "ieeexplore.ieee.org": {
      key: "IEEE",
      domain: "ieeexplore.ieee.org",
      isSupported:
        hostname.includes("ieeexplore.ieee.org") && url.includes("/document/"),
    },
    "scholar.google.com": {
      key: "Scholar",
      domain: "scholar.google.com",
      isSupported: hostname.includes("scholar.google.com"),
    },
    "link.springer.com": {
      key: "Springer",
      domain: "link.springer.com",
      isSupported:
        hostname.includes("link.springer.com") &&
        (url.includes("/article/") || url.includes("/chapter/")),
    },
  };

  // Check if current site is supported
  for (const [key, site] of Object.entries(supportedSites)) {
    if (site.isSupported) {
      return {
        key: site.key,
        domain: site.domain,
      };
    }
  }

  // Fallback: check if it looks like a research paper on an unknown site
  if (looksLikeResearchPaper()) {
    return {
      key: getSiteName(hostname),
      domain: hostname,
    };
  }

  return null;
}

function getSiteName(hostname) {
  // Extract a clean site name from hostname for display purposes
  // Remove common prefixes and TLDs
  const cleaned = hostname
    .replace(/^www\./, "")
    .replace(/^m\./, "")
    .split(".")[0];

  // Capitalize first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function looksLikeResearchPaper() {
  // Check if we're viewing a PDF
  const isPDF =
    document.contentType === "application/pdf" ||
    window.location.href.toLowerCase().endsWith(".pdf") ||
    document.querySelector("embed[type='application/pdf']") ||
    document.querySelector("object[type='application/pdf']");

  if (isPDF) {
    console.log("[NovaMind] Detected PDF document");
    // For PDFs, we'll rely on the URL patterns to determine if it's a research paper
    // rather than immediately returning true
    const url = window.location.href.toLowerCase();
    const researchPdfPatterns = [
      /arxiv\.org/,
      /\.edu\/.*\.pdf/,
      /researchgate\.net/,
      /academia\.edu/,
      /doi\.org/,
      /scholar\.google/,
      /pubmed/,
      /ncbi\.nlm\.nih\.gov/,
      /ieee/,
      /acm\.org/,
      /springer/,
      /sciencedirect/,
    ];

    const isLikelyResearchPdf = researchPdfPatterns.some((pattern) =>
      pattern.test(url)
    );
    if (isLikelyResearchPdf) {
      console.log("[NovaMind] PDF appears to be from a research source");
      return true;
    }
  }

  // Check for common research paper indicators
  const bodyText = document.body.textContent.toLowerCase();

  const indicators = [
    // Look for "abstract" text
    bodyText.includes("abstract"),
    // Look for common paper metadata
    document.querySelector('meta[name="citation_title"]'),
    document.querySelector('meta[name="DC.title"]'),
    document.querySelector('meta[property="og:type"][content="article"]'),
    // Look for DOI
    document.body.textContent.match(/\b10\.\d{4,}/),
    // Look for keywords section
    bodyText.includes("keywords"),
    // Look for references or bibliography
    bodyText.includes("references") || bodyText.includes("bibliography"),
    // Look for author information
    document.querySelector('[class*="author" i]') ||
      document.querySelector('[id*="author" i]'),
    // Look for academic journal indicators
    bodyText.includes("published") || bodyText.includes("journal"),
    // Look for introduction or conclusion sections
    bodyText.includes("introduction") || bodyText.includes("conclusion"),
  ];

  // If at least 3 indicators are present, likely a research paper
  const score = indicators.filter(Boolean).length;
  return score >= 3;
}

/**
 * NEW HELPER FUNCTION
 * * Fetches the /abs/ page for an arXiv PDF to get reliable metadata
 * (title, abstract, authors) and merges it with the parsed PDF text
 * (introduction, conclusion).
 */
async function extractArxivDataFromPdfUrl() {
  const pdfUrl = window.location.href;

  // 1. Convert PDF URL to /abs/ URL
  // Handles .../pdf/12345 and .../pdf/12345.pdf
  const absUrl = pdfUrl.replace("/pdf/", "/abs/").replace(".pdf", "");

  let fetchedTitle = null;
  let fetchedAbstract = null;
  let fetchedAuthors = null;

  try {
    // 2. Fetch the /abs/ page
    console.log(`[NovaMind] Fetching metadata from ${absUrl}`);
    const response = await fetch(absUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch /abs/ page: ${response.statusText}`);
    }
    const htmlText = await response.text();

    // 3. Parse the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");

    // 4. Extract reliable metadata from the parsed HTML

    // Title
    const titleElement = doc.querySelector("h1.title");
    if (titleElement) {
      fetchedTitle = titleElement.textContent.replace("Title:", "").trim();
    }

    // Abstract
    const abstractElement = doc.querySelector("blockquote.abstract-full");
    if (abstractElement) {
      fetchedAbstract = abstractElement.textContent
        .replace(/^Abstract\s*:/i, "")
        .trim();
    }

    // Authors
    const authorsElement = doc.querySelector("div.authors");
    if (authorsElement) {
      // Get all author links, map to their text content, and join
      const authorLinks = authorsElement.querySelectorAll("a");
      fetchedAuthors = Array.from(authorLinks)
        .map((a) => a.textContent.trim())
        .join(", ");
    }

    console.log("[NovaMind] Successfully fetched metadata from /abs/ page.");
  } catch (error) {
    console.warn(
      "[NovaMind] Could not fetch /abs/ page metadata. Will rely on PDF parsing.",
      error
    );
    // If fetching fails, we'll just fall back to the PDF parser's results.
  }

  // 5. We STILL need the full text (Intro/Conclusion) from the PDF itself
  let intro = "";
  let conclusion = "";
  let fullText = ""; // For fallback 'content'
  let parsedTitle = null;
  let parsedAbstract = null;

  try {
    if (typeof pdfjsLib === "undefined") {
      throw new Error("PDF.js library (pdfjsLib) is not loaded.");
    }
    fullText = await extractTextFromPDF(pdfUrl);
    const parsed = parseResearchPaperFromText(fullText);

    intro = parsed.introduction;
    conclusion = parsed.conclusion;
    parsedTitle = parsed.title;
    parsedAbstract = parsed.abstract;
  } catch (pdfError) {
    console.error(
      "[NovaMind] PDF text extraction failed during /abs/ fetch:",
      pdfError
    );
    // If PDF parsing fails, we at least have the /abs/ data
  }

  // 6. Combine and return the data
  // Prioritize the fetched data, but use parsed data as a fallback.
  return {
    title:
      fetchedTitle || parsedTitle || extractTitleFromURL() || "Untitled Paper",
    abstract: fetchedAbstract || parsedAbstract || "",
    authors: fetchedAuthors || "", // Authors are hard to parse from PDF, so only use fetched
    content:
      fetchedAbstract || parsedAbstract || intro || fullText.substring(0, 3000), // Prioritize good content
    introductionText: intro,
    conclusionText: conclusion,
    url: window.location.href,
    site: "arXiv",
    extractedFromPDF: true, // We are still on a PDF page
  };
}

async function extractPaperContent() {
  const site = detectSite();
  if (!site) {
    return null;
  }

  // ============================================================================
  // ! ! ! MODIFICATION: Add this special case for arXiv PDFs ! ! !
  // ============================================================================
  if (site.key === "arXiv" && isPDFPage()) {
    console.log(
      "[NovaMind] arXiv PDF detected. Using /abs/ page fetch strategy."
    );
    return await extractArxivDataFromPdfUrl();
  }
  // ============================================================================
  // ! ! ! END OF MODIFICATION ! ! !
  // ============================================================================

  // Check if we're on a PDF page (for OTHER sites)
  if (isPDFPage()) {
    console.log("[NovaMind] PDF detected - using PDF text extraction");
    return await extractFromPDF();
  }

  // For HTML pages, use normal extraction
  return extractFromPage();
}

function isPDFPage() {
  return (
    document.contentType === "application/pdf" ||
    window.location.href.toLowerCase().endsWith(".pdf") ||
    document.querySelector("embed[type='application/pdf']") ||
    document.querySelector("object[type='application/pdf']")
  );
}

async function extractFromPDF() {
  try {
    console.log("[NovaMind] Starting PDF text extraction...");

    // ============================================================================
    // CHANGED: No longer need to load the library, just check if it exists
    // ============================================================================
    if (typeof pdfjsLib === "undefined") {
      throw new Error("PDF.js library (pdfjsLib) is not loaded.");
    }

    // Extract text from PDF
    const pdfUrl = window.location.href;
    const fullText = await extractTextFromPDF(pdfUrl);

    if (!fullText || fullText.length < 100) {
      throw new Error("Failed to extract sufficient text from PDF");
    }

    console.log("[NovaMind] Extracted", fullText.length, "characters from PDF");

    // Parse the paper structure
    const parsed = parseResearchPaperFromText(fullText);

    const site = detectSite();

    return {
      title: parsed.title || extractTitleFromURL() || "Untitled Paper",
      abstract: parsed.abstract || "",
      authors: "", // PDFs don't easily expose author info
      content:
        parsed.abstract || parsed.introduction || fullText.substring(0, 3000),
      introductionText: parsed.introduction || "",
      conclusionText: parsed.conclusion || "",
      url: window.location.href,
      site: site ? site.key : "PDF",
      extractedFromPDF: true,
    };
  } catch (error) {
    console.error("[NovaMind] PDF extraction failed:", error);
    // Fallback to basic extraction
    return {
      title: extractTitleFromURL() || "Untitled Paper",
      abstract:
        "PDF text extraction failed. Please try the HTML version if available.",
      authors: "",
      content: "",
      introductionText: "",
      conclusionText: "",
      url: window.location.href,
      site: "PDF",
      extractedFromPDF: false,
    };
  }
}

// ============================================================================
// DELETED: The entire loadPDFJS() function is no longer needed
// ============================================================================
/*
async function loadPDFJS() {
  ...
}
*/

async function extractTextFromPDF(pdfUrl) {
  try {
    const pdfjsLib = window.pdfjsLib;

    // Load the PDF document
    const loadingTask = pdfjsLib.getDocument({
      url: pdfUrl,
      verbosity: 0, // Reduce console spam
    });

    const pdf = await loadingTask.promise;
    console.log(`[NovaMind] PDF loaded: ${pdf.numPages} pages`);

    // Extract text from first 10 pages (usually contains intro and sometimes conclusion)
    const maxPages = Math.min(pdf.numPages, 10);
    let fullText = "";

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Combine text items with proper spacing
      const pageText = textContent.items
        .map((item) => item.str)
        .join(" ")
        .replace(/\s+/g, " "); // Normalize spaces

      fullText += pageText + "\n\n";

      if (pageNum % 3 === 0) {
        console.log(`[NovaMind] Processed ${pageNum}/${maxPages} pages`);
      }
    }

    // Also try to get the last few pages for conclusion
    if (pdf.numPages > maxPages) {
      const lastPages = Math.max(pdf.numPages - 3, maxPages + 1);
      for (let pageNum = lastPages; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item) => item.str)
          .join(" ")
          .replace(/\s+/g, " ");
        fullText += pageText + "\n\n";
      }
      console.log(
        `[NovaMind] Also extracted last ${
          pdf.numPages - lastPages + 1
        } pages for conclusion`
      );
    }

    return fullText;
  } catch (error) {
    console.error("[NovaMind] PDF text extraction error:", error);
    throw error;
  }
}

// ============================================================================
// ! ! ! REPLACED FUNCTION: More robust anchor-based parsing ! ! !
// ============================================================================
function parseResearchPaperFromText(fullText) {
  console.log("[NovaMind] Parsing paper structure from text...");
  const result = {
    title: "",
    abstract: "",
    introduction: "",
    conclusion: "",
  };

  // Clean the text first (replace multiple spaces/newlines)
  const cleanedText = fullText.replace(/\s+/g, " ").replace(/\n+/g, "\n");

  // 1. Define regex for our section "anchors"
  // We look for the *start* of these headings.
  // (?:...|...) = OR group
  // \b = word boundary (ensures "Abstract" isn't part of "Sub-Abstract")
  // [\s\n:]* = optional spaces, newlines, or colons after the word
  const abstractRegex = /\b(Abstract|Summary)\b[\s\n:]*/i;
  // (?:1\.?|I\.?) = "1" or "I" with an optional period
  const introRegex = /\b(1\.?|I\.?)\s*Introduction\b/i;
  // (\d+\.?|[IVX]+\.?) = any number or roman numeral with optional period
  const conclusionRegex =
    /\b(\d+\.?|[IVX]+\.?)\s*(Conclusion|Discussion|Limitations|Future Work)\b/i;
  const referencesRegex =
    /\b(References|REFERENCES|Bibliography|Acknowledgment[s]?)\b/i;

  // 2. Find the *index* (position) of these anchors
  const abstractMatch = cleanedText.match(abstractRegex);
  const introMatch = cleanedText.match(introRegex);
  const conclusionMatch = cleanedText.match(conclusionRegex);
  const referencesMatch = cleanedText.match(referencesRegex);

  // Get the *starting* index of the match, or -1 if not found
  const abstractStartIndex = abstractMatch ? abstractMatch.index : -1;
  const introStartIndex = introMatch ? introMatch.index : -1;
  const conclusionStartIndex = conclusionMatch ? conclusionMatch.index : -1;
  const referencesStartIndex = referencesMatch ? referencesMatch.index : -1;

  // Get the *ending* index (start + length) of the match, or -1
  const abstractEndIndex = abstractMatch
    ? abstractStartIndex + abstractMatch[0].length
    : -1;
  const introEndIndex = introMatch
    ? introStartIndex + introMatch[0].length
    : -1;
  const conclusionEndIndex = conclusionMatch
    ? conclusionStartIndex + conclusionMatch[0].length
    : -1;

  // 3. Determine the "end" points for each section
  // Title ends where the Abstract starts, or if no Abstract, where Introduction starts
  const endOfTitleIndex =
    abstractStartIndex !== -1 ? abstractStartIndex : introStartIndex;

  // Abstract ends where Introduction starts
  const endOfAbstractIndex = introStartIndex;

  // Introduction ends where Conclusion starts, or if no Conclusion, where References start
  const endOfIntroIndex =
    conclusionStartIndex !== -1 ? conclusionStartIndex : referencesStartIndex;

  // Conclusion ends where References start
  const endOfConclusionIndex = referencesStartIndex;

  // 4. Extract Title
  if (endOfTitleIndex !== -1) {
    let titleText = cleanedText.substring(0, endOfTitleIndex).trim();
    // Clean up common PDF junk (page numbers, arXiv watermarks)
    titleText = titleText
      .replace(/arXiv:\d+\.\d+v?\d*\s*\[.*\]\s*\d+\s*\w*\s*\d{4}/gi, "") // Remove arXiv watermarks
      .replace(/^\d+|\s+\d+$/g, ""); // Remove page numbers at start/end

    // Get the last significant line (or lines) before the anchor, which is usually the title
    const titleLines = titleText
      .split("\n")
      .filter((line) => line.trim().length > 15); // Filter out short junk lines
    result.title = titleLines.join(" ").replace(/\s+/g, " ").trim(); // Join remaining lines
  }
  // Fallback: If no anchors, try to get first long line
  if (!result.title && cleanedText.length > 100) {
    const fallbackTitleMatch = cleanedText.match(/^([^\n]{20,300}?)\n/m);
    if (fallbackTitleMatch) {
      result.title = fallbackTitleMatch[1].trim();
    }
  }
  console.log("[NovaMind] Extracted title:", result.title.substring(0, 80));

  // 5. Extract Abstract
  if (abstractEndIndex !== -1 && endOfAbstractIndex !== -1) {
    // Found a keyword like "Abstract" or "Summary"
    result.abstract = cleanedText
      .substring(abstractEndIndex, endOfAbstractIndex)
      .trim()
      .substring(0, 3000);
    console.log(
      "[NovaMind] Extracted abstract (keyword):",
      result.abstract.length,
      "chars"
    );
  } else if (introStartIndex !== -1) {
    // FALLBACK: No "Abstract" keyword. Grab text between Title and Introduction.
    // This handles the case you mentioned.
    const start = result.title
      ? cleanedText.indexOf(result.title) + result.title.length
      : 0;
    const end = introStartIndex;

    if (start < end) {
      result.abstract = cleanedText
        .substring(start, end)
        .trim()
        .substring(0, 3000);
      console.log(
        "[NovaMind] Extracted abstract (fallback):",
        result.abstract.length,
        "chars"
      );
    }
  }

  // 6. Extract Introduction
  if (introEndIndex !== -1 && endOfIntroIndex !== -1) {
    result.introduction = cleanedText
      .substring(introEndIndex, endOfIntroIndex)
      .trim()
      .substring(0, 6000);
    console.log(
      "[NovaMind] Extracted introduction:",
      result.introduction.length,
      "chars"
    );
  }

  // 7. Extract Conclusion
  if (conclusionEndIndex !== -1 && endOfConclusionIndex !== -1) {
    result.conclusion = cleanedText
      .substring(conclusionEndIndex, endOfConclusionIndex)
      .trim()
      .substring(0, 4000);
    console.log(
      "[NovaMind] Extracted conclusion:",
      result.conclusion.length,
      "chars"
    );
  }

  return result;
}
// ============================================================================
// ! ! ! END OF REPLACED FUNCTION ! ! !
// ============================================================================

function extractTitleFromURL() {
  // Try to extract title from URL
  const url = window.location.href;

  // For arXiv
  const arxivMatch = url.match(/arxiv\.org\/(?:pdf|abs)\/(\d+\.\d+)/);
  if (arxivMatch) {
    return `arXiv:${arxivMatch[1]}`;
  }

  // For other URLs, try to get filename
  const filename = url.split("/").pop().replace(".pdf", "");
  if (filename && filename.length > 5) {
    return filename.replace(/[-_]/g, " ");
  }

  return null;
}

// Extract paper content from supported research sites
function extractFromPage() {
  console.log("[NovaMind] Extracting paper content");

  // Strategy 1: Try meta tags (most reliable)
  let title = extractFromMeta();
  let abstract = extractAbstractFromMeta();
  let authors = extractAuthorsFromMeta();

  // Strategy 2: Try semantic HTML and common patterns
  if (!title) {
    title = extractTitleFromDOM();
  }

  if (!abstract) {
    abstract = extractAbstractFromDOM();
  }

  if (!authors) {
    authors = extractAuthorsFromDOM();
  }

  // Strategy 3: Extract Introduction and Conclusion text
  let introduction = extractIntroductionFromDOM();
  let conclusion = extractConclusionFromDOM();

  // Fallback: use page title if still no title found
  if (!title) {
    title = document.title.split("|")[0].split("-")[0].trim();
  }

  // If we still don't have an abstract, try to extract the most relevant text
  if (!abstract || abstract.length < 50) {
    abstract = extractMainContent();
  }

  const site = detectSite();

  return {
    title: title || "Untitled Paper",
    abstract: abstract || "",
    authors: authors || "",
    content: abstract || "", // 'content' is the primary text for summarization
    introductionText: introduction || "", // Add intro text
    conclusionText: conclusion || "", // Add conclusion text
    url: window.location.href,
    site: site ? site.key : "generic",
  };
}

function extractFromMeta() {
  // Try various meta tag patterns for title
  const selectors = [
    'meta[name="citation_title"]',
    'meta[name="DC.title"]',
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    'meta[property="article:title"]',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && element.content && element.content.length > 10) {
      return element.content.trim();
    }
  }

  return null;
}

function extractAbstractFromMeta() {
  // Try various meta tag patterns for abstract
  const selectors = [
    'meta[name="citation_abstract"]',
    'meta[name="DC.description"]',
    'meta[property="og:description"]',
    'meta[name="description"]',
    'meta[name_s="twitter:description"]',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && element.content && element.content.length > 100) {
      return element.content.trim();
    }
  }

  return null;
}

function extractAuthorsFromMeta() {
  // Try various meta tag patterns for authors
  const selectors = [
    'meta[name="citation_author"]',
    'meta[name="DC.creator"]',
    'meta[name="author"]',
    'meta[property="article:author"]',
  ];

  const authors = [];

  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    elements.forEach((el) => {
      if (el.content && el.content.trim()) {
        authors.push(el.content.trim());
      }
    });
  }

  return authors.length > 0 ? authors.join(", ") : null;
}

function extractTitleFromDOM() {
  // Try to find title using common patterns
  const titleSelectors = [
    'h1[class*="title" i]',
    '[class*="article-title" i]',
    '[class*="paper-title" i]',
    '[class*="citation__title" i]',
    '[id*="title" i]',
    "h1",
    '[class*="headline" i]',
  ];

  for (const selector of titleSelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent.trim().length > 10) {
      const text = element.textContent.trim();
      // Filter out very long text (likely not a title)
      if (text.length < 300) {
        return text;
      }
    }
  }

  return null;
}

function extractAbstractFromDOM() {
  // Try to find abstract using common patterns
  const abstractSelectors = [
    '[class*="abstract" i]',
    '[id*="abstract" i]',
    'section[aria-label*="abstract" i]',
    '[data-testid*="abstract" i]',
    'div[role="region"][aria-label*="abstract" i]',
  ];

  for (const selector of abstractSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      // Get text but exclude nested script/style tags
      let text = element.textContent.trim();

      // Remove common labels
      text = text.replace(/^abstract[:\s]*/i, "");
      text = text.replace(/^summary[:\s]*/i, "");

      // Must be substantial content
      if (text.length > 100 && text.length < 5000) {
        return text;
      }
    }
  }

  // Try looking for paragraph after "abstract" heading
  const headings = document.querySelectorAll(
    "h2, h3, h4, strong, b, .section-title"
  );
  for (const heading of headings) {
    const headingText = heading.textContent.toLowerCase().trim();
    if (
      headingText === "abstract" ||
      headingText === "summary" ||
      headingText.includes("abstract")
    ) {
      let nextElement = heading.nextElementSibling;
      let abstractText = "";

      // Collect paragraphs after the abstract heading
      let iterations = 0;
      // Limit to 5000 chars for abstract
      while (nextElement && abstractText.length < 5000 && iterations < 10) {
        iterations++;

        if (nextElement.tagName === "P" || nextElement.tagName === "DIV") {
          const text = nextElement.textContent.trim();
          if (text.length > 50) {
            abstractText += text + " ";
          }
        } else if (nextElement.tagName.match(/^H[1-6]$/)) {
          break; // Stop at next heading
        }

        nextElement = nextElement.nextElementSibling;
      }

      if (abstractText.length > 100) {
        return abstractText.trim();
      }
    }
  }

  return null;
}

function extractIntroductionFromDOM() {
  // Try looking for paragraph after "Introduction" heading
  const headings = document.querySelectorAll(
    "h2, h3, h4, strong, b, .section-title"
  );
  for (const heading of headings) {
    const headingText = heading.textContent.toLowerCase().trim();
    const isIntro =
      headingText === "introduction" ||
      headingText.startsWith("1. introduction") ||
      headingText.startsWith("introduction");

    if (isIntro) {
      let nextElement = heading.nextElementSibling;
      let introText = "";

      // Collect paragraphs after the intro heading
      let iterations = 0;
      // --- (IMPROVEMENT 1) ---
      // Removed character limit to scrape full section
      // 'Smart Truncation' will be applied in background.js
      while (nextElement && iterations < 20) {
        // Limit to 20 paragraphs
        iterations++;

        if (nextElement.tagName === "P" || nextElement.tagName === "DIV") {
          const text = nextElement.textContent.trim();
          if (text.length > 50) {
            introText += text + " ";
          }
        } else if (nextElement.tagName.match(/^H[1-6]$/)) {
          // Stop at next heading (e.g., "2. Methods" or "Related Work")
          const nextHeadingText = nextElement.textContent.toLowerCase().trim();
          if (!nextHeadingText.startsWith("1.") && nextHeadingText.length > 0) {
            break;
          }
        }

        nextElement = nextElement.nextElementSibling;
      }

      if (introText.length > 100) {
        console.log(
          "[NovaMind] Extracted introduction text:",
          introText.length,
          "chars"
        );
        return introText.trim();
      }
    }
  }
  console.log("[NovaMind] Could not extract introduction from DOM");
  return null;
}

function extractConclusionFromDOM() {
  // Try looking for paragraph after "Conclusion" heading
  const headings = document.querySelectorAll(
    "h2, h3, h4, strong, b, .section-title"
  );
  for (const heading of headings) {
    const headingText = heading.textContent.toLowerCase().trim();
    const isConclusion =
      headingText === "conclusion" ||
      headingText === "conclusions" ||
      headingText.includes("discussion") ||
      headingText.includes("future work") ||
      headingText.includes("limitations");

    if (isConclusion) {
      let nextElement = heading.nextElementSibling;
      let conclusionText = "";

      // Collect paragraphs after the conclusion heading
      let iterations = 0;
      // --- (IMPROVEMENT 1) ---
      // Removed character limit to scrape full section
      // 'Smart Truncation' will be applied in background.js
      while (nextElement && iterations < 20) {
        // Limit to 20 paragraphs
        iterations++;

        if (nextElement.tagName === "P" || nextElement.tagName === "DIV") {
          const text = nextElement.textContent.trim();
          if (text.length > 50) {
            conclusionText += text + " ";
          }
        } else if (nextElement.tagName.match(/^H[1-6]$/)) {
          // Stop at next heading (e.g., "References")
          const nextHeadingText = nextElement.textContent.toLowerCase().trim();
          if (nextHeadingText.includes("reference")) {
            break;
          }
        }

        nextElement = nextElement.nextElementSibling;
      }

      if (conclusionText.length > 100) {
        console.log(
          "[NovaMind] Extracted conclusion text:",
          conclusionText.length,
          "chars"
        );
        return conclusionText.trim();
      }
    }
  }
  console.log("[NovaMind] Could not extract conclusion from DOM");
  return null;
}

function extractAuthorsFromDOM() {
  // Try to find authors using common patterns
  const authorSelectors = [
    '[class*="author" i]:not([class*="author-list" i])',
    '[class*="contributor" i]',
    '[id*="author" i]',
    '[class*="creator" i]',
    '[rel="author"]',
    'a[href*="/author/"]',
    '[data-test*="author" i]',
  ];

  const authors = [];

  for (const selector of authorSelectors) {
    const elements = document.querySelectorAll(selector);

    for (const element of elements) {
      const text = element.textContent.trim();

      // Filter out obvious non-author text
      if (
        text.length > 2 &&
        text.length < 100 &&
        !text.toLowerCase().includes("author") &&
        !text.toLowerCase().includes("contact") &&
        !text.includes("@") &&
        !text.toLowerCase().includes("affiliation")
      ) {
        // Check if it looks like a name (has at least one space, period, or comma)
        if (text.includes(" ") || text.includes(".") || text.includes(",")) {
          authors.push(text);
          if (authors.length >= 10) break; // Limit to first 10 authors
        }
      }
    }

    if (authors.length > 0) break;
  }

  // Remove duplicates and join
  const uniqueAuthors = [...new Set(authors)];
  return uniqueAuthors.length > 0
    ? uniqueAuthors.slice(0, 10).join(", ")
    : null;
}

function extractMainContent() {
  // Extract main content as fallback
  // Look for the largest block of text that's likely the main content

  const contentSelectors = [
    "main",
    "article",
    '[role="main"]',
    "#content",
    ".content",
    "#main",
    ".main",
    ".article-content",
    ".paper-content",
  ];

  for (const selector of contentSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      // Get all paragraphs
      const paragraphs = element.querySelectorAll("p");
      let content = "";

      for (const p of paragraphs) {
        const text = p.textContent.trim();
        if (text.length > 50) {
          content += text + " ";
          if (content.length > 1500) break; // Limit content length
        }
      }

      if (content.length > 200) {
        return content.trim();
      }
    }
  }

  // Ultimate fallback: get first few substantial paragraphs from body
  const allParagraphs = document.querySelectorAll("p");
  let fallbackContent = "";

  for (const p of allParagraphs) {
    const text = p.textContent.trim();
    if (text.length > 100) {
      fallbackContent += text + " ";
      if (fallbackContent.length > 1000) break;
    }
  }

  return fallbackContent.trim();
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractContent") {
    extractPaperContent()
      .then((paperData) => {
        sendResponse({ success: !!paperData, data: paperData });
      })
      .catch((error) => {
        console.error("Extract content error:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response
  } else if (request.action === "detectSite") {
    const site = detectSite();
    sendResponse({ detected: !!site, site: site ? site.key : null });
    return true;
  }
});

// Notify popup when page loads
window.addEventListener("load", () => {
  const site = detectSite();
  if (site) {
    chrome.runtime
      .sendMessage({
        action: "siteDetected",
        site: site.key,
      })
      .catch(() => {
        // Ignore errors if popup is not open
      });
  }
});
