// Content script to extract paper content from any research website

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
    return true; // PDFs are likely research papers
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

async function extractPaperContent() {
  const site = detectSite();
  if (!site) {
    return null;
  }

  return extractFromPage();
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
    'meta[name="twitter:description"]',
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
