import os, re

RUN = os.environ.get('RUN_NUMBER', '1')
idx = 'fitness-app/index.html'
t = open(idx).read()
t = re.sub(r'<meta name="app-version" content="[^"]*"',
           '<meta name="app-version" content="1.0.' + RUN + '"', t, count=1)
open(idx, 'w').write(t)
print('index.html app-version -> 1.0.' + RUN)
