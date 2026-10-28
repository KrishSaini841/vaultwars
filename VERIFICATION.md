# Verification results

Verified on 2026-10-28 using Node.js 24.22.1 and a clean installation from package-lock.json.

## Passed

- Clean dependency install from the lockfile.
- TypeScript check.
- Fifteen automated game, call-signaling, and media-controller test groups covering completed games, conditional-write conflicts, eight-player capacity, host permissions, hidden bids, malformed requests, immutable bids, deadline auto-passes, duplicate requests, rematches, final unclaimed vaults, tied winners, credit tiebreaks, and chat.
- Production Vite build, with all referenced output assets present.
- Netlify function packaging using @netlify/zip-it-and-ship-it 16.6.0: exactly one standard function, `game`.
- Executed the code extracted from packaged-functions/game.zip using the real @netlify/blobs 11.1.7 SDK and its local storage emulator.
- Re-imported the packaged function as a cold instance and recovered final room state from storage.
- Frontend uses only the native `/.netlify/functions/game` endpoint for game requests.
- The existing game engine is byte-for-byte unchanged. Original casino CSS is preserved, with additional styles scoped to the call panel.

## Complete two-player, three-round fixture

| Round | Vault points (with carry) | Alpha bid | Beta bid | Result |
| --- | ---: | ---: | ---: | --- |
| 1 | 4 | 3 | 1 | Alpha wins 4 points |
| 2 | 5 | 2 | 2 | Tie; 5 points carry |
| 3 | 11 | 1 | 4 | Beta wins 11 points |

Final score: **Beta 11, Alpha 4**. Remaining credits: Alpha 18, Beta 17. Final winner: **Beta**. The function reaches `finished` with exactly three history entries.

This is a shortened test fixture only. Production rooms still use six rounds, preserving gameplay. A complete six-round packaged-function test also passed: Alpha bids 1 and Beta passes each round; Alpha finishes with 40 points and 18 credits, Beta with 0 points and 24 credits; Alpha wins.

## Voice/video verification

- Eight callers join concurrently using conditional writes; conflicts are retried.
- Recipient-only signaling, authenticated membership, current-session validation, acknowledgements, duplicate-signal handling, invalid SDP rejection, and expiration/leave cleanup passed.
- Calls use a separate Blobs record and do not change the gameplay record.
- Packaged-function tests now keep call presence active while completing both the three-round and six-round games, exchange a test SDP offer, update microphone/camera status, and leave cleanly.
- Browser media-controller tests use **mock media devices and mock peer connections**. They verify permission opt-in/denial, mute, camera track replacement, camera shutdown, all seven peer links per player, offer/answer control flow, bounded ICE waiting, and cleanup when permission resolves after cancellation. They do **not** prove real RTP audio/video transport, codec negotiation, device compatibility, audio quality, or NAT traversal.

The managed browser preview service is unavailable. No physical camera/microphone, live Netlify deployment, or real cross-device/cross-network WebRTC test was performed. A concrete device acceptance checklist is in README.md. The package has no TURN relay and cannot promise connectivity on all networks.

## Scope and emulator limitation

The Blobs 11.1.7 local emulator returns ETags on writes but omits them on reads. The verification script includes a clearly marked test-only bridge that returns the emulator's own most recent write ETag on subsequent reads. It does not invent ETags or change production code. Every SDK write is checked for an If-Match or If-None-Match condition. Simultaneous-write conflicts are separately tested using a deterministic atomic store adapter; this avoids treating the filesystem emulator as a production concurrency guarantee.

Production code requires an actual storage ETag and fails closed if one is absent. The standard Netlify function uses automatically supplied runtime credentials and strong consistency.

No live Netlify account deployment or browser visual test was performed. The ZIP is prepared for Netlify's signed-in source-project Drop flow; anonymous static publishing does not build server functions.
