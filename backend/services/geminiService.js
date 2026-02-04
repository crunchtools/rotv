// Polyfill fetch for Node.js environments where it's not globally available
import fetch, { Headers, Request, Response } from 'node-fetch';
if (!globalThis.fetch) {
  globalThis.fetch = fetch;
  globalThis.Headers = Headers;
  globalThis.Request = Request;
  globalThis.Response = Response;
}

import { GoogleGenerativeAI } from '@google/generative-ai';

// Default prompt templates - designed to avoid generic AI slop
const DEFAULT_PROMPTS = {
  gemini_prompt_brief: `You are a local historian writing for the Cuyahoga Valley National Park visitor guide.

Research and write a 2-3 sentence overview for: {{name}}

REQUIREMENTS:
- Include at least one specific date, name, or verifiable fact
- Mention what visitors can actually see or do there TODAY
- NO generic phrases like "rich history", "beloved destination", "step back in time"
- If you cannot find specific facts, say "Historical details pending research"

Location context: {{era}}, {{property_owner}}`,

  gemini_prompt_historical: `You are writing for Arcadia Publishing's "Images of America" series about Cuyahoga Valley.

Research and write 2-3 paragraphs about: {{name}}

REQUIREMENTS:
- Include specific dates, names of people, and historical events
- Reference primary sources when possible (newspapers, deeds, oral histories)
- Describe what the place looked like historically vs today
- Connect to broader Ohio & Erie Canal corridor history if relevant
- NO filler phrases: avoid "rich tapestry", "testament to", "bygone era"
- If information is uncertain, say "According to local accounts..." or "Records suggest..."
- If you cannot verify facts, acknowledge the gaps

Location context: Era: {{era}}, Owner: {{property_owner}}`
};

// Research prompt for filling all fields - {{activities_list}}, {{eras_list}}, and {{surfaces_list}} placeholders will be filled dynamically
const RESEARCH_PROMPT_TEMPLATE = `You are a researcher for Cuyahoga Valley National Park. Search the web and find accurate information about this location.

Location to research: {{name}}
{{#if coordinates}}Coordinates: {{latitude}}, {{longitude}}{{/if}}

Search for information from NPS.gov, Ohio History Connection, local historical societies, and reliable sources.

Return a JSON object with these fields (use null if you cannot find reliable information):

{
  "era": "The primary historical era - MUST be one from the ALLOWED ERAS list below",
  "property_owner": "Current owner/manager (e.g., 'Federal (NPS)', 'Cleveland Metroparks', 'Private')",
  "primary_activities": "Comma-separated activities from the ALLOWED ACTIVITIES list ONLY",
  "surface": "Trail/path surface type - MUST be one from the ALLOWED SURFACES list below",
  "pets": "Pet policy: 'Yes', 'No', or 'Leashed'",
  "brief_description": "2-3 sentences with specific facts about what makes this place notable. Include dates and names.",
  "historical_description": "2-3 paragraphs of historical narrative with specific dates, people, and events. Written in warm local history style.",
  "sources": ["Array of source URLs or references used"]
}

ALLOWED ERAS (era MUST be one of these exact names):
{{eras_list}}

ALLOWED ACTIVITIES (only use activities from this list):
{{activities_list}}

ALLOWED SURFACES (surface MUST be one of these exact names):
{{surfaces_list}}

IMPORTANT:
- For era, you MUST select exactly one era from the ALLOWED ERAS list above based on when this place was most historically significant
- For primary_activities, ONLY use activities from the ALLOWED ACTIVITIES list above
- For surface, you MUST select exactly one surface from the ALLOWED SURFACES list above based on the trail/path surface type
- Select activities that apply to this specific location based on what's actually available there
- Only include facts you can verify from search results
- Use null for fields where you have no reliable information
- Avoid generic filler text - specific facts or nothing
- The brief_description and historical_description should contain real, searchable facts`;

/**
 * Get default prompt for a given key
 */
export function getDefaultPrompt(promptKey) {
  return DEFAULT_PROMPTS[promptKey] || '';
}

/**
 * Initialize Gemini client with API key from database or environment
 * Priority: 1) Environment variable (for CI/testing), 2) Database, 3) Google Sheet restore
 * @param {Pool} pool - Database connection pool
 * @param {Object} sheets - Optional Google Sheets API client for auto-restore
 */
