/** Only seller-authored contents lists are facts. Specs and BOMs describe
 * compatibility/availability; neither proves what travels in a rental case. */
function extractContents(description) {
  const text = String(description || '').replace(/\r/g, '');
  const start = /(?:^|\n|[.!?]\s+)[^\p{L}\p{N}\n]{0,12}(?:in (?:this|my) kit|included in this (?:rental|set)|(?:what(?:'s| is) )?included(?: in (?:the |this )?(?:kit|rental|package|set))?|kit contents|what you(?:'ll| will) (?:get|receive))[^\n]{0,140}\n/iu.exec(text);
  const included = [], optional = [], excluded = [], notes = [];
  let excerpt = '';
  if (start) {
    const lines = text.slice(start.index + start[0].length).split('\n');
    const captured = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { if (captured.length) break; else continue; }
      if (/^(?:add[- ]?ons?|upgrade|discount|please|usually|a quick|we (?:also|try)|this |the |unlock|ideal|perfect|whether|features|specifications|opening|collection|delivery|rental|about us|these |they |it |ideal|get |looking)/i.test(line.replace(/^[^\p{L}\p{N}]+/u,''))) break;
      // A bullet or quantity is explicit listing evidence; prose is not a packing item.
      if (line.length > 240) break;
      const item = line.replace(/^[*•\-–✓✔]\s*/, '').trim();
      if (!item) continue;
      captured.push(raw);
      if (/\boptional\b|on request|if requested/i.test(item)) optional.push(item);
      else if (/\bnot included\b|\bexcluded\b/i.test(item)) excluded.push(item);
      else included.push(item);
    }
    excerpt = text.slice(start.index, start.index + start[0].length) + captured.join('\n');
  }
  // These rules must themselves occur in this seller's listing, never be global defaults.
  for (const raw of text.split('\n')) {
    const line=raw.trim();
    if (line.length > 900) continue;
    if (/chargers (?:are included|with the equipment)|only supply proprietary charging cables|only supply the needed cable if it is proprietary|labelled as [“"]optional/i.test(line)) notes.push(line);
    else if (/^(?:please note[^.]*|no longer includes|not included|no )|\b(?:memory|sd) cards?\b.*\bnot included\b/i.test(line) && /not included|no longer includes|not come with/i.test(line)) excluded.push(line);
  }
  if (!included.length) {
    for (const sentence of text.split(/(?<=[.!?])\s+|\n/)) {
      if (sentence.length < 350 && /^(?:also )?(?:includes?\s|comes with\s)|\bcomes with\s|\bconsists of\s|\bset of two\b|\bfeaturing \d+x\b/i.test(sentence.trim()) && !/£|\b(?:add|upgrade|offer)\b/i.test(sentence)) included.push(sentence.trim());
    }
    if(included.length) excerpt=included.join('\n');
  }
  return { included:[...new Set(included)], optional:[...new Set(optional)], excluded:[...new Set(excluded)], notes:[...new Set(notes)], excerpt, status:included.length||optional.length ? 'documented' : 'unknown' };
}
function contentsFor(listing) {
  const c=listing?.rentalContents ?? (listing?.contentsSources ? {
    included:listing.includes,optional:listing.optional,excluded:listing.excludes,
    notes:listing.notes,status:listing.contentsStatus,sources:listing.contentsSources,
  } : null);
  if (!c || !Array.isArray(c.sources) || !c.sources.length) return {includes:[],optional:[],excludes:[],notes:[],contentsStatus:'unknown',contentsSources:[]};
  const strings=x=>Array.isArray(x)?x.filter(v=>typeof v==='string'&&v.trim()):[];
  return {includes:strings(c.included),optional:strings(c.optional),excludes:strings(c.excluded),notes:strings(c.notes),contentsStatus:c.status==='documented'?'documented':'unknown',contentsSources:c.sources.map(s=>({account:s.account,productId:s.productId,url:s.url,checkedAt:s.checkedAt}))};
}
function contentsText(listing) {
  const c=contentsFor(listing);
  return [c.includes.length?`Included: ${c.includes.join('; ')}.`:'Included accessories are not documented for this listing; do not infer them from the model, specs or title.',c.optional.length?`Only if explicitly requested: ${c.optional.join('; ')}.`:'',c.excludes.length?`Explicitly excluded: ${c.excludes.join('; ')}.`:'',c.notes.length?`Seller notes: ${c.notes.join(' ')}`:'','Anything not listed is unconfirmed, not automatically excluded.'].filter(Boolean).join(' ');
}
module.exports={extractContents,contentsFor,contentsText};
