# Hold'em Style Trainer

A local practice app for sending phone camera screenshots to a desktop dashboard and summarizing visible Texas Hold'em player stats.

This is built for study and practice review. Do not use it in real-money games, live games, or any environment where real-time assistance is prohibited.

## Run

```bash
npm start
```

Open these on devices connected to the same network:

- Desktop dashboard: `http://localhost:3000/dashboard`
- Phone capture, local name: `http://MacBook-Air-2.local:3000/capture`
- Phone capture, current Wi-Fi IP: shown on the dashboard under Phone Links

The dashboard shows both the `.local` phone link and the current Wi-Fi IP link with a Copy button. Some routers block `.local`/Bonjour; when that happens, use the current Wi-Fi link or reserve the Mac's IP address in your router so the bookmark stays stable.

For local-only testing, run `HOST=127.0.0.1 npm start`.

## AI Setup

Without an API key, the app runs in demo mode so the async workflow can be tested.

You can force demo mode even if your shell has an API key:

```bash
AI_DISABLED=1 npm start
```

To enable real image analysis:

```bash
export OPENAI_API_KEY="your_api_key"
export AI_MODEL="gpt-4.1"
export AI_IMAGE_DETAIL="high"
npm start
```

The server uses the OpenAI Responses API with image input. OpenAI's docs describe image input through Responses as accepting URLs, base64 data URLs, or file IDs.

## How It Works

- `/capture` is optimized for a phone camera or image library.
- Captures are downscaled in the browser, then sent to the local server as a base64 image.
- Phone captures auto-send as soon as an image is selected or taken.
- The phone page shows a sent confirmation after the desktop server accepts the upload.
- The server saves each screenshot in `data/captures`.
- Capture metadata, tracked players, and the saved CoinPoker baseline are saved in `data/holdem.sqlite`, so dashboard history survives server restarts.
- `/dashboard` listens with Server-Sent Events and updates as each capture moves from processing to ready.
- The AI response can mark a capture as discarded when the image or the 10-stat CoinPoker HUD profile is not clear enough.
- The target profile includes VPIP, PFR, 3B, Fold to 3B, C-Bet, Fold to C-Bet, Steal, Check/Raise, WTSD, and W$SD/WSD.
- Accepted captures are associated with a primary player name and can be searched live on the dashboard.
- The dashboard sidebar is a browser-saved table roster. Add or remove up to 9 players from the player cards.
- Player style labels are compared against the saved CoinPoker baseline, not generic pro baselines and not a recalculated pool on every image.
- The dashboard has an Update baseline button and displays the current baseline stats.
- Player stat cells show saved baseline averages and color-code red for more aggressive, blue for less aggressive, and green for normal range.
- `server.js` contains the AI prompt and JSON parsing logic.

## Next Improvements

- Add persistent storage for sessions and player histories.
- Add login or pairing codes before using this on an open network.
- Add hand-history import for clean benchmark data.
- Add a model/router abstraction if you want to compare providers.