export async function createGeminiClient(pool, sheets = null) {
  // Check environment variable first (for CI/testing)
  if (process.env.GEMINI_API_KEY) {
    console.log('[Gemini] Using API key from environment variable');
    return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }

  // Otherwise check database (production path)
  let result = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'gemini_api_key'"
  );

  // If not in database and sheets client provided, try to pull from Integration sheet
  if ((!result.rows.length || !result.rows[0].value) && sheets) {
    try {
      console.log('Gemini API key not in database, attempting to restore from Google Sheet...');
      const { pullIntegrationFromSheets } = await import('./sheetsSync.js');
      await pullIntegrationFromSheets(sheets, pool);

      // Re-check database after pull
      result = await pool.query(
        "SELECT value FROM admin_settings WHERE key = 'gemini_api_key'"
      );
    } catch (pullError) {
      console.warn('Failed to pull API key from sheet:', pullError.message);
    }
  }

  if (!result.rows.length || !result.rows[0].value) {
    throw new Error('Gemini API key not configured. Please add your API key in Settings, or pull from Google Sheet (Integration tab).');
  }

  return new GoogleGenerativeAI(result.rows[0].value);
}

/**
 * Get prompt template from database with fallback to defaults
 */
export async function getPromptTemplate(pool, promptKey) {
  const result = await pool.query(
    'SELECT value FROM admin_settings WHERE key = $1',
    [promptKey]
  );

  if (result.rows.length && result.rows[0].value) {
    return result.rows[0].value;
  }

  return getDefaultPrompt(promptKey);
}

/**
 * Replace {{placeholder}} variables with actual destination data
 */
export function interpolatePrompt(template, destination) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = destination[key];
    if (value === null || value === undefined || value === '') {
      return '(not specified)';
    }
    return String(value);
  });
}

/**
 * Get the interpolated prompt (template with placeholders filled in)
 */
export async function getInterpolatedPrompt(pool, promptKey, destination) {
  const template = await getPromptTemplate(pool, promptKey);
  return interpolatePrompt(template, destination);
}

/**
 * Generate text content using Gemini with Google Search grounding
 */
export async function generateText(pool, promptKey, destination, sheets = null) {
  const genAI = await createGeminiClient(pool, sheets);

  // Enable Google Search grounding for better factual content
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    tools: [{
      googleSearch: {}
    }]
  });

  const template = await getPromptTemplate(pool, promptKey);
  const prompt = interpolatePrompt(template, destination);

  console.log(`Generating ${promptKey} for destination: ${destination.name} (with Google Search)`);

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  return text;
}

/**
 * Generate text content using a custom prompt with Google Search grounding
 */
export async function generateTextWithCustomPrompt(pool, customPrompt, sheets = null) {
  const genAI = await createGeminiClient(pool, sheets);

  // Enable Google Search grounding
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    tools: [{
      googleSearch: {}
    }]
  });

  console.log(`Generating with custom prompt (${customPrompt.length} chars, with Google Search)`);

  const result = await model.generateContent(customPrompt);
  const response = result.response;
  const text = response.text();

  return text;
}

/**
 * Research a location and return structured data for all fields
 * @param {object} pool - Database pool
 * @param {object} destination - Destination data with name, coordinates, etc.
 * @param {string[]} availableActivities - List of standardized activity names
 * @param {string[]} availableEras - List of standardized era names
 * @param {string[]} availableSurfaces - List of standardized surface names
 * @param {object} sheets - Optional Google Sheets API client for auto-restore of API key
 */
export async function researchLocation(pool, destination, availableActivities = [], availableEras = [], availableSurfaces = [], sheets = null) {
  const genAI = await createGeminiClient(pool, sheets);

  // Enable Google Search grounding for research
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    tools: [{
      googleSearch: {}
    }]
  });

  // Build the prompt with the activities, eras, and surfaces lists
  let promptTemplate = RESEARCH_PROMPT_TEMPLATE;
  const activitiesList = availableActivities.length > 0
    ? availableActivities.join(', ')
    : 'Hiking, Biking, Photography, Bird Watching, Fishing, Picnicking, Camping, Wildlife Viewing, Historical Tours';
  promptTemplate = promptTemplate.replace('{{activities_list}}', activitiesList);

  const erasList = availableEras.length > 0
    ? availableEras.join(', ')
    : 'Pre-Colonial, Early Settlement, Canal Era, Railroad Era, Industrial Era, Conservation Era, Modern Era';
  promptTemplate = promptTemplate.replace('{{eras_list}}', erasList);

  const surfacesList = availableSurfaces.length > 0
    ? availableSurfaces.join(', ')
    : 'Paved, Gravel, Boardwalk, Dirt, Grass, Sand, Rocky, Water, Rail, Mixed';
  promptTemplate = promptTemplate.replace('{{surfaces_list}}', surfacesList);

  const prompt = interpolatePrompt(promptTemplate, destination);

  console.log(`Researching location: ${destination.name} (with Google Search, ${availableActivities.length} activities, ${availableEras.length} eras, ${availableSurfaces.length} surfaces available)`);

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  try {
    // Try to extract JSON from the response
    // Sometimes Gemini returns markdown code blocks or duplicated JSON
    let jsonText = text;

    // Remove markdown code blocks if present
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    // If there are multiple JSON objects, take the first complete one
    const firstBrace = jsonText.indexOf('{');
    if (firstBrace > 0) {
      jsonText = jsonText.substring(firstBrace);
    }

    // Find the matching closing brace for the first opening brace
    let braceCount = 0;
    let endIndex = -1;
    for (let i = 0; i < jsonText.length; i++) {
      if (jsonText[i] === '{') braceCount++;
      if (jsonText[i] === '}') braceCount--;
      if (braceCount === 0 && jsonText[i] === '}') {
        endIndex = i + 1;
        break;
      }
    }

    if (endIndex > 0) {
      jsonText = jsonText.substring(0, endIndex);
    }

    const data = JSON.parse(jsonText);
    return data;
  } catch (e) {
    console.error('Failed to parse research response as JSON:', e);
    console.error('Raw response:', text);
    throw new Error('AI returned invalid format. Please try again.');
  }
}

