# Vault Wars — Netlify-ready multiplayer

## Publish without a terminal

1. Sign in to Netlify and open https://app.netlify.com/drop.
2. Drag **netlify-ready-game.zip** into the Drop zone. Upload the complete project, not just `dist`. If your browser asks for a folder, extract the ZIP and drop the folder containing `netlify.toml` and `package.json`.
3. Let Netlify install, build, and publish. Open the resulting site URL, create a room, and share that URL and room code with another player.

No GitHub connection, user-supplied environment variables, API keys, or manual database setup is required. Netlify supplies Blobs access to the deployed function automatically. You must be signed in for Netlify Drop to build a source project and deploy its function; anonymous static uploads are not the intended flow.

## Included

- The unchanged high-stakes casino CSS and screen layout, with phone-friendly controls.
- Frontend source in `src/` and a verified production build in `dist/`.
- Exactly one standard function: `netlify/functions/game.ts`.
- Shared helpers in `lib/`, outside the functions directory.
- Direct frontend POSTs to `/.netlify/functions/game`. No custom route and no API redirect.
- Strongly consistent Netlify Blobs reads, conditional room creation, ETag-guarded updates, and retry on concurrent writes.
- Prepackaged `packaged-functions/game.zip`, built with Netlify's own function packager. Netlify's project build also packages the function from source automatically.
- Root `netlify.toml`, `package.json`, lockfile, TypeScript configuration, build and verification scripts, and tests.

## Public and private rooms

Choose **Private** (the default) or **Public** when creating a room. Public rooms appear under **Find a table** on the home screen. Enter your alias and select **Join room** to enter directly without typing a code. Private rooms are hidden from this list; enter their correct six-character code to join. Incorrect codes are rejected. A room code is an invitation secret, not an account password.

The list refreshes automatically every 10 seconds and has a manual refresh button. Only public lobbies with space and a host active within the last 30 seconds are listed. Started, full, stale, and private rooms are omitted, and joining rechecks these conditions on the server. The directory shows up to 40 recent joinable rooms from the latest 200 public rooms created in the last 24 hours. Existing rooms from earlier versions remain private.

## Netlify badge

There is no Netlify logo or badge in the frontend source. Netlify may inject its Powered by Netlify badge after deployment. This package sets a Content Security Policy in root `netlify.toml` with `script-src 'self'` (no inline scripts) and `frame-src 'none'`. Netlify documents that a policy without inline script permission prevents its injected badge from rendering. All game scripts are bundled local files; the existing inline styles, same-origin API, and media elements are allowed.

The deployed site's badge cannot be visually verified here. If your existing project's settings override the supplied headers, the direct permanent setting is **Project configuration → General → Powered by Netlify badge → Off → Save**. That setting takes effect on the next request without a redeploy. This ZIP cannot change your account's dashboard setting.

Reference: https://docs.netlify.com/manage/projects/powered-by-netlify-badge/

## Voice and video for the room

A new Room call panel sits alongside the game and works throughout the lobby, rounds, results, and rematches. All 2–8 players can opt in. Choose **Join voice** or **Join with video**, then allow the browser's device permission prompt. Use **Mute microphone**, **Turn camera off/on**, and **Leave call**. Nothing is recorded. Camera-off stops the camera track; leaving stops all local capture and closes peer connections. If the browser blocks incoming audio, use **Tap to enable sound**. Headphones prevent feedback.

Voice/video uses browser WebRTC with direct peer-to-peer connections and Cloudflare's free public STUN service. Signaling and call presence use the same standard Netlify function and strongly consistent, conditional Blobs writes in a separate room record, so calls do not change bids or scores. Only authenticated room members can signal each other; offers/answers are returned only to their addressed recipient and current call session. Signals expire logically after 60 seconds, are removed on acknowledgement/leave, and stale records are pruned on subsequent call activity. Audio and video are not stored or proxied through Netlify.

**Connection limitation:** This zero-key package does not include a TURN relay. Calls may fail between players on restrictive, corporate, school, or some mobile networks. Joining the same Wi-Fi or switching networks can help, but no direct-only WebRTC implementation can guarantee connectivity everywhere. Universal network coverage would need a managed TURN/SFU service and its credentials/billing, which are outside the requested no-key setup. The game and text chat remain available if calls fail.

Video targets 320×240 at 15 fps to reduce load. An eight-player room uses seven peer connections per device, so performance depends on device capacity and bandwidth. Use voice only on slower connections. The published Netlify HTTPS URL supports device permission prompts; insecure LAN HTTP URLs do not. Mobile browsers may suspend calls in background tabs; return and rejoin if needed.

## Gameplay remains the same

2–8 players; 24 credits each; six vaults worth 4, 5, 6, 7, 8, and 10 points. Each round allows 30 seconds to lock a secret bid from 0–8, constrained by remaining credits. All bids are spent. The unique highest positive bid wins; ties and all-pass rounds carry points forward. Final unclaimed points expire. Most points wins, then remaining credits, then shared victory. The host starts and advances rounds. Chat, public bid history, and rematches remain available.

The requested three-round verification uses a shortened test fixture. The live game remains six rounds, preserving the approved rules.

## Multiplayer behavior

Players poll the function about once per second. The server enforces deadlines on requests, so no always-running process is needed. Scores and bid reveals are committed atomically; other players never receive a current secret bid. Player session tokens remain in their own browser tab. Refresh restores the seat in that tab. State survives a cold function instance and site redeployment because rooms use a site-wide Blobs store.

Rooms expire after 24 hours without activity. Expired records are rejected rather than physically deleted. Disconnected players auto-pass. The host must return in the original tab to advance rounds; host transfer and player removal remain outside this prototype. Exiting a tab's session loses access to its seat. Polling and Blobs operations use the site's normal Netlify usage allowance.

## Verification scope

See `VERIFICATION.md`. Builds, game tests, packaged-function tests, and cold-instance persistence checks passed locally. No live Netlify account deployment, browser visual test, real camera/microphone transmission test, or cross-network call test was possible in this environment. See the included device checklist before inviting a group.

## Netlify documentation

- https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/
- https://docs.netlify.com/build/data-and-storage/netlify-blobs/
- https://docs.netlify.com/build/functions/get-started/

## Device acceptance checklist

After publishing, use two separate physical devices (with headphones):

1. Create and join a room; confirm both names and scores appear.
2. Join voice on both; allow microphone permission and confirm each person hears the other.
3. Mute and unmute each microphone; confirm the other device stops and resumes hearing it.
4. Turn cameras on, then off; confirm video appears and capture stops when switched off.
5. Play through the rounds while the call continues; confirm bids, scores, winner, and rematch still work.
6. Leave and rejoin the call; refresh one tab and rejoin; deny permission once and confirm the game still works.
7. Repeat with up to eight devices and, separately, different networks. Verify the sound-enable button when the browser blocks autoplay. Direct-call network failures are the known limitation above.

WebRTC references: https://webrtc.org/getting-started/turn-server and https://developers.cloudflare.com/realtime/turn/faq/
