import fetch, { Headers, Request, Response } from 'node-fetch';
if (!globalThis.fetch) {
  globalThis.fetch = fetch;
  globalThis.Headers = Headers;
  globalThis.Request = Request;
  globalThis.Response = Response;
}

import { GoogleGenerativeAI } from '@google/generative-ai';
import { logInfo, logError, flush as flushJobLogs } from './jobLogger.js';
import { getContainingBoundaries } from './geoService.js';

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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

// Handles markdown code blocks, duplicated JSON, and responses truncated mid-array by token limit
export function parseJsonResponse(text) {
  let jsonText = text;

  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  } else {
    // No closing ``` — response is truncated; salvage from the first {
    const openBrace = text.indexOf('{');
    if (openBrace >= 0) {
      jsonText = text.substring(openBrace);
    }
  }

  const firstBrace = jsonText.indexOf('{');
  if (firstBrace > 0) {
    jsonText = jsonText.substring(firstBrace);
  }

  // Skip braces inside quoted strings to avoid miscounting nested JSON
  let braceCount = 0;
  let bracketCount = 0;
  let endIndex = -1;
  let inString = false;
  for (let i = 0; i < jsonText.length; i++) {
    const ch = jsonText[i];
    if (ch === '"' && (i === 0 || jsonText[i - 1] !== '\\')) {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') braceCount++;
    if (ch === '}') braceCount--;
    if (ch === '[') bracketCount++;
    if (ch === ']') bracketCount--;
    if (braceCount === 0 && ch === '}') {
      endIndex = i + 1;
      break;
    }
  }

  if (endIndex > 0) {
    jsonText = jsonText.substring(0, endIndex);
  } else if (braceCount > 0) {
    // Truncated JSON — salvage by trimming incomplete trailing values and closing open brackets
    jsonText = jsonText.replace(/,\s*"[^"]*"?\s*$/, '');
    jsonText = jsonText.replace(/,\s*"[^"]*$/, '');
    jsonText = jsonText.replace(/,\s*$/, '');
    for (let i = 0; i < bracketCount; i++) jsonText += ']';
    for (let i = 0; i < braceCount; i++) jsonText += '}';
    console.warn('[parseJsonResponse] Salvaged truncated JSON by closing', bracketCount, 'brackets and', braceCount, 'braces');
  }

  return JSON.parse(jsonText);
}

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
  "sources": ["url1", "url2"]
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
- The brief_description and historical_description should contain real, searchable facts
- For sources, include MAXIMUM 5 unique URLs. No duplicate URLs.`;

// Env var takes priority over DB so CI/tests can override without DB setup
export async function createGeminiClient(pool) {
  if (process.env.GEMINI_API_KEY) {
    console.log('[Gemini] Using API key from environment variable');
    return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }

  const apiKeyQuery = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'gemini_api_key'"
  );

  if (!apiKeyQuery.rows.length || !apiKeyQuery.rows[0].value) {
    throw new Error('Gemini API key not configured. Please add your API key in Settings.');
  }

  return new GoogleGenerativeAI(apiKeyQuery.rows[0].value);
}

export async function getPromptTemplate(pool, promptKey) {
  const templateQuery = await pool.query(
    'SELECT value FROM admin_settings WHERE key = $1',
    [promptKey]
  );

  if (templateQuery.rows.length && templateQuery.rows[0].value) {
    return templateQuery.rows[0].value;
  }

  return DEFAULT_PROMPTS[promptKey] || '';
}

export function interpolatePrompt(template, destination) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = destination[key];
    if (value === null || value === undefined || value === '') {
      return '(not specified)';
    }
    return String(value);
  });
}

export async function getInterpolatedPrompt(pool, promptKey, destination) {
  const template = await getPromptTemplate(pool, promptKey);
  return interpolatePrompt(template, destination);
}

export async function generateText(pool, promptKey, destination) {
  const genAI = await createGeminiClient(pool);

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { temperature: 0 }
  });

  const template = await getPromptTemplate(pool, promptKey);
  const prompt = interpolatePrompt(template, destination);

  console.log(`Generating ${promptKey} for destination: ${destination.name}`);

  const generation = await model.generateContent(prompt);
  const response = generation.response;
  const text = response.text();

  return text;
}

export async function generateTextWithCustomPrompt(pool, customPrompt, options = {}) {
  const genAI = await createGeminiClient(pool);

  const generationConfig = { temperature: 0.3 };
  if (options.maxOutputTokens) generationConfig.maxOutputTokens = options.maxOutputTokens;
  if (options.thinkingBudget !== undefined) generationConfig.thinkingConfig = { thinkingBudget: options.thinkingBudget };

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig
  });

  console.log(`Generating with custom prompt (${customPrompt.length} chars)`);

  const generation = await model.generateContent(customPrompt);
  const response = generation.response;
  const text = response.text();

  return text;
}

export async function researchLocation(pool, destination, availableActivities = [], availableEras = [], availableSurfaces = []) {
  const genAI = await createGeminiClient(pool);

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { temperature: 0 }
  });

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

  const runId = Math.floor(Date.now() / 1000);
  console.log(`Researching location: ${destination.name} (${availableActivities.length} activities, ${availableEras.length} eras, ${availableSurfaces.length} surfaces available)`);
  logInfo(runId, 'research', null, destination.name, `Research: ${destination.name}`);

  const generation = await model.generateContent(prompt);
  const response = generation.response;
  const text = response.text();

  try {
    const researchData = parseJsonResponse(text);
    logInfo(runId, 'research', null, destination.name, `Research complete: ${destination.name}`, { completed: true, fields: Object.keys(researchData) });
    await flushJobLogs();
    return researchData;
  } catch (e) {
    console.error('Failed to parse research response as JSON:', e);
    console.error('Raw response:', text);
    logError(runId, 'research', null, destination.name, `Research failed: invalid AI response for ${destination.name}`, { completed: true, error_stack: text.slice(0, 500) });
    await flushJobLogs();
    throw new Error('AI returned invalid format. Please try again.');
  }
}

export async function testApiKey(pool) {
  const genAI = await createGeminiClient(pool);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const verification = await model.generateContent('Respond with exactly: API key verified');
  const text = verification.response.text();

  return text;
}

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

export async function generateIconSvg(pool, description, color) {
  const genAI = await createGeminiClient(pool);

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL
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

  const runId = Math.floor(Date.now() / 1000);
  console.log(`Generating icon SVG for: ${description} (color: ${color})`);
  logInfo(runId, 'research', null, null, `Icon generation: ${description} (${color})`);

  const iconGeneration = await model.generateContent(prompt);
  const response = iconGeneration.response;
  let text = response.text();

  text = text.trim();

  const svgMatch = text.match(/```(?:svg|xml)?\s*([\s\S]*?)```/);
  if (svgMatch) {
    text = svgMatch[1].trim();
  }

  const svgStart = text.indexOf('<svg');
  const svgEnd = text.lastIndexOf('</svg>');

  if (svgStart === -1 || svgEnd === -1) {
    throw new Error('AI did not return valid SVG code. Please try again.');
  }

  text = text.substring(svgStart, svgEnd + 6);

  if (!text.includes('viewBox="0 0 32 32"') && !text.includes("viewBox='0 0 32 32'")) {
    text = text.replace('<svg', '<svg viewBox="0 0 32 32"');
  }

  if (!text.includes('xmlns=')) {
    text = text.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  logInfo(runId, 'research', null, null, `Icon generated: ${description}`, { completed: true });
  await flushJobLogs();
  return text;
}

const RESEARCH_PASS1_TEMPLATE = `You are a researcher for Cuyahoga Valley National Park. Search the web and find accurate information about this location.

