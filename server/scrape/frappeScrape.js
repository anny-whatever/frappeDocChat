import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import * as cheerio from "cheerio";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const BASE_URL = "https://docs.frappe.io";
const START_ROUTE = "framework/user/en/introduction";
const OUTPUT_DIR = join(__dirname, "..", "scraped_docs");
const DELAY_MS = 1000; // Delay between requests to be respectful

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Helper function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function to clean text
function cleanText(text) {
  return text
    .replace(/\n{3,}/g, "\n\n") // Replace multiple newlines with double newlines
    .replace(/[ \t]+/g, " ") // Replace multiple spaces with single space
    .trim();
}

// Helper function to create safe filename from route
function routeToFilename(route) {
  return route.replace(/\//g, "_") + ".json";
}

// Helper function to extract title from content
function extractTitleFromContent(content) {
  if (!content) return null;

  // Try to find the first line that looks like a title
  const lines = content.split("\n").filter((line) => line.trim());
  if (lines.length > 0) {
    const firstLine = lines[0].trim();
    // If the first line is short and doesn't end with punctuation, it's likely a title
    if (firstLine.length < 100 && !firstLine.match(/[.!?]$/)) {
      return firstLine;
    }
  }

  return null;
}

// Function to fetch and parse a page
async function fetchPage(route) {
  const url = `${BASE_URL}/${route}`;
  console.log(`Fetching: ${url}`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const html = await response.text();
    return html;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    return null;
  }
}

// Function to extract all routes from sidebar
function extractAllRoutes(html) {
  const $ = cheerio.load(html);
  const routes = [];

  // Find all sidebar items with data-route attribute that start with "framework"
  $('[data-route^="framework"]').each((_, el) => {
    const route = $(el).attr("data-route");
    if (route && !routes.includes(route)) {
      routes.push(route);
    }
  });

  return routes;
}

// Function to extract content from HTML
function parsePageContent(html) {
  const $ = cheerio.load(html);

  // Try to find the main content area - look for the wiki page content specifically
  const contentSelectors = [
    ".wiki-content",
    ".from-markdown",
    "article.wiki-page",
    "main",
    "[data-path] .container",
  ];

  let content = null;
  for (const selector of contentSelectors) {
    const element = $(selector);
    if (element.length > 0) {
      content = element.first().text();
      break;
    }
  }

  // If we couldn't find content with specific selectors, get all paragraph and heading content
  if (!content) {
    const textElements = $("p, h1, h2, h3, h4, h5, h6, li, code, pre");
    content = textElements
      .map((_, el) => $(el).text())
      .get()
      .join("\n");
  }

  return cleanText(content || "");
}

// Main scraping function
async function scrapeAll() {
  console.log("Starting Frappe documentation scraper...\n");

  // First, fetch the starting page to extract all routes from the sidebar
  console.log("Fetching sidebar to extract all routes...");
  const initialHtml = await fetchPage(START_ROUTE);

  if (!initialHtml) {
    console.error("Failed to fetch initial page. Exiting...");
    return;
  }

  const allRoutes = extractAllRoutes(initialHtml);
  console.log(`Found ${allRoutes.length} routes to scrape\n`);

  let successCount = 0;
  let failCount = 0;

  // Scrape each route
  for (let i = 0; i < allRoutes.length; i++) {
    const route = allRoutes[i];
    console.log(`\n[${i + 1}/${allRoutes.length}] Processing: ${route}`);

    // Fetch the page
    const html = await fetchPage(route);
    if (!html) {
      console.log("✗ Failed to fetch page");
      failCount++;
      await delay(DELAY_MS);
      continue;
    }

    // Parse content
    const content = parsePageContent(html);

    // Create document data with source URL
    const documentData = {
      route: route,
      sourceUrl: `${BASE_URL}/${route}`,
      title: extractTitleFromContent(content) || route.split("/").pop(),
      content: content,
      scrapedAt: new Date().toISOString(),
    };

    // Save content to file (now as JSON)
    const filename = routeToFilename(route);
    const filepath = join(OUTPUT_DIR, filename);

    try {
      writeFileSync(filepath, JSON.stringify(documentData, null, 2), "utf-8");
      console.log(`✓ Saved: ${filename} (${content.length} chars)`);
      successCount++;
    } catch (error) {
      console.error(`✗ Error saving ${filename}:`, error.message);
      failCount++;
    }

    // Delay before next request
    await delay(DELAY_MS);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`✓ Scraping complete!`);
  console.log(`  Successfully scraped: ${successCount} pages`);
  console.log(`  Failed: ${failCount} pages`);
  console.log(`  Files saved to: ${OUTPUT_DIR}`);
  console.log("=".repeat(50));
}

// Run the scraper
scrapeAll().catch(console.error);
