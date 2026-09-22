# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-powered video generation tool that uses an AI agent to generate Remotion video scenes. The system consists of:
- **Client**: React + Vite frontend with shadcn/ui components
- **Server**: Express backend with AI SDK ToolLoopAgent for scene generation
- **Remotion**: Video rendering workspace with reusable animation components

## Development Commands

```bash
# Install dependencies (run once after clone)
npm install

# Start both client and server (recommended for development)
npm run dev

# Start all three workspaces including Remotion studio
npm run dev:all

# Start Remotion studio only (on port 3100)
npm run dev:remotion

# Build client for production
npm run build

# Client-specific commands (from client/ directory)
npm run dev        # Start Vite dev server on port 8080
npm run build      # Build for production
npm run lint       # Run ESLint
npm run test       # Run Vitest tests
npm run test:watch # Run tests in watch mode

# Server-specific commands (from server/ directory)
npm run dev        # Start server with tsx watch on port 3001
npm run start      # Start server without watch mode
npm run test       # Run server tests

# Remotion-specific commands (from remotion/ directory)
npm run dev        # Start Remotion studio
npm run build      # Bundle Remotion project
npm run render     # Render a specific composition
```

## Architecture

### Monorepo Structure
- **client/**: Vite + React frontend with TypeScript
  - Uses shadcn/ui component library (Radix UI primitives)
  - TanStack Query for data fetching
  - React Router for navigation (/, /generating, /storyboard, /editor, /export)
  - Path alias: `@/` → `client/src/`
  - Vite proxy: `/api` and `/previews` → `http://localhost:3001`

- **server/**: Express backend with AI SDK integration
  - Main entry: `src/index.ts`
  - Agent: `src/agents/remotion-agent.ts` (ToolLoopAgent with Claude Sonnet 4)
  - Tools: `src/tools/` (fileWriter, think, remotion-files, write-scene, trigger-preview, render-scene)
  - Routes: `src/routes/agent.ts` (POST /api/agent/chat, GET /api/agent/render-status/:sceneId)
  - Serves rendered videos from `server/public/previews/`

- **remotion/**: Remotion video rendering workspace
  - Entry: `src/index.ts` registers Root.tsx compositions
  - Components: `src/components/` - reusable animation primitives
  - Scenes: `src/scenes/` - AI-generated scene components (output directory)
  - Prompts: `prompts/` - AI agent instructions and component catalog

### AI Agent Architecture

The Remotion Agent (`remotionAgent`) uses the AI SDK's ToolLoopAgent with:
- **Model**: Claude Sonnet 4 via AI Gateway (`gateway("anthropic/claude-sonnet-4")`)
- **Instructions**: Loaded from `remotion/prompts/DIRECTOR_SYSTEM_PROMPT.md` + component catalog
- **Tools**:
  - `think`: Planning and reasoning
  - `readFile`/`listFiles`: Explore remotion directory
  - `writeSceneCode`: Write scene TSX to `remotion/src/scenes/`
  - `triggerPreview`: Register scene in `remotion/src/Root.tsx`
  - `renderScene`: Shell out to `remotion render` CLI to generate MP4

**Critical Agent Workflow** (enforced in prompts):
1. Think first using `think` tool
2. Explore if needed with `listFiles`/`readFile`
3. Write scene with `writeSceneCode`
4. Register with `triggerPreview`
5. **MUST** call `renderScene` after `triggerPreview` (videos aren't auto-generated)

### Scene Registry System

The system dynamically manages Remotion compositions:
- Agent writes scene TSX files to `remotion/src/scenes/`
- `triggerPreview` tool modifies `remotion/src/Root.tsx` to add `<Composition>` entry
- `renderScene` tool runs `remotion render <sceneId>` to generate MP4
- Rendered videos land in `server/public/previews/<sceneId>.mp4`
- Client polls `/api/agent/render-status/:sceneId` to detect completion

### Component Library

Remotion has pre-built animation components in `remotion/src/components/`:
- **AnimatedText**: Text animations with presets (fade, slide, typewriter, etc.)
- **Background**: Dynamic backgrounds (gradients, noise, meshes, etc.)
- **MockupFrame**: Device mockups (iPhone, Browser, Card frames)
- **Camera**: Camera movements and effects
- **Layout**: BentoGrid and MotionContainer layouts
- **TextChoreography**: Advanced text animations (BounceReveal, CatchUpText, TextCycle, MorphText)
- **UIDemo**: UI walkthrough animations
- **DynamicCursor**: Animated cursor movements
- **Transitions**: Iris and other scene transitions

Scenes should import from `@/components` (path alias configured).

## Environment Variables

- **Server** (`server/.env`, never commit): an AI provider key matching whichever provider is
  uncommented in `server/src/lib/gateway.ts` — Google AI Studio (`GOOGLE_GENERATIVE_AI_API_KEY`)
  by default. `AGENT_MODEL` overrides the model id.
- **Client** (`client/.env`, never commit): `VITE_API_PROXY_TARGET` is **required** — the Vite dev
  server throws on startup without it (see `client/vite.config.ts`).

## Key Conventions

### Remotion Scene Development
- All animations MUST use `useCurrentFrame()` - NO CSS animations or Tailwind animate classes
- Use `spring()` for smooth entrances with appropriate damping
- Always clamp interpolations with `extrapolateRight: 'clamp'`
- `spring()` does NOT have a delay parameter - subtract from frame instead
- Scene components go in `remotion/src/scenes/` with PascalCase filenames
- Import statement pattern: `import { Component } from "@/components/Component"`

### Code Style
- TypeScript throughout (strict mode)
- Functional React components with explicit typing
- shadcn/ui conventions for client UI components
- ESLint configuration in `client/eslint.config.js`

### Testing
- Vitest for both client and server
- Client tests: `client/src/test/`
- Server tests: `server/src/__tests__/`
- Playwright config exists at `client/playwright.config.ts`

## Common Workflows

### Adding a New Scene
1. Write scene component in `remotion/src/scenes/SceneName.tsx`
2. Update `remotion/src/scenes/index.ts` to export the new scene
3. Add `<Composition>` entry in `remotion/src/Root.tsx`
4. Run `npm run dev:remotion` to preview in Remotion studio
5. Use `remotion render` CLI to generate MP4

### Modifying Agent Behavior
- Edit `remotion/prompts/DIRECTOR_SYSTEM_PROMPT.md` for agent instructions
- Edit `remotion-components/COMPONENT-CATALOG.md` for component documentation
- Prompts are loaded via `server/src/lib/prompt-loader.ts`

### Adding AI Tools
1. Create tool in `server/src/tools/`
2. Register in `server/src/agents/remotion-agent.ts` tools object
3. Tool implementations use Zod schemas for parameters

## Project Ports
- Client (Vite): 8080
- Server (Express): 3001
- Remotion Studio: 3100

## Important Notes
- The client ignores changes in `remotion/` and `server/` directories (Vite watch config)
- Rendered videos can take 30-90 seconds to generate (normal for Remotion)
- The agent MUST call `renderScene` explicitly - previews are NOT auto-generated
- Scene registry is managed programmatically by tools, not manually edited
