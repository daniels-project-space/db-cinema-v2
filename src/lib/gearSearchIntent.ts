/** Category language is shared by both homepage searches. Only live departments
 * are returned; model names remain in the product query instead of being erased. */
export type SearchDepartment = { name: string; count: number };
const normalize = (value: string) => value.toLowerCase().replace(/ø/g, "o").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
const departments = [
  { name: "Cameras", aliases: "camera cameras cam cams camcorder camcorders cinema cine dslr dslm slr body bodies video vid" },
  { name: "Lenses", aliases: "lens lenses len lense glass optics optic prime primes zoom zooms anamorphic anamorphics" },
  { name: "Lighting", aliases: "light lights lighting lgt lite led leds tube tubes softbox softboxes fresnel rgb illumination" },
  { name: "Audio", aliases: "audio aud sound sounds snd mic mics mike microphone microphones lav lavs lavalier lavaliers boom recorder recorders" },
  { name: "Sound & DJ", aliases: "dj deejay speaker speakers loudspeaker pa mixer mixers turntable turntables decks" },
  { name: "Drones", aliases: "drone drones uav fpv quadcopter aerial" },
  { name: "Grip", aliases: "grip tripod tripods sticks stand stands cstand support rig rigging clamp clamps dolly slider" },
  { name: "Stabilizers", aliases: "stabilizer stabilizers stabiliser stabilisers stabilization stabilisation stab stabi gimbal gimbals gim gimb steadicam" },
  { name: "Monitors", aliases: "monitor monitors mon screen screens display viewfinder evf wirelessvideo" },
  { name: "Power", aliases: "power battery batteries batt batts charger chargers charging vlock vmount" },
  { name: "Accessories", aliases: "accessory accessories accs adapter adapters adaptor adaptors media card cards cage cages filter filters mattebox" },
  { name: "Packages", aliases: "package packages bundle bundles combo combos" },
  { name: "Projectors", aliases: "projector projectors projection proj" },
];
const stopWords = new Set("and or plus with for rental rentals rent hire gear equipment kit kits the a an some i need want looking please me of to".split(" "));

/** One insertion/deletion/substitution or adjacent swap; never fuzz short abbreviations. */
function nearWord(a: string, b: string) {
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const different = [...a].flatMap((letter, i) => letter === b[i] ? [] : [i]);
    return different.length === 1 || (different.length === 2 && different[1] === different[0] + 1 && a[different[0]] === b[different[1]] && a[different[1]] === b[different[0]]);
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1);
}

export function gearSearchIntent(query: string, available: SearchDepartment[]) {
  const words = normalize(query).replace(/\bfx[ -]+([369])\b/g, "fx$1").replace(/\bv[ -]+(?:mount|lock)\b/g, match => match.includes("mount") ? "vmount" : "vlock").match(/[a-z0-9]+/g)?.slice(0, 24) ?? [];
  const rules = departments.flatMap(rule => {
    const category = available.find(item => normalize(item.name) === normalize(rule.name));
    return category ? [{ category: category.name, words: rule.aliases.split(" ") }] : [];
  });
  const categories: string[] = [];
  const terms: string[] = [];
  const add = (name: string) => { if (!categories.includes(name)) categories.push(name); };
  for (const word of words) {
    if (stopWords.has(word)) continue;
    const exact = rules.find(rule => rule.words.includes(word));
    // Only accept a typo when all matching words point to the same department.
    const near = exact ? [] : rules.filter(rule => rule.words.some(alias => nearWord(word, alias)));
    const rule = exact ?? (near.length === 1 ? near[0] : undefined);
    if (rule) { add(rule.category); continue; }
    const direct = available.find(item => normalize(item.name) === word);
    if (direct) { add(direct.name); continue; }
    if (/^(?:red|arri|canon|sony|blackmagic|komodo|venice|bmpcc|fx[369]|a7s(?:iii|3))$/.test(word)) {
      const camera = available.find(item => item.name === "Cameras");
      if (camera) add(camera.name);
    }
    terms.push(word);
  }
  return { categories, search: terms.join(" "), categoryOnly: categories.length > 0 && terms.length === 0 };
}
