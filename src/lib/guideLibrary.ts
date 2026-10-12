import type { Guide } from "./guides";

export function guideReadMinutes(guide: Guide) {
  const text=[guide.intro,...(guide.takeaways??[]),...guide.sections.flatMap(s=>[s.h,s.p,...(s.tips??[])])].join(" ");
  return Math.max(1,Math.ceil(text.trim().split(/\s+/).length/200));
}

export function selectGuides(guides: readonly Guide[], options:{query:string;topic:string;format:string;sort:string}) {
  const words=options.query.toLocaleLowerCase("en-GB").trim().split(/\s+/).filter(Boolean);
  const result=guides.filter(g=>{
    const video=g.sections.some(s=>s.video);
    if(options.topic&&g.category!==options.topic)return false;
    if(options.format==="video"&&!video||options.format==="text"&&video)return false;
    const haystack=[g.title,g.description,g.category,g.intro,...g.sections.flatMap(s=>[s.h,s.p,...(s.tips??[])])].join(" ").toLocaleLowerCase("en-GB");
    return words.every(word=>haystack.includes(word));
  });
  if(options.sort==="az")result.sort((a,b)=>a.title.localeCompare(b.title,"en-GB"));
  if(options.sort==="short")result.sort((a,b)=>guideReadMinutes(a)-guideReadMinutes(b));
  return result;
}

export function guideSectionIds(guide: Guide) {
  const used=new Set<string>();
  return guide.sections.map((s,i)=>{
    const base=s.h.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"")||`section-${i+1}`;
    let id=base,count=2;
    while(used.has(id))id=`${base}-${count++}`;
    used.add(id);
    return id;
  });
}
