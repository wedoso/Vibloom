// Peak analysis only; trajectory matching/family confidence remain deterministic TS.
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <vector>
#include "ducc0/fft/fft1d_impl.h"
using ducc0::detail_fft::pocketfft_r;
extern pocketfft_r<double>* plans[2];extern double* scratch[2];
constexpr int TN=4096,TSIZE=16384,TF=8193;
constexpr double TPI=3.14159265358979323846;
inline double tsinc(double x){return x==0?1:std::sin(TPI*x)/(TPI*x);}
inline double tlobe(double x){
 double d[3][2];double v[3]={x,x-1,x+1};
 for(int i=0;i<3;i++){double a=TPI*v[i]/TN,s=tsinc(v[i])/tsinc(v[i]/TN);d[i][0]=s*std::cos(a);d[i][1]=s*std::sin(a);}
 return std::hypot(d[0][0]+(d[1][0]+d[2][0])/2,d[0][1]+(d[1][1]+d[2][1])/2);
}
struct Peaks {
 int rate,channels,length;float* input[2]{};
 double window[TN]{},cosine[TF]{},sine[TF]{},fft[TSIZE]{},re[2][TF]{},im[2][TF]{},magnitude[TF]{},db[TF]{};
 double results[4096*5]{}, leftMin[TF]{}, rightMin[TF]{};int stack[TF];
 Peaks(int r,int c,int n):rate(r),channels(c),length(n){for(int i=0;i<c;i++){input[i]=(float*)malloc(n*sizeof(float));if(!input[i])abort();}}
 ~Peaks(){for(int c=0;c<channels;c++)free(input[c]);}
 int analyze(int center){
  std::fill(magnitude,magnitude+TF,0.);
  for(int c=0;c<channels;c++){
   std::fill(fft,fft+TSIZE,0.);for(int i=0;i<TN;i++)fft[i]=double(input[c][center-TN/2+i])*window[i];
   plans[1]->exec_copyback(fft,scratch[1],1.,true);
   for(int i=0;i<TF;i++){
    double r=fft[i==0?0:i==TF-1?TSIZE-1:2*i-1],s=i==0||i==TF-1?0:fft[2*i];
    re[c][i]=r*cosine[i]-s*sine[i];im[c][i]=r*sine[i]+s*cosine[i];magnitude[i]+=r*r+s*s;
   }
  }
  double max=0;for(int i=0;i<TF;i++){magnitude[i]=std::sqrt(magnitude[i]/channels);max=std::max(max,magnitude[i]);}
  double floor=std::max(max*.001,2.2250738585072014e-308);
  for(int i=0;i<TF;i++)db[i]=20*std::log10(std::max(magnitude[i],floor));
  int top=0;
  for(int i=0;i<TF;i++){double min=db[i];while(top&&db[stack[top-1]]<=db[i])min=std::min(min,leftMin[stack[--top]]);leftMin[i]=min;stack[top++]=i;}
  top=0;
  for(int i=TF-1;i>=0;i--){double min=db[i];while(top&&db[stack[top-1]]<=db[i])min=std::min(min,rightMin[stack[--top]]);rightMin[i]=min;stack[top++]=i;}
  int count=0;
  for(int at=1;at<TF-1;at++){
   if(db[at]<=db[at-1])continue;int stop=at;while(stop+1<TF&&db[stop+1]==db[at])stop++;
   if(stop+1==TF||db[stop+1]>=db[at]){at=stop;continue;}
   int peak=(at+stop)/2;at=stop;double left=leftMin[peak],right=rightMin[peak];
   if(db[peak]-std::max(left,right)<12||peak<=8||peak>=TF-8)continue;
   double curvature=db[peak-1]-2*db[peak]+db[peak+1],offset=(db[peak-1]-db[peak+1])/(2*curvature),hz=(peak+offset)*rate/TSIZE;
   if(hz<40||hz>16000)continue;
   double shape[17],dot=0,norm=0,normObserved=0;
   for(int j=0;j<17;j++){shape[j]=tlobe((j-8-offset)/4);double m=magnitude[peak+j-8];dot+=m*shape[j];norm+=shape[j]*shape[j];normObserved+=m*m;}
   double amplitude=dot/norm,error=0;for(int j=0;j<17;j++){double d=magnitude[peak+j-8]-amplitude*shape[j];error+=d*d;}
   if(std::sqrt(error)/std::max(std::sqrt(normObserved),floor)>.15||amplitude<=floor)continue;
   double* dst=results+count*5;dst[0]=hz;bool supported=false;
   for(int c=0;c<channels;c++){
    double dot=0,power=0,mag[17];
    for(int j=0;j<17;j++){mag[j]=std::hypot(re[c][peak+j-8],im[c][peak+j-8]);dot+=mag[j]*shape[j];power+=mag[j]*mag[j];}
    double a=dot/norm,e=0;for(int j=0;j<17;j++){double d=mag[j]-shape[j]*a;e+=d*d;}
    int neighbor=peak+(offset>0?1:offset<0?-1:0);double w=std::abs(offset);
    double phase=std::atan2((1-w)*im[c][peak]+w*im[c][neighbor],(1-w)*re[c][peak]+w*re[c][neighbor]);
    double amp=std::sqrt(e)/std::max(std::sqrt(power),floor)>.15?0:a*2/(TN/2);
    dst[1+c*2]=amp*std::cos(phase);dst[2+c*2]=amp*std::sin(phase);supported|=amp>0;
   }
   if(supported)count++;
  }
  return count;
 }
};
extern "C" {
Peaks* peaks_create(int rate,int channels,int length){return new Peaks(rate,channels,length);}
void* peaks_buffer(Peaks* p,int kind){if(kind==0)return p->window;if(kind==1)return p->cosine;if(kind==2)return p->sine;if(kind==3)return p->results;if(kind>=100&&kind<102)return p->input[kind-100];return nullptr;}
int peaks_analyze(Peaks* p,int center){return p->analyze(center);}
void peaks_destroy(Peaks* p){delete p;}
}
