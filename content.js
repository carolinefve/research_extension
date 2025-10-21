// Content script to extract paper content from arXiv

function detectSite() {
  const hostname = window.location.hostname;
  if (hostname.includes("arxiv.org")) {
    return { key: "arxiv", domain: "arxiv.org" };
  }
  return null;
}

async function extractPaperContent() {
  const site = detectSite();
  if (!site) {
    return null;
  }

  // For arXiv PDF pages, fetch the abstract page
  if (window.location.pathname.includes("/pdf/")) {
    return await extractFromArxivPdf();
  }

  // For arXiv abstract pages, extract directly
  return extractFromArxivAbstract();
}

function extractFromArxivAbstract() {
  const getTextContent = (selector) => {
    const element = document.querySelector(selector);
    return element ? element.textContent.trim() : "";
  };

  const titleElement = document.querySelector("h1.title");
  const title = titleElement
    ? titleElement.textContent.replace("Title:", "").trim()
    : "";

  const abstractElement = document.querySelector("blockquote.abstract");
  const abstract = abstractElement
    ? abstractElement.textContent.replace("Abstract:", "").trim()
    : "";

  const authorsElement = document.querySelector(".authors");
  const authors = authorsElement
    ? authorsElement.textContent.replace("Authors:", "").trim()
    : "";

  return {
    title,
    abstract,
    authors,
    content: abstract,
    url: window.location.href,
    site: "arxiv",
  };
}

async function extractFromArxivPdf() {
  try {
    // Get the abstract URL from the PDF URL
    const pdfUrl = window.location.href;
    const abstractUrl = pdfUrl.replace("/pdf/", "/abs/").replace(".pdf", "");

    // Fetch the abstract page
    const response = await fetch(abstractUrl);
    const html = await response.text();

    // Parse the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Extract information
    const titleElement = doc.querySelector("h1.title");
    const title = titleElement
      ? titleElement.textContent.replace("Title:", "").trim()
      : "";

    const abstractElement = doc.querySelector("blockquote.abstract");
    const abstract = abstractElement
      ? abstractElement.textContent.replace("Abstract:", "").trim()
      : "";

    const authorsElement = doc.querySelector(".authors");
    const authors = authorsElement
      ? authorsElement.textContent.replace("Authors:", "").trim()
      : "";

    return {
      title,
      abstract,
      authors,
      content: abstract,
      url: abstractUrl, // Use abstract URL instead of PDF URL
      site: "arxiv",
    };
  } catch (error) {
    console.error("Failed to fetch arXiv abstract:", error);
    return null;
  }
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
