<img width="700" height="674" alt="Logo" src="https://github.com/user-attachments/assets/e2812dfe-4d86-4290-ab86-aef7abcd16a5" />


# NovaMind

### Transform your browser into an intelligent research partner

NovaMind is a Chrome extension that uses Google's built-in AI to analyse research papers locally on your device. Extract key findings, discover connections between papers and simplify complex academic text. All without sending your data to external servers.

## 👀 Problem

**Reading research papers are overwhelming and time-consuming, specially if you are a beginner:**

- Takes 2-4 hours to thoroughly read and understand a single paper.

- Difficult to spot research opportunities and limitations.

- Dense academic writing slows comprehension.

## ✨ Key Features

**Smart Paper Analysis**

- Auto-extract: Summary, key findings, methodology, research gaps, future directions
- Supported in arXiv.org and IEEE Xplore
- Works with both HTML and PDF papers
- 30-60 second processing time
- Generate PDF reports of any analysis

**Connection Detection**

- Automatically finds relationships between your analysed papers
- Descriptions of how papers relate

**Text Assistant**

- Simplify complex text
- Explain concepts
- Ask questions about selected text
- Save highlights

**Dashboard**

- Centralised hub for all analyses
- Highlights panel

## 🌟 Google's built-in Chrome AI APIs Features

- **Absolute Privacy:** Your research data and analyses never leave your computer. No data is sent to an external server.

- **Works Offline:** Analyse papers, extract insights and browse your library even without an internet connection.

- **Zero Cost:** No API keys, subscriptions, or usage fees. All features are completely free.

## 💻 Technologies

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

## 📚 Key Libraries

- PDF.js: This library is used for reading and parsing PDF files directly in the browser.

- jsPDF: This library is used for writing and generating PDF files.

## 🏛️ License
MIT License

## ⚙️ Prerequisites & Installation

This extension relies on the built-in Chrome AI APIs (Gemini Nano), which have specific hardware and software requirements.

### Prerequisites

1. Hardware:

   - GPU: A device with at least 4GB of VRAM.

   - Storage: At least 22GB of free space for the on-device AI model download.

2. Browser:

   - Chrome Canary or Chrome Dev.

### Installation & Setup

1. Enable AI Feature Flags:

   - Open your browser and navigate to chrome://flags.

   - Search for and Enable all flags related to `Writer APi` `Summarization API` `Rewriter API` `Prompt API`.

   - Relaunch your browser.

2. Install the On-Device Model:

   - Navigate to `chrome://on-device-internals`.

   - Find the section for the `On-Device Foundation Model`.

   - Click `Download` or `Install`. This is a large download and may take a significant amount of time. Wait for it to complete.

3. Install the NovaMind Extension:

   - Download or clone this project repository to your local machine.

   - Navigate to `chrome://extensions`.

   - Enable `Developer mode`.

   - Click the `Load unpacked` button.

   - Select the folder where you downloaded the project.

## ⚠️ Troubleshooting

**Analyse Current Page button is disabled.**

- This is intentional. The button only activates when you are on a webpage that the extension recognises as a research paper (arxiv.org or ieeexplore.ieee.org).

- _Solution_: Navigate to a specific paper's page on a supported site. If you are on a supported page, try refreshing.

**Popup shows "Limited" or "Error" status.**

- This means the on-device AI APIs are not available.

- _Solution_: Carefully follow all steps in the section.

  - Confirm your computer meets the hardware requirements (4GB VRAM, 22GB free space).

  - Go to `chrome://on-device-internals` and confirm the Gemini Nano model is fully downloaded and installed.

  - Go to `chrome://flags` and ensure the AI-related flags are Enabled.

**Analysis fails or takes a long time.**

- PDF analysis is complex and can be slow for very large files.

- The very first analysis after an API error may fail.

- _Solution_: Try refreshing the page and running the analysis again. If a PDF fails, try to find the HTML (abstract) version of the paper.

## 🚀 Next Steps

- **Support for more research sites:** Expand compatibility beyond arXiv and IEEE Xplore to include other popular academic databases and journals.

- **Mindmap Visualisation:** Create a visual, interactive mindmap to explore the connections discovered between analysed papers.

- **Custom Note-Taking:** Allow users to add their own personal notes and thoughts to each paper analysis.

- **Image-based Assistant:** Enable the AI Assistant to analyze and answer questions about figures, graphs, and images within a paper.

- **Data Backup & Restore:** Add a feature to back up the local database of analyses and highlights to a file and restore it, preventing data loss.

- **Detailed Connection Analysis:** Enhance the connection feature to provide more detailed explanations of how and why two papers are related.

