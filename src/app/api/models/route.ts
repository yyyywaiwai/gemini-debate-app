import { NextResponse } from 'next/server';

// IMPORTANT: In a real-world application, you should never hardcode API keys.
// Use environment variables instead.
const API_KEY = 'AIzaSyDgT2iynBTPbyavRAtgAf1F4tPP_Gc87xE';

const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

const MAX_RETRIES = 40;
const RETRY_DELAY = 500; // ms

interface GeminiModel {
  name: string; // e.g., "models/gemini-pro"
  displayName: string;
  description: string;
  supportedGenerationMethods: string[];
}

export async function GET() {
  let lastError: Error | null = null;

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await fetch(GEMINI_API_URL);

      if (response.ok) {
        const data = await response.json();
        const filteredModels = data.models
          .filter((model: GeminiModel) => 
            model.supportedGenerationMethods.includes('generateContent')
          )
          .map((model: GeminiModel) => ({
            id: model.name.split('/').pop(),
            name: model.displayName,
          }))
          .sort((a: {id: string}, b: {id: string}) => b.id.localeCompare(a.id));

        if (!filteredModels || filteredModels.length === 0) {
          return NextResponse.json({ error: 'No compatible models available' }, { status: 404 });
        }

        return NextResponse.json({ models: filteredModels, retries: i }); // Success
      }

      if (response.status === 403) {
        lastError = new Error(`Attempt ${i + 1} failed with 403 Forbidden`);
        console.log(`${lastError.message}. Retrying after ${RETRY_DELAY}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        continue; // Go to next iteration
      }

      // For other non-ok statuses, throw an error immediately
      const errorBody = await response.text();
      throw new Error(`API request failed with status ${response.status}: ${errorBody}`);

    } catch (error) {
      lastError = error as Error;
      // If it's a network error or other fetch-related error, retry
      console.log(`Attempt ${i + 1} failed with error: ${error}. Retrying after ${RETRY_DELAY}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }

  // If the loop finishes, all retries failed
  console.error('Error in /api/models after all retries:', lastError);
  const errorMessage = lastError instanceof Error ? lastError.message : 'An unknown error occurred';
  return NextResponse.json({ error: 'Failed to fetch models after all retries', details: errorMessage }, { status: 500 });
}