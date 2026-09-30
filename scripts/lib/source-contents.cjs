const {extractContents}=require('../../shared/rentalContents');
const reviewed=require('../../data/rental-contents-facts.json');

// Prose fragments reviewed against an exact seller description. A changed
// title or description invalidates the review rather than recycling old facts.
function sourceContents(source) {
  const extracted=extractContents(source?.description);
  const facts=reviewed.find(r=>r.account===source?.account && r.productId===source?.productId
    && r.sourceTitle===source?.name && r.sourceDescription===source?.description);
  if (!facts) return extracted;
  if (!facts.included.every(f=>f && source.description.includes(f))) throw Error('Unsourced reviewed contents');
  return {...extracted,included:[...new Set([...extracted.included,...facts.included])],status:'documented'};
}
module.exports={sourceContents};
