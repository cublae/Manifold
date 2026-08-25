import GLib from "gi://GLib"

import { ru } from "../data/locales/ru"

/**
 * Translation.
 *
 * The English string is the key, the way gettext does it. That keeps call sites
 * readable -- `_("Do not disturb")` says what it renders -- and means an
 * untranslated string falls through to something correct rather than to a
 * symbolic name leaking onto the screen.
 *
 * The language is settled once, at startup, from the config or the locale. A
 * shell that could switch language while running would have to rebuild every
 * widget that had already rendered a string, and there is no reason to: nobody
 * changes the language of their desktop twice in a session, and a config
 * reload rebuilds the windows anyway.
 */

export type Language = "en" | "ru"

type Catalogue = Record<string, string>

const catalogues: Record<Language, Catalogue | null> = {
  en: null, // The keys are already English.
  ru,
}

let current: Language = "en"

/** The language the locale asks for, when the config says `auto`. */
function fromLocale(): Language {
  for (const name of GLib.get_language_names()) {
    if (name.toLowerCase().startsWith("ru")) return "ru"
    if (name.toLowerCase().startsWith("en")) return "en"
  }
  return "en"
}

/** Settle the language. Called once, before any widget is built. */
export function setLanguage(choice: Language | "auto"): void {
  current = choice === "auto" ? fromLocale() : choice
}

export function language(): Language {
  return current
}

/** Translate, falling back to the key. */
export function _(text: string): string {
  return catalogues[current]?.[text] ?? text
}

/**
 * Russian plurals, which have three forms rather than two.
 *
 * 1 минута, 2 минуты, 5 минут -- and the teens are all the third form, which is
 * the part a naive `n === 1` check gets wrong.
 */
export function plural(count: number, forms: [string, string, string]): string {
  if (current !== "ru") return count === 1 ? forms[0] : forms[1]

  const mod10 = count % 10
  const mod100 = count % 100

  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}
