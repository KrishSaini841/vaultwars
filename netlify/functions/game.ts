import { getStore } from '@netlify/blobs';
import { createHandler } from '../../lib/service.ts';
// Netlify supplies Blobs credentials automatically in the function runtime.
// Native endpoint: /.netlify/functions/game — no path override or redirect.
export default createHandler(() => getStore({name:'vault-wars-rooms-v1',consistency:'strong'}));
