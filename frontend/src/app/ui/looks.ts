/**
 * One character per voice. Each look is a set of parts drawn by the avatar (hair, clothes,
 * extras) and a palette. The face itself (eyes, brows, mouth) is shared, so lip-sync, blinking
 * and gaze work the same for everyone.
 */
export interface Look {
  /** Spoken description, for screen readers. */
  description: string;
  hair: 'bob' | 'bun' | 'long' | 'short' | 'cap';
  outfit: 'blazer' | 'scarf' | 'waistcoat' | 'gansey' | 'oilskin';
  beard?: 'full' | 'stubble';
  glasses?: boolean;
  freckles?: boolean;
  earrings?: 'pearls' | 'hoops';
  /** A starfish hair clip. */
  clip?: boolean;
  /** A sunny scene from the region behind them, and its sky (top, bottom). */
  scene: 'london' | 'tyne' | 'canal' | 'beach-huts' | 'cove';
  sky: [string, string];
  colours: {
    skin: string;
    ear: string;
    neck: string;
    hair: string;
    brow: string;
    top: string;
    trim: string;
    cheek: string;
    nose: string;
    lips: string;
  };
}

// Each character's clothes are a light, affectionate nod to the region's best-known style,
// not a costume: everyday British clothing people there would recognise.
export const LOOKS: Record<string, Look> = {
  // Southern England (London and the Home Counties): City formal, a tailored navy blazer over a
  // white shirt, a pocket square and pearl earrings.
  'uk-south': {
    description: 'a woman with a dark bob, in a tailored navy blazer, white shirt and pearl earrings',
    hair: 'bob',
    outfit: 'blazer',
    earrings: 'pearls',
    scene: 'london',
    sky: ['#cfe8f7', '#ffe4c6'],
    colours: {
      skin: '#edc9ac', ear: '#e3b797', neck: '#dcb092', hair: '#3a2a22', brow: '#3a2a22',
      top: '#1f2b44', trim: '#16203a', cheek: '#e59a8a', nose: '#c99a7c', lips: '#7c3a33',
    },
  },
  // Newcastle: a copper top-knot and a black-and-white striped scarf, the city's colours, against
  // the North Sea wind.
  'uk-north': {
    description: 'a woman with copper hair in a top-knot and a black-and-white striped scarf',
    hair: 'bun',
    outfit: 'scarf',
    freckles: true,
    scene: 'tyne',
    sky: ['#a9d8f2', '#eaf7ff'],
    colours: {
      skin: '#f4d6c2', ear: '#ebc5ac', neck: '#e4bea3', hair: '#9c4a26', brow: '#7a3a1f',
      top: '#3b3f46', trim: '#2a2d33', cheek: '#ec9f92', nose: '#d3a58a', lips: '#86413a',
    },
  },
  // Birmingham: sharp heritage tailoring, a flat cap, round glasses, a tweed waistcoat, a crisp
  // collar and a tie.
  'uk-midlands': {
    description: 'a man in a flat cap and round glasses, with stubble, a tweed waistcoat, a white collar and a tie',
    hair: 'cap',
    outfit: 'waistcoat',
    beard: 'stubble',
    glasses: true,
    scene: 'canal',
    sky: ['#ffe9b8', '#ffcf9c'],
    colours: {
      skin: '#b98260', ear: '#aa7453', neck: '#a46e4e', hair: '#1d1716', brow: '#1d1716',
      top: '#5e5345', trim: '#6d2430', cheek: '#b8624f', nose: '#8f5c3d', lips: '#5e2a25',
    },
  },
  // Suffolk: the coast (Lowestoft, Southwold's beach huts). Sandy hair and beard, and a navy fisherman's gansey
  // with a ribbed neck, ridged yoke and cables.
  'uk-east': {
    description: "a man with sandy hair, a full beard and a navy fisherman's gansey",
    hair: 'short',
    outfit: 'gansey',
    beard: 'full',
    scene: 'beach-huts',
    sky: ['#9fd6f0', '#e6f6fb'],
    colours: {
      skin: '#efc4a3', ear: '#e3b391', neck: '#dcab8a', hair: '#b9773c', brow: '#9a6230',
      top: '#2b3650', trim: '#435276', cheek: '#e59a86', nose: '#cf9c7d', lips: '#7c3a33',
    },
  },
  // South-West England (Cornwall and Devon): long fair waves, freckles, a starfish clip, and a yellow
  // fisherman's oilskin over a Breton stripe.
  'uk-west': {
    description: 'a woman with long fair wavy hair, freckles and a starfish clip, in a yellow oilskin over a Breton stripe',
    hair: 'long',
    outfit: 'oilskin',
    freckles: true,
    earrings: 'hoops',
    clip: true,
    scene: 'cove',
    sky: ['#8fd3f0', '#e0f5fb'],
    colours: {
      skin: '#f5d2b6', ear: '#ebc2a4', neck: '#e5bb9c', hair: '#d6a654', brow: '#a8793a',
      top: '#e3a52a', trim: '#b9831a', cheek: '#ef9f8c', nose: '#d8a789', lips: '#86413a',
    },
  },
};

/** The look for a voice id. Unknown voices (e.g. Kokoro) borrow the nearest one. */
export function lookFor(voiceId: string | null | undefined): Look {
  if (voiceId && LOOKS[voiceId]) return LOOKS[voiceId];
  if (voiceId && /(^|[-_])bm_/.test(voiceId)) return LOOKS['uk-east'];
  return LOOKS['uk-south'];
}

/** The palette as CSS custom properties, for the avatar's host element. */
export function paletteStyle(look: Look): string {
  return Object.entries(look.colours)
    .map(([name, value]) => `--${name}: ${value}`)
    .join('; ');
}
