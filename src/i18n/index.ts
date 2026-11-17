/** Explicit UI messages only: never translate IDs, player names or combat data. */
import { CORE } from "./core.ts";
import { SETTINGS_TEXT } from "./settings.ts";
import { VOID_TEXT } from "./void.ts";
import { LANGUAGES, isLanguage, type Language } from "./languages.ts";
export { LANGUAGES, isLanguage, type Language } from "./languages.ts";
export const MESSAGES = [...CORE, ...SETTINGS_TEXT, ...VOID_TEXT] as const;
export type MessageKey=(typeof MESSAGES)[number][0];
const rows=new Map<string,readonly string[]>(MESSAGES.map(row=>[row[0],row]));
let language:Language="en";
export const getLanguage=()=>language;
export function translate(locale:Language,key:MessageKey,values:Record<string,string|number>={}) {
  const row=rows.get(key);
  if(!row)return key;
  const index=LANGUAGES.findIndex(l=>l.code===locale),column=index<0?1:index+1;
  const text=row[column]||row[1];
  return text.replace(/\{(\w+)\}/g,(match,name)=>Object.hasOwn(values,name)?String(values[name]):match);
}
export const t=(key:MessageKey,values?:Record<string,string|number>)=>translate(language,key,values);
export function setLanguage(value:unknown) {
  const next=isLanguage(value)?value:"en",changed=next!==language;language=next;
  if(typeof document!=="undefined") {
    if(document.documentElement.lang!==language)document.documentElement.lang=language;
    document.documentElement.classList.toggle("locale-cjk",LANGUAGES.find(l=>l.code===language)!.script==="cjk");
  }
  return changed;
}
/** Call after rendering annotated static labels, or when changing language.
 * Dynamic messages use t() where their markup is built. No DOM observer. */
export function translateWithin(root:ParentNode) {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach(el=>{const key=el.dataset.i18n!;if(rows.has(key))el.textContent=t(key as MessageKey);});
  for(const attribute of ["title","aria-label"] as const) {
    root.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`).forEach(el=>{
      const key=el.getAttribute(`data-i18n-${attribute}`)!;
      if(rows.has(key))el.setAttribute(attribute,t(key as MessageKey));
    });
  }
}
