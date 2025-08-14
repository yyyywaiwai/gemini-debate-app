# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an AI debate application built with Next.js that orchestrates debates between two AI models using Google's Gemini API. The application features:

- Interactive debate interface with configurable AI personalities
- Real-time debate progression with message history
- Judge AI that provides final verdict after debates
- Retry mechanisms for handling API rate limits and failures
- Response time and retry count tracking

## Development Commands

### Build & Development
- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint checks

### Environment Requirements
- Set `API_KEY` environment variable with your Google Gemini API key
- Note: There's a hardcoded API key in the code that should be replaced with environment variable

## Architecture Overview

### App Structure (Next.js App Router)
- `src/app/page.tsx` - Main debate interface (client component)
- `src/app/layout.tsx` - Root layout with Bootstrap CSS
- `src/app/api/debate/route.ts` - Handles debate message generation
- `src/app/api/models/route.ts` - Fetches available Gemini models

### Key Components & Patterns

#### Main Debate Flow (`page.tsx`)
- Manages two AI configurations with different personalities
- Implements conversation history windowing (50 messages max)
- Handles turn-based debate progression (25 turns per AI max)
- Features client-side retry logic for network failures
- Includes judge AI for post-debate analysis

#### API Route Architecture
- Both routes implement server-side retry logic (40 retries) for 403 errors
- Uses Google Generative AI SDK with safety settings disabled
- Conversation history format matches Gemini API requirements (`role` + `parts`)

#### State Management Patterns
- React state for UI and conversation management
- Ref-based control for stopping debates mid-process
- Real-time thinking indicators with animated dots

### Conversation Flow
1. User configures topic, AI models, and personalities
2. System prompt initiates debate with 150-character constraint
3. AIs alternate responses with automatic prompts for counter-arguments
4. Judge AI analyzes complete debate and provides verdict
5. All conversations maintain proper role formatting for Gemini API

### Retry & Error Handling
- **Client-side**: 5 retries for network errors with 1s delay
- **Server-side**: 40 retries for 403 errors with 500ms delay
- Response time tracking for performance monitoring
- Graceful error display with dismissible alerts

## Key Configuration

### AI Personality System
- 5 preset personalities with embedded constraints
- Custom personality option with user-defined prompts
- All prompts include Japanese language and length constraints
- Emotional constraint enforced across all personalities

### API Integration
- Gemini models filtered by `generateContent` support
- Safety settings completely disabled for debate flexibility
- Max output tokens set to 500,000
- System instructions used for personality prompts

### UI Framework
- React Bootstrap for consistent styling
- Responsive design with containerized layout
- Real-time scroll management for chat log
- Loading states with spinners and progress indicators

## Development Notes

### When Adding Features
- Follow existing retry patterns for API calls
- Maintain conversation history format compatibility
- Use React Bootstrap components for UI consistency
- Implement proper TypeScript interfaces for data structures

### Testing Considerations
- Test retry mechanisms under rate limit conditions
- Verify conversation history windowing behavior
- Check responsive design across different screen sizes
- Validate Japanese text constraints are enforced