Location to research: {{name}}
%%OPTIONAL_SECTIONS%%

Search for information from NPS.gov, Ohio History Connection, local historical societies, and reliable sources.

Return a JSON object with these fields (use null if you cannot find reliable information):

{
  "era": "The primary historical era - MUST be one from the ALLOWED ERAS list below",
  "property_owner": "Current owner/manager (e.g., 'Federal (NPS)', 'Cleveland Metroparks', 'Private')",
  "primary_activities": "Comma-separated activities from the ALLOWED ACTIVITIES list ONLY",
  "surface": "Trail/path surface type - MUST be one from the ALLOWED SURFACES list below",
  "pets": "Pet policy: 'Yes', 'No', or 'Leashed'",
  "brief_description": "2-3 sentences with specific facts about what makes this place notable. Include dates and names. NO generic phrases like 'rich history', 'beloved destination'.",
  "sources": ["url1", "url2"]
}

ALLOWED ERAS (era MUST be one of these exact names):
{{eras_list}}

ALLOWED ACTIVITIES (only use activities from this list):
{{activities_list}}

ALLOWED SURFACES (surface MUST be one of these exact names):
{{surfaces_list}}

IMPORTANT:
- For era, you MUST select exactly one era from the ALLOWED ERAS list above
- For primary_activities, ONLY use activities from the ALLOWED ACTIVITIES list above
- For surface, you MUST select exactly one surface from the ALLOWED SURFACES list above
- Only include facts you can verify from search results
- Use null for fields where you have no reliable information
- Avoid generic filler text - specific facts or nothing
- For sources, include MAXIMUM 5 unique URLs. No duplicate URLs.`;

const RESEARCH_PASS2_TEMPLATE = `You are writing for Arcadia Publishing's "Images of America" series about Cuyahoga Valley.

