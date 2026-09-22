# Fusion

Fusion is an AI-powered video creation tool that helps creators overcome the "blank canvas" problem. It lets you instantly generate, orchestrate, and edit video scenes using code (Remotion) through a conversational AI interface or by extracting data directly from a URL drop.

Designed for creators, marketers, and developers, Fusion makes motion graphics accessible by blending AI-powered automation with precise, timeline-based editing.

## Key Features

*   **Conversational Video Generation:** Chat with an intuitive AI interface to generate videos effortlessly. 
*   **Code-Based Scenes:** Get crisp, fully editable React components for every scene using Remotion.
*   **Precise Timeline Editing:** A multi-track timeline allows you to adjust the timing of different media elements on the generated scenes.
*   **Brand Asset Extraction:** Drop a URL to automatically pull logos, colors, and fonts to keep your videos on-brand.
*   **Custom Animations:** Turn static assets into dynamic, animated video content seamlessly.

## Team Contributions

> **NOTE FOR JUDGES:** Here’s who did what—both technical and non-technical contributions are highlighted.

*   **Daniel Fadehan** — *Software Engineer (Lead Developer)*
    *   **Technical:** Spearheaded the vast majority of the repository's technical execution. Implemented the Vercel AI SDK `ToolLoopAgent` on the Node.js backend, built the core React/Vite frontend (including the multi-track timeline), and authored the Remotion video generation workspace. 
    *   **Non-Technical:** Managed the complex monorepo architecture and deployment processes across the client, server, and Remotion workspaces.

*   **Taiwo Ayomide** — *Software Engineer (Product & UI)*
    *   **Technical:** Executed UI modifications and refinements in the frontend to align the application's aesthetic. Developed the URL brand extraction.
    *   **Non-Technical:** Involved in the crucial planning phase of the project. Contributed to defining the product requirements, structured the initial architecture plans.

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm

### Install Dependencies
From the root of the project:
```bash
npm install
```

### Set Up Environment Variables

**Server** — create `server/.env` (see `server/.env.example`) with an AI provider key. The active
provider is whichever one is uncommented in `server/src/lib/gateway.ts` — Google AI Studio by default:
```ini
GOOGLE_GENERATIVE_AI_API_KEY=your_google_generative_ai_api_key
# AI_GATEWAY_API_KEY=your_ai_gateway_api_key
# GROQ_API_KEY=your_groq_api_key
# ANTHROPIC_API_KEY=your_anthropic_api_key

USE_LOCAL_RENDER=true
```

**Client** — create `client/.env` (see `client/.env.example`). This is required — the Vite dev
server refuses to start without `VITE_API_PROXY_TARGET`:
```ini
VITE_API_PROXY_TARGET=http://localhost:3001
VITE_ENABLE_PAYWALL=false
```

### Run the Application
You can start the project using the scripts in `package.json`:

*   **Start everything (Client, Server, & Remotion Studio):**
    ```bash
    npm run dev:all
    ```
*   **Start only Client & Server:**
    ```bash
    npm run dev
    ```
*   **Start only Remotion Studio:**
    ```bash
    npm run dev:remotion
    ```

## Demo / Testing Credentials
For testing purposes, you can use the following details:

Card: <code>5060 9905 8000 0217 499</code><br>
Expiry: <code>03/50</code><br>
CVV: <code>111</code><br>
PIN: <code>1111</code><br>
OTP: <code>123456</code>

## Project Structure
This project is a monorepo with three main parts:
- `client/` — React + Vite frontend with Tailwind CSS, Framer Motion, and shadcn/ui components.
- `server/` — Express backend integrating the Vercel AI SDK (ToolLoopAgent).
- `remotion/` — Workspace for video rendering with reusable, code-based animation components.