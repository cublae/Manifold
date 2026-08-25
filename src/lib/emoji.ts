import { EMOJI_DATA } from "../data/emoji"

/**
 * Emoji search for the launcher.
 *
 * Matching is on the Unicode name -- "grinning face", "flag: Ukraine" -- and on
 * the group the character belongs to, which is what makes ":food" and ":flag"
 * useful queries on their own. Every word of the query has to appear somewhere,
 * in any order, so ":face cat" finds the cat faces without either word having
 * to come first.
 *
 * Results are ordered by how early the query lands in the name, so a search for
 * "heart" gives the heart before the heart-eyed cat.
 */

export interface Emoji {
  char: string
  name: string
  group: string
}

let parsed: Emoji[] | null = null

/** The whole table, parsed on the first search and kept after that. */
function all(): Emoji[] {
  if (parsed) return parsed

  parsed = []
  for (const line of EMOJI_DATA.split("\n")) {
    if (!line) continue
    const [char, name, group] = line.split("\t")
    if (char && name && group) parsed.push({ char, name, group })
  }

  return parsed
}

/** Position of the earliest match, or -1 when a word is missing entirely. */
function score(haystack: string, words: string[]): number {
  let earliest = Number.MAX_SAFE_INTEGER

  for (const word of words) {
    const at = haystack.indexOf(word)
    if (at === -1) return -1
    earliest = Math.min(earliest, at)
  }

  return earliest
}

/**
 * Emoji matching `query`, best first.
 *
 * An empty query is the whole table in Unicode's own order, which groups the
 * smileys first and the flags last -- the order every emoji picker shows.
 */
export function searchEmoji(query: string, limit: number): Emoji[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return all().slice(0, limit)

  const whole = words.join(" ")

  const hits: Array<[Emoji, number]> = []
  for (const emoji of all()) {
    const name = emoji.name.toLowerCase()
    const rank = score(`${name} ${emoji.group.toLowerCase()}`, words)
    if (rank < 0) continue

    // A name the query matches outright comes first: someone who typed "cat"
    // means the cat, not the first smiley that happens to have a cat in it.
    hits.push([emoji, name === whole ? -1 : rank])
  }

  // Stable within a rank, so equally good matches keep the Unicode order.
  hits.sort((a, b) => a[1] - b[1])
  return hits.slice(0, limit).map(([emoji]) => emoji)
}
