<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Chronicle - AI-Powered Text Adventure

A traditional text-based adventure game powered by AI. The Game Master uses tools to query and update the game world based on your commands.

## Features

- **Traditional Adventure Game**: Move between locations, take items, interact with the world
- **AI Game Master**: Uses tools to query world state and make changes
- **Real-time World State**: Visual display of game world, player inventory, and action history
- **Tool-based Mechanics**: GM uses `query_world_state` and `update_world_state` tools

## How It Works

The AI Game Master follows these mechanics:

1. **Query World State**: Ask about current location, inventory, available items, etc.
2. **Update World State**: Move player, take items, change game state via JSON patches
3. **Narrate Results**: Describe the outcomes in natural language

## Game World

Start in the **Silent Glade** with a path leading north to the **Forest Path**, which continues to the **Weary Dragon Inn** where there's a rusty key to pick up.

## Run Locally

**Prerequisites:** Node.js, OpenAI API Key

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open http://localhost:3000 in your browser

4. **Paste your OpenAI API key** in the input field at the top

5. **Play the game!** Try commands like:
   - "Look around"
   - "Go north"
   - "Take the rusty key"
   - "Check inventory"

## Example Gameplay

```
You: Go north
GM: You walk along the forest path and arrive at the Weary Dragon Inn.

You: Take the rusty key
GM: You take the rusty key from the hook on the wall. It's now in your inventory.
```

The AI handles all game logic through the tool system!
