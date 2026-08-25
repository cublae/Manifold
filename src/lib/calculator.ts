/**
 * A calculator for the launcher's search field.
 *
 * Everything is parsed by hand rather than handed to `eval`: the shell would be
 * running whatever the user typed with its own privileges, and a search box is
 * the last place that should happen. A recursive-descent parser over a small
 * grammar costs a page of code and can only ever produce a number.
 *
 * Grammar, loosest binding first:
 *
 *   expression := term (("+" | "-") term)*
 *   term       := power (("*" | "/" | "%") power)*
 *   power      := unary ("^" power)?            -- right associative: 2^3^2 = 512
 *   unary      := ("+" | "-") unary | primary
 *   primary    := number | constant | name "(" expression ")" | "(" expression ")"
 */

/** Digits a result is rounded to before trailing zeros are stripped. */
const PRECISION = 10

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
}

const FUNCTIONS: Record<string, (value: number) => number> = {
  abs: Math.abs,
  ceil: Math.ceil,
  cos: Math.cos,
  exp: Math.exp,
  floor: Math.floor,
  ln: Math.log,
  log: Math.log10,
  round: Math.round,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan,
}

type Token =
  | { kind: "number"; value: number }
  | { kind: "name"; value: string }
  | { kind: "symbol"; value: string }

class ParseError extends Error {}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < input.length) {
    const char = input[index]

    if (char === " " || char === "\t") {
      index += 1
      continue
    }

    if (/[0-9.]/.test(char)) {
      const match = /^[0-9]*\.?[0-9]+/.exec(input.slice(index))
      if (!match) throw new ParseError(`bad number at ${index}`)
      tokens.push({ kind: "number", value: Number(match[0]) })
      index += match[0].length
      continue
    }

    if (/[a-z]/i.test(char)) {
      const match = /^[a-z]+/i.exec(input.slice(index))
      if (!match) throw new ParseError(`bad name at ${index}`)
      tokens.push({ kind: "name", value: match[0].toLowerCase() })
      index += match[0].length
      continue
    }

    if ("+-*/%^()".includes(char)) {
      tokens.push({ kind: "symbol", value: char })
      index += 1
      continue
    }

    // Anything else means this was never an expression: an application name,
    // a path, a sentence.
    throw new ParseError(`unexpected "${char}"`)
  }

  return tokens
}

class Parser {
  private at = 0

  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    const value = this.expression()
    if (this.at < this.tokens.length) throw new ParseError("trailing input")
    return value
  }

  private peek(): Token | undefined {
    return this.tokens[this.at]
  }

  private eat(value: string): boolean {
    const token = this.peek()
    if (token?.kind === "symbol" && token.value === value) {
      this.at += 1
      return true
    }
    return false
  }

  private expression(): number {
    let left = this.term()

    for (;;) {
      if (this.eat("+")) left += this.term()
      else if (this.eat("-")) left -= this.term()
      else return left
    }
  }

  private term(): number {
    let left = this.power()

    for (;;) {
      if (this.eat("*")) left *= this.power()
      else if (this.eat("/")) left /= this.power()
      else if (this.eat("%")) left %= this.power()
      else return left
    }
  }

  private power(): number {
    const base = this.unary()
    // Right associative, so the exponent is parsed as another power.
    return this.eat("^") ? base ** this.power() : base
  }

  private unary(): number {
    if (this.eat("-")) return -this.unary()
    if (this.eat("+")) return this.unary()
    return this.primary()
  }

  private primary(): number {
    if (this.eat("(")) {
      const value = this.expression()
      if (!this.eat(")")) throw new ParseError("unclosed bracket")
      return value
    }

    const token = this.peek()
    if (!token) throw new ParseError("unexpected end")

    if (token.kind === "number") {
      this.at += 1
      return token.value
    }

    if (token.kind === "name") {
      this.at += 1

      const constant = CONSTANTS[token.value]
      if (constant !== undefined) return constant

      const fn = FUNCTIONS[token.value]
      if (!fn) throw new ParseError(`unknown name "${token.value}"`)

      if (!this.eat("(")) throw new ParseError(`"${token.value}" wants brackets`)
      const argument = this.expression()
      if (!this.eat(")")) throw new ParseError("unclosed bracket")

      return fn(argument)
    }

    throw new ParseError(`unexpected "${token.value}"`)
  }
}

/** Trim floating-point noise: 0.1 + 0.2 should read as 0.3, not 0.30000000000000004. */
function format(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e21) return String(value)

  const rounded = Number(value.toPrecision(PRECISION))
  return String(rounded)
}

/**
 * The value of `input`, or null when it is not arithmetic.
 *
 * A bare number is not treated as a sum: "7" is far more likely to be the start
 * of a search than a calculation, and answering it with "= 7" would put a
 * result row above the apps on every other keystroke.
 */
export function calculate(input: string): string | null {
  const text = input.trim()
  if (!text || !/[0-9)]/.test(text) || !/[-+*/%^]|[a-z]+\(/i.test(text)) return null

  try {
    const value = new Parser(tokenize(text)).parse()
    return Number.isFinite(value) ? format(value) : null
  } catch (error) {
    if (error instanceof ParseError) return null
    throw error
  }
}
