const { v4 } = require("uuid");
const {
  PuppeteerWebBaseLoader,
} = require("langchain/document_loaders/web/puppeteer");
const { writeToServerDocuments } = require("../../utils/files");
const { tokenizeString } = require("../../utils/tokenizer");
const { default: slugify } = require("slugify");
const {
  returnResult,
  determineContentType,
  processAsFile,
} = require("../helpers");
const {
  loadYouTubeTranscript,
} = require("../../utils/extensions/YoutubeTranscript");
const RuntimeSettings = require("../../utils/runtimeSettings");
const { htmlToMarkdown } = require("../helpers/htmlToMarkdown");
const { decodePathname } = require("../../utils/url");

/**
 * Scrape a generic URL and return the content in the specified format
 * @param {Object} config - The configuration object
 * @param {string} config.link - The URL to scrape
 * @param {('html' | 'text')} config.captureAs - The format to capture the page content as. Default is 'text'
 * @param {{[key: string]: string}} config.scraperHeaders - Custom headers to use when making the request
 * @param {{[key: string]: string}} config.metadata - Metadata to use when creating the document
 * @param {Object} config.options - The collector options sent by the server, used when the link is a file
 * @param {boolean} config.saveAsDocument - Whether to save the content as a document. Default is true
 * @returns {Promise<Object>} - The content of the page
 */
async function scrapeGenericUrl({
  link,
  captureAs = "text",
  scraperHeaders = {},
  metadata = {},
  options = {},
  saveAsDocument = true,
}) {
  /** @type {'web' | 'file' | 'youtube'} */
  console.log(`-- Working URL ${link} => (captureAs: ${captureAs}) --`);
  let { contentType, processVia } = await determineContentType(link);
  console.log(`-- URL determined to be ${contentType} (${processVia}) --`);

  /**
   * When the content is a file or a YouTube video, we can use the existing processing functions
   * These are self-contained and will return the correct response based on the saveAsDocument flag already
   * so we can return the content immediately.
   */
  if (processVia === "file")
    return await processAsFile({
      uri: link,
      saveAsDocument,
      metadata,
      options,
    });
  else if (processVia === "youtube")
    return await loadYouTubeTranscript(
      { url: link },
      { parseOnly: saveAsDocument === false }
    );

  // Otherwise, assume the content is a webpage and scrape the content from the webpage
  const content = await getPageContent({
    link,
    captureAs,
    headers: scraperHeaders,
  });
  if (!content || !content.length) {
    console.error(`Resulting URL content was empty at ${link}.`);
    return returnResult({
      success: false,
      reason: `No URL content found at ${link}.`,
      documents: [],
      content: null,
      saveAsDocument,
    });
  }

  // If the captureAs is text, return the content as a string immediately
  // so that we dont save the content as a document
  if (!saveAsDocument)
    return returnResult({
      success: true,
      content,
      saveAsDocument,
    });

  // Save the content as a document from the URL
  const url = new URL(link);
  const decodedPathname = decodePathname(url.pathname);
  const filename = `${url.hostname}${decodedPathname.replace(/\//g, "_")}`;
  const data = {
    id: v4(),
    url: "file://" + slugify(filename) + ".html",
    title: metadata.title || slugify(filename) + ".html",
    docAuthor: metadata.docAuthor || "no author found",
    description: metadata.description || "No description found.",
    docSource: metadata.docSource || "URL link uploaded by the user.",
    chunkSource: `link://${link}`,
    published: new Date().toLocaleString(),
    wordCount: content.split(" ").length,
    pageContent: content,
    token_count_estimate: tokenizeString(content),
  };

  const document = writeToServerDocuments({
    data,
    filename: `url-${slugify(filename)}-${data.id}`,
  });
  console.log(`[SUCCESS]: URL ${link} converted & ready for embedding.\n`);
  return { success: true, reason: null, documents: [document] };
}

/**
 * Validate the headers object
 * - Keys & Values must be strings and not empty
 * - Assemble a new object with only the valid keys and values
 * @param {{[key: string]: string}} headers - The headers object to validate
 * @returns {{[key: string]: string}} - The validated headers object
 */
function validatedHeaders(headers = {}) {
  try {
    if (Object.keys(headers).length === 0) return {};
    let validHeaders = {};
    for (const key of Object.keys(headers)) {
      if (!key?.trim()) continue;
      if (typeof headers[key] !== "string" || !headers[key]?.trim()) continue;
      validHeaders[key] = headers[key].trim();
    }
    return validHeaders;
  } catch (error) {
    console.error("Error validating headers", error);
    return {};
  }
}

