# Chronicle v3 Demo Guide

This guide explains how to run the Chronicle v3 demo, which showcases the full narrative engine with GM agent, narrator, telemetry, and deterministic systems.

## Prerequisites

- Node.js (v18 or later)
- npm or yarn
- OpenAI API key (optional, but recommended for full experience)

## Quick Start

### Option 1: Web UI Demo (Recommended)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the API server** (in one terminal):
   ```bash
   npm run demo:server
   ```
   The server will start on `http://localhost:3001` by default.

3. **Start the web UI** (in another terminal):
   ```bash
   npm run demo:web
   ```
   The UI will be available at `http://localhost:5173` (or the port Vite assigns).

4. **Open your browser** and navigate to the UI URL.

5. **Enter your OpenAI API key** in the input field at the top of the page.

6. **Start playing!** The initial narration will appear automatically. Type commands like:
   - "look around"
   - "go north"
   - "travel to the rib market"
   - "take the heartwater jar"

### Option 2: CLI Demo

Run the command-line interface:

```bash
npm run demo:cli
```

This starts an interactive CLI session. Type your actions and press Enter. Use `/help` for available commands.

## Environment Variables

You can set these environment variables to configure the demo:

- `VITE_OPENAI_API_KEY` or `OPENAI_API_KEY`: Your OpenAI API key (required for LLM features)
- `PORT`: Port for the API server (default: 3001)
- `VITE_API_URL`: API server URL for the web UI (default: http://localhost:3001)
- `VITE_NARRATOR_MODEL`: Narrator model (default: gpt-4o-mini)
- `VITE_NARRATOR_STYLE`: Narrator style - `lyric`, `cinematic`, or `michener` (default: michener)

Example `.env` file:

```
VITE_OPENAI_API_KEY=sk-your-key-here
PORT=3001
VITE_API_URL=http://localhost:3001
VITE_NARRATOR_STYLE=cinematic
```

## API Endpoints

The demo server exposes these endpoints:

- `POST /api/init` - Initialize a new session
  ```json
  {
    "apiKey": "sk-...",
    "sessionId": "optional-session-id"
  }
  ```
  Returns initial narration plus the latest telemetry snapshot and PKG projection.

- `POST /api/turn` - Process a player turn
  ```json
  {
    "playerText": "look around",
    "apiKey": "sk-...",
    "sessionId": "optional-session-id"
  }
  ```
  Returns narration, updated telemetry + PKG data, and the full patch list.

- `POST /api/reset` - Reset a session
  ```json
  {
    "sessionId": "optional-session-id"
  }
  ```

- `GET /health` - Health check

## What You'll See

### Web UI

- **Conversation History**: Player inputs and narrator responses
- **Agent Orchestrator**: Shows which agent is thinking and which tools are being used
- **Continuity Panel**: Surfaces PKG knowledge, ledger highlights, time/tide state, and deterministic weather signals each turn
- **Tools Panel**: Shows available tools and active tool usage

### CLI

- **Activity Board**: Real-time display of GM agent thinking, tool calls, and timeline
- **State Summary**: Current world state after each turn
- **Commands**: Use `/state`, `/history`, `/config`, etc.

## The Isle of Marrow

The demo uses the "Isle of Marrow" world, set in 1825 on a leviathan skeleton island. Features:

- **Locations**: The Landing, The Rib Market, The Drunken Vertebra, The Spine Ridge, The Heartspring, The Maw
- **Systems**: Time (with calendar), Tide (affects accessibility), Weather (pressure + climate signals), Economy (goods availability)
- **NPCs**: Mira Salt (weather-watcher), Jon "Ledger" Pike (quartermaster), Father Kel (priest), Aline Rua (rumor-source)
- **Spatial System**: Coordinate-based movement with terrain modifiers

## Troubleshooting

### Server won't start

- Check if port 3001 is already in use: `lsof -i :3001`
- Change the port with `PORT=3002 npm run demo:server`

### Web UI can't connect to server

- Ensure the server is running
- Check `VITE_API_URL` matches the server URL
- Check browser console for CORS errors

### No narration appears

- Verify your API key is set correctly
- Check server logs for errors
- Without an API key, fallback narration will be used (simpler, deterministic)

### GM agent seems stuck

- Check server logs for errors
- The agent may be waiting for an API response
- Try a simpler command first

## Architecture Overview

The demo showcases:

1. **GM Agent** (`v3/agents/gm.ts`): Interprets player actions, calls tools, returns structured patches
2. **Narrator** (`v3/agents/narrator.ts`): Generates prose from state changes, uses reasoning layer
3. **Tool Runtime** (`v3/tools/index.ts`): Deterministic tools for querying/updating world state
4. **Telemetry** (`v3/state/telemetry.ts`): Single source of truth for turn state
5. **PKG** (`v3/state/pkg.ts`): Player Knowledge Graph - what the player knows vs. ground truth
6. **Systems** (`v3/state/systems.ts`): Deterministic calculations (tide, time, etc.)

## Next Steps

- Explore the codebase: Start with `v3/cli.ts` to see the turn loop
- Read `v3/IMPLEMENTATION_SUMMARY.md` for architectural details
- Check `v3/tests/` for integration tests
- Modify `v3/state/world.ts` to create your own world

## Support

For issues or questions, check:
- `v3/README.md` for architecture overview
- `v3/IMPLEMENTATION_SUMMARY.md` for implementation details
- Test files in `v3/tests/` for usage examples

