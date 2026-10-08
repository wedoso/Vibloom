// Numerical port of pinned upstream lufs.js (ISC). Preserve stage Float32
// rounding, filter state in Float64, block summation and gate ordering.
const coefficients = {
  48000: { b: [1,-2,1], a: [1,-1.99004745483398,.99007225036621] },
  44100: { b: [1,-2,1], a: [1,-1.98916108609994,.98919185728498] },
};
function biquad(samples: Float32Array, b: number[], a: number[]) {
  const output = new Float32Array(samples.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) { const x0 = samples[i], y0 = (b[0]*x0+b[1]*x1+b[2]*x2-a[1]*y1-a[2]*y2)/a[0]; output[i] = y0; x2=x1; x1=x0; y2=y1; y1=y0; }
  return output;
}
export function integratedLufs(channels: Float32Array[], rate: number) {
  const c = coefficients[rate as keyof typeof coefficients] ?? coefficients[48000];
  const weighted = channels.map(data => biquad(biquad(data,[1.53512485958697,-2.69169618940638,1.19839281085285],[1,-1.69065929318241,.73248077421585]),c.b,c.a));
  const size = Math.floor(rate*.4), hop = Math.floor(rate*.1), blocks: number[] = [];
  for (let start=0; start+size<=channels[0].length; start+=hop) {
    let sumSquare=0;
    for (const data of weighted) { let sum=0; for(let i=start;i<start+size;i++) sum+=data[i]*data[i]; sumSquare+=sum/size; }
    const loudness=-.691+10*Math.log10(sumSquare); if(Number.isFinite(loudness)) blocks.push(loudness);
  }
  const absolute=blocks.filter(l=>l>-70); if(!absolute.length) return -Infinity;
  const threshold=absolute.reduce((a,b)=>a+b,0)/absolute.length-10, gated=blocks.filter(l=>l>threshold);
  return gated.length ? -.691+10*Math.log10(gated.reduce((sum,l)=>sum+Math.pow(10,(l+.691)/10),0)/gated.length) : -Infinity;
}
export function normalizationGain(lufs: number, target: number) { return !Number.isFinite(lufs) || lufs < -70 ? 1 : Math.pow(10,(target-lufs)/20); }
