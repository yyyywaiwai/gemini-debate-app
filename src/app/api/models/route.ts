import { NextResponse } from 'next/server';

console.log('🔄 models/route.ts MODULE LOADED');

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error('API_KEY environment variable is required');
}

const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

const MAX_RETRIES = 500;
const RETRY_DELAY = 50; // ms

interface GeminiModel {
  name: string; // e.g., "models/gemini-pro"
  displayName: string;
  description: string;
  supportedGenerationMethods: string[];
}

export async function GET(request: Request) {
  const requestId = Math.random().toString(36).substr(2, 9);
  console.log(`[${requestId}] ========= MODELS API ROUTE CALLED =========`);
  console.log(`[${requestId}] Request URL: ${request.url}`);
  console.log(`[${requestId}] Request method: ${request.method}`);
  
  let lastError: Error | null = null;

  // For debugging: force success after 10 attempts to test the success path
  if (false) { // Change to true to test success path
    console.log(`[${requestId}] 🧪 TESTING: Forcing mock success response`);
    const mockData: { models: GeminiModel[] } = {
      models: [
        {
          name: "models/gemini-1.5-pro-latest",
          displayName: "Gemini 1.5 Pro (Latest)",
          description: "Mock model for testing",
          supportedGenerationMethods: ["generateContent"]
        },
        {
          name: "models/gemini-1.5-flash",
          displayName: "Gemini 1.5 Flash",
          description: "Mock model for testing",
          supportedGenerationMethods: ["generateContent"]
        }
      ]
    };
    
    console.log(`[${requestId}] 🧪 SUCCESS - Mock response:`, JSON.stringify(mockData, null, 2));
    const filteredModels = mockData.models
      .filter((model: GeminiModel) => model.supportedGenerationMethods.includes('generateContent'))
      .map((model: GeminiModel) => ({
        id: model.name.split('/').pop(),
        name: model.displayName,
      }));
    
    console.log(`[${requestId}] 🧪 SUCCESS RETURN EXECUTED - mock completed`);
    return NextResponse.json({ models: filteredModels, retries: 0 });
  }

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      console.log(`[${requestId}] Attempt ${i + 1}: Fetching ${GEMINI_API_URL}`);
      const response = await fetch(GEMINI_API_URL);
      console.log(`[${requestId}] Attempt ${i + 1}: Response status ${response.status} ${response.statusText}`);
      console.log(`[${requestId}] Attempt ${i + 1}: response.ok = ${response.ok}`);

      if (response.ok) {
        console.log(`[${requestId}] ✅✅✅ RESPONSE IS OK - PROCESSING ✅✅✅`);
        let data;
        try {
          data = await response.json();
          console.log(`[${requestId}] JSON parsed successfully`);
        } catch (jsonError) {
          console.error(`[${requestId}] JSON parse error:`, jsonError);
          throw jsonError;
        }
        
        console.log(`[${requestId}] SUCCESS after ${i + 1} attempts. Raw response:`, JSON.stringify(data, null, 2));
        console.log(`[${requestId}] Processing ${data.models?.length || 0} models...`);
        
        if (!data.models || !Array.isArray(data.models)) {
          console.error(`[${requestId}] No models array in response:`, data);
          throw new Error('Invalid response: no models array');
        }
        
        let filteredModels;
        try {
          filteredModels = data.models
            .filter((model: GeminiModel) => {
              const hasMethod = model.supportedGenerationMethods?.includes('generateContent');
              console.log(`[${requestId}] Model ${model.name}: hasGenerateContent=${hasMethod}`);
              return hasMethod;
            })
            .map((model: GeminiModel) => ({
              id: model.name.split('/').pop(),
              name: model.displayName,
            }))
            .sort((a: {id: string}, b: {id: string}) => b.id.localeCompare(a.id));
          console.log(`[${requestId}] Filtered to ${filteredModels.length} compatible models`);
        } catch (filterError) {
          console.error(`[${requestId}] Error during filtering:`, filterError);
          throw filterError;
        }

        if (!filteredModels || filteredModels.length === 0) {
          console.log(`[${requestId}] No compatible models found - returning 404`);
          const errorResult = NextResponse.json({ error: 'No compatible models available' }, { status: 404 });
          console.log(`[${requestId}] 404 RETURN EXECUTED`);
          return errorResult;
        }

        console.log(`[${requestId}] Returning ${filteredModels.length} models`);
        const result = NextResponse.json({ models: filteredModels, retries: i });
        console.log(`[${requestId}] SUCCESS RETURN EXECUTED - request completed`);
        return result; // Success
      }

      if (response.status === 403) {
        lastError = new Error(`Attempt ${i + 1} failed with 403 Forbidden`);
        console.log(`[${requestId}] ${lastError?.message || 'Unknown error'}. Retrying after ${RETRY_DELAY}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        continue; // Go to next iteration
      }

      // For other non-ok statuses, throw an error immediately
      const errorBody = await response.text();
      throw new Error(`API request failed with status ${response.status}: ${errorBody}`);

    } catch (error) {
      lastError = error as Error;
      // If it's a network error or other fetch-related error, retry
      console.log(`[${requestId}] Attempt ${i + 1} EXCEPTION: ${error}. Retrying after ${RETRY_DELAY}ms...`);
      console.error(`[${requestId}] Exception details:`, error);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }

  // If the loop finishes, all retries failed
  console.error(`[${requestId}] ========= FAILED AFTER ALL ${MAX_RETRIES} RETRIES =========`);
  console.error(`[${requestId}] Last error:`, lastError);
  console.error(`[${requestId}] API KEY being used: ${API_KEY.substring(0, 10)}...`);
  console.error(`[${requestId}] URL being called: ${GEMINI_API_URL}`);
  const errorMessage = lastError?.message || 'An unknown error occurred';
  const failureResult = NextResponse.json({ error: 'Failed to fetch models after all retries', details: errorMessage }, { status: 500 });
  console.error(`[${requestId}] ========= RETURNING HTTP 500 ERROR RESPONSE =========`);
  console.error(`[${requestId}] Response body:`, { error: 'Failed to fetch models after all retries', details: errorMessage });
  return failureResult;
}