/**
 * Test API key validity with a simple request
 */
export async function testApiKey(pool, sheets = null) {
  const genAI = await createGeminiClient(pool, sheets);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent('Respond with exactly: API key verified');
  const text = result.response.text();

  return text;
}

// Example SVGs for icon generation prompt
const EXAMPLE_SVGS = `
Example 1 - Waterfall (blue background, water flowing):
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="15" fill="#0288d1" stroke="white" stroke-width="2"/>
  <path d="M12 8 L12 18 Q12 22 16 22 Q20 22 20 18 L20 8" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M10 24 Q16 20 22 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"/>
</svg>

Example 2 - Trail/Hiking (brown background, person hiking):
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="15" fill="#8B4513" stroke="white" stroke-width="2"/>
  <circle cx="16" cy="9" r="3" fill="white"/>
  <path d="M16 12 L16 18 M12 24 L16 18 L20 24 M13 15 L19 15" stroke="white" stroke-width="2" stroke-linecap="round" fill="none"/>
</svg>

Example 3 - Historic Building (orange background, house shape):
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="15" fill="#e65100" stroke="white" stroke-width="2"/>
  <path d="M10 24 L10 14 L16 8 L22 14 L22 24 Z" fill="none" stroke="white" stroke-width="2"/>
  <rect x="14" y="18" width="4" height="6" fill="white"/>
</svg>
`;

/**
 * Generate an SVG icon using Gemini AI
 * @param {object} pool - Database pool
 * @param {string} description - Description of what the icon should depict
 * @param {string} color - Hex color for the background circle (e.g., "#0288d1")
 * @param {object} sheets - Optional Google Sheets API client for auto-restore of API key
 * @returns {Promise<string>} - Generated SVG content
 */
export async function generateIconSvg(pool, description, color, sheets = null) {
  const genAI = await createGeminiClient(pool, sheets);

  // Don't use Google Search for icon generation - we want creative output
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash'
  });

  const prompt = `You are an icon designer. Generate a simple, minimal SVG map marker icon.

STRICT REQUIREMENTS:
- ViewBox: 0 0 32 32
- Background: A circle with cx="16" cy="16" r="15" fill="${color}" stroke="white" stroke-width="2"
- Icon elements: White stroked paths on top of the circle, stroke-width="2" or "2.5"
- Style: Simple, recognizable from a distance, minimal detail
- Keep it very simple - just 2-4 path/shape elements max for the icon itself
- Use stroke="white" and fill="none" for most paths, or fill="white" for solid shapes
- Icon must fit INSIDE the circle (stay within the 6-26 coordinate range)
- Output: ONLY valid SVG code, no markdown, no explanation, no extra text

ICON TO CREATE: ${description}

STYLE EXAMPLES (follow this exact format and simplicity level):
${EXAMPLE_SVGS}

Generate ONLY the SVG code now, starting with <svg and ending with </svg>:`;

  console.log(`Generating icon SVG for: ${description} (color: ${color})`);

  const result = await model.generateContent(prompt);
  const response = result.response;
  let text = response.text();

  // Clean up the response - extract just the SVG
  text = text.trim();

  // Remove markdown code blocks if present
  const svgMatch = text.match(/```(?:svg|xml)?\s*([\s\S]*?)```/);
  if (svgMatch) {
    text = svgMatch[1].trim();
  }

  // Find the SVG tag
  const svgStart = text.indexOf('<svg');
  const svgEnd = text.lastIndexOf('</svg>');

  if (svgStart === -1 || svgEnd === -1) {
    throw new Error('AI did not return valid SVG code. Please try again.');
  }

  text = text.substring(svgStart, svgEnd + 6); // +6 for </svg>

  // Basic validation - check it has the required structure
  if (!text.includes('viewBox="0 0 32 32"') && !text.includes("viewBox='0 0 32 32'")) {
    // Try to fix missing viewBox
    text = text.replace('<svg', '<svg viewBox="0 0 32 32"');
  }

  // Ensure xmlns is present
  if (!text.includes('xmlns=')) {
    text = text.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  return text;
}
