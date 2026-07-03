/**
 * Post-generation guardrails. The core rule: the model must never state a
 * price, stock level, or discount that did not come from a tool result.
 * We flag numeric/monetary claims in the reply that are absent from the
 * tool outputs observed this turn.
 */

export interface GuardrailInput {
  reply: string;
  /** Serialized tool results from this agent turn. */
  toolOutputs: string[];
}

export interface GuardrailFinding {
  kind: "unverified_price" | "unverified_discount";
  claim: string;
}

export interface GuardrailResult {
  ok: boolean;
  findings: GuardrailFinding[];
}

// Monetary amounts: $1,299.99 / 59.900 COP / USD 25 / 25€ etc.
const MONEY_RE =
  /(?:\$|€|£|(?:USD|COP|EUR|MXN|ARS|CLP|PEN)\s*)\s?\d[\d.,]*|\d[\d.,]*\s?(?:USD|COP|EUR|MXN|ARS|CLP|PEN|€|£|\$)/gi;
// Discount claims: "20% off", "20% de descuento", "descuento del 15%"
const DISCOUNT_RE = /\d{1,3}\s?%(?:\s*(?:off|de\s+descuento|discount))?/gi;

export function checkReplyGuardrails(input: GuardrailInput): GuardrailResult {
  const corpus = input.toolOutputs.join("\n");
  const corpusDigits = normalizeNumbers(corpus);
  const findings: GuardrailFinding[] = [];

  for (const match of input.reply.matchAll(MONEY_RE)) {
    const claim = match[0];
    if (!corpusDigits.has(digitsOf(claim))) {
      findings.push({ kind: "unverified_price", claim });
    }
  }

  const mentionsDiscountContext = /descuento|discount|% off|rebaja/i.test(input.reply);
  if (mentionsDiscountContext) {
    for (const match of input.reply.matchAll(DISCOUNT_RE)) {
      const claim = match[0];
      if (!corpusDigits.has(digitsOf(claim))) {
        findings.push({ kind: "unverified_discount", claim });
      }
    }
  }

  return { ok: findings.length === 0, findings };
}

/** Collect every digit-run appearing in the text so "59.900" and "59900" both match. */
function normalizeNumbers(text: string): Set<string> {
  const set = new Set<string>();
  for (const m of text.matchAll(/\d[\d.,]*/g)) {
    set.add(digitsOf(m[0]));
  }
  return set;
}

function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}
