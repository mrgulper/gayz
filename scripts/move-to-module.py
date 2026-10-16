#!/usr/bin/env python3
"""Move Game class methods into a module of plain functions taking `game`.

usage: python3 scripts/move-to-module.py Module.js "header comment" name1 name2 ...
Each moved method leaves a one-line stand-in in Game.js that calls the
module, so every caller keeps working. Module-level names the moved code
uses are imported (from their original module, or exported from Game.js).
"""
import re, sys, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'game', 'Game.js')
mod_file, header, names = sys.argv[1], sys.argv[2], sys.argv[3:]
mod_name = os.path.splitext(mod_file)[0]
lines = open(SRC).read().split('\n')

cls_start = next(i for i, l in enumerate(lines) if l.startswith('export class Game'))
cls_end = next(i for i in range(cls_start + 1, len(lines)) if lines[i] == '}')

def find_method(name):
    pat = re.compile(r'^  (static )?(async )?' + re.escape(name) + r'\((.*)\) \{$')
    hits = [i for i in range(cls_start, cls_end) if pat.match(lines[i])]
    if len(hits) != 1:
        sys.exit(f'{name}: {len(hits)} matches')
    s = hits[0]
    e = next(i for i in range(s + 1, cls_end) if lines[i] == '  }')
    # Comment lines right above belong to it.
    c = s
    while c - 1 > cls_start and lines[c - 1].startswith('  //'):
        c -= 1
    m = pat.match(lines[s])
    return c, s, e, bool(m.group(2)), m.group(3)

found = sorted((find_method(n) + (n,) for n in names), key=lambda x: x[0])

# Top-level names in Game.js, and where each comes from.
origin = {}  # name -> ('import', line) | ('local', lineidx)
i = 0
while i < len(lines):
    l = lines[i]
    if i == cls_start:
        i = cls_end + 1
        continue
    if l.startswith('import '):
        stmt = l
        while not re.search(r"from\s+'[^']+'|^import\s+'", stmt):
            i += 1
            stmt += ' ' + lines[i]
        src = re.search(r"from\s+'([^']+)'", stmt)
        if src:
            src = src.group(1)
            for star in re.findall(r'\*\s+as\s+(\w+)', stmt):
                origin[star] = ('star', src)
            br = re.search(r'\{([^}]*)\}', stmt)
            if br:
                for part in br.group(1).split(','):
                    part = part.strip()
                    if not part:
                        continue
                    if ' as ' in part:
                        a, b = [x.strip() for x in part.split(' as ')]
                        origin[b] = ('named', src, a)
                    else:
                        origin[part] = ('named', src, part)
            d = re.match(r'import\s+(\w+)\s*(,|from)', stmt)
            if d:
                origin[d.group(1)] = ('default', src)
    else:
        m = re.match(r'^(export\s+)?(async\s+)?(const|let|var|function\*?|class)\s+(\w+)', l)
        if m:
            origin[m.group(4)] = ('local', i)
        m2 = re.match(r'^(export\s+)?(const|let|var)\s+\{([^}]*)\}', l)
        if m2:
            for part in m2.group(3).split(','):
                n = part.split(':')[-1].strip()
                if n:
                    origin[n] = ('local', i)
    i += 1

# The class itself (static values like Game.SHOP_SKIN_PRICE).
origin['Game'] = ('local', cls_start)

def strip(code):
    code = re.sub(r'//[^\n]*', '', code)
    code = re.sub(r"'(?:\\.|[^'\\\n])*'", "''", code)
    code = re.sub(r'"(?:\\.|[^"\\\n])*"', '""', code)
    return code

