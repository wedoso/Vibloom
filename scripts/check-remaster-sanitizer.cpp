// Standalone host sanitizer harness for the exact vendored native sources.
// Compile from repo root with clang++ -fsanitize=address,undefined; see report.
#include <cstdio>
#include <cmath>
#include "../src/audio/remaster/wasm/repair-kernel.cpp"
#include "../src/audio/remaster/wasm/tonal-kernel.cpp"
#include "../src/audio/remaster/wasm/alignment-kernel.cpp"
#include "../src/audio/remaster/wasm/limiter-kernel.cpp"
extern "C" void init_fft();
void run(int rate,int channels,int length,bool cache){
 Repair r(rate,channels,length);r.cacheBudget=cache?256*1024*1024:0;
 double p[32]={3000,4200,200,6,.9,.35,.8,3000,1000,-24,5,50,.8,4,12,1000,61,1,1,.5};
 for(int i=0;i<20;i++)r.p[i]=p[i];
 r.p[20]=std::exp(-512./(rate*.05));r.p[21]=std::pow(10.,3*std::max(4,int(rate*.001*1000/512))*512./rate/10);r.p[22]=std::exp(-512./rate);r.p[23]=std::exp(-512./(rate*.08));r.p[24]=std::pow(10.,512./rate/10);r.p[25]=std::exp(-512./(rate*.015));r.p[26]=std::pow(10.,-24./20);r.p[27]=std::pow(10.,-24./10);r.p[28]=2.5;r.p[29]=std::pow(10.,-3./20);r.p[30]=1/r.p[29];r.p[31]=std::pow(10.,-1.8);
 for(int i=0;i<N;i++)r.window[i]=.5-.5*std::cos(2*PI*i/N);
 for(int i=0;i<F;i++){r.left[i]=std::max(0,i-3);r.right[i]=std::min(F-1,i+3);r.high[i]=r.low[i]=1;r.ath[i]=1e-10;r.curve[i]=1;r.shEdge[i]=r.dnEdge[i]=r.deEdge[i]=1;}
 r.init();for(int c=0;c<channels;c++)for(int i=0;i<length;i++)r.input[c][i]=.1*std::sin(2*PI*1000*i/rate)*(c?-.5:1);
 if(channels==2){r.balanceFrames(0,r.cols);r.balanceEnd();}r.noiseFrames(0,r.cols);r.noiseEnd();
 for(int p=0;p<4;p++){r.begin(p);r.frames(0,r.cols);r.end();}
 for(int c=0;c<channels;c++)for(int i=0;i<length;i++)if(!std::isfinite(r.output[r.prev][c][i]))abort();
 if(length>=4096){Peaks t(rate,channels,length);for(int c=0;c<channels;c++)std::copy(r.output[r.prev][c],r.output[r.prev][c]+length,t.input[c]);for(int i=0;i<TN;i++)t.window[i]=.5-.5*std::cos(2*TPI*i/TN);for(int i=0;i<TF;i++){t.cosine[i]=std::cos(2*TPI*i*2048/16384);t.sine[i]=std::sin(2*TPI*i*2048/16384);}for(int i=2048;i<=length-2048;i+=1024)t.analyze(i);}
 Limiter l(channels,length,int(rate*4*.005));for(int i=0;i<length;i++)for(int c=0;c<channels;c++)l.pcm[i*channels+c]=r.output[r.prev][c][i];l.kernel[40]=1;l.p[0]=std::exp(-1./(rate*4*.015));l.p[1]=std::exp(-1./(rate*4*.1));l.p[2]=.89;l.run(length*4+40);l.finish();l.measure(length*4);
 if(channels==2){Alignment a(std::min(length,10000));for(int i=0;i<a.count;i++){a.left[i]=r.output[r.prev][0][i];a.right[i]=r.output[r.prev][1][i];}a.run();}
}
int main(){init_fft();for(int rate:{8000,44100,48000,96000})for(int c:{1,2})for(int len:{1,511,1024,2048,4097,17096})for(bool cache:{false,true})run(rate,c,len,cache);for(int i=0;i<2;i++){delete plans[i];delete[] scratch[i];}puts("PASS 96 native sanitizer cases; ASan/UBSan");}
