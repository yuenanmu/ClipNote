const paths={
  plus:'M12 5v14 M5 12h14',
  file:'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6 M8 13h8 M8 17h5',
  layers:'M12 3 2 8l10 5 10-5-10-5z M2 12l10 5 10-5 M2 16l10 5 10-5',
  shield:'M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7z M8 12l3 3 5-6',
  link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  folder:'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z',
  folderOpen:'M3 9V5h7l2 2h8v3 M2 10h21l-4 10H5z',
  newFolder:'M3 7V5h7l2 2h8v13H3z M11 11v6 M8 14h6',
  newFile:'M14 3H5v18h14V8z M14 3v5h5 M8 14h8 M12 10v8',
  search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  refresh:'M20 7a8 8 0 1 0 0 10 M20 3v5h-5',
  collapse:'M4 4h13v3 M8 8h13v13H8z M11 14h7',
  more:'M5 12h.01 M12 12h.01 M19 12h.01',
  chevron:'M9 5l7 7-7 7',
  close:'M6 6l12 12 M6 18 18 6',
  archive:'M3 4h18v4H3z M5 8v13h14V8 M9 12h6',
  settings:'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M6 6l2 2 M16 16l2 2 M6 18l2-2 M16 8l2-2 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  save:'M4 3h14l3 3v15H3V3z M7 3v6h10V3 M7 21v-8h10v8',
};
export function FileIcon({name='file',size=16}:{name?:keyof typeof paths;size?:number}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;}
export function ToolButton({label,icon,onClick,disabled=false}:{label:string;icon:keyof typeof paths;onClick():void;disabled?:boolean}){return <button type="button" className="file-tool" aria-label={label} title={label} onClick={onClick} disabled={disabled}><FileIcon name={icon}/></button>;}
