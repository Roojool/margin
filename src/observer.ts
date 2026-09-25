import type { Page } from "playwright";

export type ObservedControl = {
  ref: string; // ephemeral local reference for current observation, e.g. "c1", "c2"
  role: string; // accessible role, e.g. "button", "link", "heading", "status", "textbox"
  name: string; // accessible name
  scope: string; // semantic container hierarchy, e.g. "main > article"
  state: {
    disabled?: boolean;
    checked?: boolean;
    expanded?: boolean;
    selected?: boolean;
    level?: number;
    value?: string;
  };
};

export type SemanticObservation = {
  url: string;
  path: string;
  title: string;
  controls: ObservedControl[];
  compactText: string;
};

const CONTAINER_ROLES = new Set([
  "document",
  "main",
  "article",
  "section",
  "navigation",
  "nav",
  "form",
  "dialog",
  "alertdialog",
  "region",
  "header",
  "banner",
  "footer",
  "contentinfo",
  "aside",
  "complementary",
]);

const ACTIONABLE_ROLES = new Set([
  "button",
  "link",
  "heading",
  "status",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "tab",
  "searchbox",
  "option",
  "menuitem",
  "switch",
]);

function roleAndName(line: string): { role: string; name: string; rest: string } | null {
  const match = /^([a-z]+)\b(.*)$/i.exec(line);
  if (!match) return null;
  let rest = (match[2] ?? "").trimStart();
  let name = "";
  if (rest.startsWith('"')) {
    const quoted = /^"(?:\\.|[^"\\])*"/.exec(rest);
    if (!quoted) throw new Error("Unsupported accessibility snapshot name");
    name = JSON.parse(quoted[0]) as string;
    rest = rest.slice(quoted[0].length);
  }
  return { role: match[1]!.toLowerCase(), name, rest };
}

/**
 * Parses Playwright's ariaSnapshot YAML output into structured, compact semantic controls.
 * Does not reimplement accessible-name computation or persist ephemeral refs as identities.
 */
export function parseAriaSnapshot(
  rawAria: string,
  meta?: { url?: string; title?: string },
): SemanticObservation {
  const url = meta?.url ?? "http://127.0.0.1/";
  let path = "/";
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  const title = meta?.title ?? "Untitled";

  const lines = rawAria.split("\n");
  const scopeStack: { indent: number; label: string }[] = [];
  const controls: ObservedControl[] = [];
  let refCount = 1;

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    const indentMatch = rawLine.match(/^(\s*)/);
    const indent = indentMatch && indentMatch[1] ? indentMatch[1].length : 0;
    let line = rawLine.trim();
    if (line.startsWith("- ")) {
      line = line.slice(2).trim();
    }

    // Pop scopes that are at or deeper than current line's indent
    while (
      scopeStack.length > 0 &&
      (scopeStack[scopeStack.length - 1]?.indent ?? 0) >= indent
    ) {
      scopeStack.pop();
    }

    // Check if line represents a container/scope
    // E.g.: main: or article: or form "Login": or dialog "Confirm":
    const parsedLine = roleAndName(line);
    if (parsedLine && CONTAINER_ROLES.has(parsedLine.role) && /^:\s*$/.test(parsedLine.rest)) {
      const role = parsedLine.role;
      if (role !== "document") {
        const label = parsedLine.name ? `${role} "${parsedLine.name}"` : role;
        scopeStack.push({ indent, label });
      }
      continue;
    }

    // Check if line represents an actionable control
    // Format: <role> ["<name>"] [attributes] [: <value>]
    if (parsedLine && ACTIONABLE_ROLES.has(parsedLine.role)) {
      const role = parsedLine.role;
      let name = parsedLine.name;
      const rest = parsedLine.rest;

      const state: ObservedControl["state"] = {};
      if (/\[disabled\]/i.test(rest)) state.disabled = true;
      if (/\[checked\]/i.test(rest)) state.checked = true;
      if (/\[expanded\]/i.test(rest)) state.expanded = true;
      if (/\[selected\]/i.test(rest)) state.selected = true;

      const levelMatch = rest.match(/\[level=(\d+)\]/i);
      if (levelMatch && levelMatch[1]) {
        state.level = Number.parseInt(levelMatch[1], 10);
      }

      const valueMatch = rest.match(/:\s*(.*)$/);
      if (valueMatch && valueMatch[1] && valueMatch[1].trim()) {
        const val = valueMatch[1].trim();
        const unquoted = val.replace(/^"|"$/g, "");
        if (!name && (role === "status" || role === "heading")) {
          name = unquoted;
        } else {
          state.value = unquoted;
        }
      }

      const scope =
        scopeStack.length > 0
          ? scopeStack.map((s) => s.label).join(" > ")
          : "document";

      controls.push({
        ref: `c${refCount++}`,
        role,
        name,
        scope,
        state,
      });
    }
  }

  // Format compact text
  const formattedControls = controls.map((c) => {
    let desc = `[${c.ref}] ${c.role} "${c.name}"`;
    const flags: string[] = [];
    if (c.state.disabled) flags.push("disabled");
    if (c.state.checked) flags.push("checked");
    if (c.state.expanded) flags.push("expanded");
    if (c.state.selected) flags.push("selected");
    if (c.state.level) flags.push(`level=${c.state.level}`);
    if (flags.length > 0) desc += ` [${flags.join(", ")}]`;
    if (c.state.value !== undefined) desc += `: "${c.state.value}"`;
    desc += ` (scope: ${c.scope})`;
    return desc;
  });

  const compactText = [
    `Page: ${title} (${path})`,
    "Observed controls:",
    ...formattedControls.map((c) => `  ${c}`),
  ].join("\n");

  return {
    url,
    path,
    title,
    controls,
    compactText,
  };
}

/**
 * Extracts semantic observation from an active Playwright page.
 */
export async function observePage(page: Page): Promise<SemanticObservation> {
  const url = page.url();
  const title = await page.title();
  const rawAria = await page.locator(":root").ariaSnapshot();
  return parseAriaSnapshot(rawAria, { url, title });
}
