/**
 * Safe Jinja-style template engine for email automation (no eval, no code).
 *
 * Supported syntax (the subset PaulleDemon/Email-automation users rely on):
 *   {{ name }}                    variable (HTML-escaped in html mode)
 *   {{ name | default:"there" }}  fallback when empty
 *   {{ name | upper }} / lower / capitalize
 *   {% if var %} … {% elif var == "x" %} … {% else %} … {% endif %}
 *   comparisons: ==, != against "quoted strings" or numbers; `not var`
 */

export type TemplateVars = Record<
  string,
  string | number | boolean | null | undefined
>;

type Node =
  | { kind: "text"; value: string }
  | { kind: "var"; name: string; filters: Filter[] }
  | { kind: "if"; branches: { cond: Condition | null; body: Node[] }[] };

type Filter = {
  name: "default" | "upper" | "lower" | "capitalize";
  arg?: string;
};

type Condition = {
  negate: boolean;
  name: string;
  op?: "==" | "!=";
  value?: string;
};

export class TemplateSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateSyntaxError";
  }
}

const TOKEN = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/g;
const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function parseFilters(parts: string[]): Filter[] {
  return parts.map((raw) => {
    const [name, ...argParts] = raw.split(":");
    const n = name!.trim();
    const arg = argParts.join(":").trim();
    if (n === "default") {
      const m = arg.match(/^"(.*)"$|^'(.*)'$/);
      return { name: "default", arg: m ? (m[1] ?? m[2] ?? "") : arg };
    }
    if (n === "upper" || n === "lower" || n === "capitalize")
      return { name: n };
    throw new TemplateSyntaxError(`Unknown filter "${n}"`);
  });
}

function parseCondition(expr: string): Condition {
  const e = expr.trim();
  const m = e.match(
    /^(not\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:(==|!=)\s*(?:"([^"]*)"|'([^']*)'|(-?\d+(?:\.\d+)?)))?$/,
  );
  if (!m) throw new TemplateSyntaxError(`Invalid condition "${e}"`);
  return {
    negate: Boolean(m[1]),
    name: m[2]!,
    op: m[3] as Condition["op"],
    value: m[4] ?? m[5] ?? m[6],
  };
}

export function parseTemplate(source: string): Node[] {
  const root: Node[] = [];
  const stack: { node: Extract<Node, { kind: "if" }>; target: Node[] }[] = [];
  let target = root;

  for (const piece of source.split(TOKEN)) {
    if (!piece) continue;
    if (piece.startsWith("{{")) {
      const inner = piece.slice(2, -2).trim();
      const [name, ...filters] = inner.split("|");
      const n = name!.trim();
      if (!IDENT.test(n))
        throw new TemplateSyntaxError(`Invalid variable "{{ ${inner} }}"`);
      target.push({ kind: "var", name: n, filters: parseFilters(filters) });
    } else if (piece.startsWith("{%")) {
      const inner = piece.slice(2, -2).trim();
      const [keyword, ...rest] = inner.split(/\s+/);
      const expr = rest.join(" ");
      if (keyword === "if") {
        const node: Extract<Node, { kind: "if" }> = {
          kind: "if",
          branches: [{ cond: parseCondition(expr), body: [] }],
        };
        target.push(node);
        stack.push({ node, target });
        target = node.branches[0]!.body;
      } else if (keyword === "elif" || keyword === "else") {
        const top = stack.at(-1);
        if (!top)
          throw new TemplateSyntaxError(`{% ${keyword} %} without {% if %}`);
        if (top.node.branches.at(-1)!.cond === null) {
          throw new TemplateSyntaxError(`{% ${keyword} %} after {% else %}`);
        }
        const branch = {
          cond: keyword === "elif" ? parseCondition(expr) : null,
          body: [] as Node[],
        };
        top.node.branches.push(branch);
        target = branch.body;
      } else if (keyword === "endif") {
        const top = stack.pop();
        if (!top) throw new TemplateSyntaxError("{% endif %} without {% if %}");
        target = top.target;
      } else {
        throw new TemplateSyntaxError(`Unsupported tag "{% ${inner} %}"`);
      }
    } else {
      target.push({ kind: "text", value: piece });
    }
  }
  if (stack.length > 0) throw new TemplateSyntaxError("Missing {% endif %}");
  return root;
}

function toStr(v: TemplateVars[string]): string {
  if (v === null || v === undefined || v === false) return "";
  return String(v);
}

/** Own properties only — `{{ constructor }}` / `{{ __proto__ }}` must stay empty. */
function lookup(vars: TemplateVars, name: string): TemplateVars[string] {
  return Object.prototype.hasOwnProperty.call(vars, name)
    ? vars[name]
    : undefined;
}

function evalCondition(cond: Condition, vars: TemplateVars): boolean {
  const raw = toStr(lookup(vars, cond.name));
  let result: boolean;
  if (!cond.op)
    result =
      raw.trim().length > 0 && raw !== "0" && raw.toLowerCase() !== "false";
  else if (cond.op === "==") result = raw === (cond.value ?? "");
  else result = raw !== (cond.value ?? "");
  return cond.negate ? !result : result;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderNodes(nodes: Node[], vars: TemplateVars, html: boolean): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") {
      out += node.value;
    } else if (node.kind === "var") {
      let v = toStr(lookup(vars, node.name));
      for (const f of node.filters) {
        if (f.name === "default" && !v.trim()) v = f.arg ?? "";
        else if (f.name === "upper") v = v.toUpperCase();
        else if (f.name === "lower") v = v.toLowerCase();
        else if (f.name === "capitalize")
          v = v ? v[0]!.toUpperCase() + v.slice(1) : v;
      }
      out += html ? escapeHtml(v) : v;
    } else {
      const branch = node.branches.find(
        (b) => b.cond === null || evalCondition(b.cond, vars),
      );
      if (branch) out += renderNodes(branch.body, vars, html);
    }
  }
  return out;
}

export function renderTemplate(
  source: string,
  vars: TemplateVars,
  opts: { html?: boolean } = {},
): string {
  return renderNodes(parseTemplate(source), vars, Boolean(opts.html));
}

function collectVars(nodes: Node[], into: Set<string>) {
  for (const node of nodes) {
    if (node.kind === "var") into.add(node.name);
    if (node.kind === "if") {
      for (const b of node.branches) {
        if (b.cond) into.add(b.cond.name);
        collectVars(b.body, into);
      }
    }
  }
}

/** Syntax check + list of variables referenced (for the editor). */
export function validateTemplate(source: string): {
  ok: boolean;
  variables: string[];
  error?: string;
} {
  try {
    const vars = new Set<string>();
    collectVars(parseTemplate(source), vars);
    return { ok: true, variables: Array.from(vars).sort() };
  } catch (err) {
    return {
      ok: false,
      variables: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Plain-text body → minimal HTML paragraphs (after rendering with html=true). */
export function textToHtml(renderedEscaped: string): string {
  return renderedEscaped
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}
