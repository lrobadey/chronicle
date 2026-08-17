export interface ParsedCliCommand {
  name: string;
  args: string[];
}

export function parseCommand(line: string): ParsedCliCommand {
  const [name, ...args] = line.slice(1).trim().split(/\s+/);
  return { name: (name || '').toLowerCase(), args };
}