Research and write 2-3 paragraphs about: {{name}}
%%OPTIONAL_SECTIONS%%

CONTEXT FROM INITIAL RESEARCH:
- Era: {{pass1_era}}
- Brief description: {{pass1_brief}}

Return a JSON object:

{
  "historical_description": "2-3 paragraphs of historical narrative with specific dates, people, and events. Written in warm local history style. Include specific dates, names of people, and historical events. Reference primary sources when possible. Describe what the place looked like historically vs today. Connect to broader Ohio & Erie Canal corridor history if relevant. NO filler phrases: avoid 'rich tapestry', 'testament to', 'bygone era'. If information is uncertain, say 'According to local accounts...' or 'Records suggest...'. If you cannot verify facts, acknowledge the gaps.",
  "additional_sources": ["Array of additional source URLs or references used"]
}`;

export async function researchLocationMultiPass(pool, destination, availableActivities = [], availableEras = [], availableSurfaces = []) {
  const genAI = await createGeminiClient(pool);

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { temperature: 0 }
  });

  const optionalSections = [];
  if (destination.latitude && destination.longitude) {
    optionalSections.push(`Coordinates: ${destination.latitude}, ${destination.longitude}`);
  }
  if (destination.more_info_link) {
    optionalSections.push(`PRIORITY SOURCE: Consult this URL first: ${destination.more_info_link}`);
  }
  if (destination.research_context) {
    optionalSections.push(`ADMIN CONTEXT (use this to guide your research): ${destination.research_context}`);
  }

  if (destination.id) {
    const boundaries = await getContainingBoundaries(pool, destination.id);
    if (boundaries.length > 0) {
      optionalSections.push(`Geographic context: Located in ${boundaries.join(', ')}`);
      console.log(`[Research v2] Geographic grounding for ${destination.name}: ${boundaries.join(', ')}`);
    }
  }

  let pass1Template = RESEARCH_PASS1_TEMPLATE;
  pass1Template = pass1Template.replace('%%OPTIONAL_SECTIONS%%', optionalSections.join('\n'));

  const activitiesList = availableActivities.length > 0
    ? availableActivities.join(', ')
    : 'Hiking, Biking, Photography, Bird Watching, Fishing, Picnicking, Camping, Wildlife Viewing, Historical Tours';
  pass1Template = pass1Template.replace('{{activities_list}}', activitiesList);

  const erasList = availableEras.length > 0
    ? availableEras.join(', ')
    : 'Pre-Colonial, Early Settlement, Canal Era, Railroad Era, Industrial Era, Conservation Era, Modern Era';
  pass1Template = pass1Template.replace('{{eras_list}}', erasList);

  const surfacesList = availableSurfaces.length > 0
    ? availableSurfaces.join(', ')
    : 'Paved, Gravel, Boardwalk, Dirt, Grass, Sand, Rocky, Water, Rail, Mixed';
  pass1Template = pass1Template.replace('{{surfaces_list}}', surfacesList);

  const pass1Prompt = interpolatePrompt(pass1Template, destination);

  const runId = Math.floor(Date.now() / 1000);
  console.log(`[Research v2] Pass 1 for: ${destination.name}`);
  logInfo(runId, 'research', null, destination.name, `Research v2 Pass 1: ${destination.name}`);

  const pass1Generation = await model.generateContent(pass1Prompt);
  const pass1Text = pass1Generation.response.text();
  let pass1Data;

  try {
    pass1Data = parseJsonResponse(pass1Text);
  } catch (e) {
    console.error('Failed to parse Pass 1 response:', pass1Text);
    logError(runId, 'research', null, destination.name, `Research v2 Pass 1 failed: ${destination.name}`, { error_stack: pass1Text.slice(0, 500) });
    await flushJobLogs();
    throw new Error('AI returned invalid format in Pass 1. Please try again.');
  }

  logInfo(runId, 'research', null, destination.name, `Research v2 Pass 1 complete: ${destination.name}`, { fields: Object.keys(pass1Data) });

  let pass2Template = RESEARCH_PASS2_TEMPLATE;
  pass2Template = pass2Template.replace('%%OPTIONAL_SECTIONS%%', optionalSections.join('\n'));
  pass2Template = pass2Template.replace('{{pass1_era}}', pass1Data.era || 'unknown');
  pass2Template = pass2Template.replace('{{pass1_brief}}', pass1Data.brief_description || 'no description available');

  const pass2Prompt = interpolatePrompt(pass2Template, destination);

  console.log(`[Research v2] Pass 2 for: ${destination.name}`);
  logInfo(runId, 'research', null, destination.name, `Research v2 Pass 2: ${destination.name}`);

  const pass2Generation = await model.generateContent(pass2Prompt);
  const pass2Text = pass2Generation.response.text();
  let pass2Data;

  try {
    pass2Data = parseJsonResponse(pass2Text);
  } catch (e) {
    console.error('Failed to parse Pass 2 response:', pass2Text);
    logError(runId, 'research', null, destination.name, `Research v2 Pass 2 failed: ${destination.name}`, { error_stack: pass2Text.slice(0, 500) });
    await flushJobLogs();
    throw new Error('AI returned invalid format in Pass 2. Please try again.');
  }

  let eraId = null;
  if (pass1Data.era) {
    const eraResult = await pool.query(
      'SELECT id FROM eras WHERE LOWER(name) = LOWER($1)',
      [pass1Data.era]
    );
    if (eraResult.rows.length > 0) {
      eraId = eraResult.rows[0].id;
    }
  }

  const mergedSources = [
    ...(pass1Data.sources || []),
    ...(pass2Data.additional_sources || [])
  ];

  const mergedResearch = {
    era: pass1Data.era,
    era_id: eraId,
    property_owner: pass1Data.property_owner,
    primary_activities: pass1Data.primary_activities,
    surface: pass1Data.surface,
    pets: pass1Data.pets,
    brief_description: pass1Data.brief_description,
    historical_description: pass2Data.historical_description,
    sources: mergedSources
  };

  logInfo(runId, 'research', null, destination.name, `Research v2 complete: ${destination.name}`, { completed: true, fields: Object.keys(mergedResearch) });
  await flushJobLogs();

  return mergedResearch;
}

export async function moderateContent(pool, content) {
  const genAI = await createGeminiClient(pool);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { temperature: 0 }
  });

  let sourceSection = '';
  if (content.source_page_content) {
    sourceSection = `
