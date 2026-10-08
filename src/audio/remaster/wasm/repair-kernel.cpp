// Offline spectral stages. Float stores are deliberate reference-rounding points.
// FFT, Hann windows and table constants are supplied by the pinned reference adapter.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <vector>
#include "ducc0/fft/fft1d_impl.h"
using ducc0::detail_fft::pocketfft_r;
extern pocketfft_r<double>* plans[2];
extern double *scratch[2];
constexpr int N=2048,H=512,F=1025;
constexpr double E=1e-12,PI=3.14159265358979323846,LN10=2.302585092994045684;
inline double lg(double x){return std::log(x);}
inline double lg10(double x){return std::log10(x);}
inline double ex(double x){return std::exp(x);}
inline double sq(double x){return std::sqrt(x);}
inline double cs(double x){return std::cos(x);}
inline double sn(double x){return std::sin(x);}
inline double pw(double x,double y){return std::pow(x,y);}
inline float f(double x){return float(x);}
inline double clip(double x,double lo=0,double hi=1){return std::max(lo,std::min(hi,x));}
inline int idx(int x,int lo,int hi){return std::max(lo,std::min(hi,x));}
void median(const float* in,float* out,int width,int lo,int hi){
 float work[61];int half=width/2;
 for(int j=0;j<width;j++)work[j]=in[idx(lo+j-half,lo,hi)];
 std::sort(work,work+width);
 for(int i=lo;i<=hi;i++){
  out[i]=work[half];float old=in[idx(i-half,lo,hi)],next=in[idx(i+half+1,lo,hi)];
  int at=0;while(at<width-1&&work[at]!=old)at++;
  for(int j=at;j<width-1;j++)work[j]=work[j+1];
  at=width-1;while(at>0&&work[at-1]>next){work[at]=work[at-1];at--;}work[at]=next;
 }
}
void smooth(const float* in,float* out,int width,int lo,int hi){
 int half=width/2;double sum=0;for(int j=-half;j<=half;j++)sum+=in[idx(lo+j,lo,hi)];
 for(int i=lo;i<=hi;i++){out[i]=sum/width;sum+=double(in[idx(i+half+1,lo,hi)])-in[idx(i-half,lo,hi)];}
}
struct Random {
 using U=__uint128_t;
 U state=(U(0x1aa1b5345996452dULL)<<64)|0x09585eb7a69561e3ULL;
 U increment=(U(0x418ddadb3af71a82ULL)<<64)|0x588133bc447873a9ULL;
 static constexpr U mul=(U(0x2360ed051fc65da4ULL)<<64)|0x4385df649fccf645ULL;
 void advance(uint64_t n){U m=mul,p=increment,am=1,ap=0;while(n){if(n&1){am*=m;ap=ap*m+p;}p=(m+1)*p;m*=m;n>>=1;}state=am*state+ap;}
 double next(){state=state*mul+increment;uint64_t x=uint64_t(state>>64)^uint64_t(state);int r=int(state>>122);uint64_t bits=(x>>r)|(x<<((-r)&63));return double(bits>>11)/9007199254740992.;}
};
struct Spec {float re[2][F]{},im[2][F]{},mag[F]{},psd[F]{};};
struct Repair {
 int rate,channels,length,cols,padded,delay[2]{},dnLo,dnHi,shLo,shHi,deLo,deHi,minwin,blocks,pass=-1,prev=-1,current=0;
 double p[32]{},ath[F]{},high[F]{},low[F]{},curve[F]{};
 float window[N]{},shEdge[F]{},dnEdge[F]{},deEdge[F]{},balance[2][F]{},means[2][F]{},firstPsd[F]{};
 int left[F]{},right[F]{};
 float *input[2]{},*output[2][2]{};
 std::vector<double> noise;std::vector<float> targetCache;size_t cacheBudget=256*1024*1024;
 double smoothPsd[F]{},persist[F]{},p0[F+1]{},p1[F+1]{},p2[F+1]{};
 float mask[F]{},clean[F]{},log[F]{},med[F]{},gains[F]{},temp[F]{},fm[F]{},target[2][F]{},norm[N+H]{};
 Spec a,fa;double fft[N]{};std::vector<Random> random;
 int width,capacity,next=0,heads[F]{},tails[F]{};std::vector<int> fi;std::vector<double> fv;
 double fsmooth[F]{},envelope[F]{};float floor[F]{};float previousDb=0;
 Repair(int r,int c,int n):rate(r),channels(c),length(n){
  cols=(n+H-1)/H+1;padded=(cols-1)*H;
  for(int ch=0;ch<c;ch++){
   input[ch]=(float*)calloc(padded,sizeof(float));
   output[0][ch]=(float*)calloc(padded,sizeof(float));
   if(!input[ch]||!output[0][ch])abort();
   std::fill(balance[ch],balance[ch]+F,1.f);
  }
 }
 ~Repair(){for(int c=0;c<channels;c++){free(input[c]);for(int k=0;k<2;k++)free(output[k][c]);}}
 void frame(float** in,int n,int t,Spec& s,bool balanced,bool shifted,bool statistics=true){
  if(statistics)std::fill(s.mag,s.mag+F,0.f);
  for(int c=0;c<channels;c++){
   for(int j=0;j<N;j++){int time=t*H-N/2+j,i=time-(shifted?delay[c]:0);fft[j]=(i>=0&&time<n?double(in[c][i]):0)*window[j];}
   plans[0]->exec_copyback(fft,scratch[0],1.,true);
   for(int j=0;j<F;j++){
    s.re[c][j]=fft[j==0?0:j==F-1?N-1:2*j-1]/1024.;s.im[c][j]=j==0||j==F-1?0:fft[2*j]/1024.;
    if(balanced){s.re[c][j]=f(double(s.re[c][j])*balance[c][j]);s.im[c][j]=f(double(s.im[c][j])*balance[c][j]);}
    if(statistics)s.mag[j]=f(double(s.mag[j])+f(hypot(double(s.re[c][j]),double(s.im[c][j]))));
   }
  }
  if(statistics)for(int j=0;j<F;j++){s.mag[j]=f(double(s.mag[j])/channels);s.psd[j]=f(double(f(double(s.mag[j])*s.mag[j]))+E);}
 }
 void init(){
  dnLo=std::max(0,int(ceil(p[7]*N/rate)));dnHi=std::min(F-1,int(std::floor(16000.*N/rate)));
  shLo=std::max(0,int(ceil(p[0]*N/rate)));shHi=std::min(F-1,int(std::floor(p[1]*N/rate)));
  deLo=std::max(0,int(ceil(180.*N/rate)));deHi=std::min(F-1,int(std::floor(12000.*N/rate)));
  minwin=std::max(4,int(std::floor(rate*p[8]/1000/H)));blocks=(cols+minwin-1)/minwin;
  if(p[6]>0)noise.resize(blocks*F,INFINITY);
  width=std::max(4,int(std::floor(double(rate)/H+.5)));capacity=width+2;
  if(p[17]){fi.resize(F*capacity);fv.resize(F*capacity);}
  const size_t cacheBytes=size_t(cols)*channels*F*sizeof(float);
  const size_t workingBytes=2*size_t(padded)*channels*sizeof(float)+noise.size()*sizeof(double)+fi.size()*sizeof(int)+fv.size()*sizeof(double)+sizeof(Repair);
  if(cacheBytes<=cacheBudget&&workingBytes+cacheBytes<=448*1024*1024)targetCache.resize(size_t(cols)*channels*F);

  auto normalization=[&](int i){float v=0;int last=(i+N/2)/H;for(int t=std::max(0,last-3);t<=std::min(cols-1,last);t++){int j=i-t*H+N/2;if(j>=0&&j<N)v=f(double(v)+f(double(window[j])*window[j]));}return v>1e-10?v:1.f;};
  for(int i=0;i<N/2;i++){norm[i]=normalization(i);norm[N/2+i]=normalization(padded-i-1);}
  for(int i=0;i<H;i++)norm[N+i]=normalization(N+i);
 }
 void balanceFrames(int start,int end){for(int t=start;t<end;t++){frame(input,length,t,a,false,true,false);for(int c=0;c<channels;c++)for(int i=0;i<F;i++)means[c][i]=f(double(means[c][i])+f(hypot(double(a.re[c][i]),double(a.im[c][i]))));}}
 void balanceEnd(){
  for(int i=0;i<F;i++)temp[i]=(double(f(double(means[0][i])/cols))+E)/(double(f(double(means[1][i])/cols))+E);
  smooth(temp,med,21,0,F-1);
  for(int i=0;i<F;i++){balance[1][i]=sq(clip(med[i],p[29],p[30]));balance[0][i]=1./balance[1][i];}
 }
 void noiseFrames(int start,int end){
  for(int t=start;t<end;t++){
   frame(input,length,t,a,true,true);if(!t)std::copy(a.psd,a.psd+F,firstPsd);
   for(int i=dnLo;i<=dnHi;i++){smoothPsd[i]=p[20]*smoothPsd[i]+(1-p[20])*a.psd[i];int at=t/minwin*F+i;noise[at]=std::min(noise[at],smoothPsd[i]);}
  }
 }
 void noiseEnd(){for(int i=dnLo;i<=dnHi;i++){double s=firstPsd[i];for(int b=0;b<blocks;b++){int at=b*F+i;s=std::min(noise[at],s*p[21]);noise[at]=s;}}}
 void begin(int k){
  pass=k;current=k%2;
  for(int c=0;c<channels;c++){if(!output[current][c]){output[current][c]=(float*)calloc(padded,sizeof(float));if(!output[current][c])abort();}std::fill(output[current][c],output[current][c]+padded,0.f);}
  std::fill(mask,mask+F,0.f);std::fill(persist,persist+F,0.);std::copy(firstPsd,firstPsd+F,clean);previousDb=0;
  random.resize(std::max(0,shHi-shLo+1));for(int i=0;i<int(random.size());i++){random[i]=Random();random[i].advance(uint64_t(i)*cols);}
  next=0;std::fill(heads,heads+F,0);std::fill(tails,tails+F,0);std::fill(fsmooth,fsmooth+F,0.);std::fill(envelope,envelope+F,0.);
 }
 float normAt(int i){return i<N/2?norm[i]:i>=padded-N/2?norm[N/2+padded-i-1]:norm[N+i%H];}
 void end(){for(int c=0;c<channels;c++)for(int i=0;i<padded;i++)output[current][c][i]=f(double(output[current][c][i])/normAt(i));prev=current;if(pass==0&&!targetCache.empty())for(int c=0;c<channels;c++){free(input[c]);input[c]=nullptr;}}
 double flatness(int lo,int hi,bool full=false){
  double logs=0,power=0;for(int i=lo;i<=hi;i++){float q=f(double(f(double(a.mag[i])*a.mag[i]))+E);logs+=f(lg(full?double(f(double(q)+E)):q));power+=full?q:f(double(a.mag[i])*a.mag[i]);}
  return f(double(f(ex(f(logs/(hi-lo+1)))))/f(double(f(power/(hi-lo+1)))+E));
 }
 void masking(float alpha,bool first){
  for(int i=0;i<F;i++){p0[i+1]=p0[i]+a.psd[i];p1[i+1]=p1[i]+a.psd[i]*high[i];}
  for(int i=F-1;i>=0;i--)p2[i]=p2[i+1]+a.psd[i]*low[i];
  for(int i=0;i<F;i++){
   int l=left[i],r=right[i];double spread=p[31]*((p1[i+1]-p1[l])/high[i]+(p2[i+1]-p2[r+1])/low[i])+1e-10*(p0[l]+p0[F]-p0[r+1]);
   mask[i]=std::max(f(std::max(ath[i],spread)),first?0.f:f(double(mask[i])*alpha));
  }
 }
 void floorFrame(int t){
  int l=t-width/2,r=std::min(cols-1,t+width-width/2-1);
  for(;next<=r;next++){
   frame(input,length,next,fa,true,true);
   for(int i=deLo;i<=deHi;i++){
    fsmooth[i]=p[23]*fsmooth[i]+(1-p[23])*fa.psd[i];envelope[i]=next?std::min(envelope[i]*p[24],fsmooth[i]):fsmooth[i];int base=i*capacity;
    while(heads[i]<tails[i]&&fi[base+heads[i]%capacity]<l)heads[i]++;
    while(heads[i]<tails[i]&&fv[base+(tails[i]-1)%capacity]>=envelope[i])tails[i]--;
    int at=base+tails[i]++%capacity;fi[at]=next;fv[at]=envelope[i];
   }
  }
  for(int i=deLo;i<=deHi;i++){int base=i*capacity;while(heads[i]<tails[i]&&fi[base+heads[i]%capacity]<l)heads[i]++;floor[i]=10*lg10(fv[base+heads[i]%capacity]+E);}
 }
 void frames(int start,int stop){
  const double dnFloor=p[26],minXi=p[27],cap=pw(10.,-12./20.);
  const int procLo=std::max(0,int(ceil(std::min(120.,p[0])*N/rate))),procHi=std::min(F-1,int(std::floor(std::max(16000.,p[1])*N/rate)));
  for(int t=start;t<stop;t++){
   if(prev<0||targetCache.empty()){
   frame(input,length,t,a,true,true);
   double flat=flatness(0,F-1,true);float noiseLike=f(clip(double(f(flat-.25))/f(.45)));
   double sum=0;for(float x:a.psd)sum+=x;
   float db=f(10.*f(lg10(f(double(f(sum/F))+E))));
   float non=f(1-clip(double(f(double(f(std::max(0.,t?double(f(double(db)-previousDb)):0.)))-6))/8));previousDb=db;
   masking(f(double(f(p[25]))*noiseLike),!t);std::fill(gains,gains+F,1.f);
   if(p[6]>0){
    for(int i=dnLo;i<=dnHi;i++){double n=noise[t/minwin*F+i]+E,gamma=a.psd[i]/n,xi=std::max(.98*clean[i]/n+.02*std::max(0.,gamma-1),minXi),g=dnFloor+(1-dnFloor)*xi/(xi+1);temp[i]=g;clean[i]=g*g*a.psd[i];}
    smooth(temp,med,int(p[10]),dnLo,dnHi);float depth=f(double(f(p[6]*f(.5+f(.5*noiseLike))))*non);
    for(int i=dnLo;i<=dnHi;i++)gains[i]=f(double(gains[i])*f(1-f(double(f(double(depth)*dnEdge[i]))*f(1.-med[i]))));
   }
   if(p[12]>0&&deHi>=deLo){
    for(int i=deLo;i<=deHi;i++)log[i]=lg(f(double(a.mag[i])+E));median(log,med,int(p[16]),deLo,deHi);
    if(p[17]){floorFrame(t);median(floor,fm,int(p[16]),deLo,deHi);}
    float thr=f(p[13]+f(6*f(1.-noiseLike)));int count=0;
    for(int i=deLo;i<=deHi;i++){
     double resid=double(f(double(log[i])-med[i]))*(20/LN10),pos=std::max(0.,std::max(resid-thr,p[17]?double(f(double(f(double(floor[i])-fm[i]))-3)):0.));if(pos>0)count++;
     persist[i]=p[22]*persist[i]+(1-p[22])*pos;temp[i]=clip(double(f(persist[i]))/p[28]);
    }
    double narrow=p[17]?1:1-clip((double(count)/(deHi-deLo+1)-.03)/.17),depth=p[12]*non*narrow;
    for(int i=deLo;i<=deHi;i++){
     float orig=f(hypot(double(a.re[0][i]),double(a.im[0][i]))),tm=std::min(orig,f(ex(double(med[i])+p[13]*LN10/20))),rd=f(depth*deEdge[i]*temp[i]);
     float nm=f(double(f(double(f(1.-rd))*orig))+f(double(rd)*tm));gains[i]=f(double(gains[i])*f(double(nm)/f(double(orig)+E)));
    }
   }
   double shDepth=0;
   if(shHi-shLo>=7){
    for(int i=shLo;i<=shHi;i++)log[i]=lg(f(double(a.mag[i])+E));median(log,med,9,shLo,shHi);int count=0;
    for(int i=shLo;i<=shHi;i++){temp[i]=f(double(f(double(log[i])-med[i]))*f(20/LN10));if(temp[i]>p[3])count++;}
    double narrow=1-clip((double(count)/(shHi-shLo+1)-.02)/.13);shDepth=clip((flatness(shLo,shHi)-.25)/.45)*non*narrow;
    for(int i=shLo;i<=shHi;i++){
     float orig=f(hypot(double(a.re[0][i]),double(a.im[0][i]))),tm=std::min(orig,f(ex(double(med[i])+p[3]*LN10/20))),conf=f(clip(double(f(double(temp[i])-p[3]))/p[3])),rd=f(shDepth*shEdge[i]*conf);
     gains[i]=f(double(gains[i])*f(double(f(double(f(double(f(1.-rd))*orig))+f(double(rd)*tm)))/f(double(orig)+E)));
    }
   }
   for(int i=procLo;i<=procHi;i++){
    double g=std::max(double(gains[i]),std::max(cap,std::min(1.,sq(f(double(mask[i])/f(double(a.psd[i])+E))))));
    for(int c=0;c<channels;c++){a.re[c][i]=f(double(a.re[c][i])*g);a.im[c][i]=f(double(a.im[c][i])*g);}
   }
   if(p[18]){
    double total=0;for(int i=0;i<F;i++){float m=0;for(int c=0;c<channels;c++)m=f(double(m)+f(hypot(double(a.re[c][i]),double(a.im[c][i]))));temp[i]=double(m)/channels;total+=temp[i];}
    smooth(temp,med,31,0,F-1);double curveSum=0;for(double x:curve)curveSum+=x;double scale=double(f(total))/curveSum;
    for(int i=0;i<F;i++){double excess=med[i]/(curve[i]*scale+E);if(excess>pw(10.,1.5/20.)){double g=clip(1-.2*(1-1/excess),.5,1);for(int c=0;c<channels;c++){a.re[c][i]=f(double(a.re[c][i])*g);a.im[c][i]=f(double(a.im[c][i])*g);}}}
   }
   if(p[5]>0&&shHi-shLo>=7){
    for(int i=shLo;i<=shHi;i++){
     float angle=f(random[i-shLo].next()*2*PI),r=f(cs(angle)),s=f(sn(angle)),d=f(p[5]*shDepth*shEdge[i]);
     for(int c=0;c<channels;c++){float m=f(hypot(double(a.re[c][i]),double(a.im[c][i])));a.re[c][i]=f(double(f(double(f(1.-d))*a.re[c][i]))+f(double(d)*f(double(m)*r)));a.im[c][i]=f(double(f(double(f(1.-d))*a.im[c][i]))+f(double(d)*f(double(m)*s)));}
    }
   }
   if(!targetCache.empty()&&prev<0)for(int c=0;c<channels;c++)for(int i=0;i<F;i++)targetCache[(size_t(t)*channels+c)*F+i]=hypot(double(a.re[c][i]),double(a.im[c][i]));
   }
   if(prev>=0){
    for(int c=0;c<channels;c++)for(int i=0;i<F;i++)target[c][i]=targetCache.empty()?float(hypot(double(a.re[c][i]),double(a.im[c][i]))):targetCache[(size_t(t)*channels+c)*F+i];
    frame(output[prev],padded,t,a,false,false,false);
    for(int c=0;c<channels;c++)for(int i=0;i<F;i++){float m=f(double(f(hypot(double(a.re[c][i]),double(a.im[c][i]))))+E);a.re[c][i]=f(double(f(double(a.re[c][i])/m))*target[c][i]);a.im[c][i]=f(double(f(double(a.im[c][i])/m))*target[c][i]);}
   }
   for(int c=0;c<channels;c++){
    fft[0]=a.re[c][0];fft[N-1]=a.re[c][F-1];for(int i=1;i<F-1;i++){fft[2*i-1]=a.re[c][i];fft[2*i]=a.im[c][i];}
    plans[0]->exec_copyback(fft,scratch[0],1./N,false);
    for(int j=0;j<N;j++){int i=t*H-N/2+j;if(i>=0&&i<padded)output[current][c][i]=f(double(output[current][c][i])+f(double(f(double(f(fft[j]))*1024))*window[j]));}
   }
  }
 }
};
extern "C" {
Repair* repair_create(int rate,int channels,int length){return new Repair(rate,channels,length);}
void* repair_buffer(Repair* r,int kind){
 if(kind==0)return r->p;if(kind==1)return r->window;if(kind==2)return r->ath;if(kind==3)return r->high;if(kind==4)return r->low;if(kind==5)return r->curve;
 if(kind==6)return r->shEdge;if(kind==7)return r->dnEdge;if(kind==8)return r->deEdge;if(kind==9)return r->left;if(kind==10)return r->right;if(kind==11)return r->delay;
 if(kind>=100&&kind<102)return r->input[kind-100];if(kind>=200&&kind<202)return r->output[r->prev][kind-200];return nullptr;
}
void repair_cache_budget(Repair* r,int bytes){r->cacheBudget=bytes;}
void repair_init(Repair* r){r->init();}
void repair_balance(Repair* r,int start,int end){r->balanceFrames(start,end);}
void repair_balance_end(Repair* r){r->balanceEnd();}
void repair_noise(Repair* r,int start,int end){r->noiseFrames(start,end);}
void repair_noise_end(Repair* r){r->noiseEnd();}
void repair_begin(Repair* r,int pass){r->begin(pass);}
void repair_frames(Repair* r,int start,int end){r->frames(start,end);}
void repair_end(Repair* r){r->end();}
void repair_destroy(Repair* r){delete r;}
}
