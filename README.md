# Royal Checkers

A phone-first, realistic 3D checkers game (Three.js), with photo-scanned wood, real piece motion, crowned kings, an END TURN button at each player's end, AI levels from 1 upward with no cap, and optional Groq AI.

## Deploy (Cloudflare Pages)
1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick this repo.
2. Framework preset: **None**. Build command: *(empty)*. Output directory: **/** (root).
3. After the first deploy: Settings → Variables and Secrets → add **GROQ_API_KEY** as a *Secret* (optional: `GROQ_MODEL`, default `llama-3.3-70b-versatile`). Redeploy.

The `/functions/api/ai-move.js` Pages Function keeps the Groq key on the server. Without a key, the built-in search engine plays alone.

## Rules
- American 8×8 or International 10×10 (flying kings), chosen in the menu.
- Captures are optional by default; turn on Forced (official) in the menu.
- After moving, the player must press their END TURN button. The opponent can't play until they do. ↶ takes back an unconfirmed move.

Textures and HDRI are CC0 from Poly Haven.