Source URL: ${content.source_url}
Source Page Content (rendered and converted to markdown):
---
${content.source_page_content}
---

CRITICAL: You must verify that the source page actually contains or references
the claimed title/summary. If the page exists but does NOT mention the specific
news/event, set confidence_score to 0.0 and add "content_not_on_source_page" to issues.`;
  } else {
    sourceSection = `Source: ${content.source_url || '(none)'}`;
  }

  const prompt = `You are a content moderator for Cuyahoga Valley National Park.
Evaluate this ${content.type} for accuracy and relevance.
Title: ${content.title}
Summary: ${content.summary || '(none)'}
${sourceSection}
Claimed POI: ${content.poi_name || '(unknown)'}

IMPORTANT: The claimed POI is an admin-curated location in our database.
Do NOT reject content just because a venue (e.g. Blossom Music Center) is "near"
rather than "inside" the park — venues near the park are valid POIs.

However, a valid POI does NOT mean all content about that POI is relevant.
This site is "Roots of The Valley" — a guide to Cuyahoga Valley National Park.
Content must connect to the park's mission: nature, trails, outdoor recreation,
conservation, local history, ecology, wildlife, community stewardship, scenic
railroads, canal towpath heritage, or arts/culture organizations that serve the valley.

For broad POIs like cities (e.g., "City of Cleveland", "City of Akron"):
- A nature photography exhibit in Cleveland → RELEVANT (arts + nature)
- A trail race through Akron → RELEVANT (outdoor recreation)
- A random bar show or concert in Cleveland → NOT RELEVANT (generic entertainment)
- A restaurant opening → NOT RELEVANT (urban dining)
- A community cleanup of a creek → RELEVANT (conservation + community)
Ask: "Would a Cuyahoga Valley National Park visitor care about this?"
If not, add "off_mission" to issues and score 0.0.

Score 0.0-1.0 on these criteria:
1. Geographic relevance: Verify the content is about Northeast Ohio / Cuyahoga Valley
   region. A name match alone is not enough — "Missing Link Trail" in CVNP is different
   from "Missing Link Snowmobile Club" in upstate New York. If the content describes a
   location clearly outside the CVNP region (different state, different country), add
   "wrong_geography" to issues and score 0.0.
