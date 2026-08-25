// unbzip2-stream ships no types — the surface we use is one factory
// returning a duplex (compressed bytes in, plain bytes out).
declare module 'unbzip2-stream' {
  import type { Duplex } from 'node:stream'
  export default function unbzip2(): Duplex
}