out_funcs = []
used = set()
for c, s, e, is_async, args, _n in found:
    body = lines[s + 1:e]
    comments = [l[2:] for l in lines[c:s]]
    text = '\n'.join(body)
    if re.search(r'\bfunction\b', strip(text)) and re.search(r'\bthis\b', text):
        print(f'WARNING {names}: non-arrow function and this in method at line {s+1}', file=sys.stderr)
    text = re.sub(r'\bthis\b', 'game', text)
    if re.search(r'\bsuper\b', strip(text)):
        sys.exit(f'super in method at {s+1}')
    body2 = [l[2:] if l.startswith('  ') else l for l in text.split('\n')]
    name = re.match(r'^  (?:static )?(?:async )?(\w+)\(', lines[s]).group(1)
    uses_game = re.search(r'\bgame\b', strip('\n'.join(body2)))
    params = ('game' if uses_game else '_game') + (', ' + args if args.strip() else '')
    fn = comments + [f"export {'async ' if is_async else ''}function {name}({params}) {{"] + body2 + ['}']
    out_funcs.append('\n'.join(fn))
    for ident in set(re.findall(r'(?<![\w$])(?<![^.]\.)([A-Za-z_$][\w$]*)\b', strip('\n'.join(body2)))):
        if ident in origin:
            used.add(ident)

# Imports for the new module.
by_src = {}
stars = []
need_export = []
for n in sorted(used):
    o = origin[n]
    if o[0] == 'local':
        by_src.setdefault('./Game.js', []).append(n)
        need_export.append(o[1])
    elif o[0] == 'star':
        stars.append(f"import * as {n} from '{o[1]}'")
    elif o[0] == 'default':
        stars.append(f"import {n} from '{o[1]}'")
    else:
        _, src, orig = o
        by_src.setdefault(src, []).append(orig if orig == n else f'{orig} as {n}')
imports = stars + [f"import {{ {', '.join(v)} }} from '{k}'" for k, v in sorted(by_src.items())]

# Rewrite Game.js: stand-ins in place of the moved methods.
for c, s, e, is_async, args, _n in sorted(found, reverse=True):
    name = re.match(r'^  (?:static )?(?:async )?(\w+)\(', lines[s]).group(1)
    plain = ', '.join(a.split('=')[0].strip() for a in args.split(',') if a.strip()) if args.strip() else ''
    if '{' in args or '[' in args:
        stand = f'  {name}(...args) {{ return {mod_name}.{name}(this, ...args) }}'
    else:
        stand = f'  {name}({plain}) {{ return {mod_name}.{name}(this{", " + plain if plain else ""}) }}'
    lines[c:e + 1] = [stand]
for li in sorted(set(need_export)):
    if not lines[li].startswith('export '):
        lines[li] = 'export ' + lines[li]
# Drop Game.js imports nothing in it uses any more.
code_wo_imports = strip('\n'.join(l for l in lines if not l.startswith('import ')))
for idx, l in enumerate(lines):
    m = re.match(r'^import \{([^}]*)\} from (.*)$', l)
    if not m:
        continue
    keep = []
    for part in m.group(1).split(','):
        part = part.strip()
        if not part:
            continue
        local = part.split(' as ')[-1].strip()
        if re.search(r'(?<![\w$])(?<![^.]\.)' + re.escape(local) + r'\b', code_wo_imports):
            keep.append(part)
    lines[idx] = f"import {{ {', '.join(keep)} }} from {m.group(2)}" if keep else None
lines = [l for l in lines if l is not None]
# Import the module next to the other UI modules.
anchor = next(i for i, l in enumerate(lines) if l.startswith("import * as ChatUI from"))
lines.insert(anchor + 1, f"import * as {mod_name} from './{mod_file}'")
open(SRC, 'w').write('\n'.join(lines))

head = '\n'.join('// ' + h if h else '//' for h in header.split('\n'))
open(os.path.join(os.path.dirname(SRC), mod_file), 'w').write(head + '\n' + '\n'.join(imports) + '\n\n' + '\n\n'.join(out_funcs) + '\n')
print(f'moved {len(found)} methods, {sum(e - c + 1 for c, s, e, *_ in found)} lines; exported from Game.js: {len(set(need_export))}')
