// Streaming reference 4x FIR / linked PDR / downsample. Never stores a 4x song.
#include <vector>
#include <algorithm>
#include <cmath>
constexpr double LE=1e-12;
struct Limiter {
 int channels,count,osCount,lookahead,capacity,next=0,nextOutput=0,head=0,tail=0,peakNext=0;
 std::vector<float> pcm,peaks;std::vector<int> indices;float kernel[81]{},ring[256]{};
 double p[5]{},envFast=1,envSlow=1,truePeak=0;
 Limiter(int c,int n,int la):channels(c),count(n),osCount(n*4),lookahead(la),capacity(la+2),pcm(n*c),peaks(capacity),indices(capacity){}
 float up(int frame,int channel){
  int v=frame-40,lo=v>=0?(v+3)/4:v/4,hi=(frame+40)/4;float sum=0;
  for(int i=std::max(0,lo);i<=std::min(count-1,hi);i++)sum=float(double(sum)+float(double(pcm[i*channels+channel])*float(4.*kernel[frame+40-i*4])));
  return sum;
 }
 void run(int end){
  for(;next<end;next++){
   int i=next;
   if(i<osCount){
    float peak=0;for(int c=0;c<channels;c++){float value=up(i,c);ring[i%128*channels+c]=value;peak=std::max(peak,std::abs(value));}
    while(head<tail&&indices[head%capacity]<i-lookahead)head++;
    while(head<tail&&peaks[(tail-1)%capacity]<=peak)tail--;
    indices[tail%capacity]=i;peaks[tail%capacity]=peak;tail++;
    float req=std::min(1.,double(float(p[2]))/float(double(peaks[head%capacity])+LE));
    envFast=req<envFast?req:p[0]*envFast+(1-p[0])*req;envSlow=req<envSlow?req:p[1]*envSlow+(1-p[1])*req;
    double weight=std::min(1.,double(float(double(float(1.-req))*2)));
    float g=std::min(double(req),(1-weight)*envFast+weight*envSlow);
    for(int c=0;c<channels;c++)ring[i%128*channels+c]=float(double(ring[i%128*channels+c])*g);
   }
   if(i>=nextOutput*4+40&&nextOutput<count){
    for(int c=0;c<channels;c++){
     float sum=0;
     for(int u=std::max(0,nextOutput*4-40);u<=std::min(osCount-1,nextOutput*4+40);u++)sum=float(double(sum)+float(double(ring[u%128*channels+c])*kernel[nextOutput*4+40-u]));
     pcm[nextOutput*channels+c]=sum;
    }
    nextOutput++;
   }
  }
 }
 void finish(){
  double peak=0;for(float x:pcm)peak=std::max(peak,double(std::abs(x)));p[3]=peak>.999999?.999999/peak:1;
  if(p[3]<1)for(float& x:pcm)x=float(double(float(double(x)/peak))*float(.999999));
 }
 void measure(int end){for(;peakNext<end;peakNext++)for(int c=0;c<channels;c++)truePeak=std::max(truePeak,double(std::abs(up(peakNext,c))));p[4]=truePeak;}
};
extern "C" {
Limiter* limiter_create(int channels,int count,int lookahead){return new Limiter(channels,count,lookahead);}
void* limiter_buffer(Limiter* p,int kind){return kind==0?(void*)p->pcm.data():kind==1?(void*)p->kernel:(void*)p->p;}
void limiter_run(Limiter* p,int end){p->run(end);}
void limiter_finish(Limiter* p){p->finish();}
void limiter_measure(Limiter* p,int end){p->measure(end);}
void limiter_destroy(Limiter* p){delete p;}
}
