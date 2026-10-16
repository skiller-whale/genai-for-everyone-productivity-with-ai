// One plain-language line per tool call, for people who don't read commands.

const short = (path: unknown) => String(path ?? '').replace(/^\/workspace\/[^/]+\//, '');

export function toolLabel(name: string, input: Record<string, unknown>): { icon: string; text: string } {
  switch (name) {
    case 'Bash':
      return { icon: '›_', text: String(input.description || firstLine(input.command)) };
    case 'Read':
      return { icon: '◔', text: `Read ${short(input.file_path)}` };
    case 'Write':
      return { icon: '✎', text: `Wrote ${short(input.file_path)}` };
    case 'Edit':
      return { icon: '✎', text: `Edited ${short(input.file_path)}` };
    case 'Glob':
      return { icon: '⌕', text: `Looked for ${input.pattern}` };
    case 'Grep':
      return { icon: '⌕', text: `Searched for "${input.pattern}"` };
    case 'TodoWrite':
      return { icon: '☰', text: 'Updated the plan' };
    case 'WebFetch':
      return { icon: '⇣', text: `Read ${input.url}` };
    case 'Skill':
      return { icon: '★', text: `Used the ${input.skill ?? input.command ?? ''} skill` };
    case 'mcp__cowork__show_artifact':
      return { icon: '▣', text: `Showed "${input.title}"` };
    default:
      return { icon: '•', text: name.replace(/^mcp__\w+__/, '') };
  }
}

/** The part worth showing when a step is expanded. */
export function toolDetail(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash') return String(input.command ?? '');
  if (name === 'Write') return String(input.content ?? '').slice(0, 3000);
  if (name === 'Edit') return `− ${input.old_string}\n+ ${input.new_string}`;
  return JSON.stringify(input, null, 2);
}

function firstLine(value: unknown): string {
  const line = String(value ?? '').split('\n')[0];
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}
