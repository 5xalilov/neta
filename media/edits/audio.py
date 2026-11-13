import numpy as np, math
sr=48000; DUR=17.0; B=0.4605; b=lambda k:0.020+k*B
m=np.fromfile("music48.raw",np.float32).reshape(-1,2); L=len(m)/sr
out=np.zeros((int(DUR*sr),2),np.float32); out[:len(m)]=m
t=np.arange(len(out))/sr
rng=np.random.default_rng(1)
def whoosh(tc, length=0.32, gain=0.22, up=True):
    n=int(length*sr); x=rng.normal(0,1,(n,2)).astype(np.float32)
    # time-varying one-pole lowpass sweep
    fc=np.linspace(300,6000,n) if up else np.linspace(6000,300,n)
    a=np.exp(-2*np.pi*fc/sr); y=np.zeros_like(x); s=np.zeros(2)
    for i in range(n): s=a[i]*s+(1-a[i])*x[i]; y[i]=s
    env=np.sin(np.linspace(0,np.pi,n))**2
    y=y*env[:,None]; y/=np.abs(y).max()+1e-9
    i0=int((tc-length*0.6)*sr); i1=min(i0+n,len(out)); out[i0:i1]+=gain*y[:i1-i0]
def boom(tc, gain=0.35):
    n=int(0.6*sr); tt=np.arange(n)/sr
    f=55+70*np.exp(-tt/0.05); ph=2*np.pi*np.cumsum(f)/sr
    y=np.sin(ph)*np.exp(-tt/0.18); i0=int(tc*sr); i1=min(i0+n,len(out))
    out[i0:i1]+=gain*y[:i1-i0,None]
CUTS=[b(4),b(8),b(16),b(18),b(20),b(22),b(24),b(26),b(28),b(32)]
for i,c in enumerate(CUTS): whoosh(c, gain=0.16 if i in (1,9) else 0.2, up=i%2==0)
for c in (b(8),b(32)): boom(c)
# fades
fi=np.clip(t/0.4,0,1); fo=np.clip((DUR-t)/1.0,0,1)**1.5
out*= (fi*fo)[:,None]
pk=np.abs(out).max(); out*=0.95/max(pk,0.95)
out.astype(np.float32).tofile("mix.raw"); print("len",len(out)/sr,"peak",pk)