/**
 * Get the content of a page
 * @param {Object} config - The configuration object
 * @param {string} config.link - The URL to get the content of
 * @param {('html' | 'text')} config.captureAs - The format to capture the page content as. Default is 'text'
 * @param {{[key: string]: string}} config.headers - Custom headers to use when making the request
 * @returns {Promise<string>} - The content of the page
 */
async function getPageContent({ link, captureAs = "text", headers = {} }) {
  try {
    let pageContents = [];
    const runtimeSettings = new RuntimeSettings();

    /** @type {import('puppeteer').PuppeteerLaunchOptions} */
    let launchConfig = { headless: "new" };

    /* On MacOS 15.1, the headless=new option causes the browser to crash immediately.
     * It is not clear why this is the case, but it is reproducible. Since AnythinglLM
     * in production runs in a container, we can disable headless mode to workaround the issue for development purposes.
     *
     * This may show a popup window when scraping a page in development mode.
     * This is expected behavior if seen in development mode on MacOS 15+
     */
    if (
      process.platform === "darwin" &&
      process.env.NODE_ENV === "development"
    ) {
      console.log(
        "Darwin Development Mode: Disabling headless mode to prevent Chromium from crashing."
      );
      launchConfig.headless = "false";
    }

    const loader = new PuppeteerWebBaseLoader(link, {
      launchOptions: {
        headless: launchConfig.headless,
        ignoreHTTPSErrors: true,
        args: runtimeSettings.get("browserLaunchArgs"),
      },
      gotoOptions: {
        waitUntil: "networkidle2",
      },
      async evaluate(page, browser) {
        const innerHTML = await page.evaluate(
          () => document.documentElement.innerHTML
        );
        await browser.close();
        if (captureAs === "html") return innerHTML;
        return htmlToMarkdown(innerHTML, link);
      },
    });

    // RagmyAI: always override the scrape method (not only when custom headers
    // are set) to block image/media/font requests and iframe navigations, and to
    // always close Chrome in a finally. Without this, some sites froze the server
    // (ragmyai-v1.8.5.9 / v1.8.5.10). Custom headers are still applied when set.
    let overrideHeaders = validatedHeaders(headers);
    loader.scrape = async function () {
      const { launch } = await PuppeteerWebBaseLoader.imports();
      const browser = await launch({
        headless: "new",
        defaultViewport: null,
        ignoreDefaultArgs: ["--disable-extensions"],
        ...this.options?.launchOptions,
      });
      try {
        const page = await browser.newPage();
        if (Object.keys(overrideHeaders).length > 0) {
          await page.setExtraHTTPHeaders(overrideHeaders);
        }

        await page.setRequestInterception(true);
        page.on("request", (req) => {
          const url = req.url().split("?")[0];
          if (
            // Iframes (embedded PDFs, chart/ticker widgets, video players...)
            // - their content is not part of document.body.innerText anyway
            (req.isNavigationRequest() && req.frame() !== page.mainFrame()) ||
            ["image", "media", "font"].includes(req.resourceType()) ||
            /\.(webp|png|jpe?g|gif|avif|bmp|ico|svg|mp4|webm|mov|m4v|m3u8|mp3|wav|ogg|woff2?|ttf|otf)$/i.test(url)
          ) {
            return req.abort().catch(() => {});
          }
          return req.continue().catch(() => {});
        });

        await page.goto(this.webPath, {
          timeout: 180000,
          waitUntil: "networkidle2",
          ...this.options?.gotoOptions,
        });

        const bodyHTML = this.options?.evaluate
          ? await this.options.evaluate(page, browser)
          : await page.evaluate(() => document.body.innerHTML);

        return bodyHTML;
      } finally {
        // Always kill Chrome, even if goto/evaluate throws (e.g. navigation timeout)
        if (browser.isConnected()) await browser.close().catch(() => {});
      }
    };

    const docs = await loader.load();
    for (const doc of docs) pageContents.push(doc.pageContent);
    return pageContents.join(" ");
  } catch (error) {
    console.error(
      "getPageContent failed to be fetched by puppeteer - falling back to fetch!",
      error
    );
  }

  try {
    const pageText = await fetch(link, {
      method: "GET",
      headers: {
        "Content-Type": "text/plain",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)",
        ...validatedHeaders(headers),
      },
    }).then((res) => res.text());
    if (captureAs === "html") return pageText;
    return htmlToMarkdown(pageText, link);
  } catch (error) {
    console.error("getPageContent failed to be fetched by any method.", error);
  }

  return null;
}

module.exports = {
  scrapeGenericUrl,
};
