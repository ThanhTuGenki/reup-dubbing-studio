import re, io, sys
html = io.open(__file__.replace('_check_lib.py', 'library.html'), encoding='utf-8').read()
blocks = re.findall(r'<script>([\s\S]*?)</script>', html)
print('script blocks:', len(blocks))
ok = True
for i, b in enumerate(blocks):
    # strip strings/template literals & comments crudely for balance check
    s = re.sub(r'`(?:[^`\\]|\\.)*`', '``', b, flags=re.S)
    s = re.sub(r"'(?:[^'\\]|\\.)*'", "''", s)
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', s)
    s = re.sub(r'//[^\n]*', '', s)
    for a, c in [('{', '}'), ('(', ')'), ('[', ']')]:
        if s.count(a) != s.count(c):
            print('block', i + 1, 'UNBALANCED', a, c, s.count(a), s.count(c)); ok = False
    bt = b.count('`')
    if bt % 2:
        print('block', i + 1, 'odd backtick count', bt); ok = False
    print('block', i + 1, 'checked,', len(b), 'chars')
print('div open/close:', len(re.findall(r'<div\b', html)), html.count('</div>'))
print('section open/close:', len(re.findall(r'<section\b', html)), html.count('</section>'))
print('ends with </html>:', html.rstrip().endswith('</html>'))
print('lines:', html.count('\n') + 1)
sys.exit(0 if ok else 1)
