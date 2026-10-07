import json,sys
for f in sys.argv[1:]:
  for l in open(f):
    try: d=json.loads(l)
    except: continue
    r=d['res']
    st=lambda name: [ (t,s.split('|',1)[1].strip()[:50]) for n,t,s,_ in d['log'] if n==name and s.split('|',1)[1].strip()]
    def first(name,pat):
      for n,t,s,_ in d['log']:
        if n==name and pat in s: return t
    for x in r:
      n=x['name']
      print(f"{d['track']:14} {d['tag']:14} {n:11} ready={x['readyMs']} lastNet={x['lastNetMs']} req={x['req']} MB={x['MB']}  openDB={first(n,'Opening')} readGraph={first(n,'Reading graph')} pairs={first(n,'lane pairs')} zoom={first(n,'Zoom in')}")
