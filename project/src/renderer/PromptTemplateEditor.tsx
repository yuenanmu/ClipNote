import {useLayoutEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {PROMPT_NAME_LIMIT,PROMPT_TEXT_LIMIT} from './prompt-templates.ts';
import type {PromptTemplate} from './prompt-templates.ts';

export function PromptTemplateEditor({template,onSave,onClose}:{
  template:PromptTemplate;
  onSave(draft:Pick<PromptTemplate,'name'|'instructions'>,replaceId?:string):void;
  onClose():void;
}){
  const dialog=useRef<HTMLDialogElement>(null);
  const custom=template.id.startsWith('user:');
  const [name,setName]=useState(custom?template.name:template.name+'（自定义）');
  const [instructions,setInstructions]=useState(template.instructions);
  const [error,setError]=useState('');
  const canSave=Boolean(name.trim() && instructions.trim());

  useLayoutEffect(()=>{
    const element=dialog.current;
    element?.showModal();
    return ()=>element?.close();
  },[]);

  const save=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!canSave)return;
    try{
      onSave({name:name.trim(),instructions},custom?template.id:undefined);
      dialog.current?.close();
    }catch(reason){
      setError(reason instanceof Error?reason.message:'无法保存提示词模板。');
    }
  };

  return <dialog className="file-dialog prompt-template-dialog" ref={dialog} onClose={onClose} aria-labelledby="prompt-template-title">
    <form onSubmit={save}>
      <h2 id="prompt-template-title">提示词模板</h2>
      <p className="prompt-template-caption">当前模板 · {template.name}</p>
      {!template.instructions && <p>标准模板按主题整理资料，提炼要点并保留必要的例子和原文依据。可填写补充要求，保存为自己的模板。</p>}
      <label>模板名称<input maxLength={PROMPT_NAME_LIMIT} value={name} onChange={event=>setName(event.target.value)}/></label>
      <label>提示词内容<textarea maxLength={PROMPT_TEXT_LIMIT} rows={6} value={instructions} placeholder="例如：按操作步骤整理，保留示例。" onChange={event=>setInstructions(event.target.value)}/></label>
      {error && <p className="notice error" role="alert">{error}</p>}
      <footer>
        <button type="button" className="secondary" onClick={()=>dialog.current?.close()}>关闭</button>
        <button className="primary" disabled={!canSave}>{custom?'保存模板':'保存为自定义模板'}</button>
      </footer>
    </form>
  </dialog>;
}