2. Mission relevance: Does the content connect to nature, trails, outdoor recreation,
   conservation, local history, ecology, wildlife, community stewardship, heritage, or
   arts/culture organizations serving the valley? Generic urban entertainment, nightlife,
   dining, sports, or commercial activity unrelated to the park mission should be rejected.
   Add "off_mission" to issues and score 0.0.
3. Factual accuracy and source credibility
4. Content safety
5. Whether the source page actually contains this content
6. TIMELINESS: Is this actual news/event (timely, new information) or just a static
   reference page (permanent visitor info, place description, general park page)?
   Static pages that describe a location, trail, or facility are NOT news.
   Score static/reference content 0.0 and add "static_reference_page" to issues.
7. POI RELEVANCE: Remove the POI name from the content and re-read it. Is the article
   STILL about that POI? If not, the POI is just a geographic reference and the content
   is NOT relevant. The true test: what is the HEADLINE TOPIC of this content?
   - "Bus rapid transit lanes on West 25th" → topic is transit policy, NOT a bridge
   - "Bridge closure for construction" → topic IS the bridge
   - "Obituary for Jane Doe" → topic is a person, NOT a cemetery
   - "Concert at Blossom Music Center" → topic IS an event at a park venue (RELEVANT)
   - "Concert at a random Cleveland bar" → generic entertainment (NOT RELEVANT)
   - "Restaurant opening new location in Streetsboro" → topic is a DIFFERENT location,
     NOT the existing POI. News about other branches/locations of the same business
     is NOT relevant to the POI in our system.
   If the headline topic is NOT the specific POI location, add "wrong_poi" and score 0.0.
8. CONTENT TYPE: If this is classified as "${content.type}", is that correct?
   News articles that REPORT ON upcoming events are legitimate news — "Board to meet
   Tuesday," "5K planned for May," "Progress report scheduled." Most news is about
   something happening in the future. Do NOT reject these.
   Only add "misclassified_type" (score 0.0) if the content is a BARE event listing
   with no editorial content — just a date, time, venue, and registration link with
   no surrounding news narrative or context. If the article has a headline, a lede,
   quotes, background, or any journalistic framing, it is news, not a bare listing.
9. PRIVATE/PERSONAL CONTENT: Reject content about private individuals' personal events
   that happen to take place at a park location. Examples: wedding photography blog posts,
   personal trip reports, engagement announcements, family reunion recaps. These are not
   park news — they are private moments. Add "private_content" to issues and score 0.0.

NOTE: Old content is NOT a reason to reject. ROTV is a living history journal.

Return ONLY valid JSON (no markdown, no code blocks):
{"confidence_score": 0.0, "reasoning": "...", "issues": []}`;

  const geminiResponse = await model.generateContent(prompt);
  const text = geminiResponse.response.text().trim();

  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  try {
    return JSON.parse(jsonMatch[1].trim());
  } catch {
    console.error('[Gemini] Failed to parse moderation response:', text);
    return { confidence_score: 0.5, reasoning: 'Failed to parse AI response', issues: ['parse_error'] };
  }
}

export async function moderatePhoto(pool, photo) {
  const genAI = await createGeminiClient(pool);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { temperature: 0 }
  });

  const prompt = `You are reviewing a photo submitted for ${photo.poi_name} at
Cuyahoga Valley National Park. Does this photo:
1. Appear to show a park/nature/trail scene?
2. Contain NSFW content?
3. Contain identifiable faces (privacy concern)?
4. Appear relevant to the claimed location?

Return ONLY valid JSON (no markdown, no code blocks):
{"confidence_score": 0.0, "reasoning": "...", "flags": []}`;

  try {
    if (photo.image_url) {
      const imageResponse = await fetch(photo.image_url);
      if (imageResponse.ok) {
        const imageBuffer = await imageResponse.arrayBuffer();
        const base64 = Buffer.from(imageBuffer).toString('base64');
        const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';

        const visionResponse = await model.generateContent([
          prompt,
          { inlineData: { data: base64, mimeType } }
        ]);
        const visionText = visionResponse.response.text().trim();
        const visionMatch = visionText.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, visionText];
        return JSON.parse(visionMatch[1].trim());
      }
    }

    const fallbackResponse = await model.generateContent(prompt + '\n\nNote: Image could not be loaded for visual review. Score conservatively.');
    const fallbackText = fallbackResponse.response.text().trim();
    const fallbackMatch = fallbackText.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, fallbackText];
    return JSON.parse(fallbackMatch[1].trim());
  } catch (error) {
    console.error('[Gemini] Photo moderation failed:', error.message);
    return { confidence_score: 0.3, reasoning: 'Photo moderation failed: ' + error.message, flags: ['review_failed'] };
  }
}
