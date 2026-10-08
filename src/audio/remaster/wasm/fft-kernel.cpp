// Browser FFT adapter. ducc FFT is vendored from SciPy e4e854eaa8f18d807cd3496028e257e36caa93cc.
#include "ducc0/fft/fft1d_impl.h"
using ducc0::detail_fft::pocketfft_r;
static double data[16384];
pocketfft_r<double> *plans[2];
double *scratch[2];
extern "C" {
void init_fft() {
  for (int i=0; i<2; ++i) {
    plans[i] = new pocketfft_r<double>(i ? 16384 : 2048);
    scratch[i] = new double[plans[i]->bufsize()];
  }
}
double *buffer() { return data; }
void forward(int large) { plans[large]->exec_copyback(data, scratch[large], 1., true); }
void inverse(int large) { plans[large]->exec_copyback(data, scratch[large], large ? 1./16384. : 1./2048., false); }
}
