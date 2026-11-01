import { PAGE_SIZE, type ResourceItem, type ResourceKind, type ResourceQuery } from './types.ts';

type Entry = [id: string, title: string, kind: ResourceKind, url: string, license: string, blurb: string, tags: string];

/**
 * Hand-picked free libraries that have no public API. These are link-only: the studio shows them with
 * their licence and opens the site, the user downloads there and imports the file.
 */
const ENTRIES: Entry[] = [
  ['kenney', 'Kenney — game assets', 'other', 'https://kenney.nl/assets', 'CC0', '60,000+ CC0 sprites, 3D models, UI packs, audio and fonts.', '2d 3d sprites ui audio kit pixel cc0'],
  ['quaternius', 'Quaternius — 3D packs', 'model', 'https://quaternius.com', 'CC0', 'Stylised low-poly characters, animals, nature, buildings (GLB/FBX).', '3d low-poly characters animals nature'],
  ['polypizza', 'Poly Pizza', 'model', 'https://poly.pizza', 'CC0 / CC BY', 'Searchable low-poly 3D models, downloadable as GLB.', '3d low-poly glb models'],
  ['opengameart', 'OpenGameArt', 'other', 'https://opengameart.org', 'CC0 / CC BY / GPL', 'Community library of 2D art, 3D art, music and sound effects.', '2d 3d music sfx sprites tiles'],
  ['itch-assets', 'itch.io — free game assets', 'other', 'https://itch.io/game-assets/free', 'Varies per pack', 'Thousands of free asset packs; check each pack\'s licence.', 'sprites tilesets ui audio'],
  ['craftpix', 'CraftPix — free packs', 'image', 'https://craftpix.net/freebies/', 'Royalty-free', 'Free 2D sprites, backgrounds and GUI kits.', '2d sprites backgrounds gui'],
  ['ambientcg', 'ambientCG', 'texture', 'https://ambientcg.com', 'CC0', 'CC0 PBR materials, HDRIs and 3D models.', 'pbr textures materials hdri'],
  ['textures-com', 'Poly Haven HDRIs', 'texture', 'https://polyhaven.com/hdris', 'CC0', 'Free HDR skies for lighting and backgrounds.', 'hdri sky environment lighting'],
  ['freesound', 'Freesound', 'audio', 'https://freesound.org', 'CC0 / CC BY', 'Huge database of sound effects and recordings (account needed to download).', 'sfx sound effects foley ambience'],
  ['pixabay-audio', 'Pixabay Music & SFX', 'audio', 'https://pixabay.com/music/', 'Pixabay Content License', 'Free music and sound effects for games, no attribution needed.', 'music sfx loops'],
  ['incompetech', 'Incompetech', 'audio', 'https://incompetech.com/music/royalty-free/', 'CC BY', 'Kevin MacLeod\'s royalty-free music library.', 'music soundtrack loops'],
  ['kenney-audio', 'Kenney audio packs', 'audio', 'https://kenney.nl/assets?q=audio', 'CC0', 'Interface sounds, impacts, jingles and more.', 'sfx ui impact jingle'],
  ['game-icons', 'game-icons.net', 'image', 'https://game-icons.net', 'CC BY 3.0', '4,000+ vector icons for items, skills and UI (SVG).', 'icons svg items skills ui'],
  ['lucide', 'Lucide icons', 'image', 'https://lucide.dev/icons/', 'ISC', 'Clean open-source UI icons (SVG).', 'icons svg ui'],
  ['lospec', 'Lospec palettes & tools', 'tool', 'https://lospec.com/palette-list', 'Free', 'Pixel-art colour palettes and a free pixel editor.', 'pixel palettes colors'],
  ['google-fonts', 'Google Fonts', 'font', 'https://fonts.google.com', 'OFL / Apache', 'Open-licence fonts for HUD and menus.', 'fonts typography ui'],
  ['fontsquirrel', 'Font Squirrel', 'font', 'https://www.fontsquirrel.com', 'Commercial-use free', 'Hand-picked free fonts with clear licences.', 'fonts typography'],
  ['mixamo', 'Mixamo', 'model', 'https://www.mixamo.com', 'Adobe (free, royalty-free)', 'Auto-rigged characters and animations (free Adobe account).', 'characters animation rig humanoid'],
  ['sketchfab-cc', 'Sketchfab — CC models', 'model', 'https://sketchfab.com/features/free-3d-models', 'CC (varies)', 'Search downloadable Creative Commons 3D models.', '3d models scans'],
  ['blender-studio', 'Blender Studio assets', 'other', 'https://studio.blender.org/', 'CC BY / CC0', 'Production assets and characters from the open movies.', 'blender 3d characters'],
  ['unsplash', 'Unsplash', 'image', 'https://unsplash.com', 'Unsplash License', 'Free photos for backgrounds and menus.', 'photos backgrounds'],
  ['pexels-videos', 'Pexels videos', 'video', 'https://www.pexels.com/videos/', 'Pexels License', 'Free stock video for cutscenes and menu backgrounds.', 'video backgrounds cutscene'],
  ['coverr', 'Coverr', 'video', 'https://coverr.co', 'Free', 'Free stock footage loops.', 'video loops'],
  ['shadertoy', 'Shadertoy', 'tool', 'https://www.shadertoy.com', 'Varies (check each)', 'Thousands of GLSL effects to learn from and adapt.', 'glsl shaders effects'],
  ['tiled-maps', 'OpenGameArt tilesets', 'image', 'https://opengameart.org/art-search-advanced?keys=&field_art_type_tid%5B%5D=9', 'Varies', 'Free tilesets for 2D level design.', 'tileset tiles 2d maps'],
];

export const CATALOG: ResourceItem[] = ENTRIES.map(([id, title, kind, sourceUrl, license, blurb, tags]) => ({
  id: `catalog:${id}`,
  provider: 'catalog',
  title,
  kind,
  thumb: null,
  license,
  licenseGroup: /^cc0$/i.test(license) ? 'cc0' : /cc by/i.test(license) ? 'attribution' : 'other',
  sourceUrl,
  tags: [...tags.split(' ')],
  description: blurb,
}));

export function searchCatalog(query: ResourceQuery): { items: ResourceItem[]; hasMore: boolean } {
  const words = query.q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = CATALOG.filter((item) => {
    if (query.kind !== 'all' && item.kind !== query.kind && item.kind !== 'other' && !(query.kind === 'image' && item.kind === 'texture')) return false;
    if (query.license === 'cc0' && item.licenseGroup !== 'cc0') return false;
    const hay = `${item.title} ${item.description ?? ''} ${(item.tags ?? []).join(' ')} ${item.kind}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const start = (query.page - 1) * PAGE_SIZE;
  return { items: hits.slice(start, start + PAGE_SIZE), hasMore: hits.length > start + PAGE_SIZE };
}
