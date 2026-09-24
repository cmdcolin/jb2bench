// The ANGLE backend every puppeteer launch here asks for. The default reaches
// the workstation's Mesa GPU through GLX. A cloud GPU has no X server, and
// there the default gets no WebGL2 at all, so ec2/ sets
// CHROME_ANGLE='--use-angle=gl-egl --use-gl=angle' (see ec2/gpuprobe.ts).
export const ANGLE_ARGS = process.env.CHROME_ANGLE?.split(/\s+/).filter(Boolean) ?? [
  '--use-angle=gl',
  '--use-gl=angle',
]
