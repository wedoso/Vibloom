// Global real-FFT correlation, preserving the reference's rejection after search.
#include <vector>
#include <cmath>
#include <algorithm>
#include "ducc0/fft/fft1d_impl.h"
using ducc0::detail_fft::pocketfft_r;
struct Alignment {
 int count,size;std::vector<float> left,right;std::vector<double> a,b,work;pocketfft_r<double> plan;
 static int sizeFor(int n){int s=2;while(s<n*2-1)s*=2;return s;}
 Alignment(int n):count(n),size(sizeFor(n)),left(n),right(n),a(size),b(size),plan(size){work.resize(plan.bufsize());}
 int run(){
  for(int i=0;i<count;i++){a[i]=left[i];b[i]=right[i];}
  plan.exec_copyback(a.data(),work.data(),1.,true);plan.exec_copyback(b.data(),work.data(),1.,true);
  a[0]*=b[0];a[size-1]*=b[size-1];
  for(int i=1;i<size/2;i++){double ar=a[2*i-1],ai=a[2*i],br=b[2*i-1],bi=b[2*i];a[2*i-1]=ar*br+ai*bi;a[2*i]=ai*br-ar*bi;}
  plan.exec_copyback(a.data(),work.data(),1./size,false);
  float best=-INFINITY;int lag=0;
  for(int j=0;j<count;j++){int k=j-count/2;float value=a[(k+size)%size];if(value>best){best=value;lag=k;}}
  return lag;
 }
};
extern "C" {
Alignment* alignment_create(int count){return new Alignment(count);}
float* alignment_buffer(Alignment* p,int right){return right?p->right.data():p->left.data();}
int alignment_run(Alignment* p){return p->run();}
void alignment_destroy(Alignment* p){delete p;}
}
