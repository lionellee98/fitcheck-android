import os, re
from datetime import datetime, timezone

RUN = os.environ.get('RUN_NUMBER', '1')
BUILD = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')

idx = 'fitness-app/index.html'
t = open(idx).read()

# Bump app-version so the in-app label reflects the real build
t = re.sub(r'<meta name="app-version" content="[^"]*"',
           '<meta name="app-version" content="1.0.' + RUN + '"', t, count=1)

# Inject a build timestamp so "did it update?" is unambiguous
if 'name="app-build"' not in t:
    t = t.replace('<meta name="app-version" content="1.0.' + RUN + '"',
                  '<meta name="app-version" content="1.0.' + RUN + '"\n  <meta name="app-build" content="" />', 1)
t = re.sub(r'<meta name="app-build" content="[^"]*"',
           '<meta name="app-build" content="' + BUILD + ' UTC"', t, count=1)

open(idx, 'w').write(t)
print('index.html -> app-version 1.0.' + RUN + ', app-build ' + BUILD + ' UTC')
