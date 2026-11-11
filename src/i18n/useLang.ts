import { useSyncExternalStore } from "react";
import { getLang, setLang, subscribeLang, type Lang } from "./index";

/** The current language and a setter; components re-render when it changes. */
export function useLang(): [Lang, (lang: Lang) => void] {
  const lang = useSyncExternalStore(subscribeLang, getLang, getLang);
  return [lang, setLang];
}
