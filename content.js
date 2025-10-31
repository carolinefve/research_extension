// Configure the PDF.js worker script path if the library is loaded.
if (typeof pdfjsLib !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
    "extensions/pdfjs/pdf.worker.min.js"
  );
} else {
  console.error(
    "[NovaMind] pdfjsLib is not defined. Check manifest.json content_scripts array."
  );
}

// Attempts to identify if the current website is a supported academic site.
function detectSite() {
  const hostname = window.location.hostname;
  const url = window.location.href.toLowerCase();

  // Define a dictionary of explicitly supported academic sites and their rules.
  const supportedSites = {
    "arxiv.org": {
      key: "arXiv",
      domain: "arxiv.org",
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

  // Check if current site is in the explicit list.
  for (const [key, site] of Object.entries(supportedSites)) {
    if (site.isSupported) {
      return {
        key: site.key,
        domain: site.domain,
      };
    }
  }

  // Fallback: check if it looks like a research paper on an unsupported site.
  if (looksLikeResearchPaper()) {
    return {
      key: getSiteName(hostname), // Generate a user-friendly name.
      domain: hostname,
    };
  }

  return null;
}

// Generates a clean, display-friendly name from a hostname.
function getSiteName(hostname) {
  // Remove common prefixes and TLDs.
  const cleaned = hostname
    .replace(/^www\./, "")
    .replace(/^m\./, "")
    .split(".")[0];

  // Capitalise the first letter.
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

// Uses heuristics to determine if an unrecognised page is a research paper.
function looksLikeResearchPaper() {
  // First, check if the document is a PDF.
  const isPDF =
    document.contentType === "application/pdf" ||
    window.location.href.toLowerCase().endsWith(".pdf") ||
    document.querySelector("embed[type='application/pdf']") ||
    document.querySelector("object[type='application/pdf']");

  if (isPDF) {
    console.log("[NovaMind] Detected PDF document");
    // For PDFs, we rely on URL patterns to determine if it is a research paper.
    const url = window.location.href.toLowerCase();
    const researchPdfPatterns = [
      /arxiv\.org/,
      /\.edu\/.*\.pdf/, // .edu domains hosting PDFs.
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

  // If not a PDF, check the HTML body for indicators.
  const bodyText = document.body.textContent.toLowerCase();

  // A list of boolean checks for common paper elements.
  const indicators = [
    bodyText.includes("abstract"),
    document.querySelector('meta[name="citation_title"]'),
    document.querySelector('meta[name="DC.title"]'),
    document.querySelector('meta[property="og:type"][content="article"]'),
    document.body.textContent.match(/\b10\.\d{4,}/), // DOI
    bodyText.includes("keywords"),
    bodyText.includes("references") || bodyText.includes("bibliography"),
    document.querySelector('[class*="author" i]') ||
      document.querySelector('[id*="author" i]'),
    bodyText.includes("published") || bodyText.includes("journal"),
    bodyText.includes("introduction") || bodyText.includes("conclusion"),
  ];

  // If at least 3 indicators are present, assume it is a research paper.
  const score = indicators.filter(Boolean).length;
  return score >= 3;
}

// Fetches the /abs/ page for an arXiv PDF to get reliable metadata.
async function extractArxivDataFromPdfUrl() {
  const pdfUrl = window.location.href;

  // 1. Convert the PDF URL to its corresponding /abs/ (abstract) page URL.
  const absUrl = pdfUrl.replace("/pdf/", "/abs/").replace(".pdf", "");

  let fetchedTitle = null;
  let fetchedAbstract = null;
  let fetchedAuthors = null;

  try {
    // 2. Fetch the HTML content of the /abs/ page.
    console.log(`[NovaMind] Fetching metadata from ${absUrl}`);
    const response = await fetch(absUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch /abs/ page: ${response.statusText}`);
    }
    const htmlText = await response.text();

    // 3. Parse the fetched HTML text into a DOM document.
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");

    // 4. Extract reliable metadata from the parsed HTML.
    const titleElement = doc.querySelector("h1.title");
    if (titleElement) {
      fetchedTitle = titleElement.textContent.replace("Title:", "").trim();
    }

    const abstractElement = doc.querySelector("blockquote.abstract-full");
    if (abstractElement) {
      fetchedAbstract = abstractElement.textContent
        .replace(/^Abstract\s*:/i, "")
        .trim();
    }

    const authorsElement = doc.querySelector("div.authors");
    if (authorsElement) {
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
    // If fetching fails, we will just fall back to the PDF parser's results.
  }

  // 5. We still need the full text (Introduction/Conclusion) from the PDF itself.
  let intro = "";
  let conclusion = "";
  let fullText = "";
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
    parsedTitle = parsed.title; // Get fallback title from PDF.
    parsedAbstract = parsed.abstract; // Get fallback abstract from PDF.
  } catch (pdfError) {
    console.error(
      "[NovaMind] PDF text extraction failed during /abs/ fetch:",
      pdfError
    );
  }

  // 6. Combine and return the data.
  // Prioritise the fetched metadata, but use parsed data as a fallback.
  return {
    title:
      fetchedTitle || parsedTitle || extractTitleFromURL() || "Untitled Paper",
    abstract: fetchedAbstract || parsedAbstract || "",
    authors: fetchedAuthors || "", // Authors are hard to parse from PDF.
    content:
      fetchedAbstract || parsedAbstract || intro || fullText.substring(0, 3000),
    introductionText: intro,
    conclusionText: conclusion,
    url: window.location.href,
    site: "arXiv",
    extractedFromPDF: true,
  };
}

// Main function to extract paper content, routing to PDF or HTML methods.
async function extractPaperContent() {
  const site = detectSite();
  if (!site) {
    return null;
  }

  // Special case for arXiv PDFs: fetch metadata from the /abs/ page.
  if (site.key === "arXiv" && isPDFPage()) {
    console.log(
      "[NovaMind] arXiv PDF detected. Using /abs/ page fetch strategy."
    );
    return await extractArxivDataFromPdfUrl();
  }

  // For all other PDFs, use the generic PDF text extractor.
  if (isPDFPage()) {
    console.log("[NovaMind] PDF detected - using PDF text extraction");
    return await extractFromPDF();
  }

  // For standard HTML pages, use DOM extraction.
  return extractFromPage();
}

// Helper function to check if the current page is displaying a PDF.
function isPDFPage() {
  return (
    document.contentType === "application/pdf" ||
    window.location.href.toLowerCase().endsWith(".pdf") ||
    document.querySelector("embed[type='application/pdf']") ||
    document.querySelector("object[type='application/pdf']")
  );
}

// Generic function to extract and parse text from any PDF.
async function extractFromPDF() {
  try {
    console.log("[NovaMind] Starting PDF text extraction...");

    if (typeof pdfjsLib === "undefined") {
      throw new Error("PDF.js library (pdfjsLib) is not loaded.");
    }

    // Extract raw text from the PDF URL.
    const pdfUrl = window.location.href;
    const fullText = await extractTextFromPDF(pdfUrl);

    if (!fullText || fullText.length < 100) {
      throw new Error("Failed to extract sufficient text from PDF");
    }

    console.log("[NovaMind] Extracted", fullText.length, "characters from PDF");

    // Parse the raw text to find paper sections.
    const parsed = parseResearchPaperFromText(fullText);
    const site = detectSite();

    return {
      title: parsed.title || extractTitleFromURL() || "Untitled Paper",
      abstract: parsed.abstract || "",
      authors: "", // PDFs do not reliably expose author info.
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
    // Fallback to a basic extraction if parsing fails.
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

// Core PDF.js function to extract raw text from a PDF document.
async function extractTextFromPDF(pdfUrl) {
  try {
    const pdfjsLib = window.pdfjsLib;

    // Load the PDF document.
    const loadingTask = pdfjsLib.getDocument({
      url: pdfUrl,
      verbosity: 0, // Reduce console spam.
    });

    const pdf = await loadingTask.promise;
    console.log(`[NovaMind] PDF loaded: ${pdf.numPages} pages`);

    // Extract text from the first 10 pages (for Intro/Abstract).
    const maxPages = Math.min(pdf.numPages, 10);
    let fullText = "";

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const pageText = textContent.items
        .map((item) => item.str)
        .join(" ")
        .replace(/\s+/g, " "); // Normalise spaces.
      fullText += pageText + "\n\n";
    }

    // Also try to get the last few pages for the conclusion.
    if (pdf.numPages > maxPages) {
      const lastPages = Math.max(pdf.numPages - 5, maxPages + 1);
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

// Parses raw text to find the Title, Abstract, Introduction, and Conclusion.
function parseResearchPaperFromText(fullText) {
  console.log("[NovaMind] Parsing paper structure from text...");
  const result = {
    title: "",
    abstract: "",
    introduction: "",
    conclusion: "",
  };

  const cleanedText = fullText.replace(/\s+/g, " ").replace(/\n+/g, "\n");

  // 1. Define regex for our section "anchors" (headings).
  const abstractRegex = /\b(Abstract|Summary)\b[\s\n:]*/i;
  const introRegex = /\b(1\.?|I\.?)\s*Introduction\b/i;
  const conclusionRegex =
    /\b(\d+\.?|[IVX]+\.?)\s*(Conclusion|Discussion|Limitations|Future Work)\b/i;
  const referencesRegex =
    /\b(References|REFERENCES|Bibliography|Acknowledgment[s]?)\b/i;

  // 2. Find the *index* (position) of these anchors.
  const abstractMatch = cleanedText.match(abstractRegex);
  const introMatch = cleanedText.match(introRegex);
  const conclusionMatch = cleanedText.match(conclusionRegex);
  const referencesMatch = cleanedText.match(referencesRegex);

  const abstractStartIndex = abstractMatch ? abstractMatch.index : -1;
  const introStartIndex = introMatch ? introMatch.index : -1;
  const conclusionStartIndex = conclusionMatch ? conclusionMatch.index : -1;
  const referencesStartIndex = referencesMatch ? referencesMatch.index : -1;

  const abstractEndIndex = abstractMatch
    ? abstractStartIndex + abstractMatch[0].length
    : -1;
  const introEndIndex = introMatch
    ? introStartIndex + introMatch[0].length
    : -1;
  const conclusionEndIndex = conclusionMatch
    ? conclusionStartIndex + conclusionMatch[0].length
    : -1;

  // 3. Determine the "end" points for each section.
  // Title ends where Abstract or Introduction begins.
  const endOfTitleIndex =
    abstractStartIndex !== -1 ? abstractStartIndex : introStartIndex;
  // Abstract ends where Introduction begins.
  const endOfAbstractIndex = introStartIndex;
  // Introduction ends where Conclusion or References begin.
  const endOfIntroIndex =
    conclusionStartIndex !== -1 ? conclusionStartIndex : referencesStartIndex;
  // Conclusion ends where References begin.
  const endOfConclusionIndex = referencesStartIndex;

  // 4. Extract Title.
  if (endOfTitleIndex !== -1) {
    let titleText = cleanedText.substring(0, endOfTitleIndex).trim();
    // Clean up common PDF artefacts (page numbers, arXiv watermarks).
    titleText = titleText
      .replace(/arXiv:\d+\.\d+v?\d*\s*\[.*\]\s*\d+\s*\w*\s*\d{4}/gi, "")
      .replace(/^\d+|\s+\d+$/g, "");

    const titleLines = titleText
      .split("\n")
      .filter((line) => line.trim().length > 15); // Filter out short junk lines.
    result.title = titleLines.join(" ").replace(/\s+/g, " ").trim();
  }
  // Fallback: If no anchors, try to get the first long line.
  if (!result.title && cleanedText.length > 100) {
    const fallbackTitleMatch = cleanedText.match(/^([^\n]{20,300}?)\n/m);
    if (fallbackTitleMatch) {
      result.title = fallbackTitleMatch[1].trim();
    }
  }
  console.log("[NovaMind] Extracted title:", result.title.substring(0, 80));

  // 5. Extract Abstract.
  if (abstractEndIndex !== -1 && endOfAbstractIndex !== -1) {
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

  // 6. Extract Introduction.
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

  // 7. Extract Conclusion.
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

// Fallback function to generate a title from the URL.
function extractTitleFromURL() {
  const url = window.location.href;

  // For arXiv, use the paper ID.
  const arxivMatch = url.match(/arxiv\.org\/(?:pdf|abs)\/(\d+\.\d+)/);
  if (arxivMatch) {
    return `arXiv:${arxivMatch[1]}`;
  }

  // For other URLs, try to get the filename.
  const filename = url.split("/").pop().replace(".pdf", "");
  if (filename && filename.length > 5) {
    return filename.replace(/[-_]/g, " ");
  }

  return null;
}

// Extracts paper content from a standard HTML page (not a PDF).
function extractFromPage() {
  console.log("[NovaMind] Extracting paper content from HTML page");

  // Strategy 1: Try meta tags (most reliable).
  let title = extractFromMeta();
  let abstract = extractAbstractFromMeta();
  let authors = extractAuthorsFromMeta();

  // Strategy 2: Try semantic HTML and common DOM patterns.
  if (!title) {
    title = extractTitleFromDOM();
  }
  if (!abstract) {
    abstract = extractAbstractFromDOM();
  }
  if (!authors) {
    authors = extractAuthorsFromDOM();
  }

  // Strategy 3: Extract Introduction and Conclusion text from the DOM.
  let introduction = extractIntroductionFromDOM();
  let conclusion = extractConclusionFromDOM();

  // Fallback: use the page's <title> tag.
  if (!title) {
    title = document.title.split("|")[0].split("-")[0].trim();
  }

  // Fallback: use main content if abstract is still missing.
  if (!abstract || abstract.length < 50) {
    abstract = extractMainContent();
  }

  const site = detectSite();

  return {
    title: title || "Untitled Paper",
    abstract: abstract || "",
    authors: authors || "",
    content: abstract || "", // 'content' is the primary text.
    introductionText: introduction || "",
    conclusionText: conclusion || "",
    url: window.location.href,
    site: site ? site.key : "generic",
  };
}

// Extracts the paper title from common meta tags.
function extractFromMeta() {
  // A list of common meta tag selectors for titles.
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

// Extracts the paper abstract from common meta tags.
function extractAbstractFromMeta() {
  // A list of common meta tag selectors for abstracts/descriptions.
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

// Extracts a list of authors from common meta tags.
function extractAuthorsFromMeta() {
  const selectors = [
    'meta[name="citation_author"]',
    'meta[name="DC.creator"]',
    'meta[name="author"]',
    'meta[property="article:author"]',
  ];
  const authors = [];

  for (const selector of selectors) {
    // Use querySelectorAll as some sites list authors in separate tags.
    const elements = document.querySelectorAll(selector);
    elements.forEach((el) => {
      if (el.content && el.content.trim()) {
        authors.push(el.content.trim());
      }
    });
  }
  return authors.length > 0 ? authors.join(", ") : null;
}

// Extracts the paper title from common DOM elements (H1, etc.).
function extractTitleFromDOM() {
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
      if (text.length < 300) {
        return text;
      }
    }
  }
  return null;
}

// Extracts the abstract text from common DOM elements.
function extractAbstractFromDOM() {
  // Try to find abstract using common class or ID patterns.
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
      let text = element.textContent.trim();
      // Remove common labels.
      text = text.replace(/^abstract[:\s]*/i, "");
      text = text.replace(/^summary[:\s]*/i, "");

      if (text.length > 100 && text.length < 5000) {
        return text;
      }
    }
  }

  // Fallback: Try looking for paragraphs after an "abstract" heading.
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
      let iterations = 0;
      while (nextElement && abstractText.length < 5000 && iterations < 10) {
        iterations++;
        if (nextElement.tagName === "P" || nextElement.tagName === "DIV") {
          const text = nextElement.textContent.trim();
          if (text.length > 50) {
            abstractText += text + " ";
          }
        } else if (nextElement.tagName.match(/^H[1-6]$/)) {
          break; // Stop at next heading.
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

// Extracts the introduction text from the DOM by finding its heading.
function extractIntroductionFromDOM() {
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
      let iterations = 0;
      // Scrape full section; truncation will be handled later.
      while (nextElement && iterations < 20) {
        iterations++;
        if (nextElement.tagName === "P" || nextElement.tagName === "DIV") {
          const text = nextElement.textContent.trim();
          if (text.length > 50) {
            introText += text + " ";
          }
        } else if (nextElement.tagName.match(/^H[1-6]$/)) {
          // Stop at next main heading.
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

// Extracts the conclusion/discussion text from the DOM by finding its heading.
function extractConclusionFromDOM() {
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
      let iterations = 0;
      // Scrape full section.
      while (nextElement && iterations < 20) {
        iterations++;
        if (nextElement.tagName === "P" || nextElement.tagName === "DIV") {
          const text = nextElement.textContent.trim();
          if (text.length > 50) {
            conclusionText += text + " ";
          }
        } else if (nextElement.tagName.match(/^H[1-6]$/)) {
          // Stop at next heading (e.g., "References").
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

// Extracts a list of authors from common DOM element patterns.
function extractAuthorsFromDOM() {
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

      // Filter out obvious non-author text.
      if (
        text.length > 2 &&
        text.length < 100 &&
        !text.toLowerCase().includes("author") &&
        !text.toLowerCase().includes("contact") &&
        !text.includes("@") &&
        !text.toLowerCase().includes("affiliation")
      ) {
        if (text.includes(" ") || text.includes(".") || text.includes(",")) {
          authors.push(text);
          if (authors.length >= 10) break; // Limit to 10 authors.
        }
      }
    }
    if (authors.length > 0) break;
  }

  const uniqueAuthors = [...new Set(authors)];
  return uniqueAuthors.length > 0
    ? uniqueAuthors.slice(0, 10).join(", ")
    : null;
}

// A fallback function to extract the main article text if the abstract is missing.
function extractMainContent() {
  // Look for the largest block of text in common containers.
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
      const paragraphs = element.querySelectorAll("p");
      let content = "";
      for (const p of paragraphs) {
        const text = p.textContent.trim();
        if (text.length > 50) {
          content += text + " ";
          if (content.length > 1500) break;
        }
      }
      if (content.length > 200) {
        return content.trim();
      }
    }
  }

  // Ultimate fallback: get first few substantial paragraphs from body.
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

// Listen for messages from the extension popup.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle the "extractContent" action from the popup.
  if (request.action === "extractContent") {
    extractPaperContent()
      .then((paperData) => {
        sendResponse({ success: !!paperData, data: paperData });
      })
      .catch((error) => {
        console.error("Extract content error:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response.

    // Handle the "detectSite" action.
  } else if (request.action === "detectSite") {
    const site = detectSite();
    sendResponse({ detected: !!site, site: site ? site.key : null });
    return true;
  }
});

// Notify the popup when a supported page loads.
window.addEventListener("load", () => {
  const site = detectSite();
  if (site) {
    chrome.runtime
      .sendMessage({
        action: "siteDetected",
        site: site.key,
      })
      .catch(() => {
        // Ignore errors if popup is not open.
      });
  }
});
