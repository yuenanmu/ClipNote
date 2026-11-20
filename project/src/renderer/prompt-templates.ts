export interface PromptTemplate {
  id: string;
  name: string;
  instructions: string;
}

export interface PromptLibrary {
  selectedId: string;
  custom: PromptTemplate[];
}

export const PROMPT_LIBRARY_KEY='clipnote.analysis.promptTemplates';
export const PROMPT_NAME_LIMIT=48;
export const PROMPT_TEXT_LIMIT=1000;
const DEFAULT_ID='standard';

export const BUILT_IN_PROMPTS:readonly PromptTemplate[]=[
  {id:DEFAULT_ID,name:'标准',instructions:''},
  {id:'concise',name:'简略',instructions:'重点保留核心观点、结论与必要条件。合并重复内容，每个主题仅保留最有价值的要点。'},
  {id:'detailed',name:'详细',instructions:'保留关键背景、推理过程、实例、数据、适用条件和限制。按主题分层整理，并明确区分事实与来源中的观点。'},
  {id:'actions',name:'行动清单',instructions:'优先提取资料中明确提出的行动、顺序、前置条件及注意事项。保留原文给出的责任人和时间。缺少行动的信息按主题简要归纳。'},
];

function isCustomPrompt(value:unknown):value is PromptTemplate{
  if(typeof value!=='object'||value===null)return false;
  const {id,name,instructions}=value as Partial<PromptTemplate>;
  return typeof id==='string' && id.startsWith('user:') &&
    typeof name==='string' && Boolean(name.trim()) && name.length<=PROMPT_NAME_LIMIT &&
    typeof instructions==='string' && Boolean(instructions.trim()) && instructions.length<=PROMPT_TEXT_LIMIT;
}

export function loadPromptLibrary():PromptLibrary{
  try{
    const raw=localStorage.getItem(PROMPT_LIBRARY_KEY);
    if(raw){
      const saved=JSON.parse(raw) as Partial<PromptLibrary>|null;
      if(Array.isArray(saved?.custom)){
        const custom=saved.custom.filter(isCustomPrompt);
        const selectedId=[...BUILT_IN_PROMPTS,...custom].some(prompt=>prompt.id===saved.selectedId)?saved.selectedId!:DEFAULT_ID;
        return {custom,selectedId};
      }
    }
  }catch{}
  try{
    const legacy=localStorage.getItem('clipnote.analysis.instructions');
    if(legacy?.trim()){
      const template={id:'user:legacy',name:'原有补充要求',instructions:legacy.slice(0,PROMPT_TEXT_LIMIT)};
      return {selectedId:template.id,custom:[template]};
    }
  }catch{}
  return {selectedId:DEFAULT_ID,custom:[]};
}
